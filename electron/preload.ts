import { ipcRenderer, IpcRendererEvent, webFrame, contextBridge } from 'electron';
import { ElectronAPI } from './electronAPI.d';
import { IPCEventValue } from './shared-with-frontend/ipc-events.const';
import { LocalBackupMeta } from '../src/app/imex/local-backup/local-backup.model';
import { SyncGetRevResult } from '../src/app/imex/sync/sync.model';
import {
  PluginManifest,
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
} from '../packages/plugin-api/src/types';

const _send: (channel: IPCEventValue, ...args: unknown[]) => void = (channel, ...args) =>
  ipcRenderer.send(channel, ...args);
const _invoke: (channel: IPCEventValue, ...args: unknown[]) => Promise<unknown> = (
  channel,
  ...args
) => ipcRenderer.invoke(channel, ...args);

const ea: ElectronAPI = {
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => {
    // NOTE: there is no proper way to unsubscribe apart from unsubscribing all
    ipcRenderer.on(channel, listener);
  },
  // INVOKE
  // ------
  getUserDataPath: () => _invoke('GET_PATH', 'userData') as Promise<string>,
  getBackupPath: () => _invoke('GET_BACKUP_PATH') as Promise<string>,
  checkBackupAvailable: () =>
    _invoke('BACKUP_IS_AVAILABLE') as Promise<false | LocalBackupMeta>,
  loadBackupData: (backupPath) =>
    _invoke('BACKUP_LOAD_DATA', backupPath) as Promise<string>,
  fileSyncGetRevAndClientUpdate: (backupPath) =>
    _invoke('FILE_SYNC_GET_REV_AND_CLIENT_UPDATE', backupPath) as Promise<
      { rev: string; clientUpdate?: number } | SyncGetRevResult
    >,
  fileSyncSave: (filePath) =>
    _invoke('FILE_SYNC_SAVE', filePath) as Promise<string | Error>,
  fileSyncLoad: (filePath) =>
    _invoke('FILE_SYNC_LOAD', filePath) as Promise<{
      rev: string;
      dataStr: string | undefined;
    }>,
  fileSyncRemove: (filePath) => _invoke('FILE_SYNC_REMOVE', filePath) as Promise<void>,
  fileSyncListFiles: ({ dirPath }) =>
    _invoke('FILE_SYNC_LIST_FILES', dirPath) as Promise<string[] | Error>,
  checkDirExists: (dirPath) =>
    _invoke('CHECK_DIR_EXISTS', dirPath) as Promise<true | Error>,

  pickDirectory: () => _invoke('PICK_DIRECTORY') as Promise<string | undefined>,

  // STANDARD
  // --------
  setZoomFactor: (zoomFactor: number) => {
    webFrame.setZoomFactor(zoomFactor);
  },
  getZoomFactor: () => webFrame.getZoomFactor(),
  isLinux: () => process.platform === 'linux',
  isMacOS: () => process.platform === 'darwin',
  isSnap: () => process && process.env && !!process.env.SNAP,
  isFlatpak: () => process && process.env && !!process.env.FLATPAK_ID,

  // SEND
  // ----
  relaunch: () => _send('RELAUNCH'),
  exit: () => _send('EXIT'),
  flashFrame: () => _send('FLASH_FRAME'),
  showOrFocus: () => _send('SHOW_OR_FOCUS'),
  lockScreen: () => _send('LOCK_SCREEN'),
  shutdownNow: () => _send('SHUTDOWN_NOW'),
  reloadMainWin: () => _send('RELOAD_MAIN_WIN'),
  openDevTools: () => _send('OPEN_DEV_TOOLS'),
  showEmojiPanel: () => _send('SHOW_EMOJI_PANEL'),
  informAboutAppReady: () => _send('APP_READY'),

  openPath: (path: string) => _send('OPEN_PATH', path),
  openExternalUrl: (url: string) => _send('OPEN_EXTERNAL', url),
  saveFileDialog: (filename: string, data: string) =>
    _invoke('SAVE_FILE_DIALOG', { filename, data }) as Promise<{
      success: boolean;
      path?: string;
    }>,
  shareNative: (payload: {
    text?: string;
    url?: string;
    title?: string;
    files?: string[];
  }) =>
    _invoke('SHARE_NATIVE', payload) as Promise<{
      success: boolean;
      error?: string;
    }>,
  scheduleRegisterBeforeClose: (id) => _send('REGISTER_BEFORE_CLOSE', { id }),
  unscheduleRegisterBeforeClose: (id) => _send('UNREGISTER_BEFORE_CLOSE', { id }),
  setDoneRegisterBeforeClose: (id) => _send('BEFORE_CLOSE_DONE', { id }),

  setProgressBar: (args) => _send('SET_PROGRESS_BAR', args),

  sendAppSettingsToElectron: (globalCfg) =>
    _send('TRANSFER_SETTINGS_TO_ELECTRON', globalCfg),
  sendSettingsUpdate: (globalCfg) => _send('UPDATE_SETTINGS', globalCfg),
  updateTitleBarDarkMode: (isDarkMode: boolean) =>
    _send('UPDATE_TITLE_BAR_DARK_MODE', isDarkMode),
  registerGlobalShortcuts: (keyboardCfg) =>
    _send('REGISTER_GLOBAL_SHORTCUTS', keyboardCfg),
  showFullScreenBlocker: (args) => _send('FULL_SCREEN_BLOCKER', args),

  makeJiraRequest: (args) => _send('JIRA_MAKE_REQUEST_EVENT', args),
  jiraSetupImgHeaders: (args) => _send('JIRA_SETUP_IMG_HEADERS', args),

  backupAppData: (appData) => _send('BACKUP', appData),

  updateCurrentTask: (
    task,
    isPomodoroEnabled,
    currentPomodoroSessionTime,
    isFocusModeEnabled?,
    currentFocusSessionTime?,
    focusModeMode?,
  ) =>
    _send(
      'CURRENT_TASK_UPDATED',
      task,
      isPomodoroEnabled,
      currentPomodoroSessionTime,
      isFocusModeEnabled,
      currentFocusSessionTime,
      focusModeMode,
    ),

  exec: (command: string) => _send('EXEC', command),

  // Plugin API
  pluginExecNodeScript: (
    pluginId: string,
    manifest: PluginManifest,
    request: PluginNodeScriptRequest,
  ) =>
    _invoke(
      'PLUGIN_EXEC_NODE_SCRIPT',
      pluginId,
      manifest,
      request,
    ) as Promise<PluginNodeScriptResult>,
};

// Expose ea to window for ipc-event.ts using contextBridge for context isolation
contextBridge.exposeInMainWorld('ea', ea);
