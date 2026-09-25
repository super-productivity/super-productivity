import { T } from '../../t.const';
import { TaskPriority } from './task.model';

/** Translation key of each priority's label (the same keys the context menu uses). */
export const TASK_PRIORITY_LABEL_KEY: Record<TaskPriority, string> = {
  high: T.F.TASK.CMP.PRIORITY_HIGH,
  medium: T.F.TASK.CMP.PRIORITY_MEDIUM,
  low: T.F.TASK.CMP.PRIORITY_LOW,
};

/**
 * Material icon per priority. `horizontal_rule` (not `remove`) so medium does not
 * reuse the sub-task collapse glyph on the same row.
 */
export const TASK_PRIORITY_ICON: Record<TaskPriority, string> = {
  high: 'priority_high',
  medium: 'horizontal_rule',
  low: 'arrow_downward',
};
