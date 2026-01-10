import { JiraIssue, JiraIssueReduced } from './providers/jira/jira-issue.model';
import { JiraCfg } from './providers/jira/jira.model';
import { GithubCfg } from './providers/github/github.model';
import { GithubIssue, GithubIssueReduced } from './providers/github/github-issue.model';
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
import { ClickUpCfg } from './providers/clickup/clickup.model';
import { ClickUpTask, ClickUpTaskReduced } from './providers/clickup/clickup-issue.model';
import { EntityState } from '@ngrx/entity';
import {
  CalendarProviderCfg,
  ICalIssue,
  ICalIssueReduced,
} from './providers/calendar/calendar.model';

export interface BaseIssueProviderCfg {
  isEnabled: boolean;
}

// Trello integration is available alongside other providers
export type IssueProviderKey =
  | 'JIRA'
  | 'GITHUB'
  | 'GITLAB'
  | 'CALDAV'
  | 'ICAL'
  | 'OPEN_PROJECT'
  | 'GITEA'
  | 'TRELLO'
  | 'REDMINE'
  | 'LINEAR'
  | 'CLICKUP';

export type IssueIntegrationCfg =
  | JiraCfg
  | GithubCfg
  | GitlabCfg
  | CaldavCfg
  | CalendarProviderCfg
  | OpenProjectCfg
  | GiteaCfg
  | TrelloCfg
  | RedmineCfg
  | LinearCfg
  | ClickUpCfg;

export enum IssueLocalState {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export interface IssueIntegrationCfgs {
  // should be the same as key IssueProviderKey
  JIRA?: JiraCfg;
  GITHUB?: GithubCfg;
  GITLAB?: GitlabCfg;
  CALDAV?: CaldavCfg;
  CALENDAR?: CalendarProviderCfg;
  OPEN_PROJECT?: OpenProjectCfg;
  TRELLO?: TrelloCfg;
  GITEA?: GiteaCfg;
  REDMINE?: RedmineCfg;
  LINEAR?: LinearCfg;
  CLICKUP?: ClickUpCfg;
}

export type IssueData =
  | JiraIssue
  | GithubIssue
  | GitlabIssue
  | CaldavIssue
  | ICalIssue
  | OpenProjectWorkPackage
  | GiteaIssue
  | RedmineIssue
  | TrelloIssue
  | LinearIssue
  | ClickUpTask;

export type IssueDataReduced =
  | GithubIssueReduced
  | JiraIssueReduced
  | GitlabIssue
  | OpenProjectWorkPackageReduced
  | CaldavIssueReduced
  | ICalIssueReduced
  | GiteaIssue
  | RedmineIssue
  | TrelloIssueReduced
  | LinearIssueReduced
  | ClickUpTaskReduced;

export type IssueDataReducedMap = {
  [K in IssueProviderKey]: K extends 'JIRA'
    ? JiraIssueReduced
    : K extends 'GITHUB'
      ? GithubIssueReduced
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
                      : K extends 'CLICKUP'
                        ? ClickUpTaskReduced
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
}

export interface IssueProviderJira extends IssueProviderBase, JiraCfg {
  issueProviderKey: 'JIRA';
}

export interface IssueProviderGithub extends IssueProviderBase, GithubCfg {
  issueProviderKey: 'GITHUB';
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

export interface IssueProviderClickUp extends IssueProviderBase, ClickUpCfg {
  issueProviderKey: 'CLICKUP';
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
  | IssueProviderClickUp;

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
                    : T extends 'CLICKUP'
                      ? IssueProviderClickUp
                      : never;
