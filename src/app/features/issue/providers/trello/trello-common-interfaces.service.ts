import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { first, switchMap, tap } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { TrelloApiService } from './trello-api.service';
import { TrelloIssue, TrelloIssueReduced } from './trello-issue.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { mapTrelloAttachmentToAttachment } from './trello-issue-map.util';
import { TrelloCfg } from './trello.model';
import { assertTruthy } from '../../../../util/assert-truthy';
import { IssueLog } from '../../../../core/log';
import { TRELLO_POLL_INTERVAL } from './trello.const';

@Injectable({
  providedIn: 'root',
})
export class TrelloCommonInterfacesService extends BaseIssueProviderService<TrelloCfg> {
  private readonly _trelloApiService = inject(TrelloApiService);

  readonly providerKey = 'TRELLO' as const;
  readonly pollInterval: number = TRELLO_POLL_INTERVAL;

  isEnabled(cfg: TrelloCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.apiKey && !!cfg.token && !!cfg.boardId;
  }

  testConnection(cfg: TrelloCfg): Promise<boolean> {
    return firstValueFrom(this._trelloApiService.testConnection$(cfg)).then(
      (result) => result ?? false,
    );
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    if (!issueId || !issueProviderId) {
      throw new Error('No issueId or no issueProviderId');
    }
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        first(),
        switchMap((trelloCfg) =>
          this._trelloApiService.getCardUrl$(issueId.toString(), trelloCfg),
        ),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: TrelloIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.key} ${issue.summary}`,
      issuePoints: issue.storyPoints ?? undefined,
      issueAttachmentNr: issue.attachments ? issue.attachments.length : 0,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<TrelloIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._trelloApiService.findAutoImportIssues$(cfg));
  }

  getMappedAttachments(issueData: TrelloIssue): TaskAttachment[] {
    return issueData?.attachments?.length
      ? issueData.attachments.map(mapTrelloAttachmentToAttachment)
      : [];
  }

  protected _apiGetById$(
    id: string | number,
    cfg: TrelloCfg,
  ): Observable<IssueData | null> {
    return this._trelloApiService.getIssueById$(assertTruthy(id).toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: TrelloCfg,
  ): Observable<SearchResultItem[]> {
    return this._trelloApiService
      .issuePicker$(searchTerm, cfg)
      .pipe(tap((v) => IssueLog.log('trello.issuePicker$', v)));
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as TrelloIssue).summary;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as TrelloIssue).updated).getTime();
  }
}
