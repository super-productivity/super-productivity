import { ActionType, Operation } from '../../op-log/core/operation.types';
import { UndoRedoActions } from './undo-redo.actions';
import { undoRedoReducer } from './undo-redo.reducer';
import { UndoRedoState, initialUndoRedoState } from './undo-redo.state';
import { loadAllData } from '../meta/load-all-data.action';

const createOp = (overrides: Partial<Operation> = {}): Operation =>
  ({
    id: 'op-1',
    actionType: ActionType.TASK_SHARED_ADD,
    opType: 'CRT' as any,
    payload: {
      actionPayload: {},
      entityChanges: [],
    },
    clientId: 'client-1',
    timestamp: 1,
    vectorClock: {},
    entityType: 'TASK' as any,
    entityId: 'task-1',
    schemaVersion: 1,
    ...overrides,
  }) as Operation;

describe('undoRedoReducer', () => {
  it('should coalesce initial subtask update into previous create payload', () => {
    const addSubOp = createOp({
      id: 'op-add-sub',
      actionType: ActionType.TASK_ADD_SUB,
      entityId: 'sub-1',
      payload: {
        actionPayload: {
          parentId: 'parent-1',
          task: {
            id: 'sub-1',
            title: '',
            isDone: false,
          },
        },
        entityChanges: [],
      },
    });

    const updateOp = createOp({
      id: 'op-update-sub',
      actionType: ActionType.TASK_SHARED_UPDATE,
      entityId: 'sub-1',
      payload: {
        actionPayload: {
          task: {
            id: 'sub-1',
            changes: {
              title: 'My subtask',
              isDone: true,
            },
          },
        },
        entityChanges: [],
      },
    });

    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [addSubOp],
    };

    const result = undoRedoReducer(
      state,
      UndoRedoActions.addToUndoStack({ operation: updateOp }),
    );

    expect(result.undoStack.length).toBe(1);
    expect(result.undoStack[0].id).toBe('op-add-sub');

    const mergedPayload = result.undoStack[0].payload as {
      actionPayload: { task: { title: string; isDone: boolean } };
    };

    expect(mergedPayload.actionPayload.task.title).toBe('My subtask');
    expect(mergedPayload.actionPayload.task.isDone).toBeTrue();
  });

  it('should clear stale restore when coalescing initial subtask update', () => {
    const addSubOp = createOp({
      id: 'op-add-sub',
      actionType: ActionType.TASK_ADD_SUB,
      entityId: 'sub-1',
    });
    const updateOp = createOp({
      id: 'op-update-sub',
      actionType: ActionType.TASK_SHARED_UPDATE,
      entityId: 'sub-1',
    });
    const lastUndone = createOp({ id: 'op-last-undone' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [addSubOp],
      lastUndoneOperation: lastUndone,
      undoPayloadByOperationId: {
        [lastUndone.id]: { snapshot: { previousValues: {} } },
      },
    };

    const result = undoRedoReducer(
      state,
      UndoRedoActions.addToUndoStack({ operation: updateOp }),
    );

    expect(result.lastUndoneOperation).toBeNull();
    expect(result.undoPayloadByOperationId[lastUndone.id]).toBeUndefined();
  });

  it('should not coalesce update when entity differs', () => {
    const addSubOp = createOp({
      id: 'op-add-sub',
      actionType: ActionType.TASK_ADD_SUB,
      entityId: 'sub-1',
    });

    const otherUpdateOp = createOp({
      id: 'op-update-other',
      actionType: ActionType.TASK_SHARED_UPDATE,
      entityId: 'other-sub',
    });

    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [addSubOp],
      lastUndoneOperation: createOp({ id: 'last-undone' }),
    };

    const result = undoRedoReducer(
      state,
      UndoRedoActions.addToUndoStack({ operation: otherUpdateOp }),
    );

    expect(result.undoStack.length).toBe(2);
    expect(result.undoStack[0].id).toBe('op-update-other');
    expect(result.undoStack[1].id).toBe('op-add-sub');
    expect(result.lastUndoneOperation).toBeNull();
  });

  it('should move operation from undoStack to lastUndoneOperation on undo', () => {
    const op = createOp({ id: 'op-undo-me' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [op],
    };

    const result = undoRedoReducer(state, UndoRedoActions.undo());

    expect(result.undoStack.length).toBe(0);
    expect(result.lastUndoneOperation?.id).toBe('op-undo-me');
  });

  it('should keep undo payloads keyed by operation id', () => {
    const op = createOp({ id: 'op-with-payload' });
    const undoPayload = { snapshot: { previousValues: {} } };

    const result = undoRedoReducer(
      initialUndoRedoState,
      UndoRedoActions.addToUndoStack({ operation: op, undoPayload }),
    );

    expect(result.undoStack[0]).toBe(op);
    expect(result.undoPayloadByOperationId['op-with-payload']).toBe(undoPayload);
  });

  it('should keep undo payload when operation is undone for snackbar restore', () => {
    const op = createOp({ id: 'op-undo-me' });
    const undoPayload = { snapshot: { previousValues: {} } };
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [op],
      undoPayloadByOperationId: {
        [op.id]: undoPayload,
      },
    };

    const result = undoRedoReducer(state, UndoRedoActions.undo());

    expect(result.undoPayloadByOperationId[op.id]).toBe(undoPayload);
  });

  it('should remove last undone payload when a new operation invalidates restore', () => {
    const lastUndone = createOp({ id: 'op-last-undone' });
    const nextOp = createOp({ id: 'op-next' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      lastUndoneOperation: lastUndone,
      undoPayloadByOperationId: {
        [lastUndone.id]: { snapshot: { previousValues: {} } },
      },
    };

    const result = undoRedoReducer(
      state,
      UndoRedoActions.addToUndoStack({ operation: nextOp }),
    );

    expect(result.lastUndoneOperation).toBeNull();
    expect(result.undoPayloadByOperationId[lastUndone.id]).toBeUndefined();
  });

  it('should restore lastUndoneOperation to undoStack once', () => {
    const op = createOp({ id: 'op-restore-me' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [],
      lastUndoneOperation: op,
    };

    const result = undoRedoReducer(state, UndoRedoActions.restoreLastUndoneOperation());

    expect(result.undoStack.length).toBe(1);
    expect(result.undoStack[0].id).toBe('op-restore-me');
    expect(result.lastUndoneOperation).toBeNull();
  });

  it('should clear lastUndoneOperation without adding it back to undoStack', () => {
    const op = createOp({ id: 'op-clear-me' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [],
      lastUndoneOperation: op,
      undoPayloadByOperationId: {
        [op.id]: { snapshot: { previousValues: {} } },
      },
    };

    const result = undoRedoReducer(state, UndoRedoActions.clearLastUndoneOperation());

    expect(result.undoStack.length).toBe(0);
    expect(result.lastUndoneOperation).toBeNull();
    expect(result.undoPayloadByOperationId[op.id]).toBeUndefined();
  });

  it('should reset undo state on full data import', () => {
    const op = createOp({ id: 'op-existing' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [op],
      lastUndoneOperation: createOp({ id: 'op-last-undone' }),
      undoPayloadByOperationId: {
        [op.id]: { snapshot: { previousValues: {} } },
      },
    };

    const result = undoRedoReducer(state, loadAllData({ appDataComplete: {} as any }));

    expect(result.undoStack).toEqual([]);
    expect(result.lastUndoneOperation).toBeNull();
    expect(result.undoPayloadByOperationId).toEqual({});
  });
});
