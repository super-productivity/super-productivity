import { Task, TaskState } from '../tasks/task.model';
import { EntityState } from '@ngrx/entity';
import { TaskAttachment } from '../tasks/task-attachment/task-attachment.model';
import { Tag } from '../tag/tag.model';
import { MetricState } from '../metric/metric.model';
import { Project } from './project.model';
import { NoteState } from '../note/note.model';

export interface ProjectArchivedRelatedData {
  note?: NoteState;
  task?: TaskState;
  taskArchive?: EntityState<Task>;
  taskAttachment?: EntityState<TaskAttachment>;
  taskTag?: EntityState<Tag>;
  metric?: MetricState;
}

export interface ExportedProject extends Project {
  relatedModels: ProjectArchivedRelatedData;
}

export interface ProjectArchive {
  [key: string]: string;
}
