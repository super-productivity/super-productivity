import { AllModelData, ModelCfg, ModelCfgs } from '../core/types/sync.types';
import { DataRepairNotPossibleError } from '../core/errors/sync-errors';
import { Dropbox } from '../sync-providers/file-based/dropbox/dropbox';
import { ProjectState } from '../../features/project/project.model';
import { MenuTreeState } from '../../features/menu-tree/store/menu-tree.model';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { Reminder } from '../../features/reminder/reminder.model';
import {
  plannerInitialState,
  PlannerState,
} from '../../features/planner/store/planner.reducer';
import {
  BoardsState,
  initialBoardsState,
} from '../../features/boards/store/boards.reducer';
import { NoteState } from '../../features/note/note.model';
import { IssueProviderState } from '../../features/issue/issue.model';
import { MetricState } from '../../features/metric/metric.model';
import { TaskState } from '../../features/tasks/task.model';
import { TagState } from '../../features/tag/tag.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { TaskRepeatCfgState } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { initialProjectState } from '../../features/project/store/project.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { initialNoteState } from '../../features/note/store/note.reducer';
import { issueProviderInitialState } from '../../features/issue/store/issue-provider.reducer';
import { initialMetricState } from '../../features/metric/store/metric.reducer';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { initialTagState } from '../../features/tag/store/tag.reducer';
import { initialSimpleCounterState } from '../../features/simple-counter/store/simple-counter.reducer';
import { initialTaskRepeatCfgState } from '../../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { DROPBOX_APP_KEY } from '../../imex/sync/dropbox/dropbox.const';
import { Webdav } from '../sync-providers/file-based/webdav/webdav';
import { SuperSyncProvider } from '../sync-providers/super-sync/super-sync';
import { isDataRepairPossible } from '../validation/is-data-repair-possible.util';
import { dataRepair } from '../validation/data-repair';
import { LocalFileSyncElectron } from '../sync-providers/file-based/local-file/local-file-sync-electron';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { LocalFileSyncAndroid } from '../sync-providers/file-based/local-file/local-file-sync-android';
import { environment } from '../../../environments/environment';
import {
  ArchiveModel,
  TimeTrackingState,
} from '../../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { appDataValidators, validateFull } from '../validation/validation-fn';
import { fixEntityStateConsistency } from '../../util/check-fix-entity-state-consistency';
import { IValidation } from 'typia';
import { OpLog } from '../../core/log';
import { alertDialog } from '../../util/native-dialogs';
import {
  initialPluginMetaDataState,
  initialPluginUserDataState,
  PluginMetaDataState,
  PluginUserDataState,
} from '../../plugins/plugin-persistence.model';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';

export const CROSS_MODEL_VERSION = 4.5 as const;

export type AllModelConfig = {
  project: ModelCfg<ProjectState>;
  menuTree: ModelCfg<MenuTreeState>;
  globalConfig: ModelCfg<GlobalConfigState>;
  planner: ModelCfg<PlannerState>;
  boards: ModelCfg<BoardsState>;
  note: ModelCfg<NoteState>;
  issueProvider: ModelCfg<IssueProviderState>;
  metric: ModelCfg<MetricState>;
  task: ModelCfg<TaskState>;
  tag: ModelCfg<TagState>;
  simpleCounter: ModelCfg<SimpleCounterState>;
  taskRepeatCfg: ModelCfg<TaskRepeatCfgState>;
  reminders: ModelCfg<Reminder[]>;
  timeTracking: ModelCfg<TimeTrackingState>;
  pluginUserData: ModelCfg<PluginUserDataState | undefined>;
  pluginMetadata: ModelCfg<PluginMetaDataState | undefined>;
  archiveYoung: ModelCfg<ArchiveModel>;
  archiveOld: ModelCfg<ArchiveModel>;
};

export type AppDataComplete = AllModelData<AllModelConfig>;

export const MODEL_CONFIGS: AllModelConfig = {
  task: {
    defaultData: initialTaskState,
    isMainFileModel: true,
    validate: appDataValidators.task,
    repair: fixEntityStateConsistency,
  },
  timeTracking: {
    defaultData: initialTimeTrackingState,
    isMainFileModel: true,
    validate: appDataValidators.timeTracking,
  },
  project: {
    defaultData: initialProjectState,
    isMainFileModel: true,
    validate: appDataValidators.project,
    repair: fixEntityStateConsistency,
  },
  tag: {
    defaultData: initialTagState,
    isMainFileModel: true,
    validate: appDataValidators.tag,
    repair: fixEntityStateConsistency,
  },
  simpleCounter: {
    defaultData: initialSimpleCounterState,
    isMainFileModel: true,
    validate: appDataValidators.simpleCounter,
    repair: fixEntityStateConsistency,
  },
  note: {
    defaultData: initialNoteState,
    isMainFileModel: true,
    validate: appDataValidators.note,
    repair: fixEntityStateConsistency,
  },
  taskRepeatCfg: {
    defaultData: initialTaskRepeatCfgState,
    isMainFileModel: true,
    validate: appDataValidators.taskRepeatCfg,
    repair: fixEntityStateConsistency,
  },
  reminders: {
    defaultData: [],
    isMainFileModel: true,
    validate: appDataValidators.reminders,
  },
  planner: {
    defaultData: plannerInitialState,
    isMainFileModel: true,
    validate: appDataValidators.planner,
  },
  boards: {
    defaultData: initialBoardsState,
    isMainFileModel: true,
    validate: appDataValidators.boards,
  },
  menuTree: {
    defaultData: menuTreeInitialState,
    validate: appDataValidators.menuTree,
  },
  pluginUserData: {
    defaultData: initialPluginUserDataState,
    validate: appDataValidators.pluginUserData,
  },
  pluginMetadata: {
    defaultData: initialPluginMetaDataState,
    validate: appDataValidators.pluginMetadata,
  },
  globalConfig: {
    defaultData: DEFAULT_GLOBAL_CONFIG,
    validate: appDataValidators.globalConfig,
  },
  issueProvider: {
    defaultData: issueProviderInitialState,
    validate: appDataValidators.issueProvider,
    repair: fixEntityStateConsistency,
  },
  metric: {
    defaultData: initialMetricState,
    validate: appDataValidators.metric,
    repair: fixEntityStateConsistency,
  },
  archiveYoung: {
    defaultData: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    validate: appDataValidators.archiveYoung,
    repair: (d) => ({
      ...d,
      task: fixEntityStateConsistency(d.task),
    }),
    cacheOnLoad: true,
  },
  archiveOld: {
    defaultData: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    validate: appDataValidators.archiveOld,
    repair: (d) => ({
      ...d,
      task: fixEntityStateConsistency(d.task),
    }),
  },
} as const;

/**
 * Creates a default/empty main model data object using the defaultData from MODEL_CONFIGS.
 * This is used for USE_REMOTE sync resolution to reset local state before applying remote ops.
 *
 * Only includes models that have isMainFileModel: true, as these are the ones
 * stored in the main sync file and need to be reset.
 */
export const getDefaultMainModelData = (): Partial<AppDataComplete> => {
  const result: Partial<AppDataComplete> = {};
  for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
    if (config.isMainFileModel) {
      (result as Record<string, unknown>)[key] = config.defaultData;
    }
  }
  return result;
};

export const fileSyncElectron = new LocalFileSyncElectron();
export const fileSyncDroid = new LocalFileSyncAndroid();

export const SYNC_PROVIDERS = [
  new Dropbox({
    appKey: DROPBOX_APP_KEY,
    basePath: environment.production ? `/` : `/DEV/`,
  }),
  new Webdav(environment.production ? undefined : `/DEV`),
  new SuperSyncProvider(environment.production ? undefined : `/DEV`),
  ...(IS_ELECTRON ? [fileSyncElectron] : []),
  ...(IS_ANDROID_WEB_VIEW ? [fileSyncDroid] : []),
];

export interface BaseSyncConfig<T extends ModelCfgs> {
  crossModelVersion?: number;
  crossModelMigrations?: Record<number, (data: unknown) => unknown>;
  validate?: (data: AllModelData<T>) => IValidation<AllModelData<T>>;
  repair?: (data: unknown, errors: IValidation.IError[]) => AllModelData<T>;
  onDbError?: (err: unknown) => void;
}

export const SYNC_CONFIG: BaseSyncConfig<AllModelConfig> = {
  crossModelVersion: CROSS_MODEL_VERSION,
  validate: (data) => {
    const result = validateFull(data);

    if (!environment.production && !result.isValid) {
      OpLog.log(result);
      alertDialog('VALIDATION ERROR');
    }

    if (result.isValid) {
      return result.typiaResult;
    }

    if (result.crossModelError) {
      return {
        success: false,
        data,
        errors: [
          {
            expected: result.crossModelError,
            path: '.',
            value: data,
          },
        ],
      };
    }

    return result.typiaResult;
  },
  onDbError: (err) => {
    OpLog.err(err);
    alertDialog('DB ERROR: ' + err);
  },
  repair: (data: unknown, errors: IValidation.IError[]) => {
    if (!isDataRepairPossible(data as AppDataComplete)) {
      throw new DataRepairNotPossibleError(data);
    }
    return dataRepair(data as AppDataComplete, errors) as AppDataComplete;
  },
  crossModelMigrations: {},
};
