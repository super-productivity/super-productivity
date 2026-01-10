import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { EMPTY, merge, Observable, timer } from 'rxjs';
import { first, map, switchMap, tap } from 'rxjs/operators';
import { IssueService } from '../issue.service';
import { Task, TaskWithSubTasks } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { setActiveWorkContext } from '../../work-context/store/work-context.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Store } from '@ngrx/store';
import { IssueProvider } from '../issue.model';
import { selectEnabledIssueProviders } from './issue-provider.selectors';
import { DELAY_BEFORE_ISSUE_POLLING, ICAL_TYPE } from '../issue.const';
import { selectAllCalendarIssueTasks } from '../../tasks/store/task.selectors';
import { IssueLog } from '../../../core/log';

@Injectable()
export class PollIssueUpdatesEffects {
  private _store = inject(Store);
  private _actions$ = inject(Actions);
  private readonly _issueService = inject(IssueService);
  private readonly _workContextService = inject(WorkContextService);

  pollIssueTaskUpdatesActions$: Observable<unknown> = this._actions$.pipe(
    ofType(setActiveWorkContext, loadAllData),
  );
  pollIssueChangesForCurrentContext$: Observable<any> = createEffect(
    () =>
      this.pollIssueTaskUpdatesActions$.pipe(
        switchMap(() => this._store.select(selectEnabledIssueProviders).pipe(first())),
        // Get the list of enabled issue providers
        switchMap((enabledProviders: IssueProvider[]) => {
          const providers = enabledProviders
            // only for providers that have auto-polling enabled
            .filter((provider) => provider.isAutoPoll)
            // filter out providers with 0 poll interval (no polling)
            .filter(
              (provider) =>
                this._issueService.getPollInterval(provider.issueProviderKey) > 0,
            );

          // Handle empty providers case
          if (providers.length === 0) {
            return EMPTY;
          }

          // Use merge instead of forkJoin so each timer can emit independently
          // (forkJoin waits for all observables to complete, but timer never completes)
          return merge(
            ...providers.map((provider) =>
              timer(
                DELAY_BEFORE_ISSUE_POLLING,
                this._issueService.getPollInterval(provider.issueProviderKey),
              ).pipe(
                // => whenever the provider specific poll timer ticks:
                // ---------------------------------------------------
                // Get tasks to refresh based on provider type
                switchMap(() => this._getTasksForProvider(provider)),
                // Refresh issue tasks for the current provider
                // Use try-catch to prevent errors from killing the polling stream
                tap((issueTasks: Task[]) => {
                  if (issueTasks.length > 0) {
                    try {
                      this._issueService.refreshIssueTasks(issueTasks, provider);
                    } catch (err) {
                      IssueLog.error(
                        'Error polling issue updates for ' + provider.id,
                        err,
                      );
                    }
                  }
                }),
              ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  /**
   * Gets tasks to refresh for a provider.
   * For calendar (ICAL) providers, returns ALL calendar tasks across all projects
   * since calendar events can be assigned to any project.
   * For other providers, returns only tasks in the current work context.
   */
  private _getTasksForProvider(provider: IssueProvider): Observable<Task[]> {
    if (provider.issueProviderKey === ICAL_TYPE) {
      // For calendar providers, poll ALL calendar tasks across all projects
      // This ensures calendar event updates are synced regardless of which project is active
      return this._store.select(selectAllCalendarIssueTasks).pipe(
        first(),
        map((tasks) =>
          tasks.filter(
            (task) =>
              task.issueProviderId === provider.id &&
              // Safety: ensure task has valid issueId to prevent errors in refreshIssueTasks
              !!task.issueId,
          ),
        ),
      );
    }

    // For other providers, only poll tasks in the current context
    return this._workContextService.allTasksForCurrentContext$.pipe(
      first(),
      map((tasks: TaskWithSubTasks[]) =>
        tasks.filter(
          (task) =>
            task.issueProviderId === provider.id &&
            // Safety: ensure task has valid issueId
            !!task.issueId,
        ),
      ),
    );
  }
}
