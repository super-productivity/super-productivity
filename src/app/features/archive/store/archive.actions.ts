import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

/**
 * Non-persistent action dispatched after remote archive-affecting operations
 * have been applied to the store. This triggers UI refresh for worklog/archive views.
 *
 * This action breaks the circular dependency between OperationApplierService
 * and WorklogService by using NgRx instead of direct service injection.
 */
export const remoteArchiveDataApplied = createAction(
  '[Archive] Remote Archive Data Applied',
);

/**
 * Persistent action to flush data from archiveYoung to archiveOld.
 * This action is dispatched when the local client determines it's time to flush,
 * and is synced to other clients to ensure deterministic archive state.
 *
 * When received remotely, the receiving client executes the same flush logic,
 * ensuring both clients have consistent archiveOld content without needing
 * to sync the large archiveOld files directly.
 *
 * Prerequisites:
 * - Vector clock ordering ensures this action is applied AFTER all preceding
 *   moveToArchive operations that populated archiveYoung.
 */
export const flushYoungToOld = createAction(
  '[Archive] Flush Young to Old',
  (actionProps: { timestamp: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'ALL', // Affects multiple entity types (tasks, timeTracking)
      opType: OpType.Batch, // Bulk operation affecting multiple entities
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Persistent action to compress archive data by:
 * 1. Deleting subtask entities and merging their time data to parent tasks
 * 2. Clearing notes from tasks older than 1 year
 * 3. Clearing non-essential issue fields (keeps issueId and issueType)
 *
 * The oneYearAgoTimestamp is passed explicitly so all clients compress the same
 * tasks deterministically, regardless of when they process the operation.
 */
export const compressArchive = createAction(
  '[Archive] Compress Archive',
  (actionProps: { timestamp: number; oneYearAgoTimestamp: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'ALL',
      opType: OpType.Batch,
    } satisfies PersistentActionMeta,
  }),
);
