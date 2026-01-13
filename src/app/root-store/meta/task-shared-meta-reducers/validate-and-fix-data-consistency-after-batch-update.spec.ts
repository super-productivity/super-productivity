import { validateAndFixDataConsistencyAfterBatchUpdate } from './validate-and-fix-data-consistency-after-batch-update';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { DEFAULT_TAG } from '../../../features/tag/tag.const';
import { createBaseState, createMockTask } from './test-utils';

describe('validateAndFixDataConsistencyAfterBatchUpdate', () => {
  let baseState: RootState;

  beforeEach(() => {
    baseState = createBaseState();
  });

  const createMockTag = (overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id: 'mock-tag-id',
    title: 'Mock Tag',
    created: Date.now(),
    taskIds: [],
    ...overrides,
  });

  const createStateWithExistingTasks = (taskIds: string[]): RootState => {
    const state = { ...baseState };
    const entities: { [id: string]: Task } = {};

    taskIds.forEach((id) => {
      entities[id] = createMockTask({
        id,
        title: `Task ${id}`,
        projectId: 'project1',
      });
    });

    state[TASK_FEATURE_NAME] = {
      ...state[TASK_FEATURE_NAME],
      entities,
      ids: taskIds,
    };

    return state;
  };

  describe('parent-child consistency validation', () => {
    it('should maintain parent-child consistency', () => {
      const state = createStateWithExistingTasks([
        'parent1',
        'parent2',
        'child1',
        'child2',
      ]);

      // Set up some inconsistent state
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent1',
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent1',
      };
      // Parent doesn't have correct subTaskIds
      state[TASK_FEATURE_NAME].entities['parent1'] = {
        ...state[TASK_FEATURE_NAME].entities['parent1']!,
        subTaskIds: ['child1'], // Missing child2
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should fix the inconsistency
      const parent1 = result[TASK_FEATURE_NAME].entities['parent1'] as Task;
      expect(parent1.subTaskIds).toContain('child1');
      expect(parent1.subTaskIds).toContain('child2');
    });

    it('should clean up orphaned subTaskIds when children point elsewhere', () => {
      const state = createStateWithExistingTasks([
        'parent1',
        'parent2',
        'child1',
        'child2',
      ]);

      // Set up inconsistent state: parent1 claims to have children, but they point to parent2
      state[TASK_FEATURE_NAME].entities['parent1'] = {
        ...state[TASK_FEATURE_NAME].entities['parent1']!,
        subTaskIds: ['child1', 'child2'], // Claims these children
      };
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent2', // Actually points to parent2
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent2', // Actually points to parent2
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should fix the inconsistency
      const parent1 = result[TASK_FEATURE_NAME].entities['parent1'] as Task;
      const parent2 = result[TASK_FEATURE_NAME].entities['parent2'] as Task;

      expect(parent1.subTaskIds).toEqual([]); // Should be empty now
      expect(parent2.subTaskIds).toContain('child1');
      expect(parent2.subTaskIds).toContain('child2');
    });

    it('should respect explicit subTaskIds updates and not override them', () => {
      const state = createStateWithExistingTasks(['parent1', 'child1', 'child2']);

      // Set up state where children point to parent
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent1',
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent1',
      };

      // Simulate an explicit update to subTaskIds (should be trusted)
      const tasksToUpdate = [
        {
          id: 'parent1',
          changes: { subTaskIds: ['child1'] }, // Explicitly only wants child1
        },
      ];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        tasksToUpdate,
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should respect the explicit update and not add child2
      const parent1 = result[TASK_FEATURE_NAME].entities['parent1'] as Task;
      expect(parent1.subTaskIds).toEqual(['child1']);
      expect(parent1.subTaskIds).not.toContain('child2');

      // child2 should be unparented (become a root task)
      const child2 = result[TASK_FEATURE_NAME].entities['child2'] as Task;
      expect(child2).toBeDefined();
      expect(child2.parentId).toBeUndefined();
    });
  });

  describe('project consistency validation', () => {
    it('should clean up orphaned task references from project', () => {
      const state = createStateWithExistingTasks(['task1']);
      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['task1', 'non-existent-task'], // Contains reference to deleted task
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['task1']);
      expect(project?.taskIds).not.toContain('non-existent-task');
    });

    it('should only include root tasks in project taskIds', () => {
      const state = createStateWithExistingTasks(['parent1', 'child1']);

      // Set up parent-child relationship
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent1',
      };
      state[TASK_FEATURE_NAME].entities['parent1'] = {
        ...state[TASK_FEATURE_NAME].entities['parent1']!,
        subTaskIds: ['child1'],
      };

      // Project incorrectly includes subtask
      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['parent1', 'child1'], // Should not include child1
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['parent1']);
      expect(project?.taskIds).not.toContain('child1');
    });

    it('should apply task reordering when specified', () => {
      const state = createStateWithExistingTasks(['task1', 'task2', 'task3']);

      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['task1', 'task2', 'task3'],
      };

      const newTaskOrder = ['task3', 'task1', 'task2'];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        newTaskOrder,
      );

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['task3', 'task1', 'task2']);
    });

    it('should handle reordering with missing tasks gracefully', () => {
      const state = createStateWithExistingTasks(['task1', 'task2']);

      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['task1', 'task2'],
      };

      // Reorder includes non-existent task
      const newTaskOrder = ['non-existent', 'task2', 'task1'];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        newTaskOrder,
      );

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      // Should ignore non-existent task and preserve existing order for remaining
      expect(project?.taskIds).toEqual(['task2', 'task1']);
    });
  });

  describe('tag consistency validation', () => {
    it('should update tag taskIds based on task tagIds', () => {
      const state = createStateWithExistingTasks(['task1', 'task2']);

      // Set up tasks with tags
      state[TASK_FEATURE_NAME].entities['task1'] = {
        ...state[TASK_FEATURE_NAME].entities['task1']!,
        tagIds: ['tag1', 'tag2'],
      };
      state[TASK_FEATURE_NAME].entities['task2'] = {
        ...state[TASK_FEATURE_NAME].entities['task2']!,
        tagIds: ['tag1'],
      };

      // Set up tags with incorrect taskIds
      state[TAG_FEATURE_NAME].entities = {
        tag1: createMockTag({ id: 'tag1', title: 'Tag 1', taskIds: ['task1'] }), // Missing task2
        tag2: createMockTag({
          id: 'tag2',
          title: 'Tag 2',
          taskIds: ['task1', 'non-existent'],
        }), // Has non-existent task
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      const tag1 = result[TAG_FEATURE_NAME].entities['tag1'];
      const tag2 = result[TAG_FEATURE_NAME].entities['tag2'];

      expect(tag1?.taskIds).toContain('task1');
      expect(tag1?.taskIds).toContain('task2');
      expect(tag2?.taskIds).toEqual(['task1']);
      expect(tag2?.taskIds).not.toContain('non-existent');
    });

    it('should remove deleted tasks from tag taskIds', () => {
      const state = createStateWithExistingTasks(['task1']);

      // Set up tag that references deleted task
      state[TAG_FEATURE_NAME].entities = {
        tag1: createMockTag({
          id: 'tag1',
          title: 'Tag 1',
          taskIds: ['task1', 'deleted-task'],
        }),
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        ['deleted-task'], // taskIdsToDelete
        null, // newTaskOrder
      );

      const tag1 = result[TAG_FEATURE_NAME].entities['tag1'];
      expect(tag1?.taskIds).toEqual(['task1']);
      expect(tag1?.taskIds).not.toContain('deleted-task');
    });

    it('should not update tags if taskIds are already correct', () => {
      const state = createStateWithExistingTasks(['task1', 'task2']);

      // Set up tasks with tags
      state[TASK_FEATURE_NAME].entities['task1'] = {
        ...state[TASK_FEATURE_NAME].entities['task1']!,
        tagIds: ['tag1'],
      };
      state[TASK_FEATURE_NAME].entities['task2'] = {
        ...state[TASK_FEATURE_NAME].entities['task2']!,
        tagIds: ['tag1'],
      };

      // Set up tag with correct taskIds
      const originalTag = createMockTag({
        id: 'tag1',
        title: 'Tag 1',
        taskIds: ['task1', 'task2'],
      });
      state[TAG_FEATURE_NAME].entities = {
        tag1: originalTag,
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should be the same reference since no changes were needed
      expect(result[TAG_FEATURE_NAME].entities['tag1']).toEqual(originalTag);
    });
  });

  describe('orphaned subtasks deletion', () => {
    it('should delete subtasks whose parent task does not exist', () => {
      const state = createStateWithExistingTasks(['orphan1', 'orphan2', 'valid-child']);

      // Set up orphaned subtasks (parent doesn't exist)
      state[TASK_FEATURE_NAME].entities['orphan1'] = {
        ...state[TASK_FEATURE_NAME].entities['orphan1']!,
        parentId: 'non-existent-parent',
      };
      state[TASK_FEATURE_NAME].entities['orphan2'] = {
        ...state[TASK_FEATURE_NAME].entities['orphan2']!,
        parentId: 'deleted-parent',
      };

      // Valid subtask with existing parent
      state[TASK_FEATURE_NAME].entities['valid-parent'] = createMockTask({
        id: 'valid-parent',
        title: 'Valid Parent',
        projectId: 'project1',
        subTaskIds: ['valid-child'],
      });
      state[TASK_FEATURE_NAME].entities['valid-child'] = {
        ...state[TASK_FEATURE_NAME].entities['valid-child']!,
        parentId: 'valid-parent',
      };
      state[TASK_FEATURE_NAME].ids = [
        'orphan1',
        'orphan2',
        'valid-child',
        'valid-parent',
      ];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Orphaned subtasks should be deleted
      expect(result[TASK_FEATURE_NAME].entities['orphan1']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['orphan2']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('orphan1');
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('orphan2');

      // Valid subtask should remain
      expect(result[TASK_FEATURE_NAME].entities['valid-child']).toBeDefined();
      expect(result[TASK_FEATURE_NAME].entities['valid-parent']).toBeDefined();
      expect(result[TASK_FEATURE_NAME].ids).toContain('valid-child');
      expect(result[TASK_FEATURE_NAME].ids).toContain('valid-parent');
    });

    it('should clean up orphaned subtasks from tag references', () => {
      const state = createStateWithExistingTasks(['orphan-with-tag', 'valid-task']);

      // Set up orphaned subtask with tag
      state[TASK_FEATURE_NAME].entities['orphan-with-tag'] = {
        ...state[TASK_FEATURE_NAME].entities['orphan-with-tag']!,
        parentId: 'non-existent-parent',
        tagIds: ['tag1'],
      };

      // Set up tag that references the orphaned subtask
      state[TAG_FEATURE_NAME].entities = {
        tag1: createMockTag({
          id: 'tag1',
          title: 'Tag 1',
          taskIds: ['orphan-with-tag', 'valid-task'],
        }),
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Orphaned subtask should be deleted
      expect(result[TASK_FEATURE_NAME].entities['orphan-with-tag']).toBeUndefined();

      // Tag should no longer reference the orphaned subtask
      const tag1 = result[TAG_FEATURE_NAME].entities['tag1'];
      expect(tag1?.taskIds).not.toContain('orphan-with-tag');
      expect(tag1?.taskIds).toContain('valid-task');
    });

    it('should handle cascading deletion of orphaned subtasks', () => {
      const state = createStateWithExistingTasks(['parent', 'child', 'grandchild']);

      // Set up a hierarchy where middle task will be orphaned
      state[TASK_FEATURE_NAME].entities['child'] = {
        ...state[TASK_FEATURE_NAME].entities['child']!,
        parentId: 'non-existent-parent', // This makes child orphaned
        subTaskIds: ['grandchild'],
      };
      state[TASK_FEATURE_NAME].entities['grandchild'] = {
        ...state[TASK_FEATURE_NAME].entities['grandchild']!,
        parentId: 'child',
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Both orphaned child and its grandchild should be deleted
      expect(result[TASK_FEATURE_NAME].entities['child']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['grandchild']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('child');
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('grandchild');

      // Regular parent should remain
      expect(result[TASK_FEATURE_NAME].entities['parent']).toBeDefined();
    });

    it('should delete child tasks when their parent is deleted in batch operation', () => {
      const state = createStateWithExistingTasks(['parent', 'child1', 'child2']);

      // Set up parent-child relationships
      state[TASK_FEATURE_NAME].entities['parent'] = {
        ...state[TASK_FEATURE_NAME].entities['parent']!,
        subTaskIds: ['child1', 'child2'],
      };
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent',
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent',
      };

      // Delete parent in this batch operation
      // Simulate what the batch update reducer does - remove the parent from state
      const stateAfterDelete = {
        ...state,
        [TASK_FEATURE_NAME]: {
          ...state[TASK_FEATURE_NAME],
          entities: { ...state[TASK_FEATURE_NAME].entities },
          ids: state[TASK_FEATURE_NAME].ids.filter((id) => id !== 'parent'),
        },
      };
      delete stateAfterDelete[TASK_FEATURE_NAME].entities['parent'];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        stateAfterDelete,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        ['parent'], // taskIdsToDelete - deleting parent
        null, // newTaskOrder
      );

      // Children should be deleted too since their parent is being deleted
      expect(result[TASK_FEATURE_NAME].entities['parent']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['child1']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['child2']).toBeUndefined();
    });
  });

  describe('integration with batch operations', () => {
    it('should handle newly added tasks in consistency validation', () => {
      const state = createStateWithExistingTasks(['existing-parent']);

      // Simulate adding new tasks
      const newChild = createMockTask({
        id: 'new-child',
        title: 'New Child',
        projectId: 'project1',
        parentId: 'existing-parent',
      });

      const tasksToAdd = [newChild];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        tasksToAdd,
        [], // tasksToUpdate
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should update parent to include new child
      const parent = result[TASK_FEATURE_NAME].entities['existing-parent'] as Task;
      expect(parent.subTaskIds).toContain('new-child');
    });

    it('should handle updated tasks in consistency validation', () => {
      const state = createStateWithExistingTasks(['parent1', 'parent2', 'child']);

      // Set up initial state
      state[TASK_FEATURE_NAME].entities['child'] = {
        ...state[TASK_FEATURE_NAME].entities['child']!,
        parentId: 'parent1',
      };
      state[TASK_FEATURE_NAME].entities['parent1'] = {
        ...state[TASK_FEATURE_NAME].entities['parent1']!,
        subTaskIds: ['child'],
      };

      // Simulate moving child from parent1 to parent2
      const tasksToUpdate = [
        {
          id: 'child',
          changes: { parentId: 'parent2' },
        },
      ];

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        tasksToUpdate,
        [], // taskIdsToDelete
        null, // newTaskOrder
      );

      const parent1 = result[TASK_FEATURE_NAME].entities['parent1'] as Task;
      const parent2 = result[TASK_FEATURE_NAME].entities['parent2'] as Task;

      expect(parent1.subTaskIds).not.toContain('child');
      expect(parent2.subTaskIds).toContain('child');
    });

    it('should handle deleted tasks and clean up references', () => {
      const state = createStateWithExistingTasks(['parent', 'child1', 'child2']);

      // Set up parent-child relationships
      state[TASK_FEATURE_NAME].entities['parent'] = {
        ...state[TASK_FEATURE_NAME].entities['parent']!,
        subTaskIds: ['child1', 'child2'],
      };
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent',
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent',
      };

      const result = validateAndFixDataConsistencyAfterBatchUpdate(
        state,
        'project1',
        [], // tasksToAdd
        [], // tasksToUpdate
        ['child1'], // taskIdsToDelete
        null, // newTaskOrder
      );

      // Should remove deleted child from parent's subTaskIds
      const parent = result[TASK_FEATURE_NAME].entities['parent'] as Task;
      expect(parent.subTaskIds).not.toContain('child1');
      expect(parent.subTaskIds).toContain('child2');
    });
  });
});
