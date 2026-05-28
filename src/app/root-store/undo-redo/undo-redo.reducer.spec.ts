import { ActionType, Operation } from '../../op-log/core/operation.types';
import { UndoRedoActions } from './undo-redo.actions';
import { undoRedoReducer } from './undo-redo.reducer';
import { UndoRedoState, initialUndoRedoState } from './undo-redo.state';

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
      redoStack: [],
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
      redoStack: [],
    };

    const result = undoRedoReducer(
      state,
      UndoRedoActions.addToUndoStack({ operation: otherUpdateOp }),
    );

    expect(result.undoStack.length).toBe(2);
    expect(result.undoStack[0].id).toBe('op-update-other');
    expect(result.undoStack[1].id).toBe('op-add-sub');
  });

  it('should move operation from undoStack to redoStack on undo', () => {
    const op = createOp({ id: 'op-undo-me' });
    const state: UndoRedoState = {
      ...initialUndoRedoState,
      undoStack: [op],
      redoStack: [],
    };

    const result = undoRedoReducer(state, UndoRedoActions.undo());

    expect(result.undoStack.length).toBe(0);
    expect(result.redoStack.length).toBe(1);
    expect(result.redoStack[0].id).toBe('op-undo-me');
  });
});
