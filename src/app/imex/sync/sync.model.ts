import { GlobalConfigState } from '../../features/config/global-config.model';
import { TaskArchive, TaskState } from '../../features/tasks/task.model';
import { Reminder } from '../../features/reminder/reminder.model';
import { MetricState } from '../../features/metric/metric.model';
import { TaskRepeatCfgState } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { TagState } from '../../features/tag/tag.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { ProjectArchive } from '../../features/project/project-archive.model';
import { LegacySyncProvider } from './legacy-sync-provider.model';
import { ProjectState } from '../../features/project/project.model';
import { NoteState } from '../../features/note/note.model';
import { PlannerState } from '../../features/planner/store/planner.reducer';
import { IssueProviderState } from '../../features/issue/issue.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import { MenuTreeState } from '../../features/menu-tree/store/menu-tree.model';

export interface AppBaseWithoutLastSyncModelChange {
  project: ProjectState;
  menuTree: MenuTreeState;
  globalConfig: GlobalConfigState;
  reminders: Reminder[];
  planner: PlannerState;
  boards: BoardsState;
  note: NoteState;
  issueProvider: IssueProviderState;

  metric: MetricState;

  task: TaskState;
  tag: TagState;
  simpleCounter: SimpleCounterState;
  taskRepeatCfg: TaskRepeatCfgState;
}

export interface AppMainFileNoRevsData extends AppBaseWithoutLastSyncModelChange {
  lastLocalSyncModelChange: number | null;
}

export interface AppMainFileData extends AppMainFileNoRevsData {
  archiveRev: string;
  archiveLastUpdate: number;
}

export interface AppArchiveFileData {
  taskArchive: TaskArchive;
  archivedProjects: ProjectArchive;
}

export interface AppBaseData
  extends AppBaseWithoutLastSyncModelChange, AppArchiveFileData {}

export interface LocalSyncMetaForProvider {
  lastSync: number;
  rev: string | null;
  revTaskArchive: string | null;
  // currently dropbox only
  accessToken?: string;
  refreshToken?: string;
  _tokenExpiresAt?: number;
}

export interface LocalSyncMetaModel {
  [LegacySyncProvider.WebDAV]: LocalSyncMetaForProvider;
  [LegacySyncProvider.Dropbox]: LocalSyncMetaForProvider;
  [LegacySyncProvider.LocalFile]: LocalSyncMetaForProvider;
}

export type AppBaseDataEntityLikeStates =
  | ProjectState
  | TaskState
  | TaskRepeatCfgState
  | TaskArchive
  | SimpleCounterState;

export interface AppDataCompleteLegacy extends AppBaseData {
  lastLocalSyncModelChange: number | null;
  lastArchiveUpdate: number | null;
}

export type DialogConflictResolutionResult = 'USE_LOCAL' | 'USE_REMOTE' | false;

export type DialogPermissionResolutionResult = 'DISABLED_SYNC' | 'GRANTED_PERMISSION';

export type SyncGetRevResult = 'NO_REMOTE_DATA' | 'HANDLED_ERROR' | Error;

export type SyncResultLegacy =
  | 'SUCCESS'
  | 'NO_UPDATE_REQUIRED'
  | 'USER_ABORT'
  | 'ERROR'
  | 'SPECIAL'
  | 'CONFLICT_DIALOG';
