/**
 * Integration tests for LWW Update operations and store application.
 *
 * These tests verify that [ENTITY] LWW Update operations, when dispatched
 * through the operation applier service, correctly update the NgRx store
 * via the lwwUpdateMetaReducer.
 *
 * This is a critical integration test for the sync flow fix where:
 * 1. Client A resolves LWW conflict with "local wins"
 * 2. Client A creates and uploads [TASK] LWW Update operation
 * 3. Client B downloads and dispatches the operation
 * 4. lwwUpdateMetaReducer handles the action and updates the store
 * 5. Client B's UI reflects the change WITHOUT needing a reload
 */
import { ActionReducer, Action } from '@ngrx/store';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { ActionType, Operation, OpType, EntityType } from '../../core/operation.types';

describe('LWW Update Store Application Integration', () => {
  // Feature names matching actual NgRx feature names
  const TASKS_FEATURE = 'tasks';
  const PROJECTS_FEATURE = 'projects';
  const TAGS_FEATURE = 'tag'; // Note: singular 'tag', not 'tags'

  interface TaskEntity {
    id: string;
    title: string;
    notes: string;
    done: boolean;
    modified: number;
  }

  interface ProjectEntity {
    id: string;
    title: string;
    taskIds: string[];
    modified: number;
  }

  interface TagEntity {
    id: string;
    title: string;
    color: string;
    taskIds: string[];
    modified: number;
  }

  interface TaskState {
    ids: string[];
    entities: Record<string, TaskEntity>;
  }

  interface ProjectState {
    ids: string[];
    entities: Record<string, ProjectEntity>;
  }

  interface TagState {
    ids: string[];
    entities: Record<string, TagEntity>;
  }

  interface MockRootState {
    [TASKS_FEATURE]: TaskState;
    [PROJECTS_FEATURE]: ProjectState;
    [TAGS_FEATURE]: TagState;
  }

  const createLwwUpdateOperation = (
    entityType: EntityType,
    entityId: string,
    payload: Record<string, unknown>,
  ): Operation => ({
    id: `lww-op-${Date.now()}`,
    actionType: `[${entityType}] LWW Update` as ActionType,
    opType: OpType.Update,
    entityType,
    entityId,
    payload,
    clientId: 'remote-client',
    vectorClock: { remoteClient: 1, localClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const createTaskState = (tasks: Record<string, TaskEntity>): TaskState => ({
    ids: Object.keys(tasks),
    entities: tasks,
  });

  const createProjectState = (projects: Record<string, ProjectEntity>): ProjectState => ({
    ids: Object.keys(projects),
    entities: projects,
  });

  const createTagState = (tags: Record<string, TagEntity>): TagState => ({
    ids: Object.keys(tags),
    entities: tags,
  });

  const createMockRootState = (
    tasks: Record<string, TaskEntity> = {},
    projects: Record<string, ProjectEntity> = {},
    tags: Record<string, TagEntity> = {},
  ): MockRootState => ({
    [TASKS_FEATURE]: createTaskState(tasks),
    [PROJECTS_FEATURE]: createProjectState(projects),
    [TAGS_FEATURE]: createTagState(tags),
  });

  /**
   * Simple passthrough reducer that maintains state
   */
  const passthroughReducer: ActionReducer<MockRootState, Action> = (
    state: MockRootState | undefined,
  ): MockRootState => {
    return state || createMockRootState();
  };

  describe('LWW Update action handling via meta-reducer', () => {
    it('should update task entity when [TASK] LWW Update action is dispatched', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState({
        task1: {
          id: 'task1',
          title: 'Original Title',
          notes: '',
          done: false,
          modified: 1000,
        },
      });

      // Create LWW Update operation (as if received from remote client)
      const op = createLwwUpdateOperation('TASK', 'task1', {
        id: 'task1',
        title: 'LWW Winning Title',
        notes: 'Updated notes from remote',
        done: true,
      });

      // Convert operation to action (this is what the operation applier does)
      const action = convertOpToAction(op);

      // Execute the composed reducer
      const resultState = composedReducer(initialState, action);

      // Verify the task was updated with LWW winning state
      const updatedTask = resultState[TASKS_FEATURE].entities['task1'];
      expect(updatedTask.title).toBe('LWW Winning Title');
      expect(updatedTask.notes).toBe('Updated notes from remote');
      expect(updatedTask.done).toBe(true);
      // Modified should be updated to a new timestamp
      expect(updatedTask.modified).toBeGreaterThan(1000);
    });

    it('should update project entity when [PROJECT] LWW Update action is dispatched', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState(
        {},
        {
          project1: {
            id: 'project1',
            title: 'Original Project',
            taskIds: ['task1', 'task2'],
            modified: 1000,
          },
        },
      );

      const op = createLwwUpdateOperation('PROJECT', 'project1', {
        id: 'project1',
        title: 'LWW Winning Project Title',
        taskIds: ['task1', 'task2', 'task3'],
      });

      const action = convertOpToAction(op);
      const resultState = composedReducer(initialState, action);

      const updatedProject = resultState[PROJECTS_FEATURE].entities['project1'];
      expect(updatedProject.title).toBe('LWW Winning Project Title');
      expect(updatedProject.taskIds).toEqual(['task1', 'task2', 'task3']);
      expect(updatedProject.modified).toBeGreaterThan(1000);
    });

    it('should update tag entity when [TAG] LWW Update action is dispatched', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState(
        {},
        {},
        {
          tag1: {
            id: 'tag1',
            title: 'Original Tag',
            color: '#ff0000',
            taskIds: [],
            modified: 1000,
          },
        },
      );

      const op = createLwwUpdateOperation('TAG', 'tag1', {
        id: 'tag1',
        title: 'LWW Winning Tag',
        color: '#00ff00',
        taskIds: ['task1'],
      });

      const action = convertOpToAction(op);
      const resultState = composedReducer(initialState, action);

      const updatedTag = resultState[TAGS_FEATURE].entities['tag1'];
      expect(updatedTag.title).toBe('LWW Winning Tag');
      expect(updatedTag.color).toBe('#00ff00');
      expect(updatedTag.taskIds).toEqual(['task1']);
      expect(updatedTag.modified).toBeGreaterThan(1000);
    });

    it('should recreate entity when LWW update arrives for deleted entity', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState({
        existingTask: {
          id: 'existingTask',
          title: 'Existing Task',
          notes: '',
          done: false,
          modified: 1000,
        },
      });

      // LWW update arrives for an entity that was deleted locally
      // (This happens when remote update beats local delete via LWW)
      const op = createLwwUpdateOperation('TASK', 'deletedLocallyTask', {
        id: 'deletedLocallyTask',
        title: 'Recreated From LWW',
      });

      spyOn(console, 'log');
      const action = convertOpToAction(op);
      const resultState = composedReducer(initialState, action);

      // Entity should be recreated with the LWW winning state
      expect(resultState[TASKS_FEATURE].entities['deletedLocallyTask']).toBeDefined();
      expect(resultState[TASKS_FEATURE].entities['deletedLocallyTask'].title).toBe(
        'Recreated From LWW',
      );
      // Existing task should remain unchanged
      expect(resultState[TASKS_FEATURE].entities['existingTask'].title).toBe(
        'Existing Task',
      );
      // Should log the recreation
      expect(console.log).toHaveBeenCalled();
    });

    it('should pass through non-LWW Update actions unchanged', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState({
        task1: {
          id: 'task1',
          title: 'Original Title',
          notes: '',
          done: false,
          modified: 1000,
        },
      });

      // Regular update action (not LWW Update)
      const regularAction = {
        type: '[Task Shared] Update Task',
        task: { id: 'task1', changes: { title: 'New Title' } },
        meta: { isPersistent: true, entityType: 'TASK', entityId: 'task1' },
      };

      const resultState = composedReducer(initialState, regularAction);

      // Task should remain unchanged (passthrough reducer doesn't handle this action)
      expect(resultState[TASKS_FEATURE].entities['task1'].title).toBe('Original Title');
    });
  });

  describe('Operation to Action conversion for LWW Update', () => {
    it('should correctly convert LWW Update operation to action', () => {
      const op = createLwwUpdateOperation('TASK', 'task1', {
        id: 'task1',
        title: 'Test Title',
        notes: 'Test Notes',
        done: true,
      });

      const action = convertOpToAction(op);

      expect(action.type).toBe('[TASK] LWW Update');
      expect((action as any).id).toBe('task1');
      expect((action as any).title).toBe('Test Title');
      expect((action as any).notes).toBe('Test Notes');
      expect((action as any).done).toBe(true);
      expect(action.meta.isPersistent).toBe(true);
      expect(action.meta.isRemote).toBe(true);
      expect(action.meta.entityType).toBe('TASK');
      expect(action.meta.entityId).toBe('task1');
    });

    it('should preserve all entity fields in converted action', () => {
      const payload = {
        id: 'task1',
        title: 'Full Title',
        notes: 'Full Notes',
        done: false,
        timeSpent: 3600,
        timeEstimate: 7200,
        tagIds: ['tag1', 'tag2'],
        projectId: 'project1',
        subTaskIds: ['sub1', 'sub2'],
        dueDay: '2024-01-15',
      };

      const op = createLwwUpdateOperation('TASK', 'task1', payload);
      const action = convertOpToAction(op);

      // All fields should be spread onto the action
      Object.entries(payload).forEach(([key, value]) => {
        expect((action as any)[key]).toEqual(value);
      });
    });
  });

  describe('Full sync flow simulation', () => {
    it('should handle complete LWW local-win scenario', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      // Initial state: Task exists on this client
      const initialState = createMockRootState({
        task1: {
          id: 'task1',
          title: 'Client B Title', // B's version (older, will lose)
          notes: 'Client B notes',
          done: false,
          modified: 1000,
        },
      });

      // Simulate receiving Client A's winning LWW Update
      // (A had a newer timestamp, so A creates LWW Update and uploads it)
      const lwwUpdateOp = createLwwUpdateOperation('TASK', 'task1', {
        id: 'task1',
        title: 'Client A Title', // A's version (newer, wins)
        notes: 'Client A notes',
        done: true,
      });

      const action = convertOpToAction(lwwUpdateOp);
      const resultState = composedReducer(initialState, action);

      // Client B should now have Client A's winning state
      const task = resultState[TASKS_FEATURE].entities['task1'];
      expect(task.title).toBe('Client A Title');
      expect(task.notes).toBe('Client A notes');
      expect(task.done).toBe(true);
    });

    it('should handle multiple entities in sequence', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState(
        {
          task1: {
            id: 'task1',
            title: 'Old Task 1',
            notes: '',
            done: false,
            modified: 1000,
          },
          task2: {
            id: 'task2',
            title: 'Old Task 2',
            notes: '',
            done: false,
            modified: 1000,
          },
        },
        {
          project1: {
            id: 'project1',
            title: 'Old Project',
            taskIds: [],
            modified: 1000,
          },
        },
      );

      // Apply multiple LWW Updates in sequence
      let state = initialState;

      const taskOp1 = createLwwUpdateOperation('TASK', 'task1', {
        id: 'task1',
        title: 'New Task 1',
        done: true,
      });
      state = composedReducer(state, convertOpToAction(taskOp1));

      const taskOp2 = createLwwUpdateOperation('TASK', 'task2', {
        id: 'task2',
        title: 'New Task 2',
        notes: 'Added notes',
      });
      state = composedReducer(state, convertOpToAction(taskOp2));

      const projectOp = createLwwUpdateOperation('PROJECT', 'project1', {
        id: 'project1',
        title: 'New Project',
        taskIds: ['task1', 'task2'],
      });
      state = composedReducer(state, convertOpToAction(projectOp));

      // Verify all updates were applied
      expect(state[TASKS_FEATURE].entities['task1'].title).toBe('New Task 1');
      expect(state[TASKS_FEATURE].entities['task1'].done).toBe(true);
      expect(state[TASKS_FEATURE].entities['task2'].title).toBe('New Task 2');
      expect(state[TASKS_FEATURE].entities['task2'].notes).toBe('Added notes');
      expect(state[PROJECTS_FEATURE].entities['project1'].title).toBe('New Project');
      expect(state[PROJECTS_FEATURE].entities['project1'].taskIds).toEqual([
        'task1',
        'task2',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined state', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const op = createLwwUpdateOperation('TASK', 'task1', {
        id: 'task1',
        title: 'Test',
      });
      const action = convertOpToAction(op);

      // Should not throw, just pass through
      const resultState = composedReducer(undefined, action);
      expect(resultState).toBeDefined();
    });

    it('should handle action with missing entity id', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState({
        task1: {
          id: 'task1',
          title: 'Original',
          notes: '',
          done: false,
          modified: 1000,
        },
      });

      // Action without id field
      const action = {
        type: '[TASK] LWW Update',
        title: 'No ID',
        meta: { isPersistent: true, entityType: 'TASK' },
      };

      spyOn(console, 'warn');
      const resultState = composedReducer(initialState, action);

      // State should be unchanged
      expect(resultState[TASKS_FEATURE].entities['task1'].title).toBe('Original');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle unknown entity type gracefully', () => {
      const composedReducer = lwwUpdateMetaReducer(passthroughReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState();

      const action = {
        type: '[UNKNOWN_TYPE] LWW Update',
        id: 'unknown1',
        title: 'Unknown',
        meta: { isPersistent: true, entityType: 'UNKNOWN_TYPE', entityId: 'unknown1' },
      };

      spyOn(console, 'warn');
      const resultState = composedReducer(initialState, action);

      // Should warn and pass through
      expect(console.warn).toHaveBeenCalled();
      expect(resultState).toEqual(initialState);
    });
  });
});
