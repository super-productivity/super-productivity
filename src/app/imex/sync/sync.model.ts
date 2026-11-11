import { GlobalConfigState } from '../../features/config/global-config.model';
import { TaskArchive, TaskState } from '../../features/tasks/task.model';
import { Reminder } from '../../features/reminder/reminder.model';
import { MetricState } from '../../features/metric/metric.model';
import { TaskRepeatCfgState } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { TagState } from '../../features/tag/tag.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { ProjectArchive } from '../../features/project/project-archive.model';
import { ProjectState } from '../../features/project/project.model';
import { NoteState } from '../../features/note/note.model';
import { PlannerState } from '../../features/planner/store/planner.reducer';
import { IssueProviderState } from '../../features/issue/issue.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import { MenuTreeState } from '../../features/menu-tree/store/menu-tree.model';
import { SectionState } from '../../features/section/section.model';

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
  section: SectionState;
}

export interface AppArchiveFileData {
  taskArchive: TaskArchive;
  archivedProjects: ProjectArchive;
}

export interface AppBaseData
  extends AppBaseWithoutLastSyncModelChange, AppArchiveFileData {}

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
