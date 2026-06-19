import { DEFAULT_JIRA_CFG, JIRA_CONFIG_FORM_SECTION } from './providers/jira/jira.const';
import {
  IssueProviderBase,
  BuiltInIssueProviderKey,
  MigratedIssueProviderKey,
} from './issue.model';
// GitHub is now a plugin — no built-in config needed
import {
  DEFAULT_GITLAB_CFG,
  GITLAB_CONFIG_FORM_SECTION,
} from './providers/gitlab/gitlab.const';
import {
  CALDAV_CONFIG_FORM_SECTION,
  DEFAULT_CALDAV_CFG,
} from './providers/caldav/caldav.const';
import {
  DEFAULT_OPEN_PROJECT_CFG,
  OPEN_PROJECT_CONFIG_FORM_SECTION,
} from './providers/open-project/open-project.const';
import { T } from '../../t.const';
// Gitea is now a plugin — no built-in config needed
import {
  DEFAULT_REDMINE_CFG,
  REDMINE_CONFIG_FORM_SECTION,
} from './providers/redmine/redmine.const';
import {
  CALENDAR_FORM_CFG_NEW,
  DEFAULT_CALENDAR_CFG,
} from './providers/calendar/calendar.const';
// Trello is now a plugin — no built-in config needed
// Linear is now a plugin — no built-in config needed
// ClickUp is now a plugin — no built-in config needed
// Azure DevOps is now a plugin — no built-in config needed
import { DEFAULT_NEXTCLOUD_DECK_CFG } from './providers/nextcloud-deck/nextcloud-deck.const';
import { NEXTCLOUD_DECK_CONFIG_FORM_SECTION } from './providers/nextcloud-deck/nextcloud-deck.const';
import {
  DEFAULT_PLAINSPACE_CFG,
  PLAINSPACE_CONFIG_FORM_SECTION,
} from './providers/plainspace/plainspace.const';

export const DELAY_BEFORE_ISSUE_POLLING = 8000;

export const GITLAB_TYPE: BuiltInIssueProviderKey = 'GITLAB';
export const GITHUB_TYPE: MigratedIssueProviderKey = 'GITHUB';
export const JIRA_TYPE: BuiltInIssueProviderKey = 'JIRA';
export const CALDAV_TYPE: BuiltInIssueProviderKey = 'CALDAV';
export const OPEN_PROJECT_TYPE: BuiltInIssueProviderKey = 'OPEN_PROJECT';
export const REDMINE_TYPE: BuiltInIssueProviderKey = 'REDMINE';
export const ICAL_TYPE: BuiltInIssueProviderKey = 'ICAL';
export const TRELLO_TYPE: MigratedIssueProviderKey = 'TRELLO';
export const CLICKUP_TYPE: MigratedIssueProviderKey = 'CLICKUP';
export const AZURE_DEVOPS_TYPE: MigratedIssueProviderKey = 'AZURE_DEVOPS';
export const NEXTCLOUD_DECK_TYPE: BuiltInIssueProviderKey = 'NEXTCLOUD_DECK';
export const PLAINSPACE_TYPE: BuiltInIssueProviderKey = 'PLAINSPACE';

export const ISSUE_PROVIDER_TYPES: BuiltInIssueProviderKey[] = [
  GITLAB_TYPE,
  JIRA_TYPE,
  CALDAV_TYPE,
  ICAL_TYPE,
  OPEN_PROJECT_TYPE,
  REDMINE_TYPE,
  NEXTCLOUD_DECK_TYPE,
  PLAINSPACE_TYPE,
] as const;

export const ISSUE_PROVIDER_ICON_MAP = {
  [JIRA_TYPE]: 'jira',
  [GITLAB_TYPE]: 'gitlab',
  [CALDAV_TYPE]: 'caldav',
  [ICAL_TYPE]: 'calendar',
  [OPEN_PROJECT_TYPE]: 'open_project',
  [REDMINE_TYPE]: 'redmine',
  [NEXTCLOUD_DECK_TYPE]: 'nextcloud_deck',
  [PLAINSPACE_TYPE]: 'plainspace',
} as const;

export const ISSUE_PROVIDER_HUMANIZED = {
  [JIRA_TYPE]: 'Jira',
  [GITLAB_TYPE]: 'GitLab',
  [CALDAV_TYPE]: 'CalDAV',
  [ICAL_TYPE]: 'Calendar',
  [OPEN_PROJECT_TYPE]: 'OpenProject',
  [REDMINE_TYPE]: 'Redmine',
  [NEXTCLOUD_DECK_TYPE]: 'Nextcloud Deck',
  [PLAINSPACE_TYPE]: 'Plainspace',
} as const;

export const DEFAULT_ISSUE_PROVIDER_CFGS = {
  [JIRA_TYPE]: DEFAULT_JIRA_CFG,
  [GITLAB_TYPE]: DEFAULT_GITLAB_CFG,
  [CALDAV_TYPE]: DEFAULT_CALDAV_CFG,
  [ICAL_TYPE]: DEFAULT_CALENDAR_CFG,
  [OPEN_PROJECT_TYPE]: DEFAULT_OPEN_PROJECT_CFG,
  [REDMINE_TYPE]: DEFAULT_REDMINE_CFG,
  [NEXTCLOUD_DECK_TYPE]: DEFAULT_NEXTCLOUD_DECK_CFG,
  [PLAINSPACE_TYPE]: DEFAULT_PLAINSPACE_CFG,
} as const;

export const ISSUE_PROVIDER_FORM_CFGS_MAP = {
  [JIRA_TYPE]: JIRA_CONFIG_FORM_SECTION,
  [GITLAB_TYPE]: GITLAB_CONFIG_FORM_SECTION,
  [CALDAV_TYPE]: CALDAV_CONFIG_FORM_SECTION,
  [ICAL_TYPE]: CALENDAR_FORM_CFG_NEW as any,
  [OPEN_PROJECT_TYPE]: OPEN_PROJECT_CONFIG_FORM_SECTION,
  [REDMINE_TYPE]: REDMINE_CONFIG_FORM_SECTION,
  [NEXTCLOUD_DECK_TYPE]: NEXTCLOUD_DECK_CONFIG_FORM_SECTION,
  [PLAINSPACE_TYPE]: PLAINSPACE_CONFIG_FORM_SECTION,
} as const;

export const DEFAULT_ISSUE_STRS: { ISSUE_STR: string; ISSUES_STR: string } = {
  ISSUE_STR: T.F.ISSUE.DEFAULT.ISSUE_STR,
  ISSUES_STR: T.F.ISSUE.DEFAULT.ISSUES_STR,
} as const;

export const ISSUE_STR_MAP: Record<
  BuiltInIssueProviderKey,
  { ISSUE_STR: string; ISSUES_STR: string }
> = {
  [JIRA_TYPE]: DEFAULT_ISSUE_STRS,
  [GITLAB_TYPE]: DEFAULT_ISSUE_STRS,
  [CALDAV_TYPE]: DEFAULT_ISSUE_STRS,
  [ICAL_TYPE]: {
    ISSUE_STR: T.F.CALENDARS.EVENT_STRINGS.EVENT_STR,
    ISSUES_STR: T.F.CALENDARS.EVENT_STRINGS.EVENTS_STR,
  },
  [OPEN_PROJECT_TYPE]: {
    ISSUE_STR: T.F.OPEN_PROJECT.ISSUE_STRINGS.ISSUE_STR,
    ISSUES_STR: T.F.OPEN_PROJECT.ISSUE_STRINGS.ISSUES_STR,
  },
  [REDMINE_TYPE]: DEFAULT_ISSUE_STRS,
  [NEXTCLOUD_DECK_TYPE]: DEFAULT_ISSUE_STRS,
  [PLAINSPACE_TYPE]: DEFAULT_ISSUE_STRS,
} as const;

export const ISSUE_PROVIDER_DEFAULT_COMMON_CFG: Omit<
  IssueProviderBase,
  'id' | 'issueProviderKey' | 'isEnabled'
> = {
  isAutoPoll: true,
  isAutoAddToBacklog: false,
  isIntegratedAddTaskBar: false,
  defaultProjectId: null,
  pinnedSearch: null,
  pollingMode: 'whenProjectOpen',
  defaultTagIds: [],
  defaultNote: null,
} as const;
