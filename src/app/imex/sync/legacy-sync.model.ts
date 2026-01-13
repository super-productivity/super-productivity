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
import { LocalSyncMetaForProvider } from './sync.model';

// TODO remove completely, if not migrating anymore

/** @deprecated */
export interface LegacyAppBaseData {
  project: ProjectState;
  archivedProjects: ProjectArchive;
  globalConfig: GlobalConfigState;
  reminders: Reminder[];

  metric: MetricState;

  task: TaskState;
  tag: TagState;
  simpleCounter: SimpleCounterState;
  taskArchive: TaskArchive;
  taskRepeatCfg: TaskRepeatCfgState;
}

export interface LocalSyncMetaModel {
  [LegacySyncProvider.WebDAV]: LocalSyncMetaForProvider;
  [LegacySyncProvider.Dropbox]: LocalSyncMetaForProvider;
  [LegacySyncProvider.LocalFile]: LocalSyncMetaForProvider;
}

// NOTE: [key:string] always refers to projectId
export interface LegacyAppDataForProjects {
  note: {
    [key: string]: NoteState;
  };
}

export interface LegacyAppDataCompleteOptionalSyncModelChange
  extends LegacyAppBaseData, LegacyAppDataForProjects {
  lastLocalSyncModelChange?: number | null;
}

export interface LegacyAppDataComplete
  extends LegacyAppBaseData, LegacyAppDataForProjects {
  lastLocalSyncModelChange: number | null;
}
