import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Task } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { BASECAMP_TYPE } from '../../issue.const';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { BASECAMP_POLL_INTERVAL } from './basecamp.const';
import { BasecampApiService } from './basecamp-api.service';
import { BasecampTodo } from './basecamp-issue.model';
import { BasecampCfg } from './basecamp.model';
import { BasecampSyncAdapterService } from './basecamp-sync-adapter.service';

@Injectable({
  providedIn: 'root',
})
export class BasecampCommonInterfacesService extends BaseIssueProviderService<BasecampCfg> {
  private readonly _basecampApiService = inject(BasecampApiService);
  private readonly _basecampSyncAdapter = inject(BasecampSyncAdapterService);

  readonly providerKey = BASECAMP_TYPE;
  readonly pollInterval: number = BASECAMP_POLL_INTERVAL;

  isEnabled(cfg: BasecampCfg): boolean {
    return (
      !!cfg &&
      cfg.isEnabled &&
      !!cfg.accessToken &&
      cfg.accessToken.length > 0 &&
      !!cfg.accountId &&
      cfg.accountId.length > 0 &&
      !!cfg.bucketId &&
      cfg.bucketId.length > 0 &&
      !!cfg.todolistId &&
      cfg.todolistId.length > 0
    );
  }

  testConnection(cfg: BasecampCfg): Promise<boolean> {
    if (!cfg.todolistId) {
      return Promise.resolve(false);
    }

    return firstValueFrom(
      this._basecampApiService.getTodolist$(cfg.todolistId, cfg).pipe(
        map((result) => !!result),
        catchError(() => of(false)),
      ),
    ).then((result) => result ?? false);
  }

  async issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg.accountId || !cfg.bucketId) {
      return '';
    }
    return `https://3.basecamp.com/${cfg.accountId}/buckets/${cfg.bucketId}/todos/${issueId}`;
  }

  getAddTaskData(issueData: IssueDataReduced): Partial<Task> & { title: string } {
    const issue = issueData as BasecampTodo;
    return {
      title: issue.content,
      issueId: String(issue.id),
      issueType: BASECAMP_TYPE,
      issueWasUpdated: false,
      issueLastUpdated: this._getIssueLastUpdated(issue),
      isDone: issue.completed,
      dueDay: issue.due_on || undefined,
      issueLastSyncedValues: this._basecampSyncAdapter.extractSyncValues(
        issue as unknown as Record<string, unknown>,
      ),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    if (!cfg.todolistId) {
      return [];
    }

    const existingIds = new Set(allExistingIssueIds.map((id) => String(id)));
    const todos = await firstValueFrom(
      this._basecampApiService.listTodos$(cfg.todolistId, cfg),
    );
    return (todos?.items ?? []).filter((todo) => !existingIds.has(String(todo.id)));
  }

  // getFreshDataForIssueTask(s) intentionally use the base implementation:
  // it detects remote updates via _getIssueLastUpdated (updated_at) and excludes
  // dueDay/dueWithTime from polling patches so user-set schedules are not overwritten.

  protected _apiGetById$(
    id: string | number,
    cfg: BasecampCfg,
  ): Observable<IssueData | null> {
    return this._basecampApiService.getTodo$(id.toString(), cfg);
  }

  protected _apiSearchIssues$(
    _searchTerm: string,
    _cfg: BasecampCfg,
  ): Observable<SearchResultItem[]> {
    return of([]);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as BasecampTodo).content;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    const issueData = issue as BasecampTodo;
    const lastUpdated = issueData.updated_at || issueData.created_at;
    return lastUpdated ? new Date(lastUpdated).getTime() : 0;
  }
}
