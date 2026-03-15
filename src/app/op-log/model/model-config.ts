import { AllModelData, ModelCfg } from '../core/types/sync.types';
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
import {
  ArchiveModel,
  TimeTrackingState,
} from '../../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { fixEntityStateConsistency } from '../../util/check-fix-entity-state-consistency';
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
    repair: fixEntityStateConsistency,
  },
  timeTracking: {
    defaultData: initialTimeTrackingState,
    isMainFileModel: true,
  },
  project: {
    defaultData: initialProjectState,
    isMainFileModel: true,
    repair: fixEntityStateConsistency,
  },
  tag: {
    defaultData: initialTagState,
    isMainFileModel: true,
    repair: fixEntityStateConsistency,
  },
  simpleCounter: {
    defaultData: initialSimpleCounterState,
    isMainFileModel: true,
    repair: fixEntityStateConsistency,
  },
  note: {
    defaultData: initialNoteState,
    isMainFileModel: true,
    repair: fixEntityStateConsistency,
  },
  taskRepeatCfg: {
    defaultData: initialTaskRepeatCfgState,
    isMainFileModel: true,
    repair: fixEntityStateConsistency,
  },
  reminders: {
    defaultData: [],
    isMainFileModel: true,
  },
  planner: {
    defaultData: plannerInitialState,
    isMainFileModel: true,
  },
  boards: {
    defaultData: initialBoardsState,
    isMainFileModel: true,
  },
  menuTree: {
    defaultData: menuTreeInitialState,
  },
  pluginUserData: {
    defaultData: initialPluginUserDataState,
  },
  pluginMetadata: {
    defaultData: initialPluginMetaDataState,
  },
  globalConfig: {
    defaultData: DEFAULT_GLOBAL_CONFIG,
  },
  issueProvider: {
    defaultData: issueProviderInitialState,
    repair: fixEntityStateConsistency,
  },
  metric: {
    defaultData: initialMetricState,
    repair: fixEntityStateConsistency,
  },
  archiveYoung: {
    defaultData: {
      task: { ids: [], entities: {} },
      timeTracking: initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
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
