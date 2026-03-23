import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { AzureDevOpsApiService } from './azure-devops-api.service';
import {
  AzureDevOpsIssue,
  AzureDevOpsIssueReduced,
} from './azure-devops-issue/azure-devops-issue.model';
import { AzureDevOpsCfg } from './azure-devops.model';
import { IssueData, SearchResultItem } from '../../issue.model';
import { Task } from '../../../tasks/task.model';

@Injectable({
  providedIn: 'root',
})
export class AzureDevOpsCommonInterfacesService extends BaseIssueProviderService<AzureDevOpsCfg> {
  private _azureDevOpsApiService = inject(AzureDevOpsApiService);

  readonly providerKey = 'AZURE_DEVOPS' as const;
  readonly pollInterval = 60000;

  isEnabled(cfg: AzureDevOpsCfg): boolean {
    return cfg && cfg.isEnabled;
  }

  testConnection(cfg: AzureDevOpsCfg): Promise<boolean> {
    return firstValueFrom(
      this._azureDevOpsApiService.getCurrentUser$(cfg).pipe(
        map((res) => !!res),
        catchError(() => of(false)),
      ),
    ).then((res) => (res !== undefined ? res : false));
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    return this.getById(issueId, issueProviderId).then(
      (i) => (i as AzureDevOpsIssue)?.url || '',
    );
  }

  getAddTaskData(issue: AzureDevOpsIssueReduced): Partial<Task> & { title: string } {
    return {
      title: issue.summary,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
      dueWithTime: issue.due ? new Date(issue.due).getTime() : null,
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<AzureDevOpsIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId)).then((res) => {
      if (!res) {
        throw new Error('Azure DevOps Config not found');
      }
      return res;
    });
    return firstValueFrom(
      this._azureDevOpsApiService.getNewIssuesToAddToBacklog$(cfg),
    ).then((issues) => {
      return (issues ?? []).filter(
        (issue) => !(allExistingIssueIds as (string | number)[]).includes(issue.id),
      );
    });
  }

  protected _apiGetById$(
    id: string | number,
    cfg: AzureDevOpsCfg,
  ): Observable<IssueData | null> {
    return this._azureDevOpsApiService.getIssueById$(id.toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: AzureDevOpsCfg,
  ): Observable<SearchResultItem[]> {
    return this._azureDevOpsApiService.searchIssues$(searchTerm, cfg).pipe(
      map((issues) =>
        (issues ?? []).map((issue) => ({
          title: issue.summary,
          issueType: 'AZURE_DEVOPS' as const,
          issueData: issue,
        })),
      ),
    );
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as AzureDevOpsIssue).summary;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as AzureDevOpsIssue).updated).getTime();
  }
}
