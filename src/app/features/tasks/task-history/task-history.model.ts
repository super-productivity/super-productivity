import type {
  TaskHistoryValue,
  TaskHistoryEvent,
  TaskHistoryGap,
} from '@super-productivity/plugin-api';
export type {
  TaskHistoryValue,
  TaskHistoryField,
  TaskHistoryEvent,
} from '@super-productivity/plugin-api';

/** A starting snapshot, never an invented event in the task's earlier life. */
export interface TaskHistoryBaseline {
  id: string;
  taskId: string;
  observedAt: number;
  createdAt: number;
  status: TaskHistoryValue;
  schedule: TaskHistoryValue;
  deadline: TaskHistoryValue;
}

export interface TaskHistoryRecord {
  /** A legacy replay can reveal a gap before any recorder baseline exists. */
  baseline?: TaskHistoryBaseline;
  events: Record<string, TaskHistoryEvent>;
  gaps?: Record<string, TaskHistoryGap>;
}

/** App-owned data: disabling or uninstalling a viewer does not remove it. */
export type TaskHistoryState = Record<string, TaskHistoryRecord>;

/** Stored INSIDE the task operation, not in a second asynchronous plugin write. */
export interface TaskHistoryEnvelope {
  version: 1;
  operationId: string;
  occurredAt: number;
  baselines: TaskHistoryBaseline[];
  events: TaskHistoryEvent[];
  /** Monotonic coverage warnings travel with the next author operation too. */
  gaps?: TaskHistoryGap[];
}
