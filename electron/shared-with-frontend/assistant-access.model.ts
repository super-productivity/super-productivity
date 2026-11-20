import { AssistantTaskStatus, TASK_STATUSES } from './task-status-and-priority';

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
  'tasks:update',
] as const;

export type AssistantAccessScope = (typeof ASSISTANT_ACCESS_SCOPES)[number];

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
 * Internal renderer routes for assistant writes. Main only forwards them for MCP calls and
 * marks them `source: 'mcp'`; the renderer rejects them from any other source, so
 * they are not reachable through the REST API.
 */
export const ASSISTANT_UPDATE_PATH = '/assistant/update';
export const ASSISTANT_CAPTURE_PATH = '/assistant/capture';

// A capture waits for the op to reach IndexedDB, which can take longer than the
// REST API's 15s budget when many writes are queued.
export const ASSISTANT_CAPTURE_TIMEOUT_MS = 45000;

export type AssistantCaptureResult =
  | { status: 'created'; id: string }
  | { status: 'APP_BUSY' | 'PERSIST_DEGRADED' | 'OUTCOME_UNKNOWN'; id?: string };

export interface AssistantTaskUpdate {
  id: string;
  priority?: 1 | 2 | 3 | null;
  status?: AssistantTaskStatus;
}

export const isAssistantTaskUpdate = (value: unknown): value is AssistantTaskUpdate => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).every((key) => ['id', 'priority', 'status'].includes(key)) &&
    typeof input.id === 'string' &&
    /^[A-Za-z0-9_-]{1,200}$/.test(input.id) &&
    (input.priority !== undefined || input.status !== undefined) &&
    (input.priority === undefined ||
      input.priority === null ||
      input.priority === 1 ||
      input.priority === 2 ||
      input.priority === 3) &&
    (input.status === undefined ||
      TASK_STATUSES.some((status) => input.status === status))
  );
};
