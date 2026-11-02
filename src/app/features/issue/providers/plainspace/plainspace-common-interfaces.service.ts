import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, IssueDataReduced, SearchResultItem } from '../../issue.model';
import { PLAINSPACE_POLL_INTERVAL } from './plainspace.const';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceSyncAdapterService } from './plainspace-sync-adapter.service';
import { PlainspaceIssue } from './plainspace-issue.model';
import {
  isPlainspaceQuietPollError,
  PlainspaceConnectionStateService,
} from './plainspace-connection-state.service';
import {
  computeFieldPullChanges,
  computePendingLocalChanges,
  hasRemoteFieldChange,
} from '../../two-way-sync/compute-field-pull';
import { IssueSyncStateService } from '../../two-way-sync/issue-sync-state.service';

@Injectable({
  providedIn: 'root',
})
export class PlainspaceCommonInterfacesService extends BaseIssueProviderService<PlainspaceCfg> {
  private readonly _plainspaceApiService = inject(PlainspaceApiService);
  private readonly _syncAdapter = inject(PlainspaceSyncAdapterService);
  private readonly _connectionState = inject(PlainspaceConnectionStateService);
  private readonly _syncState = inject(IssueSyncStateService);

  readonly providerKey = 'PLAINSPACE' as const;
  readonly pollInterval: number = PLAINSPACE_POLL_INTERVAL;

  isEnabled(cfg: PlainspaceCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.host && !!cfg.spaceId && !!cfg.token;
  }

  testConnection(cfg: PlainspaceCfg): Promise<boolean> {
    return firstValueFrom(
      this._plainspaceApiService.getMe$(cfg).pipe(map((res) => !!res)),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    // The canonical link (`{origin}/{slug}/item/{id}`) comes from the task's own
    // `url`; fall back to the host root if the task can't be fetched (offline).
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        switchMap((cfg) =>
          this._plainspaceApiService.getById$(String(issueId), cfg).pipe(
            catchError(() => of(null)),
            map((issue) => issue?.url || `${cfg.host}`),
          ),
        ),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(
    issue: PlainspaceIssue,
  ): Partial<Readonly<TaskCopy>> & { title: string } {
    // Import Plainspace's `scheduledAt` as the SP task's scheduled time so it
    // shows in the app. A provider-supplied `dueWithTime` is routed by the import
    // pipeline through `addAndSchedule` (sets the time + a reminder + Today
    // membership). Poll updates keep it in sync via the override below.
    const dueWithTime = issue.scheduledAt
      ? new Date(issue.scheduledAt).getTime()
      : undefined;
    return {
      title: issue.title,
      isDone: issue.isDone,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updatedAt).getTime(),
      ...(dueWithTime ? { dueWithTime } : {}),
      // Seed the last trustworthy remote values: the per-field pull and push
      // compare against them.
      issueLastSyncedValues: this._syncAdapter.extractSyncValues(
        issue as unknown as Record<string, unknown>,
      ),
    };
  }

  /**
   * Plainspace owns the schedule for shared tasks, so — unlike the base, which
   * drops `dueWithTime` on poll to protect user-set schedules — we pull
   * `scheduledAt` into `dueWithTime` here once it changes remotely, which keeps
   * recurring items in sync as the server advances it to the next occurrence.
   * Like CalDAV, each field is pulled only when its remote value changed.
   */
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: IssueData;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      return null;
    }
    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    const issue = await this._tracked(
      task.issueProviderId,
      firstValueFrom(this._plainspaceApiService.getById$(task.issueId, cfg)),
      cfg.token,
    );
    return this._toFreshData(task, issue, cfg);
  }

  /**
   * Poll all of a provider's imported tasks at once. `GET /tasks` already returns
   * every task assigned to me in one call, so we fetch it once per provider and
   * diff locally — instead of the base's one `getById` HTTP request per task
   * (which is N redundant calls of the same data). A task that is no longer
   * assigned to me isn't in the response: it is kept untouched and shown as "no
   * longer in your Plainspace list", and stops pushing.
   * A failed request throws (the poll effect logs it quietly) instead of
   * yielding an empty list, so nothing here is ever computed from a failed poll.
   *
   * After a successful response, local edits still waiting to be pushed (a field
   * whose local value differs from its baseline while the remote still equals
   * it, e.g. made offline) are queued for a quiet push.
   */
  override async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: IssueData }[]> {
    const tasksByProviderId = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.issueProviderId || !task.issueId) {
        continue;
      }
      const group = tasksByProviderId.get(task.issueProviderId) ?? [];
      group.push(task);
      tasksByProviderId.set(task.issueProviderId, group);
    }

    const updates: { task: Task; taskChanges: Partial<Task>; issue: IssueData }[] = [];
    for (const [providerId, providerTasks] of tasksByProviderId) {
      const cfg = await firstValueFrom(this._getCfgOnce$(providerId));
      const myTasks = await this._tracked(
        providerId,
        firstValueFrom(this._plainspaceApiService.getMyTasks$(cfg)),
        cfg.token,
      );
      const issuesById = new Map(myTasks.map((issue) => [issue.id, issue] as const));
      this._syncState.setMissing(
        providerTasks.map((task) => task.id),
        providerTasks.filter((task) => !issuesById.has(task.issueId!)).map((t) => t.id),
      );
      const fieldMappings = this._syncAdapter.getFieldMappings();
      const toPush: string[] = [];
      for (const task of providerTasks) {
        const issue = issuesById.get(task.issueId!);
        if (!issue) {
          continue;
        }
        const fresh = this._toFreshData(task, issue, cfg);
        if (fresh) {
          updates.push({ task, taskChanges: fresh.taskChanges, issue: fresh.issue });
        }
        const issueRecord = issue as unknown as Record<string, unknown>;
        const pending = computePendingLocalChanges(
          task,
          fieldMappings,
          // Per item: a repeating item's time is never pending.
          this._syncAdapter.getSyncConfig(cfg, issueRecord),
          { issueId: issue.id },
          this._syncAdapter.extractSyncValues(issueRecord),
        );
        if (Object.keys(pending).length) {
          toPush.push(task.id);
        } else {
          // Nothing left to push: an earlier failure no longer applies.
          this._syncState.clearFailure(task.id);
        }
      }
      // The caller applies the pulls above right after this resolves; queue the
      // pushes after that, so their pending fields are read from the pulled
      // task (a field pulled this time is no longer pending and is not
      // re-sent).
      if (toPush.length) {
        setTimeout(() =>
          toPush.forEach((taskId) => this._syncState.requestPush(taskId, true)),
        );
      }
    }
    return updates;
  }

  private _toFreshData(
    task: Task,
    issue: PlainspaceIssue | null,
    cfg: PlainspaceCfg,
  ): { taskChanges: Partial<Task>; issue: IssueData; issueTitle: string } | null {
    if (!issue) {
      return null;
    }
    const issueValues = this._syncAdapter.extractSyncValues(
      issue as unknown as Record<string, unknown>,
    );
    const fieldMappings = this._syncAdapter.getFieldMappings();
    const syncConfig = this._syncAdapter.getSyncConfig(cfg);
    // `/tasks` returns full values, so a field that left its baseline is pulled
    // even when the marker says "seen": the marker of our own PATCH also covers
    // that answer's other changes. This also heals tasks whose marker an older
    // client advanced the same way.
    const wasUpdated =
      new Date(issue.updatedAt).getTime() !== task.issueLastUpdated ||
      hasRemoteFieldChange(task, issueValues, fieldMappings, syncConfig);
    const taskChanges = computeFieldPullChanges({
      task,
      issueValues,
      wasUpdated,
      addTaskData: wasUpdated ? this.getAddTaskData(issue) : {},
      fieldMappings,
      syncConfig,
      ctx: { issueId: issue.id },
      isPullOnlyAuthoritative: false,
    });
    if (!taskChanges) {
      return null;
    }
    return {
      taskChanges: { ...taskChanges, issueWasUpdated: true },
      issue: issue as unknown as IssueData,
      issueTitle: issue.title,
    };
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: string[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    // Only tasks assigned to me become SP tasks; unclaimed tasks are claimed
    // explicitly via the claim pool, never auto-imported.
    try {
      return await this._tracked(
        issueProviderId,
        firstValueFrom(this._plainspaceApiService.getMyTasks$(cfg)),
        cfg.token,
      );
    } catch (err) {
      // Offline, a server outage or a rejected token: nothing to import this
      // tick. Kept quiet — the backlog poll would otherwise snack an error every
      // few minutes; a rejected token shows "reconnect" in the issue panel
      // instead. The caller only adds what it gets, so an empty answer here
      // imports nothing and removes nothing. Anything else keeps the snack.
      if (isPlainspaceQuietPollError(err)) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Records whether the token works, then answers the failures a poll also
   * keeps quiet (offline, 5xx, 401, a 403 proxy) with no results, as search did
   * before: the add-task bar searches every provider together (`forkJoin`), so
   * a throw would snack on each search and drop the other providers' results.
   * A rejected token shows "reconnect" in the issue panel. An unexpected error
   * still throws. A search result only lists tasks to add; nothing is removed
   * or marked missing from it.
   */
  override async searchIssues(
    searchTerm: string,
    issueProviderId: string,
  ): Promise<SearchResultItem[]> {
    try {
      return await this._tracked(
        issueProviderId,
        super.searchIssues(searchTerm, issueProviderId),
      );
    } catch (err) {
      if (isPlainspaceQuietPollError(err)) {
        return [];
      }
      throw err;
    }
  }

  /** Records whether the provider's token still works; never swallows errors. */
  private async _tracked<R>(
    providerId: string,
    request: Promise<R>,
    usedToken?: string | null,
  ): Promise<R> {
    try {
      const result = await request;
      this._connectionState.reportSuccess(providerId);
      return result;
    } catch (err) {
      this._connectionState.reportError(providerId, err, usedToken);
      throw err;
    }
  }

  protected _apiGetById$(
    id: string | number,
    cfg: PlainspaceCfg,
  ): Observable<IssueData | null> {
    return this._plainspaceApiService.getById$(
      String(id),
      cfg,
    ) as Observable<IssueData | null>;
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: PlainspaceCfg,
  ): Observable<SearchResultItem[]> {
    return this._plainspaceApiService.searchIssues$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return (issue as PlainspaceIssue).title;
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as PlainspaceIssue).updatedAt).getTime();
  }
}
