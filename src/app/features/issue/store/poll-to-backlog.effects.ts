import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { EMPTY, from, merge, Observable, timer } from 'rxjs';
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
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';

@Injectable()
export class PollToBacklogEffects {
  private readonly _issueService = inject(IssueService);
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _syncTriggerService = inject(SyncTriggerService);
  private readonly _snackService = inject(SnackService);
  private readonly _store = inject(Store);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);

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

  pollNewIssuesToBacklog$: Observable<unknown> = createEffect(
    () =>
      this.pollToBacklogTriggerToProjectId$.pipe(
        switchMap((pId) =>
          this._store.select(selectEnabledIssueProviders).pipe(
            switchMap((enabledProviders: IssueProvider[]) => {
              const matchingProviders = enabledProviders.filter(
                (provider) =>
                  provider.defaultProjectId === pId &&
                  provider.isAutoAddToBacklog &&
                  provider.pollingMode !== 'always' &&
                  !this._pluginRegistry.getUseAgendaView(provider.issueProviderKey) &&
                  this._issueService.getPollInterval(provider.issueProviderKey) > 0,
              );
              if (matchingProviders.length === 0) {
                return EMPTY;
              }
              return merge(
                ...matchingProviders.map((provider) =>
                  this._createBacklogPollTimer(provider),
                ),
              );
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * Polls for backlog import for providers with pollingMode 'always'.
   * Starts once after initial sync and runs continuously, reacting only
   * to provider configuration changes -- not to context switches.
   */
  pollNewIssuesToBacklogAlways$: Observable<unknown> = createEffect(
    () =>
      this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$.pipe(
        switchMap(() =>
          this._store.select(selectEnabledIssueProviders).pipe(
            switchMap((enabledProviders: IssueProvider[]) => {
              const alwaysProviders = enabledProviders.filter(
                (provider) =>
                  provider.pollingMode === 'always' &&
                  provider.isAutoAddToBacklog &&
                  !!provider.defaultProjectId &&
                  !this._pluginRegistry.getUseAgendaView(provider.issueProviderKey) &&
                  this._issueService.getPollInterval(provider.issueProviderKey) > 0,
              );
              if (alwaysProviders.length === 0) {
                return EMPTY;
              }
              return merge(
                ...alwaysProviders.map((provider) =>
                  this._createBacklogPollTimer(provider, false),
                ),
              );
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  private _createBacklogPollTimer(
    provider: IssueProvider,
    stopOnContextSwitch = true,
  ): Observable<unknown> {
    const timer$ = timer(
      DELAY_BEFORE_ISSUE_POLLING,
      this._issueService.getPollInterval(provider.issueProviderKey),
    );

    return (
      stopOnContextSwitch ? timer$.pipe(takeUntil(this.pollToBacklogActions$)) : timer$
    ).pipe(
      tap(() => IssueLog.log('POLL ' + provider.issueProviderKey)),
      switchMap(() =>
        from(
          this._issueService.checkAndImportNewIssuesToBacklogForProject(
            provider.issueProviderKey,
            provider.id,
          ),
        ).pipe(
          catchError((e) => {
            IssueLog.err(e);
            this._snackService.open({
              type: 'ERROR',
              // TODO translate
              msg: `${provider.issueProviderKey}: Failed to poll new issues for backlog import – \n ${getErrorTxt(e)}`,
            });
            return EMPTY;
          }),
        ),
      ),
    );
  }
}
