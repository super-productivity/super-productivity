import { InjectionToken } from '@angular/core';

/**
 * Feature calls the Local REST API handler makes without importing features/
 * (core/ must not — see FEATURE_LAYER_FENCE in eslint.config.js). Provided
 * from the features side in main.ts.
 */
export interface LocalRestApiFeatureBridge {
  /** Web link to the issue a task was imported from; '' when there is none. */
  issueLink(
    issueType: string,
    issueId: string | number,
    issueProviderId: string,
  ): Promise<string>;

  /** Adds a subtask whose title is kept as is (no short syntax); returns its id. */
  addLiteralSubTask(parentId: string, fields: object): string;

  /**
   * Adds time spent on `date` (YYYY-MM-DD) the way the app's own tracking
   * does, so `timeSpentOnDay`, the parent roll-up and sync stay consistent.
   * A past day is back-filled: no work start/end and no auto-plan for today.
   */
  addTimeSpentOnDay(task: object, durationMs: number, date: string): void;

  /**
   * Moves a top-level task to another project the way the UI does, so a
   * recurring task's repeat config and instances follow it, without asking.
   */
  moveTaskToProject(taskId: string, projectId: string): Promise<void>;

  /**
   * Updates a task whose changes include `dueWithTime`, moving or clearing its
   * reminder along with it. A plain update leaves `remindAt` where it was.
   */
  updateTaskWithDueTime(task: object, changes: object): void;
}

export const LOCAL_REST_API_FEATURE_BRIDGE =
  new InjectionToken<LocalRestApiFeatureBridge>('LOCAL_REST_API_FEATURE_BRIDGE');
