import { inject } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Task, TaskCopy } from '../../tasks/task.model';
import { IssueServiceInterface } from '../issue-service-interface';
import {
  IssueData,
  IssueDataReduced,
  IssueIntegrationCfg,
  IssueProviderKey,
  SearchResultItem,
} from '../issue.model';
import { IssueProviderService } from '../issue-provider.service';
import { IssueTask } from '../../tasks/task.model';

/**
 * Abstract base class for issue provider services.
 *
 * Provides shared implementations for:
 * - _getCfgOnce$: config retrieval
 * - getById: fetch issue by ID via _apiGetById$
 * - searchIssues: search via _apiSearchIssues$
 * - getFreshDataForIssueTask: validate + fetch + update check
 * - getFreshDataForIssueTasks: Promise.all wrapper
 *
 * Each provider extends this and implements the abstract members.
 * Override any method for provider-specific behavior.
 */
export abstract class BaseIssueProviderService<
  TCfg extends IssueIntegrationCfg = IssueIntegrationCfg,
> implements IssueServiceInterface {
  protected readonly _issueProviderService = inject(IssueProviderService);

  abstract readonly providerKey: IssueProviderKey;
  abstract readonly pollInterval: number;

  // --- MUST be implemented by every provider ---

  abstract isEnabled(cfg: IssueIntegrationCfg): boolean;

  abstract testConnection(cfg: IssueIntegrationCfg): Promise<boolean>;

  abstract getAddTaskData(issueData: IssueDataReduced): IssueTask;

  abstract issueLink(issueId: string | number, issueProviderId: string): Promise<string>;

  // --- Protected hooks for shared implementations ---

  protected abstract _apiGetById$(
    id: string | number,
    cfg: TCfg,
  ): Observable<IssueData | null>;

  protected abstract _apiSearchIssues$(
    searchTerm: string,
    cfg: TCfg,
  ): Observable<SearchResultItem[]>;

  protected abstract _formatIssueTitleForSnack(issue: IssueData): string;

  protected abstract _getIssueLastUpdated(issue: IssueData): number;

  // --- Shared implementations ---

  // Safe cast: the runtime value from getCfgOnce$ is the full provider type
  // (e.g. IssueProviderJira) which extends TCfg (e.g. JiraCfg).
  protected _getCfgOnce$(issueProviderId: string): Observable<TCfg> {
    return this._issueProviderService.getCfgOnce$(
      issueProviderId,
      this.providerKey,
    ) as unknown as Observable<TCfg>;
  }

  getById(id: string | number, issueProviderId: string): Promise<IssueData | null> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) => this._apiGetById$(id, cfg)),
      ),
    );
  }

  searchIssues(searchTerm: string, issueProviderId: string): Promise<SearchResultItem[]> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) =>
          this.isEnabled(cfg) ? this._apiSearchIssues$(searchTerm, cfg) : of([]),
        ),
      ),
    );
  }

  protected _wasUpdated(task: Task, issue: IssueData): boolean {
    return this._getIssueLastUpdated(issue) > (task.issueLastUpdated || 0);
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: IssueData;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId) {
      throw new Error('No issueProviderId');
    }
    if (!task.issueId) {
      throw new Error('No issueId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await firstValueFrom(this._apiGetById$(task.issueId, cfg));

    if (!issue) {
      return null;
    }

    if (this._wasUpdated(task, issue)) {
      // Exclude dueDay/dueWithTime from polling updates to prevent overwriting
      // user-set schedules. Due dates are only set on initial task creation.
      // Providers that need to sync due dates during polling (e.g. Calendar)
      // override this method with their own change detection logic.
      const taskData: Partial<TaskCopy> & { title: string } = {
        ...this.getAddTaskData(issue as IssueDataReduced),
      };
      delete taskData.dueDay;
      delete taskData.dueWithTime;
      return {
        taskChanges: {
          ...taskData,
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
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: IssueData }[]> {
    return Promise.all(
      tasks.map((task) =>
        this.getFreshDataForIssueTask(task).then((refreshDataForTask) => ({
          task,
          refreshDataForTask,
        })),
      ),
    ).then((items) =>
      items.flatMap(({ refreshDataForTask, task }) =>
        refreshDataForTask
          ? [
              {
                task,
                taskChanges: refreshDataForTask.taskChanges,
                issue: refreshDataForTask.issue,
              },
            ]
          : [],
      ),
    );
  }
}
