import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { first, map, switchMap, tap } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { JiraApiService } from './jira-api.service';
import { JiraIssue, JiraIssueReduced } from './jira-issue.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { mapJiraAttachmentToAttachment } from './jira-issue-map.util';
import { JiraCfg } from './jira.model';
import { isJiraEnabled } from './is-jira-enabled.util';
import { JIRA_POLL_INTERVAL } from './jira.const';
import { assertTruthy } from '../../../../util/assert-truthy';
import { IssueLog } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class JiraCommonInterfacesService extends BaseIssueProviderService<JiraCfg> {
  private readonly _jiraApiService = inject(JiraApiService);

  readonly providerKey = 'JIRA' as const;
  readonly pollInterval: number = JIRA_POLL_INTERVAL;

  isEnabled(cfg: JiraCfg): boolean {
    return isJiraEnabled(cfg);
  }

  testConnection(cfg: JiraCfg): Promise<boolean> {
    return firstValueFrom(
      this._jiraApiService.issuePicker$('', cfg).pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    if (!issueId || !issueProviderId) {
      throw new Error('No issueId or no issueProviderId');
    }
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        first(),
        map((jiraCfg) => jiraCfg.host + '/browse/' + issueId),
      ),
    ).then((result) => result ?? '');
  }

  // Override getById to use assertTruthy and Jira-specific API
  override getById(
    issueId: string | number,
    issueProviderId: string,
  ): Promise<JiraIssue> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((jiraCfg) =>
          this._jiraApiService.getIssueById$(assertTruthy(issueId).toString(), jiraCfg),
        ),
      ),
    ).then((result) => {
      if (!result) {
        throw new Error('Failed to get Jira issue');
      }
      return result;
    });
  }

  getAddTaskData(issue: JiraIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.key} ${issue.summary}`,
      issuePoints: issue.storyPoints,
      issueAttachmentNr: issue.attachments ? issue.attachments.length : 0,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<JiraIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._jiraApiService.findAutoImportIssues$(cfg));
  }

  getMappedAttachments(issueData: JiraIssue): TaskAttachment[] {
    return issueData?.attachments?.length
      ? issueData.attachments.map(mapJiraAttachmentToAttachment)
      : [];
  }

  protected _apiGetById$(
    id: string | number,
    cfg: JiraCfg,
  ): Observable<IssueData | null> {
    return this._jiraApiService.getIssueById$(assertTruthy(id).toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: JiraCfg,
  ): Observable<SearchResultItem[]> {
    return this._jiraApiService
      .issuePicker$(searchTerm, cfg)
      .pipe(tap((v) => IssueLog.log('jira.issuePicker$', v)));
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as JiraIssue).key;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as JiraIssue).updated).getTime();
  }
}
