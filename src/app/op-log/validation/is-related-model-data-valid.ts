import { devError } from '../../util/dev-error';
import { environment } from '../../../environments/environment';
import { AppDataComplete } from '../model/model-config';
import { PFLog } from '../../core/log';
import {
  MenuTreeKind,
  MenuTreeTreeNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { TODAY_TAG } from '../../features/tag/tag.const';

// WARNING: Module-level mutable state. This is not ideal because:
// 1. Can cause test pollution if tests don't properly isolate
// 2. State persists between validation calls
// The errorCount is reset at the start of each call, but lastValidityError persists.
// Consumers should call getLastValidityError() immediately after isRelatedModelDataValid()
// to get the error from the current validation run.
// TODO: Refactor to return a ValidationResult object { isValid: boolean, errors: string[] }
let errorCount = 0;
let lastValidityError: string | undefined;

export const isRelatedModelDataValid = (d: AppDataComplete): boolean => {
  errorCount = 0;
  lastValidityError = undefined; // Reset at start of each validation

  if (!d) {
    _validityError('Data is null or undefined', { d });
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
    _validityError('Missing required model data in AppDataComplete', { d });
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
  if (
    !validateTasksToProjectsAndTags(
      d,
      projectIds,
      tagIds,
      taskIds,
      taskRepeatCfgIds,
      archiveYoungTaskIds,
    )
  ) {
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

  return true;
};

export const getLastValidityError = (): string | undefined => lastValidityError;

const _validityError = (errTxt: string, additionalInfo?: any): void => {
  if (additionalInfo) {
    PFLog.log('Validity Error Info: ', additionalInfo);
    if (environment.production) {
      try {
        PFLog.log('Validity Error Info string: ', JSON.stringify(additionalInfo));
      } catch (e) {
        PFLog.warn('Failed to stringify validity error info:', e);
      }
    }
  }
  if (errorCount <= 3) {
    devError(errTxt);
  } else {
    if (errorCount === 4) {
      PFLog.err('too many validity errors, only logging from now on');
    }
    PFLog.err(errTxt);
  }
  lastValidityError = errTxt;
  errorCount++;
};

const validateTasksToProjectsAndTags = (
  d: AppDataComplete,
  projectIds: Set<string>,
  tagIds: Set<string>,
  taskIds: Set<string>,
  taskRepeatCfgIds: Set<string>,
  archiveYoungTaskIds: Set<string>,
): boolean => {
  // Track project-task relationships and ids for consistency validation
  const projectTaskMap = new Map<string, Set<string>>();

  // Validate tasks in projects
  for (const pid of d.project.ids) {
    const project = d.project.entities[pid];
    if (!project) {
      _validityError('No project', { pid, d });
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
        _validityError(`Missing task data (tid: ${tid}) for Project ${project.title}`, {
          project,
          d,
        });
        return false;
      }

      if (task.projectId !== project.id) {
        _validityError('Inconsistent task projectId', { task, project, d });
        return false;
      }
    }
  }

  // Validate projects in tasks
  for (const tid of d.task.ids) {
    const task = d.task.entities[tid];
    if (!task) continue;

    // Check project reference
    if (task.projectId && !projectIds.has(task.projectId)) {
      _validityError(`projectId ${task.projectId} from task not existing`, { task, d });
      return false;
    }

    // Check tag references
    for (const tagId of task.tagIds) {
      if (!tagIds.has(tagId)) {
        _validityError(`tagId "${tagId}" from task not existing`, { task, d });
        return false;
      }
    }

    // Check repeatCfgId reference
    if (task.repeatCfgId && !taskRepeatCfgIds.has(task.repeatCfgId)) {
      _validityError(
        `repeatCfgId "${task.repeatCfgId}" from task "${task.id}" not existing`,
        {
          task,
          d,
        },
      );
      return false;
    }

    // Check if task has project or tag
    if (!task.parentId && !task.projectId && task.tagIds.length === 0) {
      _validityError(`Task without project or tag`, { task, d });
      return false;
    }
  }

  // Similar validation for archiveYoung tasks
  if (d.archiveYoung.task?.ids) {
    for (const tid of d.archiveYoung.task.ids) {
      const task = d.archiveYoung.task.entities[tid];
      if (!task) continue;

      if (task.projectId && !projectIds.has(task.projectId)) {
        _validityError(
          `projectId ${task.projectId} from archiveYoung task not existing`,
          {
            task,
            d,
          },
        );
        return false;
      }

      for (const tagId of task.tagIds) {
        if (!tagIds.has(tagId)) {
          _validityError(`tagId "${tagId}" from archiveYoung task not existing`, {
            task,
            d,
          });
          return false;
        }
      }

      // Check repeatCfgId reference
      if (task.repeatCfgId && !taskRepeatCfgIds.has(task.repeatCfgId)) {
        _validityError(
          `repeatCfgId "${task.repeatCfgId}" from archiveYoung task not existing`,
          { task, d },
        );
        return false;
      }
    }
  }

  // Validation for archiveOld tasks (same checks as archiveYoung)
  if (d.archiveOld.task?.ids) {
    for (const tid of d.archiveOld.task.ids) {
      const task = d.archiveOld.task.entities[tid];
      if (!task) continue;

      if (task.projectId && !projectIds.has(task.projectId)) {
        _validityError(`projectId ${task.projectId} from archiveOld task not existing`, {
          task,
          d,
        });
        return false;
      }

      for (const tagId of task.tagIds) {
        if (!tagIds.has(tagId)) {
          _validityError(`tagId "${tagId}" from archiveOld task not existing`, {
            task,
            d,
          });
          return false;
        }
      }

      // Check repeatCfgId reference
      if (task.repeatCfgId && !taskRepeatCfgIds.has(task.repeatCfgId)) {
        _validityError(
          `repeatCfgId "${task.repeatCfgId}" from archiveOld task not existing`,
          { task, d },
        );
        return false;
      }
    }
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
        PFLog.info(
          `[ValidateState] TODAY_TAG has ${orphanedIds.length} orphaned task IDs (harmless)`,
          { orphanedIds },
        );
      }
      continue; // Skip normal error handling for TODAY_TAG
    }

    for (const tid of tag.taskIds) {
      if (!taskIds.has(tid)) {
        _validityError(
          `Inconsistent Task State: Missing task id ${tid} for Tag ${tag.title}`,
          { tag, d },
        );
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
        _validityError(`Missing note data (tid: ${nid}) for Project ${project.title}`, {
          project,
          d,
        });
        return false;
      }

      if (note.projectId !== project.id) {
        _validityError('Inconsistent note projectId', { note, project, d });
        return false;
      }
    }
  }

  // Validate todayOrder list
  for (const nid of d.note.todayOrder) {
    if (!noteIds.has(nid)) {
      _validityError(
        `Inconsistent Note State: Missing note id ${nid} for note.todayOrder`,
        { d },
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
        task,
        d,
      });
      return false;
    }

    // Check if all subtasks exist
    for (const subId of task.subTaskIds) {
      if (!d.task.entities[subId]) {
        _validityError(
          `Inconsistent Task State: Missing sub task data in today ${subId}`,
          { task, d },
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
              task,
              d,
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
              { task, d },
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
              task,
              d,
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
              { task, d },
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
        { ip, d },
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
        _validityError(`Invalid menuTree node in ${treeType}`, { node, d });
        return false;
      }

      if (node.k === MenuTreeKind.FOLDER) {
        // Validate folder structure
        if (!node.id || !node.name) {
          _validityError(`Invalid folder node in ${treeType} - missing id or name`, {
            node,
            d,
          });
          return false;
        }

        if (!Array.isArray(node.children)) {
          _validityError(`Invalid folder node in ${treeType} - children not array`, {
            node,
            d,
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
          _validityError(`Project node in menuTree missing id`, { node, d });
          return false;
        }

        if (!projectIds.has(node.id)) {
          _validityError(
            `Orphaned project reference in menuTree - project ${node.id} doesn't exist`,
            { node, treeType, d },
          );
          return false;
        }
      } else if (treeType === 'tagTree' && node.k === MenuTreeKind.TAG) {
        // Validate tag reference
        if (!node.id) {
          _validityError(`Tag node in menuTree missing id`, { node, d });
          return false;
        }

        if (!tagIds.has(node.id)) {
          _validityError(
            `Orphaned tag reference in menuTree - tag ${node.id} doesn't exist`,
            { node, treeType, d },
          );
          return false;
        }
      } else {
        _validityError(`Invalid node kind in ${treeType}: ${node.k}`, { node, d });
        return false;
      }
    }
    return true;
  };

  // Validate projectTree
  if (d.menuTree?.projectTree) {
    if (!Array.isArray(d.menuTree.projectTree)) {
      _validityError('menuTree.projectTree is not an array', { d });
      return false;
    }
    if (!validateTreeNodes(d.menuTree.projectTree, 'projectTree')) {
      return false;
    }
  }

  // Validate tagTree
  if (d.menuTree?.tagTree) {
    if (!Array.isArray(d.menuTree.tagTree)) {
      _validityError('menuTree.tagTree is not an array', { d });
      return false;
    }
    if (!validateTreeNodes(d.menuTree.tagTree, 'tagTree')) {
      return false;
    }
  }

  return true;
};
