import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { Log } from '../../../../core/log';
import { TaskAttachment } from 'src/app/features/tasks/task-attachment/task-attachment.model';
import { getTimestamp } from '../../../../util/get-timestamp';
import { truncate } from '../../../../util/truncate';
import { Task } from '../../../tasks/task.model';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueServiceInterface } from '../../issue-service-interface';
import { SearchResultItem } from '../../issue.model';
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
export class LinearCommonInterfacesService implements IssueServiceInterface {
  private _linearApiService = inject(LinearApiService);
  private _issueProviderService = inject(IssueProviderService);

  pollInterval: number = LINEAR_POLL_INTERVAL;

  isEnabled(cfg: LinearCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.apiKey;
  }

  testConnection(cfg: LinearCfg): Promise<boolean> {
    return this._linearApiService
      .testConnection(cfg)
      .pipe(
        map(() => true),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false)
      .catch((err) => {
        Log.warn('Linear connection test failed', err);
        return false;
      });
  }

  issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        concatMap((cfg) =>
          this._linearApiService.getById$(issueId, cfg).pipe(map((issue) => issue.url)),
        ),
        first(),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  getById(issueId: string, issueProviderId: string): Promise<LinearIssue> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        concatMap((cfg) => this._linearApiService.getById$(issueId, cfg)),
        first(),
      )
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get Linear issue');
        }
        return result;
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._linearApiService.searchIssues$(searchTerm, cfg).pipe(
                map((issues) =>
                  issues.map((issue) => ({
                    title: `${issue.identifier} ${issue.title}`,
                    issueType: 'LINEAR' as const,
                    issueData: issue,
                  })),
                ),
              )
            : of([]),
        ),
        first(),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: LinearIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      throw new Error('No issueProviderId or issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId)
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('No config found');
        }
        return result;
      });

    const issue = await this._linearApiService
      .getById$(task.issueId, cfg)
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Issue not found');
        }
        return result;
      });

    const wasUpdated = getTimestamp(issue.updatedAt) > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(`${issue.identifier} ${issue.title}`),
      };
    }

    return null;
  }

  getMappedAttachments(issue: LinearIssue): TaskAttachment[] {
    return (issue.attachments || []).map(mapLinearAttachmentToTaskAttachment);
  }

  async getFreshDataForIssueTasks(tasks: Task[]): Promise<
    {
      task: Task;
      taskChanges: Partial<Task>;
      issue: LinearIssue;
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
        .filter(({ refreshDataForTask }) => !!refreshDataForTask)
        .map(({ refreshDataForTask, task }) => ({
          task,
          taskChanges: refreshDataForTask!.taskChanges,
          issue: refreshDataForTask!.issue,
        }));
    });
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: (number | string)[],
  ): Promise<LinearIssueReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId)
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('No config found');
        }
        return result;
      });

    const issues = await this._linearApiService
      .searchIssues$('', cfg)
      .pipe(first())
      .toPromise()
      .then((result) => result ?? []);

    return issues.filter((issue) => !allExistingIssueIds.includes(issue.id));
  }

  getAddTaskData(issue: LinearIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.identifier} ${issue.title}`,
      issueWasUpdated: false,
      issueLastUpdated: getTimestamp(issue.updatedAt),
      isDone: isLinearIssueDone(issue),
    };
  }

  private _getCfgOnce$(issueProviderId: string): Observable<LinearCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'LINEAR');
  }
}
