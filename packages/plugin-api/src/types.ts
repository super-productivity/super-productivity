// Types for Super Productivity Plugin API
// This package provides TypeScript types for developing plugins

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
  PERSISTED_DATA_UPDATE = 'persistedDataUpdate',
  ACTION = 'action',
  ANY_TASK_UPDATE = 'anyTaskUpdate',
  PROJECT_LIST_UPDATE = 'projectListUpdate',
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
  onClick: () => void | Promise<void>;
  color?: 'primary' | 'warn';
}

export interface DialogCfg {
  htmlContent?: string;
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
  type?: 'standard';
  assets?: string[];
  icon?: string; // Path to SVG icon file relative to plugin root
  nodeScriptConfig?: PluginNodeScriptConfig;
  sidePanel?: boolean; // If true, plugin loads in right panel instead of route
  jsonSchemaCfg?: string; // Path to JSON schema file for plugin configuration relative to plugin root
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

  [key: string]: unknown;
}

export interface PersistedDataUpdatePayload {
  data: string;
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

// Map hook types to their payload types
export interface HookPayloadMap {
  [PluginHooks.TASK_CREATED]: TaskCreatedPayload;
  [PluginHooks.TASK_COMPLETE]: TaskCompletePayload;
  [PluginHooks.TASK_UPDATE]: TaskUpdatePayload;
  [PluginHooks.TASK_DELETE]: TaskDeletePayload;
  [PluginHooks.CURRENT_TASK_CHANGE]: CurrentTaskChangePayload;
  [PluginHooks.FINISH_DAY]: FinishDayPayload;
  [PluginHooks.LANGUAGE_CHANGE]: LanguageChangePayload;
  [PluginHooks.PERSISTED_DATA_UPDATE]: PersistedDataUpdatePayload;
  [PluginHooks.ACTION]: ActionPayload;
  [PluginHooks.ANY_TASK_UPDATE]: AnyTaskUpdatePayload;
  [PluginHooks.PROJECT_LIST_UPDATE]: ProjectListUpdatePayload;
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

export interface PluginAPI {
  cfg: PluginBaseCfg;

  registerHook<T extends Hooks>(hook: T, fn: PluginHookHandler<T>): void;

  registerHeaderButton(headerBtnCfg: Omit<PluginHeaderBtnCfg, 'pluginId'>): void;

  registerMenuEntry(menuEntryCfg: Omit<PluginMenuEntryCfg, 'pluginId'>): void;

  registerShortcut(
    shortcutCfg: Omit<PluginShortcutCfg, 'pluginId'> & { id?: string },
  ): void;

  registerSidePanelButton(sidePanelBtnCfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>): void;

  // cross-process communication
  onMessage?(handler: (message: unknown) => Promise<unknown> | unknown): void;

  // ui bridge
  showSnack(snackCfg: SnackCfg): void;

  notify(notifyCfg: NotifyCfg): Promise<void>;

  showIndexHtmlAsView(): void;

  openDialog(dialogCfg: DialogCfg): Promise<void>;

  // tasks
  getTasks(): Promise<Task[]>;

  getArchivedTasks(): Promise<Task[]>;

  getCurrentContextTasks(): Promise<Task[]>;

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
  persistDataSynced(dataStr: string): Promise<void>;

  loadSyncedData(): Promise<string | null>;

  getConfig<T = Record<string, unknown>>(): Promise<T | null>;

  // download file
  downloadFile(filename: string, data: string): Promise<void>;

  // node execution (only available in Electron with nodeExecution permission)
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
