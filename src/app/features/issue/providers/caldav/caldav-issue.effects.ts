import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { TaskService } from '../../../tasks/task.service';
import { concatMap, filter, map } from 'rxjs/operators';
import { IssueService } from '../../issue.service';
import { Observable } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { CALDAV_TYPE } from '../../issue.const';
import { isCaldavEnabled } from './is-caldav-enabled.util';
import { CaldavClientService } from './caldav-client.service';
import { CaldavCfg } from './caldav.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';

@Injectable()
export class CaldavIssueEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _caldavClientService = inject(CaldavClientService);
  private readonly _issueService = inject(IssueService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _taskService = inject(TaskService);

  // TODO only check if there are active issue tasks for current list
  checkForDoneTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(
          ({ task }): boolean => 'isDone' in task.changes || 'title' in task.changes,
        ),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id.toString())),
        filter((task: Task) => task && task.issueType === CALDAV_TYPE),
        concatMap((task: Task) => {
          if (!task.issueProviderId) {
            throw new Error('No issueProviderId for task');
          }
          return this._issueProviderService
            .getCfgOnce$(task.issueProviderId, 'CALDAV')
            .pipe(map((caldavCfg) => ({ caldavCfg, task })));
        }),
        filter(
          ({ caldavCfg: caldavCfg, task }) =>
            isCaldavEnabled(caldavCfg) && caldavCfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ caldavCfg: caldavCfg, task }) => {
          return this._handleTransitionForIssue$(caldavCfg, task);
        }),
      ),
    { dispatch: false },
  );

  private _handleTransitionForIssue$(caldavCfg: CaldavCfg, task: Task): Observable<any> {
    return this._caldavClientService
      .updateState$(caldavCfg, assertTruthy(task.issueId), task.isDone, task.title)
      .pipe(concatMap(() => this._issueService.refreshIssueTask(task, true)));
  }
}
