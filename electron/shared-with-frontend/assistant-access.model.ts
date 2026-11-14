/**
 * Assistant access: an opt-in MCP endpoint at /mcp on the local REST API
 * listener. Everything here is device-local and owned by the Electron main
 * process; none of it is part of the synced config.
 */

export const ASSISTANT_ACCESS_PATH = '/mcp';

export const ASSISTANT_ACCESS_SCOPES = [
  'tasks:read',
  'tasks:read_notes',
  'tasks:read_archive',
  'tasks:capture',
  'tasks:edit',
  'tasks:delete',
  'notes:read',
  'notes:edit',
  'counters:read',
  'counters:edit',
] as const;

export type AssistantAccessScope = (typeof ASSISTANT_ACCESS_SCOPES)[number];

/**
 * A scope that is only granted together with another one. Task notes and the
 * archive are reached through a task read, and every write answers with what
 * it changed, so it needs the matching read. Capture stands alone: it only adds.
 */
const SCOPE_REQUIREMENTS: readonly [AssistantAccessScope, AssistantAccessScope][] = [
  ['tasks:read_notes', 'tasks:read'],
  ['tasks:read_archive', 'tasks:read'],
  ['tasks:edit', 'tasks:read'],
  ['tasks:delete', 'tasks:read'],
  ['notes:edit', 'notes:read'],
  ['counters:edit', 'counters:read'],
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
