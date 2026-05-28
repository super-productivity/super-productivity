import { devError } from '../../util/dev-error';
import { AppDataComplete } from '../model/model-config';
import { OpLog } from '../../core/log';
import type { SyncLogMeta } from '@sp/sync-core';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';
import {
  MenuTreeKind,
  MenuTreeTreeNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { TaskArchive } from '../../features/tasks/task.model';

// WARNING: Module-level mutable state. This is not ideal because:
// 1. Can cause test pollution if tests don't properly isolate
// 2. State persists between validation calls
// The errorCount is reset at the start of each call, but lastValidityError persists.
// Consumers should call getLastValidityError() immediately after isRelatedModelDataValid()
// to get the error from the current validation run.
// TODO: Refactor to return a ValidationResult object { isValid: boolean, errors: string[] }
let errorCount = 0;
let lastValidityError: string | undefined;

const SAFE_VALIDITY_INFO_KEYS = new Set([
  'archiveLabel',
  'defaultProjectId',
  'id',
  'ipId',
  'nid',
  'nodeKind',
  'parentId',
  'pid',
  'projectId',
  'repeatCfgId',
  'subId',
  'tagId',
  'taskId',
  'tid',
  'treeType',
]);

const KNOWN_MENU_TREE_KINDS = new Set<string>(Object.values(MenuTreeKind));

const getMenuTreeKindForLog = (kind: unknown): string =>
  typeof kind === 'string' && KNOWN_MENU_TREE_KINDS.has(kind) ? kind : 'unknown';

const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const getValidityInfoMeta = (additionalInfo: unknown): SyncLogMeta => {
  if (
    additionalInfo === null ||
    typeof additionalInfo !== 'object' ||
    Array.isArray(additionalInfo)
  ) {
    return {
      additionalInfoType: getValueType(additionalInfo),
      additionalInfoArrayLength: Array.isArray(additionalInfo)
        ? additionalInfo.length
        : undefined,
    };
  }

  const info = additionalInfo as Record<string, unknown>;
  const meta: SyncLogMeta = {
    additionalInfoType: 'object',
    additionalInfoKeyCount: Object.keys(info).length,
  };

  for (const key of SAFE_VALIDITY_INFO_KEYS) {
    const value = info[key];
    if (key === 'nodeKind') {
      meta[key] = getMenuTreeKindForLog(value);
      continue;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      meta[key] = value;
    }
  }

  return meta;
};

export const isRelatedModelDataValid = (d: AppDataComplete): boolean => {
  errorCount = 0;
  lastValidityError = undefined; // Reset at start of each validation

  if (!d) {
    _validityError('Data is null or undefined');
    return false;
  }

  // Check for required properties before accessing them
  // We check for the existence of the main models used in validation
  if (
    !d.project ||
    !d.tag ||
    !d.task ||
    !d.archiveYoung ||
    !d.archiveOld ||
    !d.note ||
    !d.issueProvider ||
    !d.reminders
  ) {
    _validityError('Missing required model data in AppDataComplete', {
      additionalInfoType: getValueType(d),
    });
    return false;
  }

  // Extract commonly used collections once
  const projectIds = new Set<string>((d.project.ids as string[]) || []);
  const tagIds = new Set<string>((d.tag.ids as string[]) || []);
  const taskIds = new Set<string>((d.task.ids as string[]) || []);
  const taskRepeatCfgIds = new Set<string>((d.taskRepeatCfg?.ids as string[]) || []);
  const archiveYoungTaskIds = new Set<string>(
    (d.archiveYoung.task?.ids as string[]) || [],
  );
  const archiveOldTaskIds = new Set<string>((d.archiveOld.task?.ids as string[]) || []);
  const noteIds = new Set<string>((d.note.ids as string[]) || []);

  // Validate projects, tasks and tags relationships
  if (!validateTasksToProjectsAndTags(d, projectIds, tagIds, taskIds, taskRepeatCfgIds)) {
    return false;
  }

  // Validate note relationships
  if (!validateNotes(d, projectIds, noteIds)) {
    return false;
  }

  // Validate subtasks
  if (!validateSubTasks(d, taskIds, archiveYoungTaskIds, archiveOldTaskIds)) {
    return false;
  }

  // Validate issue providers
  if (!validateIssueProviders(d, projectIds)) {
    return false;
  }

  // Validate reminders
  if (!validateReminders(d)) {
    return false;
  }

  // Validate menuTree
  if (!validateMenuTree(d, projectIds, tagIds)) {
    return false;
  }

  // Section orphans (missing context, stale taskIds) are repaired by
  // `repairSections` in data-repair.ts; no separate validation step.

  return true;
};

export const getLastValidityError = (): string | undefined => lastValidityError;

const _validityError = (errTxt: string, additionalInfo?: unknown): void => {
  if (additionalInfo) {
    OP_LOG_SYNC_LOGGER.log('[is-related-model-data-valid] Validity error info', {
      error: errTxt,
      ...getValidityInfoMeta(additionalInfo),
    });
  }
  if (errorCount <= 3) {
    devError(errTxt);
  } else {
    if (errorCount === 4) {
      OpLog.err('too many validity errors, only logging from now on');
    }
    OpLog.err(errTxt);
  }
  lastValidityError = errTxt;
  errorCount++;
};

interface ArchiveValidationCtx {
  projectIds: Set<string>;
  tagIds: Set<string>;
  taskRepeatCfgIds: Set<string>;
}

/**
 * Validates archived tasks. Stale projectId/tagId/repeatCfgId references are
 * harmless in archives — they're historical records. Consumers handle missing
 * refs gracefully. We log but don't fail, matching the TODAY_TAG orphan pattern.
 * See: https://github.com/super-productivity/super-productivity/issues/6270
 */
const _validateArchiveTasks = (
  archiveLabel: 'archiveYoung' | 'archiveOld',
  archiveTaskState: TaskArchive | undefined,
  ctx: ArchiveValidationCtx,
): boolean => {
  if (!archiveTaskState?.ids) return true;

  const staleProjectIds: string[] = [];
  const staleTagIds: string[] = [];
  const staleRepeatCfgIds: string[] = [];

  for (const tid of archiveTaskState.ids) {
    const task = archiveTaskState.entities[tid];
    if (!task) {
      _validityError(
        `Orphaned task ID in ${archiveLabel}.task.ids (no matching entity)`,
        {
          tid,
          archiveLabel,
        },
      );
      return false;
    }

    if (task.projectId && !ctx.projectIds.has(task.projectId)) {
      staleProjectIds.push(tid);
    }
    if ((task.tagIds || []).some((tagId) => !ctx.tagIds.has(tagId))) {
      staleTagIds.push(tid);
    }
    if (task.repeatCfgId && !ctx.taskRepeatCfgIds.has(task.repeatCfgId)) {
      staleRepeatCfgIds.push(tid);
    }
  }

  if (staleProjectIds.length > 0) {
    OpLog.info(
      `[ValidateState] ${archiveLabel} has ${staleProjectIds.length} tasks with stale projectId (harmless)`,
      { staleProjectIds },
    );
  }
  if (staleTagIds.length > 0) {
    OpLog.info(
      `[ValidateState] ${archiveLabel} has ${staleTagIds.length} tasks with stale tagId (harmless)`,
      { staleTagIds },
    );
  }
  if (staleRepeatCfgIds.length > 0) {
    OpLog.info(
      `[ValidateState] ${archiveLabel} has ${staleRepeatCfgIds.length} tasks with stale repeatCfgId (harmless)`,
      { staleRepeatCfgIds },
    );
  }

  return true;
};

const validateTasksToProjectsAndTags = (
  d: AppDataComplete,
  projectIds: Set<string>,
  tagIds: Set<string>,
  taskIds: Set<string>,
  taskRepeatCfgIds: Set<string>,
): boolean => {
  // Track project-task relationships and ids for consistency validation
  const projectTaskMap = new Map<string, Set<string>>();

  // Validate tasks in projects
  for (const pid of d.project.ids) {
    const project = d.project.entities[pid];
    if (!project) {
      _validityError('No project', { pid });
      return false;
    }

    // Create entry for this project
    const projectTaskSet = new Set<string>([
      ...project.taskIds,
      ...project.backlogTaskIds,
    ]);
    projectTaskMap.set(project.id, projectTaskSet);

    // Validate each task in this project
    for (const tid of projectTaskSet) {
      const task = d.task.entities[tid];
      if (!task) {
        _validityError('Missing task data for project', {
          tid,
          projectId: project.id,
        });
        return false;
      }

      if (task.projectId !== project.id) {
        _validityError('Inconsistent task projectId', {
          taskId: task.id,
          projectId: project.id,
        });
        return false;
      }
    }
  }

  // Validate projects in tasks
  for (const tid of d.task.ids) {
    const task = d.task.entities[tid];
    if (!task) {
      _validityError('Orphaned task ID in task.ids (no matching entity)', { tid });
      return false;
    }

    // Check project reference
    if (task.projectId && !projectIds.has(task.projectId)) {
      _validityError('projectId from task not existing', {
        taskId: task.id,
        projectId: task.projectId,
      });
      return false;
    }

    // Check tag references
    for (const tagId of task.tagIds) {
      if (!tagIds.has(tagId)) {
        _validityError('tagId from task not existing', {
          taskId: task.id,
          tagId,
        });
        return false;
      }
    }

    // Check repeatCfgId reference
    if (task.repeatCfgId && !taskRepeatCfgIds.has(task.repeatCfgId)) {
      _validityError(
        `repeatCfgId "${task.repeatCfgId}" from task "${task.id}" not existing`,
        {
          taskId: task.id,
          repeatCfgId: task.repeatCfgId,
        },
      );
      return false;
    }

    // Check if task has project or tag
    if (!task.parentId && !task.projectId && task.tagIds.length === 0) {
      _validityError(`Task without project or tag`, { taskId: task.id });
      return false;
    }
  }

  const archiveCtx: ArchiveValidationCtx = { projectIds, tagIds, taskRepeatCfgIds };
  if (!_validateArchiveTasks('archiveYoung', d.archiveYoung.task, archiveCtx)) {
    return false;
  }
  if (!_validateArchiveTasks('archiveOld', d.archiveOld.task, archiveCtx)) {
    return false;
  }

  // Check tags-tasks relationship
  for (const tagId of d.tag.ids) {
    const tag = d.tag.entities[tagId];
    if (!tag) continue;

    // TODAY_TAG is a virtual tag where taskIds stores ordering only (membership
    // is determined by task.dueDay). Orphaned IDs can occur during LWW conflict
    // resolution when UPDATE wins over DELETE. These are harmless - they just
    // waste a few bytes in the ordering array. We log but don't fail validation.
    if (tagId === TODAY_TAG.id) {
      const orphanedIds = tag.taskIds.filter((tid) => !taskIds.has(tid));
      if (orphanedIds.length > 0) {
        OpLog.info(
          `[ValidateState] TODAY_TAG has ${orphanedIds.length} orphaned task IDs (harmless)`,
          { orphanedIds },
        );
      }
      continue; // Skip normal error handling for TODAY_TAG
    }

    for (const tid of tag.taskIds) {
      if (!taskIds.has(tid)) {
        _validityError(`Inconsistent Task State: Missing task id for tag`, {
          tagId: tag.id,
          tid,
        });
        return false;
      }
    }
  }

  return true;
};

const validateNotes = (
  d: AppDataComplete,
  projectIds: Set<string>,
  noteIds: Set<string>,
): boolean => {
  // Validate notes in projects
  for (const pid of d.project.ids) {
    const project = d.project.entities[pid];
    if (!project) continue;

    for (const nid of project.noteIds) {
      const note = d.note.entities[nid];
      if (!note) {
        _validityError('Missing note data for project', {
          nid,
          projectId: project.id,
        });
        return false;
      }

      if (note.projectId !== project.id) {
        _validityError('Inconsistent note projectId', {
          nid: note.id,
          projectId: project.id,
        });
        return false;
      }
    }
  }

  // Validate todayOrder list
  for (const nid of d.note.todayOrder) {
    if (!noteIds.has(nid)) {
      _validityError(
        `Inconsistent Note State: Missing note id ${nid} for note.todayOrder`,
        { nid },
      );
      return false;
    }
  }

  return true;
};

const validateSubTasks = (
  d: AppDataComplete,
  taskIds: Set<string>,
  archiveYoungTaskIds: Set<string>,
  archiveOldTaskIds: Set<string>,
): boolean => {
  // Check for lonely sub tasks and missing sub tasks in active tasks
  for (const tid of taskIds) {
    const task = d.task.entities[tid];
    if (!task) continue;

    // Check if parent exists
    if (task.parentId && !d.task.entities[task.parentId]) {
      _validityError(`Inconsistent Task State: Lonely Sub Task in Today ${task.id}`, {
        taskId: task.id,
        parentId: task.parentId,
      });
      return false;
    }

    // Check if all subtasks exist
    for (const subId of task.subTaskIds) {
      if (!d.task.entities[subId]) {
        _validityError(
          `Inconsistent Task State: Missing sub task data in today ${subId}`,
          { taskId: task.id, subId },
        );
        return false;
      }
    }
  }

  // Same for archiveYoung tasks
  if (d.archiveYoung.task?.entities) {
    for (const tid of archiveYoungTaskIds) {
      const task = d.archiveYoung.task.entities[tid];
      if (!task) continue;

      if (task.parentId && !d.archiveYoung.task.entities[task.parentId]) {
        // Check if parent exists in archiveOld before considering it a lonely subtask
        if (!d.archiveOld.task?.entities?.[task.parentId]) {
          _validityError(
            `Inconsistent Task State: Lonely Sub Task in Archive ${task.id}`,
            {
              taskId: task.id,
              parentId: task.parentId,
            },
          );
          return false;
        }
      }

      for (const subId of task.subTaskIds) {
        if (!d.archiveYoung.task.entities[subId]) {
          // Check if subtask exists in archiveOld before considering it missing
          if (!d.archiveOld.task?.entities?.[subId]) {
            _validityError(
              `Inconsistent Task State: Missing sub task data in archive ${subId}`,
              { taskId: task.id, subId },
            );
            return false;
          }
        }
      }
    }
  }

  // Validate archiveOld tasks
  if (d.archiveOld.task?.entities) {
    for (const tid of archiveOldTaskIds) {
      const task = d.archiveOld.task.entities[tid];
      if (!task) continue;

      if (task.parentId && !d.archiveOld.task.entities[task.parentId]) {
        // Check if parent exists in archiveYoung before considering it a lonely subtask
        if (!d.archiveYoung.task?.entities?.[task.parentId]) {
          _validityError(
            `Inconsistent Task State: Lonely Sub Task in Old Archive ${task.id}`,
            {
              taskId: task.id,
              parentId: task.parentId,
            },
          );
          return false;
        }
      }

      for (const subId of task.subTaskIds) {
        if (!d.archiveOld.task.entities[subId]) {
          // Check if subtask exists in archiveYoung before considering it missing
          if (!d.archiveYoung.task?.entities?.[subId]) {
            _validityError(
              `Inconsistent Task State: Missing sub task data in old archive ${subId}`,
              { taskId: task.id, subId },
            );
            return false;
          }
        }
      }
    }
  }

  return true;
};

const validateIssueProviders = (d: AppDataComplete, projectIds: Set<string>): boolean => {
  for (const ipId of d.issueProvider.ids) {
    const ip = d.issueProvider.entities[ipId];
    if (ip && ip.defaultProjectId && !projectIds.has(ip.defaultProjectId)) {
      _validityError(
        `defaultProjectId ${ip.defaultProjectId} from issueProvider not existing`,
        { ipId: ip.id, defaultProjectId: ip.defaultProjectId },
      );
      return false;
    }
  }
  return true;
};

// NOTE: reminderId is deprecated - reminders now use remindAt directly on tasks
// This validation is kept as a no-op for backward compatibility
const validateReminders = (_d: AppDataComplete): boolean => {
  return true;
};

const validateMenuTree = (
  d: AppDataComplete,
  projectIds: Set<string>,
  tagIds: Set<string>,
): boolean => {
  // Recursive function to validate tree nodes
  const validateTreeNodes = (
    nodes: MenuTreeTreeNode[],
    treeType: 'projectTree' | 'tagTree',
  ): boolean => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        _validityError(`Invalid menuTree node in ${treeType}`, { treeType });
        return false;
      }

      if (node.k === MenuTreeKind.FOLDER) {
        // Validate folder structure
        if (!node.id || !node.name) {
          _validityError(`Invalid folder node in ${treeType} - missing id or name`, {
            treeType,
            id: node.id,
            nodeKind: node.k,
          });
          return false;
        }

        if (!Array.isArray(node.children)) {
          _validityError(`Invalid folder node in ${treeType} - children not array`, {
            treeType,
            id: node.id,
            nodeKind: node.k,
          });
          return false;
        }

        // Recursively validate children
        if (!validateTreeNodes(node.children, treeType)) {
          return false;
        }
      } else if (treeType === 'projectTree' && node.k === MenuTreeKind.PROJECT) {
        // Validate project reference
        if (!node.id) {
          _validityError(`Project node in menuTree missing id`, {
            treeType,
            nodeKind: node.k,
          });
          return false;
        }

        if (!projectIds.has(node.id)) {
          _validityError(
            `Orphaned project reference in menuTree - project ${node.id} doesn't exist`,
            { id: node.id, treeType, nodeKind: node.k },
          );
          return false;
        }
      } else if (treeType === 'tagTree' && node.k === MenuTreeKind.TAG) {
        // Validate tag reference
        if (!node.id) {
          _validityError(`Tag node in menuTree missing id`, {
            treeType,
            nodeKind: node.k,
          });
          return false;
        }

        if (!tagIds.has(node.id)) {
          _validityError(
            `Orphaned tag reference in menuTree - tag ${node.id} doesn't exist`,
            { id: node.id, treeType, nodeKind: node.k },
          );
          return false;
        }
      } else {
        _validityError(`Invalid node kind in ${treeType}`, {
          treeType,
          id: node.id,
          nodeKind: node.k,
        });
        return false;
      }
    }
    return true;
  };

  // Validate projectTree
  if (d.menuTree?.projectTree) {
    if (!Array.isArray(d.menuTree.projectTree)) {
      _validityError('menuTree.projectTree is not an array');
      return false;
    }
    if (!validateTreeNodes(d.menuTree.projectTree, 'projectTree')) {
      return false;
    }
  }

  // Validate tagTree
  if (d.menuTree?.tagTree) {
    if (!Array.isArray(d.menuTree.tagTree)) {
      _validityError('menuTree.tagTree is not an array');
      return false;
    }
    if (!validateTreeNodes(d.menuTree.tagTree, 'tagTree')) {
      return false;
    }
  }

  return true;
};
