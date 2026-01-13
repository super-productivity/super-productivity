import { ArchiveModel } from '../archive.model';
import {
  TimeTrackingState,
  TTWorkContextSessionMap,
} from '../../time-tracking/time-tracking.model';
import { ArchiveTask, TaskArchive } from '../../tasks/task.model';
import { ImpossibleError } from '../../../op-log/sync-exports';
import { dirtyDeepCopy } from '../../../util/dirtyDeepCopy';

const TIME_TRACKING_CATEGORIES = ['project', 'tag'] as const;

/**
 * Moves non-today time tracking data from active state to archiveYoung.
 *
 * Called daily when finishing work. Separates "today's" time tracking
 * (which stays in active state) from older data (which moves to archiveYoung).
 *
 * ## Date Handling:
 * - Only entries matching `todayStr` exactly stay in active timeTracking
 * - All other dates (past AND future) move to archiveYoung
 * - todayStr format: 'YYYY-MM-DD' (from getWorklogStr())
 *
 * ## Data Flow:
 * ```
 * Active TimeTracking:                    ArchiveYoung:
 * ┌──────────────────────┐               ┌──────────────────────┐
 * │ today: {...}         │  ──keep──►    │ (unchanged)          │
 * │ yesterday: {...}     │  ──move──►    │ yesterday: {...}     │
 * │ last_week: {...}     │  ──move──►    │ last_week: {...}     │
 * └──────────────────────┘               └──────────────────────┘
 * ```
 *
 * ## Merge Behavior:
 * - Preserves existing data in archiveYoung (doesn't overwrite)
 * - New data from timeTracking is added to existing archiveYoung entries
 *
 * @param timeTracking - Active TimeTrackingState from NgRx store
 * @param archiveYoung - Current archiveYoung model
 * @param todayStr - Today's date string in 'YYYY-MM-DD' format
 * @returns Object with updated timeTracking (only today) and archiveYoung (with moved data)
 */
export const sortTimeTrackingDataToArchiveYoung = ({
  timeTracking,
  archiveYoung,
  todayStr,
}: {
  timeTracking: TimeTrackingState;
  archiveYoung: ArchiveModel;
  todayStr: string;
}): {
  timeTracking: TimeTrackingState;
  archiveYoung: ArchiveModel;
} => {
  const currTT = dirtyDeepCopy(timeTracking);
  const archiveTT = dirtyDeepCopy(archiveYoung.timeTracking);

  // Find dates that are not today and move them to archive
  // First iterate over categories (project, tag)
  TIME_TRACKING_CATEGORIES.forEach((category) => {
    if (!currTT[category]) currTT[category] = {};
    if (!archiveTT[category]) archiveTT[category] = {};

    // Then iterate over each project/tag within the category
    Object.keys(timeTracking[category]).forEach((contextId) => {
      if (!currTT[category][contextId]) currTT[category][contextId] = {};
      if (!archiveTT[category][contextId]) archiveTT[category][contextId] = {};

      // Finally iterate over dates for each project/tag
      Object.keys(timeTracking[category][contextId]).forEach((dateStr) => {
        if (dateStr !== todayStr) {
          // Move to archive
          if (!archiveTT[category][contextId]) {
            archiveTT[category][contextId] = {};
          }
          archiveTT[category][contextId][dateStr] =
            timeTracking[category][contextId][dateStr];
          delete currTT[category][contextId][dateStr];
        }
      });
    });
  });

  return {
    timeTracking: currTT,
    archiveYoung: {
      ...archiveYoung,
      timeTracking: archiveTT,
    },
  };
};

/**
 * Flushes data from archiveYoung to archiveOld based on age threshold.
 *
 * Called periodically (every ~14 days) to move older data from archiveYoung
 * to archiveOld, reducing sync payload size for daily operations.
 *
 * ## Task Movement (Threshold-Based):
 * - Tasks with `doneOn` older than threshold move to archiveOld
 * - Subtasks always move with their parent (atomic unit)
 * - Legacy tasks without `doneOn` are treated as old (moved)
 * - Task IDs are sorted for deterministic ordering across clients
 *
 * ## TimeTracking Movement (Complete Transfer):
 * - ALL timeTracking data moves from archiveYoung to archiveOld
 * - archiveYoung.timeTracking is completely cleared after flush
 * - This is intentional: timeTracking doesn't need the young/old split
 *
 * ## Determinism (Critical for Sync):
 * - Given same inputs, produces identical output on all clients
 * - Task IDs sorted alphabetically
 * - No random or time-dependent logic (uses provided `now`)
 *
 * ## Sync Flow:
 * 1. Local client executes flush, writes to IndexedDB
 * 2. `flushYoungToOld` action is dispatched (captured in op-log)
 * 3. Remote clients receive operation via sync
 * 4. `ArchiveOperationHandler` executes same deterministic flush
 *
 * @param archiveYoung - Current archiveYoung model
 * @param archiveOld - Current archiveOld model
 * @param threshold - Age threshold in milliseconds (typically 21 days)
 * @param now - Current timestamp (for deterministic calculation)
 * @returns Object with updated archiveYoung (cleared timeTracking) and archiveOld (merged data)
 */
export const sortTimeTrackingAndTasksFromArchiveYoungToOld = ({
  archiveYoung,
  archiveOld,
  threshold,
  now,
}: {
  archiveYoung: ArchiveModel;
  archiveOld: ArchiveModel;
  threshold: number;
  now: number;
}): {
  archiveYoung: ArchiveModel;
  archiveOld: ArchiveModel;
} => {
  // Sort tasks based on doneOn threshold
  const { youngTaskState, oldTaskState } = splitArchiveTasksByDoneOnThreshold({
    youngTaskState: archiveYoung.task,
    oldTaskState: archiveOld.task,
    now,
    threshold,
  });

  // Move all timeTracking data from young to old archive
  // Deep merge time tracking data from young to old archive
  const mergedTimeTracking = {
    project: mergeTimeTrackingCategory(
      archiveYoung.timeTracking.project,
      archiveOld.timeTracking.project,
    ),
    tag: mergeTimeTrackingCategory(
      archiveYoung.timeTracking.tag,
      archiveOld.timeTracking.tag,
    ),
  };

  return {
    archiveYoung: {
      ...archiveYoung,
      task: youngTaskState,
      // Clear timeTracking data from young archive
      timeTracking: {
        project: {},
        tag: {},
      },
    },
    archiveOld: {
      ...archiveOld,
      task: oldTaskState,
      timeTracking: mergedTimeTracking,
    },
  };
};

/**
 * Merges time tracking data from source into target for a single category.
 *
 * Used internally by `sortTimeTrackingAndTasksFromArchiveYoungToOld` to merge
 * archiveYoung timeTracking into archiveOld.
 *
 * ## Merge Behavior:
 * - Source entries overwrite target entries for same context/date (LWW)
 * - New contexts/dates from source are added to result
 * - Existing target data is preserved for non-overlapping entries
 *
 * @param source - TTWorkContextSessionMap to merge FROM (e.g., archiveYoung)
 * @param target - TTWorkContextSessionMap to merge INTO (e.g., archiveOld)
 * @returns Merged TTWorkContextSessionMap with source overwriting target on conflicts
 */
const mergeTimeTrackingCategory = (
  source: TTWorkContextSessionMap,
  target: TTWorkContextSessionMap,
): TTWorkContextSessionMap => {
  const result = dirtyDeepCopy(target || {});

  Object.entries(source || {}).forEach(([contextId, contextData]) => {
    if (!result[contextId]) {
      result[contextId] = {};
    }

    Object.entries(contextData).forEach(([dateStr, entry]) => {
      result[contextId][dateStr] = entry;
    });
  });

  return result;
};

/**
 * Splits archived tasks between young and old archives based on doneOn timestamp.
 *
 * Tasks older than the threshold are moved from archiveYoung to archiveOld.
 * This is the task-specific portion of the young→old flush operation.
 *
 * ## Selection Criteria:
 * - Only parent tasks (no parentId) are evaluated for threshold
 * - Subtasks always move with their parent
 * - Tasks without `doneOn` (legacy) are treated as old (moved)
 * - Formula: `now - task.doneOn > threshold` → move to old
 *
 * ## Determinism (Critical for Sync):
 * - Task IDs are sorted alphabetically in returned arrays
 * - UUIDv7 IDs are lexicographically sortable by creation time
 * - All clients produce identical output given same inputs
 *
 * ## Error Handling:
 * - Throws ImpossibleError if task entity is undefined (data corruption)
 *
 * @param youngTaskState - Current TaskArchive from archiveYoung
 * @param oldTaskState - Current TaskArchive from archiveOld
 * @param threshold - Age threshold in milliseconds (typically 21 days)
 * @param now - Current timestamp for deterministic calculation
 * @returns Object with updated youngTaskState and oldTaskState (sorted IDs)
 * @throws ImpossibleError if a task entity is undefined
 */
export const splitArchiveTasksByDoneOnThreshold = ({
  youngTaskState,
  oldTaskState,
  threshold,
  now,
}: {
  youngTaskState: TaskArchive;
  oldTaskState: TaskArchive;
  threshold: number;
  now: number;
}): {
  youngTaskState: TaskArchive;
  oldTaskState: TaskArchive;
} => {
  // Find tasks that should be moved to old archive (doneOn < threshold)
  const tasksToMove = Object.values(youngTaskState.entities).filter((task) => {
    if (!task) {
      throw new ImpossibleError('splitArchiveTasksByDoneOnThreshold(): Task not found');
    }
    // NOTE: we also need to consider legacy tasks without doneOn
    return !task.parentId && (task.doneOn ? now - task.doneOn > threshold : true);
  }) as ArchiveTask[];

  // Exit early if no tasks to move
  if (tasksToMove.length === 0) {
    return { youngTaskState, oldTaskState };
  }

  // Create new states
  const newYoungEntities = { ...youngTaskState.entities };
  const newOldEntities = { ...oldTaskState.entities };

  // Move tasks to old archive
  tasksToMove.forEach((task) => {
    delete newYoungEntities[task.id];
    newOldEntities[task.id] = task;
    // Always move subtasks together with their parent
    if (task.subTaskIds) {
      task.subTaskIds.forEach((subTaskId) => {
        const subTask = newYoungEntities[subTaskId];
        if (subTask) {
          delete newYoungEntities[subTaskId];
          newOldEntities[subTaskId] = subTask;
        }
      });
    }
  });

  return {
    youngTaskState: {
      ids: Object.keys(newYoungEntities).sort(),
      entities: newYoungEntities,
    },
    oldTaskState: {
      ids: Object.keys(newOldEntities).sort(),
      entities: newOldEntities,
    },
  };
};
