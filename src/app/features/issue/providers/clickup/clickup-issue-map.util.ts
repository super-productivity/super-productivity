import {
  ClickUpTask,
  ClickUpTaskReduced,
  ClickUpAttachment,
} from './clickup-issue.model';
import { Task } from '../../../tasks/task.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';

export const mapClickUpAttachmentToTaskAttachment = (
  attachment: ClickUpAttachment,
): TaskAttachment => {
  return {
    id: attachment.id,
    title: attachment.title,
    path: attachment.url,
    type: 'LINK',
    // ClickUp attachments also have 'type': 'image/png' etc.
    // But for app integration, we treat them as links to the file for now.
  };
};

export const mapClickUpTaskToTask = (
  issue: ClickUpTask,
): Partial<Task> & { title: string } => {
  return {
    title: issue.name,
    issueWasUpdated: false,
    issueLastUpdated: parseInt(issue.date_updated, 10),
    isDone: isClickUpTaskDone(issue),
    // timeSpent is in total?
    // If we want to import time spent, we might need to be careful not to overwrite local time if not desired.
    // For now, let's not auto-update timeSpent from server to local unless we work on full sync.
    // Just mapping basics.
  };
};

export const isClickUpTaskDone = (issue: ClickUpTask | ClickUpTaskReduced): boolean => {
  return issue.status.type === 'closed' || issue.status.status === 'closed'; // 'closed' type is safer
};

export const mapClickUpTaskWithSubTasks = (
  issue: ClickUpTask,
): {
  mainTask: Partial<Task> & { title: string };
  subTasks: Array<Partial<Task> & { title: string }>;
} => {
  const mainTask = mapClickUpTaskToTask(issue);
  const subTasks: Array<Partial<Task> & { title: string }> = [];

  if (issue.subtasks && issue.subtasks.length > 0) {
    issue.subtasks.forEach((subtask) => {
      subTasks.push({
        title: subtask.name,
        issueWasUpdated: false,
        issueLastUpdated: parseInt(subtask.date_updated, 10),
        isDone: isClickUpTaskDone(subtask),
      });
    });
  }

  return { mainTask, subTasks };
};
