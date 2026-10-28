# Build a frontend-only update against the exact previously verified native
# binaries. Full native rebuilds use build.ps1; do not use this after engine,
# SDK, dependency, or runtime changes.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$version = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$commit = (& git -C $root rev-parse HEAD).Trim()
$work = Join-Path $root 'build\ui-update'
$release = Join-Path $root 'build\release'
if (Test-Path -LiteralPath $work) { throw 'Use a fresh output directory for packaging' }
New-Item -ItemType Directory -Path $work,$release -Force | Out-Null
$archive = Join-Path $work 'base.zip'
Invoke-WebRequest 'https://github.com/YiChengShanLu/SpektraLab-Windows/releases/download/v1.3.2-windows/SpektraLab-Windows-x64-1.3.2.zip' -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '14d2ddfa26205d972482b3a361d6a98043b75b331cc1144e4a38ecc0bab5e56c') { throw 'Base release checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath $work
$base = Join-Path $work 'SpektraLab-Windows-x64-1.3.2'
$baseInfo = Get-Content -LiteralPath (Join-Path $base 'BUILD-INFO.json') -Raw | ConvertFrom-Json
if ($baseInfo.source_commit -ne '0a3daa65988bcb8fa9f5ada4641fad066ec77530') { throw 'Unexpected native source revision' }
& git -C $root diff --quiet $baseInfo.source_commit HEAD -- engine desktop/library-sdk desktop/src-tauri/src desktop/agent
if ($LASTEXITCODE) { throw 'Native changes require a full native build' }
# Ignore only this application's version; every dependency must match the
# binary release and its corresponding dependency-source archive exactly.
foreach ($file in @('desktop/src-tauri/Cargo.toml','desktop/src-tauri/Cargo.lock')) {
    $before = (& git -C $root show ($baseInfo.source_commit+':'+$file)) -join "`n"
    $after = [IO.File]::ReadAllText((Join-Path $root $file)).Replace("`r`n","`n")
    $pattern = '(?m)(^name = "spektralab"\nversion = ")[^"]+("\r?$)'
    if ([regex]::Replace($before,$pattern,'${1}APP${2}').Trim() -ne [regex]::Replace($after,$pattern,'${1}APP${2}').Trim()) { throw "Dependency changes in $file require a full build" }
}
foreach ($file in @('desktop/package.json','desktop/package-lock.json')) {
    $before = ConvertFrom-Json -AsHashtable -InputObject ((& git -C $root show ($baseInfo.source_commit+':'+$file)) -join "`n")
    $after = Get-Content -LiteralPath (Join-Path $root $file) -Raw | ConvertFrom-Json -AsHashtable
    $after['version'] = $before['version']
    if ($file.EndsWith('package-lock.json')) { $after['packages']['']['version'] = $before['packages']['']['version'] }
    if ((ConvertTo-Json -InputObject $before -Depth 100 -Compress) -cne (ConvertTo-Json -InputObject $after -Depth 100 -Compress)) { throw "Dependency changes in $file require a full build" }
}
$hostDir = Join-Path $root 'build\host-win-x64'
New-Item -ItemType Directory -Path $hostDir | Out-Null
Copy-Item -LiteralPath (Join-Path $base 'spektralab-host.exe') -Destination $hostDir
Copy-Item -LiteralPath (Join-Path $base 'host\engine') -Destination (Join-Path $hostDir 'engine') -Recurse
Copy-Item -LiteralPath (Join-Path $base 'licenses') -Destination (Join-Path $hostDir 'licenses') -Recurse
Get-ChildItem -LiteralPath $base -Filter '*.dll' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $hostDir }
Copy-Item -LiteralPath (Join-Path $root 'docs\WINDOWS.md') -Destination (Join-Path $hostDir 'README.md')
Copy-Item -LiteralPath (Join-Path $root 'CHANGELOG-Windows.md') -Destination (Join-Path $hostDir 'CHANGELOG.md')
Copy-Item -LiteralPath (Join-Path $base 'LICENSE.txt') -Destination $hostDir
$info = [ordered]@{version=$version;source_commit=$commit;source_dirty=$false;platform='windows-x64';engine=$baseInfo.engine;runtime_files=$baseInfo.runtime_files;native_source_commit=$baseInfo.source_commit;native_release='v1.3.2-windows'}
$info | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $hostDir 'BUILD-INFO.json') -Encoding utf8NoBOM
$env:SPEKTRALAB_LIBRARY_HOST = Join-Path $base 'spklib-host.exe'
$env:SPEKTRALAB_NODE_RUNTIME = (Get-Command node).Source
Push-Location (Join-Path $root 'desktop')
try { & node scripts/package.mjs win; if ($LASTEXITCODE) { throw 'Windows packaging failed' } }
finally { Pop-Location }
$name = 'SpektraLab-Windows-x64-'+$version
$portable = Join-Path $release $name
Copy-Item -LiteralPath $base -Destination $portable -Recurse
Copy-Item -LiteralPath (Join-Path $root 'desktop\src-tauri\target\release\spektralab.exe') -Destination (Join-Path $portable 'spektralab.exe') -Force
foreach ($file in @('README.md','CHANGELOG.md','LICENSE.txt','BUILD-INFO.json')) { Copy-Item -LiteralPath (Join-Path $hostDir $file) -Destination (Join-Path $portable $file) -Force }
Copy-Item -LiteralPath (Join-Path $root 'desktop\src-tauri\host-staging\agents') -Destination $portable -Recurse -Force
$manifest = [ordered]@{}
Get-ChildItem -LiteralPath $portable -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($portable.Length+1).Replace('\','/')
    if ($relative -ne 'FILE-SHA256.json') { $manifest[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $portable 'FILE-SHA256.json') -Encoding utf8NoBOM
Compress-Archive -LiteralPath $portable -DestinationPath (Join-Path $release ($name+'.zip')) -CompressionLevel Optimal
Copy-Item -LiteralPath (Join-Path $root ('desktop\release\windows\SpektraLab_'+$version+'_x64-setup.exe')) -Destination (Join-Path $release ($name+'-setup.exe'))
& git -C $root archive --format=tar.gz ('--prefix=SpektraLab-Windows-'+$version+'/') -o (Join-Path $release ('SpektraLab-Windows-'+$version+'-source.tar.gz')) HEAD
if ($LASTEXITCODE) { throw 'Source archive failed' }
$hashes = Get-ChildItem -LiteralPath $release -File | Sort-Object Name | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name }
$hashes | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding ascii
