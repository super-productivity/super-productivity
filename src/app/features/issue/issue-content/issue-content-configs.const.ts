import { BuiltInIssueProviderKey } from '../issue.model';
import {
  IssueFieldType,
  IssueFieldConfig,
  IssueCommentConfig,
  IssueContentConfig,
} from './issue-content.model';
import { JIRA_ISSUE_CONTENT_CONFIG } from '../providers/jira/jira-issue-content.const';
import { GITLAB_ISSUE_CONTENT_CONFIG } from '../providers/gitlab/gitlab-issue-content.const';
import { CALDAV_ISSUE_CONTENT_CONFIG } from '../providers/caldav/caldav-issue-content.const';
// Gitea is now a plugin — content config lives in the plugin's issueDisplay
import { REDMINE_ISSUE_CONTENT_CONFIG } from '../providers/redmine/redmine-issue-content.const';
import { OPEN_PROJECT_ISSUE_CONTENT_CONFIG } from '../providers/open-project/open-project-issue-content.const';
import { TRELLO_ISSUE_CONTENT_CONFIG } from '../providers/trello/trello-issue-content.const';
// Linear is now a plugin — content config lives in the plugin's issueDisplay
import { AZURE_DEVOPS_ISSUE_CONTENT_CONFIG } from '../providers/azure-devops/azure-devops-issue/azure-devops-issue-content.const';
import { NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG } from '../providers/nextcloud-deck/nextcloud-deck-issue-content.const';

// Re-export types for backwards compatibility
export { IssueFieldType, IssueFieldConfig, IssueCommentConfig, IssueContentConfig };

export const ISSUE_CONTENT_CONFIGS: Record<
  BuiltInIssueProviderKey,
  IssueContentConfig<any>
> = {
  GITLAB: GITLAB_ISSUE_CONTENT_CONFIG,
  JIRA: JIRA_ISSUE_CONTENT_CONFIG,
  CALDAV: CALDAV_ISSUE_CONTENT_CONFIG,
  REDMINE: REDMINE_ISSUE_CONTENT_CONFIG,
  OPEN_PROJECT: OPEN_PROJECT_ISSUE_CONTENT_CONFIG,
  TRELLO: TRELLO_ISSUE_CONTENT_CONFIG,
  AZURE_DEVOPS: AZURE_DEVOPS_ISSUE_CONTENT_CONFIG,
  NEXTCLOUD_DECK: NEXTCLOUD_DECK_ISSUE_CONTENT_CONFIG,
  ICAL: {
    issueType: 'ICAL',
    fields: [],
  },
};
