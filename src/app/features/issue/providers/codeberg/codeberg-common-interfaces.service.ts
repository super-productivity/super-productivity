import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { CODEBERG_POLL_INTERVAL } from './codeberg.const';
import {
  formatCodebergIssueTitle,
  formatCodebergIssueTitleForSnack,
} from './format-codeberg-issue-title.util';
import { CodebergCfg } from './codeberg.model';
import { CodebergApiService } from '../codeberg/codeberg-api.service';
import { CodebergIssue } from './codeberg-issue.model';

@Injectable({
  providedIn: 'root',
})
export class CodebergCommonInterfacesService extends BaseIssueProviderService<CodebergCfg> {
  private readonly _codebergApiService = inject(CodebergApiService);

  readonly providerKey = 'CODEBERG' as const;
  readonly pollInterval: number = CODEBERG_POLL_INTERVAL;

  isEnabled(cfg: CodebergCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.token && !!cfg.repoFullname;
  }

  testConnection(cfg: CodebergCfg): Promise<boolean> {
    return firstValueFrom(
      this._codebergApiService
        .getCurrentRepositoryFor$(cfg)
        .pipe(map((repository) => !!repository && !!repository.full_name)),
    ).then((result) => result ?? false);
  }

  issueLink(issueNumber: string | number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `${cfg.host?.replace(/\/$/, '')}/${cfg.repoFullname}/issues/${issueNumber}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: CodebergIssue): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: formatCodebergIssueTitle(issue),
      issueId: String(issue.number),
      isDone: issue.state === 'closed',
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._codebergApiService.getLast100IssuesFor$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: CodebergCfg,
  ): Observable<IssueData | null> {
    return this._codebergApiService.getById$(id as number, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: CodebergCfg,
  ): Observable<SearchResultItem[]> {
    return this._codebergApiService.searchIssueForRepo$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return formatCodebergIssueTitleForSnack(issue as CodebergIssue);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as CodebergIssue).updated_at).getTime();
  }
}
