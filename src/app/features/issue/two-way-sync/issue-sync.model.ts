import { Task } from '../../tasks/task.model';

export type SyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

/** Per-field config keyed by task field name */
export type FieldSyncConfig = Partial<Record<keyof Task, SyncDirection>>;

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
}
