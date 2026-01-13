import { tagSharedMetaReducer } from './tag-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Action, ActionReducer } from '@ngrx/store';
import {
  createBaseState,
  createMockTag,
  createMockTask,
  createStateWithExistingTasks,
  expectStateUpdate,
} from './test-utils';
import {
  deleteTag,
  deleteTags,
  updateTag,
} from '../../../features/tag/store/tag.actions';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfgState } from '../../../features/task-repeat-cfg/task-repeat-cfg.model';
import { TIME_TRACKING_FEATURE_KEY } from '../../../features/time-tracking/store/time-tracking.reducer';
import { TimeTrackingState } from '../../../features/time-tracking/time-tracking.model';

describe('tagSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = tagSharedMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('removeTagsForAllTasks action', () => {
    it('should remove specified tags from all tasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2'],
        [],
        ['task1', 'task2', 'task3'],
        [],
      );

      // Add another tag to task1 and task3
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['task1', 'task3'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
      ];

      // Update tasks to have multiple tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2'],
        projectId: 'project1',
      });
      testState[TASK_FEATURE_NAME].entities.task3 = createMockTask({
        id: 'task3',
        tagIds: ['tag1', 'tag2'],
        projectId: undefined,
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
              task2: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
              task3: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove multiple tags from all tasks', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      // Add more tags
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
      });
      testState[TAG_FEATURE_NAME].entities.tag3 = createMockTag({
        id: 'tag3',
        title: 'Tag 3',
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
        'tag3',
      ];

      // Update task to have multiple tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2', 'tag3'],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag2', 'tag3'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle removing tags from tasks with no tags', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], [], []);

      // task1 has no tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: [],
        projectId: 'project1',
      });
      // task2 has tag1
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: ['tag1'],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: [],
              }),
              task2: jasmine.objectContaining({
                tagIds: [],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle empty tagIdsToRemove array', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: [],
      });

      // State should remain unchanged
      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should only update tasks that have the tags being removed', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2', 'task3'],
        [],
        ['task1', 'task3'],
        [],
      );

      // task2 doesn't have any tags
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: [],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: [],
              }),
              task2: jasmine.objectContaining({
                tagIds: [], // Should remain empty
              }),
              task3: jasmine.objectContaining({
                tagIds: [],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle removing non-existent tags', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['non-existent-tag'],
      });

      // Task should keep its existing tags
      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle tasks with null or undefined tagIds', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], [], []);

      // task1 has null tagIds
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: null as any,
        projectId: 'project1',
      });
      // task2 has undefined tagIds
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: undefined as any,
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      // Should not crash and tasks should remain unchanged
      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalled();
    });
  });

  describe('other actions', () => {
    it('should pass through other actions to the reducer', () => {
      const action = { type: 'SOME_OTHER_ACTION' };
      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });

  describe('updateTag action handling', () => {
    // Note: The reducer no longer filters taskIds - it just logs a warning.
    // This is intentional: DependencyResolverService ensures proper ordering,
    // and the UI handles missing task references gracefully.
    // Filtering was causing data loss during sync when tasks arrived after tags.

    it('should pass through updateTag with non-existent taskIds unchanged', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task-1', 'existing-task-2'],
        [],
        [],
        [],
      );

      // Add Today tag to state
      testState[TAG_FEATURE_NAME].entities[TODAY_TAG.id] = createMockTag({
        id: TODAY_TAG.id,
        title: 'Today',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push(TODAY_TAG.id);

      // Update Tag with taskIds that include non-existent ones
      const action = updateTag({
        tag: {
          id: TODAY_TAG.id,
          changes: {
            taskIds: ['existing-task-1', 'non-existent-task', 'existing-task-2'],
          },
        },
      });

      metaReducer(testState, action);

      // The action should be passed through unchanged (no filtering)
      expect(mockReducer).toHaveBeenCalled();
      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.tag.changes.taskIds).toEqual([
        'existing-task-1',
        'non-existent-task',
        'existing-task-2',
      ]);
    });

    it('should pass through updateTag when all taskIds exist', () => {
      const testState = createStateWithExistingTasks(
        ['task-1', 'task-2', 'task-3'],
        [],
        [],
        [],
      );

      testState[TAG_FEATURE_NAME].entities[TODAY_TAG.id] = createMockTag({
        id: TODAY_TAG.id,
        title: 'Today',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push(TODAY_TAG.id);

      const action = updateTag({
        tag: {
          id: TODAY_TAG.id,
          changes: {
            taskIds: ['task-1', 'task-2', 'task-3'],
          },
        },
      });

      metaReducer(testState, action);

      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.tag.changes.taskIds).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should pass through updateTag when no taskIds in changes', () => {
      const testState = createBaseState();

      testState[TAG_FEATURE_NAME].entities['tag-1'] = createMockTag({
        id: 'tag-1',
        title: 'My Tag',
        taskIds: ['task-1'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag-1');

      // Update tag without taskIds
      const action = updateTag({
        tag: {
          id: 'tag-1',
          changes: {
            title: 'Updated Title',
          },
        },
      });

      metaReducer(testState, action);

      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.tag.changes.title).toBe('Updated Title');
      expect(passedAction.tag.changes.taskIds).toBeUndefined();
    });

    it('should pass through updateTag with all non-existent taskIds unchanged', () => {
      const testState = createBaseState();

      testState[TAG_FEATURE_NAME].entities[TODAY_TAG.id] = createMockTag({
        id: TODAY_TAG.id,
        title: 'Today',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push(TODAY_TAG.id);

      const action = updateTag({
        tag: {
          id: TODAY_TAG.id,
          changes: {
            taskIds: ['non-existent-1', 'non-existent-2', 'non-existent-3'],
          },
        },
      });

      metaReducer(testState, action);

      // Action should be passed through unchanged
      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.tag.changes.taskIds).toEqual([
        'non-existent-1',
        'non-existent-2',
        'non-existent-3',
      ]);
    });

    it('should preserve all changes when passing through action', () => {
      const testState = createStateWithExistingTasks(['existing-task'], [], [], []);

      testState[TAG_FEATURE_NAME].entities['my-tag'] = createMockTag({
        id: 'my-tag',
        title: 'Old Title',
        taskIds: [],
        color: '#000000',
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('my-tag');

      const action = updateTag({
        tag: {
          id: 'my-tag',
          changes: {
            title: 'New Title',
            color: '#ff0000',
            taskIds: ['existing-task', 'non-existent-task'],
          },
        },
      });

      metaReducer(testState, action);

      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.tag.changes.title).toBe('New Title');
      expect(passedAction.tag.changes.color).toBe('#ff0000');
      // All taskIds are preserved (no filtering)
      expect(passedAction.tag.changes.taskIds).toEqual([
        'existing-task',
        'non-existent-task',
      ]);
    });

    it('should preserve meta property on action', () => {
      const testState = createStateWithExistingTasks(['existing-task'], [], [], []);

      testState[TAG_FEATURE_NAME].entities[TODAY_TAG.id] = createMockTag({
        id: TODAY_TAG.id,
        title: 'Today',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push(TODAY_TAG.id);

      const action = updateTag({
        tag: {
          id: TODAY_TAG.id,
          changes: {
            taskIds: ['existing-task', 'non-existent-task'],
          },
        },
      });

      metaReducer(testState, action);

      const passedAction = mockReducer.calls.mostRecent().args[1];
      expect(passedAction.meta).toBeDefined();
      expect(passedAction.meta.isPersistent).toBe(true);
      expect(passedAction.meta.entityType).toBe('TAG');
      expect(passedAction.meta.entityId).toBe(TODAY_TAG.id);
    });
  });

  // =============================================================================
  // DELETE TAG TESTS
  // =============================================================================

  describe('deleteTag action', () => {
    it('should remove tag reference from tasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2'],
        [],
        ['task1', 'task2'],
        [],
      );

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      expect(passedState[TASK_FEATURE_NAME].entities.task1.tagIds).toEqual([]);
      expect(passedState[TASK_FEATURE_NAME].entities.task2.tagIds).toEqual([]);
    });

    it('should delete orphaned tasks (no project, no tags, no parent)', () => {
      const testState = createBaseState();

      // Create orphan task - only has this tag, no project
      testState[TASK_FEATURE_NAME].entities.orphanTask = createMockTask({
        id: 'orphanTask',
        tagIds: ['tag1'],
        projectId: undefined,
        parentId: undefined,
      });
      testState[TASK_FEATURE_NAME].ids = ['orphanTask'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['orphanTask'],
      };

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      expect(passedState[TASK_FEATURE_NAME].entities.orphanTask).toBeUndefined();
      expect(passedState[TASK_FEATURE_NAME].ids).not.toContain('orphanTask');
    });

    it('should keep tasks that have a project', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Task should still exist (has project)
      expect(passedState[TASK_FEATURE_NAME].entities.task1).toBeDefined();
      // But tag should be removed
      expect(passedState[TASK_FEATURE_NAME].entities.task1.tagIds).toEqual([]);
    });

    it('should keep tasks that have other tags', () => {
      const testState = createBaseState();

      // Add second tag
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['task1'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      // Create task with both tags, no project
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2'],
        projectId: undefined,
      });
      testState[TASK_FEATURE_NAME].ids = ['task1'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['task1'],
      };

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Task should still exist (has other tag)
      expect(passedState[TASK_FEATURE_NAME].entities.task1).toBeDefined();
      expect(passedState[TASK_FEATURE_NAME].entities.task1.tagIds).toEqual(['tag2']);
    });

    it('should keep subtasks that have a parent', () => {
      const testState = createBaseState();

      // Create parent task with tag and project
      testState[TASK_FEATURE_NAME].entities.parentTask = createMockTask({
        id: 'parentTask',
        tagIds: ['tag1'],
        projectId: 'project1',
        subTaskIds: ['subtask1'],
      });
      // Create subtask with only this tag (no project)
      testState[TASK_FEATURE_NAME].entities.subtask1 = createMockTask({
        id: 'subtask1',
        tagIds: ['tag1'],
        projectId: undefined,
        parentId: 'parentTask',
      });
      testState[TASK_FEATURE_NAME].ids = ['parentTask', 'subtask1'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['parentTask', 'subtask1'],
      };

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Subtask should still exist (has parent)
      expect(passedState[TASK_FEATURE_NAME].entities.subtask1).toBeDefined();
      expect(passedState[TASK_FEATURE_NAME].entities.subtask1.tagIds).toEqual([]);
    });

    it('should cascade delete subtasks of orphaned parent', () => {
      const testState = createBaseState();

      // Create orphan parent (only has this tag)
      testState[TASK_FEATURE_NAME].entities.orphanParent = createMockTask({
        id: 'orphanParent',
        tagIds: ['tag1'],
        projectId: undefined,
        parentId: undefined,
        subTaskIds: ['sub1', 'sub2'],
      });
      testState[TASK_FEATURE_NAME].entities.sub1 = createMockTask({
        id: 'sub1',
        tagIds: [],
        projectId: undefined,
        parentId: 'orphanParent',
      });
      testState[TASK_FEATURE_NAME].entities.sub2 = createMockTask({
        id: 'sub2',
        tagIds: [],
        projectId: undefined,
        parentId: 'orphanParent',
      });
      testState[TASK_FEATURE_NAME].ids = ['orphanParent', 'sub1', 'sub2'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['orphanParent'],
      };

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Parent and all subtasks should be deleted
      expect(passedState[TASK_FEATURE_NAME].entities.orphanParent).toBeUndefined();
      expect(passedState[TASK_FEATURE_NAME].entities.sub1).toBeUndefined();
      expect(passedState[TASK_FEATURE_NAME].entities.sub2).toBeUndefined();
    });

    it('should cleanup task repeat configs that reference the deleted tag', () => {
      const testState = createBaseState() as any;

      // Add task repeat config state with a config that references the tag
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: ['cfg1', 'cfg2'],
        entities: {
          cfg1: {
            id: 'cfg1',
            tagIds: ['tag1'],
            projectId: null,
          },
          cfg2: {
            id: 'cfg2',
            tagIds: ['tag1', 'tag2'],
            projectId: 'project1',
          },
        },
      } as unknown as TaskRepeatCfgState;

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // cfg1 should be deleted (orphaned - no tags and no project left)
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg1).toBeUndefined();
      // cfg2 should have tag1 removed but still exist (has project)
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg2).toBeDefined();
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg2.tagIds).toEqual([
        'tag2',
      ]);
    });

    it('should cleanup time tracking state for deleted tag', () => {
      const testState = createBaseState() as any;

      // Add time tracking state
      testState[TIME_TRACKING_FEATURE_KEY] = {
        tag: {
          tag1: { timeSpent: 3600 },
          tag2: { timeSpent: 7200 },
        },
        project: {},
      } as TimeTrackingState;

      const action = deleteTag({ id: 'tag1' });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      expect(passedState[TIME_TRACKING_FEATURE_KEY].tag.tag1).toBeUndefined();
      expect(passedState[TIME_TRACKING_FEATURE_KEY].tag.tag2).toBeDefined();
    });

    it('should handle deleting non-existent tag gracefully', () => {
      const testState = createBaseState();

      const action = deleteTag({ id: 'non-existent-tag' });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();
    });

    it('should handle tasks with no tagIds property', () => {
      const testState = createBaseState();

      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: undefined as any,
        projectId: 'project1',
      });
      testState[TASK_FEATURE_NAME].ids = ['task1'];

      const action = deleteTag({ id: 'tag1' });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();
    });
  });

  // =============================================================================
  // DELETE TAGS (MULTIPLE) TESTS
  // =============================================================================

  describe('deleteTags action', () => {
    it('should remove multiple tags from tasks', () => {
      const testState = createBaseState();

      // Add second tag
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['task1'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      // Create task with both tags and project
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2'],
        projectId: 'project1',
      });
      testState[TASK_FEATURE_NAME].ids = ['task1'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['task1'],
      };

      const action = deleteTags({ ids: ['tag1', 'tag2'] });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Task should exist (has project) but have no tags
      expect(passedState[TASK_FEATURE_NAME].entities.task1).toBeDefined();
      expect(passedState[TASK_FEATURE_NAME].entities.task1.tagIds).toEqual([]);
    });

    it('should delete tasks orphaned by removing all their tags', () => {
      const testState = createBaseState();

      // Add second tag
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['task1'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      // Create orphan task (no project, only these tags)
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2'],
        projectId: undefined,
        parentId: undefined,
      });
      testState[TASK_FEATURE_NAME].ids = ['task1'];
      testState[TAG_FEATURE_NAME].entities.tag1 = {
        ...testState[TAG_FEATURE_NAME].entities.tag1!,
        taskIds: ['task1'],
      };

      const action = deleteTags({ ids: ['tag1', 'tag2'] });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // Task should be deleted (orphaned)
      expect(passedState[TASK_FEATURE_NAME].entities.task1).toBeUndefined();
    });

    it('should handle empty ids array', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = deleteTags({ ids: [] });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // State should be unchanged
      expect(passedState[TASK_FEATURE_NAME].entities.task1.tagIds).toEqual(['tag1']);
    });

    it('should cleanup multiple task repeat configs atomically', () => {
      const testState = createBaseState() as any;

      // Add second tag
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      // Add task repeat configs
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: ['cfg1', 'cfg2', 'cfg3'],
        entities: {
          cfg1: { id: 'cfg1', tagIds: ['tag1'], projectId: null },
          cfg2: { id: 'cfg2', tagIds: ['tag2'], projectId: null },
          cfg3: { id: 'cfg3', tagIds: ['tag1', 'tag2', 'tag3'], projectId: null },
        },
      } as unknown as TaskRepeatCfgState;

      const action = deleteTags({ ids: ['tag1', 'tag2'] });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      // cfg1 and cfg2 should be deleted (orphaned)
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg1).toBeUndefined();
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg2).toBeUndefined();
      // cfg3 should still exist with only tag3
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg3).toBeDefined();
      expect(passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities.cfg3.tagIds).toEqual([
        'tag3',
      ]);
    });

    it('should cleanup time tracking for all deleted tags', () => {
      const testState = createBaseState() as any;

      testState[TIME_TRACKING_FEATURE_KEY] = {
        tag: {
          tag1: { timeSpent: 3600 },
          tag2: { timeSpent: 7200 },
          tag3: { timeSpent: 1800 },
        },
        project: {},
      } as TimeTrackingState;

      const action = deleteTags({ ids: ['tag1', 'tag2'] });
      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      expect(passedState[TIME_TRACKING_FEATURE_KEY].tag.tag1).toBeUndefined();
      expect(passedState[TIME_TRACKING_FEATURE_KEY].tag.tag2).toBeUndefined();
      expect(passedState[TIME_TRACKING_FEATURE_KEY].tag.tag3).toBeDefined();
    });
  });

  // =============================================================================
  // PERFORMANCE REGRESSION TESTS - Large Dataset Behavior Verification
  // =============================================================================

  describe('large dataset handling (performance regression tests)', () => {
    it('should correctly remove many tags from many tasks', () => {
      const testState = createBaseState();

      // Create 100 tags to remove
      const tagIdsToRemove: string[] = [];
      for (let i = 0; i < 100; i++) {
        const tagId = `tag-to-remove-${i}`;
        tagIdsToRemove.push(tagId);
        testState[TAG_FEATURE_NAME].entities[tagId] = createMockTag({
          id: tagId,
          title: `Tag ${i}`,
          taskIds: [],
        });
        (testState[TAG_FEATURE_NAME].ids as string[]).push(tagId);
      }

      // Create a tag that should NOT be removed
      testState[TAG_FEATURE_NAME].entities['keeper-tag'] = createMockTag({
        id: 'keeper-tag',
        title: 'Keeper Tag',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('keeper-tag');

      // Create 200 tasks, each with 10 tags from the removal list + the keeper tag
      const taskIds: string[] = [];
      for (let i = 0; i < 200; i++) {
        const taskId = `task-${i}`;
        taskIds.push(taskId);
        // Assign 10 tags from the removal list to each task
        const taskTagIds = tagIdsToRemove.slice(i % 90, (i % 90) + 10);
        taskTagIds.push('keeper-tag'); // Also has the keeper tag
        testState[TASK_FEATURE_NAME].entities[taskId] = createMockTask({
          id: taskId,
          tagIds: taskTagIds,
          projectId: 'project1', // Has project so won't be orphaned
        });
      }
      testState[TASK_FEATURE_NAME].ids = taskIds;

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove,
      });

      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];

      // Verify all tasks now only have the keeper tag
      for (let i = 0; i < 200; i++) {
        const task = passedState[TASK_FEATURE_NAME].entities[`task-${i}`];
        expect(task).toBeDefined();
        expect(task.tagIds).toEqual(['keeper-tag']);
      }
    });

    it('should correctly handle deleting tags from many tasks with orphan detection', () => {
      const testState = createBaseState();

      // Create 50 tags
      const allTagIds: string[] = ['tag1']; // tag1 already exists
      for (let i = 2; i <= 50; i++) {
        const tagId = `tag${i}`;
        allTagIds.push(tagId);
        testState[TAG_FEATURE_NAME].entities[tagId] = createMockTag({
          id: tagId,
          title: `Tag ${i}`,
          taskIds: [],
        });
        (testState[TAG_FEATURE_NAME].ids as string[]).push(tagId);
      }

      // Create tasks - half with projects, half orphans
      const taskIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const taskId = `task-${i}`;
        taskIds.push(taskId);
        const hasProject = i < 50;
        // Assign multiple tags from the list
        const taskTagIds = allTagIds.slice(0, Math.min(10, allTagIds.length));
        testState[TASK_FEATURE_NAME].entities[taskId] = createMockTask({
          id: taskId,
          tagIds: [...taskTagIds],
          projectId: hasProject ? 'project1' : undefined,
          parentId: undefined,
        });
      }
      testState[TASK_FEATURE_NAME].ids = taskIds;

      // Delete tags 1-10 (all tags that tasks have)
      const tagsToDelete = allTagIds.slice(0, 10);
      const action = deleteTags({ ids: tagsToDelete });

      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];

      // Tasks 0-49 (with project) should still exist but with no tags
      for (let i = 0; i < 50; i++) {
        const task = passedState[TASK_FEATURE_NAME].entities[`task-${i}`];
        expect(task).toBeDefined();
        expect(task.tagIds).toEqual([]);
      }

      // Tasks 50-99 (no project, no remaining tags) should be deleted
      for (let i = 50; i < 100; i++) {
        const task = passedState[TASK_FEATURE_NAME].entities[`task-${i}`];
        expect(task).toBeUndefined();
      }
    });

    it('should correctly cleanup many task repeat configs when tags are deleted', () => {
      const testState = createBaseState() as any;

      // Create 20 tags
      const allTagIds: string[] = ['tag1'];
      for (let i = 2; i <= 20; i++) {
        const tagId = `tag${i}`;
        allTagIds.push(tagId);
        testState[TAG_FEATURE_NAME].entities[tagId] = createMockTag({
          id: tagId,
          title: `Tag ${i}`,
          taskIds: [],
        });
        (testState[TAG_FEATURE_NAME].ids as string[]).push(tagId);
      }

      // Create 50 task repeat configs with various tag combinations
      const cfgIds: string[] = [];
      const cfgEntities: Record<string, any> = {};
      for (let i = 0; i < 50; i++) {
        const cfgId = `cfg-${i}`;
        cfgIds.push(cfgId);

        // Some configs have projects, some don't
        // Some have multiple tags, some have just the tags we'll delete
        const hasProject = i < 10;
        const hasMultipleTags = i >= 10 && i < 30;

        let cfgTagIds: string[];
        if (hasMultipleTags) {
          // Has tags we'll delete AND tags we won't
          cfgTagIds = ['tag1', 'tag2', 'tag15', 'tag16'];
        } else {
          // Only has tags we'll delete
          cfgTagIds = ['tag1', 'tag2'];
        }

        cfgEntities[cfgId] = {
          id: cfgId,
          tagIds: cfgTagIds,
          projectId: hasProject ? 'project1' : null,
        };
      }

      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: cfgIds,
        entities: cfgEntities,
      } as unknown as TaskRepeatCfgState;

      // Delete tags 1-10
      const tagsToDelete = allTagIds.slice(0, 10);
      const action = deleteTags({ ids: tagsToDelete });

      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];

      // Configs 0-9 (with project) should still exist with remaining tags
      for (let i = 0; i < 10; i++) {
        const cfg = passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities[`cfg-${i}`];
        expect(cfg).toBeDefined();
        // tag1 and tag2 removed, should have empty tagIds
        expect(cfg.tagIds).toEqual([]);
      }

      // Configs 10-29 (no project but multiple tags including non-deleted ones) should exist
      for (let i = 10; i < 30; i++) {
        const cfg = passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities[`cfg-${i}`];
        expect(cfg).toBeDefined();
        // tag1 and tag2 removed, tag15 and tag16 should remain
        expect(cfg.tagIds).toEqual(['tag15', 'tag16']);
      }

      // Configs 30-49 (no project, only deleted tags) should be deleted
      for (let i = 30; i < 50; i++) {
        const cfg = passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities[`cfg-${i}`];
        expect(cfg).toBeUndefined();
      }
    });

    it('should handle removing a single tag from tasks with many tags efficiently', () => {
      const testState = createBaseState();

      // Create 50 tags
      const allTagIds: string[] = ['tag1'];
      for (let i = 2; i <= 50; i++) {
        const tagId = `tag${i}`;
        allTagIds.push(tagId);
        testState[TAG_FEATURE_NAME].entities[tagId] = createMockTag({
          id: tagId,
          title: `Tag ${i}`,
          taskIds: [],
        });
        (testState[TAG_FEATURE_NAME].ids as string[]).push(tagId);
      }

      // Create a task with ALL 50 tags
      testState[TASK_FEATURE_NAME].entities['mega-task'] = createMockTask({
        id: 'mega-task',
        tagIds: [...allTagIds],
        projectId: 'project1',
      });
      testState[TASK_FEATURE_NAME].ids = ['mega-task'];

      // Remove just tag1
      const action = deleteTag({ id: 'tag1' });

      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      const task = passedState[TASK_FEATURE_NAME].entities['mega-task'];

      expect(task).toBeDefined();
      expect(task.tagIds.length).toBe(49);
      expect(task.tagIds).not.toContain('tag1');
      expect(task.tagIds).toContain('tag2');
      expect(task.tagIds).toContain('tag50');
    });
  });
});
