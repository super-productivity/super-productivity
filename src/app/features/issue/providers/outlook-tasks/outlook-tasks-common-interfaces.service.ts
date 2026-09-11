import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { IssueTask, Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { OutlookTasksIssue, OutlookTasksIssueReduced } from './outlook-tasks-issue.model';
import { OutlookTasksClientService } from './outlook-tasks-client.service';
import { OutlookTasksSyncAdapterService } from './outlook-tasks-sync-adapter.service';
import { OutlookTasksCfg } from './outlook-tasks.model';
import { truncate } from '../../../../util/truncate';
import { isOutlookTasksEnabled } from './is-outlook-tasks-enabled.util';
import { OUTLOOK_TASKS_POLL_INTERVAL } from './outlook-tasks.const';
import { IssueLog } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class OutlookTasksCommonInterfacesService extends BaseIssueProviderService<OutlookTasksCfg> {
  private readonly _clientService = inject(OutlookTasksClientService);
  private readonly _syncAdapter = inject(OutlookTasksSyncAdapterService);
  private _cachedCfg?: OutlookTasksCfg;

  readonly providerKey = 'OUTLOOK_TASKS' as const;

  get pollInterval(): number {
    return this._cachedCfg?.pollIntervalMinutes
      ? this._cachedCfg.pollIntervalMinutes * 60 * 1000
      : OUTLOOK_TASKS_POLL_INTERVAL;
  }

  isEnabled(cfg: OutlookTasksCfg): boolean {
    return isOutlookTasksEnabled(cfg);
  }

  protected override _getCfgOnce$(issueProviderId: string): Observable<OutlookTasksCfg> {
    return super._getCfgOnce$(issueProviderId).pipe(
      map((cfg) => ({ ...cfg, issueProviderId })),
      tap((cfg) => {
        this._cachedCfg = cfg;
      }),
    );
  }

  async testConnection(cfg: OutlookTasksCfg): Promise<boolean> {
    try {
      const tasks = await this._clientService.getOpenTasks(cfg);
      return Array.isArray(tasks);
    } catch (err) {
      IssueLog.err('Outlook Tasks testConnection failed', err);
      return false;
    }
  }

  issueLink(_issueId: string | number, _issueProviderId: string): Promise<string> {
    // NOTE: Outlook Tasks API does not expose a stable web URL per task.
    // The Microsoft To Do web app uses internal IDs that are not accessible via Graph API.
    return Promise.resolve('');
  }

  getAddTaskData(issueData: OutlookTasksIssue): IssueTask {
    const startFields: Partial<IssueTask> = issueData.startDateTime?.dateTime
      ? {
          dueWithTime: new Date(issueData.startDateTime.dateTime).getTime(),
          dueDay: null,
        }
      : {};

    const dueFields: Partial<IssueTask> = issueData.dueDateTime?.dateTime
      ? {
          deadlineWithTime: new Date(issueData.dueDateTime.dateTime).getTime(),
          deadlineDay: null,
        }
      : {};

    return {
      title: issueData.title,
      notes: issueData.body?.content || undefined,
      issueLastUpdated: new Date(issueData.lastModifiedDateTime).getTime(),
      ...startFields,
      ...dueFields,
      issueLastSyncedValues: this._syncAdapter.extractSyncValues(
        // OutlookTasksIssue fields are already plain; spread to Record for the adapter.
        { ...issueData } as Record<string, unknown>,
      ),
    };
  }

  override async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: OutlookTasksIssue }[]> {
    if (!tasks || tasks.length === 0) {
      return [];
    }
    const issueProviderId = tasks[0].issueProviderId || '';
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));

    // Fetch all tasks in parallel (Graph API doesn't support batch GET for todo tasks)
    const results = await Promise.all(
      tasks.map(async (task) => {
        try {
          if (!task.issueId) {
            return null;
          }
          const issue = await firstValueFrom(
            this._clientService.getById$(task.issueId, cfg),
          );
          const lastModified = new Date(issue.lastModifiedDateTime).getTime();
          if (lastModified > (task.issueLastUpdated || 0)) {
            // Exclude dueDay/dueWithTime from polling updates (same as getFreshDataForIssueTask)
            const taskData = { ...this.getAddTaskData(issue) };
            delete taskData.dueDay;
            delete taskData.dueWithTime;
            return {
              task,
              taskChanges: {
                ...taskData,
                issueWasUpdated: true,
              },
              issue,
            };
          }
          return null;
        } catch (e) {
          IssueLog.warn(
            'Failed to fetch Outlook task for polling update',
            task.issueId,
            e,
          );
          return null;
        }
      }),
    );

    return results.filter((r) => r !== null) as {
      task: Task;
      taskChanges: Partial<Task>;
      issue: OutlookTasksIssue;
    }[];
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<OutlookTasksIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const tasks = await firstValueFrom(this._clientService.getOpenTasks$(cfg));

    // Outlook task IDs are always strings; normalize to ensure Set.has works.
    const existingIds = new Set(allExistingIssueIds.map(String));
    return tasks.filter((t) => !existingIds.has(t.id));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: OutlookTasksCfg,
  ): Observable<IssueData | null> {
    return this._clientService.getById$(id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: OutlookTasksCfg,
  ): Observable<SearchResultItem[]> {
    return this._clientService.searchOpenTasks$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate((issue as OutlookTasksIssue).title);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    const lastModified = (issue as OutlookTasksIssue).lastModifiedDateTime;
    return lastModified ? new Date(lastModified).getTime() : 0;
  }
}
