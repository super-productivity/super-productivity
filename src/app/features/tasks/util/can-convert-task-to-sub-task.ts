import { Task } from '../task.model';

type ConvertibleTaskFields = Pick<
  Task,
  | 'parentId'
  | 'subTaskIds'
  | 'repeatCfgId'
  | 'issueId'
  | 'issueProviderId'
  | 'issueType'
  | 'dueWithTime'
  | 'reminderId'
  | 'remindAt'
>;

export const canConvertTaskToSubTask = (task: ConvertibleTaskFields): boolean =>
  !task.parentId &&
  !task.subTaskIds?.length &&
  !task.repeatCfgId &&
  !task.issueId &&
  !task.issueProviderId &&
  !task.issueType &&
  !task.dueWithTime &&
  !task.reminderId &&
  !task.remindAt;
