// This file is pulled into the frontend TS program (via src/app/core/window-ea.d.ts).
// That program sets `types: []`, so it has no ambient Node globals of its own and
// relied on the now-removed `import { IpcRendererEvent } from 'electron'` here to
// transitively supply them. Several frontend/shared modules still probe Node globals
// guarded at runtime (get-dist-channel's `process`/`NodeJS`, generate-client-id's
// `process`, create-task-placeholder's `NodeJS.Timeout`, user-profile's `require`),
// so re-expose them explicitly instead of by accident.
/// <reference types="node" />
import {
  GlobalConfigState,
  TakeABreakConfig,
  TaskWidgetConfig,
} from '../src/app/features/config/global-config.model';
import { KeyboardConfig } from './shared-with-frontend/keyboard-config.model';
import { AppDataCompleteLegacy } from '../src/app/imex/sync/sync.model';
import { Task } from '../src/app/features/tasks/task.model';
import { LocalBackupMeta } from '../src/app/imex/local-backup/local-backup.model';
import { AppDataComplete } from '../src/app/op-log/model/model-config';
import { PluginNodeExecutionElectronApi } from './shared-with-frontend/plugin-node-execution.model';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from './shared-with-frontend/local-rest-api.model';
import { ElectronDistChannel } from './shared-with-frontend/get-dist-channel';
import { JiraElectronApi } from './shared-with-frontend/jira-request.model';

export interface ElectronAPI {
  on(channel: string, listener: (...args: unknown[]) => void): void;

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
   * Opens the native folder picker for the sync folder. Prepare-only (#9075):
   * the pick is held main-side as a pending candidate and does NOT become the
   * live sync target until `commitPickedDirectory()` (settings Save).
   * Resolves to:
   * - `string`: the canonicalized candidate folder path (display only)
   * - `undefined`: the user cancelled the picker
   * - `Error`: the pick succeeded but main could not canonicalize/validate it
   *   (e.g. the folder was deleted right after picking, EACCES, or the
   *   folder lives inside the app's private dir). No candidate is stored in
   *   this case; the renderer must treat it as a failure, not a picked path.
   */
  pickDirectory(): Promise<string | Error | undefined>;

  /**
   * Persists the pending picked folder (see `pickDirectory`) as the live sync
   * target. Call from settings Save only. Resolves to:
   * - `{ path, isChanged }`: committed; `isChanged` is false when the user
   *   re-picked the folder that was already configured (callers must skip
   *   target-change invalidation in that case)
   * - `null`: no pending candidate (routine save without a pick) — a no-op
   * - `Error`: validation/persistence failed (e.g. folder deleted between
   *   pick and Save). The candidate is kept so a retry fails loudly instead
   *   of silently saving without the folder change.
   */
  commitPickedDirectory(): Promise<{ path: string; isChanged: boolean } | null | Error>;

  /**
   * Drops the pending picked folder without touching the live sync target.
   * Call when the settings UI closes without a save. No-op if nothing is
   * pending.
   */
  discardPickedDirectory(): Promise<void>;

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

  isGnomeWayland(): boolean;

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

  consumeJiraApi(): JiraElectronApi | null;

  consumePluginNodeExecutionApi(): PluginNodeExecutionElectronApi | null;

  // Plugin OAuth
  pluginOAuthPrepare(port?: number): Promise<{ port: number }>;
  pluginOAuthStart(url: string): void;
  onPluginOAuthCb(
    listener: (data: { code?: string; error?: string; state?: string }) => void,
  ): void;

  onLocalRestApiRequest(listener: (payload: LocalRestApiRequestPayload) => void): void;
  sendLocalRestApiResponse(payload: LocalRestApiResponsePayload): void;
}
