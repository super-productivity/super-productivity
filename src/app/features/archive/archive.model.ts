import { TaskArchive } from '../tasks/task.model';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';

/**
 * Model for archived task and time tracking data.
 * Archives are split into "young" (recent, < 21 days) and "old" (>= 21 days).
 */
export interface ArchiveModel {
  /**
   * Should not be written apart from flushing!
   */
  timeTracking: TimeTrackingState;
  task: TaskArchive;
  /**
   * Optional for backwards compatibility with older backups that don't have this field.
   * @see https://github.com/johannesjo/super-productivity/issues/6200
   */
  lastTimeTrackingFlush?: number;
}
