import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';
import { createEmptyEntity } from './create-empty-entity';
import { AppDataComplete } from '../op-log/model/model-config';
import { initialTimeTrackingState } from '../features/time-tracking/store/time-tracking.reducer';

export const createAppDataCompleteMock = (): AppDataComplete => ({
  project: {
    ...createEmptyEntity(),
  },
  menuTree: {
    tagTree: [],
    projectTree: [],
  },
  globalConfig: DEFAULT_GLOBAL_CONFIG,

  task: {
    ...createEmptyEntity(),
    ids: [],
    currentTaskId: null,
    selectedTaskId: null,
    taskDetailTargetPanel: null,
    lastCurrentTaskId: null,
    isDataLoaded: false,
  },
  tag: createEmptyEntity(),
  simpleCounter: {
    ...createEmptyEntity(),
    ids: [],
  },
  taskRepeatCfg: createEmptyEntity(),

  // OPTIONAL though they are really not
  reminders: [],
  note: {
    ...createEmptyEntity(),
    todayOrder: [],
  },
  metric: createEmptyEntity(),
  planner: { days: {}, addPlannedTasksDialogLastShown: undefined },
  issueProvider: createEmptyEntity() as any,
  boards: {
    boardCfgs: [],
  },
  timeTracking: {
    project: {},
    tag: {},
  },

  archiveYoung: {
    task: createEmptyEntity(),
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 0,
  },
  archiveOld: {
    task: createEmptyEntity(),
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 0,
  },

  pluginMetadata: [],
  pluginUserData: [],
});
