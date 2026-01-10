import { Injectable, inject } from '@angular/core';
import { Observable, of, firstValueFrom } from 'rxjs';
import { concatMap, first, map, switchMap } from 'rxjs/operators';
import { IssueServiceInterface } from '../../issue-service-interface';
import { IssueProviderService } from '../../issue-provider.service';
import { ClickUpApiService } from './clickup-api.service';
import { ClickUpCfg } from './clickup.model';
import { SearchResultItem } from '../../issue.model';
import { ClickUpTask, ClickUpTaskReduced } from './clickup-issue.model';
import {
  mapClickUpAttachmentToTaskAttachment,
  mapClickUpTaskToTask,
  isClickUpTaskDone,
} from './clickup-issue-map.util';
import { Task } from '../../../tasks/task.model';
import { TaskAttachment } from '../../../tasks/task-attachment/task-attachment.model';
import { truncate } from '../../../../util/truncate';
import { IssueLog } from '../../../../core/log';

@Injectable({
  providedIn: 'root',
})
export class ClickUpCommonInterfacesService implements IssueServiceInterface {
  private _clickUpApiService = inject(ClickUpApiService);
  private _issueProviderService = inject(IssueProviderService);

  isEnabled(cfg: ClickUpCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.apiKey;
  }

  testConnection(cfg: ClickUpCfg): Promise<boolean> {
    return firstValueFrom(
      this._clickUpApiService.getCurrentUser$(cfg).pipe(
        map(() => true),
        first(),
      ),
    )
      .then((result) => result ?? false)
      .catch(() => false);
  }

  issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        concatMap((cfg) =>
          this._clickUpApiService.getById$(issueId, cfg).pipe(map((issue) => issue.url)),
        ),
        first(),
      ),
    ).then((res) => res ?? '');
  }

  getById(issueId: string, issueProviderId: string): Promise<ClickUpTask> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        concatMap((cfg) => this._clickUpApiService.getById$(issueId, cfg)),
        first(),
      ),
    ).then((res) => {
      if (!res) throw new Error('Failed to get ClickUp task');
      return res;
    });
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg)
            ? this._clickUpApiService.searchTasks$(searchTerm, cfg).pipe(
                map((tasks) =>
                  tasks.map((task) => ({
                    title: task.name,
                    issueType: 'CLICKUP' as const,
                    issueData: task,
                  })),
                ),
              )
            : of([]),
        ),
        first(),
      ),
    ).then((res) => res ?? []);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: ClickUpTask;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      throw new Error('No issueProviderId or issueId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId)).then(
      (res) => {
        if (!res) throw new Error('No config found');
        return res;
      },
    );

    const issue = await firstValueFrom(
      this._clickUpApiService.getById$(task.issueId, cfg),
    ).then((res) => {
      if (!res) throw new Error('Issue not found');
      return res;
    });

    const issueLastUpdated = parseInt(issue.date_updated, 10);
    const wasUpdated = issueLastUpdated > (task.issueLastUpdated || 0);

    if (wasUpdated) {
      return {
        taskChanges: {
          ...mapClickUpTaskToTask(issue),
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(issue.name),
      };
    }

    return null;
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: ClickUpTask }[]> {
    // Parallel requests might be too much for API limits? ClickUp limits are generous mostly.
    return Promise.all(
      tasks.map(
        (task) =>
          this.getFreshDataForIssueTask(task)
            .then((refreshData) => ({
              task,
              refreshData,
            }))
            .catch((e) => {
              IssueLog.error('ClickUp getFreshDataForIssueTasks error', e);
              return { task, refreshData: null };
            }), // suppress error to not fail all?
      ),
    ).then((items) => {
      return items
        .filter(({ refreshData }) => !!refreshData)
        .map(({ refreshData, task }) => ({
          task,
          taskChanges: refreshData!.taskChanges,
          issue: refreshData!.issue,
        }));
    });
  }

  getMappedAttachments(issue: ClickUpTask): TaskAttachment[] {
    return (issue.attachments || []).map(mapClickUpAttachmentToTaskAttachment);
  }

  async getNewIssuesToAddToBacklog?(
    issueProviderId: string,
    allExistingIssueIds: (string | number)[],
  ): Promise<ClickUpTaskReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId)).then(
      (result) => {
        if (!result) {
          throw new Error('No config found');
        }
        return result;
      },
    );

    const tasks = await firstValueFrom(
      this._clickUpApiService.searchTasks$('', cfg).pipe(first()),
    ).then((res) => res ?? []);

    return tasks.filter((task) => !allExistingIssueIds.includes(task.id));
  }

  pollInterval = 60000;

  getAddTaskData(issue: ClickUpTaskReduced): Partial<Task> & { title: string } {
    return {
      title: issue.name,
      issueWasUpdated: false,
      issueLastUpdated: parseInt(issue.date_updated, 10),
      isDone: isClickUpTaskDone(issue),
    };
  }

  getSubTasksForIssue(
    issue: ClickUpTask,
  ): Array<Partial<Task> & { title: string; related_to: string }> {
    if (!issue.subtasks || issue.subtasks.length === 0) {
      return [];
    }

    return issue.subtasks.map((subtask) => ({
      title: subtask.name,
      issueWasUpdated: false,
      issueLastUpdated: parseInt(subtask.date_updated, 10),
      isDone: isClickUpTaskDone(subtask),
      related_to: issue.id, // Link to parent task
      issueId: subtask.id,
      issueType: 'CLICKUP' as const,
    }));
  }

  async getSubTasks(
    issueId: string | number,
    issueProviderId: string,
    issue: ClickUpTaskReduced,
  ): Promise<ClickUpTaskReduced[]> {
    let subtasks = (issue as ClickUpTask).subtasks;

    if (!subtasks) {
      const fullIssue = await this.getById(issueId.toString(), issueProviderId);
      subtasks = fullIssue.subtasks;
    }

    if (subtasks) {
      return subtasks.filter((subtask) => subtask.status?.type !== 'closed');
    }
    return [];
  }

  private _getCfgOnce$(issueProviderId: string): Observable<ClickUpCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'CLICKUP');
  }
}
