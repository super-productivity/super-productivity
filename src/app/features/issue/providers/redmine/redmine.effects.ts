import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { concatMap, filter, map, take, tap } from 'rxjs/operators';
import { REDMINE_TYPE } from '../../issue.const';
import { MatDialog } from '@angular/material/dialog';
import { Task } from '../../../tasks/task.model';
import { RedmineCfg } from './redmine.model';
import { EMPTY, Observable, of } from 'rxjs';
import { DialogRedmineTrackTimeComponent } from './dialog-redmine-track-time/dialog-redmine-track-time.component';
import { RedmineApiService } from './redmine-api.service';
import { TaskService } from '../../../tasks/task.service';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';

@Injectable()
export class RedmineEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _redmineApiService = inject(RedmineApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);

  postTime$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => !!task),
        concatMap((task) =>
          task.parentId
            ? this._taskService
                .getByIdOnce$(task.parentId)
                .pipe(map((parent) => ({ mainTask: parent, subTask: task })))
            : of({ mainTask: task, subTask: undefined }),
        ),
        filter(({ mainTask }) => !!mainTask),
        concatMap(({ mainTask, subTask }) =>
          mainTask.issueType === REDMINE_TYPE &&
          mainTask.issueId &&
          mainTask.issueProviderId
            ? this._getCfgOnce$(mainTask.issueProviderId).pipe(
                tap((redmineCfg) => {
                  if (
                    subTask &&
                    redmineCfg.isShowTimeTrackingDialogForEachSubTask &&
                    redmineCfg.isShowTimeTrackingDialog
                  ) {
                    this._openTrackTimeDialog(
                      subTask,
                      +assertTruthy(mainTask.issueId),
                      redmineCfg,
                    );
                  } else if (
                    redmineCfg.isShowTimeTrackingDialog &&
                    !subTask &&
                    (!redmineCfg.isShowTimeTrackingDialogForEachSubTask ||
                      !mainTask.subTaskIds.length)
                  ) {
                    this._openTrackTimeDialog(
                      mainTask,
                      +assertTruthy(mainTask.issueId),
                      redmineCfg,
                    );
                  }
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  private _openTrackTimeDialog(
    task: Task,
    issueId: number,
    redmineCfg: RedmineCfg,
  ): void {
    this._redmineApiService
      .getById$(issueId, redmineCfg)
      .pipe(take(1))
      .subscribe((redmineIssue) => {
        this._matDialog.open(DialogRedmineTrackTimeComponent, {
          restoreFocus: true,
          data: {
            redmineIssue,
            task,
          },
        });
      });
  }

  private _getCfgOnce$(issueProviderId: string): Observable<RedmineCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'REDMINE');
  }
}
