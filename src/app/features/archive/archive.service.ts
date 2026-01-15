import { inject, Injectable } from '@angular/core';
import { Task, TaskWithSubTasks } from '../tasks/task.model';
import { flattenTasks } from '../tasks/store/task.selectors';
import { createEmptyEntity } from '../../util/create-empty-entity';
import { taskAdapter } from '../tasks/store/task.adapter';
import {
  sortTimeTrackingAndTasksFromArchiveYoungToOld,
  sortTimeTrackingDataToArchiveYoung,
} from './util/sort-data-to-flush';
import { Store } from '@ngrx/store';
import { TimeTrackingActions } from '../time-tracking/store/time-tracking.actions';
import { flushYoungToOld } from './store/archive.actions';
import { getDbDateStr } from '../../util/get-db-date-str';
import { Log } from '../../core/log';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from './archive.model';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';
import { first } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { selectTimeTrackingState } from '../time-tracking/store/time-tracking.selectors';

/**
 * Maps tasks to archive format by:
 * - Setting isDone=true
 * - Computing doneOn from task.doneOn, parent.doneOn, or fallback to now
 * - Clearing reminder/scheduling fields
 */
const mapTasksToArchiveFormat = (
  flatTasks: Task[],
  now: number,
  logPrefix: string,
): Task[] => {
  return flatTasks.map((task: Task) => {
    let doneOn: number;
    if (task.isDone && task.doneOn) {
      doneOn = task.doneOn;
    } else if (task.parentId) {
      const parent = flatTasks.find((t) => t.id === task.parentId);
      if (parent) {
        doneOn = parent.doneOn || now;
      } else {
        Log.warn(
          `[ArchiveService] ${logPrefix}: Subtask ${task.id} has parentId ${task.parentId} but parent not found in flatTasks, using current time`,
        );
        doneOn = now;
      }
    } else {
      doneOn = now;
    }
    return {
      ...task,
      reminderId: undefined,
      isDone: true,
      dueWithTime: undefined,
      dueDay: undefined,
      _hideSubTasksMode: undefined,
      doneOn,
    };
  });
};

/*
# Considerations for flush architecture:
** The main purpose of flushing is mainly to reduce the amount of data that needs to be transferred over the network **
Roughly we aim at these 3 syncs to occur under normal circumstances:

every sync  => sync the meta file
daily       => +archiveYoung (moving tasks to archive)
less often  => +archiveOld (after flushing data from archiveYoung to archiveOld)

## Other considerations:

timeTracking:
* (currently) there seems to be no writing of archiveYoung or archiveOld like there is for archive tasks, when editing tasks in worklog
=> archiveOld.timeTracking and archiveYoung.timeTracking can be read-only
* data for today should never be in the archive and always be in the store to avoid problems when doing partial updates
=> timeTracking should always retain some data, at least for today (or  maybe later for the whole current week, if we want to make it editable)

taskArchive:
* data in archiveYoung should be faster to access and write
* when updating some old data, we need to upload archiveOld regardless of flushing
=> makes sense to retain data in archiveYoung that is likely to be accessed more often
=> 21 days is maybe a good middle ground for this, since it allows us to write data from the last month
 */

export const ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD = 1000 * 60 * 60 * 24 * 14;
export const ARCHIVE_TASK_YOUNG_TO_OLD_THRESHOLD = 1000 * 60 * 60 * 24 * 21;

const DEFAULT_TIME_TRACKING: TimeTrackingState = {
  project: {},
  tag: {},
};

const DEFAULT_ARCHIVE: ArchiveModel = {
  task: createEmptyEntity(),
  timeTracking: DEFAULT_TIME_TRACKING,
  lastTimeTrackingFlush: 0,
};

@Injectable({
  providedIn: 'root',
})
export class ArchiveService {
  private readonly _archiveDbAdapter = inject(ArchiveDbAdapter);
  private readonly _store = inject(Store);

  // NOTE: we choose this method as trigger to check for flushing to archive, since
  // it is usually triggered every work-day once
  async moveTasksToArchiveAndFlushArchiveIfDue(tasks: TaskWithSubTasks[]): Promise<void> {
    const now = Date.now();
    const flatTasks = flattenTasks(tasks);

    Log.log('[ArchiveService] moveTasksToArchiveAndFlushArchiveIfDue:', {
      inputTasksCount: tasks.length,
      flatTasksCount: flatTasks.length,
      taskIds: flatTasks.map((t) => t.id),
    });

    if (!flatTasks.length) {
      Log.log('[ArchiveService] No tasks to archive after flattening');
      return;
    }

    const archiveYoung =
      (await this._archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const taskArchiveState = archiveYoung.task || createEmptyEntity();

    const archiveTasks = mapTasksToArchiveFormat(flatTasks, now, 'moveToArchive');
    const newTaskArchiveUnsorted = taskAdapter.addMany(archiveTasks, taskArchiveState);
    // Sort ids for deterministic ordering across clients (UUIDv7 is lexicographically sortable)
    const newTaskArchive = {
      ...newTaskArchiveUnsorted,
      ids: [...newTaskArchiveUnsorted.ids].sort(),
    };

    // ------------------------------------------------
    // Result A:
    // Move all archived tasks to archiveYoung
    // Move timeTracking data to archiveYoung
    // Get time tracking from the store as it is fresher
    const timeTracking = await firstValueFrom(
      this._store.select(selectTimeTrackingState).pipe(first()),
    );
    const newSorted1 = sortTimeTrackingDataToArchiveYoung({
      timeTracking: timeTracking || DEFAULT_TIME_TRACKING,
      archiveYoung,
      todayStr: getDbDateStr(now),
    });
    const newArchiveYoung = {
      ...newSorted1.archiveYoung,
      task: newTaskArchive,
      // Note: lastFlush tracks when tasks were last moved to archiveYoung (daily).
      // This is different from lastTimeTrackingFlush which tracks young→old flushes.
      lastFlush: now,
    };
    await this._archiveDbAdapter.saveArchiveYoung(newArchiveYoung);

    Log.log('[ArchiveService] Saved tasks to archiveYoung:', {
      archivedTaskCount: Object.keys(newTaskArchive.entities).length,
      archivedTaskIds: newTaskArchive.ids,
    });

    this._store.dispatch(
      TimeTrackingActions.updateWholeState({
        newState: newSorted1.timeTracking,
      }),
    );

    // ------------------------------------------------
    // Check if it's time to flush archiveYoung to archiveOld
    const archiveOld = (await this._archiveDbAdapter.loadArchiveOld()) || DEFAULT_ARCHIVE;
    const isFlushArchiveOld =
      now - archiveOld.lastTimeTrackingFlush > ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD;

    if (!isFlushArchiveOld) {
      return;
    }

    // Perform the flush BEFORE dispatching the action.
    // This prevents a race condition where sync starts before the effect completes:
    // 1. Action dispatch -> effect queued
    // 2. Method returns -> daily summary starts sync -> DB locked
    // 3. Effect runs -> tries to write -> blocked by DB lock
    //
    // By doing the flush here, we ensure it completes before this method returns.
    // The action is still dispatched for op-log capture (syncs to other clients).
    // ArchiveOperationHandler._handleFlushYoungToOld skips local operations.
    //
    // IMPORTANT: We use `newArchiveYoung` directly instead of reloading from DB
    // to avoid a race condition where the archive could change between save and load.

    // Store original state for potential rollback
    const originalArchiveYoung = newArchiveYoung;
    const originalArchiveOld = archiveOld;

    const newSorted = sortTimeTrackingAndTasksFromArchiveYoungToOld({
      archiveYoung: newArchiveYoung,
      archiveOld,
      threshold: ARCHIVE_TASK_YOUNG_TO_OLD_THRESHOLD,
      now,
    });

    try {
      await this._archiveDbAdapter.saveArchiveYoung({
        ...newSorted.archiveYoung,
        lastTimeTrackingFlush: now,
      });

      await this._archiveDbAdapter.saveArchiveOld({
        ...newSorted.archiveOld,
        lastTimeTrackingFlush: now,
      });
    } catch (e) {
      // Attempt rollback: restore BOTH archiveYoung and archiveOld to original state
      Log.err('[ArchiveService] Archive flush failed, attempting rollback...', e);
      const rollbackErrors: Error[] = [];

      // Rollback archiveYoung
      try {
        await this._archiveDbAdapter.saveArchiveYoung(originalArchiveYoung);
      } catch (rollbackErr) {
        rollbackErrors.push(rollbackErr as Error);
      }

      // Rollback archiveOld
      try {
        await this._archiveDbAdapter.saveArchiveOld(originalArchiveOld);
      } catch (rollbackErr) {
        rollbackErrors.push(rollbackErr as Error);
      }

      if (rollbackErrors.length > 0) {
        Log.err(
          '[ArchiveService] Archive flush rollback FAILED - archive may be inconsistent',
          rollbackErrors,
        );
      } else {
        Log.log('[ArchiveService] Archive flush rollback successful');
      }

      // Don't dispatch action if flush failed - prevents op-log pollution
      // and ensures remote clients don't try to apply a failed operation
      throw e;
    }

    Log.log(
      '______________________\nFLUSHED ALL FROM ARCHIVE YOUNG TO OLD (via ArchiveService)\n_______________________',
    );

    // Dispatch for op-log capture - syncs to other clients
    // The handler skips local operations since we already did the flush above
    this._store.dispatch(flushYoungToOld({ timestamp: now }));
  }

  /**
   * Writes tasks to archiveYoung for remote sync operations.
   * Also moves historical time tracking data to archiveYoung to keep
   * the client's archive consistent with the originating client.
   *
   * Used when receiving moveToArchive operations from other clients.
   *
   * Note: This method does NOT check if flush is due. Flushes are triggered
   * only on the originating client and synced via the flushYoungToOld action.
   * This ensures flushes happen exactly once, not on every receiving client.
   */
  async writeTasksToArchiveForRemoteSync(tasks: TaskWithSubTasks[]): Promise<void> {
    const now = Date.now();
    const flatTasks = flattenTasks(tasks);

    Log.log('[ArchiveService] writeTasksToArchiveForRemoteSync:', {
      inputTasksCount: tasks.length,
      flatTasksCount: flatTasks.length,
      taskIds: flatTasks.map((t) => t.id),
    });

    if (!flatTasks.length) {
      Log.log('[ArchiveService] No tasks to archive for remote sync');
      return;
    }

    const archiveYoung =
      (await this._archiveDbAdapter.loadArchiveYoung()) || DEFAULT_ARCHIVE;
    const taskArchiveState = archiveYoung.task || createEmptyEntity();

    const archiveTasks = mapTasksToArchiveFormat(flatTasks, now, 'Remote sync');
    const newTaskArchiveUnsorted = taskAdapter.addMany(archiveTasks, taskArchiveState);
    // Sort ids for deterministic ordering across clients (UUIDv7 is lexicographically sortable)
    const newTaskArchive = {
      ...newTaskArchiveUnsorted,
      ids: [...newTaskArchiveUnsorted.ids].sort(),
    };

    // Also move historical time tracking data to archiveYoung
    // This ensures the remote client's archive matches the originating client
    // Get time tracking from the store as it is fresher
    const timeTracking = await firstValueFrom(
      this._store.select(selectTimeTrackingState).pipe(first()),
    );
    const sorted = sortTimeTrackingDataToArchiveYoung({
      timeTracking: timeTracking || DEFAULT_TIME_TRACKING,
      archiveYoung,
      todayStr: getDbDateStr(now),
    });

    // Note: ArchiveDbAdapter uses direct IndexedDB access (same DB as PFAPI)
    // so there's no conflict with PFAPI's lock mechanism
    await this._archiveDbAdapter.saveArchiveYoung({
      ...sorted.archiveYoung,
      task: newTaskArchive,
    });

    // Update active time tracking state (remove historical data that was moved to archive)
    this._store.dispatch(
      TimeTrackingActions.updateWholeState({
        newState: sorted.timeTracking,
      }),
    );

    Log.log(
      '[ArchiveService] Remote sync: saved tasks and time tracking to archiveYoung:',
      {
        archivedTaskCount: Object.keys(newTaskArchive.entities).length,
      },
    );
  }
}
