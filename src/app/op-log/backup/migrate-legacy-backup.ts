/**
 * Migrates legacy (v10-era) backup data to v17's AppDataComplete format.
 *
 * v17 dropped the cross-model migrations (2 through 4.5) that v14-v16 used to
 * transform legacy data. When a user imports a pre-v14 backup, the data still
 * has the old shape: flat `taskArchive`, `improvement`/`obstruction`/`bookmark`
 * keys, no `archiveYoung`/`archiveOld`, no `timeTracking`, etc.
 *
 * This module consolidates the essential transformations from v16's
 * cross-model-2 through cross-model-4.5 into a single migration pass that runs
 * before Typia validation in BackupService.importCompleteBackup().
 */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
import {
  HideSubTasksMode,
  TaskArchive,
  TaskCopy,
  TimeSpentOnDayCopy,
} from '../../features/tasks/task.model';
import { Dictionary } from '@ngrx/entity';
import {
  initialBoardsState,
  BoardsState,
} from '../../features/boards/store/boards.reducer';
import { DEFAULT_BOARD_CFG, DEFAULT_PANEL_CFG } from '../../features/boards/boards.const';
import { plannerInitialState } from '../../features/planner/store/planner.reducer';
import { issueProviderInitialState } from '../../features/issue/store/issue-provider.reducer';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { TTWorkContextSessionMap } from '../../features/time-tracking/time-tracking.model';
import { TODAY_TAG } from '../../features/tag/tag.const';
import {
  INBOX_PROJECT,
  LEGACY_NO_LIST_TAG_ID,
} from '../../features/project/project.const';
import { getDbDateStr } from '../../util/get-db-date-str';
import { isToday } from '../../util/is-today.util';
import { LanguageCode } from '../../core/locale.constants';
import {
  initialPluginUserDataState,
  initialPluginMetaDataState,
} from '../../plugins/plugin-persistence.model';
import { AppDataComplete } from '../model/model-config';
import { OpLog } from '../../core/log';

const LEGACY_INBOX_PROJECT_ID = 'INBOX' as const;

/**
 * Detects whether the incoming data is a legacy (pre-v14) backup that needs
 * migration before it can pass Typia validation.
 *
 * A backup is considered legacy if it has the flat `taskArchive` key (the
 * definitive marker of a v10-v13 era backup). We also detect backups that have
 * `improvement` or `obstruction` keys (removed in v17) as a secondary signal.
 *
 * Note: Modern backups that simply lack `archiveYoung` are handled by
 * `dataRepair()` which creates empty archives — no migration needed for those.
 */
export const isLegacyBackupData = (data: Record<string, unknown>): boolean => {
  // Primary marker: flat taskArchive (pre-v14 format)
  if ('taskArchive' in data) {
    return true;
  }
  // Secondary markers: keys that were removed in v17
  if ('improvement' in data || 'obstruction' in data) {
    return true;
  }
  return false;
};

/**
 * Migrates a legacy backup to v17's AppDataComplete shape.
 *
 * Consolidates cross-model migrations 2, 3, 4, 4.1, 4.2, 4.3, 4.4, 4.5 from
 * v16 into a single pass. Each step is idempotent — if the data already has the
 * new shape for a given step, that step is a no-op.
 */
export const migrateLegacyBackup = (
  legacyData: Record<string, unknown>,
): AppDataComplete => {
  OpLog.log('migrateLegacyBackup: Starting legacy backup migration');

  let data = { ...legacyData } as Record<string, any>;

  // === Migration 2: Archive split + time tracking extraction ===
  data = _migration2ArchiveSplitAndTimeTracking(data);

  // === Migration 3: Planner, INBOX project, legacy tag cleanup ===
  data = _migration3PlannerAndInbox(data);

  // === Migration 4: plannedAt → dueWithTime, remove TODAY_TAG from tagIds ===
  data = _migration4TaskDateTimeFields(data);

  // === Migration 4.1: Remove TODAY_TAG from task repeat configs ===
  data = _migration41RepeatCfgTodayTag(data);

  // === Migration 4.2: Ensure both lastTaskCreation and lastTaskCreationDay ===
  data = _migration42RepeatCfgDualDatetime(data);

  // === Migration 4.3: Ensure menuTree exists ===
  data = _migration43MenuTree(data);

  // === Migration 4.4: Localization + appFeatures ===
  data = _migration44LocalizationAndAppFeatures(data);

  // === Migration 4.5: Lowercase language codes ===
  data = _migration45LowercaseLanguageCodes(data);

  // === Final: Ensure all v17-required keys exist with defaults ===
  data = _ensureV17Defaults(data);

  // === Final: Strip legacy keys that are not in v17's schema ===
  data = _stripLegacyKeys(data);

  OpLog.log('migrateLegacyBackup: Migration complete');
  return data as unknown as AppDataComplete;
};

// ---------------------------------------------------------------------------
// Migration 2 — archive split + time tracking extraction
// ---------------------------------------------------------------------------

function _migration2ArchiveSplitAndTimeTracking(
  data: Record<string, any>,
): Record<string, any> {
  // Skip if already migrated (archiveYoung with tasks means migration 2 already ran)
  if (data.archiveYoung?.task?.ids?.length > 0 && data.archiveOld && data.timeTracking) {
    return data;
  }
  // Also skip if archives exist with timeTracking data (migration ran, but no archived tasks)
  if (data.archiveYoung && data.archiveOld && data.timeTracking && !data.taskArchive) {
    return data;
  }
  OpLog.log('migrateLegacyBackup: Running migration 2 (archive split + time tracking)');

  // Extract project time tracking data
  const projectTimeTracking: TTWorkContextSessionMap = {};
  if (data.project?.entities) {
    for (const projectId of Object.keys(data.project.entities)) {
      const project = data.project.entities[projectId] as any;
      if (!project) continue;
      projectTimeTracking[projectId] = {};

      for (const date of Object.keys(project.workStart || {})) {
        projectTimeTracking[projectId][date] = {
          ...projectTimeTracking[projectId][date],
          s: project.workStart![date],
        };
      }
      for (const date of Object.keys(project.workEnd || {})) {
        projectTimeTracking[projectId][date] = {
          ...projectTimeTracking[projectId][date],
          e: project.workEnd![date],
        };
      }
      for (const date of Object.keys(project.breakNr || {})) {
        projectTimeTracking[projectId][date] = {
          ...projectTimeTracking[projectId][date],
          b: project.breakNr![date],
        };
      }
      for (const date of Object.keys(project.breakTime || {})) {
        projectTimeTracking[projectId][date] = {
          ...projectTimeTracking[projectId][date],
          bt: project.breakTime![date],
        };
      }

      delete (data.project.entities[projectId] as any).workStart;
      delete (data.project.entities[projectId] as any).workEnd;
      delete (data.project.entities[projectId] as any).breakTime;
      delete (data.project.entities[projectId] as any).breakNr;
    }
  }

  // Extract tag time tracking data
  const tagTimeTracking: TTWorkContextSessionMap = {};
  if (data.tag?.entities) {
    for (const tagId of Object.keys(data.tag.entities)) {
      const tag = data.tag.entities[tagId] as any;
      if (!tag) continue;
      tagTimeTracking[tagId] = {};

      for (const date of Object.keys(tag.workStart || {})) {
        tagTimeTracking[tagId][date] = {
          ...tagTimeTracking[tagId][date],
          s: tag.workStart![date],
        };
      }
      for (const date of Object.keys(tag.workEnd || {})) {
        tagTimeTracking[tagId][date] = {
          ...tagTimeTracking[tagId][date],
          e: tag.workEnd![date],
        };
      }
      for (const date of Object.keys(tag.breakNr || {})) {
        tagTimeTracking[tagId][date] = {
          ...tagTimeTracking[tagId][date],
          b: tag.breakNr![date],
        };
      }
      for (const date of Object.keys(tag.breakTime || {})) {
        tagTimeTracking[tagId][date] = {
          ...tagTimeTracking[tagId][date],
          bt: tag.breakTime![date],
        };
      }

      delete (data.tag.entities[tagId] as any).workStart;
      delete (data.tag.entities[tagId] as any).workEnd;
      delete (data.tag.entities[tagId] as any).breakTime;
      delete (data.tag.entities[tagId] as any).breakNr;
    }
  }

  // Convert flat taskArchive → archiveYoung/archiveOld
  const taskArchive = data.taskArchive as TaskArchive | undefined;

  if (taskArchive) {
    _migrateTaskDictionary(taskArchive.entities);
  }

  // Migrate task entities
  if (data.task) {
    _migrateTaskDictionary(data.task.entities);
  }

  data.timeTracking = {
    project: projectTimeTracking,
    tag: tagTimeTracking,
  };

  data.archiveYoung = {
    task: taskArchive || { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  data.archiveOld = {
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  data.boards = _migrateBoards(data.boards);

  return data;
}

function _migrateBoards(boardsState: BoardsState | undefined): BoardsState {
  if (!boardsState?.boardCfgs) {
    return initialBoardsState;
  }

  return {
    ...boardsState,
    boardCfgs: boardsState.boardCfgs.map((boardCfg) => ({
      ...DEFAULT_BOARD_CFG,
      ...boardCfg,
      panels: boardCfg.panels.map((panel) => ({
        ...DEFAULT_PANEL_CFG,
        ...panel,
      })),
    })),
  };
}

function _migrateTaskDictionary(taskDict: Dictionary<TaskCopy>): void {
  if (!taskDict) return;
  for (const taskId of Object.keys(taskDict)) {
    const task = taskDict[taskId];
    if (!task) continue;

    if (task.timeEstimate === null || task.timeEstimate === undefined) {
      taskDict[taskId] = { ...task, timeEstimate: 0 };
    }
    if (typeof (task.issueId as unknown) === 'number') {
      taskDict[taskId] = {
        ...taskDict[taskId]!,
        issueId: (task.issueId as unknown as number).toString(),
      };
    }
    if (task.created === null || task.created === undefined) {
      taskDict[taskId] = { ...taskDict[taskId]!, created: 0 };
    }
    if (task.repeatCfgId === null) {
      taskDict[taskId] = { ...taskDict[taskId]!, repeatCfgId: undefined };
    }
    if (task.notes === '') {
      delete taskDict[taskId]!.notes;
    }

    // Convert _showSubTasksMode → _hideSubTasksMode
    if (!taskDict[taskId]!._hideSubTasksMode) {
      const oldValue = (taskDict[taskId] as any)?._showSubTasksMode as number | undefined;
      let newValue: HideSubTasksMode | undefined;
      if (oldValue === 1) {
        newValue = 1;
      } else if (oldValue === 0) {
        newValue = 2;
      }
      if ('_showSubTasksMode' in (taskDict[taskId] as any)) {
        delete (taskDict[taskId] as any)._showSubTasksMode;
      }
      if (newValue) {
        taskDict[taskId] = {
          ...taskDict[taskId]!,
          _hideSubTasksMode: newValue as HideSubTasksMode,
        };
      }
    }

    // Remove null/undefined from timeSpentOnDay
    if (taskDict[taskId]!.timeSpentOnDay) {
      const cleanTimeSpent: TimeSpentOnDayCopy = {};
      let hasInvalidValues = false;
      for (const [date, timeSpent] of Object.entries(taskDict[taskId]!.timeSpentOnDay)) {
        if (timeSpent !== null && timeSpent !== undefined) {
          cleanTimeSpent[date] = timeSpent;
        } else {
          hasInvalidValues = true;
        }
      }
      if (hasInvalidValues) {
        taskDict[taskId] = { ...taskDict[taskId]!, timeSpentOnDay: cleanTimeSpent };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Migration 3 — planner, INBOX project, legacy tag cleanup
// ---------------------------------------------------------------------------

function _migration3PlannerAndInbox(data: Record<string, any>): Record<string, any> {
  OpLog.log('migrateLegacyBackup: Running migration 3 (planner + inbox)');

  // Migrate planner days → task.dueDay
  if (data.planner?.days) {
    for (const day of Object.keys(data.planner.days)) {
      const dayTasks = data.planner.days[day];
      if (Array.isArray(dayTasks)) {
        for (const taskId of dayTasks) {
          const task = data.task?.entities?.[taskId];
          if (task) {
            task.dueDay = day;
          }
        }
      }
    }
  } else {
    data.planner = plannerInitialState;
  }

  // Fix TODAY_TAG tasks
  const todayTag = data.tag?.entities?.[TODAY_TAG.id];
  if (todayTag?.taskIds) {
    const idsToRemove: string[] = [];
    for (const taskId of todayTag.taskIds) {
      const task = data.task?.entities?.[taskId];
      if (task && !task.dueDay) {
        if (task.dueWithTime) {
          if (!isToday(task.dueWithTime)) {
            idsToRemove.push(taskId);
          }
        } else {
          task.dueDay = getDbDateStr();
        }
      }
    }
    if (idsToRemove.length > 0) {
      todayTag.taskIds = todayTag.taskIds.filter(
        (id: string) => !idsToRemove.includes(id),
      );
    }
  }

  // Migrate legacy INBOX project
  const isMigrateLegacyInboxProject =
    !!data.project?.entities?.[LEGACY_INBOX_PROJECT_ID] &&
    !data.project?.entities?.[INBOX_PROJECT.id] &&
    data.project.entities[LEGACY_INBOX_PROJECT_ID]?.title?.includes('box');

  if (isMigrateLegacyInboxProject) {
    data.project.entities[INBOX_PROJECT.id] = {
      ...INBOX_PROJECT,
      ...data.project.entities[LEGACY_INBOX_PROJECT_ID],
      id: INBOX_PROJECT.id,
      taskIds: [],
      backlogTaskIds: [],
    };
    data.project.ids = [
      INBOX_PROJECT.id,
      ...data.project.ids.filter((id: string) => id !== LEGACY_INBOX_PROJECT_ID),
    ];
    delete data.project.entities[LEGACY_INBOX_PROJECT_ID];

    // Migrate notes
    if (data.note?.entities) {
      for (const note of Object.values(data.note.entities) as any[]) {
        if (note?.projectId === LEGACY_INBOX_PROJECT_ID) {
          note.projectId = INBOX_PROJECT.id;
          const inboxProject = data.project.entities[INBOX_PROJECT.id];
          if (inboxProject) {
            inboxProject.noteIds = [...(inboxProject.noteIds || []), note.id];
          }
        }
      }
    }

    if (data.globalConfig?.misc) {
      data.globalConfig.misc.defaultProjectId = null;
    }
  }

  // Ensure INBOX project exists
  if (!data.project?.entities?.[INBOX_PROJECT.id]) {
    data.project.entities[INBOX_PROJECT.id] = { ...INBOX_PROJECT };
    data.project.ids = [INBOX_PROJECT.id, ...data.project.ids];
  }

  // Remove legacy NO_LIST tag
  if (data.tag?.entities?.[LEGACY_NO_LIST_TAG_ID]) {
    data.tag.ids = data.tag.ids.filter((id: string) => id !== LEGACY_NO_LIST_TAG_ID);
    delete data.tag.entities[LEGACY_NO_LIST_TAG_ID];
  }

  // Migrate tasks in all locations
  _migrateTasksForMigration3(data.task, data.project, false, isMigrateLegacyInboxProject);
  if (data.archiveYoung?.task) {
    _migrateTasksForMigration3(
      data.archiveYoung.task,
      data.project,
      true,
      isMigrateLegacyInboxProject,
    );
  }
  if (data.archiveOld?.task) {
    _migrateTasksForMigration3(
      data.archiveOld.task,
      data.project,
      true,
      isMigrateLegacyInboxProject,
    );
  }

  // Merge global config with defaults
  data.globalConfig = { ...DEFAULT_GLOBAL_CONFIG, ...data.globalConfig };

  // Ensure issueProvider exists
  if (!data.issueProvider) {
    data.issueProvider = issueProviderInitialState;
  }

  // Cleanup task repeat config legacy references
  if (data.taskRepeatCfg?.entities) {
    const availableTagIds = data.tag?.entities ? Object.keys(data.tag.entities) : [];
    for (const id of Object.keys(data.taskRepeatCfg.entities)) {
      const cfg = data.taskRepeatCfg.entities[id];
      if (cfg?.tagIds?.length > 0) {
        cfg.tagIds = cfg.tagIds.filter((tagId: string) =>
          availableTagIds.includes(tagId),
        );
      }
      if (cfg?.projectId === LEGACY_INBOX_PROJECT_ID) {
        cfg.projectId = INBOX_PROJECT.id;
      }
    }
  }

  return data;
}

function _migrateTasksForMigration3(
  taskState: any,
  projectState: any,
  isArchive: boolean,
  isMigrateLegacyInboxProject: boolean,
): void {
  if (!taskState?.entities) return;

  const inboxProject = projectState?.entities?.[INBOX_PROJECT.id];
  if (!inboxProject) return;

  for (const id of Object.keys(taskState.entities)) {
    const task = taskState.entities[id];
    if (!task) continue;

    // Remove legacy NO_LIST tag
    if (task.tagIds?.includes(LEGACY_NO_LIST_TAG_ID)) {
      task.tagIds = task.tagIds.filter((v: string) => v !== LEGACY_NO_LIST_TAG_ID);
    }

    // Add INBOX project to tasks without projectId
    if (!task.projectId) {
      task.projectId = INBOX_PROJECT.id;
      if (!isArchive && !task.parentId) {
        inboxProject.taskIds = [...(inboxProject.taskIds || []), task.id];
      }
    }

    // Migrate legacy INBOX project reference
    if (isMigrateLegacyInboxProject && task.projectId === LEGACY_INBOX_PROJECT_ID) {
      task.projectId = INBOX_PROJECT.id;
      if (!isArchive && !task.parentId) {
        inboxProject.taskIds = [...(inboxProject.taskIds || []), task.id];
      }
    }

    // Normalize falsy values
    task.issueId = task.issueId || undefined;
    task.issueProviderId = task.issueProviderId || undefined;
    task.issueType =
      (task.issueType as any) === 'CALENDAR' ? 'ICAL' : task.issueType || undefined;
    task.issueWasUpdated = task.issueWasUpdated || undefined;
    task.issueLastUpdated = task.issueLastUpdated || undefined;
    task.issueAttachmentNr = task.issueAttachmentNr ?? undefined;
    task.issueTimeTracked = task.issueTimeTracked || undefined;
    task.issuePoints = task.issuePoints ?? undefined;
    task.reminderId = task.reminderId || undefined;
    task.parentId = task.parentId || undefined;
    task.doneOn = task.doneOn || undefined;
    task.timeEstimate = task.timeEstimate || 0;
    task.timeSpent = task.timeSpent || 0;
  }
}

// ---------------------------------------------------------------------------
// Migration 4 — plannedAt → dueWithTime, remove TODAY_TAG from tagIds
// ---------------------------------------------------------------------------

function _migration4TaskDateTimeFields(data: Record<string, any>): Record<string, any> {
  OpLog.log('migrateLegacyBackup: Running migration 4 (task datetime fields)');

  if (data.improvement && !Array.isArray(data.improvement.hiddenImprovementBannerItems)) {
    data.improvement.hiddenImprovementBannerItems = [];
  }

  _migrateTasksForMigration4(data.task);
  if (data.archiveYoung?.task) {
    _migrateTasksForMigration4(data.archiveYoung.task);
  }
  if (data.archiveOld?.task) {
    _migrateTasksForMigration4(data.archiveOld.task);
  }

  return data;
}

function _migrateTasksForMigration4(taskState: any): void {
  if (!taskState?.entities) return;

  for (const id of Object.keys(taskState.entities)) {
    const task = taskState.entities[id];
    if (!task) continue;

    if (typeof task.plannedAt === 'number') {
      task.dueWithTime = task.plannedAt;
      delete task.plannedAt;
    }
    if (task.tagIds?.includes(TODAY_TAG.id)) {
      task.tagIds = task.tagIds.filter((v: string) => v !== TODAY_TAG.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Migration 4.1 — remove TODAY_TAG from task repeat configs
// ---------------------------------------------------------------------------

function _migration41RepeatCfgTodayTag(data: Record<string, any>): Record<string, any> {
  if (!data.taskRepeatCfg?.entities) return data;

  for (const id of Object.keys(data.taskRepeatCfg.entities)) {
    const cfg = data.taskRepeatCfg.entities[id];
    if (cfg?.tagIds?.includes(TODAY_TAG.id)) {
      cfg.tagIds = cfg.tagIds.filter((v: string) => v !== TODAY_TAG.id);
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Migration 4.2 — ensure both lastTaskCreation and lastTaskCreationDay
// ---------------------------------------------------------------------------

function _migration42RepeatCfgDualDatetime(
  data: Record<string, any>,
): Record<string, any> {
  if (!data.taskRepeatCfg?.entities) return data;

  for (const id of Object.keys(data.taskRepeatCfg.entities)) {
    const cfg = data.taskRepeatCfg.entities[id];
    if (!cfg) continue;

    if ('lastTaskCreation' in cfg && !('lastTaskCreationDay' in cfg)) {
      const timestamp = cfg.lastTaskCreation;
      if (timestamp != null && !isNaN(timestamp)) {
        cfg.lastTaskCreationDay = getDbDateStr(timestamp);
      }
    }

    if ('lastTaskCreationDay' in cfg && !('lastTaskCreation' in cfg)) {
      const dateStr = cfg.lastTaskCreationDay;
      if (dateStr && typeof dateStr === 'string') {
        const date = new Date(dateStr + 'T12:00:00Z');
        if (!isNaN(date.getTime())) {
          cfg.lastTaskCreation = date.getTime();
        }
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Migration 4.3 — ensure menuTree exists
// ---------------------------------------------------------------------------

function _migration43MenuTree(data: Record<string, any>): Record<string, any> {
  if (!data.menuTree || typeof data.menuTree !== 'object') {
    data.menuTree = menuTreeInitialState;
  } else {
    if (!Array.isArray(data.menuTree.projectTree)) {
      data.menuTree.projectTree = [];
    }
    if (!Array.isArray(data.menuTree.tagTree)) {
      data.menuTree.tagTree = [];
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Migration 4.4 — localization + appFeatures
// ---------------------------------------------------------------------------

function _migration44LocalizationAndAppFeatures(
  data: Record<string, any>,
): Record<string, any> {
  if (!data.globalConfig) return data;

  const finishOps: (() => void)[] = [];

  // 1. Rename lang → localization
  const oldLangSection = data.globalConfig['lang'];
  if (oldLangSection && typeof oldLangSection === 'object') {
    data.globalConfig.localization = {
      ...data.globalConfig.localization,
      ...oldLangSection,
    };
    finishOps.push(() => delete data.globalConfig['lang']);
  }

  // 2. Move misc.timeLocale → localization.dateTimeLocale
  const oldTimeLocale = data.globalConfig?.misc?.['timeLocale'];
  if (oldTimeLocale) {
    data.globalConfig.localization = {
      ...data.globalConfig.localization,
      dateTimeLocale: oldTimeLocale,
    };
    finishOps.push(() => {
      if (data.globalConfig?.misc) {
        delete data.globalConfig.misc['timeLocale'];
      }
    });
  }

  // 3. Rename zh_tw language
  if (
    oldLangSection &&
    typeof oldLangSection === 'object' &&
    oldLangSection?.lng === 'zh_tw'
  ) {
    data.globalConfig.localization = {
      ...data.globalConfig.localization,
      lng: LanguageCode.zh_tw,
    };
  }

  // 4. Initialize App Features
  if (!data.globalConfig.appFeatures) {
    data.globalConfig.appFeatures = DEFAULT_GLOBAL_CONFIG.appFeatures;
  } else {
    data.globalConfig.appFeatures = {
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      ...data.globalConfig.appFeatures,
    };
  }

  // 5. Migrate User Profiles
  if (typeof data.globalConfig?.misc?.isEnableUserProfiles === 'boolean') {
    if (data.globalConfig.appFeatures) {
      data.globalConfig.appFeatures = {
        ...data.globalConfig.appFeatures,
        isEnableUserProfiles: data.globalConfig.misc.isEnableUserProfiles,
      };
    }
    delete data.globalConfig.misc.isEnableUserProfiles;
  }

  finishOps.forEach((op) => op());
  return data;
}

// ---------------------------------------------------------------------------
// Migration 4.5 — lowercase language codes
// ---------------------------------------------------------------------------

function _migration45LowercaseLanguageCodes(
  data: Record<string, any>,
): Record<string, any> {
  const oldLang = data.globalConfig?.localization?.lng;
  if (oldLang && typeof oldLang === 'string') {
    data.globalConfig.localization = {
      ...data.globalConfig.localization,
      lng: oldLang.toLocaleLowerCase(),
    };
  }

  const oldDateTimeLocale = data.globalConfig?.localization?.dateTimeLocale;
  if (oldDateTimeLocale && typeof oldDateTimeLocale === 'string') {
    data.globalConfig.localization = {
      ...data.globalConfig.localization,
      dateTimeLocale: oldDateTimeLocale.toLocaleLowerCase(),
    };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Final: ensure all v17-required keys exist with defaults
// ---------------------------------------------------------------------------

function _ensureV17Defaults(data: Record<string, any>): Record<string, any> {
  if (!data.issueProvider) {
    data.issueProvider = issueProviderInitialState;
  }
  if (!data.boards) {
    data.boards = initialBoardsState;
  }
  if (!data.planner) {
    data.planner = plannerInitialState;
  }
  if (!data.menuTree) {
    data.menuTree = menuTreeInitialState;
  }
  if (!data.timeTracking) {
    data.timeTracking = initialTimeTrackingState;
  }
  if (!data.pluginUserData) {
    data.pluginUserData = initialPluginUserDataState;
  }
  if (!data.pluginMetadata) {
    data.pluginMetadata = initialPluginMetaDataState;
  }
  if (!data.reminders) {
    data.reminders = [];
  }
  if (!data.archiveYoung) {
    data.archiveYoung = {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    };
  }
  if (!data.archiveOld) {
    data.archiveOld = {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Final: strip keys that are not part of v17's AppDataComplete
// ---------------------------------------------------------------------------

const V17_VALID_KEYS = new Set([
  'project',
  'menuTree',
  'globalConfig',
  'planner',
  'boards',
  'note',
  'issueProvider',
  'metric',
  'task',
  'tag',
  'simpleCounter',
  'taskRepeatCfg',
  'reminders',
  'timeTracking',
  'pluginUserData',
  'pluginMetadata',
  'archiveYoung',
  'archiveOld',
]);

function _stripLegacyKeys(data: Record<string, any>): Record<string, any> {
  const stripped: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (V17_VALID_KEYS.has(key)) {
      stripped[key] = data[key];
    } else {
      OpLog.log(`migrateLegacyBackup: Stripping legacy key "${key}"`);
    }
  }
  return stripped;
}
