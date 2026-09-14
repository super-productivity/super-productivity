import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { OutlookTasksIssue, OutlookTaskStatus } from './outlook-tasks-issue.model';
import { IssueProviderKey } from '../../issue.model';

export const OUTLOOK_TASKS_ISSUE_CONTENT_CONFIG: IssueContentConfig<OutlookTasksIssue> = {
  // String literal avoids circular dependency with issue.const.ts (which imports this file).
  issueType: 'OUTLOOK_TASKS' as IssueProviderKey,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      value: 'title',
      type: IssueFieldType.TEXT,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: (issue: OutlookTasksIssue) => {
        switch (issue.status) {
          case OutlookTaskStatus.NOT_STARTED:
            return 'Not Started';
          case OutlookTaskStatus.IN_PROGRESS:
            return 'In Progress';
          case OutlookTaskStatus.COMPLETED:
            return 'Completed';
          case OutlookTaskStatus.WAITING_ON_OTHERS:
            return 'Waiting on Others';
          case OutlookTaskStatus.DEFERRED:
            return 'Deferred';
          default:
            return issue.status || '';
        }
      },
      type: IssueFieldType.TEXT,
      isVisible: (issue: OutlookTasksIssue) => !!issue.status,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.PRIORITY,
      value: (issue: OutlookTasksIssue) => {
        switch (issue.importance) {
          case 'high':
            return 'High';
          case 'normal':
            return 'Normal';
          case 'low':
            return 'Low';
          default:
            return issue.importance || '';
        }
      },
      type: IssueFieldType.TEXT,
      isVisible: (issue: OutlookTasksIssue) => !!issue.importance,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DUE_DATE,
      value: (issue: OutlookTasksIssue) =>
        issue.dueDateTime?.dateTime
          ? new Date(issue.dueDateTime.dateTime).toLocaleDateString()
          : '',
      type: IssueFieldType.TEXT,
      isVisible: (issue: OutlookTasksIssue) => !!issue.dueDateTime?.dateTime,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.START,
      value: (issue: OutlookTasksIssue) =>
        issue.startDateTime?.dateTime
          ? new Date(issue.startDateTime.dateTime).toLocaleDateString()
          : '',
      type: IssueFieldType.TEXT,
      isVisible: (issue: OutlookTasksIssue) => !!issue.startDateTime?.dateTime,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: (issue: OutlookTasksIssue) => issue.body?.content || '',
      isVisible: (issue: OutlookTasksIssue) => !!issue.body?.content,
      type: IssueFieldType.MARKDOWN,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.CATEGORY,
      value: (issue: OutlookTasksIssue) => issue.categories?.join(', '),
      type: IssueFieldType.TEXT,
      isVisible: (issue: OutlookTasksIssue) =>
        !!issue.categories && issue.categories.length > 0,
    },
  ],
};
