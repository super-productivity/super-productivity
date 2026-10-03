import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom, Observable } from 'rxjs';
import { first, map, tap } from 'rxjs/operators';
import { IssueTask, Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { CaldavIssue, CaldavIssueReduced } from './caldav-issue.model';
import { CaldavClientService } from './caldav-client.service';
import {
  CALDAV_DATE_TASK_FIELDS,
  CALDAV_DEADLINE_TASK_FIELDS,
  CaldavSyncAdapterService,
} from './caldav-sync-adapter.service';
import { CaldavCfg } from './caldav.model';
import { truncate } from '../../../../util/truncate';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { isCaldavEnabled } from './is-caldav-enabled.util';
import { CALDAV_POLL_INTERVAL } from './caldav.const';
import { issueValuesEqual } from '../../two-way-sync/compute-push-decisions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';

@Injectable({
  providedIn: 'root',
})
export class CaldavCommonInterfacesService extends BaseIssueProviderService<CaldavCfg> {
  private readonly _caldavClientService = inject(CaldavClientService);
  private readonly _caldavSyncAdapter = inject(CaldavSyncAdapterService);
  private readonly _store = inject(Store);

  // Short-lived cache so that getNewIssuesToAddToBacklog and all getSubTasks
  // calls within the same poll cycle share a single REPORT request instead of
  // issuing one per parent task (N+1 problem).
  // We cache the Promise (not the resolved data) so that concurrent callers
  // that arrive before the first request resolves all share the same in-flight
  // Promise instead of each starting their own REPORT.
  private _openTasksCache = new Map<
    string,
    { taskPromise: Promise<CaldavIssue[]>; ts: number }
  >();
  private readonly _OPEN_TASKS_CACHE_TTL_MS = 60_000;
  private _cachedCfg?: CaldavCfg;

  readonly providerKey = 'CALDAV' as const;

  get pollInterval(): number {
    return this._cachedCfg?.pollIntervalMinutes
      ? this._cachedCfg.pollIntervalMinutes * 60 * 1000
      : CALDAV_POLL_INTERVAL;
  }

  isEnabled(cfg: CaldavCfg): boolean {
    return isCaldavEnabled(cfg);
  }

  // Caches config for the pollInterval getter (mirrors NextcloudDeck).
  protected override _getCfgOnce$(issueProviderId: string): Observable<CaldavCfg> {
    return super._getCfgOnce$(issueProviderId).pipe(
      tap((cfg) => {
        this._cachedCfg = cfg;
      }),
    );
  }

  testConnection(cfg: CaldavCfg): Promise<boolean> {
    return firstValueFrom(
      this._caldavClientService.searchOpenTasks$('', cfg).pipe(
        map((res) => Array.isArray(res)),
        first(),
      ),
    ).then((result) => result ?? false);
  }

  issueLink(_issueId: string | number, _issueProviderId: string): Promise<string> {
    return Promise.resolve('');
  }

  getAddTaskData(issueData: CaldavIssue): IssueTask {
    // Map DTSTART: all-day → dueDay, timed → dueWithTime, absent → null (prevents "Today" default).
    // Always null the counterpart field so type transitions clear stale values on update.
    const startFields: Partial<IssueTask> =
      issueData.start === undefined
        ? { dueDay: null, dueWithTime: null }
        : issueData.isAllDay
          ? { dueDay: getDbDateStr(issueData.start), dueWithTime: null }
          : { dueWithTime: issueData.start, dueDay: null };

    // Map DUE → deadline fields (all-day → deadlineDay, timed → deadlineWithTime).
    // Always null the counterpart field to clear stale values on type transitions.
    const dueFields: Partial<IssueTask> =
      issueData.due === undefined
        ? {}
        : issueData.isDueAllDay
          ? { deadlineDay: getDbDateStr(issueData.due), deadlineWithTime: null }
          : { deadlineWithTime: issueData.due, deadlineDay: null };

    return {
      title: issueData.summary,
      issueLastUpdated: issueData.etag_hash,
      notes: issueData.note,
      related_to: issueData.related_to,
      // normalized to a boolean in _mapTask; without it a server-side
      // STATUS:COMPLETED never ticks the task done (Plainspace and
      // Nextcloud Deck map their equivalents the same way)
      isDone: issueData.completed,
      ...startFields,
      ...dueFields,
      issueLastSyncedValues: this._caldavSyncAdapter.extractSyncValues(
        issueData as unknown as Record<string, unknown>,
      ),
    };
  }

  // CalDAV uses etag-based comparison, not timestamp
  override async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: CaldavIssue;
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
      this._caldavClientService.getById$(task.issueId, cfg),
    );
    const taskChanges = this._getRefreshTaskChanges(task, issue, cfg);

    if (taskChanges) {
      return {
        taskChanges: {
          ...taskChanges,
          issueWasUpdated: true,
        },
        issue,
        issueTitle: truncate(issue.summary),
      };
    }
    return null;
  }

  // Batch-fetches by IDs for efficiency
  override async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: CaldavIssue }[]> {
    const issueProviderId =
      tasks && tasks[0].issueProviderId ? tasks[0].issueProviderId : '';
    if (!issueProviderId) {
      throw new Error('No issueProviderId');
    }

    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    // Query and match by the VTODO UID (task.issueId) — task.id is SP's own
    // nanoid and never matches a server-side UID, so keying on it made this
    // batch poll return no updates at all.
    const issues: CaldavIssue[] = await firstValueFrom(
      this._caldavClientService.getByIds$(
        tasks
          .map((task) => task.issueId)
          .filter((issueId): issueId is string => !!issueId),
        cfg,
      ),
    );
    const issueMap = new Map(issues.map((item) => [item.id, item]));
    const updates: {
      task: Task;
      taskChanges: Partial<Task>;
      issue: CaldavIssue;
    }[] = [];
    const baselineBackfills: { id: string; changes: Partial<Task> }[] = [];

    for (const task of tasks) {
      const issue = task.issueId ? issueMap.get(task.issueId) : undefined;
      if (!issue) {
        continue;
      }
      const taskChanges = this._getRefreshTaskChanges(task, issue, cfg);
      if (taskChanges) {
        updates.push({
          task,
          taskChanges: {
            ...taskChanges,
            issueWasUpdated: true,
          },
          issue,
        });
      } else {
        const backfill = this._getDateBaselineBackfill(task, issue, cfg);
        if (backfill) {
          baselineBackfills.push({
            id: task.id,
            changes: { issueLastSyncedValues: backfill },
          });
        }
      }
    }

    if (baselineBackfills.length) {
      // One bulk op, no snack, not a two-way-sync push trigger.
      this._store.dispatch(TaskSharedActions.updateTasks({ tasks: baselineBackfills }));
    }

    return updates;
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: number[] | string[],
  ): Promise<CaldavIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    const tasks = await this._getOpenTasksCached(issueProviderId, cfg);

    if (cfg.isAddSubTasks) {
      const existingIds = new Set(allExistingIssueIds as string[]);
      // Exclude child tasks whose parent is NOT yet in SP: they will be fetched via
      // getSubTasks() when the parent is imported, avoiding a concurrent-add race.
      // Child tasks whose parent already exists in SP are kept so _tryAddSubTask()
      // can attach them to the parent on this poll cycle.
      return tasks.filter((t) => !t.related_to || existingIds.has(t.related_to));
    }

    return tasks;
  }

  async getSubTasks(
    issueId: string | number,
    issueProviderId: string,
  ): Promise<CaldavIssueReduced[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));

    if (!cfg.isAddSubTasks) {
      return [];
    }

    const parentId = issueId.toString();
    const allTasks = await this._getOpenTasksCached(issueProviderId, cfg);
    // Guard against self-referential VTODOs (RELATED-TO:<own-uid>) which would
    // cause a task to be added as its own sub-task and corrupt the store.
    return allTasks.filter((t) => t.related_to === parentId && t.id !== parentId);
  }

  // Non-async: Map.set runs synchronously so concurrent callers share the
  // same in-flight Promise instead of each firing their own REPORT request.
  private _getOpenTasksCached(
    issueProviderId: string,
    cfg: CaldavCfg,
  ): Promise<CaldavIssue[]> {
    const cached = this._openTasksCache.get(issueProviderId);
    if (cached && Date.now() - cached.ts < this._OPEN_TASKS_CACHE_TTL_MS) {
      return cached.taskPromise;
    }
    const taskPromise = firstValueFrom(this._caldavClientService.getOpenTasks$(cfg));
    this._openTasksCache.set(issueProviderId, { taskPromise, ts: Date.now() });
    return taskPromise;
  }

  private _getRefreshTaskChanges(
    task: Task,
    issue: CaldavIssue,
    cfg: CaldavCfg,
  ): Partial<Task> | null {
    const wasUpdated = issue.etag_hash !== task.issueLastUpdated;
    const taskChanges: Record<PropertyKey, unknown> = wasUpdated
      ? { ...this.getAddTaskData(issue) }
      : {};
    // Mapped issue fields (incl. the derived dtstart/due) come from the adapter,
    // the same values that baselines are built from.
    const issueValues = this._caldavSyncAdapter.extractSyncValues(
      issue as unknown as Record<string, unknown>,
    );
    const lastSyncedValues = task.issueLastSyncedValues ?? {};
    const syncConfig = this._caldavSyncAdapter.getSyncConfig(cfg);
    const context = { issueId: issue.id };
    let hasPullOnlyMismatch = false;

    for (const mapping of this._caldavSyncAdapter.getFieldMappings()) {
      const direction = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
      const canPull = direction === 'pullOnly' || direction === 'both';

      if (!canPull) {
        delete taskChanges[mapping.taskField];
        continue;
      }

      const remoteTaskValue = mapping.toTaskValue(
        issueValues[mapping.issueField],
        context,
      );
      const isDateField = CALDAV_DATE_TASK_FIELDS.has(mapping.taskField);
      // A deadline absent on the server is only a removal if the server had one
      // at the last sync; otherwise the deadline exists only in SP and is kept.
      const isDeadlineOnlyInSp =
        CALDAV_DEADLINE_TASK_FIELDS.has(mapping.taskField) &&
        issueValues[mapping.issueField] === null &&
        (lastSyncedValues[mapping.issueField] === undefined ||
          lastSyncedValues[mapping.issueField] === null);
      // A VTODO-wide ETag can change for an unrelated field. In "both" mode,
      // preserve pending local edits unless this specific remote field changed.
      const shouldPullAfterEtagChange =
        direction === 'pullOnly' ||
        !Object.prototype.hasOwnProperty.call(lastSyncedValues, mapping.issueField) ||
        !issueValuesEqual(
          issueValues[mapping.issueField],
          lastSyncedValues[mapping.issueField],
        );
      if (wasUpdated) {
        if (shouldPullAfterEtagChange && !isDeadlineOnlyInSp) {
          taskChanges[mapping.taskField] = remoteTaskValue;
        } else {
          delete taskChanges[mapping.taskField];
        }
      } else if (
        // Older refreshes could advance the ETag without applying mapped values.
        // Heal provider-owned fields, but preserve possible unpushed edits in "both".
        // Dates were always applied on ETag change, so they never need healing, and
        // healing would revert dates set in SP (#10099).
        !isDateField &&
        direction === 'pullOnly' &&
        remoteTaskValue !== task[mapping.taskField]
      ) {
        taskChanges[mapping.taskField] = remoteTaskValue;
        hasPullOnlyMismatch = true;
      }
    }

    return wasUpdated || hasPullOnlyMismatch ? (taskChanges as Partial<Task>) : null;
  }

  /**
   * Tasks linked before date push existed have no dtstart/due baseline, so
   * their first date push would be skipped as "no-baseline". When push is
   * enabled for a date and the ETag is unchanged since the last pull, the
   * server's current value is the one last pulled, so it is a safe baseline.
   */
  private _getDateBaselineBackfill(
    task: Task,
    issue: CaldavIssue,
    cfg: CaldavCfg,
  ): Record<string, unknown> | null {
    if (issue.etag_hash !== task.issueLastUpdated) {
      return null;
    }
    const syncConfig = this._caldavSyncAdapter.getSyncConfig(cfg);
    const lastSynced = task.issueLastSyncedValues ?? {};
    const fresh = this._caldavSyncAdapter.extractSyncValues(
      issue as unknown as Record<string, unknown>,
    );
    const missing: Record<string, unknown> = {};
    for (const [taskField, issueField] of [
      ['dueDay', 'dtstart'],
      ['deadlineDay', 'due'],
    ] as const) {
      const direction = syncConfig[taskField];
      const canPush = direction === 'pushOnly' || direction === 'both';
      if (canPush && !(issueField in lastSynced)) {
        missing[issueField] = fresh[issueField];
      }
    }
    return Object.keys(missing).length ? { ...lastSynced, ...missing } : null;
  }

  protected _apiGetById$(
    id: string | number,
    cfg: CaldavCfg,
  ): Observable<IssueData | null> {
    return this._caldavClientService.getById$(id, cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: CaldavCfg,
  ): Observable<SearchResultItem[]> {
    return this._caldavClientService.searchOpenTasks$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate((issue as CaldavIssue).summary);
  }

  // CalDAV uses etag_hash (string) not a numeric timestamp.
  // Safe: both getFreshDataForIssueTask and getFreshDataForIssueTasks are overridden,
  // which are the only callers of _getIssueLastUpdated.
  protected _getIssueLastUpdated(_issue: IssueData): number {
    return 0;
  }
}
