import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  filter,
  concatMap,
  withLatestFrom,
  mergeMap,
  switchMap,
  take,
  bufferTime,
  tap,
} from 'rxjs/operators';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { setCurrentTask, unsetCurrentTask } from '../../../tasks/store/task.actions';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { TaskService } from '../../../tasks/task.service';
import { LogseqCommonInterfacesService } from './logseq-common-interfaces.service';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { EMPTY, concat, of, from, Observable, Subject } from 'rxjs';
import { LogseqTaskWorkflow, LogseqCfg } from './logseq.model';
import { LogseqBlock } from './logseq-issue.model';
import { LOGSEQ_TYPE } from './logseq.const';
import { MatDialog } from '@angular/material/dialog';
import { PluginDialogComponent } from '../../../../plugins/ui/plugin-dialog/plugin-dialog.component';
import { Store } from '@ngrx/store';
import { Task } from '../../../tasks/task.model';

type DiscrepancyType =
  | 'LOGSEQ_DONE_SUPERPROD_NOT_DONE'
  | 'SUPERPROD_DONE_LOGSEQ_NOT_DONE'
  | 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE'
  | 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';

interface DiscrepancyItem {
  task: Task;
  block: LogseqBlock;
  discrepancyType: DiscrepancyType;
}

@Injectable()
export class LogseqIssueEffects {
  private _actions$ = inject(Actions);
  private _taskService = inject(TaskService);
  private _logseqCommonService = inject(LogseqCommonInterfacesService);
  private _issueProviderService = inject(IssueProviderService);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _previousTaskId: string | null = null;
  private _discrepancies$ = new Subject<DiscrepancyItem>();
  private _isDialogOpen = false;

  private _getMarkers(workflow: LogseqTaskWorkflow): {
    active: 'DOING' | 'NOW';
    stopped: 'TODO' | 'LATER';
    done: 'DONE';
  } {
    return workflow === 'NOW_LATER'
      ? { active: 'NOW', stopped: 'LATER', done: 'DONE' }
      : { active: 'DOING', stopped: 'TODO', done: 'DONE' };
  }

  private _getDialogTitle(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Task in Logseq abgeschlossen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'Task in Super Productivity abgeschlossen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Task in Logseq gestartet';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Task in Super Productivity aktiv';
    }
  }

  private _getDialogMessage(discrepancyType: DiscrepancyType, taskTitle: string): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return `Der Task "${taskTitle}" wurde in Logseq als DONE markiert.`;
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return `Der Task "${taskTitle}" wurde in Super Productivity abgeschlossen, ist aber in Logseq noch nicht DONE.`;
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return `Der Task "${taskTitle}" wurde in Logseq gestartet (Marker auf NOW/DOING gesetzt).`;
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return `Der Task "${taskTitle}" ist in Super Productivity aktiv, aber in Logseq nicht als NOW/DOING markiert.`;
    }
  }

  private _getLogseqActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Logseq auf TODO/LATER setzen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'Logseq auf DONE setzen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Logseq auf TODO/LATER setzen';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Logseq auf NOW/DOING setzen';
    }
  }

  private _getSuperProdActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return 'Abschließen';
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return 'SuperProd auf nicht-DONE setzen';
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return 'Aktivieren';
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return 'Task deaktivieren';
    }
  }

  private async _performLogseqAction(
    discrepancyType: DiscrepancyType,
    task: Task,
  ): Promise<void> {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Reset Logseq block to TODO/LATER
        if (task.issueId && task.issueProviderId) {
          const cfg = await this._issueProviderService
            .getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE)
            .toPromise();
          if (cfg) {
            const markers = this._getMarkers((cfg as LogseqCfg).taskWorkflow);
            await this._logseqCommonService.updateBlockMarker(
              task.issueId as string,
              task.issueProviderId,
              markers.stopped,
            );
          }
        }
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Mark block as DONE in Logseq
        if (task.issueId && task.issueProviderId) {
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            'DONE',
          );
        }
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Set block to NOW/DOING in Logseq
        if (task.issueId && task.issueProviderId) {
          const cfg = await this._issueProviderService
            .getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE)
            .toPromise();
          if (cfg) {
            const markers = this._getMarkers((cfg as LogseqCfg).taskWorkflow);
            await this._logseqCommonService.updateBlockMarker(
              task.issueId as string,
              task.issueProviderId,
              markers.active,
            );
          }
        }
        break;
    }
  }

  private _performSuperProdAction(discrepancyType: DiscrepancyType, task: Task): void {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        // Mark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: true },
            },
          }),
        );
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Unmark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: false },
            },
          }),
        );
        break;

      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Activate task in SuperProd
        this._store.dispatch(setCurrentTask({ id: task.id }));
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Deactivate task in SuperProd
        this._store.dispatch(unsetCurrentTask());
        break;
    }
  }

  private _saveCurrentLogseqState(task: Task, block: LogseqBlock): void {
    // Save current Logseq state to prevent dialog from reappearing
    // User has acknowledged the discrepancy and chosen to ignore it
    // IMPORTANT: Set issueWasUpdated to prevent other effects from syncing to Logseq
    this._taskService.update(task.id, {
      issueMarker: block.marker,
      isDone: block.marker === 'DONE',
      issueWasUpdated: true,
    });
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
                      .catch(() => this._handleOfflineError());
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
            .catch(() => this._handleOfflineError());
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
            .catch(() => this._handleOfflineError()),
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
                  .catch(() => this._handleOfflineError());
              }),
            ),
        ),
      ),
    { dispatch: false },
  );

  // Effect: Show dialog when there's a discrepancy between SuperProd and Logseq
  // This effect triggers when a task is updated, started, or stopped
  promptActivateTaskWhenMarkerChanges$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask, setCurrentTask, unsetCurrentTask),
        concatMap((action) => {
          // Handle different action types
          if (action.type === TaskSharedActions.updateTask.type) {
            const updateAction = action as ReturnType<
              typeof TaskSharedActions.updateTask
            >;
            return this._taskService
              .getByIdOnce$(updateAction.task.id as string)
              .pipe(filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId));
          } else if (action.type === setCurrentTask.type) {
            const setAction = action as ReturnType<typeof setCurrentTask>;
            if (setAction.id) {
              return this._taskService.getByIdOnce$(setAction.id);
            }
          } else if (action.type === unsetCurrentTask.type) {
            // When task is unset, check if previous task was a Logseq task
            return this._taskService.currentTaskId$.pipe(
              take(1),
              filter((id): id is string => !!id),
              concatMap((id) => this._taskService.getByIdOnce$(id)),
            );
          }
          return EMPTY;
        }),
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
        mergeMap(([task, currentTaskId]) =>
          from(
            this._issueService.getById(
              LOGSEQ_TYPE,
              task.issueId as string,
              task.issueProviderId || '',
            ),
          ).pipe(
            mergeMap((issue) => {
              console.log('[LOGSEQ DETECT] Checking task:', task.id, task.title);

              if (!issue) {
                console.log('[LOGSEQ DETECT] No issue found for task:', task.id);
                return EMPTY;
              }
              const block = issue as LogseqBlock;

              const isTaskActive = currentTaskId === task.id;
              const isBlockActive = block.marker === 'NOW' || block.marker === 'DOING';
              const isTaskDone = task.isDone;
              const isBlockDone = block.marker === 'DONE';

              console.log('[LOGSEQ DETECT] Status:', {
                taskId: task.id,
                taskTitle: task.title,
                isTaskActive,
                isBlockActive,
                isTaskDone,
                isBlockDone,
                blockMarker: block.marker,
                currentTaskId,
              });

              // Detect discrepancies
              let discrepancyType: DiscrepancyType | null = null;

              if (isBlockDone && !isTaskDone) {
                discrepancyType = 'LOGSEQ_DONE_SUPERPROD_NOT_DONE';
              } else if (!isBlockDone && isTaskDone) {
                discrepancyType = 'SUPERPROD_DONE_LOGSEQ_NOT_DONE';
              } else if (isBlockActive && !isTaskActive) {
                discrepancyType = 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE';
              } else if (isTaskActive && !isBlockActive && !isTaskDone) {
                discrepancyType = 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE';
              }

              console.log('[LOGSEQ DETECT] Discrepancy type:', discrepancyType);

              if (!discrepancyType) {
                console.log(
                  '[LOGSEQ DETECT] No discrepancy found, skipping task:',
                  task.id,
                );
                return EMPTY;
              }

              console.log('[LOGSEQ DETECT] Pushing to buffer:', {
                taskId: task.id,
                taskTitle: task.title,
                discrepancyType,
              });

              // Push discrepancy to subject for buffering
              // Note: Don't check _openDialogTaskIds here, as it would block multiple tasks
              // from being collected in the buffer. The dialog itself prevents duplicates.
              this._discrepancies$.next({
                task,
                block,
                discrepancyType,
              });

              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  // Effect: Buffer discrepancies and show them in a single dialog
  // Note: Uses 2000ms buffer to catch all discrepancies from polling updates
  showDiscrepancyDialog$ = createEffect(
    () =>
      this._discrepancies$.pipe(
        bufferTime(2000),
        tap((discrepancies) => {
          console.log('[LOGSEQ BUFFER] Buffered discrepancies:', discrepancies.length);
        }),
        filter((discrepancies) => discrepancies.length > 0),
        filter(() => !this._isDialogOpen),
        tap((discrepancies) => {
          console.log(
            '[LOGSEQ BUFFER] Opening dialog with',
            discrepancies.length,
            'discrepancies',
          );
          this._isDialogOpen = true;
          this._showDiscrepancyDialog(discrepancies);
        }),
      ),
    { dispatch: false },
  );

  private _showDiscrepancyDialog(discrepancies: DiscrepancyItem[]): void {
    console.log('[LOGSEQ DIALOG] Show dialog with discrepancies:', discrepancies);

    // Group discrepancies by type
    const activeDiscrepancies = discrepancies.filter(
      (d) =>
        d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE' ||
        d.discrepancyType === 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE',
    );
    const doneDiscrepancies = discrepancies.filter(
      (d) =>
        d.discrepancyType === 'LOGSEQ_DONE_SUPERPROD_NOT_DONE' ||
        d.discrepancyType === 'SUPERPROD_DONE_LOGSEQ_NOT_DONE',
    );

    console.log(
      '[LOGSEQ DIALOG] Active:',
      activeDiscrepancies.length,
      'Done:',
      doneDiscrepancies.length,
    );

    // Remove duplicates by task ID
    const uniqueDiscrepancies = discrepancies.reduce((acc, curr) => {
      if (!acc.find((d) => d.task.id === curr.task.id)) {
        acc.push(curr);
      }
      return acc;
    }, [] as DiscrepancyItem[]);

    console.log('[LOGSEQ DIALOG] Unique discrepancies:', uniqueDiscrepancies.length);

    // Build HTML content
    const htmlContent = this._buildDiscrepancyHtmlContent(
      activeDiscrepancies,
      doneDiscrepancies,
    );

    // Build buttons
    const buttons = this._buildDiscrepancyButtons(
      uniqueDiscrepancies,
      activeDiscrepancies,
    );

    // Show dialog
    const dialogRef = this._matDialog.open(PluginDialogComponent, {
      restoreFocus: true,
      width: '600px',
      data: {
        title: this._getDialogTitleForMultiple(uniqueDiscrepancies.length),
        htmlContent,
        buttons,
      },
    });

    dialogRef.afterClosed().subscribe(() => {
      this._isDialogOpen = false;
    });
  }

  private _getDialogTitleForMultiple(count: number): string {
    return count === 1
      ? 'Logseq Diskrepanz gefunden'
      : `${count} Logseq Diskrepanzen gefunden`;
  }

  private _buildDiscrepancyHtmlContent(
    activeDiscrepancies: DiscrepancyItem[],
    doneDiscrepancies: DiscrepancyItem[],
  ): string {
    let html = '<div style="margin-bottom: 16px;">';

    // Special case: Multiple active tasks
    if (activeDiscrepancies.length > 1) {
      const logseqActiveCount = activeDiscrepancies.filter(
        (d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
      ).length;

      if (logseqActiveCount > 1) {
        html +=
          '<p><strong>Mehrere Tasks sind in Logseq als NOW/DOING markiert:</strong></p>';
        html +=
          '<p style="margin-bottom: 12px;">In Super Productivity kann nur ein Task aktiv sein. Welchen möchten Sie aktivieren?</p>';
        html += '<div id="active-task-list" style="margin-left: 16px;">';

        activeDiscrepancies
          .filter((d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE')
          .forEach((d, index) => {
            html += `
            <div style="margin-bottom: 8px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="radio" name="activeTask" value="${d.task.id}" ${index === 0 ? 'checked' : ''} style="margin-right: 8px;">
                <span>${this._escapeHtml(d.task.title)}</span>
              </label>
            </div>
          `;
          });

        html += '</div>';
        return html + '</div>';
      }
    }

    // Standard case: Show all discrepancies grouped
    if (activeDiscrepancies.length > 0) {
      html += `<p><strong>🟢 Aktive Tasks (${activeDiscrepancies.length}):</strong></p>`;
      html += '<ul style="margin-left: 20px; margin-bottom: 12px;">';
      activeDiscrepancies.forEach((d) => {
        html += `<li>${this._escapeHtml(d.task.title)} - ${this._getDialogMessage(d.discrepancyType, d.task.title)}</li>`;
      });
      html += '</ul>';
    }

    if (doneDiscrepancies.length > 0) {
      html += `<p><strong>✅ Abgeschlossene Tasks (${doneDiscrepancies.length}):</strong></p>`;
      html += '<ul style="margin-left: 20px; margin-bottom: 12px;">';
      doneDiscrepancies.forEach((d) => {
        html += `<li>${this._escapeHtml(d.task.title)} - ${this._getDialogMessage(d.discrepancyType, d.task.title)}</li>`;
      });
      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  private _buildDiscrepancyButtons(
    allDiscrepancies: DiscrepancyItem[],
    activeDiscrepancies: DiscrepancyItem[],
  ): any[] {
    const logseqActiveCount = activeDiscrepancies.filter(
      (d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
    ).length;

    // Special buttons for multiple active tasks
    if (logseqActiveCount > 1) {
      return [
        {
          label: 'Ausgewählten aktivieren, andere deaktivieren',
          color: 'primary',
          onClick: async () => {
            const selectedRadio = document.querySelector<HTMLInputElement>(
              'input[name="activeTask"]:checked',
            );
            if (selectedRadio) {
              const selectedTaskId = selectedRadio.value;
              const selectedTask = activeDiscrepancies.find(
                (d) => d.task.id === selectedTaskId,
              );

              if (selectedTask) {
                // Activate selected task in SuperProd
                this._store.dispatch(setCurrentTask({ id: selectedTaskId }));

                // Deactivate all others in Logseq
                for (const d of activeDiscrepancies) {
                  if (d.task.id !== selectedTaskId) {
                    await this._performLogseqAction(
                      'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
                      d.task,
                    );
                  }
                }
              }
            }
          },
        },
        {
          label: 'Alle in Logseq deaktivieren (TODO/LATER)',
          color: 'accent',
          onClick: async () => {
            for (const d of activeDiscrepancies.filter(
              (item) => item.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
            )) {
              await this._performLogseqAction(d.discrepancyType, d.task);
            }
          },
        },
        {
          label: 'Alle ignorieren',
          onClick: () => {
            allDiscrepancies.forEach((d) => {
              this._saveCurrentLogseqState(d.task, d.block);
            });
          },
        },
      ];
    }

    // Standard buttons for mixed or single discrepancies
    return [
      {
        label: 'Alle in Logseq synchronisieren',
        color: 'accent',
        onClick: async () => {
          for (const d of allDiscrepancies) {
            await this._performLogseqAction(d.discrepancyType, d.task);
          }
        },
      },
      {
        label: 'Alle in SuperProd synchronisieren',
        color: 'primary',
        onClick: () => {
          allDiscrepancies.forEach((d) => {
            this._performSuperProdAction(d.discrepancyType, d.task);
          });
        },
      },
      {
        label: 'Alle ignorieren',
        onClick: () => {
          allDiscrepancies.forEach((d) => {
            this._saveCurrentLogseqState(d.task, d.block);
          });
        },
      },
    ];
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private _handleOfflineError(): typeof EMPTY {
    // Silently handle offline errors (already logged by API service)
    return EMPTY;
  }
}
