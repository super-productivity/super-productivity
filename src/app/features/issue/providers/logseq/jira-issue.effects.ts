import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { select, Store } from '@ngrx/store';
import {
  concatMap,
  filter,
  map,
  switchMap,
  take,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { JiraApiService } from './jira-api.service';
import { JiraIssueReduced } from './jira-issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { Task } from '../../../tasks/task.model';
import { TaskService } from '../../../tasks/task.service';
import { EMPTY, Observable, of, throwError, timer } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DialogJiraTransitionComponent } from './jira-view-components/dialog-jira-transition/dialog-jira-transition.component';
import { IssueLocalState, IssueProviderJira } from '../../issue.model';
import { IssueService } from '../../issue.service';
import { JIRA_TYPE } from '../../issue.const';
import { T } from '../../../../t.const';
import { JiraTransitionOption } from './jira.model';
import { setCurrentTask } from '../../../tasks/store/task.actions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { DialogJiraAddWorklogComponent } from './jira-view-components/dialog-jira-add-worklog/dialog-jira-add-worklog.component';
import { selectCurrentTaskParentOrCurrent } from '../../../tasks/store/task.selectors';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { DialogConfirmComponent } from '../../../../ui/dialog-confirm/dialog-confirm.component';
import { isJiraEnabled } from './is-jira-enabled.util';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { devError } from '../../../../util/dev-error';

@Injectable()
export class JiraIssueEffects {
  private readonly _actions$ = inject(Actions);
  private readonly _store$ = inject<Store<any>>(Store);
  private readonly _snackService = inject(SnackService);
  private readonly _taskService = inject(TaskService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueService = inject(IssueService);
  private readonly _matDialog = inject(MatDialog);

  // -----

  addWorkLog$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id.toString())),
        concatMap((task) =>
          task.parentId
            ? this._taskService
                .getByIdOnce$(task.parentId)
                .pipe(map((parent) => ({ mainTask: parent, subTask: task })))
            : of({ mainTask: task, subTask: undefined }),
        ),
        concatMap(({ mainTask, subTask }) =>
          mainTask.issueType === JIRA_TYPE && mainTask.issueId && mainTask.issueProviderId
            ? this._getCfgOnce$(mainTask.issueProviderId).pipe(
                tap((jiraCfg) => {
                  if (
                    subTask &&
                    jiraCfg.isWorklogEnabled &&
                    jiraCfg.isAddWorklogOnSubTaskDone
                  ) {
                    this._openWorklogDialog(
                      subTask,
                      assertTruthy(mainTask.issueId),
                      jiraCfg,
                    );
                  } else if (
                    jiraCfg.isAddWorklogOnSubTaskDone &&
                    !subTask &&
                    (!jiraCfg.isWorklogEnabled || !mainTask.subTaskIds.length)
                  ) {
                    this._openWorklogDialog(
                      mainTask,
                      mainTask.issueId as string,
                      jiraCfg,
                    );
                  }
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  // CHECK CONNECTION
  // ----------------
  // NOTE: we don't handle the case of a tag list with multiple and possibly different jira cfgs
  // we only handle the case when we are in a project. This also makes sense because this might
  // be the most likely scenario for us encountering lots of jira requests, which might get us
  // locked out from the server
  // NOTE2: this should work 99.9% of the time. It might however not always work when we switch
  // from a project with a working jira cfg to one with a non working one, but on the other hand
  // this is already complicated enough as is...
  // I am sorry future me O:)

  checkForReassignment: any = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        // only if a task is started
        filter(({ id }) => !!id),
        withLatestFrom(this._store$.pipe(select(selectCurrentTaskParentOrCurrent))),
        filter(
          ([, currentTaskOrParent]) =>
            !!currentTaskOrParent &&
            currentTaskOrParent.issueType === JIRA_TYPE &&
            !!currentTaskOrParent.issueId,
        ),
        concatMap(([, currentTaskOrParent]) => {
          if (!currentTaskOrParent.issueProviderId) {
            // Log warning but don't crash - task has issue data but no provider ID
            devError(
              `Task ${currentTaskOrParent.id} has Jira issue ` +
                `${currentTaskOrParent.issueId} but no issueProviderId. ` +
                `Issue features will be disabled for this task.`,
            );
            return EMPTY;
          }
          return this._getCfgOnce$(currentTaskOrParent.issueProviderId).pipe(
            map((jiraCfg) => ({ jiraCfg, currentTaskOrParent })),
          );
        }),
        filter(
          ({ jiraCfg, currentTaskOrParent }) =>
            isJiraEnabled(jiraCfg) && jiraCfg.isCheckToReAssignTicketOnTaskStart,
        ),
        // show every 15s max to give time for updates
        throttleTime(15000),
        // TODO there is probably a better way to to do this
        // TODO refactor to actions
        switchMap(({ jiraCfg, currentTaskOrParent }) => {
          return this._jiraApiService
            .getReducedIssueById$(assertTruthy(currentTaskOrParent.issueId), jiraCfg)
            .pipe(
              withLatestFrom(this._jiraApiService.getCurrentUser$(jiraCfg)),
              concatMap(([issue, currentUser]) => {
                const assignee = issue.assignee;

                if (!issue) {
                  return throwError({
                    [HANDLED_ERROR_PROP_STR]: 'Jira: Issue Data not found',
                  });
                } else if (
                  !issue.assignee ||
                  issue.assignee.accountId !== currentUser.accountId
                ) {
                  return this._matDialog
                    .open(DialogConfirmComponent, {
                      restoreFocus: true,
                      data: {
                        okTxt: T.F.JIRA.DIALOG_CONFIRM_ASSIGNMENT.OK,
                        translateParams: {
                          summary: issue.summary,
                          assignee: assignee ? assignee.displayName : 'nobody',
                        },
                        message: T.F.JIRA.DIALOG_CONFIRM_ASSIGNMENT.MSG,
                      },
                    })
                    .afterClosed()
                    .pipe(
                      switchMap((isConfirm) => {
                        return isConfirm
                          ? this._jiraApiService.updateAssignee$(
                              issue.id,
                              currentUser.accountId,
                              jiraCfg,
                            )
                          : EMPTY;
                      }),
                      // tap(() => {
                      // TODO fix
                      // this._jiraIssueService.updateIssueFromApi(issue.id, issue, false, false);
                      // }),
                    );
                } else {
                  return EMPTY;
                }
              }),
            );
        }),
      ),
    { dispatch: false },
  );

  // POLLING & UPDATES

  checkForStartTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        // only if a task is started
        filter(({ id }) => !!id),
        withLatestFrom(this._store$.pipe(select(selectCurrentTaskParentOrCurrent))),
        filter(
          ([, currentTaskOrParent]) =>
            currentTaskOrParent && currentTaskOrParent.issueType === JIRA_TYPE,
        ),
        concatMap(([, currentTaskOrParent]) => {
          if (!currentTaskOrParent.issueProviderId) {
            // Log warning but don't crash - task has issue data but no provider ID
            devError(
              `Task ${currentTaskOrParent.id} has Jira issue ` +
                `${currentTaskOrParent.issueId} but no issueProviderId. ` +
                `Issue features will be disabled for this task.`,
            );
            return EMPTY;
          }
          return this._getCfgOnce$(currentTaskOrParent.issueProviderId).pipe(
            map((jiraCfg) => ({ jiraCfg, currentTaskOrParent })),
          );
        }),
        filter(
          ({ jiraCfg, currentTaskOrParent }) =>
            isJiraEnabled(jiraCfg) && jiraCfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ jiraCfg, currentTaskOrParent }) =>
          this._handleTransitionForIssue(
            IssueLocalState.IN_PROGRESS,
            jiraCfg,
            currentTaskOrParent,
          ),
        ),
      ),
    { dispatch: false },
  );

  checkForDoneTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }): boolean => !!task.changes.isDone),
        // Guard against missing id and load full entity
        filter(({ task }) => task.id != null && task.id !== (undefined as any)),
        concatMap(({ task }) => this._taskService.getByIdOnce$(String(task.id))),
        filter((task: Task) => task && task.issueType === JIRA_TYPE),
        concatMap((task: Task) => {
          if (!task.issueProviderId) {
            // Log warning but don't crash - task has issue data but no provider ID
            devError(
              `Task ${task.id} has Jira issue ${task.issueId} but no issueProviderId. ` +
                `Issue features will be disabled for this task.`,
            );
            return EMPTY;
          }
          return this._getCfgOnce$(task.issueProviderId).pipe(
            map((jiraCfg) => ({ jiraCfg, task })),
          );
        }),
        filter(
          ({ jiraCfg, task }) =>
            isJiraEnabled(jiraCfg) && jiraCfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ jiraCfg, task }) => {
          return this._handleTransitionForIssue(IssueLocalState.DONE, jiraCfg, task);
        }),
      ),
    { dispatch: false },
  );

  private _handleTransitionForIssue(
    localState: IssueLocalState,
    jiraCfg: IssueProviderJira,
    task: Task,
  ): Observable<any> {
    const chosenTransition: JiraTransitionOption | undefined =
      jiraCfg.transitionConfig[localState];

    if (!task.issueId) {
      throw new Error('No issueId for task');
    }

    switch (chosenTransition) {
      case 'DO_NOT':
        return EMPTY;
      case 'ALWAYS_ASK':
        return this._jiraApiService
          .getReducedIssueById$(task.issueId, jiraCfg)
          .pipe(
            concatMap((issue) => this._openTransitionDialog(issue, localState, task)),
          );
      default:
        if (
          !chosenTransition ||
          !(typeof chosenTransition === 'object' && chosenTransition?.id)
        ) {
          this._snackService.open({
            msg: T.F.JIRA.S.NO_VALID_TRANSITION,
            type: 'ERROR',
          });
          // NOTE: we would kill the whole effect chain if we do this
          // return throwError({[HANDLED_ERROR_PROP_STR]: 'Jira: No valid transition configured'});
          return timer(2000).pipe(
            concatMap(() =>
              this._jiraApiService.getReducedIssueById$(
                assertTruthy(task.issueId),
                jiraCfg,
              ),
            ),
            concatMap((issue: JiraIssueReduced) =>
              this._openTransitionDialog(issue, localState, task),
            ),
          );
        }

        return this._jiraApiService.getReducedIssueById$(task.issueId, jiraCfg).pipe(
          concatMap((issue) => {
            if (!issue.status || issue.status.name !== chosenTransition.name) {
              return this._jiraApiService
                .transitionIssue$(issue.id, chosenTransition.id, jiraCfg)
                .pipe(
                  concatMap(() => {
                    this._snackService.open({
                      type: 'SUCCESS',
                      msg: T.F.JIRA.S.TRANSITION_SUCCESS,
                      translateParams: {
                        issueKey: `${issue.key}`,
                        chosenTransition: `${chosenTransition.name}`,
                      },
                    });
                    return this._issueService.refreshIssueTask(task, false, false);
                  }),
                );
            } else {
              // no transition required
              return EMPTY;
            }
          }),
        );
    }
  }

  private _openWorklogDialog(
    task: Task,
    issueId: string,
    jiraCfg: IssueProviderJira,
  ): void {
    this._jiraApiService
      .getReducedIssueById$(issueId, jiraCfg)
      .pipe(take(1))
      .subscribe((issue) => {
        this._matDialog.open(DialogJiraAddWorklogComponent, {
          restoreFocus: true,
          data: {
            issue,
            task,
          },
        });
      });
  }

  private _openTransitionDialog(
    issue: JiraIssueReduced,
    localState: IssueLocalState,
    task: Task,
  ): Observable<any> {
    return this._matDialog
      .open(DialogJiraTransitionComponent, {
        restoreFocus: true,
        data: {
          issue,
          localState,
          task,
        },
      })
      .afterClosed();
  }

  private _getCfgOnce$(issueProviderId: string): Observable<IssueProviderJira> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'JIRA');
  }
}
