import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { first, map, switchMap, tap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { JiraApiService } from './jira-api.service';
import { IssueProviderJira, SearchResultItem } from '../../issue.model';
import { JiraIssue, JiraIssueReduced } from './jira-issue.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { mapJiraAttachmentToAttachment } from './jira-issue-map.util';
import { JiraCfg } from './jira.model';
import { isJiraEnabled } from './is-jira-enabled.util';
import { JIRA_POLL_INTERVAL } from './jira.const';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { IssueLog } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class JiraCommonInterfacesService implements IssueServiceInterface {
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);

  pollInterval: number = JIRA_POLL_INTERVAL;

  isEnabled(cfg: JiraCfg): boolean {
    return isJiraEnabled(cfg);
  }

  testConnection(cfg: JiraCfg): Promise<boolean> {
    return this._jiraApiService
      .issuePicker$('', cfg)
      .pipe(
        map((res) => Array.isArray(res)),
        first(),
      )
      .toPromise()
      .then((result) => result ?? false);
  }

  // NOTE: we're using the issueKey instead of the real issueId
  getById(issueId: string | number, issueProviderId: string): Promise<JiraIssue> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((jiraCfg) =>
          this._jiraApiService.getIssueById$(assertTruthy(issueId).toString(), jiraCfg),
        ),
      )
      .toPromise()
      .then((result) => {
        if (!result) {
          throw new Error('Failed to get Jira issue');
        }
        return result;
      });
  }

  // NOTE: this gives back issueKey instead of issueId
  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        switchMap((jiraCfg) =>
          this.isEnabled(jiraCfg)
            ? this._jiraApiService
                .issuePicker$(searchTerm, jiraCfg)
                .pipe(tap((v) => IssueLog.log('jira.issuePicker$', v)))
            : of([]),
        ),
      )
      .toPromise()
      .then((result) => result ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: JiraIssue;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await this._getCfgOnce$(task.issueProviderId).toPromise();
    const issue = (await this._jiraApiService
      .getIssueById$(task.issueId, cfg)
      .toPromise()) as JiraIssue;

    // @see https://developer.atlassian.com/cloud/jira/platform/jira-expressions-type-reference/#date
    const newUpdated = new Date(issue.updated).getTime();
    const wasUpdated = newUpdated > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...this.getAddTaskData(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: issue.key,
      };
    }
    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: JiraIssue }[]> {
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

  getAddTaskData(issue: JiraIssueReduced): Partial<Task> & { title: string } {
    return {
      title: `${issue.key} ${issue.summary}`,
      issuePoints: issue.storyPoints,
      // circumvent errors for old jira versions #652
      issueAttachmentNr: issue.attachments ? issue.attachments.length : 0,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated).getTime(),
    };
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    if (!issueId || !issueProviderId) {
      throw new Error('No issueId or no issueProviderId');
    }
    // const isIssueKey = isNaN(Number(issueId));
    return this._getCfgOnce$(issueProviderId)
      .pipe(
        first(),
        map((jiraCfg) => jiraCfg.host + '/browse/' + issueId),
      )
      .toPromise()
      .then((result) => result ?? '');
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<JiraIssueReduced[]> {
    const cfg = await this._getCfgOnce$(issueProviderId).toPromise();
    return await this._jiraApiService.findAutoImportIssues$(cfg).toPromise();
  }

  getMappedAttachments(issueData: JiraIssue): TaskAttachment[] {
    return issueData?.attachments?.length
      ? issueData.attachments.map(mapJiraAttachmentToAttachment)
      : [];
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderJira> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'JIRA');
  }
}
