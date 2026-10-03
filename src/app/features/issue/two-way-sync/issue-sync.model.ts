import { Action } from '@ngrx/store';
import { Task } from '../../tasks/task.model';

export type SyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

/** Per-field config keyed by task field name */
export type FieldSyncConfig = Partial<Record<keyof Task, SyncDirection>>;

export interface FieldPushContext {
  /** The NgRx action that triggered the push. */
  action: Action;
  /** The task after the reducer ran. */
  task: Task;
}

export interface FieldMappingContext {
  issueId: string;
  issueNumber?: number;
}

/**
 * Defines how one field maps between task and issue.
 * NOTE: Conflict detection uses strict equality (===) on field values.
 * Values MUST be primitives (string, number, boolean).
 */
export interface FieldMapping {
  taskField: keyof Task;
  issueField: string;
  defaultDirection: SyncDirection;
  toIssueValue: (taskValue: unknown, ctx: FieldMappingContext) => unknown;
  toTaskValue: (issueValue: unknown, ctx: FieldMappingContext) => unknown;
  /** Task fields to clear when this field is set (e.g. dueWithTime and dueDay are mutually exclusive) */
  mutuallyExclusive?: (keyof Task)[];
  /**
   * Task fields to re-send together with this one when an earlier push of them
   * was held back by the adapter (expected-skip), read from the current task.
   * For provider fields that are only valid as a pair (e.g. CalDAV DTSTART/DUE).
   * Partners that merely differ (e.g. changed automatically) are not sent.
   */
  pushTogetherWith?: (keyof Task)[];
  /**
   * Leaves this field out of a push when it returns true, also as a held-back
   * `pushTogetherWith` partner. For triggers that can change the field without
   * an explicit edit (e.g. CalDAV: Planner moves, repeat-config planning).
   */
  skipPush?: (ctx: FieldPushContext) => boolean;
}
