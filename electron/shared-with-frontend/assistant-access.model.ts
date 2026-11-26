/**
 * Assistant access: an opt-in MCP endpoint at /mcp on the local REST API
 * listener. Everything here is device-local and owned by the Electron main
 * process; none of it is part of the synced config.
 */

export const ASSISTANT_ACCESS_PATH = '/mcp';

export const ASSISTANT_ACCESS_SCOPES = [
  'tasks:read',
  'tasks:read_notes',
  'tasks:capture',
  'tasks:edit',
  'notes:read',
  'counters:read',
] as const;

export type AssistantAccessScope = (typeof ASSISTANT_ACCESS_SCOPES)[number];

/**
 * A scope that is only granted together with another one. Task notes are
 * reached through a task read, and an edit answers with the task it changed,
 * so it needs the read. Capture stands alone: it only adds.
 */
const SCOPE_REQUIREMENTS: readonly [AssistantAccessScope, AssistantAccessScope][] = [
  ['tasks:read_notes', 'tasks:read'],
  ['tasks:edit', 'tasks:read'],
];

/** The scope that has to be granted for this one to be, if any. */
export const getRequiredScope = (
  scope: AssistantAccessScope,
): AssistantAccessScope | undefined =>
  SCOPE_REQUIREMENTS.find(([dependent]) => dependent === scope)?.[1];

export interface AssistantAccessState {
  isEnabled: boolean;
  scopes: AssistantAccessScope[];
  hasCredential: boolean;
  /** Whether the shared loopback listener is up. */
  isListening: boolean;
  error?: 'PORT_IN_USE' | 'PERMISSION_DENIED' | 'UNKNOWN';
}

export interface AssistantAccessCredentialResult {
  /** Shown once; only a verifier is kept on disk. */
  credential: string;
  state: AssistantAccessState;
}

/**
 * Internal renderer route for capture. Main only forwards it for MCP calls and
 * marks them `source: 'mcp'`; the renderer rejects it from any other source, so
 * it is not reachable through the REST API.
 */
export const ASSISTANT_CAPTURE_PATH = '/assistant/capture';

// A capture waits for the op to reach IndexedDB, which can take longer than the
// REST API's 15s budget when many writes are queued.
export const ASSISTANT_CAPTURE_TIMEOUT_MS = 45000;

export type AssistantCaptureResult =
  | { status: 'created'; id: string }
  | { status: 'APP_BUSY' | 'PERSIST_DEGRADED' | 'OUTCOME_UNKNOWN'; id?: string };

/**
 * Internal renderer routes for task edits, reachable like the capture route:
 * main forwards them for MCP calls only, marked `source: 'mcp'`. They run the
 * guards and dispatch what the app's own menus do, not the REST API's PATCH.
 */
export const ASSISTANT_TASK_UPDATE_PATH = '/assistant/tasks/update';
export const ASSISTANT_TASK_START_PATH = '/assistant/tasks/start';
export const ASSISTANT_TASK_STOP_PATH = '/assistant/tasks/stop';
export const ASSISTANT_TASK_LOG_TIME_PATH = '/assistant/tasks/log-time';

/** An edit waits for its ops to reach IndexedDB, as a capture does. */
export const ASSISTANT_EDIT_TIMEOUT_MS = ASSISTANT_CAPTURE_TIMEOUT_MS;

/**
 * Codes an edit route answers with when it changed nothing. Main maps each to
 * a fixed message; the route's own message never leaves the process.
 */
export const ASSISTANT_EDIT_REJECTIONS = [
  'APP_BUSY',
  'PERSIST_DEGRADED',
  'ISSUE_LINKED_TASK',
  'CALENDAR_LINKED_TASK',
  'RECURRING_TASK_SCHEDULE',
  'PARENT_TASK_ESTIMATE',
  'CANNOT_TRACK_TASK',
  'TIME_TRACKING_DISABLED',
  'PARENT_TASK_TIME',
  'TAG_NOT_FOUND',
] as const;

export type AssistantEditRejection = (typeof ASSISTANT_EDIT_REJECTIONS)[number];

/**
 * A successful reply. `applied` carries the task as it is afterwards (or the
 * tracked task id); OUTCOME_UNKNOWN means the change was dispatched but could
 * not be confirmed as saved.
 */
export type AssistantEditResult =
  | { status: 'applied'; task?: Record<string, unknown>; currentTaskId?: string | null }
  | { status: 'OUTCOME_UNKNOWN' };
