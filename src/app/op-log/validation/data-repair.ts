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
import { IssueProvider } from '../../features/issue/issue.model';
import { AppDataComplete } from '../model/model-config';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { autoFixTypiaErrors } from './auto-fix-typia-errors';
import { IValidation } from 'typia';
import { OpLog } from '../../core/log';
import { repairMenuTree } from './repair-menu-tree';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';

/**
 * Entity state keys that have ids/entities structure.
 * Used for fixing entity state consistency during repair.
 */
const ENTITY_STATE_KEYS: (keyof AppDataCompleteLegacy)[] = [
  'project',
  'issueProvider',
  'tag',
  'simpleCounter',
  'note',
  'metric',
  'task',
  'taskRepeatCfg',
];

export const dataRepair = (
  data: AppDataComplete,
  errors: IValidation.IError[] = [],
): AppDataComplete => {
  if (!isDataRepairPossible(data)) {
    throw new Error('Data repair attempted but not possible');
  }

  // console.time('dataRepair');
  // NOTE deep copy is important to prevent readonly errors from frozen NgRx state
  // We detect if the state is frozen and only deep clone in that case for performance
  const isFrozen =
    Object.isFrozen(data) ||
    (data.task && Object.isFrozen(data.task)) ||
    (data.project && Object.isFrozen(data.project));
  let dataOut: AppDataComplete = isFrozen ? structuredClone(data) : { ...data };

  // Ensure archive structures exist
  if (!dataOut.archiveYoung) {
    dataOut.archiveYoung = {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    };
  }
  if (!dataOut.archiveYoung.task) {
    dataOut.archiveYoung.task = { ids: [], entities: {} };
  }
  if (!dataOut.archiveOld) {
    dataOut.archiveOld = {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    };
  }
  if (!dataOut.archiveOld.task) {
    dataOut.archiveOld.task = { ids: [], entities: {} };
  }

  // Initialize reminders if missing
  if (!dataOut.reminders) {
    dataOut.reminders = [];
  }

  // NOTE: We no longer merge archiveOld into archiveYoung during repair.
  // The dual-archive architecture keeps them separate for proper age-based archiving.

  dataOut = _fixEntityStates(dataOut);
  dataOut = _removeMissingTasksFromListsOrRestoreFromArchive(dataOut);
  dataOut = _removeNonExistentProjectIdsFromIssueProviders(dataOut);
  dataOut = _removeNonExistentProjectIdsFromTaskRepeatCfg(dataOut);
  dataOut = _removeNonExistentRepeatCfgIdsFromTasks(dataOut);
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
  dataOut = _clearLegacyReminderIds(dataOut);
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

const _fixTaskRepeatMissingWeekday = (data: AppDataComplete): AppDataComplete => {
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
const _fixTaskRepeatCfgInvalidQuickSetting = (data: AppDataComplete): AppDataComplete => {
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
        OpLog.log(
          `Fixing repeat config ${cfg.id}: ${cfg.quickSetting} with missing startDate -> CUSTOM`,
        );
        cfg.quickSetting = 'CUSTOM';
      }
    });
  }
  return data;
};

/**
 * Type-safe helper to reset entity IDs for a specific key.
 * Uses Object.assign to avoid TypeScript's dynamic key assignment limitation.
 */
const _resetEntityStateForKey = (
  data: AppDataComplete,
  key: keyof AppDataCompleteLegacy,
): void => {
  const currentState = data[key as keyof AppDataComplete];
  if (currentState && typeof currentState === 'object' && 'entities' in currentState) {
    const resetState = _resetEntityIdsFromObjects(
      currentState as AppBaseDataEntityLikeStates,
    );
    // Use Object.assign to mutate in place, avoiding dynamic key assignment issues
    Object.assign(currentState, resetState);
  } else {
    // Entity state is missing, null, or lacks proper shape — initialize with defaults
    (data as Record<string, unknown>)[key] = { ids: [], entities: {} };
  }
};

const _fixEntityStates = (data: AppDataComplete): AppDataComplete => {
  ENTITY_STATE_KEYS.forEach((key) => {
    _resetEntityStateForKey(data, key);
  });
  data.archiveYoung.task = _resetEntityIdsFromObjects(
    data.archiveYoung.task as TaskArchive,
  ) as TaskArchive;
  data.archiveOld.task = _resetEntityIdsFromObjects(
    data.archiveOld.task as TaskArchive,
  ) as TaskArchive;

  return data;
};

const _removeDuplicatesFromArchive = (data: AppDataComplete): AppDataComplete => {
  if (!data.task || !data.archiveYoung?.task || !data.archiveOld?.task) {
    return data;
  }
  const taskIds = data.task.ids as string[];
  const archiveYoungTaskIds = data.archiveYoung.task.ids as string[];
  const archiveOldTaskIds = data.archiveOld.task.ids as string[];

  // Remove duplicates between main tasks and archiveYoung
  const duplicateYoungIds = taskIds.filter((id) => archiveYoungTaskIds.includes(id));
  if (duplicateYoungIds.length) {
    data.archiveYoung.task.ids = archiveYoungTaskIds.filter(
      (id) => !duplicateYoungIds.includes(id),
    );
    duplicateYoungIds.forEach((id) => {
      if (data.archiveYoung.task.entities[id]) {
        delete data.archiveYoung.task.entities[id];
      }
    });
    if (duplicateYoungIds.length > 0) {
      OpLog.log(duplicateYoungIds.length + ' duplicates removed from archiveYoung.');
    }
  }

  // Remove duplicates between main tasks and archiveOld
  const duplicateOldIds = taskIds.filter((id) => archiveOldTaskIds.includes(id));
  if (duplicateOldIds.length) {
    data.archiveOld.task.ids = archiveOldTaskIds.filter(
      (id) => !duplicateOldIds.includes(id),
    );
    duplicateOldIds.forEach((id) => {
      if (data.archiveOld.task.entities[id]) {
        delete data.archiveOld.task.entities[id];
      }
    });
    if (duplicateOldIds.length > 0) {
      OpLog.log(duplicateOldIds.length + ' duplicates removed from archiveOld.');
    }
  }

  // Remove duplicates between archiveYoung and archiveOld (keep in archiveOld as it's older)
  const duplicateBetweenArchives = archiveYoungTaskIds.filter((id) =>
    archiveOldTaskIds.includes(id),
  );
  if (duplicateBetweenArchives.length) {
    data.archiveYoung.task.ids = archiveYoungTaskIds.filter(
      (id) => !duplicateBetweenArchives.includes(id),
    );
    duplicateBetweenArchives.forEach((id) => {
      if (data.archiveYoung.task.entities[id]) {
        delete data.archiveYoung.task.entities[id];
      }
    });
    if (duplicateBetweenArchives.length > 0) {
      OpLog.log(
        duplicateBetweenArchives.length +
          ' duplicates removed from archiveYoung (kept in archiveOld).',
      );
    }
  }

  return data;
};

// Clear any legacy reminderId values - reminders now use remindAt directly on tasks
const _clearLegacyReminderIds = (data: AppDataComplete): AppDataComplete => {
  data.task.ids.forEach((id: string) => {
    const t = data.task.entities[id] as Task & { reminderId?: string };
    if (t.reminderId) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { reminderId, ...taskWithoutReminderId } = t as TaskCopy & {
        reminderId?: string;
      };
      data.task.entities[id] = taskWithoutReminderId;
    }
  });
  return data;
};

const _moveArchivedSubTasksToUnarchivedParents = (
  data: AppDataComplete,
): AppDataComplete => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveYoungState: TaskArchive = data.archiveYoung.task;
  const taskArchiveOldState: TaskArchive = data.archiveOld.task;

  // Handle orphaned subtasks in archiveYoung
  const orphanArchivedYoungSubTasks: TaskCopy[] = taskArchiveYoungState.ids
    .map((id: string) => taskArchiveYoungState.entities[id] as TaskCopy)
    .filter(
      (t: TaskCopy) =>
        t.parentId &&
        !taskArchiveYoungState.ids.includes(t.parentId) &&
        !taskArchiveOldState.ids.includes(t.parentId),
    );

  OpLog.log('orphanArchivedYoungSubTasks', orphanArchivedYoungSubTasks);
  const promotedYoungSubTaskIds: string[] = [];
  orphanArchivedYoungSubTasks.forEach((t: TaskCopy) => {
    // delete archived if duplicate
    if (taskState.ids.includes(t.id as string)) {
      taskArchiveYoungState.ids = taskArchiveYoungState.ids.filter((id) => t.id !== id);
      delete taskArchiveYoungState.entities[t.id];
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
      taskArchiveYoungState.ids = taskArchiveYoungState.ids.filter((id) => t.id !== id);

      delete taskArchiveYoungState.entities[t.id];
    }
    // make main if it doesn't
    else {
      promotedYoungSubTaskIds.push(t.id);
      t.parentId = undefined;
    }
  });
  if (promotedYoungSubTaskIds.length > 0) {
    OpLog.warn(
      `[data-repair] ${promotedYoungSubTaskIds.length} archived subtask(s) promoted to standalone tasks due to missing parent:`,
      promotedYoungSubTaskIds,
    );
  }

  // Handle orphaned subtasks in archiveOld
  const orphanArchivedOldSubTasks: TaskCopy[] = taskArchiveOldState.ids
    .map((id: string) => taskArchiveOldState.entities[id] as TaskCopy)
    .filter(
      (t: TaskCopy) =>
        t.parentId &&
        !taskArchiveOldState.ids.includes(t.parentId) &&
        !taskArchiveYoungState.ids.includes(t.parentId),
    );

  OpLog.log('orphanArchivedOldSubTasks', orphanArchivedOldSubTasks);
  const promotedOldSubTaskIds: string[] = [];
  orphanArchivedOldSubTasks.forEach((t: TaskCopy) => {
    // delete archived if duplicate
    if (taskState.ids.includes(t.id as string)) {
      taskArchiveOldState.ids = taskArchiveOldState.ids.filter((id) => t.id !== id);
      delete taskArchiveOldState.entities[t.id];
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
      taskArchiveOldState.ids = taskArchiveOldState.ids.filter((id) => t.id !== id);

      delete taskArchiveOldState.entities[t.id];
    }
    // make main if it doesn't
    else {
      promotedOldSubTaskIds.push(t.id);
      t.parentId = undefined;
    }
  });
  if (promotedOldSubTaskIds.length > 0) {
    OpLog.warn(
      `[data-repair] ${promotedOldSubTaskIds.length} old archived subtask(s) promoted to standalone tasks due to missing parent:`,
      promotedOldSubTaskIds,
    );
  }

  return data;
};

const _moveUnArchivedSubTasksToArchivedParents = (
  data: AppDataComplete,
): AppDataComplete => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveYoungState: TaskArchive = data.archiveYoung.task;
  const taskArchiveOldState: TaskArchive = data.archiveOld.task;
  const orphanUnArchivedSubTasks: TaskCopy[] = taskState.ids
    .map((id: string) => taskState.entities[id] as TaskCopy)
    .filter((t: TaskCopy) => t.parentId && !taskState.ids.includes(t.parentId));

  OpLog.log('orphanUnArchivedSubTasks', orphanUnArchivedSubTasks);
  const promotedUnArchivedSubTaskIds: string[] = [];
  orphanUnArchivedSubTasks.forEach((t: TaskCopy) => {
    // delete un-archived if duplicate in either archive
    if (taskArchiveYoungState.ids.includes(t.id as string)) {
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
      // if entity is empty for some reason
      if (!taskArchiveYoungState.entities[t.id]) {
        taskArchiveYoungState.entities[t.id] = t;
      }
    } else if (taskArchiveOldState.ids.includes(t.id as string)) {
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
      // if entity is empty for some reason
      if (!taskArchiveOldState.entities[t.id]) {
        taskArchiveOldState.entities[t.id] = t;
      }
    }
    // copy to archiveYoung if parent exists there
    else if (taskArchiveYoungState.ids.includes(t.parentId as string)) {
      taskArchiveYoungState.ids.push(t.id);
      taskArchiveYoungState.entities[t.id] = t;

      const par: TaskCopy = taskArchiveYoungState.entities[
        t.parentId as string
      ] as TaskCopy;
      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from today
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
    }
    // copy to archiveOld if parent exists there
    else if (taskArchiveOldState.ids.includes(t.parentId as string)) {
      taskArchiveOldState.ids.push(t.id);
      taskArchiveOldState.entities[t.id] = t;

      const par: TaskCopy = taskArchiveOldState.entities[
        t.parentId as string
      ] as TaskCopy;
      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from today
      taskState.ids = taskState.ids.filter((id) => t.id !== id);
      delete taskState.entities[t.id];
    }
    // make main if parent doesn't exist anywhere
    else {
      promotedUnArchivedSubTaskIds.push(t.id);
      t.parentId = undefined;
    }
  });
  if (promotedUnArchivedSubTaskIds.length > 0) {
    OpLog.warn(
      `[data-repair] ${promotedUnArchivedSubTaskIds.length} unarchived subtask(s) promoted to standalone tasks due to missing parent:`,
      promotedUnArchivedSubTaskIds,
    );
  }

  return data;
};

const _removeMissingTasksFromListsOrRestoreFromArchive = (
  data: AppDataComplete,
): AppDataComplete => {
  const { task, project, tag, archiveYoung, archiveOld } = data;
  const taskIds: string[] = task.ids as string[];
  const taskArchiveYoungIds: string[] = archiveYoung.task.ids as string[];
  const taskArchiveOldIds: string[] = archiveOld.task.ids as string[];
  const taskIdsToRestoreFromArchive: string[] = [];

  project.ids.forEach((pId: string | number) => {
    const projectItem = project.entities[pId] as ProjectCopy;

    projectItem.taskIds = projectItem.taskIds.filter((id: string): boolean => {
      if (taskArchiveYoungIds.includes(id) || taskArchiveOldIds.includes(id)) {
        taskIdsToRestoreFromArchive.push(id);
        return true;
      }
      return taskIds.includes(id);
    });

    projectItem.backlogTaskIds = projectItem.backlogTaskIds.filter(
      (id: string): boolean => {
        if (taskArchiveYoungIds.includes(id) || taskArchiveOldIds.includes(id)) {
          taskIdsToRestoreFromArchive.push(id);
          return true;
        }
        return taskIds.includes(id);
      },
    );
  });

  tag.ids.forEach((tId: string | number) => {
    const tagItem = tag.entities[tId] as TagCopy;
    tagItem.taskIds = tagItem.taskIds.filter((id) => taskIds.includes(id));
  });

  taskIdsToRestoreFromArchive.forEach((id) => {
    // Restore from whichever archive has it (archiveYoung takes priority)
    if (archiveYoung.task.entities[id]) {
      task.entities[id] = archiveYoung.task.entities[id];
      delete archiveYoung.task.entities[id];
    } else if (archiveOld.task.entities[id]) {
      task.entities[id] = archiveOld.task.entities[id];
      delete archiveOld.task.entities[id];
    }
  });
  task.ids = [...taskIds, ...taskIdsToRestoreFromArchive];
  archiveYoung.task.ids = taskArchiveYoungIds.filter(
    (id) => !taskIdsToRestoreFromArchive.includes(id),
  );
  archiveOld.task.ids = taskArchiveOldIds.filter(
    (id) => !taskIdsToRestoreFromArchive.includes(id),
  );

  if (taskIdsToRestoreFromArchive.length > 0) {
    OpLog.log(
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

const _addOrphanedTasksToProjectLists = (data: AppDataComplete): AppDataComplete => {
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
      return false; // Skip orphaned IDs (already handled by _fixEntityStates)
    }
    return (
      !taskItem.parentId && !allTaskIdsOnProjectLists.includes(tid) && taskItem.projectId
    );
  });

  orphanedTaskIds.forEach((tid) => {
    const taskItem = task.entities[tid];
    if (!taskItem) {
      return; // Skip orphaned IDs (already handled by _fixEntityStates)
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
    OpLog.log(orphanedTaskIds.length + ' orphaned tasks found & restored.');
  }

  return data;
};

const _addInboxProjectIdIfNecessary = (data: AppDataComplete): AppDataComplete => {
  const { task, archiveYoung, archiveOld } = data;
  const taskIds: string[] = task.ids;
  const taskArchiveYoungIds: string[] = archiveYoung.task.ids as string[];
  const taskArchiveOldIds: string[] = archiveOld.task.ids as string[];

  if (!data.project.entities[INBOX_PROJECT.id]) {
    data.project.entities[INBOX_PROJECT.id] = {
      ...INBOX_PROJECT,
    };

    data.project.ids = [INBOX_PROJECT.id, ...data.project.ids] as string[];
  }

  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (!t.projectId) {
      OpLog.log('Set inbox project id for task  ' + t.id);

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

  OpLog.log(taskArchiveYoungIds);
  OpLog.log(Object.keys(archiveYoung.task.entities));

  taskArchiveYoungIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (!t.projectId) {
      OpLog.log('Set inbox project for missing project id from archive task ' + t.id);
      t.projectId = INBOX_PROJECT.id;
    }
    // while we are at it, we also cleanup the today tag
    if (t.tagIds.includes(TODAY_TAG.id)) {
      t.tagIds = t.tagIds.filter((idI) => idI !== TODAY_TAG.id);
    }
  });

  OpLog.log(taskArchiveOldIds);
  OpLog.log(Object.keys(archiveOld.task.entities));

  taskArchiveOldIds.forEach((id) => {
    const t = archiveOld.task.entities[id] as TaskCopy;
    if (!t.projectId) {
      OpLog.log('Set inbox project for missing project id from old archive task ' + t.id);
      t.projectId = INBOX_PROJECT.id;
    }
    // while we are at it, we also cleanup the today tag
    if (t.tagIds.includes(TODAY_TAG.id)) {
      t.tagIds = t.tagIds.filter((idI) => idI !== TODAY_TAG.id);
    }
  });

  return data;
};

const _createInboxProjectIfNecessary = (data: AppDataComplete): AppDataComplete => {
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
  data: AppDataComplete,
): AppDataComplete => {
  const { task, project, archiveYoung, archiveOld } = data;
  const projectIds: string[] = project.ids as string[];
  const taskIds: string[] = task.ids;
  const taskArchiveYoungIds: string[] = archiveYoung.task.ids as string[];
  const taskArchiveOldIds: string[] = archiveOld.task.ids as string[];

  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (t.projectId && !projectIds.includes(t.projectId)) {
      OpLog.log('Delete missing project id from task ' + t.projectId);
      t.projectId = INBOX_PROJECT.id;
    }
  });

  OpLog.log(taskArchiveYoungIds);
  OpLog.log(Object.keys(archiveYoung.task.entities));

  taskArchiveYoungIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (t.projectId && !projectIds.includes(t.projectId)) {
      OpLog.log('Delete missing project id from archive task ' + t.projectId);
      t.projectId = INBOX_PROJECT.id;
    }
  });

  OpLog.log(taskArchiveOldIds);
  OpLog.log(Object.keys(archiveOld.task.entities));

  taskArchiveOldIds.forEach((id) => {
    const t = archiveOld.task.entities[id] as TaskCopy;
    if (t.projectId && !projectIds.includes(t.projectId)) {
      OpLog.log('Delete missing project id from old archive task ' + t.projectId);
      t.projectId = INBOX_PROJECT.id;
    }
  });

  return data;
};

const _removeNonExistentTagsFromTasks = (data: AppDataComplete): AppDataComplete => {
  const { task, tag, archiveYoung, archiveOld } = data;
  const tagIds: string[] = tag.ids as string[];
  const taskIds: string[] = task.ids;
  const taskArchiveYoungIds: string[] = archiveYoung.task.ids as string[];
  const taskArchiveOldIds: string[] = archiveOld.task.ids as string[];
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
          OpLog.log(
            `Removing non-existent tags from task ${t.id}: ${removedTags.join(', ')}`,
          );
          removedCount += removedTags.length;
        }
        t.tagIds = validTagIds;
      }
    }
  });

  // Fix tasks in archiveYoung
  taskArchiveYoungIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (t.tagIds && t.tagIds.length > 0) {
      const validTagIds = filterValidTags(t.tagIds);
      if (validTagIds.length !== t.tagIds.length) {
        const removedTags = t.tagIds.filter(
          (tagId) => !tagIds.includes(tagId) && tagId !== TODAY_TAG.id,
        );
        if (removedTags.length > 0) {
          OpLog.log(
            `Removing non-existent tags from archive task ${t.id}: ${removedTags.join(', ')}`,
          );
          removedCount += removedTags.length;
        }
        t.tagIds = validTagIds;
      }
    }
  });

  // Fix tasks in archiveOld
  taskArchiveOldIds.forEach((id) => {
    const t = archiveOld.task.entities[id] as TaskCopy;
    if (t.tagIds && t.tagIds.length > 0) {
      const validTagIds = filterValidTags(t.tagIds);
      if (validTagIds.length !== t.tagIds.length) {
        const removedTags = t.tagIds.filter(
          (tagId) => !tagIds.includes(tagId) && tagId !== TODAY_TAG.id,
        );
        if (removedTags.length > 0) {
          OpLog.log(
            `Removing non-existent tags from old archive task ${t.id}: ${removedTags.join(', ')}`,
          );
          removedCount += removedTags.length;
        }
        t.tagIds = validTagIds;
      }
    }
  });

  if (removedCount > 0) {
    OpLog.log(`Total non-existent tags removed from tasks: ${removedCount}`);
  }

  return data;
};

const _removeNonExistentProjectIdsFromIssueProviders = (
  data: AppDataComplete,
): AppDataComplete => {
  const { issueProvider, project } = data;
  if (!issueProvider?.ids || !project?.ids) return data;
  const projectIds: string[] = project.ids as string[];
  const issueProviderIds: string[] = issueProvider.ids;
  issueProviderIds.forEach((id) => {
    const t = issueProvider.entities[id] as IssueProvider;
    if (t.defaultProjectId && !projectIds.includes(t.defaultProjectId)) {
      OpLog.log('Delete missing project id from issueProvider ' + t.defaultProjectId);
      t.defaultProjectId = null;
    }
  });

  return data;
};

const _removeNonExistentProjectIdsFromTaskRepeatCfg = (
  data: AppDataComplete,
): AppDataComplete => {
  const { project, taskRepeatCfg } = data;
  if (!taskRepeatCfg?.ids || !project?.ids) return data;
  const projectIds: string[] = project.ids as string[];
  const taskRepeatCfgIds: string[] = taskRepeatCfg.ids as string[];
  taskRepeatCfgIds.forEach((id) => {
    const repeatCfg = taskRepeatCfg.entities[id] as TaskRepeatCfgCopy;
    if (repeatCfg.projectId && !projectIds.includes(repeatCfg.projectId)) {
      if (repeatCfg.tagIds.length) {
        OpLog.log(
          'Delete missing project id from task repeat cfg ' + repeatCfg.projectId,
        );
        repeatCfg.projectId = null;
      } else {
        taskRepeatCfg.ids = (taskRepeatCfg.ids as string[]).filter(
          (rid: string) => rid !== repeatCfg.id,
        );
        delete taskRepeatCfg.entities[repeatCfg.id];
        OpLog.log('Delete task repeat cfg with missing project id' + repeatCfg.projectId);
      }
    }
  });
  return data;
};

const _removeNonExistentRepeatCfgIdsFromTasks = (
  data: AppDataComplete,
): AppDataComplete => {
  const { task, taskRepeatCfg, archiveYoung, archiveOld } = data;
  if (!taskRepeatCfg?.ids) return data;
  const repeatCfgIds: string[] = taskRepeatCfg.ids as string[];
  const taskIds: string[] = task.ids;
  const taskArchiveYoungIds: string[] = archiveYoung.task.ids as string[];
  const taskArchiveOldIds: string[] = archiveOld.task.ids as string[];
  let removedCount = 0;

  // Fix tasks in main task state
  taskIds.forEach((id) => {
    const t = task.entities[id] as TaskCopy;
    if (t.repeatCfgId && !repeatCfgIds.includes(t.repeatCfgId)) {
      OpLog.log(`Clearing non-existent repeatCfgId from task ${t.id}: ${t.repeatCfgId}`);
      t.repeatCfgId = undefined;
      removedCount++;
    }
  });

  // Fix tasks in archiveYoung
  taskArchiveYoungIds.forEach((id) => {
    const t = archiveYoung.task.entities[id] as TaskCopy;
    if (t.repeatCfgId && !repeatCfgIds.includes(t.repeatCfgId)) {
      OpLog.log(
        `Clearing non-existent repeatCfgId from archive task ${t.id}: ${t.repeatCfgId}`,
      );
      t.repeatCfgId = undefined;
      removedCount++;
    }
  });

  // Fix tasks in archiveOld
  taskArchiveOldIds.forEach((id) => {
    const t = archiveOld.task.entities[id] as TaskCopy;
    if (t.repeatCfgId && !repeatCfgIds.includes(t.repeatCfgId)) {
      OpLog.log(
        `Clearing non-existent repeatCfgId from old archive task ${t.id}: ${t.repeatCfgId}`,
      );
      t.repeatCfgId = undefined;
      removedCount++;
    }
  });

  if (removedCount > 0) {
    OpLog.log(`Total non-existent repeatCfgIds cleared from tasks: ${removedCount}`);
  }

  return data;
};

const _cleanupNonExistingTasksFromLists = (data: AppDataComplete): AppDataComplete => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds.forEach((pid) => {
    const projectItem = data.project.entities[pid];
    if (!projectItem) {
      OpLog.log(data.project);
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
        OpLog.log(data.tag);
        throw new Error('No tag');
      }
      (tagItem as TagCopy).taskIds = tagItem.taskIds.filter(
        (tid) => !!data.task.entities[tid],
      );
    });
  return data;
};

const _cleanupNonExistingNotesFromLists = (data: AppDataComplete): AppDataComplete => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds.forEach((pid) => {
    const projectItem = data.project.entities[pid];
    if (!projectItem) {
      OpLog.log(data.project);
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

const _fixOrphanedNotes = (data: AppDataComplete): AppDataComplete => {
  const noteIds: string[] = data.note.ids as string[];
  noteIds.forEach((nId) => {
    const note = data.note.entities[nId];
    if (!note) {
      OpLog.log(data.note);
      throw new Error('No note');
    }
    // missing project case
    if (note.projectId) {
      if (data.project.entities[note.projectId]) {
        if (!data.project.entities[note.projectId]!.noteIds.includes(note.id)) {
          OpLog.log(
            'Add orphaned note back to project list ' + note.projectId + ' ' + note.id,
          );

          const project = data.project.entities[note.projectId]!;
          data.project.entities[note.projectId] = {
            ...project,
            noteIds: [...project.noteIds, note.id],
          };
        }
      } else {
        OpLog.log('Delete missing project id from note ' + note.id);
        note.projectId = null;

        if (!data.note.todayOrder.includes(note.id)) {
          data.note.todayOrder = [...data.note.todayOrder, note.id];
        }
      }
    } // orphaned note case
    else if (!data.note.todayOrder.includes(note.id)) {
      OpLog.log('Add orphaned note to today list ' + note.id);

      if (!data.note.todayOrder.includes(note.id)) {
        data.note.todayOrder = [...data.note.todayOrder, note.id];
      }
    }
  });

  return data;
};

const _fixInconsistentProjectId = (data: AppDataComplete): AppDataComplete => {
  const projectIds: string[] = data.project.ids as string[];
  projectIds
    .map((id) => data.project.entities[id])
    .forEach((projectItem) => {
      if (!projectItem) {
        OpLog.log(data.project);
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

const _fixInconsistentTagId = (data: AppDataComplete): AppDataComplete => {
  const tagIds: string[] = data.tag.ids as string[];
  tagIds
    .map((id) => data.tag.entities[id])
    .forEach((tagItem) => {
      if (!tagItem) {
        OpLog.log(data.tag);
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

const _setTaskProjectIdAccordingToParent = (data: AppDataComplete): AppDataComplete => {
  const taskIds: string[] = data.task.ids as string[];
  taskIds
    .map((id) => data.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.task);
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

  const archiveYoungTaskIds: string[] = data.archiveYoung.task.ids as string[];
  archiveYoungTaskIds
    .map((id) => data.archiveYoung.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.archiveYoung.task);
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

  const archiveOldTaskIds: string[] = data.archiveOld.task.ids as string[];
  archiveOldTaskIds
    .map((id) => data.archiveOld.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.archiveOld.task);
        throw new Error('No old archive task');
      }
      if (taskItem.subTaskIds) {
        const parentProjectId = taskItem.projectId;
        taskItem.subTaskIds.forEach((stid) => {
          const subTask = data.archiveOld.task.entities[stid];
          if (!subTask) {
            throw new Error('Old Archived Task data not found');
          }
          if (subTask.projectId !== parentProjectId) {
            (subTask as TaskCopy).projectId = parentProjectId;
          }
        });
      }
    });

  return data;
};

const _cleanupOrphanedSubTasks = (data: AppDataComplete): AppDataComplete => {
  const taskIds: string[] = data.task.ids as string[];

  taskIds
    .map((id) => data.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.task);
        throw new Error('No task');
      }

      if (taskItem.subTaskIds.length) {
        let i = taskItem.subTaskIds.length - 1;
        while (i >= 0) {
          const sid = taskItem.subTaskIds[i];
          if (!data.task.entities[sid]) {
            OpLog.log('Delete orphaned sub task for ', taskItem);
            taskItem.subTaskIds.splice(i, 1);
          }
          i -= 1;
        }
      }
    });

  const archiveYoungTaskIds: string[] = data.archiveYoung.task.ids as string[];
  archiveYoungTaskIds
    .map((id) => data.archiveYoung.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.archiveYoung.task);
        throw new Error('No archive task');
      }

      if (taskItem.subTaskIds.length) {
        let i = taskItem.subTaskIds.length - 1;
        while (i >= 0) {
          const sid = taskItem.subTaskIds[i];
          if (!data.archiveYoung.task.entities[sid]) {
            OpLog.log('Delete orphaned archive sub task for ', taskItem);
            taskItem.subTaskIds.splice(i, 1);
          }
          i -= 1;
        }
      }
    });

  const archiveOldTaskIds: string[] = data.archiveOld.task.ids as string[];
  archiveOldTaskIds
    .map((id) => data.archiveOld.task.entities[id])
    .forEach((taskItem) => {
      if (!taskItem) {
        OpLog.log(data.archiveOld.task);
        throw new Error('No old archive task');
      }

      if (taskItem.subTaskIds.length) {
        let i = taskItem.subTaskIds.length - 1;
        while (i >= 0) {
          const sid = taskItem.subTaskIds[i];
          if (!data.archiveOld.task.entities[sid]) {
            OpLog.log('Delete orphaned old archive sub task for ', taskItem);
            taskItem.subTaskIds.splice(i, 1);
          }
          i -= 1;
        }
      }
    });

  return data;
};

const _repairMenuTree = (data: AppDataComplete): AppDataComplete => {
  if (!data.menuTree) {
    return data;
  }

  const validProjectIds = new Set<string>(data.project.ids as string[]);
  const validTagIds = new Set<string>(data.tag.ids as string[]);

  data.menuTree = repairMenuTree(data.menuTree, validProjectIds, validTagIds);

  return data;
};
