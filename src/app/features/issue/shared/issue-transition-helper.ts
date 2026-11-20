import { Action, select, Store } from '@ngrx/store';
import { ofType } from '@ngrx/effects';
import { EMPTY, Observable, timer } from 'rxjs';
import { concatMap, filter, withLatestFrom } from 'rxjs/operators';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { T } from '../../../t.const';
import { assertTruthy } from '../../../util/assert-truthy';
import { devError } from '../../../util/dev-error';
import { setCurrentTask } from '../../tasks/store/task.actions';
import { selectCurrentTaskParentOrCurrent } from '../../tasks/store/task.selectors';
import { Task, TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { isWontDoTask } from '../../tasks/util/is-wont-do-task';
import { IssueLocalState, IssueProviderKey } from '../issue.model';
import { IssueService } from '../issue.service';

export interface NamedTransition {
  id: string | number;
  name: string;
}

export type IssueTransitionOption<TTransition extends NamedTransition> =
  | 'DO_NOT'
  | 'ALWAYS_ASK'
  | TTransition
  | string;

export interface IssueTransitionAdapter<
  TCfg,
  TIssue,
  TTransition extends NamedTransition,
> {
  issueType: IssueProviderKey;
  providerLabel: string;
  actions$: Observable<Action>;
  store$: Store;
  taskService: TaskService;
  snackService: SnackService;
  issueService: IssueService;
  getCfgOnce$: (issueProviderId: string) => Observable<TCfg>;
  isTransitionEnabled: (cfg: TCfg) => boolean;
  getChosenTransition: (
    cfg: TCfg,
    localState: IssueLocalState,
  ) => IssueTransitionOption<TTransition> | undefined;
  fetchIssue$: (issueId: string, cfg: TCfg) => Observable<TIssue>;
  isAlreadyInTargetStatus: (issue: TIssue, transition: TTransition) => boolean;
  transitionIssue$: (
    issue: TIssue,
    transition: TTransition,
    cfg: TCfg,
  ) => Observable<unknown>;
  openTransitionDialog$: (
    issue: TIssue,
    localState: IssueLocalState,
    task: TaskCopy,
  ) => Observable<unknown>;
  transitionSuccessMsg: string;
  getIssueKey: (issue: TIssue) => string;
}

const isValidTransitionObject = <TTransition extends NamedTransition>(
  option: IssueTransitionOption<TTransition> | undefined,
): option is TTransition =>
  typeof option === 'object' && option !== null && Boolean(option.id);

export const executeIssueTransition$ = <
  TCfg,
  TIssue,
  TTransition extends NamedTransition,
>(
  adapter: IssueTransitionAdapter<TCfg, TIssue, TTransition>,
  localState: IssueLocalState,
  cfg: TCfg,
  task: TaskCopy,
): Observable<unknown> => {
  const chosenTransition = adapter.getChosenTransition(cfg, localState);

  if (!task.issueId) {
    throw new Error('No issueId for task');
  }

  switch (chosenTransition) {
    case 'DO_NOT':
      return EMPTY;
    case 'ALWAYS_ASK':
      return adapter
        .fetchIssue$(task.issueId, cfg)
        .pipe(
          concatMap((issue) => adapter.openTransitionDialog$(issue, localState, task)),
        );
    default:
      if (!isValidTransitionObject(chosenTransition)) {
        adapter.snackService.open({
          msg: T.F.JIRA.S.NO_VALID_TRANSITION,
          type: 'ERROR',
        });
        return timer(2000).pipe(
          concatMap(() => adapter.fetchIssue$(assertTruthy(task.issueId), cfg)),
          concatMap((issue) => adapter.openTransitionDialog$(issue, localState, task)),
        );
      }

      return adapter.fetchIssue$(task.issueId, cfg).pipe(
        concatMap((issue) => {
          if (!adapter.isAlreadyInTargetStatus(issue, chosenTransition)) {
            return adapter.transitionIssue$(issue, chosenTransition, cfg).pipe(
              concatMap(() => {
                adapter.snackService.open({
                  type: 'SUCCESS',
                  msg: adapter.transitionSuccessMsg,
                  translateParams: {
                    issueKey: `${adapter.getIssueKey(issue)}`,
                    chosenTransition: `${chosenTransition.name}`,
                  },
                });
                return adapter.issueService.refreshIssueTask(task as Task, false, false);
              }),
            );
          }
          return EMPTY;
        }),
      );
  }
};

const resolveCfgAndTransition$ = <TCfg, TIssue, TTransition extends NamedTransition>(
  adapter: IssueTransitionAdapter<TCfg, TIssue, TTransition>,
  localState: IssueLocalState,
  task: TaskCopy,
): Observable<unknown> => {
  if (!task.issueProviderId) {
    devError(
      `Task ${task.id} has ${adapter.providerLabel} issue ` +
        `${task.issueId} but no issueProviderId. ` +
        `Issue features will be disabled for this task.`,
    );
    return EMPTY;
  }

  return adapter.getCfgOnce$(task.issueProviderId).pipe(
    filter((cfg) => adapter.isTransitionEnabled(cfg)),
    concatMap((cfg) => executeIssueTransition$(adapter, localState, cfg, task)),
  );
};

export const createStartIssueTransitionStream$ = <
  TCfg,
  TIssue,
  TTransition extends NamedTransition,
>(
  adapter: IssueTransitionAdapter<TCfg, TIssue, TTransition>,
): Observable<unknown> =>
  adapter.actions$.pipe(
    ofType(setCurrentTask),
    filter(({ id }) => !!id),
    withLatestFrom(adapter.store$.pipe(select(selectCurrentTaskParentOrCurrent))),
    filter(
      (input): input is [(typeof input)[0], Readonly<TaskCopy>] =>
        input[1] != null && input[1].issueType === adapter.issueType,
    ),
    concatMap(([, currentTaskOrParent]) =>
      resolveCfgAndTransition$(adapter, IssueLocalState.IN_PROGRESS, currentTaskOrParent),
    ),
  );

export const createDoneIssueTransitionStream$ = <
  TCfg,
  TIssue,
  TTransition extends NamedTransition,
>(
  adapter: IssueTransitionAdapter<TCfg, TIssue, TTransition>,
): Observable<unknown> =>
  adapter.actions$.pipe(
    ofType(TaskSharedActions.updateTask),
    filter(({ task }): boolean => !!task.changes.isDone),
    filter(({ task }) => task.id != null && task.id !== undefined),
    concatMap(({ task }) => adapter.taskService.getByIdOnce$(String(task.id))),
    filter(
      (task: Task) =>
        !!task && task.issueType === adapter.issueType && !isWontDoTask(task),
    ),
    concatMap((task: Task) =>
      resolveCfgAndTransition$(adapter, IssueLocalState.DONE, task),
    ),
  );
