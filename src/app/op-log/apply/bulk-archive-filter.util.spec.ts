import { ActionType, Operation, OpType } from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import {
  collectTaskRemovalEntityIdsFromBatch,
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
