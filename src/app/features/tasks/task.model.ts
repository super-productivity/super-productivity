import { IssueProviderKey } from '../issue/issue.model';
import { EntityState } from '@ngrx/entity';
import { TaskAttachment } from './task-attachment/task-attachment.model';
// Import the unified Task type from plugin-api
import { Task as PluginTask } from '@super-productivity/plugin-api';

export enum HideSubTasksMode {
  // Show is undefined
  HideDone = 1,
  HideAll = 2,
}

export enum TaskDetailTargetPanel {
  Default = 'Default',
  Attachments = 'Attachments',
  DONT_OPEN_PANEL = 'DONT_OPEN_PANEL',
}

export type DropListModelSource =
  | 'UNDONE'
  | 'DONE'
  | 'BACKLOG'
  | 'ADD_TASK_PANEL'
  | 'OVERDUE'
  | 'LATER_TODAY';

// NOTE: do not change these, as they are used inside task repeat model directly
// (new can be added though)
export enum TaskReminderOptionId {
  DoNotRemind = 'DoNotRemind',
  AtStart = 'AtStart',
  m5 = 'm5',
  m10 = 'm10',
  m15 = 'm15',
  m30 = 'm30',
  h1 = 'h1',
}

export interface TaskReminderOption {
  value: TaskReminderOptionId;
  label: string;
}

export interface TimeSpentOnDayCopy {
  [key: string]: number;
}

export interface TaskArchive extends EntityState<ArchiveTask> {
  ids: string[];
}

export type TimeSpentOnDay = Readonly<TimeSpentOnDayCopy>;

export interface IssueTaskTimeTracked {
  [key: string]: number;
}

export interface IssueFieldsForTask {
  // NOTE: keep in mind that the issueId is not unique (especially for github)
  issueId?: string;
  issueProviderId?: string;
  issueType?: IssueProviderKey;
  issueWasUpdated?: boolean;
  // TODO remove null again
  issueLastUpdated?: number | null;
  issueAttachmentNr?: number;
  issueTimeTracked?: IssueTaskTimeTracked;
  issuePoints?: number;
  issueMarker?: string | null;
}

// Extend the plugin Task type with app-specific fields
// Omit issue fields from PluginTask to avoid conflict with IssueFieldsForTask
export interface TaskCopy
  extends
    Omit<
      PluginTask,
      | 'issueId'
      | 'issueProviderId'
      | 'issueType'
      | 'issueWasUpdated'
      | 'issueLastUpdated'
      | 'issueAttachmentNr'
      | 'issuePoints'
    >,
    IssueFieldsForTask {
  // Override required fields that are optional in plugin type
  projectId: string;
  timeSpentOnDay: TimeSpentOnDay;

  // Additional app-specific fields
  dueWithTime?: number | null;
  dueDay?: string | null;
  hasPlannedTime?: boolean;
  attachments: TaskAttachment[];
  reminderId?: string | null;

  // Ensure type compatibility for internal fields
  modified?: number;
  doneOn?: number;
  parentId?: string;
  remindAt?: number;
  repeatCfgId?: string;
  _hideSubTasksMode?: HideSubTasksMode;
}

/**
 * standard task but with:
 * * reminder removed, if any
 * * sub tasks not included (but copied)
 */
// attachment data saved to it
export type ArchiveTask = Readonly<TaskCopy>;

export type Task = Readonly<TaskCopy>;

export interface TaskWithReminderData extends Task {
  readonly reminderData: { remindAt: number };
  readonly parentData?: Task;
}

export interface TaskWithReminder extends Task {
  remindAt: number;
}

export interface TaskWithDueTime extends Task {
  dueWithTime: number;
}

export interface TaskWithDueDay extends Task {
  dueDay: string;
}

export type TaskPlannedWithDayOrTime = TaskWithDueTime | TaskWithDueDay;

export interface TaskWithoutReminder extends Task {
  remindAt: undefined;
}

export interface TaskWithPlannedForDayIndication extends TaskWithoutReminder {
  plannedForDay: string;
}

export interface TaskWithSubTasks extends Task {
  readonly subTasks: Task[];
}

// make title required and add optional property for possible related (parent) task
export type IssueTask = Partial<Task> & {
  title: string;
  related_to?: string;
};

export const DEFAULT_TASK: Omit<TaskCopy, 'projectId'> = {
  id: '',
  subTaskIds: [],
  timeSpentOnDay: {},
  timeSpent: 0,
  timeEstimate: 0,
  isDone: false,
  title: '',
  tagIds: [],
  created: Date.now(),

  attachments: [],
};

export interface TaskState extends EntityState<Task> {
  // overwrite entity model to avoid problems with typing
  ids: string[];

  // additional entities state properties
  currentTaskId: string | null;
  selectedTaskId: string | null;
  taskDetailTargetPanel?: TaskDetailTargetPanel | null;
  lastCurrentTaskId: string | null;
  isDataLoaded: boolean;
}

export interface WorklogTask extends Task {
  dateStr: string;
}
