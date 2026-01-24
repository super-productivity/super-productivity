import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { IssueData, IssueProviderGitlab, SearchResultItem } from '../../issue.model';
import { GitlabCfg } from './gitlab.model';
import { GitlabIssue } from './gitlab-issue.model';
import { truncate } from '../../../../util/truncate';
import { GITLAB_BASE_URL, GITLAB_POLL_INTERVAL } from './gitlab.const';
import { isGitlabEnabled } from './is-gitlab-enabled.util';
import { IssueProviderService } from '../../issue-provider.service';

@Injectable({
  providedIn: 'root',
})
export class GitlabCommonInterfacesService implements IssueServiceInterface {
  private readonly _gitlabApiService = inject(GitlabApiService);
  private readonly _issueProviderService = inject(IssueProviderService);

  pollInterval: number = GITLAB_POLL_INTERVAL;

  isEnabled(cfg: GitlabCfg): boolean {
    return isGitlabEnabled(cfg);
  }

  testConnection(cfg: GitlabCfg): Promise<boolean> {
    return this._gitlabApiService
      .searchIssueInProject$('', cfg)
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        map((cfg) => {
          const project: string | null = cfg.project;

          // Handle case where project is not configured
          if (!project) {
            return '';
          }

          // Extract just the numeric issue ID from formats like 'project/repo#123' or '#123'
          // Note: issueId is intentionally stored as 'project/repo#123' to ensure uniqueness across different projects
          // but for URL construction we only need the numeric part after the '#'
          const cleanIssueId = issueId.toString().replace(/^.*#/, '');

          if (cfg.gitlabBaseUrl) {
            const fixedUrl = cfg.gitlabBaseUrl.match(/.*\/$/)
              ? cfg.gitlabBaseUrl
              : `${cfg.gitlabBaseUrl}/`;
            return `${fixedUrl}${project}/-/issues/${cleanIssueId}`;
          } else {
            return `${GITLAB_BASE_URL}${project}/-/issues/${cleanIssueId}`;
          }
        }),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  getById(issueId: string, issueProviderId: string): Promise<GitlabIssue> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(concatMap((gitlabCfg) => this._gitlabApiService.getById$(issueId, gitlabCfg)))
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get GitLab issue');
        }
        return result;
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((gitlabCfg) =>
          this.isEnabled(gitlabCfg)
            ? this._gitlabApiService.searchIssueInProject$(searchTerm, gitlabCfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: GitlabIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    const issue = await this._gitlabApiService.getById$(task.issueId, cfg).toPromise();

    const issueUpdate: number = new Date(issue.updated_at).getTime();
    const commentsByOthers =
      cfg.filterUsername && cfg.filterUsername.length > 1
        ? issue.comments.filter(
            (comment) => comment.author.username !== cfg.filterUsername,
          )
        : issue.comments;

    const commentUpdates: number[] = commentsByOthers
      .map((comment) => new Date(comment.created_at).getTime())
      .sort();
    const newestCommentUpdate = commentUpdates[commentUpdates.length - 1];

    const wasUpdated =
      (newestCommentUpdate && newestCommentUpdate > (task.issueLastUpdated || 0)) ||
      issueUpdate > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: this._formatIssueTitleForSnack(issue),
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: GitlabIssue }[]> {
    return Promise.all(
      tasks.map((task) =>
        this.getFreshDataForIssueTask(task).then((refreshDataForTask) => ({
          task,
          refreshDataForTask,
        })),
      ),
    ).then((items) => {
      return items
        .filter(({ refreshDataForTask }) => !!refreshDataForTask)
        .map(({ refreshDataForTask, task }) => {
          if (!refreshDataForTask) {
            throw new Error('No refresh data for task js error');
          }
          return {
            task,
            taskChanges: refreshDataForTask.taskChanges,
            issue: refreshDataForTask.issue,
          };
        });
    });
  }

  getAddTaskData(issue: GitlabIssue): Partial<Task> & { title: string } {
    return {
      title: this._formatIssueTitle(issue),
      issuePoints: issue.weight,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
      issueId: issue.id,
      isDone: this._isIssueDone(issue),
      // GitLab returns due_date as YYYY-MM-DD string, use it directly
      // to avoid timezone conversion issues
      dueDay: issue.due_date || undefined,
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<IssueData[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    return await this._gitlabApiService.getProjectIssues$(cfg).toPromise();
  }

  private _formatIssueTitle(issue: GitlabIssue): string {
    return `#${issue.number} ${issue.title}`;
  }

  private _formatIssueTitleForSnack(issue: GitlabIssue): string {
    return `${truncate(this._formatIssueTitle(issue))}`;
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderGitlab> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'GITLAB');
  }

  private _isIssueDone(issue: GitlabIssue): boolean {
    return issue.state === 'closed';
  }
}
