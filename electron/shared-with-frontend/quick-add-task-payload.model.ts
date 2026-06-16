import { Task, TaskReminderOptionId } from '../../src/app/features/tasks/task.model';
import { TaskRepeatCfg } from '../../src/app/features/task-repeat-cfg/task-repeat-cfg.model';

export interface QuickAddTaskPayload {
  title: string;
  taskData: Partial<Task>;
  isAddToBacklog: boolean;
  isAddToBottom: boolean;
  remindOption?: TaskReminderOptionId;
  repeatQuickSetting?: string | null;
  repeatCfg?: Partial<TaskRepeatCfg>;
}
