import { Action, ActionReducer } from '@ngrx/store';

import {
  getUndoPayloadForAction,
  undoOperationPayloadMetaReducer,
} from './undo-operation-payload.meta-reducer';
import {
  isTaskUpdateUndoPayload,
  TASK_UPDATE_UNDO_PAYLOAD_TYPE,
  TaskUpdateUndoPayload,
} from './undo-task-update.meta-reducer';
import { TaskSharedActions } from './task-shared.actions';
import { RootState } from '../root-state';
import { DEFAULT_TASK, Task } from '../../features/tasks/task.model';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';

describe('undoOperationPayloadMetaReducer task update payload', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  // =============================================================================
  // TEST HELPERS
  // =============================================================================

  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id: 'task1',
    title: 'Original title',
    projectId: 'project1',
    tagIds: ['tag1'],
    timeEstimate: 1800,
    isDone: false,
    ...overrides,
  });

  const createMockState = (
    overrides: { taskEntities?: Record<string, Task> } = {},
  ): RootState =>
    ({
      [TASK_FEATURE_NAME]: {
        entities: {
          task1: createMockTask(),
          ...overrides.taskEntities,
        },
        ids: ['task1', ...Object.keys(overrides.taskEntities ?? {})],
      },
    }) as unknown as RootState;

  const expectTaskUpdatePayload = (payload: unknown): TaskUpdateUndoPayload => {
    expect(isTaskUpdateUndoPayload(payload)).toBeTrue();
    if (!isTaskUpdateUndoPayload(payload)) {
      throw new Error('Expected task update undo payload');
    }
    return payload;
  };

  const getTaskUpdatePayload = (action: Action): TaskUpdateUndoPayload =>
    expectTaskUpdatePayload(getUndoPayloadForAction(action));

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = undoOperationPayloadMetaReducer(mockReducer);
    baseState = createMockState();
  });

  // =============================================================================
  // UPDATE TASK - STATE CAPTURE TESTS
  // =============================================================================

  describe('updateTask action - state capture', () => {
    it('should capture state and pass through to reducer', () => {
      const action = TaskSharedActions.updateTask({
        task: { id: 'task1', changes: { title: 'Updated title' } },
      });

      const result = metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
      expect(result).toBe(baseState);
    });

    it('should capture previous values for changed fields', () => {
      const action = TaskSharedActions.updateTask({
        task: {
          id: 'task1',
          changes: {
            title: 'Updated title',
            isDone: true,
            timeEstimate: 3600,
          },
        },
      });

      metaReducer(baseState, action);
      const payload = getTaskUpdatePayload(action);

      expect(payload.type).toBe(TASK_UPDATE_UNDO_PAYLOAD_TYPE);
      expect(payload.snapshot.previousValues).toEqual({
        title: { value: 'Original title', wasPresent: true },
        isDone: { value: false, wasPresent: true },
        timeEstimate: { value: 1800, wasPresent: true },
      });
    });

    it('should capture missing previous fields with wasPresent false', () => {
      const action = TaskSharedActions.updateTask({
        task: {
          id: 'task1',
          changes: {
            dueDay: '2026-05-28',
          },
        },
      });

      metaReducer(baseState, action);
      const payload = getTaskUpdatePayload(action);

      expect(payload.snapshot.previousValues).toEqual({
        dueDay: { value: undefined, wasPresent: false },
      });
    });

    it('should ignore modified when capturing previous values', () => {
      const action = TaskSharedActions.updateTask({
        task: {
          id: 'task1',
          changes: {
            title: 'Updated title',
            modified: 123,
          },
        },
      });

      metaReducer(baseState, action);
      const payload = getTaskUpdatePayload(action);

      expect(payload.snapshot.previousValues).toEqual({
        title: { value: 'Original title', wasPresent: true },
      });
    });

    it('should not capture payload when only modified changes', () => {
      const action = TaskSharedActions.updateTask({
        task: {
          id: 'task1',
          changes: {
            modified: 123,
          },
        },
      });

      metaReducer(baseState, action);

      expect(getUndoPayloadForAction(action)).toBeNull();
    });

    it('should not capture payload when task is missing from state', () => {
      const action = TaskSharedActions.updateTask({
        task: { id: 'missing-task', changes: { title: 'Updated title' } },
      });

      metaReducer(baseState, action);

      expect(getUndoPayloadForAction(action)).toBeNull();
    });

    it('should not capture payload for compensating actions', () => {
      const action = TaskSharedActions.updateTask({
        task: { id: 'task1', changes: { title: 'Updated title' } },
      });
      const compensatingAction = {
        ...action,
        meta: {
          ...action.meta,
          isCompensating: true,
        },
      };

      metaReducer(baseState, compensatingAction);

      expect(getUndoPayloadForAction(compensatingAction)).toBeNull();
    });
  });

  describe('isTaskUpdateUndoPayload', () => {
    it('should validate update undo payload shape', () => {
      expect(
        isTaskUpdateUndoPayload({
          type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
          snapshot: {
            previousValues: {
              title: { value: 'Original title', wasPresent: true },
            },
          },
        }),
      ).toBeTrue();
    });

    it('should reject payloads without type discriminator', () => {
      expect(
        isTaskUpdateUndoPayload({
          snapshot: {
            previousValues: {
              title: { value: 'Original title', wasPresent: true },
            },
          },
        }),
      ).toBeFalse();
    });
  });
});
