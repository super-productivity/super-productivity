import { Task } from '@super-productivity/plugin-api';
import {
  writeTasksFile,
  ensureDirectoryExists,
  readTasksFile,
} from '../helper/file-utils';
import { LocalUserCfg } from '../local-config';
import { parseMarkdownWithHeader } from './markdown-parser';

/**
 * Replicate Super Productivity tasks to markdown file
 * Gets tasks for the specific project and writes them to the configured file
 */
export const spToMd = async (config: LocalUserCfg): Promise<void> => {
  // Ensure directory exists
  await ensureDirectoryExists(config.filePath);

  // Get tasks and project info
  const allTasks = await PluginAPI.getTasks();
  const projects = await PluginAPI.getAllProjects();
  const project = projects.find((p) => p.id === config.projectId);

  // Filter tasks for this project
  const projectTasks = allTasks.filter((task) => task.projectId === config.projectId);

  // If project has taskIds, use them to order the tasks
  let orderedTasks = projectTasks;
  if (project && project.taskIds && project.taskIds.length > 0) {
    // Create a map for quick lookup
    const taskMap = new Map<string, Task>();
    projectTasks.forEach((task) => {
      taskMap.set(task.id, task);
    });

    // Order tasks according to project.taskIds
    const orderedParentTasks: Task[] = [];
    project.taskIds.forEach((taskId) => {
      const task = taskMap.get(taskId);
      if (task && !task.parentId) {
        orderedParentTasks.push(task);
      }
    });

    // Replace parent tasks with ordered ones, keep subtasks
    const subtasks = projectTasks.filter((task) => task.parentId);
    orderedTasks = [...orderedParentTasks, ...subtasks];
  }

  // Convert project tasks to markdown
  const markdown = convertTasksToMarkdown(orderedTasks);

  // Preserve document content outside the task list
  let header = '';
  let footer = '';
  try {
    const existingContent = await readTasksFile(config.filePath);
    if (existingContent) {
      const parsed = parseMarkdownWithHeader(existingContent);
      header = parsed.header || '';
      footer = parsed.footer || '';
    }
  } catch (error) {
    // File does not exist yet, no document content to preserve
  }

  // Combine header and tasks
  let finalContent = markdown;
  if (header) {
    // Add newline between header and tasks if both exist
    finalContent = header + (markdown && !header.endsWith('\n') ? '\n' : '') + markdown;
  }

  if (footer) {
    const separator =
      finalContent && !finalContent.endsWith('\n') && !/^[ \t]*\r?\n/.test(footer)
        ? '\n'
        : '';
    finalContent += separator + footer;
  }

  // Write to file
  await writeTasksFile(config.filePath, finalContent);
};

/**
 * Convert SP tasks to markdown format with proper hierarchy
 * Implements the user requirements:
 * - Tasks and subtasks as markdown checklists
 * - Task notes shown below subtasks
 * - Proper indentation for subtasks
 */
export const convertTasksToMarkdown = (tasks: Task[]): string => {
  const lines: string[] = [];

  // Separate parent tasks and subtasks
  const parentTasks = tasks.filter((task) => !task.parentId);
  const subtasksByParent = new Map<string, Task[]>();

  // Group subtasks by parent
  tasks
    .filter((task) => task.parentId)
    .forEach((subtask) => {
      if (!subtasksByParent.has(subtask.parentId!)) {
        subtasksByParent.set(subtask.parentId!, []);
      }
      subtasksByParent.get(subtask.parentId!)!.push(subtask);
    });

  // Process parent tasks and their subtasks
  for (const parentTask of parentTasks) {
    // Add parent task
    lines.push(formatTask(parentTask));

    // Add subtasks in the order specified by subTaskIds
    if (parentTask.subTaskIds && parentTask.subTaskIds.length > 0) {
      // Create a map for quick lookup
      const subtasksMap = new Map<string, Task>();
      const subtasks = subtasksByParent.get(parentTask.id!) || [];
      subtasks.forEach((subtask) => {
        subtasksMap.set(subtask.id!, subtask);
      });

      // Process subtasks in the order specified by subTaskIds
      for (const subTaskId of parentTask.subTaskIds) {
        const subtask = subtasksMap.get(subTaskId);
        if (subtask) {
          lines.push(formatTask(subtask, 2)); // 2 spaces indent

          // Add subtask notes if present
          if (subtask.notes && subtask.notes.trim()) {
            const noteLines = subtask.notes.split('\n');
            for (const noteLine of noteLines) {
              if (noteLine.trim()) {
                lines.push(`    ${noteLine}`); // 4 spaces indent for notes
              }
            }
          }
        }
      }
    } else {
      // Fallback: if no subTaskIds, use the old approach
      const subtasks = subtasksByParent.get(parentTask.id!) || [];
      for (const subtask of subtasks) {
        lines.push(formatTask(subtask, 2)); // 2 spaces indent

        // Add subtask notes if present
        if (subtask.notes && subtask.notes.trim()) {
          const noteLines = subtask.notes.split('\n');
          for (const noteLine of noteLines) {
            if (noteLine.trim()) {
              lines.push(`    ${noteLine}`); // 4 spaces indent for notes
            }
          }
        }
      }
    }

    // Add parent task notes after subtasks
    if (parentTask.notes && parentTask.notes.trim()) {
      const noteLines = parentTask.notes.split('\n');
      for (const noteLine of noteLines) {
        if (noteLine.trim()) {
          lines.push(`  ${noteLine}`); // 2 spaces indent for parent notes
        }
      }
    }
  }

  // Also process orphaned subtasks (subtasks whose parent is not in the current task list)
  const allSubtasks = tasks.filter((task) => task.parentId);
  const parentIds = new Set(parentTasks.map((t) => t.id));
  const orphanedSubtasks = allSubtasks.filter(
    (subtask) => subtask.parentId && !parentIds.has(subtask.parentId),
  );

  for (const orphan of orphanedSubtasks) {
    lines.push(formatTask(orphan)); // No indentation for orphaned subtasks
  }

  return lines.join('\n').trim();
};

/**
 * Format a single task as a markdown checkbox
 */
export const formatTask = (task: Task, indent: number = 0): string => {
  const indentStr = ' '.repeat(indent);
  const checkbox = task.isDone ? '[x]' : '[ ]';
  const title = task.title;
  const id = task.id ? `<!--${task.id}--> ` : '';

  return `${indentStr}- ${checkbox} ${id}${title}`;
};
