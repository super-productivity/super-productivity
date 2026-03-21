import { JiraIssue, JiraIssueReduced } from './providers/jira/jira-issue.model';
import { JiraCfg } from './providers/jira/jira.model';
import { GitlabCfg } from './providers/gitlab/gitlab.model';
import { GitlabIssue } from './providers/gitlab/gitlab-issue.model';
import { CaldavIssue, CaldavIssueReduced } from './providers/caldav/caldav-issue.model';
import { CaldavCfg } from './providers/caldav/caldav.model';
import { OpenProjectCfg } from './providers/open-project/open-project.model';
import {
  OpenProjectWorkPackage,
  OpenProjectWorkPackageReduced,
} from './providers/open-project/open-project-issue.model';
import { GiteaCfg } from './providers/gitea/gitea.model';
import { GiteaIssue } from './providers/gitea/gitea-issue.model';
import { RedmineCfg } from './providers/redmine/redmine.model';
import { RedmineIssue } from './providers/redmine/redmine-issue.model';
import { TrelloCfg } from './providers/trello/trello.model';
import { TrelloIssue, TrelloIssueReduced } from './providers/trello/trello-issue.model';
import { LinearCfg } from './providers/linear/linear.model';
import { LinearIssue, LinearIssueReduced } from './providers/linear/linear-issue.model';
import { EntityState } from '@ngrx/entity';
import {
  CalendarProviderCfg,
  ICalIssue,
  ICalIssueReduced,
} from './providers/calendar/calendar.model';
import { AzureDevOpsCfg } from './providers/azure-devops/azure-devops.model';
import {
  AzureDevOpsIssue,
  AzureDevOpsIssueReduced,
} from './providers/azure-devops/azure-devops-issue/azure-devops-issue.model';
import { NextcloudDeckCfg } from './providers/nextcloud-deck/nextcloud-deck.model';
import {
  NextcloudDeckIssue,
  NextcloudDeckIssueReduced,
} from './providers/nextcloud-deck/nextcloud-deck-issue.model';
import {
  PluginIssue,
  PluginSearchResult,
} from '../../plugins/issue-provider/plugin-issue-provider.model';

export interface BaseIssueProviderCfg {
  isEnabled: boolean;
}

// Built-in issue provider keys (strict union for type safety)
export type BuiltInIssueProviderKey =
  | 'JIRA'
  | 'GITLAB'
  | 'CALDAV'
  | 'ICAL'
  | 'OPEN_PROJECT'
  | 'GITEA'
  | 'TRELLO'
  | 'REDMINE'
  | 'LINEAR'
  | 'AZURE_DEVOPS'
  | 'NEXTCLOUD_DECK';

// Keys migrated from built-in to plugin — still valid as IssueProviderKey
export type MigratedIssueProviderKey = 'GITHUB' | 'CLICKUP';

// Plugin issue provider keys use a 'plugin:' prefix to avoid collision
export type PluginIssueProviderKey = `plugin:${string}`;

// Combined type — preserves autocomplete for built-in keys
export type IssueProviderKey =
  | BuiltInIssueProviderKey
  | MigratedIssueProviderKey
  | PluginIssueProviderKey;

export const isPluginIssueProvider = (
  key: IssueProviderKey,
): key is PluginIssueProviderKey => {
  return typeof key === 'string' && key.startsWith('plugin:');
};

const BUILT_IN_KEYS: ReadonlySet<string> = new Set<BuiltInIssueProviderKey>([
  'JIRA',
  'GITLAB',
  'CALDAV',
  'ICAL',
  'OPEN_PROJECT',
  'GITEA',
  'TRELLO',
  'REDMINE',
  'LINEAR',
  'AZURE_DEVOPS',
  'NEXTCLOUD_DECK',
]);

const MIGRATED_KEYS: ReadonlySet<string> = new Set<MigratedIssueProviderKey>([
  'GITHUB',
  'CLICKUP',
]);

export const isValidIssueProviderKey = (key: string): key is IssueProviderKey => {
  return BUILT_IN_KEYS.has(key) || MIGRATED_KEYS.has(key) || key.startsWith('plugin:');
};

export type IssueIntegrationCfg =
  | JiraCfg
  | GitlabCfg
  | CaldavCfg
  | CalendarProviderCfg
  | OpenProjectCfg
  | GiteaCfg
  | TrelloCfg
  | RedmineCfg
  | LinearCfg
  | AzureDevOpsCfg
  | NextcloudDeckCfg;

export enum IssueLocalState {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export interface IssueIntegrationCfgs {
  // should be the same as key IssueProviderKey
  JIRA?: JiraCfg;
  GITLAB?: GitlabCfg;
  CALDAV?: CaldavCfg;
  CALENDAR?: CalendarProviderCfg;
  OPEN_PROJECT?: OpenProjectCfg;
  TRELLO?: TrelloCfg;
  GITEA?: GiteaCfg;
  REDMINE?: RedmineCfg;
  LINEAR?: LinearCfg;
  AZURE_DEVOPS?: AzureDevOpsCfg;
  NEXTCLOUD_DECK?: NextcloudDeckCfg;
}

export type IssueData =
  | JiraIssue
  | GitlabIssue
  | CaldavIssue
  | ICalIssue
  | OpenProjectWorkPackage
  | GiteaIssue
  | RedmineIssue
  | TrelloIssue
  | LinearIssue
  | AzureDevOpsIssue
  | NextcloudDeckIssue
  | PluginIssue;

export type IssueDataReduced =
  | JiraIssueReduced
  | GitlabIssue
  | OpenProjectWorkPackageReduced
  | CaldavIssueReduced
  | ICalIssueReduced
  | GiteaIssue
  | RedmineIssue
  | TrelloIssueReduced
  | LinearIssueReduced
  | AzureDevOpsIssueReduced
  | NextcloudDeckIssueReduced
  | PluginSearchResult;

export type IssueDataReducedMap = {
  [K in IssueProviderKey]: K extends 'JIRA'
    ? JiraIssueReduced
    : K extends 'GITLAB'
      ? GitlabIssue
      : K extends 'CALDAV'
        ? CaldavIssueReduced
        : K extends 'ICAL'
          ? ICalIssueReduced
          : K extends 'OPEN_PROJECT'
            ? OpenProjectWorkPackageReduced
            : K extends 'GITEA'
              ? GiteaIssue
              : K extends 'TRELLO'
                ? TrelloIssueReduced
                : K extends 'REDMINE'
                  ? RedmineIssue
                  : K extends 'LINEAR'
                    ? LinearIssueReduced
                    : K extends 'AZURE_DEVOPS'
                      ? AzureDevOpsIssueReduced
                      : K extends 'NEXTCLOUD_DECK'
                        ? NextcloudDeckIssueReduced
                        : K extends MigratedIssueProviderKey
                          ? PluginSearchResult
                          : K extends PluginIssueProviderKey
                            ? PluginSearchResult
                            : never;
};

// TODO: add issue model to the IssueDataReducedMap

export interface SearchResultItem<
  T extends keyof IssueDataReducedMap = keyof IssueDataReducedMap,
> {
  title: string;
  issueType: T;
  issueData: IssueDataReducedMap[T];
  titleHighlighted?: string;
}

export interface SearchResultItemWithProviderId extends SearchResultItem {
  issueProviderId: string;
}

// ISSUE PROVIDER MODEL
// --------------------

export interface IssueProviderState extends EntityState<IssueProvider> {
  ids: string[];
  // additional entities state properties
}

// export type IssueProviderState = EntityState<IssueProvider>;

export interface IssueProviderBase extends BaseIssueProviderCfg {
  id: string;
  isEnabled: boolean;
  issueProviderKey: IssueProviderKey;
  defaultProjectId?: string | null | false;
  pinnedSearch?: string | null;
  // delete at some point in the future
  migratedFromProjectId?: string;
  isAutoPoll?: boolean;
  isAutoAddToBacklog?: boolean;
  isIntegratedAddTaskBar?: boolean;
  defaultTagIds?: string[];
  defaultNote?: string | null;
}

export interface IssueProviderJira extends IssueProviderBase, JiraCfg {
  issueProviderKey: 'JIRA';
}

export interface IssueProviderGithub extends IssueProviderBase {
  issueProviderKey: 'GITHUB';
  pluginId: string;
  pluginConfig: Record<string, unknown>;
}

export interface IssueProviderGitlab extends IssueProviderBase, GitlabCfg {
  issueProviderKey: 'GITLAB';
}

export interface IssueProviderCaldav extends IssueProviderBase, CaldavCfg {
  issueProviderKey: 'CALDAV';
}

export interface IssueProviderOpenProject extends IssueProviderBase, OpenProjectCfg {
  issueProviderKey: 'OPEN_PROJECT';
}

export interface IssueProviderGitea extends IssueProviderBase, GiteaCfg {
  issueProviderKey: 'GITEA';
}

export interface IssueProviderRedmine extends IssueProviderBase, RedmineCfg {
  issueProviderKey: 'REDMINE';
}

export interface IssueProviderCalendar extends IssueProviderBase, CalendarProviderCfg {
  issueProviderKey: 'ICAL';
}

export interface IssueProviderTrello extends IssueProviderBase, TrelloCfg {
  issueProviderKey: 'TRELLO';
}

export interface IssueProviderLinear extends IssueProviderBase, LinearCfg {
  issueProviderKey: 'LINEAR';
}

export interface IssueProviderAzureDevOps extends IssueProviderBase, AzureDevOpsCfg {
  issueProviderKey: 'AZURE_DEVOPS';
}

export interface IssueProviderNextcloudDeck extends IssueProviderBase, NextcloudDeckCfg {
  issueProviderKey: 'NEXTCLOUD_DECK';
}

export interface IssueProviderPluginType extends IssueProviderBase {
  issueProviderKey: PluginIssueProviderKey | MigratedIssueProviderKey;
  pluginId: string;
  pluginConfig: Record<string, unknown>;
}

export type IssueProvider =
  | IssueProviderJira
  | IssueProviderGithub
  | IssueProviderGitlab
  | IssueProviderCaldav
  | IssueProviderCalendar
  | IssueProviderOpenProject
  | IssueProviderGitea
  | IssueProviderRedmine
  | IssueProviderTrello
  | IssueProviderLinear
  | IssueProviderAzureDevOps
  | IssueProviderNextcloudDeck
  | IssueProviderPluginType;

export type IssueProviderTypeMap<T extends IssueProviderKey> = T extends 'JIRA'
  ? IssueProviderJira
  : T extends 'GITHUB'
    ? IssueProviderGithub
    : T extends 'GITLAB'
      ? IssueProviderGitlab
      : T extends 'GITEA'
        ? IssueProviderGitea
        : T extends 'OPEN_PROJECT'
          ? IssueProviderOpenProject
          : T extends 'REDMINE'
            ? IssueProviderRedmine
            : T extends 'CALDAV'
              ? IssueProviderCaldav
              : T extends 'ICAL'
                ? IssueProviderCalendar
                : T extends 'TRELLO'
                  ? IssueProviderTrello
                  : T extends 'LINEAR'
                    ? IssueProviderLinear
                    : T extends 'AZURE_DEVOPS'
                      ? IssueProviderAzureDevOps
                      : T extends 'NEXTCLOUD_DECK'
                        ? IssueProviderNextcloudDeck
                        : T extends PluginIssueProviderKey
                          ? IssueProviderPluginType
                          : T extends MigratedIssueProviderKey
                            ? IssueProviderPluginType
                            : never;
