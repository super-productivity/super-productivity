import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, Subject, combineLatest, firstValueFrom, of } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueProvider, IssueProviderPlainspace } from '../issue/issue.model';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { IssueService } from '../issue/issue.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { PlainspaceSharedTask } from './plainspace-shared-task.model';

/**
 * The "claim pool": unclaimed (unassigned) Plainspace tasks for a shared
 * project, shown read-only. Claiming assigns the task to the signed-in user in
 * Plainspace and imports it as a first-class SP task — the only way unclaimed
 * work enters SP (docs §7). A project is "shared" when it has a bound, enabled
 * `PLAINSPACE` provider (`defaultProjectId === projectId`).
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceClaimPoolService {
  private _store = inject(Store);
  private _plainspaceApiService = inject(PlainspaceApiService);
  private _issueService = inject(IssueService);
  private _snackService = inject(SnackService);

  // Pings the pool to re-fetch after a claim so the claimed task leaves the pool.
  private readonly _refresh$ = new Subject<void>();

  unclaimedTasksForProject$(projectId: string): Observable<PlainspaceSharedTask[]> {
    // Editing any issue provider re-emits the list; collapse to this project's
    // bound provider and only re-fetch when its identity actually changes...
    const provider$ = this._store.select(selectEnabledIssueProviders).pipe(
      map((providers) => this._findProvider(providers, projectId)),
      distinctUntilChanged(
        (a, b) => a?.id === b?.id && a?.token === b?.token && a?.spaceId === b?.spaceId,
      ),
    );
    // ...or on an explicit refresh (after a claim), so the claimed task leaves
    // the pool even though the provider itself is unchanged.
    return combineLatest([provider$, this._refresh$.pipe(startWith(undefined))]).pipe(
      switchMap(([provider]) =>
        provider ? this._unclaimedForProvider$(provider) : of([]),
      ),
    );
  }

  /**
   * Claims an unclaimed task: assigns it to me in Plainspace, then imports it as
   * an SP task (added to the project backlog).
   */
  async claim(projectId: string, taskId: string): Promise<void> {
    const providers = await firstValueFrom(
      this._store.select(selectEnabledIssueProviders),
    );
    const provider = this._findProvider(providers, projectId);
    if (!provider) {
      return;
    }
    const claimed = await firstValueFrom(
      this._plainspaceApiService.claimTask$(taskId, provider),
    );
    if (claimed) {
      await this._issueService.addTaskFromIssue({
        issueDataReduced: claimed,
        issueProviderId: provider.id,
        issueProviderKey: 'PLAINSPACE',
        isAddToBacklog: true,
      });
      this._snackService.open({ type: 'SUCCESS', msg: T.PLAINSPACE.CLAIM_SUCCESS });
    } else {
      // `claimTask$` fails soft to null — most often the race where someone else
      // claimed first (or an outage). One friendly message covers both; the
      // refresh below drops a now-claimed task from the pool.
      // shortcut: generic message — distinguish 409 "taken" from offline once the
      // server contract pins the status code.
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.CLAIM_FAILED });
    }
    this._refresh$.next();
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

  private _unclaimedForProvider$(
    provider: IssueProviderPlainspace,
  ): Observable<PlainspaceSharedTask[]> {
    return this._plainspaceApiService.getUnclaimedTasks$(provider).pipe(
      map((issues) =>
        issues.map(
          (issue): PlainspaceSharedTask => ({
            id: issue.id,
            title: issue.title,
            isDone: issue.isDone,
            url: issue.url,
            isRecurring: issue.isRecurring,
          }),
        ),
      ),
    );
  }
}
