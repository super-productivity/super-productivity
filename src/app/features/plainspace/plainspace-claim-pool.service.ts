import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  EMPTY,
  Observable,
  Subject,
  firstValueFrom,
  forkJoin,
  interval,
  merge,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  scan,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueProvider, IssueProviderPlainspace } from '../issue/issue.model';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { PlainspaceHandoffService } from '../issue/providers/plainspace/plainspace-handoff.service';
import { PlainspaceIssue } from '../issue/providers/plainspace/plainspace-issue.model';
import { PlainspaceCfg } from '../issue/providers/plainspace/plainspace.model';
import { PLAINSPACE_POLL_INTERVAL } from '../issue/providers/plainspace/plainspace.const';
import { IssueService } from '../issue/issue.service';
import { IssueSyncStateService } from '../issue/two-way-sync/issue-sync-state.service';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { Task } from '../tasks/task.model';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { pollWhileOnline } from '../../util/poll-while-online';
import {
  PlainspaceSharedTask,
  PlainspaceTeamOverview,
} from './plainspace-shared-task.model';

interface ClaimPoolRefresh {
  provider: IssueProviderPlainspace;
  claimedTaskId?: string;
}

interface AssignmentChange {
  taskId: string;
  isMine: boolean;
}

type OverviewRead = PlainspaceTeamOverview & { retainOwnership?: boolean };

const isSameSpaceAccount = (a: PlainspaceCfg, b: PlainspaceCfg): boolean =>
  a.host === b.host && a.spaceId === b.spaceId && a.token === b.token;

const isTransientReadFailure = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500);

/**
 * Read-only Plainspace previews for a shared project. A successful claim assigns
 * an unassigned task to the signed-in user and imports it as a local task.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceClaimPoolService {
  private _store = inject(Store);
  private _plainspaceApiService = inject(PlainspaceApiService);
  private _handoff = inject(PlainspaceHandoffService);
  private _issueService = inject(IssueService);
  private _snackService = inject(SnackService);
  private readonly _isOnline$ = inject(IS_ONLINE$);
  private readonly _issueSyncState = inject(IssueSyncStateService);
  private readonly _activeTasks = this._store.selectSignal(selectAllTasks);

  private readonly _claimRefresh$ = new Subject<ClaimPoolRefresh>();

  teamOverviewForProject$(projectId: string): Observable<PlainspaceTeamOverview | null> {
    // Editing any issue provider re-emits the list; collapse to this project's
    // bound provider and re-fetch after changes to its config or assignments.
    return this._store.select(selectEnabledIssueProviders).pipe(
      map((providers) => this._findProvider(providers, projectId)),
      distinctUntilChanged(
        (a, b) =>
          a?.id === b?.id &&
          a?.isAutoPoll === b?.isAutoPoll &&
          (!a || !b || isSameSpaceAccount(a, b)),
      ),
      switchMap((provider) => {
        if (!provider) {
          return of(null);
        }
        const loading: PlainspaceTeamOverview = {
          providerId: provider.id,
          tasks: [],
          status: 'loading',
        };
        const assignmentChanges$ = merge(
          this._claimRefresh$.pipe(
            filter(
              (change) =>
                change.provider.id === provider.id &&
                isSameSpaceAccount(change.provider, provider),
            ),
            map(({ claimedTaskId }): AssignmentChange | undefined =>
              claimedTaskId ? { taskId: claimedTaskId, isMine: true } : undefined,
            ),
          ),
          this._plainspaceApiService.createdTasks$.pipe(
            filter(({ cfg }) => isSameSpaceAccount(cfg, provider)),
            map(({ taskId }): AssignmentChange => ({ taskId, isMine: true })),
          ),
          this._handoff.handedOffTasks$.pipe(
            filter(
              ({ cfg, providerId }) =>
                providerId === provider.id && isSameSpaceAccount(cfg, provider),
            ),
            map(({ taskId }): AssignmentChange => ({ taskId, isMine: false })),
          ),
        );
        const poll$ = provider.isAutoPoll
          ? pollWhileOnline(this._isOnline$, [interval(PLAINSPACE_POLL_INTERVAL)])
          : EMPTY;
        return merge(assignmentChanges$, poll$).pipe(
          startWith(undefined),
          switchMap((change) => {
            const overview$ = this._teamOverviewForProvider$(provider);
            return change ? overview$.pipe(startWith(change)) : overview$;
          }),
          scan(this._applyOverviewUpdate, loading),
          // Clear rows from the old project/provider while the new one loads.
          startWith(loading),
        );
      }),
    );
  }

  /**
   * Claims an unclaimed task in Plainspace and returns the linked SP task ID
   * when that task is in this project.
   */
  async claim(projectId: string, taskId: string): Promise<string | undefined> {
    const providers = await firstValueFrom(
      this._store.select(selectEnabledIssueProviders),
    );
    const provider = this._findProvider(providers, projectId);
    if (!provider) {
      return;
    }
    let claimed: PlainspaceIssue;
    try {
      claimed = await firstValueFrom(
        this._plainspaceApiService.claimTask$(taskId, provider),
      );
    } catch (err) {
      const status = err instanceof HttpErrorResponse ? err.status : undefined;
      const unavailableMessage =
        status === 409
          ? T.PLAINSPACE.CLAIM_ALREADY_TAKEN
          : status === 404
            ? T.PLAINSPACE.CLAIM_UNAVAILABLE
            : undefined;
      this._snackService.open({
        type: 'ERROR',
        msg: unavailableMessage ?? T.PLAINSPACE.CLAIM_REQUEST_FAILED,
      });
      if (unavailableMessage) {
        this._claimRefresh$.next({ provider });
      }
      return;
    }

    const findLinkedTask = (): Task | undefined =>
      this._activeTasks().find(
        (task) =>
          task.issueProviderId === provider.id &&
          task.issueType === 'PLAINSPACE' &&
          task.issueId === claimed.id,
      );

    try {
      let linkedTask = findLinkedTask();
      if (!linkedTask) {
        const importedId = await this._issueService.addTaskFromIssue({
          issueDataReduced: claimed,
          issueProviderId: provider.id,
          issueProviderKey: 'PLAINSPACE',
          isAddToBacklog: true,
        });
        // The import also handles restoring archived tasks, which returns no ID.
        linkedTask = findLinkedTask();
        if (importedId && linkedTask) {
          this._snackService.open({ type: 'SUCCESS', msg: T.PLAINSPACE.CLAIM_SUCCESS });
        }
      }
      if (linkedTask) {
        this._issueSyncState.setMissing([linkedTask.id], []);
      }
      return linkedTask?.projectId === projectId ? linkedTask.id : undefined;
    } catch {
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.CLAIM_IMPORT_FAILED });
      return undefined;
    } finally {
      this._claimRefresh$.next({ provider, claimedTaskId: claimed.id });
    }
  }

  private _findProvider(
    providers: IssueProvider[],
    projectId: string,
  ): IssueProviderPlainspace | undefined {
    return providers.find(
      (p): p is IssueProviderPlainspace =>
        p.issueProviderKey === 'PLAINSPACE' && p.defaultProjectId === projectId,
    );
  }

  private _applyOverviewUpdate(
    overview: PlainspaceTeamOverview,
    update: OverviewRead | AssignmentChange,
  ): PlainspaceTeamOverview {
    if ('status' in update) {
      const { retainOwnership, ...fresh } = update;
      // Preserve only the caller's previously known assignments on a transient
      // failure. The refreshed status and tasks always replace the old snapshot.
      return retainOwnership
        ? {
            ...fresh,
            ...(overview.assignedTaskIds && {
              assignedTaskIds: overview.assignedTaskIds,
            }),
            ...(overview.locallyAssignedTaskIds?.size && {
              locallyAssignedTaskIds: overview.locallyAssignedTaskIds,
            }),
          }
        : fresh;
    }

    const withAssignment = (ids?: ReadonlySet<string>): ReadonlySet<string> => {
      const updated = new Set(ids);
      if (update.isMine) {
        updated.add(update.taskId);
      } else {
        updated.delete(update.taskId);
      }
      return updated;
    };
    // A confirmed claim can be focused locally before the read refresh finishes.
    return {
      ...overview,
      tasks: overview.tasks.filter((task) => task.id !== update.taskId),
      ...(overview.assignedTaskIds && {
        assignedTaskIds: withAssignment(overview.assignedTaskIds),
      }),
      locallyAssignedTaskIds: withAssignment(overview.locallyAssignedTaskIds),
    };
  }

  private _teamOverviewForProvider$(
    provider: IssueProviderPlainspace,
  ): Observable<OverviewRead> {
    const linkedTasks = this._activeTasks().filter(
      (task) =>
        task.issueType === 'PLAINSPACE' &&
        task.issueProviderId === provider.id &&
        !!task.issueId,
    );
    const unavailable: PlainspaceTeamOverview = {
      providerId: provider.id,
      tasks: [],
      status: 'unavailable',
    };
    const legacyPool$ = (): Observable<OverviewRead> =>
      forkJoin({
        issues: this._plainspaceApiService.getUnclaimedTasks$(provider),
        ownership: this._plainspaceApiService.getMyTasks$(provider).pipe(
          map((issues) => ({
            assignedTaskIds: new Set(issues.map((issue) => issue.id)),
          })),
          catchError((err: unknown) =>
            of({ retainOwnership: isTransientReadFailure(err) }),
          ),
        ),
      }).pipe(
        map(({ issues, ownership }) => ({
          ...unavailable,
          ...ownership,
          tasks: issues.map(
            (issue): PlainspaceSharedTask => ({
              id: issue.id,
              title: issue.title,
              isDone: issue.isDone,
              url: issue.url,
              isRecurring: issue.isRecurring,
            }),
          ),
        })),
      );
    const overview$ = provider.spaceId
      ? this._plainspaceApiService.getTeamTasks$(provider).pipe(
          map(
            ({ tasks, assignedTaskIds }): OverviewRead => ({
              providerId: provider.id,
              tasks: tasks.map((task) => ({ ...task, isDone: false })),
              status: 'ready',
              assignedTaskIds: new Set(assignedTaskIds),
            }),
          ),
          catchError((err: unknown) => {
            // A missing route on older production servers returns the SPA HTML.
            // A current route can also return a 404 for lost space access.
            const missingEndpoint =
              err instanceof HttpErrorResponse &&
              ((err.status === 404 &&
                (err.error as { error?: unknown } | null)?.error !== 'Space not found') ||
                (err.status === 200 &&
                  err.headers
                    .get('Content-Type')
                    ?.split(';', 1)[0]
                    .trim()
                    .toLowerCase() === 'text/html'));
            return missingEndpoint
              ? legacyPool$()
              : of({ ...unavailable, retainOwnership: isTransientReadFailure(err) });
          }),
        )
      : legacyPool$();

    return overview$.pipe(
      tap(({ assignedTaskIds }) => {
        if (assignedTaskIds && linkedTasks.length) {
          this._issueSyncState.setMissing(
            linkedTasks.map((task) => task.id),
            linkedTasks
              .filter((task) => !assignedTaskIds.has(task.issueId!))
              .map((task) => task.id),
          );
        }
      }),
    );
  }
}
