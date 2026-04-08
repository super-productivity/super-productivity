import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { EMPTY, from, merge, Observable, timer } from 'rxjs';
import { catchError, first, map, switchMap } from 'rxjs/operators';
import { IssueService } from '../issue.service';
import { Task, TaskWithSubTasks } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Store } from '@ngrx/store';
import { IssueProvider } from '../issue.model';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import { DELAY_BEFORE_ISSUE_POLLING, ICAL_TYPE } from '../issue.const';
import { isPluginIssueProvider } from '../issue.model';
import {
  selectAllCalendarIssueTasks,
  selectAllTasks,
} from '../../tasks/store/task.selectors';
import { IssueLog } from '../../../core/log';

@Injectable()
export class PollIssueUpdatesEffects {
  private _store = inject(Store);
  private _actions$ = inject(LOCAL_ACTIONS);
  private readonly _issueService = inject(IssueService);
  private readonly _workContextService = inject(WorkContextService);

  pollIssueTaskUpdatesActions$: Observable<unknown> = this._actions$.pipe(
    ofType(setActiveWorkContext, loadAllData),
  );

  /**
   * Polls issue updates for providers scoped to the current work context.
   * Restarts on every context switch or data load.
   */
  pollIssueChangesForCurrentContext$: Observable<unknown> = createEffect(
    () =>
      this.pollIssueTaskUpdatesActions$.pipe(
        switchMap(() => this._store.select(selectEnabledIssueProviders).pipe(first())),
        switchMap((enabledProviders: IssueProvider[]) => {
          const providers = enabledProviders.filter(
            (provider) =>
              provider.isAutoPoll &&
              // Exclude 'always' providers (handled by pollIssueChangesAlways$), keep ICAL
              (provider.pollingMode !== 'always' ||
                provider.issueProviderKey === ICAL_TYPE) &&
              this._issueService.getPollInterval(provider.issueProviderKey) > 0,
          );

          if (providers.length === 0) {
            return EMPTY;
          }

          return merge(
            ...providers.map((provider) => this._createUpdatePollTimer(provider)),
          );
        }),
      ),
    { dispatch: false },
  );

  /**
   * Polls issue updates for providers with pollingMode 'always'.
   * Starts once on the first trigger and runs continuously, reacting
   * only to provider configuration changes -- not to context switches.
   */
  pollIssueChangesAlways$: Observable<unknown> = createEffect(
    () =>
      this.pollIssueTaskUpdatesActions$.pipe(
        first(),
        switchMap(() =>
          this._store.select(selectEnabledIssueProviders).pipe(
            switchMap((enabledProviders: IssueProvider[]) => {
              const alwaysProviders = enabledProviders.filter(
                (provider) =>
                  provider.isAutoPoll &&
                  provider.pollingMode === 'always' &&
                  provider.issueProviderKey !== ICAL_TYPE &&
                  this._issueService.getPollInterval(provider.issueProviderKey) > 0,
              );

              if (alwaysProviders.length === 0) {
                return EMPTY;
              }

              return merge(
                ...alwaysProviders.map((provider) =>
                  this._createUpdatePollTimer(provider),
                ),
              );
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  private _createUpdatePollTimer(provider: IssueProvider): Observable<unknown> {
    return timer(
      DELAY_BEFORE_ISSUE_POLLING,
      this._issueService.getPollInterval(provider.issueProviderKey),
    ).pipe(
      switchMap(() => this._getTasksForProvider(provider)),
      switchMap((issueTasks: Task[]) => {
        if (issueTasks.length === 0) {
          return EMPTY;
        }
        return from(this._issueService.refreshIssueTasks(issueTasks, provider)).pipe(
          catchError((err) => {
            IssueLog.error('Error polling issue updates for ' + provider.id, err);
            return EMPTY;
          }),
        );
      }),
    );
  }

  /**
   * Gets tasks to refresh for a provider.
   * For calendar (ICAL) providers or providers with pollingMode 'always',
   * returns ALL matching tasks across all projects.
   * For other providers, returns only tasks in the current work context.
   */
  private _getTasksForProvider(provider: IssueProvider): Observable<Task[]> {
    if (
      provider.issueProviderKey === ICAL_TYPE ||
      isPluginIssueProvider(provider.issueProviderKey)
    ) {
      // For calendar/plugin providers, poll ALL calendar tasks across all projects
      return this._store.select(selectAllCalendarIssueTasks).pipe(
        first(),
        map((tasks) =>
          tasks.filter((task) => task.issueProviderId === provider.id && !!task.issueId),
        ),
      );
    }

    if (provider.pollingMode === 'always') {
      // Poll ALL tasks for this provider across all projects
      return this._store.select(selectAllTasks).pipe(
        first(),
        map((tasks: Task[]) =>
          tasks.filter((task) => task.issueProviderId === provider.id && !!task.issueId),
        ),
      );
    }

    // For other providers, only poll tasks in the current context
    return this._workContextService.allTasksForCurrentContext$.pipe(
      first(),
      map((tasks: TaskWithSubTasks[]) =>
        tasks.filter((task) => task.issueProviderId === provider.id && !!task.issueId),
      ),
    );
  }
}
