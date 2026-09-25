import { ActionType, Operation, OpType } from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import {
  collectTaskRemovalEntityIdsFromBatch,
  isRemovedAtIndex,
  stripBatchArchivedTaskIdsFromLwwPayload,
} from './bulk-archive-filter.util';
import { Log as OpLog } from '../../core/log';

describe('bulk-archive-filter.util', () => {
  const TASK_ID = 'task-1';

  const createOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: 'op-1',
    opType: OpType.Update,
    entityType: 'TASK',
    actionType: ActionType.TASK_SHARED_UPDATE,
    payload: {},
    vectorClock: { clientA: 1 },
    clientId: 'clientA',
    timestamp: 1,
    schemaVersion: 1,
    ...overrides,
  });

  it('should include cascaded subtask IDs for TASK_SHARED_DELETE_MULTIPLE', () => {
    const operations: Operation[] = [
      createOperation({
        actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
        entityIds: ['parent'],
      }),
    ];
    const state = {
      [TASK_FEATURE_NAME]: {
        entities: {
          parent: { id: 'parent', subTaskIds: ['child'] },
          child: { id: 'child', parentId: 'parent' },
        },
      },
    };

    const result = collectTaskRemovalEntityIdsFromBatch(operations, state);

    expect(result.all).toEqual(new Set(['parent', 'child']));
    expect(result.archiving).toEqual(new Set<string>());
  });

  it('should project parent membership updates before a later archive operation', () => {
    const operations: Operation[] = [
      createOperation({
        id: 'op-lww',
        actionType: toLwwUpdateActionType('TASK'),
        entityType: 'TASK',
        entityId: 'child',
        payload: {
          id: 'child',
          parentId: 'parent',
        },
      }),
      createOperation({
        id: 'op-archive',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        entityType: 'TASK',
        entityId: 'parent',
        payload: {
          actionPayload: {
            tasks: [{ id: 'parent', subTaskIds: [] }],
          },
          entityChanges: [],
        },
      }),
    ];
    const state = {
      [TASK_FEATURE_NAME]: {
        entities: {
          parent: { id: 'parent', subTaskIds: [] },
          child: { id: 'child', parentId: null },
        },
      },
    };

    const result = collectTaskRemovalEntityIdsFromBatch(operations, state);

    expect(result.all).toEqual(new Set(['parent', 'child']));
    expect(result.archiving).toEqual(new Set(['parent', 'child']));
  });

  describe('restoreTask after an archive in the same batch (#10220)', () => {
    const archiveOp = (id: string): Operation =>
      createOperation({
        id: `archive-${id}`,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        entityId: 'parent',
        entityIds: ['parent', 'other'],
        payload: {
          actionPayload: {
            tasks: [
              { id: 'parent', subTaskIds: ['child'] },
              { id: 'other', subTaskIds: [] },
            ],
          },
          entityChanges: [],
        },
      });
    const restoreOp = createOperation({
      id: 'restore-parent',
      actionType: ActionType.TASK_SHARED_RESTORE,
      entityId: 'parent',
      payload: {
        actionPayload: {
          task: { id: 'parent', subTaskIds: ['child'] },
          subTasks: [{ id: 'child', parentId: 'parent' }],
        },
        entityChanges: [],
      },
    });
    const state = {
      [TASK_FEATURE_NAME]: {
        entities: {
          parent: { id: 'parent', subTaskIds: ['child'] },
          child: { id: 'child', parentId: 'parent' },
          other: { id: 'other', subTaskIds: [] },
        },
      },
    };

    it('records where the restore brings the task and its subtasks back', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [archiveOp('1'), restoreOp],
        state,
      );

      expect(result.archiving).toEqual(new Set(['parent', 'child', 'other']));
      expect(result.restoredAt).toEqual(
        new Map([
          ['parent', 1],
          ['child', 1],
        ]),
      );
    });

    it('treats the task as removed only for ops BEFORE the restore', () => {
      const { archiving, restoredAt } = collectTaskRemovalEntityIdsFromBatch(
        [archiveOp('1'), restoreOp],
        state,
      );

      expect(isRemovedAtIndex(archiving, restoredAt, 'parent', 0)).toBe(true);
      expect(isRemovedAtIndex(archiving, restoredAt, 'parent', 1)).toBe(true);
      expect(isRemovedAtIndex(archiving, restoredAt, 'parent', 2)).toBe(false);
      expect(isRemovedAtIndex(archiving, restoredAt, 'child', 2)).toBe(false);
      expect(isRemovedAtIndex(archiving, restoredAt, 'other', 2)).toBe(true);
    });

    it('keeps the task archived when the archive comes AFTER the restore', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [restoreOp, archiveOp('1')],
        state,
      );

      expect(result.archiving).toEqual(new Set(['parent', 'child', 'other']));
      expect(result.restoredAt.size).toBe(0);
      expect(result.archiveRestoredAt.size).toBe(0);
    });

    it('forgets the restore when a later archive re-archives the task', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [archiveOp('1'), restoreOp, archiveOp('2')],
        state,
      );

      expect(result.archiving).toEqual(new Set(['parent', 'child', 'other']));
      expect(result.restoredAt.size).toBe(0);
      expect(result.archiveRestoredAt.size).toBe(0);
    });

    it('still counts a later delete of the restored task', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [
          archiveOp('1'),
          restoreOp,
          createOperation({
            id: 'delete-parent',
            opType: OpType.Delete,
            actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
            entityIds: ['parent'],
          }),
        ],
        state,
      );

      expect(result.all).toEqual(new Set(['parent', 'child', 'other']));
      expect(result.restoredAt.size).toBe(0);
      // A delete is not an archive: the restore still undid the archive.
      expect(result.archiveRestoredAt).toEqual(
        new Map([
          ['parent', 1],
          ['child', 1],
        ]),
      );
    });

    it('keeps the first restore index when a duplicate restore follows', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [archiveOp('1'), restoreOp, restoreOp],
        state,
      );

      expect(result.restoredAt).toEqual(
        new Map([
          ['parent', 1],
          ['child', 1],
        ]),
      );
    });

    it('ignores a restore whose root is still active', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [
          createOperation({
            id: 'delete-child',
            opType: OpType.Delete,
            actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
            entityIds: ['child'],
          }),
          restoreOp,
        ],
        state,
      );

      expect(result.all).toEqual(new Set(['child']));
      expect(result.restoredAt.size).toBe(0);
    });

    it('does not let a filtered update revive the root before a later restore', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(
        [
          archiveOp('1'),
          createOperation({
            id: 'stale-parent-update',
            actionType: toLwwUpdateActionType('TASK'),
            entityId: 'parent',
            payload: { id: 'parent', title: 'stale' },
          }),
          restoreOp,
        ],
        state,
      );

      expect(result.restoredAt).toEqual(
        new Map([
          ['parent', 2],
          ['child', 2],
        ]),
      );
    });
  });

  describe('isRemovedAtIndex (position-aware pre-scan)', () => {
    it('returns false for an id present in neither the removal set nor the restore map', () => {
      expect(isRemovedAtIndex(new Set(['other']), new Map(), 'task-x', 5)).toBe(false);
    });

    it('returns false for an id only present in the restore map (not the removal set)', () => {
      // A dangling restoredAt entry with no matching removal-set membership must
      // not, by itself, mark the id as removed — `ids.has(...)` gates the check.
      const restoredAt = new Map([['task-x', 3]]);
      expect(isRemovedAtIndex(new Set(), restoredAt, 'task-x', 5)).toBe(false);
    });

    it('returns true for an id only present in the removal set, with no restore recorded', () => {
      // "only an archive-restore" case mirrored here as "only a removal, no
      // restore of any kind" — the archiveRestoredAt map is untouched.
      const archiving = new Set(['task-x']);
      expect(isRemovedAtIndex(archiving, new Map(), 'task-x', 0)).toBe(true);
    });

    it('treats an id restored before the queried index as no longer removed', () => {
      // restore before archive (in terms of index ordering relative to the query)
      const ids = new Set(['task-x']);
      const restoredAt = new Map([['task-x', 2]]);
      expect(isRemovedAtIndex(ids, restoredAt, 'task-x', 3)).toBe(false);
    });

    it('treats an id restored at or after the queried index as still removed', () => {
      // archive before restore (in terms of index ordering relative to the query)
      const ids = new Set(['task-x']);
      const restoredAt = new Map([['task-x', 2]]);
      expect(isRemovedAtIndex(ids, restoredAt, 'task-x', 2)).toBe(true);
      expect(isRemovedAtIndex(ids, restoredAt, 'task-x', 1)).toBe(true);
    });
  });

  describe('adversarial same-batch history: 3 archives, 2 restores, 1 subtask delete (#10220)', () => {
    // parent + child, replaying:
    //   archive(parent+child) -> restore(parent+child) -> delete(child only)
    //   -> archive(parent) -> restore(parent) -> archive(parent)
    // Sequential (one-op-at-a-time) replay outcome, hand-traced against the
    // reducer semantics documented on TaskRemovalEntityIds:
    //   - parent: last op touching it is the final archive -> stays archived,
    //     with no restore after it.
    //   - child: deleted (not re-created) after its one restore -> gone, but
    //     NOT blocked by the archive-restore map, since the thing that undid
    //     its archive (the restore) precedes the thing that removed it (the
    //     delete) — a later recreate-after-delete update must be allowed
    //     through, matching "a later delete removes the task without
    //     archiving it, so recreate-after-delete applies".
    const state = {
      [TASK_FEATURE_NAME]: {
        entities: {
          parent: { id: 'parent', subTaskIds: ['child'] },
          child: { id: 'child', parentId: 'parent' },
        },
      },
    };

    const archiveParentAndChild = (id: string): Operation =>
      createOperation({
        id: `archive-${id}`,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        entityId: 'parent',
        entityIds: ['parent'],
        payload: {
          actionPayload: {
            tasks: [{ id: 'parent', subTasks: [{ id: 'child' }] }],
          },
          entityChanges: [],
        },
      });
    const archiveParentOnly = (id: string): Operation =>
      createOperation({
        id: `archive-${id}`,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        entityId: 'parent',
        entityIds: ['parent'],
        payload: {
          actionPayload: { tasks: [{ id: 'parent' }] },
          entityChanges: [],
        },
      });
    const restoreParentAndChild = (id: string): Operation =>
      createOperation({
        id: `restore-${id}`,
        actionType: ActionType.TASK_SHARED_RESTORE,
        entityId: 'parent',
        payload: {
          actionPayload: {
            task: { id: 'parent' },
            subTasks: [{ id: 'child' }],
          },
          entityChanges: [],
        },
      });
    const restoreParentOnly = (id: string): Operation =>
      createOperation({
        id: `restore-${id}`,
        actionType: ActionType.TASK_SHARED_RESTORE,
        entityId: 'parent',
        payload: {
          actionPayload: { task: { id: 'parent' } },
          entityChanges: [],
        },
      });
    const deleteChildOnly = createOperation({
      id: 'delete-child',
      opType: OpType.Delete,
      actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
      entityIds: ['child'],
      payload: { actionPayload: { taskIds: ['child'] }, entityChanges: [] },
    });

    const operations: Operation[] = [
      archiveParentAndChild('1'), // 0
      restoreParentAndChild('1'), // 1
      deleteChildOnly, // 2
      archiveParentOnly('2'), // 3
      restoreParentOnly('2'), // 4
      archiveParentOnly('3'), // 5
    ];

    it('matches sequential replay: parent stays archived, child stays deleted', () => {
      const result = collectTaskRemovalEntityIdsFromBatch(operations, state);
      const finalIndex = operations.length;

      // parent: removed from live view, and archived, at the end of the batch.
      expect(isRemovedAtIndex(result.all, result.restoredAt, 'parent', finalIndex)).toBe(
        true,
      );
      expect(
        isRemovedAtIndex(
          result.archiving,
          result.archiveRestoredAt,
          'parent',
          finalIndex,
        ),
      ).toBe(true);

      // child: removed from live view (deleted at index 2, never recreated)...
      expect(isRemovedAtIndex(result.all, result.restoredAt, 'child', finalIndex)).toBe(
        true,
      );
      // ...but NOT still counted as "archived": its archive was undone by the
      // restore at index 1, and the later delete (index 2) removed it without
      // re-archiving it, so a flagged recreate-after-delete update must be let
      // through.
      expect(
        isRemovedAtIndex(result.archiving, result.archiveRestoredAt, 'child', finalIndex),
      ).toBe(false);
    });
  });

  it('should strip archived task IDs from project LWW payload arrays', () => {
    spyOn(OpLog, 'warn').and.stub();
    const op = createOperation({
      entityType: 'PROJECT',
      entityId: 'project-1',
      actionType: toLwwUpdateActionType('PROJECT'),
      payload: {
        actionPayload: {
          taskIds: ['keep', 'remove-me', 123],
          backlogTaskIds: ['keep-backlog', 'remove-too'],
          title: 'Project',
        },
        entityChanges: [],
      },
    });

    const result = stripBatchArchivedTaskIdsFromLwwPayload(
      op,
      true,
      new Set(['remove-me', 'remove-too']),
    );

    expect(result).not.toBe(op);
    expect((result.payload as any).actionPayload.taskIds).toEqual(['keep']);
    expect((result.payload as any).actionPayload.backlogTaskIds).toEqual([
      'keep-backlog',
    ]);
    expect((result.payload as any).actionPayload.title).toBe('Project');
  });

  it('should return the original operation if nothing needs filtering', () => {
    const op = createOperation({
      entityType: 'PROJECT',
      entityId: 'project-1',
      actionType: toLwwUpdateActionType('PROJECT'),
      payload: {
        actionPayload: {
          taskIds: ['keep'],
          backlogTaskIds: ['also-keep'],
        },
        entityChanges: [],
      },
    });

    const result = stripBatchArchivedTaskIdsFromLwwPayload(
      op,
      true,
      new Set(['other-id']),
    );

    expect(result).toBe(op);
  });

  it('should return empty sets when the batch has no archive or delete operations', () => {
    const operations: Operation[] = [
      createOperation({
        id: 'op-lww',
        actionType: toLwwUpdateActionType('TASK'),
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { id: 'task-1', title: 'Updated' },
      }),
    ];

    const result = collectTaskRemovalEntityIdsFromBatch(operations, {
      [TASK_FEATURE_NAME]: { entities: { [TASK_ID]: { id: TASK_ID } } },
    });

    expect(result.all).toEqual(new Set<string>());
    expect(result.archiving).toEqual(new Set<string>());
  });

  it('should include state-backed child references for deleteTask even when payload is stale', () => {
    const operations: Operation[] = [
      createOperation({
        actionType: ActionType.TASK_SHARED_DELETE,
        entityType: 'TASK',
        entityId: 'parent',
        payload: {
          actionPayload: {
            task: { id: 'parent', subTaskIds: [] },
          },
          entityChanges: [],
        },
      }),
    ];
    const state = {
      [TASK_FEATURE_NAME]: {
        entities: {
          parent: { id: 'parent', subTaskIds: [] },
          child: { id: 'child', parentId: 'parent' },
        },
      },
    };

    const result = collectTaskRemovalEntityIdsFromBatch(operations, state);

    expect(result.all).toEqual(new Set(['parent', 'child']));
    expect(result.archiving).toEqual(new Set<string>());
  });

  it('should ignore malformed archive payloads with null actionPayload', () => {
    const operations: Operation[] = [
      createOperation({
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        entityType: 'TASK',
        entityId: 'parent',
        payload: {
          actionPayload: null,
          entityChanges: [],
        },
      }),
    ];

    const result = collectTaskRemovalEntityIdsFromBatch(operations, {
      [TASK_FEATURE_NAME]: { entities: {} },
    });

    expect(result.all).toEqual(new Set(['parent']));
    expect(result.archiving).toEqual(new Set(['parent']));
  });

  it('should strip archived task IDs from direct TAG LWW payloads', () => {
    const op = createOperation({
      entityType: 'TAG',
      entityId: 'tag-1',
      actionType: toLwwUpdateActionType('TAG'),
      payload: {
        taskIds: ['keep', 'remove-me', false],
        title: 'Tag',
      },
    });

    const result = stripBatchArchivedTaskIdsFromLwwPayload(
      op,
      true,
      new Set(['remove-me']),
    );

    expect(result).not.toBe(op);
    expect(result.payload).toEqual({
      taskIds: ['keep'],
      title: 'Tag',
    });
  });

  it('should return the operation unchanged when isLww is false', () => {
    const op = createOperation({
      entityType: 'TAG',
      entityId: 'tag-1',
      actionType: toLwwUpdateActionType('TAG'),
      payload: {
        taskIds: ['remove-me'],
      },
    });

    const result = stripBatchArchivedTaskIdsFromLwwPayload(
      op,
      false,
      new Set(['remove-me']),
    );

    expect(result).toBe(op);
  });
});
