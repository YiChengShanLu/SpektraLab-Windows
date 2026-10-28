//! The MIT spklib helper owns library databases. A request is serial and a
//! timed-out mutation is never retried; kill/reap before releasing its lease.
use std::{collections::HashMap, path::PathBuf, process::Stdio, time::Duration};
use serde_json::{json, Value};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, ChildStdout, Command}, sync::Mutex};

struct Connection { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, next: u64 }
struct Library { path: Value, handle: Option<Value> }
#[derive(Default)]
struct State { connection: Option<Connection>, libraries: HashMap<String,Library>, next_library: u64 }
pub struct LibraryHost { state: Mutex<State>, program: PathBuf, store: PathBuf }
fn error(code: &str, message: impl ToString) -> Value { json!({"code":code,"message":message.to_string()}) }
async fn line(reader: &mut BufReader<ChildStdout>) -> Result<Value, Value> {
    let mut bytes=Vec::new();
    (&mut *reader).take(16*1024*1024).read_until(b'\n', &mut bytes).await.map_err(|e|error("library_io",e))?;
    if bytes.last()!=Some(&b'\n') {return Err(error("library_io","Library helper exited or sent an oversized reply. Refresh to inspect its saved state."));}
    serde_json::from_slice(&bytes).map_err(|e|error("library_protocol",e))
}
impl LibraryHost {
    pub fn new(program:PathBuf,store:PathBuf)->Self {Self{state:Mutex::new(State::default()),program,store}}
    async fn connect(&self)->Result<Connection,Value>{
        tokio::fs::create_dir_all(&self.store).await.map_err(|e|error("library_io",e))?;
        let mut command=Command::new(&self.program);
        command.arg("--store").arg(&self.store).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(windows)] command.creation_flags(0x08000000);
        let mut child=command.spawn().map_err(|e|error("library_unavailable",format!("Cannot start {}: {e}",self.program.display())))?;
        let input=child.stdin.take().unwrap();
        let mut output=BufReader::new(child.stdout.take().unwrap());
        match tokio::time::timeout(Duration::from_secs(15),line(&mut output)).await {
            Ok(Ok(ready)) if ready["event"]=="ready" && ready["protocol"]==1 => Ok(Connection{child,input,output,next:1}),
            _=>{let _=child.kill().await;let _=child.wait().await;Err(error("library_unavailable","Library helper failed its handshake."))}
        }
    }
    async fn disconnect(state:&mut State) {
        if let Some(mut old)=state.connection.take(){let _=old.child.kill().await;let _=old.child.wait().await;}
        for library in state.libraries.values_mut(){library.handle=None;}
    }
    async fn exchange(state:&mut State,method:&str,params:Value)->Result<Value,Value>{
        let conn=state.connection.as_mut().unwrap();
        let id=conn.next;conn.next+=1;
        let mut bytes=serde_json::to_vec(&json!({"id":id,"method":method,"params":params})).map_err(|e|error("invalid_params",e))?;
        if bytes.len()>4*1024*1024{return Err(error("invalid_params","Library request exceeds 4 MiB"));}
        bytes.push(b'\n');
        let result=tokio::time::timeout(Duration::from_secs(180),async {
            conn.input.write_all(&bytes).await.map_err(|e|error("library_io",e))?;
            conn.input.flush().await.map_err(|e|error("library_io",e))?;
            let reply=line(&mut conn.output).await?;
            if reply["id"]!=id{return Err(error("library_protocol","Mismatched library reply"));}
            Ok(reply)
        }).await;
        match result {
            Ok(Ok(reply))=>if let Some(e)=reply.get("error"){Err(e.clone())}else{Ok(reply["result"].clone())},
            other=>{
                Self::disconnect(state).await;
                Err(match other {Ok(Err(e))=>e,_=>error("library_timeout","Library operation timed out. Refresh to inspect its saved state.")})
            }
        }
    }
    pub async fn request(&self,method:&str,mut params:Value)->Result<Value,Value>{
        if !(method.starts_with("sdk.")||method.starts_with("library.")||method.starts_with("capture_one.")||method.starts_with("images.")||method=="image.get"||method.starts_with("collections.")||method.starts_with("collection.")||method.starts_with("locations.")||method=="location.relink"||method.starts_with("edit.")||method=="meta.set"||method=="variant.create"||method.starts_with("folders.")||method.starts_with("session.")) {
            return Err(error("invalid_params","Not a library SDK method"));
        }
        if !params.is_object(){return Err(error("invalid_params","Expected an object"));}
        let mut state=self.state.lock().await;
        if state.connection.as_mut().is_some_and(|conn| conn.child.try_wait().ok().flatten().is_some()) {Self::disconnect(&mut state).await;}
        if state.connection.is_none(){state.connection=Some(self.connect().await?);}
        let logical=params.get("library").and_then(Value::as_str).map(str::to_owned);
        if let Some(key)=&logical {
            let library=state.libraries.get(key).ok_or_else(||error("invalid_params","Library is closed or unknown"))?;
            let handle=if let Some(handle)=&library.handle {handle.clone()} else {
                let path=library.path.clone();
                let opened=Self::exchange(&mut state,"library.open",json!({"path":path})).await?;
                let handle=opened["library"].clone();
                state.libraries.get_mut(key).unwrap().handle=Some(handle.clone());
                handle
            };
            params["library"]=handle;
        }
        // Never retry an interrupted operation. Only the next explicit request
        // reopens its library; edit.put still carries the original base revision.
        let mut result=Self::exchange(&mut state,method,params).await?;
        if method=="library.close" {
            if let Some(key)=logical {state.libraries.remove(&key);}
        } else if result.get("library").is_some() && result["info"]["path"].is_string() {
            state.next_library+=1;
            let key=format!("W{}",state.next_library);
            state.libraries.insert(key.clone(),Library{path:result["info"]["path"].clone(),handle:Some(result["library"].clone())});
            result["library"]=json!(key);
        }
        Ok(result)
    }
    pub async fn shutdown(&self){
        Self::disconnect(&mut *self.state.lock().await).await;
    }
    pub async fn recycle_trash(&self,library:&str)->Result<Value,Value>{
        let plan=self.request("session.trash.plan",json!({"library":library})).await?;
        let files=plan["files"].as_array().ok_or_else(||error("library_protocol","Invalid trash plan"))?;
        let mut removed=Vec::new(); let mut failed=Vec::new();
        for file in files {
            let Some(path)=file["path"].as_str() else {continue};
            let owned=path.to_owned();
            let result=tokio::task::spawn_blocking(move||recycle_file(&owned)).await.map_err(|e|error("library_io",e))?;
            match result {Ok(())=>removed.push(path.to_owned()),Err(message)=>failed.push(json!({"path":path,"message":message}))}
        }
        let committed=self.request("session.trash.commit",json!({"library":library,"removed_paths":removed})).await?;
        Ok(json!({"dropped":committed["dropped"],"refused":committed["refused"],"failed":failed}))
    }
}

#[cfg(windows)]
fn recycle_file(path:&str)->Result<(),String>{
    use windows::{core::HSTRING, Win32::{System::Com::{CoInitializeEx,CoUninitialize,CoCreateInstance,COINIT_APARTMENTTHREADED,CLSCTX_INPROC_SERVER},
        UI::Shell::{IFileOperation,IShellItem,FileOperation,SHCreateItemFromParsingName,FOFX_RECYCLEONDELETE,FOFX_EARLYFAILURE,FOF_ALLOWUNDO,FOF_NOCONFIRMATION,FOF_NOERRORUI,FOF_SILENT}}};
    // A session trash plan names individual files. Never recurse into folders
    // or follow links; the SDK commits only paths which actually disappeared.
    // SDK paths use forward slashes; Shell parsing requires Windows separators.
    let path=path.replace('/',"\\");
    if !std::fs::symlink_metadata(&path).map_err(|e|e.to_string())?.file_type().is_file(){return Err("Only regular session files can be recycled".into());}
    struct Com; impl Drop for Com {fn drop(&mut self){unsafe{CoUninitialize()}}}
    unsafe {
        CoInitializeEx(None,COINIT_APARTMENTTHREADED).ok().map_err(|e|e.to_string())?;
        let _com=Com;
        let operation:IFileOperation=CoCreateInstance(&FileOperation,None,CLSCTX_INPROC_SERVER).map_err(|e|e.to_string())?;
        operation.SetOperationFlags(FOFX_RECYCLEONDELETE|FOFX_EARLYFAILURE|FOF_ALLOWUNDO|FOF_NOCONFIRMATION|FOF_NOERRORUI|FOF_SILENT).map_err(|e|e.to_string())?;
        let item:IShellItem=SHCreateItemFromParsingName(&HSTRING::from(&path),None).map_err(|e|format!("Open Shell item: {e}"))?;
        operation.DeleteItem(&item,None).map_err(|e|e.to_string())?;
        operation.PerformOperations().map_err(|e|e.to_string())?;
        if operation.GetAnyOperationsAborted().map_err(|e|e.to_string())?.as_bool() || std::path::Path::new(&path).exists() {
            return Err("Windows did not move this file to the Recycle Bin".into());
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn recycle_file(_path:&str)->Result<(),String>{Err("System Recycle Bin is currently available on Windows only".into())}

pub fn program()->PathBuf{
    let name=if cfg!(windows){"spklib-host.exe"}else{"spklib-host"};
    let beside=std::env::current_exe().unwrap_or_default().with_file_name(name);
    if beside.is_file(){return beside;}
    #[cfg(debug_assertions)] {
        let development=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../build/spklib-windows").join(name);
        if development.is_file(){return development;}
    }
    beside
}

#[cfg(test)] mod tests {
    use super::*;
    #[cfg(windows)]
    #[tokio::test]
    #[ignore="Requires SPKLIB_TEST_HOST; recycles only a generated temporary file"]
    async fn real_sdk_session_recycles_only_its_trash_files(){
        let root=std::env::temp_dir().join(format!("spk-recycle-test-{}",std::process::id()));
        let host=LibraryHost::new(PathBuf::from(std::env::var("SPKLIB_TEST_HOST").unwrap()),root.join("store"));
        let session=root.join("Session");
        let opened=host.request("library.create",json!({"path":session,"kind":"session","name":"Recycle fixture"})).await.unwrap();
        let handle=opened["library"].clone();
        let source=session.join("Capture").join("owned-recycle-fixture.ARW");
        std::fs::write(&source,b"SpektraLab generated recycle fixture; not a user photograph").unwrap();
        let added=host.request("images.add",json!({"library":handle,"mode":"reference","items":[source]})).await.unwrap();
        let image=added["results"][0]["image"].clone();
        host.request("session.move",json!({"library":handle,"images":[image],"to":"trash","on_conflict":"fail"})).await.unwrap();
        let plan=host.request("session.trash.plan",json!({"library":handle})).await.unwrap();
        assert_eq!(plan["files"].as_array().unwrap().len(),1);
        let file=plan["files"][0]["path"].as_str().unwrap();
        assert!(std::path::Path::new(file).exists());
        let report=host.recycle_trash(handle.as_str().unwrap()).await.unwrap();
        assert_eq!(report["dropped"],1,"{report}");
        assert!(report["failed"].as_array().unwrap().is_empty());
        assert!(!std::path::Path::new(file).exists());
        assert_eq!(host.request("images.list",json!({"library":handle})).await.unwrap()["total"],0);
        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore="Requires SPKLIB_TEST_HOST pointing at the built native SDK"]
    async fn real_sdk_unicode_persistence_and_revision_conflicts(){
        let path=std::env::temp_dir().join(format!("spk-library-rust-{}",std::process::id()));
        let host=LibraryHost::new(PathBuf::from(std::env::var("SPKLIB_TEST_HOST").expect("SPKLIB_TEST_HOST")),path.clone());
        let opened=host.request("library.create",json!({"path":path.join("中文图库.spkcatalog"),"kind":"catalog","name":"新疆"})).await.unwrap();
        let handle=opened["library"].clone();
        std::fs::write(path.join("照片 一.ARW"),b"owned SDK fixture").unwrap();
        let files=host.request("images.add",json!({"library":handle,"mode":"reference","items":[path.join("照片 一.ARW")]})).await.unwrap();
        let variant=files["results"][0]["variant"].clone();
        let saved=host.request("edit.put",json!({"library":handle,"variant":variant,"base_revision":0,"edit":{"exposure":1}})).await.unwrap();
        assert_eq!(saved["revision"],1);
        let conflict=host.request("edit.put",json!({"library":handle,"variant":variant,"base_revision":0,"edit":{}})).await.unwrap_err();
        assert_eq!(conflict["code"],"conflict");
        host.shutdown().await;
        let edit=host.request("edit.get",json!({"library":handle,"variant":variant})).await.unwrap();
        assert_eq!(edit["edit"]["exposure"],1);
        let conflict=host.request("edit.put",json!({"library":handle,"variant":variant,"base_revision":0,"edit":{}})).await.unwrap_err();
        assert_eq!(conflict["code"],"conflict");
        host.request("library.close",json!({"library":handle})).await.unwrap();
        assert!(host.request("library.info",json!({"library":handle})).await.is_err());
        host.shutdown().await;
        std::fs::remove_dir_all(path).unwrap();
    }
}
