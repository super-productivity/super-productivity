import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IssueData,
  IssueDataReduced,
  IssueIntegrationCfg,
  IssueProviderPluginType,
  SearchResultItem,
} from '../../features/issue/issue.model';
import { PluginIssue } from './plugin-issue-provider.model';
import { IssueServiceInterface } from '../../features/issue/issue-service-interface';
import { IssueTask, Task } from '../../features/tasks/task.model';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import { PluginHttp, RegisteredPluginIssueProvider } from './plugin-issue-provider.model';
import { selectIssueProviderById } from '../../features/issue/store/issue-provider.selectors';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { TaskService } from '../../features/tasks/task.service';
import { getDbDateStr } from '../../util/get-db-date-str';
import { T } from '../../t.const';

@Injectable({ providedIn: 'root' })
export class PluginIssueProviderAdapterService implements IssueServiceInterface {
  private _registry = inject(PluginIssueProviderRegistryService);
  private _pluginHttp = inject(PluginHttpService);
  private _store = inject(Store);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);

  // Not meaningful for a multi-plugin adapter, but required by interface
  pollInterval = 0;

  isEnabled(): boolean {
    return true;
  }

  async testConnection(cfg: IssueIntegrationCfg): Promise<boolean> {
    const pluginCfg = this._asPluginCfg(cfg);
    if (!pluginCfg) {
      return false;
    }
    const resolved = this._resolve(pluginCfg);
    if (!resolved) {
      return false;
    }
    const { provider, http } = resolved;
    if (!provider.definition.testConnection) {
      return true;
    }
    try {
      return await provider.definition.testConnection(pluginCfg.pluginConfig, http);
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] testConnection failed for ${pluginCfg.issueProviderKey}:`,
        e,
      );
      return false;
    }
  }

  async issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return '';
    }
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    if (!provider) {
      return '';
    }
    try {
      return await provider.definition.getIssueLink(String(issueId), cfg.pluginConfig);
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getIssueLink failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return '';
    }
  }

  async getById(id: string | number, issueProviderId: string): Promise<IssueData | null> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return null;
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return null;
    }
    try {
      return await resolved.provider.definition.getById(
        String(id),
        cfg.pluginConfig,
        resolved.http,
      );
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getById failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return null;
    }
  }

  getAddTaskData(issueData: IssueDataReduced): IssueTask {
    return this._buildBaseIssueTask(issueData as PluginIssue);
  }

  async searchIssues(
    searchTerm: string,
    issueProviderId: string,
  ): Promise<SearchResultItem[]> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return [];
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return [];
    }
    try {
      const results = await resolved.provider.definition.searchIssues(
        searchTerm,
        cfg.pluginConfig,
        resolved.http,
      );
      return results.map((r) => ({
        title: r.title,
        issueType: cfg.issueProviderKey,
        issueData: r,
      })) as SearchResultItem[];
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] searchIssues failed for ${cfg.issueProviderKey}:`,
        e,
      );
      this._snackService.open({
        type: 'ERROR',
        msg: `Search failed for ${resolved.provider.name}`,
      });
      return [];
    }
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: IssueData;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      return null;
    }
    const cfg = await this._getCfg(task.issueProviderId);
    if (!cfg) {
      return null;
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return null;
    }
    try {
      const issue = await resolved.provider.definition.getById(
        task.issueId,
        cfg.pluginConfig,
        resolved.http,
      );
      if (!issue) {
        return null;
      }

      // Check if the issue state indicates remote deletion
      const deletedStates = resolved.provider.definition.deletedStates;
      if (deletedStates?.length && issue.state) {
        const stateLower = issue.state.toLowerCase();
        if (deletedStates.some((s) => s.toLowerCase() === stateLower)) {
          this._handleRemoteDeletion(task);
          return null;
        }
      }

      const isUpdated =
        issue.lastUpdated != null && issue.lastUpdated > (task.issueLastUpdated || 0);
      if (isUpdated) {
        // Compute sync values once and pass through to avoid redundant calls
        const issueLastSyncedValues =
          resolved.provider.definition.extractSyncValues?.(issue);
        const addTaskData = this._getAddTaskDataForProvider(
          issue,
          resolved.provider,
          issueLastSyncedValues ?? {},
        );

        // Apply field mappings to pull changes from issue to task
        const fieldChanges = this._applyFieldMappingPull(
          resolved.provider,
          issueLastSyncedValues ?? {},
          task,
          cfg,
        );

        return {
          taskChanges: {
            ...addTaskData,
            ...fieldChanges,
            issueWasUpdated: true,
            ...(issueLastSyncedValues ? { issueLastSyncedValues } : {}),
          },
          issue,
          issueTitle: issue.title,
        };
      }
      return null;
    } catch (e) {
      // Detect 404 = issue deleted remotely
      if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 410)) {
        this._handleRemoteDeletion(task);
        return null;
      }
      console.error(
        `[PluginIssueAdapter] getFreshDataForIssueTask failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return null;
    }
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: IssueData }[]> {
    const results: { task: Task; taskChanges: Partial<Task>; issue: IssueData }[] = [];
    for (const task of tasks) {
      const result = await this.getFreshDataForIssueTask(task);
      if (result) {
        results.push({ task, taskChanges: result.taskChanges, issue: result.issue });
      }
    }
    return results;
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: string[] | number[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return [];
    }
    const resolved = this._resolve(cfg);
    if (!resolved || !resolved.provider.definition.getNewIssuesForBacklog) {
      return [];
    }
    try {
      const results = await resolved.provider.definition.getNewIssuesForBacklog(
        cfg.pluginConfig,
        resolved.http,
      );
      const existingIds = new Set(allExistingIssueIds.map(String));
      return results.filter((r) => !existingIds.has(r.id));
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getNewIssuesToAddToBacklog failed for ${cfg.issueProviderKey}:`,
        e,
      );
      this._snackService.open({
        type: 'ERROR',
        msg: `Backlog import failed for ${resolved.provider.name}`,
      });
      return [];
    }
  }

  // --- Private helpers ---

  private _asPluginCfg(cfg: IssueIntegrationCfg): IssueProviderPluginType | undefined {
    const candidate = cfg as unknown as Record<string, unknown>;
    if (
      typeof candidate['pluginId'] !== 'string' ||
      typeof candidate['issueProviderKey'] !== 'string' ||
      typeof candidate['pluginConfig'] !== 'object' ||
      candidate['pluginConfig'] === null
    ) {
      return undefined;
    }
    return cfg as unknown as IssueProviderPluginType;
  }

  private _resolve(cfg: IssueProviderPluginType):
    | {
        provider: RegisteredPluginIssueProvider;
        http: PluginHttp;
      }
    | undefined {
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    if (!provider) {
      return undefined;
    }
    const http = this._pluginHttp.createHttpHelper(
      () => provider.definition.getHeaders(cfg.pluginConfig),
      { allowPrivateNetwork: provider.allowPrivateNetwork },
    );
    return { provider, http };
  }

  private async _getCfg(
    issueProviderId: string,
  ): Promise<IssueProviderPluginType | undefined> {
    try {
      const provider = await firstValueFrom(
        this._store.select(selectIssueProviderById(issueProviderId, null)),
      );
      if (!provider || !this._registry.hasProvider(provider.issueProviderKey)) {
        return undefined;
      }
      return provider as IssueProviderPluginType | undefined;
    } catch {
      return undefined;
    }
  }

  private _extractTaskFieldsFromIssueWithSyncValues(
    issue: PluginIssue,
    provider: RegisteredPluginIssueProvider,
    syncValues: Record<string, unknown>,
  ): Record<string, unknown> {
    const issueRecord = issue as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const ctx = { issueId: issue.id };

    const mappings = provider.definition.fieldMappings;
    if (!mappings?.length) {
      return {};
    }
    for (const mapping of mappings) {
      const issueValue =
        syncValues[mapping.issueField] ?? issueRecord[mapping.issueField];
      if (issueValue == null) {
        continue;
      }
      const taskValue = mapping.toTaskValue(issueValue, ctx);
      if (taskValue != null) {
        result[mapping.taskField] = taskValue;
      }
    }
    return result;
  }

  private _getAddTaskDataForProvider(
    issueData: IssueDataReduced,
    provider: RegisteredPluginIssueProvider,
    syncValues: Record<string, unknown>,
  ): IssueTask {
    const data = issueData as PluginIssue;
    const base = this._buildBaseIssueTask(data);
    const fieldValues = this._extractTaskFieldsFromIssueWithSyncValues(
      data,
      provider,
      syncValues,
    );
    return { ...base, ...fieldValues } as IssueTask;
  }

  private _buildBaseIssueTask(data: PluginIssue): IssueTask {
    const isDone = this._computeIsDone(data);
    const raw = data as Record<string, unknown>;
    const dueWithTime =
      typeof raw['dueWithTime'] === 'number' ? (raw['dueWithTime'] as number) : undefined;
    const startMs =
      typeof raw['start'] === 'number' ? (raw['start'] as number) : undefined;

    return {
      title: data.title,
      issueId: data.id,
      issueWasUpdated: false,
      issueLastUpdated: data.lastUpdated ?? 0,
      issueAttachmentNr: 0,
      issuePoints: undefined,
      issueTimeTracked: undefined,
      isDone,
      ...(dueWithTime != null
        ? { dueWithTime }
        : startMs != null
          ? { dueDay: getDbDateStr(startMs) }
          : {}),
    };
  }

  private _computeIsDone(issue: PluginIssue): boolean {
    const state = issue.state?.toLowerCase();
    if (!state) {
      return false;
    }
    return ['closed', 'done', 'completed', 'resolved'].includes(state);
  }

  private _handleRemoteDeletion(task: Task): void {
    const hasTimeTracking = task.timeSpent > 0;
    if (hasTimeTracking) {
      this._snackService.open({
        type: 'WARNING',
        msg: T.F.ISSUE.S.REMOTE_ISSUE_DELETED_WITH_TIME,
        translateParams: { taskTitle: task.title },
        ico: 'delete_forever',
        actionStr: T.G.DELETE,
        actionFn: () => this._taskService.removeMultipleTasks([task.id]),
      });
    } else {
      this._taskService.removeMultipleTasks([task.id]);
      this._snackService.open({
        type: 'CUSTOM',
        msg: T.F.ISSUE.S.REMOTE_ISSUE_DELETED,
        translateParams: { taskTitle: task.title },
        ico: 'delete_forever',
      });
    }
  }

  private _applyFieldMappingPull(
    provider: RegisteredPluginIssueProvider,
    freshSyncValues: Record<string, unknown>,
    task: Task,
    cfg: IssueProviderPluginType,
  ): Partial<Task> {
    const fieldMappings = provider.definition.fieldMappings;
    if (!fieldMappings?.length) {
      return {};
    }

    const twoWaySync = (cfg.pluginConfig?.['twoWaySync'] as Record<string, string>) ?? {};
    const lastSyncedValues = task.issueLastSyncedValues ?? {};
    const ctx = { issueId: task.issueId! };
    const changes: Record<string, unknown> = {};

    for (const mapping of fieldMappings) {
      const dir = twoWaySync[mapping.taskField] ?? mapping.defaultDirection;
      if (dir !== 'pullOnly' && dir !== 'both') {
        continue;
      }

      const freshValue = freshSyncValues[mapping.issueField];
      const lastValue = lastSyncedValues[mapping.issueField];

      // Only pull if the issue value actually changed since last sync
      if (freshValue === lastValue) {
        continue;
      }

      const taskValue = mapping.toTaskValue(freshValue, ctx);
      if (taskValue !== undefined) {
        changes[mapping.taskField] = taskValue;
        // Clear mutually exclusive fields (use null to explicitly unset)
        if (mapping.mutuallyExclusive) {
          for (const field of mapping.mutuallyExclusive) {
            changes[field] = null;
          }
        }
      }
    }

    return changes as Partial<Task>;
  }
}
