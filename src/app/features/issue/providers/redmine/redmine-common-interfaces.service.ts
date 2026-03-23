import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { REDMINE_POLL_INTERVAL } from './redmine.const';
import {
  formatRedmineIssueTitle,
  formatRedmineIssueTitleForSnack,
} from './format-redmine-issue-title.utils';
import { RedmineCfg } from './redmine.model';
import { RedmineApiService } from '../redmine/redmine-api.service';
import { RedmineIssue } from './redmine-issue.model';

@Injectable({
  providedIn: 'root',
})
export class RedmineCommonInterfacesService extends BaseIssueProviderService<RedmineCfg> {
  private readonly _redmineApiService = inject(RedmineApiService);

  readonly providerKey = 'REDMINE' as const;
  readonly pollInterval: number = REDMINE_POLL_INTERVAL;

  isEnabled(cfg: RedmineCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.api_key && !!cfg.projectId;
  }

  testConnection(cfg: RedmineCfg): Promise<boolean> {
    return firstValueFrom(
      this._redmineApiService
        .searchIssuesInProject$('', cfg)
        .pipe(map((res) => Array.isArray(res))),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `${cfg.host}/issues/${issueId}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: RedmineIssue): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: formatRedmineIssueTitle(issue),
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_on).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(
      this._redmineApiService.getLast100IssuesForCurrentRedmineProject$(cfg),
    );
  }

  protected _apiGetById$(
    id: string | number,
    cfg: RedmineCfg,
  ): Observable<IssueData | null> {
    return this._redmineApiService.getById$(id as number, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: RedmineCfg,
  ): Observable<SearchResultItem[]> {
    return this._redmineApiService.searchIssuesInProject$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return formatRedmineIssueTitleForSnack(issue as RedmineIssue);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as RedmineIssue).updated_on).getTime();
  }
}
