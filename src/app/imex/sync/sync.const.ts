import { initialProjectState } from '../../features/project/store/project.reducer';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { initialTagState } from '../../features/tag/store/tag.reducer';
import { initialSimpleCounterState } from '../../features/simple-counter/store/simple-counter.reducer';
import { createEmptyEntity } from '../../util/create-empty-entity';
import { TaskArchive } from '../../features/tasks/task.model';
import { initialTaskRepeatCfgState } from '../../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { initialMetricState } from '../../features/metric/store/metric.reducer';
import { AppBaseData } from './sync.model';
import { initialNoteState } from '../../features/note/store/note.reducer';
import { initialGlobalConfigState } from '../../features/config/store/global-config.reducer';
import { plannerInitialState } from '../../features/planner/store/planner.reducer';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { issueProviderInitialState } from '../../features/issue/store/issue-provider.reducer';
import { initialBoardsState } from '../../features/boards/store/boards.reducer';
import { menuTreeInitialState } from '../../features/menu-tree/store/menu-tree.reducer';

export const SYNC_INITIAL_SYNC_TRIGGER = 'INITIAL_SYNC_TRIGGER';
export const SYNC_DEFAULT_AUDIT_TIME = 10000;

export const SYNC_BEFORE_GOING_TO_SLEEP_THROTTLE_TIME = 1000 * 60 * 5;

export const SYNC_BEFORE_CLOSE_ID = 'SYNC_BEFORE_CLOSE_ID';
export const SYNC_MIN_INTERVAL = 5000;

/**
 * Maximum time to wait for an ongoing sync to complete before considering it timed out.
 * Used by `afterCurrentSyncDoneOrSyncDisabled$` to prevent indefinite waiting.
 */
export const SYNC_WAIT_TIMEOUT_MS = 40000;

/**
 * Small delay after data re-initialization to allow Angular change detection
 * and prevent potential follow-up timing issues.
 */
export const SYNC_REINIT_DELAY_MS = 100;

/**
 * Delay before triggering the initial sync for SuperSync provider.
 * This allows the UI to render and become interactive first.
 * Only applies to SuperSync because:
 * - SuperSync uses operation-based sync where data is already local
 * - Other providers (Dropbox, WebDAV, LocalFile) may need to download data before user can work
 */
export const INITIAL_SYNC_DELAY_MS = 500;

export const DEFAULT_APP_BASE_DATA: AppBaseData = {
  project: initialProjectState,
  menuTree: menuTreeInitialState,
  archivedProjects: {},
  globalConfig: initialGlobalConfigState,
  reminders: [],
  planner: plannerInitialState,
  issueProvider: issueProviderInitialState,
  boards: initialBoardsState,

  task: initialTaskState,
  tag: initialTagState,
  simpleCounter: initialSimpleCounterState,
  taskArchive: {
    ...(createEmptyEntity() as TaskArchive),
  },
  taskRepeatCfg: initialTaskRepeatCfgState,
  note: initialNoteState,

  metric: initialMetricState,
};

// NOTE: they should never be changed
export const PREPEND_STR_ENCRYPTION = 'SP_ENC_';
export const PREPEND_STR_COMPRESSION = 'SP_CPR_';

type GlobalConfigKey = keyof GlobalConfigState;
type MiscKey = keyof GlobalConfigState['misc'];
type SyncKey = keyof GlobalConfigState['sync'];
type LocalFileSyncKey = keyof GlobalConfigState['sync']['localFileSync'];
type WebDavKey = keyof GlobalConfigState['sync']['webDav'];

type ConfigPath =
  | [GlobalConfigKey, MiscKey]
  | [GlobalConfigKey, SyncKey, LocalFileSyncKey | WebDavKey];

export const GLOBAL_CONFIG_LOCAL_ONLY_FIELDS: ConfigPath[] = [
  // ['misc', 'darkMode'],
  // ['sync', 'localFileSync'],
  // ['sync', 'webDav', 'password'],
  // ['sync', 'localFileSync', 'syncFolderPath'],
  // ['sync', 'webDav', 'password'],
];
