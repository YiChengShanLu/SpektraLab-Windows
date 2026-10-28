import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Menu } from '@tauri-apps/api/menu';
import { tz } from '../i18n';
import { platform } from '../platform';
import { libraryStore } from '../library/model';
import { endGesture, flushSave, hasUnsavedEdits, sessionStore } from '../state/session';

export async function replaceAppMenu(menu: Menu) {
  const window = getCurrentWindow();
  const size = /Windows/i.test(navigator.userAgent) && !(await window.isMaximized()) && !(await window.isFullscreen())
    ? await window.innerSize() : null;
  const previous = await menu.setAsAppMenu();
  // Windows takes the first menu's height from the restored client area.
  // Keep that area's size, or each subsequent start loses another menu row.
  if (!previous && size) await window.setSize(size);
  await previous?.close();
}

/** Tauri awaits this handler before destroying the window. Browser
 * beforeunload cannot wait for asynchronous sidecar writes. */
export function installCloseGuard() {
  let pending = false;
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (pending) { event.preventDefault(); return; }
    pending = true;
    try {
      if (sessionStore.getState().batchExporting || libraryStore.getState().busy) {
        event.preventDefault();
        await platform().message(tz('Task in progress', '任务正在进行'),
          tz('Wait for the current export or library task to finish, or cancel it before closing.', '请等待当前导出或图库任务完成，或先取消任务再关闭窗口。'));
        return;
      }
      endGesture();
      await flushSave();
      if (hasUnsavedEdits() || sessionStore.getState().externalEditConflict) {
        event.preventDefault();
        await platform().message(tz('Edits not saved', '编辑尚未保存'),
          tz('Your edits are kept in this window. Resolve the saving error or external edit conflict before closing.', '当前修改已保留在窗口中。请先处理保存错误或外部编辑冲突，再关闭窗口。'), 'error');
      }
    } catch (error) {
      event.preventDefault();
      await platform().message(tz('Could not save before closing', '关闭前保存失败'), String(error), 'error');
    } finally { pending = false; }
  });
}
