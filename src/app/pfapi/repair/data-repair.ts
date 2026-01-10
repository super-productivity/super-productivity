import {
  AppBaseDataEntityLikeStates,
  AppDataCompleteLegacy,
} from '../../imex/sync/sync.model';
import { TagCopy } from '../../features/tag/tag.model';
import { ProjectCopy } from '../../features/project/project.model';
import { isDataRepairPossible } from './is-data-repair-possible.util';
import { Task, TaskArchive, TaskCopy, TaskState } from '../../features/tasks/task.model';
import { unique } from '../../util/unique';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { TaskRepeatCfgCopy } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { ALL_ENTITY_MODEL_KEYS } from '../../core/persistence/persistence.const';
import { IssueProvider } from '../../features/issue/issue.model';
import { AppDataCompleteNew } from '../pfapi-config';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { autoFixTypiaErrors } from './auto-fix-typia-errors';
import { IValidation } from 'typia';
import { PFLog } from '../../core/log';
import { repairMenuTree } from './repair-menu-tree';

// TODO improve later
const ENTITY_STATE_KEYS: (keyof AppDataCompleteLegacy)[] = ALL_ENTITY_MODEL_KEYS;

export const dataRepair = (
  data: AppDataCompleteNew,
  errors: IValidation.IError[] = [],
): AppDataCompleteNew => {
  if (!isDataRepairPossible(data)) {
    throw new Error('Data repair attempted but not possible');
  }

  // console.time('dataRepair');
  // NOTE copy is important to prevent readonly errors
  let dataOut: AppDataCompleteNew = { ...data };
  // let dataOut: AppDataComplete = dirtyDeepCopy(data);

  // move all taskArchive data into young to make things easier for us
  dataOut.archiveYoung = {
    task: {
      ids: [...dataOut.archiveOld.task?.ids, ...dataOut.archiveYoung.task?.ids],
      entities: {
        ...dataOut.archiveOld.task?.entities,
        ...dataOut.archiveYoung.task?.entities,
      },
    },
    // NOTE only taskArchive data for now
    timeTracking: dataOut.archiveYoung.timeTracking,
    lastTimeTrackingFlush: dataOut.archiveYoung.lastTimeTrackingFlush,
  };
  dataOut.archiveOld = {
    task: { ids: [], entities: {} },
    timeTracking: dataOut.archiveOld.timeTracking,
    lastTimeTrackingFlush: dataOut.archiveOld.lastTimeTrackingFlush,
  };

  dataOut = _fixEntityStates(dataOut);
  dataOut = _removeMissingTasksFromListsOrRestoreFromArchive(dataOut);
  dataOut = _removeNonExistentProjectIdsFromIssueProviders(dataOut);
  dataOut = _removeNonExistentProjectIdsFromTaskRepeatCfg(dataOut);
  dataOut = _addOrphanedTasksToProjectLists(dataOut);
  dataOut = _moveArchivedSubTasksToUnarchivedParents(dataOut);
  dataOut = _moveUnArchivedSubTasksToArchivedParents(dataOut);
  dataOut = _cleanupOrphanedSubTasks(dataOut);
  dataOut = _cleanupNonExistingTasksFromLists(dataOut);
  dataOut = _cleanupNonExistingNotesFromLists(dataOut);
  dataOut = _fixInconsistentProjectId(dataOut);
  dataOut = _fixInconsistentTagId(dataOut);
  dataOut = _setTaskProjectIdAccordingToParent(dataOut);
  dataOut = _removeDuplicatesFromArchive(dataOut);
  dataOut = _removeMissingReminderIds(dataOut);
  dataOut = _fixTaskRepeatMissingWeekday(dataOut);
  dataOut = _fixTaskRepeatCfgInvalidQuickSetting(dataOut);
  dataOut = _createInboxProjectIfNecessary(dataOut);
  dataOut = _fixOrphanedNotes(dataOut);
  dataOut = _removeNonExistentProjectIdsFromTasks(dataOut);
  dataOut = _removeNonExistentTagsFromTasks(dataOut);
  dataOut = _addInboxProjectIdIfNecessary(dataOut);
  dataOut = _repairMenuTree(dataOut);
  dataOut = autoFixTypiaErrors(dataOut, errors);

  // console.timeEnd('dataRepair');
  return dataOut;
};

const _fixTaskRepeatMissingWeekday = (data: AppDataCompleteNew): AppDataCompleteNew => {
  if (data.taskRepeatCfg && data.taskRepeatCfg.entities) {
    Object.keys(data.taskRepeatCfg.entities).forEach((key) => {
      const cfg = data.taskRepeatCfg.entities[key] as TaskRepeatCfgCopy;
      cfg.monday = cfg.monday ?? false;
      cfg.tuesday = cfg.tuesday ?? false;
      cfg.wednesday = cfg.wednesday ?? false;
      cfg.thursday = cfg.thursday ?? false;
      cfg.friday = cfg.friday ?? false;
      cfg.saturday = cfg.saturday ?? false;
      cfg.sunday = cfg.sunday ?? false;
    });
  }
  return data;
};

// Fix for issue #5802: repeat configs with date-dependent quickSetting but missing startDate
const _fixTaskRepeatCfgInvalidQuickSetting = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  if (data.taskRepeatCfg && data.taskRepeatCfg.entities) {
    const quickSettingsRequiringStartDate = [
      'WEEKLY_CURRENT_WEEKDAY',
      'YEARLY_CURRENT_DATE',
      'MONTHLY_CURRENT_DATE',
    ];
    Object.keys(data.taskRepeatCfg.entities).forEach((key) => {
      const cfg = data.taskRepeatCfg.entities[key] as TaskRepeatCfgCopy;
      if (
        cfg.quickSetting &&
        quickSettingsRequiringStartDate.includes(cfg.quickSetting) &&
        !cfg.startDate
      ) {
        PFLog.log(
          `Fixing repeat config ${cfg.id}: ${cfg.quickSetting} with missing startDate -> CUSTOM`,
        );
        cfg.quickSetting = 'CUSTOM';
      }
    });
  }
  return data;
};

const _fixEntityStates = (data: AppDataCompleteNew): AppDataCompleteNew => {
  ENTITY_STATE_KEYS.forEach((key) => {
    data[key] = _resetEntityIdsFromObjects(
      data[key] as AppBaseDataEntityLikeStates,
    ) as any;
  });
  // TODO improve typing for helper fn _resetEntityIdsFromObjects
  data.archiveYoung.task = _resetEntityIdsFromObjects(
    data.archiveYoung.task as any,
  ) as any;

  return data;
};

const _removeDuplicatesFromArchive = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const taskIds = data.task.ids as string[];
  const archiveTaskIds = data.archiveYoung.task.ids as string[];
  const duplicateIds = taskIds.filter((id) => archiveTaskIds.includes(id));

  if (duplicateIds.length) {
    data.archiveYoung.task.ids = archiveTaskIds.filter(
      (id) => !duplicateIds.includes(id),
    );
    duplicateIds.forEach((id) => {
      if (data.archiveYoung.task.entities[id]) {
        delete data.archiveYoung.task.entities[id];
      }
    });
    if (duplicateIds.length > 0) {
      PFLog.log(duplicateIds.length + ' duplicates removed from archive.');
    }
  }
  return data;
};

const _removeMissingReminderIds = (data: AppDataCompleteNew): AppDataCompleteNew => {
  data.task.ids.forEach((id: string) => {
    const t: Task = data.task.entities[id] as Task;
    if (t.reminderId && !data.reminders.find((r) => r.id === t.reminderId)) {
      data.task.entities[id] = {
        ...t,
        reminderId: undefined,
        dueWithTime: undefined,
      };
    }
  });
  return data;
};

const _moveArchivedSubTasksToUnarchivedParents = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveState: TaskArchive = data.archiveYoung.task;
  const orphanArchivedSubTasks: TaskCopy[] = taskArchiveState.ids
    .map((id: string) => taskArchiveState.entities[id] as TaskCopy)
    .filter((t: TaskCopy) => t.parentId && !taskArchiveState.ids.includes(t.parentId));

  PFLog.log('orphanArchivedSubTasks', orphanArchivedSubTasks);
  orphanArchivedSubTasks.forEach((t: TaskCopy) => {
    // delete archived if duplicate
    if (taskState.ids.includes(t.id as string)) {
      taskArchiveState.ids = taskArchiveState.ids.filter((id) => t.id !== id);
      delete taskArchiveState.entities[t.id];
      // if entity is empty for some reason
      if (!taskState.entities[t.id]) {
        taskState.entities[t.id] = t;
      }
    }
    // copy to today if parent exists
    else if (taskState.ids.includes(t.parentId as string)) {
      taskState.ids.push(t.id);
      taskState.entities[t.id] = t;
      const par: TaskCopy = taskState.entities[t.parentId as string] as TaskCopy;

      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from archive
      taskArchiveState.ids = taskArchiveState.ids.filter((id) => t.id !== id);

      delete taskArchiveState.entities[t.id];
    }
    // make main if it doesn't
    else {
      t.parentId = undefined;
    }
  });

  return data;
};

const _moveUnArchivedSubTasksToArchivedParents = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveState: TaskArchive = data.archiveYoung.task;
  const orphanUnArchivedSubTasks: TaskCopy[] = taskState.ids
    .map((id: string) => taskState.entities[id] as TaskCopy)
    .filter((t: TaskCopy) => t.parentId && !taskState.ids.includes(t.parentId));

  PFLog.log('orphanUnArchivedSubTasks', orphanUnArchivedSubTasks);
  orphanUnArchivedSubTasks.forEach((t: TaskCopy) => {
    // delete un-archived if duplicate
    if (taskArchiveState.ids.includes(t.id as string)) {
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
      // if entity is empty for some reason
      if (!taskArchiveState.entities[t.id]) {
        taskArchiveState.entities[t.id] = t;
      }
    }
    // copy to archive if parent exists
    else if (taskArchiveState.ids.includes(t.parentId as string)) {
      taskArchiveState.ids.push(t.id);
      taskArchiveState.entities[t.id] = t;

      const par: TaskCopy = taskArchiveState.entities[t.parentId as string] as TaskCopy;
      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from today
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
    }
    // make main if it doesn't
    else {
      t.parentId = undefined;
    }
  });

  return data;
};

const _removeMissingTasksFromListsOrRestoreFromArchive = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { task, project, tag, archiveYoung } = data;
  const taskIds: string[] = task.ids;
  const taskArchiveIds: string[] = archiveYoung.task.ids as string[];
  const taskIdsToRestoreFromArchive: string[] = [];

  project.ids.forEach((pId: string | number) => {
    const projectItem = project.entities[pId] as ProjectCopy;

    projectItem.taskIds = projectItem.taskIds.filter((id: string): boolean => {
      if (taskArchiveIds.includes(id)) {
        taskIdsToRestoreFromArchive.push(id);
        return true;
      }
      return taskIds.includes(id);
    });

    projectItem.backlogTaskIds = projectItem.backlogTaskIds.filter(
      (id: string): boolean => {
        if (taskArchiveIds.includes(id)) {
          taskIdsToRestoreFromArchive.push(id);
          return true;
        }
        return taskIds.includes(id);
      },
    );
  });

  tag.ids.forEach((tId: string | number) => {
    const tagItem = tag.entities[tId] as TagCopy;
    const filteredTaskIds = tagItem.taskIds.filter((id) => taskIds.includes(id));
    tag.entities[tId] = { ...tagItem, taskIds: filteredTaskIds };
  });

  taskIdsToRestoreFromArchive.forEach((id) => {
    task.entities[id] = archiveYoung.task.entities[id];
    delete archiveYoung.task.entities[id];
  });
  task.ids = [...taskIds, ...taskIdsToRestoreFromArchive];
  archiveYoung.task.ids = taskArchiveIds.filter(
    (id) => !taskIdsToRestoreFromArchive.includes(id),
  );

  if (taskIdsToRestoreFromArchive.length > 0) {
    PFLog.log(
      taskIdsToRestoreFromArchive.length + ' missing tasks restored from archive.',
    );
  }
  return data;
};

const _resetEntityIdsFromObjects = <T extends AppBaseDataEntityLikeStates>(
  data: T,
): T => {
  if (!data?.entities) {
    return {
      ...data,
      entities: {},
      ids: [],
    } as T;
  }

  return {
    ...data,
    entities: data.entities || {},
    ids: data.entities
      ? Object.keys(data.entities).filter((id) => !!data.entities[id])
      : [],
  };
};

const _addOrphanedTasksToProjectLists = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { task, project } = data;
  let allTaskIdsOnProjectLists: string[] = [];

  project.ids.forEach((pId: string | number) => {
    const projectItem = project.entities[pId] as ProjectCopy;
    allTaskIdsOnProjectLists = allTaskIdsOnProjectLists.concat(
      projectItem.taskIds,
      projectItem.backlogTaskIds,
    );
  });
  const orphanedTaskIds: string[] = task.ids.filter((tid) => {
    const taskItem = task.entities[tid];
    if (!taskItem) {
      throw new Error('Missing task');
    }
    return (
      !taskItem.parentId && !allTaskIdsOnProjectLists.includes(tid) && taskItem.projectId
    );
  });

  orphanedTaskIds.forEach((tid) => {
    const taskItem = task.entities[tid];
    if (!taskItem) {
      throw new Error('Missing task');
    }
    const targetProject = project.entities[taskItem.projectId as string];
    if (targetProject) {
      project.entities[taskItem.projectId as string] = {
        ...targetProject,
        taskIds: [...targetProject.taskIds, tid],
      };
    }
  });

  if (orphanedTaskIds.length > 0) {
    PFLog.log(orphanedTaskIds.length + ' orphaned tasks found & restored.');
  }

  return data;
};

const _addInboxProjectIdIfNecessary = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const { task, archiveYoung } = data;
  const taskIds: string[] = task.ids;
  const taskArchiveIds: string[] = archiveYoung.task.ids as string[];

  if (!data.project.entities[INBOX_PROJECT.id]) {
    data.project.entities[INBOX_PROJECT.id] = {
      ...INBOX_PROJECT,
    };

    data.project.ids = [INBOX_PROJECT.id, ...data.project.ids] as string[];
  }

  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (!t.projectId) {
      PFLog.log('Set inbox project id for task  ' + t.id);

      const inboxProject = data.project.entities[INBOX_PROJECT.id]!;
      data.project.entities[INBOX_PROJECT.id] = {
        ...inboxProject,
        taskIds: [...(inboxProject.taskIds as string[]), t.id],
      };
      t.projectId = INBOX_PROJECT.id;
    }

    // while we are at it, we also cleanup the today tag
    if (t.tagIds.includes(TODAY_TAG.id)) {
      t.tagIds = t.tagIds.filter((idI) => idI !== TODAY_TAG.id);
    }
  });

  PFLog.log(taskArchiveIds);
  PFLog.log(Object.keys(archiveYoung.task.entities));

  taskArchiveIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (!t.projectId) {
      PFLog.log('Set inbox project for missing project id from archive task ' + t.id);
      t.projectId = INBOX_PROJECT.id;
    }
    // while we are at it, we also cleanup the today tag
    if (t.tagIds.includes(TODAY_TAG.id)) {
      t.tagIds = t.tagIds.filter((idI) => idI !== TODAY_TAG.id);
    }
  });

  return data;
};

const _createInboxProjectIfNecessary = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const { project } = data;
  if (!project.entities[INBOX_PROJECT.id]) {
    data.project.entities[INBOX_PROJECT.id] = {
      ...INBOX_PROJECT,
    };

    data.project.ids = [INBOX_PROJECT.id, ...data.project.ids] as string[];
  }

  return data;
};

// TODO replace with INBOX_PROJECT.id
const _removeNonExistentProjectIdsFromTasks = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { task, project, archiveYoung } = data;
  const projectIds: string[] = project.ids as string[];
  const taskIds: string[] = task.ids;
  const taskArchiveIds: string[] = archiveYoung.task.ids as string[];
  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (t.projectId && !projectIds.includes(t.projectId)) {
      PFLog.log('Delete missing project id from task ' + t.projectId);
      t.projectId = INBOX_PROJECT.id;
    }
  });

  PFLog.log(taskArchiveIds);
  PFLog.log(Object.keys(archiveYoung.task.entities));

  taskArchiveIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (t.projectId && !projectIds.includes(t.projectId)) {
      PFLog.log('Delete missing project id from archive task ' + t.projectId);
      t.projectId = INBOX_PROJECT.id;
    }
  });

  return data;
};

const _removeNonExistentTagsFromTasks = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { task, tag, archiveYoung } = data;
  const tagIds: string[] = tag.ids as string[];
  const taskIds: string[] = task.ids;
  const taskArchiveIds: string[] = archiveYoung.task.ids as string[];
  let removedCount = 0;

  // Helper function to filter valid tags
  // Note: We exclude TODAY_TAG.id as it's handled separately and removed elsewhere
  const filterValidTags = (taskTagIds: string[]): string[] => {
    return taskTagIds.filter((tagId) => {
      // Skip TODAY_TAG as it's handled elsewhere
      if (tagId === TODAY_TAG.id) {
        return false;
      }
      return tagIds.includes(tagId);
    });
  };

  // Fix tasks in main task state
  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (t.tagIds && t.tagIds.length > 0) {
      const validTagIds = filterValidTags(t.tagIds);
      if (validTagIds.length !== t.tagIds.length) {
        const removedTags = t.tagIds.filter(
          (tagId) => !tagIds.includes(tagId) && tagId !== TODAY_TAG.id,
        );
        if (removedTags.length > 0) {
          PFLog.log(
            `Removing non-existent tags from task ${t.id}: ${removedTags.join(', ')}`,
          );
          removedCount += removedTags.length;
        }
        t.tagIds = validTagIds;
      }
    }
  });

  // Fix tasks in archive
  taskArchiveIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (t.tagIds && t.tagIds.length > 0) {
      const validTagIds = filterValidTags(t.tagIds);
      if (validTagIds.length !== t.tagIds.length) {
        const removedTags = t.tagIds.filter(
          (tagId) => !tagIds.includes(tagId) && tagId !== TODAY_TAG.id,
        );
        if (removedTags.length > 0) {
          PFLog.log(
            `Removing non-existent tags from archive task ${t.id}: ${removedTags.join(', ')}`,
          );
          removedCount += removedTags.length;
        }
        t.tagIds = validTagIds;
      }
    }
  });

  if (removedCount > 0) {
    PFLog.log(`Total non-existent tags removed from tasks: ${removedCount}`);
  }

  return data;
};

const _removeNonExistentProjectIdsFromIssueProviders = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { issueProvider, project } = data;
  const projectIds: string[] = project.ids as string[];
  const issueProviderIds: string[] = issueProvider.ids;
  issueProviderIds.forEach((id) => {
    const t = issueProvider.entities[id] as IssueProvider;
    if (t.defaultProjectId && !projectIds.includes(t.defaultProjectId)) {
      PFLog.log('Delete missing project id from issueProvider ' + t.defaultProjectId);
      t.defaultProjectId = null;
    }
  });

  return data;
};

const _removeNonExistentProjectIdsFromTaskRepeatCfg = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const { project, taskRepeatCfg } = data;
  const projectIds: string[] = project.ids as string[];
  const taskRepeatCfgIds: string[] = taskRepeatCfg.ids as string[];
  taskRepeatCfgIds.forEach((id) => {
    const repeatCfg = taskRepeatCfg.entities[id] as TaskRepeatCfgCopy;
    if (repeatCfg.projectId && !projectIds.includes(repeatCfg.projectId)) {
      if (repeatCfg.tagIds.length) {
        PFLog.log(
          'Delete missing project id from task repeat cfg ' + repeatCfg.projectId,
        );
        repeatCfg.projectId = null;
      } else {
        taskRepeatCfg.ids = (taskRepeatCfg.ids as string[]).filter(
          (rid: string) => rid !== repeatCfg.id,
        );
        delete taskRepeatCfg.entities[repeatCfg.id];
        PFLog.log('Delete task repeat cfg with missing project id' + repeatCfg.projectId);
      }
    }
  });
  return data;
};

const _cleanupNonExistingTasksFromLists = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds.forEach((pid) => {
    const projectItem = data.project.entities[pid];
    if (!projectItem) {
      PFLog.log(data.project);
      throw new Error('No project');
    }
    (projectItem as ProjectCopy).taskIds = projectItem.taskIds.filter(
      (tid) => !!data.task.entities[tid],
    );
    (projectItem as ProjectCopy).backlogTaskIds = projectItem.backlogTaskIds.filter(
      (tid) => !!data.task.entities[tid],
    );
  });
  const tagIds: string[] = data.tag.ids as string[];
  tagIds
    .map((id) => data.tag.entities[id])
    .forEach((tagItem) => {
      if (!tagItem) {
        PFLog.log(data.tag);
        throw new Error('No tag');
      }
      (tagItem as TagCopy).taskIds = tagItem.taskIds.filter(
        (tid) => !!data.task.entities[tid],
      );
    });
  return data;
};

const _cleanupNonExistingNotesFromLists = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds.forEach((pid) => {
    const projectItem = data.project.entities[pid];
    if (!projectItem) {
      PFLog.log(data.project);
      throw new Error('No project');
    }
    (projectItem as ProjectCopy).noteIds = (projectItem as ProjectCopy).noteIds
      ? projectItem.noteIds.filter((tid) => !!data.note.entities[tid])
      : [];
  });

  // also cleanup today's notes
  data.note.todayOrder = data.note.todayOrder
    ? data.note.todayOrder.filter((tid) => !!data.note.entities[tid])
    : [];

  return data;
};

const _fixOrphanedNotes = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const noteIds: string[] = data.note.ids as string[];
  noteIds.forEach((nId) => {
    const note = data.note.entities[nId];
    if (!note) {
      PFLog.log(data.note);
      throw new Error('No note');
    }
    // missing project case
    if (note.projectId) {
      if (data.project.entities[note.projectId]) {
        if (!data.project.entities[note.projectId]!.noteIds.includes(note.id)) {
          PFLog.log(
            'Add orphaned note back to project list ' + note.projectId + ' ' + note.id,
          );

          const project = data.project.entities[note.projectId]!;
          data.project.entities[note.projectId] = {
            ...project,
            noteIds: [...project.noteIds, note.id],
          };
        }
      } else {
        PFLog.log('Delete missing project id from note ' + note.id);
        note.projectId = null;

        if (!data.note.todayOrder.includes(note.id)) {
          data.note.todayOrder = [...data.note.todayOrder, note.id];
        }
      }
    } // orphaned note case
    else if (!data.note.todayOrder.includes(note.id)) {
      PFLog.log('Add orphaned note to today list ' + note.id);

      if (!data.note.todayOrder.includes(note.id)) {
        data.note.todayOrder = [...data.note.todayOrder, note.id];
      }
    }
  });

  return data;
};

const _fixInconsistentProjectId = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds
    .map((id) => data.project.entities[id])
    .forEach((projectItem) => {
      if (!projectItem) {
        PFLog.log(data.project);
        throw new Error('No project');
      }
      projectItem.taskIds.forEach((tid) => {
        const task = data.task.entities[tid];
        if (!task) {
          throw new Error('No task found');
        } else if (task?.projectId !== projectItem.id) {
          // if the task has another projectId leave it there and remove from list
          if (task.projectId) {
            (projectItem as ProjectCopy).taskIds = projectItem.taskIds.filter(
              (cid) => cid !== task.id,
            );
          } else {
            // if the task has no project id at all, then move it to the project
            (task as TaskCopy).projectId = projectItem.id;
          }
        }
      });
      projectItem.backlogTaskIds.forEach((tid) => {
        const task = data.task.entities[tid];
        if (!task) {
          throw new Error('No task found');
        } else if (task?.projectId !== projectItem.id) {
          // if the task has another projectId leave it there and remove from list
          if (task.projectId) {
            (projectItem as ProjectCopy).backlogTaskIds =
              projectItem.backlogTaskIds.filter((cid) => cid !== task.id);
          } else {
            // if the task has no project id at all, then move it to the project
            (task as TaskCopy).projectId = projectItem.id;
          }
        }
      });
    });

  return data;
};

const _fixInconsistentTagId = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const tagIds: string[] = data.tag.ids as string[];
  tagIds
    .map((id) => data.tag.entities[id])
    .forEach((tagItem) => {
      if (!tagItem) {
        PFLog.log(data.tag);
        throw new Error('No tag');
      }
      tagItem.taskIds.forEach((tid) => {
        const task = data.task.entities[tid];
        if (!task) {
          throw new Error('No task found');
        } else if (!task?.tagIds.includes(tagItem.id)) {
          (task as TaskCopy).tagIds = [...task.tagIds, tagItem.id];
        }
      });
    });

  return data;
};

const _setTaskProjectIdAccordingToParent = (
  data: AppDataCompleteNew,
): AppDataCompleteNew => {
  const taskIds: string[] = data.task.ids as string[];
  taskIds
    .map((id) => data.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        PFLog.log(data.task);
        throw new Error('No task');
      }
      if (taskItem.subTaskIds) {
        const parentProjectId = taskItem.projectId;
        taskItem.subTaskIds.forEach((stid) => {
          const subTask = data.task.entities[stid];
          if (!subTask) {
            throw new Error('Task data not found');
          }
          if (subTask.projectId !== parentProjectId) {
            (subTask as TaskCopy).projectId = parentProjectId;
          }
        });
      }
    });

  const archiveTaskIds: string[] = data.archiveYoung.task.ids as string[];
  archiveTaskIds
    .map((id) => data.archiveYoung.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        PFLog.log(data.archiveYoung.task);
        throw new Error('No archive task');
      }
      if (taskItem.subTaskIds) {
        const parentProjectId = taskItem.projectId;
        taskItem.subTaskIds.forEach((stid) => {
          const subTask = data.archiveYoung.task.entities[stid];
          if (!subTask) {
            throw new Error('Archived Task data not found');
          }
          if (subTask.projectId !== parentProjectId) {
            (subTask as TaskCopy).projectId = parentProjectId;
          }
        });
      }
    });

  return data;
};

const _cleanupOrphanedSubTasks = (data: AppDataCompleteNew): AppDataCompleteNew => {
  const taskIds: string[] = data.task.ids as string[];

  taskIds
    .map((id) => data.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        PFLog.log(data.task);
        throw new Error('No task');
      }

      if (taskItem.subTaskIds.length) {
        let i = taskItem.subTaskIds.length - 1;
        while (i >= 0) {
          const sid = taskItem.subTaskIds[i];
          if (!data.task.entities[sid]) {
            PFLog.log('Delete orphaned sub task for ', taskItem);
            taskItem.subTaskIds.splice(i, 1);
          }
          i -= 1;
        }
      }
    });

  const archiveTaskIds: string[] = data.archiveYoung.task.ids as string[];
  archiveTaskIds
    .map((id) => data.archiveYoung.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        PFLog.log(data.archiveYoung.task);
        throw new Error('No archive task');
      }

      if (taskItem.subTaskIds.length) {
        let i = taskItem.subTaskIds.length - 1;
        while (i >= 0) {
          const sid = taskItem.subTaskIds[i];
          if (!data.archiveYoung.task.entities[sid]) {
            PFLog.log('Delete orphaned archive sub task for ', taskItem);
            taskItem.subTaskIds.splice(i, 1);
          }
          i -= 1;
        }
      }
    });

  return data;
};

const _repairMenuTree = (data: AppDataCompleteNew): AppDataCompleteNew => {
  if (!data.menuTree) {
    return data;
  }

  const validProjectIds = new Set<string>(data.project.ids as string[]);
  const validTagIds = new Set<string>(data.tag.ids as string[]);

  data.menuTree = repairMenuTree(data.menuTree, validProjectIds, validTagIds);

  return data;
};
