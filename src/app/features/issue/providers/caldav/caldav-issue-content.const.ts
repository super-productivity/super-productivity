import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { CaldavIssue, CaldavIssueStatus } from './caldav-issue.model';
import { IssueProviderKey } from '../../issue.model';

export const CALDAV_ISSUE_CONTENT_CONFIG: IssueContentConfig<CaldavIssue> = {
  issueType: 'CALDAV' as IssueProviderKey,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      value: 'summary',
      type: IssueFieldType.TEXT,
    },
    // todo improve display off `due` and `start` using right time format (searching for method)
    {
      label: T.F.ISSUE.ISSUE_CONTENT.START,
      value: 'start',
      type: IssueFieldType.CUSTOM,
      customTemplate: 'caldav-time',
      isVisible: (issue: CaldavIssue) => !!issue.start,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DUE_DATE,
      value: 'due',
      type: IssueFieldType.CUSTOM,
      customTemplate: 'caldav-time',
      isVisible: (issue: CaldavIssue) => !!issue.due,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'note',
      isVisible: (issue: CaldavIssue) => !!issue.note,
      type: IssueFieldType.MARKDOWN,
    },
    {
      label: 'Status',
      value: (issue: CaldavIssue) => {
        switch (issue.status) {
          case CaldavIssueStatus.NEEDS_ACTION:
            return 'Needs Action';
          case CaldavIssueStatus.COMPLETED:
            return 'Completed';
          case CaldavIssueStatus.IN_PROCESS:
            return 'In Process';
          case CaldavIssueStatus.CANCELLED:
            return 'Cancelled';
          default:
            return issue.status || '';
        }
      },
      type: IssueFieldType.TEXT,
      isVisible: (issue: CaldavIssue) => !!issue.status,
    },
    {
      label: 'Priority',
      value: (issue: CaldavIssue) => {
        if (issue.priority === undefined || issue.priority < 1 || issue.priority > 9) {
          return '';
        }

        let cua: string;
        if (issue.priority <= 4) {
          cua = 'High';
        } else if (issue.priority === 5) {
          cua = 'Medium';
        } else {
          cua = 'Low';
        }
        return `${cua} (${issue.priority})`;
      },
      type: IssueFieldType.TEXT,
      isVisible: (issue: CaldavIssue) =>
        issue.priority !== undefined && issue.priority > 0,
    },
    {
      label: 'Percentage',
      value: (issue: CaldavIssue) => `${issue.percent_complete}%`,
      type: IssueFieldType.TEXT,
      isVisible: (issue: CaldavIssue) =>
        issue.percent_complete !== undefined &&
        issue.percent_complete > 0 &&
        issue.percent_complete < 100,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LOCATION,
      value: 'location',
      type: IssueFieldType.TEXT,
      isVisible: (issue: CaldavIssue) => !!issue.location,
    },
    {
      label: 'Labels',
      value: (issue: CaldavIssue) => issue.labels?.join(', '),
      type: IssueFieldType.TEXT,
      isVisible: (issue: CaldavIssue) => !!issue.labels && issue.labels.length > 0,
    },
  ],
};
