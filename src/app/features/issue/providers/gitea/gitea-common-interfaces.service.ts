import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { GITEA_POLL_INTERVAL } from './gitea.const';
import {
  formatGiteaIssueTitle,
  formatGiteaIssueTitleForSnack,
} from './format-gitea-issue-title.util';
import { GiteaCfg } from './gitea.model';
import { GiteaApiService } from '../gitea/gitea-api.service';
import { GiteaIssue } from './gitea-issue.model';

@Injectable({
  providedIn: 'root',
})
export class GiteaCommonInterfacesService extends BaseIssueProviderService<GiteaCfg> {
  private readonly _giteaApiService = inject(GiteaApiService);

  readonly providerKey = 'GITEA' as const;
  readonly pollInterval: number = GITEA_POLL_INTERVAL;

  isEnabled(cfg: GiteaCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.token && !!cfg.repoFullname;
  }

  testConnection(cfg: GiteaCfg): Promise<boolean> {
    return firstValueFrom(
      this._giteaApiService
        .searchIssueForRepo$('', cfg)
        .pipe(map((res) => Array.isArray(res))),
    ).then((result) => result ?? false);
  }

  issueLink(issueNumber: string | number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `${cfg.host}/${cfg.repoFullname}/issues/${issueNumber}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: GiteaIssue): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: formatGiteaIssueTitle(issue),
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._giteaApiService.getLast100IssuesFor$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: GiteaCfg,
  ): Observable<IssueData | null> {
    return this._giteaApiService.getById$(id as number, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: GiteaCfg,
  ): Observable<SearchResultItem[]> {
    return this._giteaApiService.searchIssueForRepo$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return formatGiteaIssueTitleForSnack(issue as GiteaIssue);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as GiteaIssue).updated_at).getTime();
  }
}
