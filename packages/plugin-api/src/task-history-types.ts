/** A calendar day is not a midnight timestamp and must not change with timezone. */
export type TaskHistoryValue =
  | { kind: 'status'; value: 'open' | 'done' | 'wontDo' }
  | { kind: 'day'; value: string }
  | { kind: 'time'; value: number }
  | { kind: 'none' }
  | { kind: 'unknown' };

export type TaskHistoryField = 'status' | 'schedule' | 'deadline';

export interface TaskHistoryEvent {
  id: string;
  operationId: string;
  taskId: string;
  field: TaskHistoryField;
  before: TaskHistoryValue;
  after: TaskHistoryValue;
  /** Author device's wall clock, not a globally synchronized ordering guarantee. */
  occurredAt: number;
  sourceAction: string;
}

export interface TaskHistoryGap {
  id: string;
  taskId: string;
  reason: 'unsupported-client' | 'recording-unavailable';
  /** Null when no trustworthy observation timestamp was recorded. */
  detectedAt: number | null;
}

export interface TaskHistoryQuery {
  /** Opaque cursor returned by the preceding page for THIS task. */
  cursor?: string;
  /** 1..200, default 50. */
  limit?: number;
}

export interface TaskHistoryPage {
  taskId: string;
  createdAt: number | null;
  recordingStartedAt: number | null;
  events: TaskHistoryEvent[];
  gaps: TaskHistoryGap[];
  total: number;
  revision: string;
  nextCursor: string | null;
}

/** Renders this plugin's index.html inside native task additional information. */
export interface PluginTaskDetailBlockCfg {
  id: string;
  label: string;
}

/** Immutable for an iframe lifetime. Changing task/block creates a new iframe. */
export interface PluginTaskDetailContext {
  readonly taskId: string;
  readonly blockId: string;
  readonly instanceId: string;
}
