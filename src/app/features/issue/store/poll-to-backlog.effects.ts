import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { merge, Observable, timer } from 'rxjs';
import {
  catchError,
  concatMap,
  filter,
  first,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { IssueService } from '../issue.service';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { WorkContextService } from '../../work-context/work-context.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { Store } from '@ngrx/store';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import { IssueProvider } from '../issue.model';
import { SnackService } from '../../../core/snack/snack.service';
import { getErrorTxt } from '../../../util/get-error-text';
import { DELAY_BEFORE_ISSUE_POLLING } from '../issue.const';
import { IssueLog } from '../../../core/log';

@Injectable()
export class PollToBacklogEffects {
  private readonly _issueService = inject(IssueService);
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _syncTriggerService = inject(SyncTriggerService);
  private readonly _snackService = inject(SnackService);
  private readonly _store = inject(Store);

  pollToBacklogActions$: Observable<unknown> = this._actions$.pipe(
    ofType(setActiveWorkContext),
  );

  pollToBacklogTriggerToProjectId$: Observable<string> =
    this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$.pipe(
      concatMap(() => this.pollToBacklogActions$),
      switchMap(() => this._workContextService.isActiveWorkContextProject$.pipe(first())),
      filter((isProject) => isProject),
      switchMap(
        () =>
          this._workContextService.activeWorkContextId$.pipe(
            first(),
          ) as Observable<string>,
      ),
      filter((projectId) => !!projectId),
    );

  pollNewIssuesToBacklog$: Observable<any> = createEffect(
    () =>
      this.pollToBacklogTriggerToProjectId$.pipe(
        switchMap((pId) =>
          this._store.select(selectEnabledIssueProviders).pipe(
            switchMap((enabledProviders: IssueProvider[]) =>
              merge(
                ...enabledProviders
                  .filter(
                    (provider) =>
                      provider.defaultProjectId === pId && provider.isAutoAddToBacklog,
                  )
                  // filter out providers with 0 poll interval (no polling)
                  .filter(
                    (provider) =>
                      this._issueService.getPollInterval(provider.issueProviderKey) > 0,
                  )
                  .map((provider) =>
                    timer(
                      DELAY_BEFORE_ISSUE_POLLING,
                      this._issueService.getPollInterval(provider.issueProviderKey),
                    ).pipe(
                      takeUntil(this.pollToBacklogActions$),
                      tap(() => IssueLog.log('POLL ' + provider.issueProviderKey)),
                      switchMap(() =>
                        this._issueService.checkAndImportNewIssuesToBacklogForProject(
                          provider.issueProviderKey,
                          provider.id,
                        ),
                      ),
                      catchError((e) => {
                        IssueLog.err(e);
                        this._snackService.open({
                          type: 'ERROR',
                          // TODO translate
                          msg: `${provider.issueProviderKey}: Failed to poll new issues for backlog import – \n ${getErrorTxt(e)}`,
                        });
                        return [];
                      }),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );
}
