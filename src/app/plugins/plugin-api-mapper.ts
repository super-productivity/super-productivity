/**
 * Simplified mapper functions - types are now unified!
 * These functions now just handle minor field transformations
 */

import { Task as TaskCopy } from '../features/tasks/task.model';
import { Project as ProjectCopy } from '../features/project/project.model';
import { Tag as TagCopy } from '../features/tag/tag.model';
import { SnackParams } from '../core/snack/snack.model';
import { Task, Project, Tag, SnackCfg } from '@super-productivity/plugin-api';

/**
 * Convert internal Task to plugin API Task (mostly passthrough now)
 */
export const taskCopyToTaskData = (task: TaskCopy): Task => {
  // Most fields map directly now
  return task as Task;
};

/**
 * Convert plugin API Task updates to internal format
 */
export const taskDataToPartialTaskCopy = (updates: Partial<Task>): Partial<TaskCopy> => {
  // Handle null -> undefined conversions for internal use
  const result: Record<string, unknown> = {};

  // Copy all properties, converting nulls to undefined where needed
  for (const key in updates) {
    if (updates.hasOwnProperty(key)) {
      const value = (updates as Record<string, unknown>)[key];
      if (
        value === null &&
        ['projectId', 'doneOn', 'parentId', 'repeatCfgId', 'remindAt'].includes(key)
      ) {
        result[key] = undefined;
      } else {
        result[key] = value;
      }
    }
  }

  return result as Partial<TaskCopy>;
};

/**
 * Convert internal Project to plugin API Project
 */
export const projectCopyToProjectData = (project: ProjectCopy): Project => {
  // Projects map directly now
  return project as Project;
};

/**
 * Convert plugin API Project updates to internal format
 */
export const projectDataToPartialProjectCopy = (
  updates: Partial<Project>,
): Partial<ProjectCopy> => {
  return updates as Partial<ProjectCopy>;
};

/**
 * Convert internal Tag to plugin API Tag
 */
export const tagCopyToTagData = (tag: TagCopy): Tag => {
  // Tags map directly now
  return tag as Tag;
};

/**
 * Convert plugin API Tag updates to internal format
 */
export const tagDataToPartialTagCopy = (updates: Partial<Tag>): Partial<TagCopy> => {
  return updates as Partial<TagCopy>;
};

/**
 * Convert plugin API SnackCfg to internal SnackParams
 */
export const snackCfgToSnackParams = (snackCfg: SnackCfg): SnackParams => {
  // Map plugin API types to internal types
  let internalType: 'ERROR' | 'SUCCESS' | 'CUSTOM' = 'CUSTOM';

  switch (snackCfg.type) {
    case 'SUCCESS':
      internalType = 'SUCCESS';
      break;
    case 'ERROR':
      internalType = 'ERROR';
      break;
    case 'WARNING':
    case 'INFO':
    default:
      internalType = 'CUSTOM';
      break;
  }

  return {
    msg: snackCfg.msg,
    type: internalType,
    ico: snackCfg.ico,
  };
};
