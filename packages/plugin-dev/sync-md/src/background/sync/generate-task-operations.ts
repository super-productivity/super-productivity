import {
  BatchOperation,
  BatchTaskCreate,
  BatchTaskDelete,
  BatchTaskReorder,
  BatchTaskUpdate,
  Task,
} from '@super-productivity/plugin-api';
import { ParsedTask } from './markdown-parser';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that operations are safe to execute
 * Catches invalid parent references and missing task IDs
 */
const validateOperations = (
  operations: BatchOperation[],
  mdTasks: ParsedTask[],
  spTasks: Task[],
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const spTaskIds = new Set(spTasks.map((t) => t.id));
  const tempIds = new Set<string>();

  operations.forEach((op, index) => {
    switch (op.type) {
      case 'create':
        tempIds.add(op.tempId);
        if (op.data.parentId) {
          const parentExists =
            spTaskIds.has(op.data.parentId) || tempIds.has(op.data.parentId);
          if (!parentExists) {
            warnings.push(
              `Operation ${index}: Create task "${op.data.title}" references ` +
                `non-existent parent "${op.data.parentId}"`,
            );
          }
        }
        break;

      case 'update':
        if (!spTaskIds.has(op.taskId)) {
          errors.push(
            `Operation ${index}: Update references non-existent task "${op.taskId}"`,
          );
        }
        if (op.updates.parentId !== undefined && op.updates.parentId !== null) {
          const parentExists =
            spTaskIds.has(op.updates.parentId) || tempIds.has(op.updates.parentId);
          if (!parentExists) {
            warnings.push(
              `Operation ${index}: Update task "${op.taskId}" to non-existent parent "${op.updates.parentId}"`,
            );
          }
        }
        break;

      case 'delete':
        if (!spTaskIds.has(op.taskId)) {
          warnings.push(
            `Operation ${index}: Delete references non-existent task "${op.taskId}"`,
          );
        }
        break;
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * Generate batch operations to sync markdown tasks to Super Productivity
 */
export const generateTaskOperations = (
  mdTasks: ParsedTask[],
  spTasks: Task[],
  projectId: string,
): BatchOperation[] => {
  const operations: BatchOperation[] = [];

  // Create maps for easier lookup
  const spById = new Map<string, Task>();
  const spByTitle = new Map<string, Task>();
  const mdById = new Map<string, ParsedTask>();
  const mdByTitle = new Map<string, ParsedTask>();

  // Build SP maps
  spTasks.forEach((task) => {
    spById.set(task.id!, task);
    // Only map by title if no duplicate titles
    if (!spByTitle.has(task.title)) {
      spByTitle.set(task.title, task);
    }
  });

  // Build MD maps and check for duplicates
  const duplicateIds = new Set<string>();
  const firstOccurrence = new Map<string, number>();

  mdTasks.forEach((mdTask) => {
    const checkId = mdTask.id;
    if (checkId) {
      if (firstOccurrence.has(checkId)) {
        duplicateIds.add(checkId);
        console.warn(
          `[sync-md] Duplicate task ID found: ${checkId} at line ${mdTask.line} (first occurrence at line ${firstOccurrence.get(checkId)})`,
        );
      } else {
        firstOccurrence.set(checkId, mdTask.line);
        mdById.set(checkId, mdTask);
      }
    }
    if (!mdByTitle.has(mdTask.title)) {
      mdByTitle.set(mdTask.title, mdTask);
    }
  });

  // Track which SP tasks we've seen
  const processedSpIds = new Set<string>();

  // Track tasks that have changed parents for cleanup
  const tasksWithChangedParents: Array<{
    taskId: string;
    oldParentId: string | null;
    newParentId: string | null;
  }> = [];

  // Build set of valid parent IDs BEFORE processing tasks
  const validParentIds = new Set<string>();

  // Add all root-level MD tasks as valid parents (including temp IDs)
  mdTasks
    .filter((t) => !t.isSubtask)
    .forEach((t) => {
      if (t.id && !duplicateIds.has(t.id)) {
        validParentIds.add(t.id);
      } else {
        // Tasks without IDs will get temp IDs - add them too
        validParentIds.add(`temp_${t.line}`);
      }
    });

  // Add all root-level SP tasks as valid parents
  spTasks.forEach((t) => {
    if (!t.parentId && t.id) validParentIds.add(t.id);
  });

  // Helper function to get validated parent ID
  const getValidatedParentId = (mdTask: ParsedTask): string | null => {
    if (!mdTask.parentId) return null;

    if (!validParentIds.has(mdTask.parentId)) {
      console.warn(
        `[sync-md] Orphaned subtask detected: "${mdTask.title}" (line ${mdTask.line}) ` +
          `references non-existent parent "${mdTask.parentId}". Converting to root task.`,
      );
      return null;
    }

    return mdTask.parentId;
  };

  // First pass: process MD tasks
  mdTasks.forEach((mdTask) => {
    // Check if this task has a duplicate ID
    const effectiveId = mdTask.id && !duplicateIds.has(mdTask.id) ? mdTask.id : null;

    if (effectiveId) {
      const spTask = spById.get(effectiveId);
      if (spTask) {
        processedSpIds.add(spTask.id!);

        // Update existing task
        const updates: Record<string, unknown> = {};
        if (spTask.title !== mdTask.title) {
          updates.title = mdTask.title;
        }
        if (spTask.isDone !== mdTask.completed) {
          updates.isDone = mdTask.completed;
        }

        // Handle notes
        const mdNotes = mdTask.notes || '';
        if ((spTask.notes || '') !== mdNotes) {
          updates.notes = mdNotes;
        }

        // Handle parent relationship
        // Normalize undefined and null to null for comparison
        const spParentId = spTask.parentId || null;
        const mdParentId = getValidatedParentId(mdTask);
        if (spParentId !== mdParentId) {
          updates.parentId = mdParentId;
          // Track this parent change for cleanup
          tasksWithChangedParents.push({
            taskId: spTask.id!,
            oldParentId: spTask.parentId || null,
            newParentId: mdParentId,
          });
        }

        if (Object.keys(updates).length > 0) {
          operations.push({
            type: 'update',
            taskId: spTask.id!,
            updates,
          } as BatchTaskUpdate);
        }
      } else {
        // Create new task with the specified ID
        const createData: any = {
          title: mdTask.title,
          isDone: mdTask.completed,
          notes: mdTask.notes,
        };

        // Only include parentId if it's valid (not null and parent exists)
        const validatedParentId = getValidatedParentId(mdTask);
        if (validatedParentId) {
          createData.parentId = validatedParentId;
        }

        operations.push({
          type: 'create',
          tempId: `temp_${mdTask.line}`,
          data: createData,
        } as BatchTaskCreate);
      }
    } else {
      // No ID - try to match by title
      const spTask = spByTitle.get(mdTask.title);
      if (spTask && !processedSpIds.has(spTask.id!)) {
        processedSpIds.add(spTask.id!);
        console.log(`[sync-md] Matched task by title: "${mdTask.title}" -> ${spTask.id}`);

        // Update existing task
        const updates: Record<string, unknown> = {};
        if (spTask.isDone !== mdTask.completed) {
          updates.isDone = mdTask.completed;
        }

        const mdNotes = mdTask.notes || '';
        if ((spTask.notes || '') !== mdNotes) {
          updates.notes = mdNotes;
        }

        // Handle parent relationship
        // Normalize undefined and null to null for comparison
        const spParentId = spTask.parentId || null;
        const mdParentId = getValidatedParentId(mdTask);
        if (spParentId !== mdParentId) {
          updates.parentId = mdParentId;
          // Track this parent change for cleanup
          tasksWithChangedParents.push({
            taskId: spTask.id!,
            oldParentId: spTask.parentId || null,
            newParentId: mdParentId,
          });
        }

        if (Object.keys(updates).length > 0) {
          operations.push({
            type: 'update',
            taskId: spTask.id!,
            updates,
          } as BatchTaskUpdate);
        }
      } else {
        // Create new task
        const createData: any = {
          title: mdTask.title,
          isDone: mdTask.completed,
          notes: mdTask.notes,
        };

        // Only include parentId if it's valid (not null and parent exists)
        const validatedParentId = getValidatedParentId(mdTask);
        if (validatedParentId) {
          createData.parentId = validatedParentId;
        }

        operations.push({
          type: 'create',
          tempId: `temp_${mdTask.line}`,
          data: createData,
        } as BatchTaskCreate);
      }
    }
  });

  // Clean up old parent subTaskIds when tasks have changed parents
  // Group tasks by their old parent to clean them up all at once
  const tasksByOldParent = new Map<string, string[]>();
  tasksWithChangedParents.forEach(({ taskId, oldParentId }) => {
    if (oldParentId) {
      if (!tasksByOldParent.has(oldParentId)) {
        tasksByOldParent.set(oldParentId, []);
      }
      tasksByOldParent.get(oldParentId)!.push(taskId);
    }
  });

  tasksByOldParent.forEach((movedTaskIds, oldParentId) => {
    const oldParentTask = spById.get(oldParentId);
    if (oldParentTask && oldParentTask.subTaskIds) {
      // Remove all moved tasks from the parent's subTaskIds
      const newSubTaskIds = oldParentTask.subTaskIds.filter(
        (id) => !movedTaskIds.includes(id),
      );

      // Check if we already have an update operation for this parent
      const existingUpdateIndex = operations.findIndex(
        (op) => op.type === 'update' && op.taskId === oldParentId,
      );

      if (existingUpdateIndex >= 0) {
        // Add subTaskIds to existing update
        (operations[existingUpdateIndex] as BatchTaskUpdate).updates.subTaskIds =
          newSubTaskIds;
      } else {
        // Create new update operation
        operations.push({
          type: 'update',
          taskId: oldParentId,
          updates: {
            subTaskIds: newSubTaskIds,
          },
        } as BatchTaskUpdate);
      }
    }
  });

  // Second pass: delete tasks that exist in SP but not in MD
  const tasksToDelete: string[] = [];
  spTasks.forEach((spTask) => {
    if (!processedSpIds.has(spTask.id!) && spTask.projectId === projectId) {
      tasksToDelete.push(spTask.id!);
    }
  });

  // Before deleting tasks, clean up any references to them in other tasks
  tasksToDelete.forEach((taskIdToDelete) => {
    spTasks.forEach((spTask) => {
      if (
        spTask.id !== taskIdToDelete &&
        spTask.subTaskIds &&
        spTask.subTaskIds.includes(taskIdToDelete)
      ) {
        // Remove the deleted task from the parent's subtask list
        const updateOp = operations.find(
          (op) => op.type === 'update' && op.taskId === spTask.id,
        );
        if (updateOp && updateOp.type === 'update') {
          // Update existing operation
          updateOp.updates.subTaskIds = spTask.subTaskIds.filter(
            (id) => id !== taskIdToDelete,
          );
        } else {
          // Create new update operation
          operations.push({
            type: 'update',
            taskId: spTask.id!,
            updates: {
              subTaskIds: spTask.subTaskIds.filter((id) => id !== taskIdToDelete),
            },
          } as BatchTaskUpdate);
        }
      }
    });
  });

  // Now add the delete operations
  tasksToDelete.forEach((taskId) => {
    operations.push({
      type: 'delete',
      taskId,
    } as BatchTaskDelete);
  });

  // Third pass: handle reordering if needed
  const mdRootTasks = mdTasks.filter((t) => !t.isSubtask);
  const mdTaskIds = mdRootTasks
    .map((t) => {
      if (t.id && spById.has(t.id)) {
        return t.id;
      }
      const spTask = spByTitle.get(t.title);
      return spTask ? spTask.id! : `temp_${t.line}`;
    })
    .filter((taskId) => !tasksToDelete.includes(taskId)); // Filter out tasks that are being deleted

  if (mdTaskIds.length > 0) {
    // Log the order for debugging
    console.log('[sync-md] Reorder operation - task order from markdown:');
    mdRootTasks.forEach((task, index) => {
      console.log(
        `  ${index + 1}. Line ${task.line}: ${task.title} (${mdTaskIds[index]})`,
      );
    });

    operations.push({
      type: 'reorder',
      taskIds: mdTaskIds,
    } as BatchTaskReorder);
  }

  // Fourth pass: handle subtask ordering
  // Group subtasks by parent, maintaining their order from the markdown file
  // Note: validParentIds and getValidatedParentId() already filter out invalid parents
  const subtasksByParent = new Map<string, ParsedTask[]>();
  mdTasks
    .filter((t) => t.isSubtask && t.parentId)
    .forEach((subtask) => {
      const validatedParentId = getValidatedParentId(subtask);

      // Skip if parent is invalid (warning already logged by getValidatedParentId)
      if (!validatedParentId) {
        return;
      }

      if (!subtasksByParent.has(validatedParentId)) {
        subtasksByParent.set(validatedParentId, []);
      }
      subtasksByParent.get(validatedParentId)!.push(subtask);
    });

  // Sort subtasks by line number to maintain order from file
  subtasksByParent.forEach((subtasks) => {
    subtasks.sort((a, b) => a.line - b.line);
  });

  // Update parent tasks with correct subtask order
  subtasksByParent.forEach((subtasks, parentId) => {
    const parentTask = spById.get(parentId);
    if (parentTask) {
      // Map subtasks to their IDs (including temp IDs for new tasks)
      const orderedSubtaskIds = subtasks
        .map((subtask) => {
          if (subtask.id && spById.has(subtask.id)) {
            return subtask.id;
          }
          const spSubtask = spByTitle.get(subtask.title);
          if (spSubtask) {
            return spSubtask.id!;
          }
          // For new subtasks, use the temp ID that will be created
          return `temp_${subtask.line}`;
        })
        .filter((id) => id !== null) as string[];

      // Check if the order is different
      const currentSubtaskIds = parentTask.subTaskIds || [];
      const orderChanged =
        currentSubtaskIds.length !== orderedSubtaskIds.length ||
        currentSubtaskIds.some((id, index) => id !== orderedSubtaskIds[index]);

      if (orderChanged) {
        // Find if we already have an update operation for this parent
        const existingUpdateIndex = operations.findIndex(
          (op) => op.type === 'update' && op.taskId === parentId,
        );

        if (existingUpdateIndex >= 0) {
          // Add subTaskIds to existing update
          (operations[existingUpdateIndex] as BatchTaskUpdate).updates.subTaskIds =
            orderedSubtaskIds;
        } else {
          // Create new update operation
          operations.push({
            type: 'update',
            taskId: parentId,
            updates: {
              subTaskIds: orderedSubtaskIds,
            },
          } as BatchTaskUpdate);
        }
      }
    }
  });

  // Ensure reorder operations come last
  // This is important so that newly created tasks are ordered correctly
  const reorderOps = operations.filter((op) => op.type === 'reorder');
  const otherOps = operations.filter((op) => op.type !== 'reorder');

  // Validate operations before returning
  const validation = validateOperations(operations, mdTasks, spTasks);
  if (!validation.isValid) {
    console.error('[sync-md] Invalid operations generated:', validation.errors);
    validation.errors.forEach((err) => console.error(`  - ${err}`));
  }
  if (validation.warnings.length > 0) {
    console.warn('[sync-md] Operation warnings:', validation.warnings);
    validation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
  }

  return [...otherOps, ...reorderOps];
};
