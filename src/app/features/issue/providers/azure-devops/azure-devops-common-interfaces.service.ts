import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { AzureDevOpsApiService } from './azure-devops-api.service';
import {
  AzureDevOpsIssue,
  AzureDevOpsIssueReduced,
} from './azure-devops-issue/azure-devops-issue.model';
import { AzureDevOpsCfg } from './azure-devops.model';
import { IssueProviderService } from '../../issue-provider.service';
import { SearchResultItem } from '../../issue.model';
import { Task } from '../../../tasks/task.model';

@Injectable({
  providedIn: 'root',
})
export class AzureDevOpsCommonInterfacesService implements IssueServiceInterface {
  pollInterval = 60000;

  private _azureDevOpsApiService = inject(AzureDevOpsApiService);
  private _issueProviderService = inject(IssueProviderService);

  isEnabled(cfg: AzureDevOpsCfg): boolean {
    return cfg && cfg.isEnabled;
  }

  testConnection(cfg: AzureDevOpsCfg): Promise<boolean> {
    return this._azureDevOpsApiService
      .getCurrentUser$(cfg)
      .pipe(
        map((res) => !!res),
        catchError(() => of(false)),
        first(),
      )
      .toPromise()
      .then((res) => (res !== undefined ? res : false));
  }

  getById(issueId: string | number, issueProviderId: string): Promise<AzureDevOpsIssue> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this._azureDevOpsApiService.getIssueById$(issueId.toString(), cfg),
        ),
      )
      .toPromise()
      .then((res) => {
        if (!res) {
          throw new Error('Azure DevOps Issue not found');
        }
        return res;
      });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._azureDevOpsApiService.searchIssues$(searchTerm, cfg)
            : of([]),
        ),
      )
      .toPromise()
      .then((issues) =>
        (issues ?? []).map((issue) => ({
          title: issue.summary,
          issueType: 'AZURE_DEVOPS',
          issueData: issue,
        })),
      );
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: AzureDevOpsIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      throw new Error('No issueProviderId or issueId');
    }
    const cfg = await this._getCfgOnce$(task.issueProviderId)
      .toPromise()
      .then((res) => {
        if (!res) {
          throw new Error('Azure DevOps Config not found');
        }
        return res;
      });
    const issue = await this._azureDevOpsApiService
      .getIssueById$(task.issueId, cfg)
      .toPromise()
      .then((res) => {
        if (!res) {
          throw new Error('Azure DevOps Issue not found');
        }
        return res;
      });

    const wasUpdated = new Date(issue.updated).getTime() > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue: issue,
        issueTitle: issue.summary,
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(tasks: Task[]): Promise<
    {
      task: Task;
      taskChanges: Partial<Task>;
      issue: AzureDevOpsIssue;
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
        .map(({ refreshDataForTask, task }) => {
          return {
            task,
            taskChanges: refreshDataForTask!.taskChanges,
            issue: refreshDataForTask!.issue,
          };
        });
    });
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<AzureDevOpsIssueReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId)
      .toPromise()
      .then((res) => {
        if (!res) {
          throw new Error('Azure DevOps Config not found');
        }
        return res;
      });
    return this._azureDevOpsApiService
      .getNewIssuesToAddToBacklog$(cfg)
      .toPromise()
      .then((issues) => {
        return (issues ?? []).filter(
          (issue) => !(allExistingIssueIds as (string | number)[]).includes(issue.id),
        );
      });
  }

  getAddTaskData(issue: AzureDevOpsIssueReduced): Partial<Task> & { title: string } {
    return {
      title: issue.summary,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
      dueWithTime: issue.due ? new Date(issue.due).getTime() : null,
    };
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    return this.getById(issueId, issueProviderId).then((i) => i.url || '');
  }

  private _getCfgOnce$(issueProviderId: string): Observable<AzureDevOpsCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'AZURE_DEVOPS');
  }
}
