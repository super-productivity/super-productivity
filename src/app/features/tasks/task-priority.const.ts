import { T } from '../../t.const';
import { TaskPriorityIconPreset } from '../config/global-config.model';
import { TaskPriority } from './task.model';

/** Every priority level, lowest first — the order menus and previews list them in. */
export const TASK_PRIORITY_LEVELS: readonly TaskPriority[] = [1, 2, 3];

// Records keyed by the numeric `TaskPriority` levels.
/* eslint-disable @typescript-eslint/naming-convention */

/** Translation key of each priority's label. */
export const TASK_PRIORITY_LABEL_KEY: Record<TaskPriority, string> = {
  3: T.F.TASK.CMP.PRIORITY_HIGH,
  2: T.F.TASK.CMP.PRIORITY_MEDIUM,
  1: T.F.TASK.CMP.PRIORITY_LOW,
};

/** Material Symbols icon for each preset and level. */
export const TASK_PRIORITY_ICONS: Record<
  TaskPriorityIconPreset,
  Record<TaskPriority, string>
> = {
  chevrons: {
    1: 'keyboard_arrow_down',
    2: 'keyboard_arrow_up',
    3: 'keyboard_double_arrow_up',
  },
  numbers: { 1: 'counter_1', 2: 'counter_2', 3: 'counter_3' },
};

/* eslint-enable @typescript-eslint/naming-convention */

export const DEFAULT_TASK_PRIORITY_ICON_PRESET: TaskPriorityIconPreset = 'chevrons';
