import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { GithubApiService } from './github-api.service';
import { GithubCfg } from './github.model';
import { GithubIssue, GithubIssueReduced } from './github-issue.model';
import { truncate } from '../../../../util/truncate';
import { getTimestamp } from '../../../../util/get-timestamp';
import { GITHUB_POLL_INTERVAL } from './github.const';
import { GithubSyncAdapterService } from './github-sync-adapter.service';

@Injectable({
  providedIn: 'root',
})
export class GithubCommonInterfacesService extends BaseIssueProviderService<GithubCfg> {
  private readonly _githubApiService = inject(GithubApiService);
  private readonly _githubSyncAdapter = inject(GithubSyncAdapterService);

  readonly providerKey = 'GITHUB' as const;
  readonly pollInterval: number = GITHUB_POLL_INTERVAL;

  isEnabled(cfg: GithubCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.repo;
  }

  testConnection(cfg: GithubCfg): Promise<boolean> {
    return firstValueFrom(
      this._githubApiService
        .searchIssueForRepo$('', cfg)
        .pipe(map((res) => Array.isArray(res))),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: number, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => `https://github.com/${cfg.repo}/issues/${issueId}`),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: GithubIssueReduced): Partial<Task> & { title: string } {
    return {
      title: this._formatIssueTitle(issue.number, issue.title),
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
      isDone: issue.state === 'closed',
      issueLastSyncedValues: this._githubSyncAdapter.extractSyncValues(
        issue as unknown as Record<string, unknown>,
      ),
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<GithubIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(
      this._githubApiService.searchIssueForRepoNoMap$(
        cfg.backlogQuery || 'sort:updated state:open',
        cfg,
      ),
    );
  }

  // Uses comment filtering for update detection
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: GithubIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await firstValueFrom(
      this._githubApiService.getById$(+task.issueId, cfg),
    );

    // NOTE we are not able to filter out user updates to the issue itself by the user
    const filterUserName =
      cfg.filterUsernameForIssueUpdates &&
      cfg.filterUsernameForIssueUpdates.toLowerCase();
    const commentsByOthers =
      filterUserName && filterUserName.length > 1
        ? issue.comments.filter(
            (comment) => comment.user.login.toLowerCase() !== filterUserName,
          )
        : issue.comments;

    const commentUpdates: number[] = commentsByOthers
      .map((comment) => getTimestamp(comment.created_at))
      .sort();
    const newestCommentUpdate = commentUpdates[commentUpdates.length - 1];

    const wasUpdated =
      newestCommentUpdate > (task.issueLastUpdated || 0) ||
      getTimestamp(issue.updated_at) > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(this._formatIssueTitle(issue.number, issue.title)),
      };
    }
    return null;
  }

  protected _apiGetById$(
    id: string | number,
    cfg: GithubCfg,
  ): Observable<IssueData | null> {
    return this._githubApiService.getById$(+id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: GithubCfg,
  ): Observable<SearchResultItem[]> {
    return this._githubApiService.searchIssueForRepo$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    const ghIssue = issue as GithubIssue;
    return truncate(this._formatIssueTitle(ghIssue.number, ghIssue.title));
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as GithubIssue).updated_at).getTime();
  }

  private _formatIssueTitle(id: number, title: string): string {
    return `#${id} ${title}`;
  }
}
