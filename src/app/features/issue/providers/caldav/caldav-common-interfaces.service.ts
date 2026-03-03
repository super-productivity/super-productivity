import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { first, map } from 'rxjs/operators';
import { IssueTask, Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { CaldavIssue, CaldavIssueReduced } from './caldav-issue.model';
import { CaldavClientService } from './caldav-client.service';
import { CaldavSyncAdapterService } from './caldav-sync-adapter.service';
import { CaldavCfg } from './caldav.model';
import { truncate } from '../../../../util/truncate';
import { isCaldavEnabled } from './is-caldav-enabled.util';
import { CALDAV_POLL_INTERVAL } from './caldav.const';

@Injectable({
  providedIn: 'root',
})
export class CaldavCommonInterfacesService extends BaseIssueProviderService<CaldavCfg> {
  private readonly _caldavClientService = inject(CaldavClientService);
  private readonly _caldavSyncAdapter = inject(CaldavSyncAdapterService);

  readonly providerKey = 'CALDAV' as const;
  readonly pollInterval: number = CALDAV_POLL_INTERVAL;

  isEnabled(cfg: CaldavCfg): boolean {
    return isCaldavEnabled(cfg);
  }

  testConnection(cfg: CaldavCfg): Promise<boolean> {
    return firstValueFrom(
      this._caldavClientService.searchOpenTasks$('', cfg).pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    ).then((result) => result ?? false);
  }

  issueLink(_issueId: string | number, _issueProviderId: string): Promise<string> {
    return Promise.resolve('');
  }

  getAddTaskData(issueData: CaldavIssue): IssueTask {
    return {
      title: issueData.summary,
      issueLastUpdated: issueData.etag_hash,
      notes: issueData.note,
      dueWithTime: issueData.start,
      related_to: issueData.related_to,
      issueLastSyncedValues: this._caldavSyncAdapter.extractSyncValues(
        issueData as unknown as Record<string, unknown>,
      ),
    };
  }

  // CalDAV uses etag-based comparison, not timestamp
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: CaldavIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await firstValueFrom(
      this._caldavClientService.getById$(task.issueId, cfg),
    );

    const wasUpdated = issue.etag_hash !== task.issueLastUpdated;

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(issue.summary),
      };
    }
    return null;
  }

  // Batch-fetches by IDs for efficiency
  override async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: CaldavIssue }[]> {
    const issueProviderId =
      tasks && tasks[0].issueProviderId ? tasks[0].issueProviderId : '';
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const issues: CaldavIssue[] = await firstValueFrom(
      this._caldavClientService.getByIds$(
        tasks.map((t) => t.id),
        cfg,
      ),
    );
    const issueMap = new Map(issues.map((item) => [item.id, item]));

    return tasks
      .filter(
        (task) =>
          issueMap.has(task.id) &&
          issueMap.get(task.id)?.etag_hash !== task.issueLastUpdated,
      )
      .map((task) => {
        const issue = issueMap.get(task.id) as CaldavIssue;
        return {
          task,
          taskChanges: {
            ...this.getAddTaskData(issue),
            issueWasUpdated: true,
          },
          issue,
        };
      });
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<CaldavIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._caldavClientService.getOpenTasks$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: CaldavCfg,
  ): Observable<IssueData | null> {
    return this._caldavClientService.getById$(id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: CaldavCfg,
  ): Observable<SearchResultItem[]> {
    return this._caldavClientService.searchOpenTasks$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate((issue as CaldavIssue).summary);
  }

  // CalDAV uses etag_hash (string) not a numeric timestamp.
  // Safe: both getFreshDataForIssueTask and getFreshDataForIssueTasks are overridden,
  // which are the only callers of _getIssueLastUpdated.
  protected _getIssueLastUpdated(_issue: IssueData): number {
    return 0;
  }
}
