import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  filter,
  concatMap,
  withLatestFrom,
  mergeMap,
  switchMap,
  debounceTime,
  tap,
  buffer,
} from 'rxjs/operators';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { setCurrentTask, unsetCurrentTask } from '../../../tasks/store/task.actions';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { TaskService } from '../../../tasks/task.service';
import {
  LogseqCommonInterfacesService,
  DiscrepancyItem,
  DiscrepancyType,
} from './logseq-common-interfaces.service';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { EMPTY, concat, of, Observable, firstValueFrom } from 'rxjs';
import { LogseqTaskWorkflow, LogseqCfg } from './logseq.model';
import { LOGSEQ_TYPE } from './logseq.const';
import { LogseqLog } from '../../../../core/log';
import { MatDialog } from '@angular/material/dialog';
import { PluginDialogComponent } from '../../../../plugins/ui/plugin-dialog/plugin-dialog.component';
import { Store } from '@ngrx/store';
import { Task } from '../../../tasks/task.model';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../../t.const';

@Injectable()
export class LogseqIssueEffects {
  private _actions$ = inject(Actions);
  private _taskService = inject(TaskService);
  private _logseqCommonService = inject(LogseqCommonInterfacesService);
  private _issueProviderService = inject(IssueProviderService);
  private _issueService = inject(IssueService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _previousTaskId: string | null = null;
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
    const params = { title: taskTitle };
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.DONE_IN_LOGSEQ,
          params,
        );
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.DONE_IN_SUPERPROD,
          params,
        );
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.ACTIVE_IN_LOGSEQ,
          params,
        );
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.ACTIVE_IN_SUPERPROD,
          params,
        );
    }
  }

  private _getLogseqActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_TODO);
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_DONE);
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_TODO);
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_DOING);
    }
  }

  private _getSuperProdActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.COMPLETE);
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.SET_SUPERPROD_NOT_DONE,
        );
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.ACTIVATE);
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.DEACTIVATE_TASK);
    }
  }

  private async _performLogseqAction(
    discrepancyType: DiscrepancyType,
    task: Task,
  ): Promise<void> {
    if (!task.issueId || !task.issueProviderId) {
      return;
    }

    let updatedMarker: string | null = null;

    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Reset Logseq block to TODO/LATER
        const cfg1 = await firstValueFrom(
          this._issueProviderService.getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE),
        );
        if (cfg1) {
          const markers = this._getMarkers((cfg1 as LogseqCfg).taskWorkflow);
          updatedMarker = markers.stopped;
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            markers.stopped,
          );
        }
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Mark block as DONE in Logseq
        updatedMarker = 'DONE';
        await this._logseqCommonService.updateBlockMarker(
          task.issueId as string,
          task.issueProviderId,
          'DONE',
        );
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Set block to NOW/DOING in Logseq
        const cfg2 = await firstValueFrom(
          this._issueProviderService.getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE),
        );
        if (cfg2) {
          const markers = this._getMarkers((cfg2 as LogseqCfg).taskWorkflow);
          updatedMarker = markers.active;
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            markers.active,
          );
        }
        break;
    }

    // Update :SP: drawer and task state to prevent false positives on next poll
    if (updatedMarker !== null) {
      // Update :SP: drawer with current sync state
      await this._logseqCommonService.updateSpDrawer(
        task.issueId as string,
        task.issueProviderId,
      );

      // Fetch updated block to refresh task details display
      const updatedBlock = await this._logseqCommonService.getById(
        task.issueId as string,
        task.issueProviderId,
      );

      // Refresh issue data in task detail panel
      if (updatedBlock) {
        this._issueService.refreshIssueData(
          task.issueProviderId,
          task.issueId as string,
          updatedBlock,
        );
      }

      this._taskService.update(task.id, {
        isDone: updatedMarker === 'DONE',
        // Don't mark as "updated" for marker-only changes
        issueWasUpdated: false,
      });
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
        // Only sync manual changes, not issue/polling updates
        filter(({ task }) => task.changes.issueWasUpdated === undefined),
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
            // Skip if no due date change, or if this is an issue/polling update
            if (
              (!hasDueDateChange && !hasDueTimeChange) ||
              updateAction.task.changes.issueWasUpdated !== undefined
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
        // Only sync manual changes, not issue/polling updates
        // issueWasUpdated is undefined for manual actions, false for marker polling, true for content polling
        filter(({ task }) => task.changes.issueWasUpdated === undefined),
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

  // Effect: Buffer discrepancies from polling and show them in a single dialog
  // Discrepancies are emitted by LogseqCommonInterfacesService.discrepancies$
  // Uses debounce to collect all discrepancies from a poll cycle before showing dialog
  showDiscrepancyDialog$ = createEffect(
    () =>
      this._logseqCommonService.discrepancies$.pipe(
        buffer(this._logseqCommonService.discrepancies$.pipe(debounceTime(500))),
        tap((discrepancies) => {
          LogseqLog.debug(
            '[LOGSEQ BUFFER] Buffered discrepancies:',
            discrepancies.length,
          );
        }),
        filter((discrepancies) => discrepancies.length > 0),
        filter(() => !this._isDialogOpen),
        tap((discrepancies) => {
          LogseqLog.debug(
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
    LogseqLog.debug('[LOGSEQ DIALOG] Show dialog with discrepancies:', discrepancies);

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

    LogseqLog.debug(
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

    LogseqLog.debug('[LOGSEQ DIALOG] Unique discrepancies:', uniqueDiscrepancies.length);

    // Build HTML content
    const htmlContent = this._buildDiscrepancyHtmlContent(
      activeDiscrepancies,
      doneDiscrepancies,
    );

    // Build buttons
    const buttons = this._buildDiscrepancyButtons(
      uniqueDiscrepancies,
      activeDiscrepancies,
      doneDiscrepancies,
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

    // Check for active tasks in Logseq (DOING/NOW)
    const logseqActiveDiscrepancies = activeDiscrepancies.filter(
      (d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
    );
    const hasLogseqActive = logseqActiveDiscrepancies.length >= 1;

    // Active tasks in Logseq - show radio selection (always, even for single task)
    if (hasLogseqActive) {
      const headerText =
        logseqActiveDiscrepancies.length > 1
          ? this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.MULTIPLE_ACTIVE_IN_LOGSEQ,
            )
          : this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.SINGLE_ACTIVE_IN_LOGSEQ,
            );
      const whichToActivate = this._translateService.instant(
        T.F.LOGSEQ.DISCREPANCY.WHICH_TO_ACTIVATE,
      );
      const activateNone = this._translateService.instant(
        T.F.LOGSEQ.DISCREPANCY.ACTIVATE_NONE,
      );
      html += `<p><strong>${headerText}</strong></p>`;
      html += `<p style="margin-bottom: 12px;">${whichToActivate}</p>`;
      html += '<div id="active-task-list" style="margin-left: 16px;">';

      // Option to activate none
      html += `
            <div style="margin-bottom: 8px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="radio" name="activeTask" value="__none__" style="margin-right: 8px;">
                <span style="font-style: italic; color: #888;">${activateNone}</span>
              </label>
            </div>
          `;

      logseqActiveDiscrepancies.forEach((d, index) => {
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
    }

    // Add CSS for toggle button styling (used by both ACTIVE and DONE)
    if (activeDiscrepancies.length > 0 || doneDiscrepancies.length > 0) {
      html += `<style>
        .toggle-label { padding:4px 10px;cursor:pointer;background:transparent;color:inherit; }
        .toggle-label-right { border-left:1px solid #666; }
        input:checked + .toggle-label { background:#1976d2;color:white; }
      </style>`;
    }

    // Single/few active discrepancies with per-task toggle (not multiple DOING from Logseq)
    if (!hasLogseqActive && activeDiscrepancies.length > 0) {
      const activeTasksLabel = this._translateService.instant(
        T.F.LOGSEQ.DISCREPANCY.ACTIVE_TASKS,
      );
      html += `<p><strong>${activeTasksLabel} (${activeDiscrepancies.length}):</strong></p>`;
      html += '<div style="margin-bottom: 12px;">';

      activeDiscrepancies.forEach((d) => {
        const isActiveInLogseq =
          d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE';
        const statusText = isActiveInLogseq
          ? this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.STATUS_LOGSEQ_DOING_SP_INACTIVE,
            )
          : this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.STATUS_SP_ACTIVE_LOGSEQ_TODO,
            );
        const title = this._escapeHtml(d.task.title);
        const taskId = d.task.id;

        const rowStyle =
          'display:flex;align-items:center;justify-content:space-between;' +
          'padding:8px 0;border-bottom:1px solid #ccc';
        const toggleStyle =
          'display:flex;border:1px solid #666;border-radius:4px;overflow:hidden';

        // Default: accept Logseq value (activate if Logseq is DOING, deactivate if Logseq is TODO)
        const spChecked = 'checked';
        const lqChecked = '';
        const spLabel = isActiveInLogseq
          ? this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.ACTIVATE)
          : this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.DEACTIVATE);
        const lqLabel = isActiveInLogseq ? 'Logseq: TODO' : 'Logseq: DOING';

        html += `<div style="${rowStyle}">`;
        html += `<div style="flex:1;min-width:0;margin-right:12px">`;
        html +=
          `<strong style="display:block;overflow:hidden;text-overflow:ellipsis;` +
          `white-space:nowrap">${title}</strong>`;
        html += `<small style="color:#666">${statusText}</small></div>`;

        html += `<div class="toggle-group" data-task-id="${taskId}" style="${toggleStyle}">`;
        html +=
          `<input type="radio" name="active-action-${taskId}" value="superprod" ` +
          `id="active-sp-${taskId}" ${spChecked} style="display:none">`;
        html += `<label for="active-sp-${taskId}" class="toggle-label">${spLabel}</label>`;
        html +=
          `<input type="radio" name="active-action-${taskId}" value="logseq" ` +
          `id="active-lq-${taskId}" ${lqChecked} style="display:none">`;
        html +=
          `<label for="active-lq-${taskId}" class="toggle-label toggle-label-right">` +
          `${lqLabel}</label>`;
        html += `</div></div>`;
      });

      html += '</div>';
    }

    // DONE discrepancies with per-task action selection
    if (doneDiscrepancies.length > 0) {
      html += `<p><strong>DONE Status (${doneDiscrepancies.length}):</strong></p>`;
      html += '<div style="margin-bottom: 12px;">';

      const completeLabel = this._translateService.instant(
        T.F.LOGSEQ.DISCREPANCY.COMPLETE,
      );

      doneDiscrepancies.forEach((d) => {
        const isDoneInLogseq = d.discrepancyType === 'LOGSEQ_DONE_SUPERPROD_NOT_DONE';
        const statusText = isDoneInLogseq
          ? this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.STATUS_LOGSEQ_DONE_SP_OPEN,
            )
          : this._translateService.instant(
              T.F.LOGSEQ.DISCREPANCY.STATUS_SP_DONE_LOGSEQ_OPEN,
            );
        const logseqLabel = isDoneInLogseq ? 'TODO' : 'DONE';
        const title = this._escapeHtml(d.task.title);
        const taskId = d.task.id;

        const rowStyle =
          'display:flex;align-items:center;justify-content:space-between;' +
          'padding:8px 0;border-bottom:1px solid #ccc';
        const toggleStyle =
          'display:flex;border:1px solid #666;border-radius:4px;overflow:hidden';

        html += `<div style="${rowStyle}">`;
        html += `<div style="flex:1;min-width:0;margin-right:12px">`;
        html +=
          `<strong style="display:block;overflow:hidden;text-overflow:ellipsis;` +
          `white-space:nowrap">${title}</strong>`;
        html += `<small style="color:#666">${statusText}</small></div>`;
        // Always default to accepting Logseq value
        const spChecked = 'checked';
        const lqChecked = '';

        html += `<div class="toggle-group" data-task-id="${taskId}" style="${toggleStyle}">`;
        html +=
          `<input type="radio" name="action-${taskId}" value="superprod" ` +
          `id="sp-${taskId}" ${spChecked} style="display:none">`;
        html += `<label for="sp-${taskId}" class="toggle-label">${completeLabel}</label>`;
        html +=
          `<input type="radio" name="action-${taskId}" value="logseq" ` +
          `id="lq-${taskId}" ${lqChecked} style="display:none">`;
        html +=
          `<label for="lq-${taskId}" class="toggle-label toggle-label-right">` +
          `Logseq: ${logseqLabel}</label>`;
        html += `</div></div>`;
      });

      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  private _buildDiscrepancyButtons(
    allDiscrepancies: DiscrepancyItem[],
    activeDiscrepancies: DiscrepancyItem[],
    doneDiscrepancies: DiscrepancyItem[],
  ): any[] {
    const logseqActiveDiscrepancies = activeDiscrepancies.filter(
      (d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
    );
    const hasLogseqActive = logseqActiveDiscrepancies.length >= 1;
    const hasDoneDiscrepancies = doneDiscrepancies.length > 0;

    // Helper function to handle active task selection
    const handleActiveTaskSelection = async (): Promise<void> => {
      const selectedRadio = document.querySelector<HTMLInputElement>(
        'input[name="activeTask"]:checked',
      );
      if (selectedRadio) {
        const selectedTaskId = selectedRadio.value;
        if (selectedTaskId === '__none__') {
          // Deactivate all in Logseq, don't activate any in SuperProd
          for (const d of logseqActiveDiscrepancies) {
            await this._performLogseqAction(d.discrepancyType, d.task);
          }
        } else {
          // Activate selected task in SuperProd
          this._store.dispatch(setCurrentTask({ id: selectedTaskId }));
          // Deactivate all others in Logseq
          for (const d of logseqActiveDiscrepancies) {
            if (d.task.id !== selectedTaskId) {
              await this._performLogseqAction(
                'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
                d.task,
              );
            }
          }
        }
      }
    };

    // Combined case: Multiple active tasks AND done discrepancies
    if (hasLogseqActive && hasDoneDiscrepancies) {
      return [
        {
          label: 'Anwenden',
          color: 'primary',
          onClick: async () => {
            // Handle active task selection
            await handleActiveTaskSelection();

            // Process DONE discrepancies based on individual radio selections
            for (const d of doneDiscrepancies) {
              const radio = document.querySelector<HTMLInputElement>(
                `input[name="action-${d.task.id}"]:checked`,
              );
              if (!radio) continue;

              const action = radio.value;
              if (action === 'superprod') {
                this._performSuperProdAction(d.discrepancyType, d.task);
              } else if (action === 'logseq') {
                await this._performLogseqAction(d.discrepancyType, d.task);
              }
            }
          },
        },
      ];
    }

    // Active tasks in Logseq only (no done discrepancies)
    if (hasLogseqActive) {
      return [
        {
          label: 'Anwenden',
          color: 'primary',
          onClick: handleActiveTaskSelection,
        },
      ];
    }

    // DONE discrepancies (possibly with single active discrepancy)
    if (hasDoneDiscrepancies) {
      const buttons: any[] = [];

      // Quick action: Sync all to Logseq (primary action)
      buttons.push({
        label: 'Alle in Logseq syncen',
        color: 'primary',
        onClick: async () => {
          for (const d of doneDiscrepancies) {
            await this._performLogseqAction(d.discrepancyType, d.task);
          }
          for (const d of activeDiscrepancies) {
            await this._performLogseqAction(d.discrepancyType, d.task);
          }
        },
      });

      // Secondary action: Process individual selections
      buttons.push({
        label: 'Anwenden',
        onClick: async () => {
          // Process active discrepancies based on individual radio selections
          for (const d of activeDiscrepancies) {
            const radio = document.querySelector<HTMLInputElement>(
              `input[name="active-action-${d.task.id}"]:checked`,
            );
            if (!radio) continue;

            const action = radio.value;
            if (action === 'superprod') {
              this._performSuperProdAction(d.discrepancyType, d.task);
            } else if (action === 'logseq') {
              await this._performLogseqAction(d.discrepancyType, d.task);
            }
          }

          // Process DONE discrepancies based on individual radio selections
          for (const d of doneDiscrepancies) {
            const radio = document.querySelector<HTMLInputElement>(
              `input[name="action-${d.task.id}"]:checked`,
            );
            if (!radio) continue;

            const action = radio.value;
            if (action === 'superprod') {
              this._performSuperProdAction(d.discrepancyType, d.task);
            } else if (action === 'logseq') {
              await this._performLogseqAction(d.discrepancyType, d.task);
            }
          }
        },
      });

      return buttons;
    }

    // Standard buttons for active-only discrepancies (with toggle selection)
    return [
      {
        label: 'Anwenden',
        color: 'primary',
        onClick: async () => {
          // Process active discrepancies based on individual radio selections
          for (const d of activeDiscrepancies) {
            const radio = document.querySelector<HTMLInputElement>(
              `input[name="active-action-${d.task.id}"]:checked`,
            );
            if (!radio) continue;

            const action = radio.value;
            if (action === 'superprod') {
              this._performSuperProdAction(d.discrepancyType, d.task);
            } else if (action === 'logseq') {
              await this._performLogseqAction(d.discrepancyType, d.task);
            }
          }
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
