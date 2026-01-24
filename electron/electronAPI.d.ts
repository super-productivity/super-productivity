import { IpcRendererEvent } from 'electron';
import {
  GlobalConfigState,
  TakeABreakConfig,
} from '../src/app/features/config/global-config.model';
import { KeyboardConfig } from '../src/app/features/config/keyboard-config.model';
import { JiraCfg } from '../src/app/features/issue/providers/jira/jira.model';
import { AppDataCompleteLegacy, SyncGetRevResult } from '../src/app/imex/sync/sync.model';
import { Task } from '../src/app/features/tasks/task.model';
import { LocalBackupMeta } from '../src/app/imex/local-backup/local-backup.model';
import { AppDataComplete } from '../src/app/op-log/model/model-config';
import {
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
  PluginManifest,
} from '../packages/plugin-api/src/types';

export interface ElectronAPI {
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): void;

  // INVOKE
  // ------
  getUserDataPath(): Promise<string>;

  getBackupPath(): Promise<string>;

  checkBackupAvailable(): Promise<false | LocalBackupMeta>;

  loadBackupData(backupPath: string): Promise<string>;

  fileSyncGetRevAndClientUpdate(args: {
    filePath: string;
    localRev: string | null;
  }): Promise<{ rev: string; clientUpdate?: number } | SyncGetRevResult>;

  fileSyncSave(args: {
    filePath: string;
    localRev: string | null;
    dataStr: string;
  }): Promise<string | Error>;

  fileSyncLoad(args: {
    filePath: string;
    localRev: string | null;
  }): Promise<{ rev: string; dataStr: string | undefined } | Error>;

  fileSyncRemove(args: { filePath: string }): Promise<unknown | Error>;

  fileSyncListFiles(args: { dirPath: string }): Promise<string[] | Error>; // NEW

  checkDirExists(args: { dirPath: string }): Promise<true | Error>;

  pickDirectory(): Promise<string | undefined>;

  showOpenDialog(options: {
    properties: string[];
    title?: string;
    defaultPath?: string;
  }): Promise<string[] | undefined>;

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

  isMacOS(): boolean;

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

  backupAppData(appData: AppDataCompleteLegacy | AppDataComplete): void;

  updateCurrentTask(
    task: Task | null,
    isPomodoroEnabled: boolean,
    currentPomodoroSessionTime: number,
    isFocusModeEnabled?: boolean,
    currentFocusSessionTime?: number,
    focusModeMode?: string,
  );

  exec(command: string): void;

  pluginExecNodeScript(
    pluginId: string,
    manifest: PluginManifest,
    request: PluginNodeScriptRequest,
  ): Promise<PluginNodeScriptResult>;
}
