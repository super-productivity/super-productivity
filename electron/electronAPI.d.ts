import { IpcRendererEvent } from 'electron';
import {
  GlobalConfigState,
  TakeABreakConfig,
  TaskWidgetConfig,
} from '../src/app/features/config/global-config.model';
import { KeyboardConfig } from '../src/app/features/config/keyboard-config.model';
import { JiraCfg } from '../src/app/features/issue/providers/jira/jira.model';
import { AppDataCompleteLegacy } from '../src/app/imex/sync/sync.model';
import { Task } from '../src/app/features/tasks/task.model';
import { LocalBackupMeta } from '../src/app/imex/local-backup/local-backup.model';
import { AppDataComplete } from '../src/app/op-log/model/model-config';
import {
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
} from '../packages/plugin-api/src/types';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from './shared-with-frontend/local-rest-api.model';
import { ElectronDistChannel } from './shared-with-frontend/get-dist-channel';

export interface PluginNodeExecutionElectronApi {
  requestGrant(pluginId: string): Promise<{ token: string } | null>;
  executeScript(
    pluginId: string,
    grantToken: string,
    request: PluginNodeScriptRequest,
  ): Promise<PluginNodeScriptResult>;
  revokeGrant(pluginId: string, grantToken: string): Promise<void>;
}

export interface ElectronAPI {
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): void;

  // SYNC
  // ----
  getDistChannel(): ElectronDistChannel | null;

  // INVOKE
  // ------
  getUserDataPath(): Promise<string>;

  getBackupPath(): Promise<string>;

  checkBackupAvailable(): Promise<false | LocalBackupMeta>;

  loadBackupData(backupPath: string): Promise<string>;

  fileSyncSave(args: {
    relativePath: string;
    localRev: string | null;
    dataStr: string;
  }): Promise<string | Error>;

  fileSyncLoad(args: {
    relativePath: string;
    localRev: string | null;
  }): Promise<{ rev: string; dataStr: string | undefined } | Error>;

  fileSyncRemove(args: { relativePath: string }): Promise<unknown | Error>;

  fileSyncListFiles(args: { relativePath?: string }): Promise<string[] | Error>;

  checkDirExists(args: { relativePath?: string }): Promise<true | Error>;

  /**
   * Opens the native folder picker for the sync folder. Resolves to:
   * - `string`: the canonicalized, persisted folder path on success
   * - `undefined`: the user cancelled the picker
   * - `Error`: the pick succeeded but main could not canonicalize/persist it
   *   (e.g. the folder was deleted between pick and commit, EACCES, or the
   *   folder lives inside the app's private dir). Nothing is persisted in
   *   this case; the renderer must treat it as a failure, not a picked path.
   */
  pickDirectory(): Promise<string | Error | undefined>;

  /**
   * Returns the main-owned sync folder path for display, or null if not yet
   * configured. The renderer must not pass this value back to file-sync IPCs
   * — those take only the relative path; main resolves against its own copy.
   */
  getSyncFolderPath(): Promise<string | null>;

  showOpenDialog(options: {
    properties: string[];
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string[] | undefined>;

  /**
   * Open the native image picker, copy the chosen file into the main-owned
   * cache, and return an opaque id. The renderer never holds the absolute
   * path. Returns null when the user cancels and a safe Error when the picked
   * file fails validation/import. Old cached images are not deleted here,
   * because the surrounding config save may still fail or be cancelled.
   */
  imagePickAndImport(): Promise<{ id: string; mimeType: string } | null | Error>;

  /**
   * Resolve a cached image id to a `data:` URL the renderer can use as a
   * CSS background. Returns null when the id is unknown or the file
   * disappeared.
   */
  imageCacheGetDataUrl(id: string): Promise<string | null>;

  // checkDirExists(dirPath: string): Promise<true | Error>;

  // STANDARD
  // --------
  setZoomFactor(zoomFactor: number): void;

  getZoomFactor(): number;

  openPath(path: string): void;

  openExternalUrl(url: string): void;

  saveFileDialog(
    filename: string,
    data: string,
  ): Promise<{ success: boolean; path?: string }>;

  shareNative(payload: {
    text?: string;
    url?: string;
    title?: string;
    files?: string[];
  }): Promise<{ success: boolean; error?: string }>;

  isLinux(): boolean;

  isGnomeDesktop(): boolean;

  isMacOS(): boolean;

  isAppleSilicon(): boolean;

  isSnap(): boolean;

  isFlatpak(): boolean;

  // CLIPBOARD IMAGES
  // ----------------
  saveClipboardImage(
    basePath: string,
    fileName: string,
    base64Data: string,
    mimeType: string,
  ): Promise<string>;

  loadClipboardImage(
    basePath: string,
    imageId: string,
  ): Promise<{ base64: string; mimeType: string } | null>;

  deleteClipboardImage(basePath: string, imageId: string): Promise<boolean>;

  listClipboardImages(
    basePath: string,
  ): Promise<{ id: string; mimeType: string; createdAt: number; size: number }[]>;

  getClipboardImagePath(basePath: string, imageId: string): Promise<string | null>;

  getClipboardFilePaths(): Promise<string[]>;
  copyClipboardImageFile(
    basePath: string,
    filePath: string,
  ): Promise<{
    id: string;
    mimeType: string;
    size: number;
    createdAt: number;
  } | null>;

  readClipboardImage(basePath: string): Promise<{
    id: string;
    mimeType: string;
    size: number;
    createdAt: number;
  } | null>;

  getPathForFile(file: File): string | null;

  // SEND
  // ----
  reloadMainWin(): void;

  openDevTools(): void;

  showEmojiPanel(): void;

  relaunch(): void;

  exit(exitCode: number): void;

  shutdownNow(): void;

  flashFrame(): void;

  showOrFocus(): void;

  lockScreen(): void;

  informAboutAppReady(): void;

  scheduleRegisterBeforeClose(id: string): void;

  unscheduleRegisterBeforeClose(id: string): void;

  setDoneRegisterBeforeClose(id: string): void;

  setProgressBar(args: {
    progress: number;
    progressBarMode: 'normal' | 'pause' | 'none';
  }): void;

  sendAppSettingsToElectron(globalCfg: GlobalConfigState): void;

  sendSettingsUpdate(globalCfg: GlobalConfigState): void;

  updateTaskWidgetSettings(cfg: TaskWidgetConfig): void;

  updateTitleBarDarkMode(isDarkMode: boolean): void;

  registerGlobalShortcuts(keyboardConfig: KeyboardConfig): void;

  showFullScreenBlocker(args: { msg?: string; takeABreakCfg: TakeABreakConfig }): void;

  // TODO use invoke instead
  makeJiraRequest(args: {
    requestId: string;
    url: string;
    requestInit: RequestInit;
    jiraCfg: JiraCfg;
  }): void;

  jiraSetupImgHeaders(args: { jiraCfg: JiraCfg }): void;

  backupAppData(args: {
    data: AppDataCompleteLegacy | AppDataComplete;
    maxBackupFiles?: number | null;
  }): void;

  updateCurrentTask(
    task: Task | null,
    isPomodoroEnabled: boolean,
    currentPomodoroSessionTime: number,
    isFocusModeEnabled?: boolean,
    currentFocusSessionTime?: number,
    focusModeMode?: string,
  );

  updateTodayTasks(
    tasks: { id: string; title: string; timeEstimate: number; timeSpent: number }[],
  ): void;

  onSwitchTask(listener: (taskId: string) => void): void;

  exec(command: string): void;

  consumePluginNodeExecutionApi(): PluginNodeExecutionElectronApi | null;

  // Plugin OAuth
  pluginOAuthPrepare(): Promise<{ port: number }>;
  pluginOAuthStart(url: string): void;
  onPluginOAuthCb(
    listener: (data: { code?: string; error?: string; state?: string }) => void,
  ): void;

  onLocalRestApiRequest(listener: (payload: LocalRestApiRequestPayload) => void): void;
  sendLocalRestApiResponse(payload: LocalRestApiResponsePayload): void;
}
