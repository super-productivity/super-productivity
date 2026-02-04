import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { first, map, switchMap } from 'rxjs/operators';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { IssueServiceInterface } from '../../issue-service-interface';
import {
  IssueData,
  IssueDataReduced,
  IssueProviderRedmine,
  SearchResultItem,
} from '../../issue.model';
import { REDMINE_POLL_INTERVAL } from './redmine.const';
import {
  formatRedmineIssueTitle,
  formatRedmineIssueTitleForSnack,
} from './format-redmine-issue-title.utils';
import { RedmineCfg } from './redmine.model';
import { isRedmineEnabled } from './is-redmine-enabled.util';
import { RedmineApiService } from '../redmine/redmine-api.service';
import { RedmineIssue } from './redmine-issue.model';
import { IssueProviderService } from '../../issue-provider.service';

@Injectable({
  providedIn: 'root',
})
export class RedmineCommonInterfacesService implements IssueServiceInterface {
  private readonly _redmineApiService = inject(RedmineApiService);
  private readonly _issueProviderService = inject(IssueProviderService);

  isEnabled(cfg: RedmineCfg): boolean {
    return isRedmineEnabled(cfg);
  }

  testConnection(cfg: RedmineCfg): Promise<boolean> {
    return this._redmineApiService
      .searchIssuesInProject$('', cfg)
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  pollInterval: number = REDMINE_POLL_INTERVAL;

  issueLink(issueId: number, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(map((cfg) => `${cfg.host}/issues/${issueId}`))
      .toPromise()
      .then((result) => result ?? '');
  }

  getById(id: number, issueProviderId: string): Promise<IssueData> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg: RedmineCfg) =>
          this._redmineApiService.getById$(id as number, cfg),
        ),
      )
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get Redmine issue');
        }
        return result;
      });
  }

  getAddTaskData(issue: RedmineIssue): Partial<Readonly<TaskCopy>> & { title: string } {
    return {
      title: formatRedmineIssueTitle(issue),
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_on).getTime(),
    };
  }

  searchIssues(query: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._redmineApiService.searchIssuesInProject$(query, cfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: RedmineIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) throw new Error('No issueProviderId');
    if (!task.issueId) throw new Error('No issueId');

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    const issue = await this._redmineApiService.getById$(+task.issueId, cfg).toPromise();
    const lastUpdateOn = new Date(issue.updated_on).getTime();
    const wasUpdated = lastUpdateOn > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: formatRedmineIssueTitleForSnack(issue),
      };
    }

    return null;
  }

  async getFreshDataForIssueTasks(tasks: Task[]): Promise<
    {
      task: Readonly<Task>;
      taskChanges: Partial<Readonly<Task>>;
      issue: RedmineIssue;
    }[]
  > {
    return Promise.all(
      tasks.map((task) =>
        this.getFreshDataForIssueTask(task).then((refreshDataForTask) => ({
          task,
          refreshDataForTask,
        })),
      ),
    ).then((items) => {
      return items
        .filter(({ refreshDataForTask, task }) => !!refreshDataForTask)
        .map(({ refreshDataForTask, task }) => {
          if (!refreshDataForTask) throw new Error('No refresh data for task js error');

          return {
            task,
            taskChanges: refreshDataForTask.taskChanges,
            issue: refreshDataForTask.issue,
          };
        });
    });
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();

    return await this._redmineApiService
      .getLast100IssuesForCurrentRedmineProject$(cfg)
      .toPromise();
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderRedmine> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'REDMINE');
  }
}
