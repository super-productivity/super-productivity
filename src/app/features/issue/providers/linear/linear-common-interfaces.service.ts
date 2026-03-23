import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { concatMap, first, map } from 'rxjs/operators';
import { Log } from '../../../../core/log';
import { TaskAttachment } from 'src/app/features/tasks/task-attachment/task-attachment.model';
import { getTimestamp } from '../../../../util/get-timestamp';
import { truncate } from '../../../../util/truncate';
import { Task } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { LinearApiService } from './linear-api.service';
import {
  isLinearIssueDone,
  mapLinearAttachmentToTaskAttachment,
} from './linear-issue-map.util';
import { LinearIssue, LinearIssueReduced } from './linear-issue.model';
import { LINEAR_POLL_INTERVAL } from './linear.const';
import { LinearCfg } from './linear.model';

@Injectable({
  providedIn: 'root',
})
export class LinearCommonInterfacesService extends BaseIssueProviderService<LinearCfg> {
  private _linearApiService = inject(LinearApiService);

  readonly providerKey = 'LINEAR' as const;
  readonly pollInterval: number = LINEAR_POLL_INTERVAL;

  isEnabled(cfg: LinearCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.apiKey;
  }

  testConnection(cfg: LinearCfg): Promise<boolean> {
    return firstValueFrom(
      this._linearApiService.testConnection(cfg).pipe(
        map(() => true),
        first(),
      ),
    )
      .then((result) => result ?? false)
      .catch((err) => {
        Log.warn('Linear connection test failed', err);
        return false;
      });
  }

  // Fetches the issue to get the URL
  override issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        concatMap((cfg) =>
          this._linearApiService.getById$(issueId, cfg).pipe(map((issue) => issue.url)),
        ),
        first(),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: LinearIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.identifier} ${issue.title}`,
      issueWasUpdated: false,
      issueLastUpdated: getTimestamp(issue.updatedAt),
      isDone: isLinearIssueDone(issue),
    };
  }

  getMappedAttachments(issue: LinearIssue): TaskAttachment[] {
    return (issue.attachments || []).map(mapLinearAttachmentToTaskAttachment);
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: (number | string)[],
  ): Promise<LinearIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const issues = await firstValueFrom(this._linearApiService.searchIssues$('', cfg));

    return issues.filter((issue) => !allExistingIssueIds.includes(issue.id));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: LinearCfg,
  ): Observable<IssueData | null> {
    return this._linearApiService.getById$(id.toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: LinearCfg,
  ): Observable<SearchResultItem[]> {
    return this._linearApiService.searchIssues$(searchTerm, cfg).pipe(
      map((issues) =>
        issues.map((issue) => ({
          title: `${issue.identifier} ${issue.title}`,
          issueType: 'LINEAR' as const,
          issueData: issue,
        })),
      ),
    );
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    const linearIssue = issue as LinearIssue;
    return truncate(`${linearIssue.identifier} ${linearIssue.title}`);
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return getTimestamp((issue as LinearIssue).updatedAt);
  }
}
