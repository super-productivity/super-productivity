import { DEFAULT_JIRA_CFG, JIRA_CONFIG_FORM_SECTION } from './providers/jira/jira.const';
import { IssueProviderBase, IssueProviderKey } from './issue.model';
import {
  DEFAULT_GITHUB_CFG,
  GITHUB_CONFIG_FORM_SECTION,
} from './providers/github/github.const';
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
import {
  DEFAULT_GITEA_CFG,
  GITEA_CONFIG_FORM_SECTION,
} from './providers/gitea/gitea.const';
import {
  DEFAULT_REDMINE_CFG,
  REDMINE_CONFIG_FORM_SECTION,
} from './providers/redmine/redmine.const';
import {
  CALENDAR_FORM_CFG_NEW,
  DEFAULT_CALENDAR_CFG,
} from './providers/calendar/calendar.const';
import {
  DEFAULT_TRELLO_CFG,
  TRELLO_CONFIG_FORM_SECTION,
} from './providers/trello/trello.const';
import {
  DEFAULT_LINEAR_CFG,
  LINEAR_CONFIG_FORM_SECTION,
} from './providers/linear/linear.const';
import {
  DEFAULT_CLICKUP_CFG,
  CLICKUP_CONFIG_FORM_SECTION,
} from './providers/clickup/clickup.const';
import { AZURE_DEVOPS_INITIAL_CFG } from './providers/azure-devops/azure-devops.const';
import { DEFAULT_NEXTCLOUD_DECK_CFG } from './providers/nextcloud-deck/nextcloud-deck.const';
import { AZURE_DEVOPS_CONFIG_FORM_SECTION } from './providers/azure-devops/azure-devops-cfg-form.const';
import { NEXTCLOUD_DECK_CONFIG_FORM_SECTION } from './providers/nextcloud-deck/nextcloud-deck.const';

export const DELAY_BEFORE_ISSUE_POLLING = 8000;

export const GITLAB_TYPE: IssueProviderKey = 'GITLAB';
export const GITHUB_TYPE: IssueProviderKey = 'GITHUB';
export const JIRA_TYPE: IssueProviderKey = 'JIRA';
export const CALDAV_TYPE: IssueProviderKey = 'CALDAV';
export const OPEN_PROJECT_TYPE: IssueProviderKey = 'OPEN_PROJECT';
export const GITEA_TYPE: IssueProviderKey = 'GITEA';
export const REDMINE_TYPE: IssueProviderKey = 'REDMINE';
export const ICAL_TYPE: IssueProviderKey = 'ICAL';
export const TRELLO_TYPE: IssueProviderKey = 'TRELLO';
export const LINEAR_TYPE: IssueProviderKey = 'LINEAR';
export const CLICKUP_TYPE: IssueProviderKey = 'CLICKUP';
export const AZURE_DEVOPS_TYPE: IssueProviderKey = 'AZURE_DEVOPS';
export const NEXTCLOUD_DECK_TYPE: IssueProviderKey = 'NEXTCLOUD_DECK';

export const ISSUE_PROVIDER_TYPES: IssueProviderKey[] = [
  GITLAB_TYPE,
  GITHUB_TYPE,
  JIRA_TYPE,
  CALDAV_TYPE,
  ICAL_TYPE,
  OPEN_PROJECT_TYPE,
  GITEA_TYPE,
  TRELLO_TYPE,
  REDMINE_TYPE,
  LINEAR_TYPE,
  CLICKUP_TYPE,
  AZURE_DEVOPS_TYPE,
  NEXTCLOUD_DECK_TYPE,
] as const;

export const ISSUE_PROVIDER_ICON_MAP = {
  [JIRA_TYPE]: 'jira',
  [GITHUB_TYPE]: 'github',
  [GITLAB_TYPE]: 'gitlab',
  [CALDAV_TYPE]: 'caldav',
  [ICAL_TYPE]: 'calendar',
  [OPEN_PROJECT_TYPE]: 'open_project',
  [GITEA_TYPE]: 'gitea',
  [TRELLO_TYPE]: 'trello',
  [REDMINE_TYPE]: 'redmine',
  [LINEAR_TYPE]: 'linear',
  [CLICKUP_TYPE]: 'clickup',
  [AZURE_DEVOPS_TYPE]: 'azure_devops',
  [NEXTCLOUD_DECK_TYPE]: 'nextcloud_deck',
} as const;

export const ISSUE_PROVIDER_HUMANIZED = {
  [JIRA_TYPE]: 'Jira',
  [GITHUB_TYPE]: 'GitHub',
  [GITLAB_TYPE]: 'GitLab',
  [CALDAV_TYPE]: 'CalDAV',
  [ICAL_TYPE]: 'Calendar',
  [OPEN_PROJECT_TYPE]: 'OpenProject',
  [GITEA_TYPE]: 'Gitea',
  [TRELLO_TYPE]: 'Trello',
  [REDMINE_TYPE]: 'Redmine',
  [LINEAR_TYPE]: 'Linear',
  [CLICKUP_TYPE]: 'ClickUp',
  [AZURE_DEVOPS_TYPE]: 'Azure DevOps',
  [NEXTCLOUD_DECK_TYPE]: 'Nextcloud Deck',
} as const;

export const DEFAULT_ISSUE_PROVIDER_CFGS = {
  [JIRA_TYPE]: DEFAULT_JIRA_CFG,
  [GITHUB_TYPE]: DEFAULT_GITHUB_CFG,
  [GITLAB_TYPE]: DEFAULT_GITLAB_CFG,
  [CALDAV_TYPE]: DEFAULT_CALDAV_CFG,
  [ICAL_TYPE]: DEFAULT_CALENDAR_CFG,
  [OPEN_PROJECT_TYPE]: DEFAULT_OPEN_PROJECT_CFG,
  [GITEA_TYPE]: DEFAULT_GITEA_CFG,
  [TRELLO_TYPE]: DEFAULT_TRELLO_CFG,
  [REDMINE_TYPE]: DEFAULT_REDMINE_CFG,
  [LINEAR_TYPE]: DEFAULT_LINEAR_CFG,
  [CLICKUP_TYPE]: DEFAULT_CLICKUP_CFG,
  [AZURE_DEVOPS_TYPE]: AZURE_DEVOPS_INITIAL_CFG,
  [NEXTCLOUD_DECK_TYPE]: DEFAULT_NEXTCLOUD_DECK_CFG,
} as const;

export const ISSUE_PROVIDER_FORM_CFGS_MAP = {
  [JIRA_TYPE]: JIRA_CONFIG_FORM_SECTION,
  [GITHUB_TYPE]: GITHUB_CONFIG_FORM_SECTION,
  [GITLAB_TYPE]: GITLAB_CONFIG_FORM_SECTION,
  [CALDAV_TYPE]: CALDAV_CONFIG_FORM_SECTION,
  [ICAL_TYPE]: CALENDAR_FORM_CFG_NEW as any,
  [OPEN_PROJECT_TYPE]: OPEN_PROJECT_CONFIG_FORM_SECTION,
  [GITEA_TYPE]: GITEA_CONFIG_FORM_SECTION,
  [TRELLO_TYPE]: TRELLO_CONFIG_FORM_SECTION,
  [REDMINE_TYPE]: REDMINE_CONFIG_FORM_SECTION,
  [LINEAR_TYPE]: LINEAR_CONFIG_FORM_SECTION,
  [CLICKUP_TYPE]: CLICKUP_CONFIG_FORM_SECTION,
  [AZURE_DEVOPS_TYPE]: AZURE_DEVOPS_CONFIG_FORM_SECTION,
  [NEXTCLOUD_DECK_TYPE]: NEXTCLOUD_DECK_CONFIG_FORM_SECTION,
} as const;

const DEFAULT_ISSUE_STRS: { ISSUE_STR: string; ISSUES_STR: string } = {
  ISSUE_STR: T.F.ISSUE.DEFAULT.ISSUE_STR,
  ISSUES_STR: T.F.ISSUE.DEFAULT.ISSUES_STR,
} as const;

export const ISSUE_STR_MAP: { [key: string]: { ISSUE_STR: string; ISSUES_STR: string } } =
  {
    [JIRA_TYPE]: DEFAULT_ISSUE_STRS,
    [GITHUB_TYPE]: DEFAULT_ISSUE_STRS,
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
    [GITEA_TYPE]: DEFAULT_ISSUE_STRS,
    [TRELLO_TYPE]: DEFAULT_ISSUE_STRS,
    [REDMINE_TYPE]: DEFAULT_ISSUE_STRS,
    [LINEAR_TYPE]: DEFAULT_ISSUE_STRS,
    [CLICKUP_TYPE]: DEFAULT_ISSUE_STRS,
    [AZURE_DEVOPS_TYPE]: DEFAULT_ISSUE_STRS,
    [NEXTCLOUD_DECK_TYPE]: DEFAULT_ISSUE_STRS,
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
} as const;
