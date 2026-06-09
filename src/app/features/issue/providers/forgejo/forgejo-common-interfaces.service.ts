import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { FORGEJO_POLL_INTERVAL } from './forgejo.const';
import {
  formatForgejoIssueTitle,
  formatForgejoIssueTitleForSnack,
} from './format-forgejo-issue-title.util';
import { ForgejoCfg } from './forgejo.model';
import { ForgejoApiService } from '../forgejo/forgejo-api.service';
import { ForgejoIssue } from './forgejo-issue.model';

@Injectable({
  providedIn: 'root',
})
export class ForgejoCommonInterfacesService extends BaseIssueProviderService<ForgejoCfg> {
  private readonly _forgejoApiService = inject(ForgejoApiService);

  readonly providerKey = 'FORGEJO' as const;
  readonly pollInterval: number = FORGEJO_POLL_INTERVAL;

  isEnabled(cfg: ForgejoCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.token && !!cfg.repoFullname;
  }

  testConnection(cfg: ForgejoCfg): Promise<boolean> {
    return firstValueFrom(
      this._forgejoApiService
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

  getAddTaskData(issue: ForgejoIssue): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: formatForgejoIssueTitle(issue),
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
    return await firstValueFrom(this._forgejoApiService.getLast100IssuesFor$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: ForgejoCfg,
  ): Observable<IssueData | null> {
    return this._forgejoApiService.getById$(id as number, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: ForgejoCfg,
  ): Observable<SearchResultItem[]> {
    return this._forgejoApiService.searchIssueForRepo$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return formatForgejoIssueTitleForSnack(issue as ForgejoIssue);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as ForgejoIssue).updated_at).getTime();
  }
}
