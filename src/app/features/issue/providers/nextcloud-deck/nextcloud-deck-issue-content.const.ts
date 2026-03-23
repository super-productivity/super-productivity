import { T } from '../../../../t.const';
import {
  IssueContentConfig,
  IssueFieldType,
} from '../../issue-content/issue-content.model';
import { NextcloudDeckIssue } from './nextcloud-deck-issue.model';
import { IssueProviderKey } from '../../issue.model';

export const NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG: IssueContentConfig<NextcloudDeckIssue> =
  {
    issueType: 'NEXTCLOUD_DECK' as IssueProviderKey,
    fields: [
      {
        label: T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
        value: 'title',
        type: IssueFieldType.TEXT,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.DECK_DESCRIPTION,
        value: 'description',
        isVisible: (issue: NextcloudDeckIssue) => !!issue.description,
        type: IssueFieldType.MARKDOWN,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.STACK,
        value: 'stackTitle',
        type: IssueFieldType.TEXT,
      },
      {
        label: T.F.ISSUE.ISSUE_CONTENT.DUE_DATE,
        value: 'duedate',
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) => !!issue.duedate,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.ASSIGNED_USERS,
        value: (issue: NextcloudDeckIssue) =>
          issue.assignedUsers?.map((u) => u.participant.displayname).join(', '),
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) =>
          !!issue.assignedUsers && issue.assignedUsers.length > 0,
      },
      {
        label: T.F.NEXTCLOUD_DECK.ISSUE_CONTENT.LABELS,
        value: (issue: NextcloudDeckIssue) =>
          issue.labels?.map((l) => l.title).join(', '),
        type: IssueFieldType.TEXT,
        isVisible: (issue: NextcloudDeckIssue) =>
          !!issue.labels && issue.labels.length > 0,
      },
    ],
  };
