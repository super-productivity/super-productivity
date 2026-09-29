import { T } from '../../t.const';
import { TaskPriorityIconPreset } from '../config/global-config.model';
import { TaskPriority } from './task.model';

/** Every priority level, most important first — the order menus list them in. */
export const TASK_PRIORITY_LEVELS: readonly TaskPriority[] = [3, 2, 1];

// Records keyed by the numeric `TaskPriority` levels.
/* eslint-disable @typescript-eslint/naming-convention */

/** Translation key of each priority's label (the same keys the context menu uses). */
export const TASK_PRIORITY_LABEL_KEY: Record<TaskPriority, string> = {
  3: T.F.TASK.CMP.PRIORITY_HIGH,
  2: T.F.TASK.CMP.PRIORITY_MEDIUM,
  1: T.F.TASK.CMP.PRIORITY_LOW,
};

/** Material icon per priority for the default `chevrons` preset. */
export const TASK_PRIORITY_CHEVRON_ICON: Record<TaskPriority, string> = {
  3: 'keyboard_double_arrow_up',
  2: 'keyboard_arrow_up',
  1: 'keyboard_arrow_down',
};

/**
 * Dot count per priority for the `dots` preset, pre-built so the indicator
 * (rendered once per task row) never allocates an array per change detection.
 */
export const TASK_PRIORITY_DOTS: Record<TaskPriority, readonly number[]> = {
  3: [0, 1, 2],
  2: [0, 1],
  1: [0],
};

/* eslint-enable @typescript-eslint/naming-convention */

export const DEFAULT_TASK_PRIORITY_ICON_PRESET: TaskPriorityIconPreset = 'chevrons';
