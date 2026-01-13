import { RootState } from '../../root-state';
import { Task } from '../../../features/tasks/task.model';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Tag } from '../../../features/tag/tag.model';
import { taskAdapter } from '../../../features/tasks/store/task.adapter';

/**
 * Compares two arrays for same elements (order-independent).
 * O(n) using Set instead of O(n log n + serialization) with JSON.stringify + sort.
 */
const arraysHaveSameElements = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
};

/**
 * Validates and fixes data consistency across tasks, projects, and tags
 * Ensures bidirectional consistency: project.taskIds ↔ task.projectId, tag.taskIds ↔ task.tagIds
 */
export const validateAndFixDataConsistencyAfterBatchUpdate = (
  state: RootState,
  projectId: string,
  tasksToAdd: Task[],
  tasksToUpdate: { id: string; changes: Partial<Task> }[],
  taskIdsToDelete: string[],
  newTaskOrder: string[] | null,
): RootState => {
  // eslint-disable-next-line prefer-const
  let newState = { ...state };

  // Get all affected task IDs for validation
  const deletedTaskIds = new Set(taskIdsToDelete);

  // Build current task state after all operations
  const allCurrentTasks = new Map<string, Task>();

  // Add existing tasks that weren't deleted
  Object.values(newState[TASK_FEATURE_NAME].entities).forEach((task) => {
    if (task && !deletedTaskIds.has(task.id)) {
      allCurrentTasks.set(task.id, { ...task });
    }
  });

  // Apply updates to existing tasks
  tasksToUpdate.forEach((update) => {
    const existingTask = allCurrentTasks.get(update.id);
    if (existingTask) {
      allCurrentTasks.set(update.id, { ...existingTask, ...update.changes });
    }
  });

  // Add new tasks
  tasksToAdd.forEach((task) => {
    allCurrentTasks.set(task.id, task);
  });

  // =========================================================================
  // 1. PROJECT CONSISTENCY: Validate project.taskIds ↔ task.projectId
  // =========================================================================

  const project = newState[PROJECT_FEATURE_NAME].entities[projectId];
  if (project) {
    // Get all tasks that should belong to this project
    const projectTaskIds = Array.from(allCurrentTasks.values())
      .filter((task) => task.projectId === projectId && !task.parentId) // Only root tasks
      .map((task) => task.id);

    // Apply reordering if specified
    let finalTaskIds = projectTaskIds;
    if (newTaskOrder) {
      // Start with the specified order
      const orderedIds = newTaskOrder.filter((id) => projectTaskIds.includes(id));
      // Add any missing tasks at the end
      const remainingIds = projectTaskIds.filter((id) => !newTaskOrder.includes(id));
      finalTaskIds = [...orderedIds, ...remainingIds];
    }

    // Update project with validated task list
    newState[PROJECT_FEATURE_NAME] = projectAdapter.updateOne(
      {
        id: projectId,
        changes: { taskIds: finalTaskIds },
      },
      newState[PROJECT_FEATURE_NAME],
    );
  }

  // =========================================================================
  // 2. TAG CONSISTENCY: Validate tag.taskIds ↔ task.tagIds
  // =========================================================================

  // Collect all tags that need updating
  const tagsToUpdate = new Map<string, Set<string>>();

  // Initialize with existing tag task lists
  Object.values(newState[TAG_FEATURE_NAME].entities).forEach((tag) => {
    if (tag) {
      const currentTaskIds = tag.taskIds || [];
      tagsToUpdate.set(
        tag.id,
        new Set(currentTaskIds.filter((id) => !deletedTaskIds.has(id))),
      );
    }
  });

  // Update tag memberships based on task.tagIds
  allCurrentTasks.forEach((task) => {
    if (task.tagIds && task.tagIds.length > 0) {
      task.tagIds.forEach((tagId) => {
        // Ensure tag exists
        if (newState[TAG_FEATURE_NAME].entities[tagId]) {
          if (!tagsToUpdate.has(tagId)) {
            tagsToUpdate.set(tagId, new Set());
          }
          tagsToUpdate.get(tagId)!.add(task.id);
        }
      });
    }
  });

  // Apply tag updates
  const tagUpdates: { id: string; changes: Partial<Tag> }[] = [];
  tagsToUpdate.forEach((taskIds, tagId) => {
    const currentTag = newState[TAG_FEATURE_NAME].entities[tagId];
    if (currentTag) {
      const newTaskIds = Array.from(taskIds);
      const currentTaskIds = currentTag.taskIds || [];

      // Only update if the task list actually changed
      if (!arraysHaveSameElements(currentTaskIds, newTaskIds)) {
        tagUpdates.push({
          id: tagId,
          changes: { taskIds: newTaskIds },
        });
      }
    }
  });

  if (tagUpdates.length > 0) {
    newState[TAG_FEATURE_NAME] = {
      ...newState[TAG_FEATURE_NAME],
      entities: {
        ...newState[TAG_FEATURE_NAME].entities,
      },
    };

    tagUpdates.forEach((update) => {
      newState[TAG_FEATURE_NAME].entities[update.id] = {
        ...newState[TAG_FEATURE_NAME].entities[update.id]!,
        ...update.changes,
      };
    });
  }

  // =========================================================================
  // 3. PARENT-CHILD CONSISTENCY: Validate parent.subTaskIds ↔ child.parentId
  // =========================================================================

  const parentChildUpdates: { id: string; changes: Partial<Task> }[] = [];
  const parentsToUpdate = new Map<string, Set<string>>();

  // Track which parents had explicit subTaskIds updates
  const parentsWithExplicitSubTaskUpdates = new Set<string>();
  const tasksToUnparent: { id: string; changes: Partial<Task> }[] = [];

  tasksToUpdate.forEach((update) => {
    if (update.changes.subTaskIds !== undefined) {
      parentsWithExplicitSubTaskUpdates.add(update.id);

      // If a parent explicitly updates its subTaskIds, any children not in the new list
      // should have their parentId cleared to prevent them from becoming orphans
      const currentParent = allCurrentTasks.get(update.id);
      if (currentParent) {
        const newSubTaskIds = new Set(update.changes.subTaskIds || []);

        // Also check all tasks that claim this as their parent
        allCurrentTasks.forEach((task) => {
          if (task.parentId === update.id && !newSubTaskIds.has(task.id)) {
            tasksToUnparent.push({ id: task.id, changes: { parentId: undefined } });
          }
        });
      }
    }
  });

  // Collect all parent-child relationships
  allCurrentTasks.forEach((task) => {
    if (task.parentId && allCurrentTasks.has(task.parentId)) {
      if (!parentsToUpdate.has(task.parentId)) {
        parentsToUpdate.set(task.parentId, new Set());
      }
      parentsToUpdate.get(task.parentId)!.add(task.id);
    }
  });

  // Update parent tasks with correct subTaskIds
  parentsToUpdate.forEach((subTaskIds, parentId) => {
    // Skip if this parent had an explicit subTaskIds update - trust the operation
    if (parentsWithExplicitSubTaskUpdates.has(parentId)) {
      return;
    }

    const parentTask = allCurrentTasks.get(parentId);
    if (parentTask) {
      const newSubTaskIds = Array.from(subTaskIds);
      const currentSubTaskIds = parentTask.subTaskIds || [];

      // Only update if the subtask list actually changed
      if (!arraysHaveSameElements(currentSubTaskIds, newSubTaskIds)) {
        parentChildUpdates.push({
          id: parentId,
          changes: { subTaskIds: newSubTaskIds },
        });
      }
    }
  });

  // Also check for parents that should have empty subTaskIds but don't
  allCurrentTasks.forEach((task) => {
    // Skip if this parent had an explicit subTaskIds update
    if (parentsWithExplicitSubTaskUpdates.has(task.id)) {
      return;
    }

    if (task.subTaskIds && task.subTaskIds.length > 0 && !parentsToUpdate.has(task.id)) {
      // This parent has subTaskIds but no children point to it
      parentChildUpdates.push({
        id: task.id,
        changes: { subTaskIds: [] },
      });
    }
  });

  // Apply explicit task updates from the batch operation first
  if (tasksToUpdate.length > 0) {
    newState[TASK_FEATURE_NAME] = taskAdapter.updateMany(
      tasksToUpdate,
      newState[TASK_FEATURE_NAME],
    );
  }

  // Apply parent-child updates
  if (parentChildUpdates.length > 0 || tasksToUnparent.length > 0) {
    const allParentChildUpdates = [...parentChildUpdates, ...tasksToUnparent];
    newState[TASK_FEATURE_NAME] = taskAdapter.updateMany(
      allParentChildUpdates,
      newState[TASK_FEATURE_NAME],
    );

    // Update allCurrentTasks to reflect unparented tasks
    tasksToUnparent.forEach((update) => {
      const task = allCurrentTasks.get(update.id);
      if (task) {
        allCurrentTasks.set(update.id, { ...task, parentId: undefined });
      }
    });
  }

  // =========================================================================
  // 4. ORPHAN CLEANUP: Delete orphaned subtasks and clean non-existent references
  // =========================================================================

  // Build parent-child index once for O(1) child lookups
  const childrenByParent = new Map<string, string[]>();
  const orphanedTaskIds: string[] = [];
  const existingTaskIds = new Set(Object.keys(newState[TASK_FEATURE_NAME].entities));

  // Single pass: build index and find orphaned tasks
  Object.values(newState[TASK_FEATURE_NAME].entities).forEach((task) => {
    if (task) {
      if (task.parentId) {
        // Build parent-child index
        let children = childrenByParent.get(task.parentId);
        if (!children) {
          children = [];
          childrenByParent.set(task.parentId, children);
        }
        children.push(task.id);

        // Check for orphaned tasks (parentId points to non-existent parent)
        if (!existingTaskIds.has(task.parentId)) {
          orphanedTaskIds.push(task.id);
        }
      }
    }
  });

  // Collect descendants using indexed lookup (O(n) total instead of O(n²))
  const collectDescendants = (taskId: string, collected: Set<string>): void => {
    const children = childrenByParent.get(taskId);
    if (children) {
      for (const childId of children) {
        if (!collected.has(childId)) {
          collected.add(childId);
          collectDescendants(childId, collected);
        }
      }
    }
  };

  // Collect all tasks to delete (orphans and their descendants)
  const allTasksToDelete = new Set<string>(orphanedTaskIds);
  orphanedTaskIds.forEach((orphanId) => {
    collectDescendants(orphanId, allTasksToDelete);
  });

  // Remove orphaned tasks from the state
  if (allTasksToDelete.size > 0) {
    newState[TASK_FEATURE_NAME] = taskAdapter.removeMany(
      Array.from(allTasksToDelete),
      newState[TASK_FEATURE_NAME],
    );
  }

  // Clean up non-existent task references from tags
  const tagCleanupUpdates: { id: string; changes: Partial<Tag> }[] = [];
  const remainingTaskIds = new Set(Object.keys(newState[TASK_FEATURE_NAME].entities));

  Object.values(newState[TAG_FEATURE_NAME].entities).forEach((tag) => {
    if (tag && tag.taskIds && tag.taskIds.length > 0) {
      const cleanedTaskIds = tag.taskIds.filter((id) => remainingTaskIds.has(id));
      if (cleanedTaskIds.length !== tag.taskIds.length) {
        tagCleanupUpdates.push({
          id: tag.id,
          changes: { taskIds: cleanedTaskIds },
        });
      }
    }
  });

  // Apply tag cleanup updates
  if (tagCleanupUpdates.length > 0) {
    tagCleanupUpdates.forEach((update) => {
      newState[TAG_FEATURE_NAME].entities[update.id] = {
        ...newState[TAG_FEATURE_NAME].entities[update.id]!,
        ...update.changes,
      };
    });
  }

  return newState;
};
