import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { filter, concatMap, withLatestFrom, mergeMap, switchMap } from 'rxjs/operators';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { setCurrentTask, unsetCurrentTask } from '../../../tasks/store/task.actions';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { TaskService } from '../../../tasks/task.service';
import { LogseqCommonInterfacesService } from './logseq-common-interfaces.service';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { EMPTY, concat, of, from, Observable } from 'rxjs';
import { LogseqTaskWorkflow } from './logseq.model';
import { LogseqBlock } from './logseq-issue.model';
import { LOGSEQ_TYPE } from './logseq.const';
import { MatDialog } from '@angular/material/dialog';
import { DialogLogseqActivateTaskComponent } from './dialog-logseq-activate-task/dialog-logseq-activate-task.component';

@Injectable()
export class LogseqIssueEffects {
  private _actions$ = inject(Actions);
  private _taskService = inject(TaskService);
  private _logseqCommonService = inject(LogseqCommonInterfacesService);
  private _issueProviderService = inject(IssueProviderService);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _previousTaskId: string | null = null;
  private _openDialogTaskIds = new Set<string>();

  private _getMarkers(workflow: LogseqTaskWorkflow): {
    active: 'DOING' | 'NOW';
    stopped: 'TODO' | 'LATER';
    done: 'DONE';
  } {
    return workflow === 'NOW_LATER'
      ? { active: 'NOW', stopped: 'LATER', done: 'DONE' }
      : { active: 'DOING', stopped: 'TODO', done: 'DONE' };
  }

  // Effect: Start a new task (and stop previous task if any)
  updateBlockOnTaskStart$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        filter(({ id }) => !!id && id !== null),
        concatMap(({ id }) => {
          const previousId = this._previousTaskId;
          this._previousTaskId = id as string;

          // Build observables
          const operations: Observable<null>[] = [];

          // Stop previous task first (if any and different from new task)
          if (previousId && previousId !== id) {
            operations.push(
              this._taskService.getByIdOnce$(previousId).pipe(
                filter(
                  (task) =>
                    task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
                ),
                switchMap((task) =>
                  this._issueProviderService
                    .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                    .pipe(
                      mergeMap((cfg) => {
                        const markers = this._getMarkers(cfg.taskWorkflow);
                        return this._logseqCommonService
                          .updateBlockMarker(
                            task.issueId as string,
                            task.issueProviderId || '',
                            markers.stopped,
                          )
                          .then(() => of(null))
                          .catch(() => of(null));
                      }),
                    ),
                ),
                concatMap(() => of(null)),
              ),
            );
          }

          // Start new task
          operations.push(
            this._taskService.getByIdOnce$(id as string).pipe(
              filter(
                (task) =>
                  task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
              ),
              switchMap((task) =>
                this._issueProviderService
                  .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                  .pipe(
                    mergeMap((cfg) => {
                      const markers = this._getMarkers(cfg.taskWorkflow);
                      return this._logseqCommonService
                        .updateBlockMarker(
                          task.issueId as string,
                          task.issueProviderId || '',
                          markers.active,
                        )
                        .then(() => of(null))
                        .catch(() => of(null));
                    }),
                  ),
              ),
              concatMap(() => of(null)),
            ),
          );

          // Execute sequentially
          return concat(...operations).pipe(concatMap(() => EMPTY));
        }),
      ),
    { dispatch: false },
  );

  // Effect: Stop current task when it's unset
  updateBlockOnTaskStop$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(unsetCurrentTask),
        filter(() => !!this._previousTaskId),
        concatMap(() => {
          const currentId = this._previousTaskId;
          this._previousTaskId = null;

          if (!currentId) {
            return EMPTY;
          }

          return this._taskService.getByIdOnce$(currentId).pipe(
            filter(
              (task) => task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
            ),
            switchMap((task) =>
              this._issueProviderService
                .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                .pipe(
                  mergeMap((cfg) => {
                    const markers = this._getMarkers(cfg.taskWorkflow);
                    return this._logseqCommonService
                      .updateBlockMarker(
                        task.issueId as string,
                        task.issueProviderId || '',
                        markers.stopped,
                      )
                      .then(() => EMPTY)
                      .catch(() => this._handleOfflineError(task.issueId));
                  }),
                ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  // Effect: Update Logseq block to DONE when task is marked done
  updateBlockOnTaskDone$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        // Only sync manual changes, not issue updates
        filter(({ task }) => task.changes.issueWasUpdated !== true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        concatMap((task) => {
          // DONE is the same for both workflows
          return this._logseqCommonService
            .updateBlockMarker(task.issueId as string, task.issueProviderId || '', 'DONE')
            .then(() => EMPTY)
            .catch(() => this._handleOfflineError(task.issueId));
        }),
      ),
    { dispatch: false },
  );

  // Effect: Sync due date changes to Logseq SCHEDULED (from updateTask or Planner)
  updateScheduledOnDueDateChange$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.updateTask,
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          PlannerActions.planTaskForDay,
          PlannerActions.transferTask,
        ),
        concatMap((action) => {
          // Special handling for updateTask - only sync manual changes
          if (action.type === TaskSharedActions.updateTask.type) {
            const updateAction = action as ReturnType<
              typeof TaskSharedActions.updateTask
            >;
            const hasDueDateChange = updateAction.task.changes.dueDay !== undefined;
            const hasDueTimeChange = updateAction.task.changes.dueWithTime !== undefined;
            if (
              (!hasDueDateChange && !hasDueTimeChange) ||
              updateAction.task.changes.issueWasUpdated === true
            ) {
              return EMPTY;
            }
          }

          return this._taskService.getByIdOnce$((action as any).task.id);
        }),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        concatMap((task) =>
          this._logseqCommonService
            .updateIssueFromTask(task)
            .then(() => EMPTY)
            .catch(() => this._handleOfflineError(task.issueId)),
        ),
      ),
    { dispatch: false },
  );

  // Effect: Update Logseq block to stopped or active state when task is un-done
  updateBlockOnTaskUndone$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === false),
        // Only sync manual changes, not issue updates
        filter(({ task }) => task.changes.issueWasUpdated !== true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        withLatestFrom(this._taskService.currentTaskId$),
        switchMap(([task, currentTaskId]) =>
          this._issueProviderService
            .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
            .pipe(
              mergeMap((cfg) => {
                const markers = this._getMarkers(cfg.taskWorkflow);
                // If this is the current task, set to active (NOW/DOING), otherwise stopped (LATER/TODO)
                const marker =
                  currentTaskId === task.id ? markers.active : markers.stopped;
                return this._logseqCommonService
                  .updateBlockMarker(
                    task.issueId as string,
                    task.issueProviderId || '',
                    marker as 'TODO' | 'DOING' | 'LATER' | 'NOW' | 'DONE',
                  )
                  .then(() => EMPTY)
                  .catch(() => this._handleOfflineError(task.issueId));
              }),
            ),
        ),
      ),
    { dispatch: false },
  );

  // Effect: Show dialog when there's a discrepancy between SuperProd and Logseq
  promptActivateTaskWhenMarkerChanges$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.issueWasUpdated === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => {
          const isLogseqTask = task.issueType === LOGSEQ_TYPE && !!task.issueId;
          // Validate UUID format (must be string with UUID format, not a number)
          const isValidUuid =
            typeof task.issueId === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              task.issueId,
            );
          return isLogseqTask && isValidUuid;
        }),
        withLatestFrom(this._taskService.currentTaskId$),
        switchMap(([task, currentTaskId]) =>
          from(
            this._issueService.getById(
              LOGSEQ_TYPE,
              task.issueId as string,
              task.issueProviderId || '',
            ),
          ).pipe(
            switchMap((issue) => {
              if (!issue) {
                return EMPTY;
              }
              const block = issue as LogseqBlock;

              const isTaskActive = currentTaskId === task.id;
              const isBlockActive = block.marker === 'NOW' || block.marker === 'DOING';
              const isTaskDone = task.isDone;
              const isBlockDone = block.marker === 'DONE';

              // Detect discrepancies
              let discrepancyType: string | null = null;

              if (isBlockDone && !isTaskDone) {
                discrepancyType = 'LOGSEQ_DONE_SUPERPROD_NOT_DONE';
              } else if (!isBlockDone && isTaskDone) {
                discrepancyType = 'SUPERPROD_DONE_LOGSEQ_NOT_DONE';
              } else if (isBlockActive && !isTaskActive) {
                discrepancyType = 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE';
              } else if (isTaskActive && !isBlockActive && !isTaskDone) {
                discrepancyType = 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';
              }

              if (!discrepancyType) {
                return EMPTY;
              }

              // Check if dialog is already open for this task
              if (this._openDialogTaskIds.has(task.id)) {
                return EMPTY;
              }

              // Mark dialog as open for this task
              this._openDialogTaskIds.add(task.id);

              // Show dialog with discrepancy type
              const dialogRef = this._matDialog.open(DialogLogseqActivateTaskComponent, {
                restoreFocus: true,
                data: {
                  task,
                  block,
                  discrepancyType,
                },
              });

              // Remove task ID from set when dialog closes
              dialogRef.afterClosed().subscribe(() => {
                this._openDialogTaskIds.delete(task.id);
              });

              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  private _handleOfflineError(issueId?: string): typeof EMPTY {
    // Silently handle offline errors (already logged by API service)
    return EMPTY;
  }
}
