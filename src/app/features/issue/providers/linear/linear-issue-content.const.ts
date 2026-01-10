import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { LinearIssue } from './linear-issue.model';

export const LINEAR_ISSUE_CONTENT_CONFIG: IssueContentConfig<LinearIssue> = {
  issueType: 'LINEAR' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.LINK,
      value: (issue: LinearIssue) => issue.identifier + ' ' + issue.title,
      getLink: (issue: LinearIssue) => issue.url,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      value: (issue: LinearIssue) => issue.state.name,
      type: IssueFieldType.TEXT,
      isVisible: (issue: LinearIssue) => !!issue.state.name,
    },
    {
      label: 'Priority',
      value: 'priority',
      type: IssueFieldType.TEXT,
      isVisible: (issue: LinearIssue) =>
        issue.priority !== 0 && issue.priority !== undefined,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: LinearIssue) => issue.assignee?.name,
      isVisible: (issue: LinearIssue) => !!issue.assignee,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.LABELS,
      value: 'labels',
      type: IssueFieldType.CHIPS,
      isVisible: (issue: LinearIssue) => (issue.labels?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'description',
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: LinearIssue) => !!issue.description,
    },
  ],
  comments: {
    field: 'comments',
    authorField: 'user.name',
    bodyField: 'body',
    createdField: 'createdAt',
    avatarField: 'user.avatarUrl',
    sortField: 'createdAt',
  },
  getIssueUrl: (issue) => issue.url,
  hasCollapsingComments: true,
};
