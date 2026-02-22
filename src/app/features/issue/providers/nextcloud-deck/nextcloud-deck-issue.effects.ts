import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { TaskService } from '../../../tasks/task.service';
import { concatMap, filter, first, map } from 'rxjs/operators';
import { IssueService } from '../../issue.service';
import { Observable } from 'rxjs';
import { Task } from 'src/app/features/tasks/task.model';
import { NEXTCLOUD_DECK_TYPE } from '../../issue.const';
import { isNextcloudDeckEnabled } from './is-nextcloud-deck-enabled.util';
import { NextcloudDeckApiService } from './nextcloud-deck-api.service';
import { NextcloudDeckCfg } from './nextcloud-deck.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';

@Injectable()
export class NextcloudDeckIssueEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _nextcloudDeckApiService = inject(NextcloudDeckApiService);
  private readonly _issueService = inject(IssueService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _taskService = inject(TaskService);

  checkForDoneTransition$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(
          ({ task }): boolean => 'isDone' in task.changes || 'title' in task.changes,
        ),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id.toString())),
        filter((task: Task) => task && task.issueType === NEXTCLOUD_DECK_TYPE),
        concatMap((task: Task) => {
          if (!task.issueProviderId) {
            throw new Error('No issueProviderId for task');
          }
          return this._issueProviderService
            .getCfgOnce$(task.issueProviderId, 'NEXTCLOUD_DECK')
            .pipe(map((cfg) => ({ cfg, task })));
        }),
        filter(
          ({ cfg, task }) => isNextcloudDeckEnabled(cfg) && cfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ cfg, task }) => {
          return this._handleTransitionForIssue$(cfg, task);
        }),
      ),
    { dispatch: false },
  );

  private _handleTransitionForIssue$(
    cfg: NextcloudDeckCfg,
    task: Task,
  ): Observable<unknown> {
    const issueId = assertTruthy(task.issueId);
    const cardId = typeof issueId === 'string' ? parseInt(issueId, 10) : issueId;
    const boardId = assertTruthy(cfg.selectedBoardId);

    return this._nextcloudDeckApiService.getById$(cardId, cfg).pipe(
      first(),
      concatMap((issue) => {
        if (!issue) {
          throw new Error('Card not found: ' + cardId);
        }
        return this._nextcloudDeckApiService
          .updateCard$(cfg, boardId, issue.stackId, cardId, {
            title: task.title,
            done: task.isDone,
          })
          .pipe(
            concatMap(() => {
              if (task.isDone && cfg.doneStackId && issue.stackId !== cfg.doneStackId) {
                return this._nextcloudDeckApiService.reorderCard$(
                  cfg,
                  boardId,
                  issue.stackId,
                  cardId,
                  cfg.doneStackId,
                  0,
                );
              }
              return [null];
            }),
            concatMap(() => this._issueService.refreshIssueTask(task, true)),
          );
      }),
    );
  }
}
