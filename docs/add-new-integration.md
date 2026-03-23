# Adding a New Integration to Super Productivity

This guide explains how to add a new issue tracker integration to Super Productivity.

## Overview

Super Productivity supports multiple issue tracker integrations (called "Issue Providers" in the codebase), including Jira, GitLab, Gitea, Redmine, Open Project, CalDAV, Calendar (iCal), Trello, ClickUp, Linear, Azure DevOps, and Nextcloud Deck. GitHub has been migrated to a plugin-based provider. Adding a new integration requires implementing specific interfaces and services to communicate with the external service.

## Integration Architecture

Each integration follows a consistent pattern:

1. **Interface**: All integrations implement the `IssueServiceInterface`, which defines the required methods for communicating with external services.
2. **Provider-specific Models**: Each integration defines its own data structures.
3. **API Services**: Each integration has an API service that handles HTTP requests.
4. **Common Interfaces Service**: Each integration has a service that implements `IssueServiceInterface`.
5. **Configuration**: Each integration defines its configuration options.

## Step-by-Step Guide

### 1. Create the Provider Directory Structure

Create a new directory under `src/app/features/issue/providers/` for your integration, for example `my-provider/`.

### 2. Create Required Files

Based on existing integrations, you'll need to create:

#### Model Files

- `my-provider.model.ts` - Define your provider's configuration and data structures
- `my-provider-issue.model.ts` - Define issue-specific data structures

Example from GitHub:

```typescript
// github.model.ts
import { BaseIssueProviderCfg } from '../../issue.model';

export interface GithubCfg extends BaseIssueProviderCfg {
  repo: string;
  token?: string;
}
```

#### Service Files

- `my-provider-api.service.ts` - Handle API communication
- `my-provider-common-interfaces.service.ts` - Implement the `IssueServiceInterface`

Example API service structure:

```typescript
@Injectable({
  providedIn: 'root',
})
export class MyProviderApiService {
  // HTTP communication methods
  getById$(issueId: string, cfg: MyProviderCfg): Observable<MyProviderIssue> {
    // Implementation
  }

  searchIssues$(searchTerm: string, cfg: MyProviderCfg): Observable<MyProviderIssue[]> {
    // Implementation
  }
}
```

Example Common Interfaces Service structure:

```typescript
@Injectable({
  providedIn: 'root',
})
export class MyProviderCommonInterfacesService implements IssueServiceInterface {
  // Implement all required methods from IssueServiceInterface

  isEnabled(cfg: MyProviderCfg): boolean {
    // Implementation
  }

  // Other required methods...
}
```

#### Constants File

- `my-provider.const.ts` - Define constants and default configurations

Example:

```typescript
import { ConfigFormSection } from '../../../config/global-config.model';

export const MY_PROVIDER_INITIAL_POLL_DELAY = 5000;
export const MY_PROVIDER_POLL_INTERVAL = 5 * 60 * 1000;

export const DEFAULT_MY_PROVIDER_CFG: MyProviderCfg = {
  isEnabled: false,
  // Other default values
};

export const MY_PROVIDER_CONFIG_FORM_SECTION: ConfigFormSection = {
  // Form configuration
};
```

#### Utility Files

- `is-my-provider-enabled.util.ts` - Helper for checking if the provider is enabled

Example:

```typescript
import { MyProviderCfg } from './my-provider.model';

export const isMyProviderEnabled = (cfg: MyProviderCfg): boolean => {
  return cfg && cfg.isEnabled && // other conditions;
};
```

### 3. Implement the IssueServiceInterface

The key interface methods that must be implemented include:

```typescript
// MANDATORY
isEnabled(cfg: IssueIntegrationCfg): boolean;
testConnection$(cfg: IssueIntegrationCfg): Observable<boolean>;
pollTimer$: Observable<number>;
issueLink$(issueId: string | number, issueProviderId: string): Observable<string>;
getById$(id: string | number, issueProviderId: string): Observable<IssueData | null>;
getAddTaskData(issueData: IssueDataReduced): Partial<Task> & { title: string };
searchIssues$(searchTerm: string, issueProviderId: string): Observable<SearchResultItem[]>;
getFreshDataForIssueTask(task: Task): Promise<{ taskChanges: Partial<Task>; issue: IssueData; issueTitle: string; } | null>;
getFreshDataForIssueTasks(tasks: Task[]): Promise<{ task: Task; taskChanges: Partial<Task>; issue: IssueData; }[]>;

// OPTIONAL
getMappedAttachments?(issueData: IssueData): TaskAttachment[];
getNewIssuesToAddToBacklog?(issueProviderId: string, allExistingIssueIds: number[] | string[]): Promise<IssueDataReduced[]>;
```

### 4. Update Core Files

You'll need to update several core files to register your new integration:

#### 1. Update `issue.model.ts`

Add your provider to the `BuiltInIssueProviderKey` type:

```typescript
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
  | 'CLICKUP'
  | 'AZURE_DEVOPS'
  | 'NEXTCLOUD_DECK'
  | 'MY_PROVIDER'; // Add your provider here
```

Add your provider configuration to `IssueIntegrationCfg`:

```typescript
export type IssueIntegrationCfg =
  | JiraCfg
  | GithubCfg
  | GitlabCfg
  | CaldavCfg
  | CalendarProviderCfg
  | OpenProjectCfg
  | GiteaCfg
  | RedmineCfg
  | MyProviderCfg; // Add your provider here
```

Update `IssueIntegrationCfgs` interface:

```typescript
export interface IssueIntegrationCfgs {
  // should be the same as key IssueProviderKey
  JIRA?: JiraCfg;
  GITHUB?: GithubCfg;
  GITLAB?: GitlabCfg;
  CALDAV?: CaldavCfg;
  CALENDAR?: CalendarProviderCfg;
  OPEN_PROJECT?: OpenProjectCfg;
  GITEA?: GiteaCfg;
  REDMINE?: RedmineCfg;
  MY_PROVIDER?: MyProviderCfg; // Add your provider here
}
```

Update `IssueProvider` type:

```typescript
export type IssueProvider =
  | IssueProviderJira
  | IssueProviderGithub
  | IssueProviderGitlab
  | IssueProviderCaldav
  | IssueProviderCalendar
  | IssueProviderOpenProject
  | IssueProviderGitea
  | IssueProviderRedmine
  | IssueProviderMyProvider; // Add your provider here
```

#### 2. Update `issue.const.ts`

Add your provider type constant:

```typescript
export const MY_PROVIDER_TYPE: IssueProviderKey = 'MY_PROVIDER';
```

Add your provider to `ISSUE_PROVIDER_TYPES`:

```typescript
export const ISSUE_PROVIDER_TYPES: BuiltInIssueProviderKey[] = [
  GITLAB_TYPE,
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
  MY_PROVIDER_TYPE, // Add your provider here
];
```

Update `DEFAULT_ISSUE_PROVIDER_CFGS`:

```typescript
export const DEFAULT_ISSUE_PROVIDER_CFGS: IssueIntegrationCfgs = {
  JIRA: DEFAULT_JIRA_CFG,
  GITHUB: DEFAULT_GITHUB_CFG,
  GITLAB: DEFAULT_GITLAB_CFG,
  CALDAV: DEFAULT_CALDAV_CFG,
  CALENDAR: DEFAULT_CALENDAR_CFG,
  OPEN_PROJECT: DEFAULT_OPEN_PROJECT_CFG,
  GITEA: DEFAULT_GITEA_CFG,
  REDMINE: DEFAULT_REDMINE_CFG,
  MY_PROVIDER: DEFAULT_MY_PROVIDER_CFG, // Add your provider here
};
```

Update `ISSUE_PROVIDER_FORM_CFGS_MAP`:

```typescript
export const ISSUE_PROVIDER_FORM_CFGS_MAP: Record<IssueProviderKey, ConfigFormSection> = {
  JIRA: JIRA_CONFIG_FORM_SECTION,
  GITHUB: GITHUB_CONFIG_FORM_SECTION,
  GITLAB: GITLAB_CONFIG_FORM_SECTION,
  CALDAV: CALDAV_CONFIG_FORM_SECTION,
  CALENDAR: CALENDAR_FORM_CFG_NEW,
  OPEN_PROJECT: OPEN_PROJECT_CONFIG_FORM_SECTION,
  GITEA: GITEA_CONFIG_FORM_SECTION,
  REDMINE: REDMINE_CONFIG_FORM_SECTION,
  MY_PROVIDER: MY_PROVIDER_CONFIG_FORM_SECTION, // Add your provider here
};
```

### 5. Create UI Components (Optional)

Depending on your integration, you may need to create UI components:

- Issue display and content components in `my-provider/my-provider-issue-content/` directory
- Header components in `my-provider/my-provider-issue-header/` directory
- Configuration components if needed

### 6. Register the Provider in the Issue Service

The `IssueService` uses a provider factory pattern. Ensure your provider service is properly injected and registered.

## Testing Your Integration

1. Run the app with `npm run startFrontend`
2. Navigate to the settings page
3. Add a new integration of your provider type
4. Test the connection and functionality

## Tips and Best Practices

1. **Study Existing Integrations**: Use GitHub or GitLab integrations as reference implementations
2. **Error Handling**: Implement robust error handling for API failures
3. **Polling**: Consider rate limits when implementing polling
4. **Authentication**: Securely handle authentication tokens
5. **User Experience**: Make configuration and usage as simple as possible

## Troubleshooting

- Check browser console for errors
- Verify correct implementation of the `IssueServiceInterface`
- Ensure all model types are correctly defined
- Verify correct registration in all required files

## Contributing Back

Once your integration is working, please consider submitting it back to the Super Productivity project as a pull request!
