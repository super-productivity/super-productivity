// Types for Super Productivity Plugin API
// This package provides TypeScript types for developing plugins

import {
  IssueProviderManifestConfig,
  IssueProviderPluginDefinition,
} from './issue-provider-types';

export interface PluginMenuEntryCfg {
  pluginId: string;
  label: string;
  icon?: string;
  onClick: () => void;
}

export enum PluginHooks {
  TASK_CREATED = 'taskCreated',
  TASK_COMPLETE = 'taskComplete',
  TASK_UPDATE = 'taskUpdate',
  TASK_DELETE = 'taskDelete',
  CURRENT_TASK_CHANGE = 'currentTaskChange',
  FINISH_DAY = 'finishDay',
  LANGUAGE_CHANGE = 'languageChange',
  PERSISTED_DATA_CHANGED = 'persistedDataChanged',
  ACTION = 'action',
  ANY_TASK_UPDATE = 'anyTaskUpdate',
  PROJECT_LIST_UPDATE = 'projectListUpdate',
  WORK_CONTEXT_CHANGE = 'workContextChange',
}

export type Hooks = PluginHooks;

export interface PluginBaseCfg {
  theme: 'light' | 'dark';
  appVersion: string;
  platform: 'web' | 'desktop' | 'android' | 'ios';
  isDev: boolean;
  lang?: {
    code: string;
    [key: string]: unknown;
  };
}

export interface DialogButtonCfg {
  label: string;
  icon?: string;
  onClick?: () => void | Promise<void>;
  color?: 'primary' | 'warn';
  raised?: boolean;
}

export type DialogResult = string | undefined;

export interface DialogCfg {
  title?: string;
  htmlContent?: string;
  content?: string;
  okBtnLabel?: string;
  cancelBtnLabel?: string;
  buttons?: DialogButtonCfg[];
}

export interface SnackCfg {
  msg: string;
  type?: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
  ico?: string;
}

export type SnackCfgLimited = SnackCfg;

export interface NotifyCfg {
  title: string;
  body: string;
}

export interface PluginNodeScriptConfig {
  allowedPaths?: string[]; // Specific paths the script can access
  timeout?: number; // Default timeout in milliseconds for scripts
  memoryLimit?: string; // Default memory limit (e.g., '128MB', '256MB')
}

export interface PluginNodeScriptRequest {
  script: string;
  timeout?: number;
  args?: unknown[];
}

export interface PluginNodeScriptError {
  code:
    | 'TIMEOUT'
    | 'MEMORY_LIMIT'
    | 'SCRIPT_ERROR'
    | 'PERMISSION_DENIED'
    | 'INVALID_SCRIPT'
    | 'NO_CONSENT';
  message: string;
  details?: {
    line?: number;
    column?: number;
    scriptSnippet?: string;
  };
}

export interface PluginNodeScriptResult {
  success: boolean;
  result?: unknown;
  error?: string | PluginNodeScriptError;
  executionTime?: number;
  resourceUsage?: {
    peakMemoryMB?: number;
    cpuTime?: number;
  };
}

export interface PluginManifest {
  name: string;
  id: string;
  manifestVersion: number;
  version: string;
  minSupVersion: string;
  description?: string;
  hooks: Hooks[];
  permissions: string[];
  iFrame?: boolean;
  isSkipMenuEntry?: boolean;
  type?: 'standard' | 'issueProvider';
  assets?: string[];
  issueProvider?: IssueProviderManifestConfig;
  icon?: string; // Path to SVG icon file relative to plugin root
  nodeScriptConfig?: PluginNodeScriptConfig;
  sidePanel?: boolean; // If true, plugin loads in right panel instead of route
  uiKit?: boolean; // If false, skip injecting the UI kit CSS reset. Defaults to true.
  jsonSchemaCfg?: string; // Path to JSON schema file for plugin configuration relative to plugin root
  i18n?: {
    languages: string[]; // Array of supported language codes (e.g., ['en', 'de', 'fr'])
  };
}

// Hook payload types
export interface TaskCreatedPayload {
  taskId: string;
  task: Task;
}

export interface TaskCompletePayload {
  taskId: string;
  task: Task;
}

export interface TaskUpdatePayload {
  taskId: string;
  task: Task;
  changes: Partial<Task>;
}

export interface TaskDeletePayload {
  taskId: string;
}

export interface CurrentTaskChangePayload {
  current: Task | null;
  previous: Task | null;
}

export interface FinishDayPayload {
  date: string;
}

export interface LanguageChangePayload {
  code: string;
  newLanguage: string;

  [key: string]: unknown;
}

export interface ActionPayload {
  action: string;
  payload?: unknown;
}

export interface AnyTaskUpdatePayload {
  action: string;
  taskId?: string;
  task?: Task;
  changes?: Partial<Task>;
}

export interface ProjectListUpdatePayload {
  action: string;
  projectId?: string;
  project?: Project;
  changes?: Partial<Project>;
}

/**
 * Snapshot of the active work context (project or tag).
 * Used by getActiveWorkContext() and as the WORK_CONTEXT_CHANGE payload.
 *
 * **`taskIds` is a snapshot at the moment of emission**, not a live view.
 * It goes stale as soon as a task is added, removed, or moved. Plugins
 * that need the current ordering should call `getActiveWorkContext()` /
 * `getTasks()` on demand or subscribe to `ANY_TASK_UPDATE` for changes.
 */
export interface ActiveWorkContext {
  id: string;
  /**
   * `'TODAY'` is reported for the special Today tag (whose `id` is also
   * `'TODAY'`); every other tag is `'TAG'`. This matches the vocabulary of
   * {@link PluginWorkContextHeaderBtnCfg.showFor}.
   */
  type: 'PROJECT' | 'TAG' | 'TODAY';
  title: string;
  /**
   * An independent copy taken at emit time — safe to read, and mutating it
   * has no effect on the app. See the {@link ActiveWorkContext} note above.
   */
  taskIds: string[];
}

/**
 * Payload of the WORK_CONTEXT_CHANGE hook, fired when the user switches
 * between projects/tags. A context is always active while the app is
 * running, so the payload is never null.
 *
 * The included `taskIds` is a snapshot — re-read via `getActiveWorkContext()`
 * if you care about the current order/membership.
 */
export type WorkContextChangePayload = ActiveWorkContext;

// Map hook types to their payload types
export interface HookPayloadMap {
  [PluginHooks.TASK_CREATED]: TaskCreatedPayload;
  [PluginHooks.TASK_COMPLETE]: TaskCompletePayload;
  [PluginHooks.TASK_UPDATE]: TaskUpdatePayload;
  [PluginHooks.TASK_DELETE]: TaskDeletePayload;
  [PluginHooks.CURRENT_TASK_CHANGE]: CurrentTaskChangePayload;
  [PluginHooks.FINISH_DAY]: FinishDayPayload;
  [PluginHooks.LANGUAGE_CHANGE]: LanguageChangePayload;
  [PluginHooks.PERSISTED_DATA_CHANGED]: void;
  [PluginHooks.ACTION]: ActionPayload;
  [PluginHooks.ANY_TASK_UPDATE]: AnyTaskUpdatePayload;
  [PluginHooks.PROJECT_LIST_UPDATE]: ProjectListUpdatePayload;
  [PluginHooks.WORK_CONTEXT_CHANGE]: WorkContextChangePayload;
}

// Generic hook handler with typed payload
export type PluginHookHandler<T extends Hooks = Hooks> = (
  payload: T extends keyof HookPayloadMap ? HookPayloadMap[T] : unknown,
) => void | Promise<void>;

// Core data types - Single source of truth for both plugins and app
export interface Task {
  id: string;
  title: string;
  notes?: string;
  timeEstimate: number;
  timeSpent: number;
  isDone: boolean;
  projectId: string | null;
  tagIds: string[];
  parentId?: string | null;
  created: number;
  updated?: number;
  subTaskIds: string[];

  // Additional fields for internal use (plugins can read but shouldn't modify)
  timeSpentOnDay?: { [key: string]: number };
  doneOn?: number | null;
  attachments?: any[];
  remindAt?: number | null;
  dueDay?: string | null;
  dueWithTime?: number | null;
  repeatCfgId?: string | null;

  // Issue tracking fields (optional)
  issueId?: string | null;
  issueProviderId?: string | null;
  issueType?: any | null; // IssueProviderKey in app
  issueWasUpdated?: boolean;
  issueLastUpdated?: number | null;
  issueAttachmentNr?: number;
  issuePoints?: number | null;

  // UI state (internal)
  _hideSubTasksMode?: number;
}

export interface ProjectFolder {
  id: string;
  title: string;
  icon?: string | null;
  parentId?: string | null;
  isExpanded?: boolean;
  created: number;
  updated?: number;
}

export interface Project {
  id: string;
  title: string;
  theme: {
    primary?: string;
    isAutoContrast?: boolean;
    [key: string]: unknown;
  };
  isArchived?: boolean;
  created?: number;
  updated?: number;
  taskIds: string[];
  backlogTaskIds: string[];
  noteIds: string[];
  isEnableBacklog?: boolean;
  isHiddenFromMenu?: boolean;
  folderId?: string | null;

  // Advanced config (internal) - must be any to match WorkContextCommon
  advancedCfg: unknown;
  icon?: string | null;
}

export interface Tag {
  id: string;
  title: string;
  color?: string | null;
  created: number;
  updated?: number;
  taskIds: string[];
  icon?: string | null;

  // Advanced config (internal) - must be any to match WorkContextCommon
  theme: unknown;
  advancedCfg: unknown;
}

// Legacy aliases for backward compatibility
/** @deprecated Use Task instead */
export type TaskData = Task;
/** @deprecated Use Task instead */
export type TaskCopy = Task;

/** @deprecated Use Project instead */
export type ProjectData = Project;
/** @deprecated Use Project instead */
export type ProjectCopy = Project;

/** @deprecated Use Tag instead */
export type TagData = Tag;
/** @deprecated Use Tag instead */
export type TagCopy = Tag;

export interface PluginHeaderBtnCfg {
  pluginId: string;
  label: string;
  icon?: string;
  onClick: () => void;
  color?: 'primary' | 'accent' | 'warn';
}

export interface PluginSidePanelBtnCfg {
  pluginId: string;
  label: string;
  icon?: string;
  onClick: () => void;
}

/**
 * Header button that is only rendered when the active work context matches
 * one of the entries in `showFor`. `'TODAY'` refers to the special TODAY tag.
 */
export interface PluginWorkContextHeaderBtnCfg {
  pluginId: string;
  label: string;
  icon?: string;
  onClick: (ctx: ActiveWorkContext) => void;
  showFor: ('PROJECT' | 'TAG' | 'TODAY')[];
}

export interface OAuthFlowConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  /**
   * NOT kept confidential — this value is embedded in plugin source code,
   * persisted in user data, and may be synced to cloud backends.
   * Only use for OAuth providers that document their "client secret" as
   * non-confidential (e.g., Google installed-app credentials per RFC 8252).
   */
  clientSecret?: string;
  /**
   * Client ID for Android (authenticates via package name + SHA-1 signing key).
   * Overrides `clientId` on Android and omits `clientSecret`.
   * Requires "Custom URI scheme" enabled in Google Cloud Console.
   */
  mobileClientId?: string;
  /**
   * Client ID for iOS (authenticates via bundle ID).
   * Overrides `clientId` on iOS and omits `clientSecret`.
   * Requires "Custom URI scheme" enabled in Google Cloud Console.
   */
  iosClientId?: string;
  /**
   * Client ID for the web build, for providers that support public browser
   * clients via Authorization Code + PKCE without a client secret.
   * Overrides `clientId` in the browser (non-Electron, non-native) and omits
   * `clientSecret`.
   */
  webClientId?: string;
  scopes: string[];
  /** Additional query parameters to append to the authorization URL (e.g. access_type, prompt). */
  extraAuthParams?: Record<string, string>;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

export interface PluginNote {
  id: string;
  projectId: string | null;
  isPinnedToToday: boolean;
  content: string;
  imgUrl?: string;
  backgroundColor?: string;
  created: number;
  modified: number;
}

export interface PluginTaskRepeatCfg {
  id: string;
  projectId: string | null;
  title: string | null;
  tagIds: string[];
  isPaused: boolean;
  repeatCycle: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  repeatEvery: number;
  startDate?: string;
  startTime?: string;
  defaultEstimate?: number;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  lastTaskCreationDay?: string;
  quickSetting?: string;
  remindAt?: string;
}

export interface PluginSimpleCounterFull {
  id: string;
  title: string;
  type: string;
  isEnabled: boolean;
  isOn?: boolean;
  countOnDay: { [day: string]: number };
}

export interface PluginAppState {
  readonly tasks: Readonly<{ [id: string]: Readonly<Task> }>;
  readonly projects: Readonly<{ [id: string]: Readonly<Project> }>;
  readonly tags: Readonly<{ [id: string]: Readonly<Tag> }>;
  readonly notes: Readonly<{ [id: string]: Readonly<PluginNote> }>;
  readonly taskRepeatCfgs: Readonly<{ [id: string]: Readonly<PluginTaskRepeatCfg> }>;
  readonly simpleCounters: Readonly<{
    [id: string]: Readonly<PluginSimpleCounterFull>;
  }>;
  readonly globalConfig: Readonly<Record<string, unknown>>;
}

export interface PluginAPI {
  cfg: PluginBaseCfg;
  readonly Hooks: typeof PluginHooks;

  registerHook<T extends Hooks>(hook: T, fn: PluginHookHandler<T>): void;

  registerHeaderButton(headerBtnCfg: Omit<PluginHeaderBtnCfg, 'pluginId'>): void;

  registerMenuEntry(menuEntryCfg: Omit<PluginMenuEntryCfg, 'pluginId'>): void;

  registerConfigHandler(handler: () => void): void;

  registerShortcut(
    shortcutCfg: Omit<PluginShortcutCfg, 'pluginId'> & { id?: string },
  ): void;

  registerSidePanelButton(sidePanelBtnCfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>): void;

  /**
   * Register a header button that is only visible when the active work
   * context matches one of the entries in `showFor`. The handler receives a
   * snapshot of the active context.
   *
   * Register this from your plugin's main script — not from an embedded
   * `index.html` — so the button and its handler outlive any work-view embed
   * the button toggles. A button registered from an embed iframe stops
   * working once that embed is closed.
   */
  registerWorkContextHeaderButton(
    cfg: Omit<PluginWorkContextHeaderBtnCfg, 'pluginId'>,
  ): void;

  registerIssueProvider(definition: IssueProviderPluginDefinition): void;

  /**
   * Returns the currently active project or tag. The TODAY tag has id
   * `'TODAY'`. A context stays active even on non-work-view routes (e.g. a
   * settings page) — it is the last one the user opened. Resolves to null
   * only if the app has not finished its initial data load.
   */
  getActiveWorkContext(): Promise<ActiveWorkContext | null>;

  /**
   * Mount this plugin's index.html inside the work-view body, in place of
   * the task list.
   *
   * The embed is shown **only while the active context is a project or the
   * TODAY tag**. For any other context (a regular tag, or a non-work-view
   * route) it is a silent no-op — nothing renders and no error is raised.
   * The embed automatically hides and reappears as the user navigates in
   * and out of eligible contexts; the request stays armed until
   * `closeWorkContextView` is called. To check whether a call will take
   * effect right now, read `getActiveWorkContext()` first.
   *
   * Call `closeWorkContextView` to revert to the normal task-list view.
   */
  showInWorkContext(): void;

  /**
   * Revert the work-view body to the normal task list. No-op unless this
   * plugin currently owns the embed.
   */
  closeWorkContextView(): void;

  // readiness signal — register a callback to run after the app confirms all
  // declared APIs (e.g. nodeExecution IPC bridge) are available. Put startup
  // init code here instead of at the top level of plugin.js. Optional so older
  // plugin API typings remain assignable; the host always provides it.
  onReady?(fn: () => void | Promise<void>): void;

  // teardown signal — register a callback the host invokes when the plugin is
  // disabled, reloaded, or uninstalled. Code-based plugins run directly in the
  // renderer, so timers/listeners they create survive unload unless cleared
  // here (clearInterval, removeEventListener, speechSynthesis.cancel, …).
  // The returned promise is NOT awaited — do synchronous cleanup before any
  // await. In iframe plugins this is a no-op: the iframe is unmounted on
  // unload and takes its timers with it. Registering again replaces the
  // previous callback. Optional so older plugin API typings remain assignable;
  // the host always provides it.
  onUnload?(fn: () => void | Promise<void>): void;

  // cross-process communication
  onMessage?(handler: (message: unknown) => Promise<unknown> | unknown): void;

  // ui bridge
  showSnack(snackCfg: SnackCfg): void;

  notify(notifyCfg: NotifyCfg): Promise<void>;

  showIndexHtmlAsView(): void;

  openDialog(dialogCfg: DialogCfg): Promise<DialogResult>;

  // tasks
  getTasks(): Promise<Task[]>;

  getArchivedTasks(): Promise<Task[]>;

  getCurrentContextTasks(): Promise<Task[]>;

  /**
   * Returns a complete read-only snapshot of the application state including
   * tasks, projects, tags, notes, task repeat configurations, simple counters
   * and global config. The snapshot is taken at the moment of the call and
   * does not update reactively.
   */
  getAppState(): Promise<PluginAppState>;

  /**
   * Select a task, opening its detail panel in the app's right-hand panel.
   * Works regardless of the active view — including while a plugin embed
   * occupies the work-view body. Accepts a task or subtask id.
   */
  selectTask(taskId: string): Promise<void>;

  reInitData(): Promise<void>;
  updateTask(taskId: string, updates: Partial<Task>): Promise<void>;

  addTask(taskData: PluginCreateTaskData): Promise<string>;

  deleteTask(taskId: string): Promise<void>;

  batchUpdateForProject(request: BatchUpdateRequest): Promise<BatchUpdateResult>;

  // projects
  getAllProjects(): Promise<Project[]>;

  addProject(projectData: Partial<Project>): Promise<string>;

  updateProject(projectId: string, updates: Partial<Project>): Promise<void>;

  // tags
  getAllTags(): Promise<Tag[]>;

  addTag(tagData: Partial<Tag>): Promise<string>;

  updateTag(tagId: string, updates: Partial<Tag>): Promise<void>;

  // task ordering
  reorderTasks(
    taskIds: string[],
    contextId: string,
    contextType: 'project' | 'task',
  ): Promise<void>;

  // logging
  log: {
    critical: (...args: unknown[]) => void;
    err: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    verbose: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    normal: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };

  // persistence
  //
  // The optional `key` splits a plugin's synced data into multiple
  // independently-LWW-resolved entries. Calls without a key target the
  // legacy single-blob entry. `key` must not contain ':' beyond what the
  // plugin chooses (the host reserves ':' only as the pluginId/key
  // delimiter and only enforces that the pluginId itself is clean).
  // Empty-string keys are equivalent to omitting the argument.
  persistDataSynced(dataStr: string, key?: string): Promise<void>;

  loadSyncedData(key?: string): Promise<string | null>;

  getConfig<T = Record<string, unknown>>(): Promise<T | null>;

  // i18n
  translate(key: string, params?: Record<string, string | number>): string;

  formatDate(
    date: Date | string | number,
    format: 'short' | 'medium' | 'long' | 'time' | 'datetime',
  ): string;

  getCurrentLanguage(): string;

  // oauth
  startOAuthFlow(config: OAuthFlowConfig): Promise<OAuthTokenResult>;

  getOAuthToken(): Promise<string | null>;

  clearOAuthToken(): Promise<void>;

  // download file
  downloadFile(filename: string, data: string): Promise<void>;

  // node execution (Electron desktop only; currently grantable only to packaged
  // built-in plugins with nodeExecution permission after main-process user consent)
  executeNodeScript?(request: PluginNodeScriptRequest): Promise<PluginNodeScriptResult>;

  // action execution - dispatch NgRx actions (limited to allowed subset)
  dispatchAction(action: { type: string; [key: string]: unknown }): void;

  // window state
  isWindowFocused(): boolean;

  onWindowFocusChange?(handler: (isFocused: boolean) => void): void;

  // simple counters
  setCounter(id: string, value: number): Promise<void>;

  getCounter(id: string): Promise<number | null>;

  incrementCounter(id: string, incrementBy?: number): Promise<number>;

  decrementCounter(id: string, decrementBy?: number): Promise<number>;

  deleteCounter(id: string): Promise<void>;

  getAllCounters(): Promise<{ [id: string]: number }>;
}

export interface PluginInstance {
  manifest: PluginManifest;
  loaded: boolean;
  isEnabled: boolean;
  error?: string;
}

export interface PluginHookHandlerRegistration<T extends Hooks = Hooks> {
  pluginId: string;
  hook: T;
  handler: PluginHookHandler<T>;
}

export interface PluginCreateTaskData {
  title: string;
  projectId?: string | null;
  tagIds?: string[];
  notes?: string;
  timeEstimate?: number;
  parentId?: string | null;
  isDone?: boolean;
  /** Due date as ISO date string (YYYY-MM-DD) */
  dueDay?: string | null;
}

export interface PluginShortcutCfg {
  pluginId: string;
  id: string;
  label: string;
  onExec: () => void;
}

export interface BatchTaskCreate {
  type: 'create';
  tempId: string; // Temporary ID to reference in other operations
  data: {
    title: string;
    notes?: string;
    isDone?: boolean;
    parentId?: string | null; // Can reference tempId or existing task ID
    timeEstimate?: number;
  };
}

export interface BatchTaskUpdate {
  type: 'update';
  taskId: string; // Existing task ID
  updates: {
    title?: string;
    notes?: string;
    isDone?: boolean;
    parentId?: string | null;
    timeEstimate?: number;
    subTaskIds?: string[];
  };
}

export interface BatchTaskDelete {
  type: 'delete';
  taskId: string; // Existing task ID
}

export interface BatchTaskReorder {
  type: 'reorder';
  taskIds: string[]; // Can include tempIds for newly created tasks
}

export type BatchOperation =
  | BatchTaskCreate
  | BatchTaskUpdate
  | BatchTaskDelete
  | BatchTaskReorder;

export interface BatchUpdateRequest {
  projectId: string;
  operations: BatchOperation[];
}

export interface BatchUpdateResult {
  success: boolean;
  // Map temporary IDs to actual created task IDs
  createdTaskIds: { [tempId: string]: string };
  errors?: BatchUpdateError[];
}

export interface BatchUpdateError {
  operationIndex: number;
  type:
    | 'VALIDATION_ERROR'
    | 'CIRCULAR_DEPENDENCY'
    | 'TASK_NOT_FOUND'
    | 'OUTSIDE_PROJECT'
    | 'UNKNOWN';
  message: string;
}

/**
 * Enum for plugin iframe message types - used for communication between
 * plugin iframes and the host application
 */
export enum PluginIframeMessageType {
  // API communication
  API_CALL = 'PLUGIN_API_CALL',
  API_RESPONSE = 'PLUGIN_API_RESPONSE',
  API_ERROR = 'PLUGIN_API_ERROR',

  // Hook events
  HOOK_EVENT = 'PLUGIN_HOOK_EVENT',

  // Dialog interaction
  DIALOG_BUTTON_CLICK = 'PLUGIN_DIALOG_BUTTON_CLICK',
  DIALOG_BUTTON_RESPONSE = 'PLUGIN_DIALOG_BUTTON_RESPONSE',

  // Work-context header button click forwarded to the iframe
  WORK_CONTEXT_BTN_CLICK = 'PLUGIN_WORK_CONTEXT_BTN_CLICK',

  // Message forwarding
  MESSAGE = 'PLUGIN_MESSAGE',
  MESSAGE_RESPONSE = 'PLUGIN_MESSAGE_RESPONSE',
  MESSAGE_ERROR = 'PLUGIN_MESSAGE_ERROR',

  // Plugin lifecycle
  READY = 'plugin-ready',
}

// Global PluginAPI interface for runtime use
// Note: This is commented out to avoid conflicts with node_modules version
// declare global {
//   interface Window {
//     PluginAPI: PluginAPI;
//   }
//
//   // For plugin development without window reference
//   const PluginAPI: PluginAPI;
// }
