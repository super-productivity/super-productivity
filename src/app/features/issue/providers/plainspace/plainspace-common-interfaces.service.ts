import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { PLAINSPACE_POLL_INTERVAL } from './plainspace.const';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceIssue } from './plainspace-issue.model';

@Injectable({
  providedIn: 'root',
})
export class PlainspaceCommonInterfacesService extends BaseIssueProviderService<PlainspaceCfg> {
  private readonly _plainspaceApiService = inject(PlainspaceApiService);

  readonly providerKey = 'PLAINSPACE' as const;
  readonly pollInterval: number = PLAINSPACE_POLL_INTERVAL;

  isEnabled(cfg: PlainspaceCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.spaceId;
  }

  testConnection(cfg: PlainspaceCfg): Promise<boolean> {
    return firstValueFrom(
      this._plainspaceApiService
        .getTasksForSpace$(cfg)
        .pipe(map((res) => Array.isArray(res))),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `${cfg.host}/spaces/${cfg.spaceId}/tasks/${issueId}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(
    issue: PlainspaceIssue,
  ): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: issue.title,
      isDone: issue.isDone,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updatedAt).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return (await firstValueFrom(
      this._plainspaceApiService.getMyAndUnassignedTasks$(cfg),
    )) as IssueDataReduced[];
  }

  protected _apiGetById$(
    id: string | number,
    cfg: PlainspaceCfg,
  ): Observable<IssueData | null> {
    return this._plainspaceApiService.getById$(
      String(id),
      cfg,
    ) as Observable<IssueData | null>;
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: PlainspaceCfg,
  ): Observable<SearchResultItem[]> {
    return this._plainspaceApiService.searchIssues$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as PlainspaceIssue).title;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as PlainspaceIssue).updatedAt).getTime();
  }
}
