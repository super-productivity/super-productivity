import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { JiraIssue } from './jira-issue.model';

export const JIRA_ISSUE_CONTENT_CONFIG: IssueContentConfig<JiraIssue> = {
  issueType: 'JIRA' as const,
  fields: [
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      type: IssueFieldType.CUSTOM,
      customTemplate: 'jira-link',
      value: (issue: JiraIssue) => `${issue.key} ${issue.summary}`,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STATUS,
      type: IssueFieldType.TEXT,
      value: (issue: JiraIssue) => issue.status?.name,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.STORY_POINTS,
      value: 'storyPoints',
      type: IssueFieldType.TEXT,
      isVisible: (issue: JiraIssue) => !!issue.storyPoints,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ASSIGNEE,
      type: IssueFieldType.TEXT,
      value: (issue: JiraIssue) => issue.assignee?.displayName || '–',
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.WORKLOG,
      type: IssueFieldType.TEXT,
      value: (issue: JiraIssue) => {
        const timeSpent = issue.timespent ? issue.timespent * 1000 : 0;
        const timeEstimate = issue.timeestimate ? issue.timeestimate * 1000 : 0;
        const formatMs = (ms: number): string => {
          const hours = Math.floor(ms / (1000 * 60 * 60));
          const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
          return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        };
        return `${formatMs(timeSpent)} / ${formatMs(timeEstimate)}`;
      },
      isVisible: (issue: JiraIssue) => !!issue.timespent || !!issue.timeestimate,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.SUB_TASKS,
      value: 'subtasks',
      type: IssueFieldType.CUSTOM,
      customTemplate: 'jira-subtasks',
      isVisible: (issue: JiraIssue) => false, // Will be handled by observable
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.RELATED,
      value: 'related',
      type: IssueFieldType.CUSTOM,
      customTemplate: 'jira-related',
      isVisible: (issue: JiraIssue) => false, // Will be handled by observable
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.COMPONENTS,
      type: IssueFieldType.CHIPS,
      value: (issue: JiraIssue) =>
        issue.components?.map((c) => ({
          name: c.name,
          description: c.description,
        })),
      isVisible: (issue: JiraIssue) => (issue.components?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.ATTACHMENTS,
      type: IssueFieldType.CHIPS,
      value: (issue: JiraIssue) =>
        issue.attachments?.map((attachment) => ({
          name: attachment.filename,
          description: `${attachment.size} bytes`,
        })),
      isVisible: (issue: JiraIssue) => (issue.attachments?.length ?? 0) > 0,
    },
    {
      label: T.F.ISSUE.ISSUE_CONTENT.DESCRIPTION,
      value: 'description',
      type: IssueFieldType.MARKDOWN,
      isVisible: (issue: JiraIssue) => !!issue.description,
    },
  ],
  comments: {
    field: 'comments',
    authorField: 'author.displayName',
    bodyField: 'body',
    createdField: 'created',
    avatarField: 'author.avatarUrl',
    sortField: 'created',
  },
  hasCollapsingComments: true,
};
