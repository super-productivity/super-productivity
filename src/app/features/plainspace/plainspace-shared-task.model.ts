import { InjectionToken } from '@angular/core';
import type { Task } from '../tasks/task.model';

/** A read-only Plainspace preview. Only a successful claim imports a local task. */
export interface PlainspaceSharedTask {
  id: string;
  title: string;
  isDone: boolean;
  isMine?: boolean;
  /** ID of the retained local task when this preview takes its place in the project. */
  localTaskId?: string;
  /** Absolute link to open the task in the Plainspace web UI. */
  url?: string | null;
  /** Repeats in Plainspace — flagged in the pool so claiming a recurring
   * commitment is visible up front. The cadence stays Plainspace-side. */
  isRecurring: boolean;
  /** Null when unassigned. The legacy claim pool omits this field. */
  assignee?: { id: string; displayName: string } | null;
}

export interface PlainspaceTeamOverview {
  providerId: string;
  tasks: PlainspaceSharedTask[];
  status: 'ready' | 'loading' | 'unavailable';
  /** Last known remote IDs assigned to the caller, scoped to this provider. */
  assignedTaskIds?: ReadonlySet<string>;
  /** Ownership confirmed by a local write since the last successful snapshot. */
  locallyAssignedTaskIds?: ReadonlySet<string>;
}

/** View-only ownership and visibility for native rows inside the shared project. */
export const PLAINSPACE_PROJECT_ROWS = new InjectionToken<{
  ownerLabel(issueId: string, providerId: string): string | undefined;
  hideNativeTask(task: Task): boolean;
}>('PLAINSPACE_PROJECT_ROWS');
