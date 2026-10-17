export interface MarkTaskDoneDialogData {
  taskId: string;
  taskTitle: string;
  timeSpent: number;
  timeEstimate: number;
  currentScheduledTime: number | null;
  dueDay?: string | null;
}

export type SchedulePlacementType = 'ALL_DAY' | 'CUSTOM_TIME';

export interface SchedulePlacementResult {
  type: SchedulePlacementType;
  /** Start of day 00:00:00 timestamp for ALL_DAY, or specific scheduled timestamp */
  dueWithTime: number;
}

export type DurationAdjustmentType = 'KEEP_ESTIMATE' | 'ADJUST_TO_TRACKED';

export interface DurationAdjustmentResult {
  type: DurationAdjustmentType;
  newEstimateDurationMs: number;
}

export interface MarkTaskDoneDialogResult {
  confirmed: boolean;
  placement: SchedulePlacementResult;
  durationAdjustment?: DurationAdjustmentResult;
}

export const TASK_DONE_DEFAULT_MIN_DURATION_MS = 15 * 60 * 1000; // 15 minutes default
