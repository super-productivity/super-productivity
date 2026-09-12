import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { isTouchActive } from '../../../util/input-intent';
import { IS_HYBRID_DEVICE } from '../../../util/is-mouse-primary';
import { DRAG_DELAY_FOR_TOUCH } from '../../../app.constants';
import { T } from '../../../t.const';
import { TaskContextMenuComponent } from '../../tasks/task-context-menu/task-context-menu.component';
import { MatIcon } from '@angular/material/icon';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { hasLinkHints, RenderLinksPipe } from '../../../ui/pipes/render-links.pipe';
import { DoneToggleComponent } from '../../../ui/done-toggle/done-toggle.component';
import { SwipeBlockComponent } from '../../../ui/swipe-block/swipe-block.component';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { checkKeyCombo } from '../../../util/check-key-combo';
import { MatDialog } from '@angular/material/dialog';
import { DialogScheduleTaskComponent } from '../dialog-schedule-task/dialog-schedule-task.component';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';
import { DialogTimeEstimateComponent } from '../../tasks/dialog-time-estimate/dialog-time-estimate.component';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../core/date/date.service';
import { DateAdapter } from '@angular/material/core';
import { getNextWeekDayOffset } from '../../../util/get-next-week-day-offset';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { combineDateAndTime } from '../../../util/combine-date-and-time';
import { millisecondsDiffToRemindOption } from '../../tasks/util/remind-option-to-milliseconds';
import { PlannerActions } from '../store/planner.actions';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { first } from 'rxjs/operators';
import { isInputElement } from '../../../util/dom-element';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import {
  moveTaskDownInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';

@Component({
  selector: 'planner-task',
  templateUrl: './planner-task.component.html',
  styleUrl: './planner-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatIcon,
    TagListComponent,
    InlineInputComponent,
    TaskContextMenuComponent,
    MsToStringPipe,
    RenderLinksPipe,
    DoneToggleComponent,
    SwipeBlockComponent,
    TranslatePipe,
  ],
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    // Planner explicitly opts cards into keyboard and selection behavior.
    // Other PlannerTask consumers (Boards and scheduled-list) stay unchanged.
    '[attr.data-task-id]': 'focusable() ? task().id : null',
    '[attr.data-task-selectable]': 'focusable() ? "true" : null',
    '[attr.tabindex]': 'focusable() ? "0" : null',
    '[class.isDone]': 'task().isDone',
    '[class.isDragReady]': 'isDragReady()',
    '[class.isCurrent]': 'isCurrent()',
    '[class.isMultiSelected]': 'isMultiSelected()',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class PlannerTaskComponent implements OnInit, OnDestroy, AfterViewInit {
  private _taskService = inject(TaskService);
  private _cd = inject(ChangeDetectorRef);
  private _destroyRef = inject(DestroyRef);
  private _elementRef = inject(ElementRef);
  private _multiSelect = inject(TaskMultiSelectService);
  private _configService = inject(GlobalConfigService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _dateAdapter = inject(DateAdapter);
  private _isTaskDeleteTriggered = false;
  private _completionFocusFallback?: {
    id: string | null;
    element: HTMLElement | null;
  };

  readonly task = input.required<TaskCopy>();

  readonly titleHasLinks = computed<boolean>(() => {
    const title = this.task().title;
    return !!title && hasLinkHints(title);
  });

  // TODO remove
  readonly day = input<string | undefined>();
  readonly tagsToHide = input<string[]>();
  // Explicit opt-in keeps Boards and scheduled-list cards out of Planner navigation.
  readonly focusable = input<boolean>(false);
  readonly isMultiSelected = computed(() =>
    this.focusable() ? this._multiSelect.selectedIds().has(this.task().id) : false,
  );

  readonly T = T;
  readonly isTouchActive = isTouchActive;
  parentTitle: string | null = null;
  isContextMenuLoaded = signal(false);
  showDoneAnimation = signal(false);
  showUndoneAnimation = signal(false);
  isDragReady = signal(false);
  private _doneAnimationTimeout?: number;
  private _dragReadyTimeout?: number;
  private _touchListenerCleanups: (() => void)[] = [];

  readonly taskContextMenu = viewChild('taskContextMenu', {
    read: TaskContextMenuComponent,
  });

  readonly isCurrent = computed<boolean>(
    () => this.task().id === this._taskService.currentTaskId(),
  );

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    if (isTouchActive()) {
      event.preventDefault();
      return;
    }
    if (this.focusable() && this._multiSelect.has(this.task().id)) {
      event.preventDefault();
      event.stopPropagation();
      const rect = (
        this._elementRef.nativeElement as HTMLElement
      ).getBoundingClientRect();
      const halfWidth = rect.width / 2;
      const halfHeight = rect.height / 2;
      this._multiSelect.requestMenuOpen({
        x: rect.left + halfWidth,
        y: rect.top + halfHeight,
      });
      return;
    }
    this.openContextMenu(event);
  }

  @HostListener('click', ['$event'])
  async clickHandler(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (this.focusable() && this._multiSelect.isActive()) {
      this._multiSelect.clear();
    }
    if (target?.tagName === 'A' || target?.closest('a')) {
      return;
    }
    if (this.focusable()) {
      if (!this._isInteractiveClickTarget(target)) {
        (this._elementRef.nativeElement as HTMLElement).focus();
      }
      return;
    }
    // Use bottom panel on mobile, dialog on desktop
    this._taskService.setSelectedId(this.task().id);
  }

  @HostListener('dblclick', ['$event'])
  onDoubleClick(event: MouseEvent): void {
    if (
      !this.focusable() ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this._isInteractiveClickTarget(event.target as HTMLElement | null)
    ) {
      return;
    }
    this._taskService.setSelectedId(this.task().id);
  }

  private _isInteractiveClickTarget(target: HTMLElement | null): boolean {
    const host = this._elementRef.nativeElement as HTMLElement;
    const interactive = target?.closest<HTMLElement>(
      'a, button, input, textarea, select, [contenteditable="true"], [tabindex]',
    );
    return !!interactive && interactive !== host;
  }

  readonly timeEstimate = computed<number>(() => {
    const t = this.task();
    return t.subTaskIds
      ? t.timeEstimate
      : t.timeEstimate - t.timeSpent > 0
        ? t.timeEstimate - t.timeSpent
        : 0;
  });

  ngOnInit(): void {
    const parentId = this.task().parentId;
    if (parentId) {
      this._taskService
        .getByIdLive$(parentId)
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe((parentTask) => {
          this.parentTitle = parentTask && parentTask.title;
          this._cd.markForCheck();
        });
    }
  }

  ngAfterViewInit(): void {
    if (isTouchActive() || IS_HYBRID_DEVICE) {
      const el = this._elementRef.nativeElement;
      const onStart = (): void => {
        this._dragReadyTimeout = window.setTimeout(() => {
          this.isDragReady.set(true);
        }, DRAG_DELAY_FOR_TOUCH);
      };
      const onEnd = (): void => this._cancelDragReady();
      el.addEventListener('touchstart', onStart, { passive: true });
      el.addEventListener('touchend', onEnd, { passive: true });
      el.addEventListener('touchmove', onEnd, { passive: true });
      this._touchListenerCleanups = [
        () => el.removeEventListener('touchstart', onStart),
        () => el.removeEventListener('touchend', onEnd),
        () => el.removeEventListener('touchmove', onEnd),
      ];
    }
    if (this.focusable()) {
      const host = this._elementRef.nativeElement as HTMLElement;
      const selectFromModifierClick = (event: MouseEvent): void => {
        const target = event.target;
        if (
          !(event.ctrlKey || event.metaKey || event.shiftKey) ||
          (target instanceof HTMLElement && isInputElement(target))
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        host.focus();
        if (event.shiftKey) {
          this._multiSelect.selectRange(this.task().id, event.ctrlKey || event.metaKey);
        } else {
          this._multiSelect.toggle(this.task().id);
        }
      };
      const preventShiftSelection = (event: MouseEvent): void => {
        if (
          event.shiftKey &&
          !(event.target instanceof HTMLElement && isInputElement(event.target))
        ) {
          event.preventDefault();
        }
      };
      host.addEventListener('click', selectFromModifierClick, true);
      host.addEventListener('mousedown', preventShiftSelection, true);
      this._touchListenerCleanups.push(
        () => host.removeEventListener('click', selectFromModifierClick, true),
        () => host.removeEventListener('mousedown', preventShiftSelection, true),
      );
    }
  }

  ngOnDestroy(): void {
    if (this.focusable()) {
      this._multiSelect.removeWhenUnrendered(
        this.task().id,
        this._elementRef.nativeElement,
      );
    }
    window.clearTimeout(this._doneAnimationTimeout);
    window.clearTimeout(this._dragReadyTimeout);
    this._touchListenerCleanups.forEach((fn) => fn());
    if (
      this._completionFocusFallback &&
      document.activeElement === this._elementRef.nativeElement
    ) {
      this._restoreFocus(
        this.task().id,
        this._completionFocusFallback.id,
        this._completionFocusFallback.element,
      );
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const host = this._elementRef.nativeElement as HTMLElement;
    if (!this.focusable() || event.target !== host) {
      return;
    }
    const keys = this._configService.cfg()?.keyboard;
    if (
      keys &&
      Object.values(keys).some(
        (combo) => typeof combo === 'string' && combo && checkKeyCombo(event, combo),
      )
    ) {
      return;
    }
    if (
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      this._moveOneDay(event.key === 'ArrowLeft' ? -1 : 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'Enter') {
      this._taskService.setSelectedId(this.task().id);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return;
    }
    if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      return;
    }
    this._moveFocus(event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
    event.preventDefault();
    event.stopPropagation();
  }

  private _moveFocus(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    const rows = this._plannerRows();
    const host = this._elementRef.nativeElement as HTMLElement;
    const current = host;
    const currentIndex = rows.indexOf(current);
    let target: HTMLElement | undefined;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const scope = current.closest('[data-planner-selection-scope]');
      const scopedRows = rows.filter(
        (row) => row.closest('[data-planner-selection-scope]') === scope,
      );
      const index = scopedRows.indexOf(current);
      target = scopedRows[key === 'ArrowDown' ? index + 1 : index - 1];
    } else {
      const scopes = Array.from(
        document.querySelectorAll<HTMLElement>('[data-planner-selection-scope]'),
      ).filter((scope) =>
        scope.querySelector('planner-task[data-task-selectable="true"]'),
      );
      const scope = current.closest<HTMLElement>('[data-planner-selection-scope]');
      const scopeIndex = scope ? scopes.indexOf(scope) : -1;
      const nextScope = scopes[key === 'ArrowRight' ? scopeIndex + 1 : scopeIndex - 1];
      if (nextScope) {
        const currentScopeRows = scope
          ? Array.from(
              scope.querySelectorAll<HTMLElement>(
                'planner-task[data-task-selectable="true"]',
              ),
            )
          : [];
        const rowIndex = Math.max(0, currentScopeRows.indexOf(current));
        const nextRows = Array.from(
          nextScope.querySelectorAll<HTMLElement>(
            'planner-task[data-task-selectable="true"]',
          ),
        );
        target = nextRows[Math.min(rowIndex, nextRows.length - 1)];
      }
    }
    if (target && currentIndex !== -1) {
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private _plannerRows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('planner-task[data-task-selectable="true"]'),
    );
  }

  @HostListener('planner-task-shortcut', ['$event'])
  onTaskShortcut(event: CustomEvent<{ keyboardEvent: KeyboardEvent }>): void {
    const keyboardEvent = event.detail.keyboardEvent;
    const keys = this._configService.cfg()?.keyboard;
    if (!keys) {
      return;
    }
    if (checkKeyCombo(keyboardEvent, keys.selectPreviousTask)) {
      this._moveFocus('ArrowUp');
    } else if (checkKeyCombo(keyboardEvent, keys.selectNextTask)) {
      this._moveFocus('ArrowDown');
    } else if (checkKeyCombo(keyboardEvent, keys.taskToggleDone)) {
      this._runCompletionWithFocus();
    } else if (
      checkKeyCombo(keyboardEvent, keys.togglePlay) &&
      this._configService.appFeatures().isTimeTrackingEnabled
    ) {
      this._taskService.setCurrentId(this.isCurrent() ? null : this.task().id);
    } else if (checkKeyCombo(keyboardEvent, keys.taskScheduleToday)) {
      this._runMutationWithFocus(() =>
        this._taskService.scheduleForTodayById(this.task().id),
      );
    } else if (checkKeyCombo(keyboardEvent, keys.taskScheduleTomorrow)) {
      this._scheduleForOffset('tomorrow');
    } else if (checkKeyCombo(keyboardEvent, keys.taskScheduleNextWeek)) {
      this._scheduleForOffset('nextWeek');
    } else if (checkKeyCombo(keyboardEvent, keys.taskScheduleNextMonth)) {
      this._scheduleForOffset('nextMonth');
    } else if (checkKeyCombo(keyboardEvent, keys.taskUnschedule)) {
      this._runMutationWithFocus(() =>
        this._store.dispatch(TaskSharedActions.unscheduleTask({ id: this.task().id })),
      );
    } else if (checkKeyCombo(keyboardEvent, keys.taskDelete)) {
      this._deleteTask();
    } else if (checkKeyCombo(keyboardEvent, keys.taskSchedule)) {
      this._openTaskDialog(DialogScheduleTaskComponent);
    } else if (checkKeyCombo(keyboardEvent, keys.taskScheduleDeadline)) {
      this._openTaskDialog(DialogDeadlineComponent);
    } else if (checkKeyCombo(keyboardEvent, keys.taskOpenEstimationDialog)) {
      this._openTaskDialog(DialogTimeEstimateComponent);
    } else if (
      checkKeyCombo(keyboardEvent, keys.taskOpenContextMenu) ||
      this._isNativeContextMenuKey(keyboardEvent)
    ) {
      this._openContextMenuFromKeyboard();
    } else if (checkKeyCombo(keyboardEvent, keys.moveTaskUp)) {
      this._reorderAllDay('up');
    } else if (checkKeyCombo(keyboardEvent, keys.moveTaskDown)) {
      this._reorderAllDay('down');
    } else if (checkKeyCombo(keyboardEvent, keys.moveTaskToTop)) {
      this._reorderAllDay('top');
    } else if (checkKeyCombo(keyboardEvent, keys.moveTaskToBottom)) {
      this._reorderAllDay('bottom');
    } else {
      return;
    }
    event.preventDefault();
  }

  private _scheduleForOffset(offset: 'tomorrow' | 'nextWeek' | 'nextMonth'): void {
    const date = this._dateService.getLogicalTodayDate();
    if (offset === 'tomorrow') {
      date.setDate(date.getDate() + 1);
    } else if (offset === 'nextWeek') {
      date.setDate(date.getDate() + getNextWeekDayOffset(this._dateAdapter, date));
    } else {
      date.setDate(1);
      date.setMonth(date.getMonth() + 1);
    }
    this._runMutationWithFocus(() => this._scheduleForDay(date));
  }

  private _moveOneDay(dayDelta: -1 | 1): void {
    const task = this.task();
    const displayedDay = this.day();
    const baseDate = task.dueWithTime
      ? new Date(task.dueWithTime)
      : displayedDay
        ? parseDbDateStr(displayedDay)
        : task.dueDay
          ? parseDbDateStr(task.dueDay)
          : null;
    if (!baseDate) {
      return;
    }
    baseDate.setDate(baseDate.getDate() + dayDelta);
    this._runMutationWithFocus(() => this._scheduleForDay(baseDate));
  }

  private _scheduleForDay(date: Date): void {
    const task = this.task();
    if (task.dueWithTime) {
      const timestamp = combineDateAndTime(date, new Date(task.dueWithTime)).getTime();
      const remindCfg = millisecondsDiffToRemindOption(task.dueWithTime, task.remindAt);
      this._taskService.scheduleTask(task, timestamp, remindCfg, false);
      return;
    }
    this._store.dispatch(
      PlannerActions.planTaskForDay({ task, day: getDbDateStr(date), isShowSnack: true }),
    );
  }

  private _deleteTask(): void {
    if (this._isTaskDeleteTriggered) {
      return;
    }
    if (this._configService.cfg()?.tasks?.isConfirmBeforeDelete ?? true) {
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: this.task().title },
          },
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe((isConfirm) => {
          if (isConfirm) {
            this._performDelete();
          } else {
            this._restoreFocus(this.task().id, null, this._localAddButton());
          }
        });
      return;
    }
    this._performDelete();
  }

  private _performDelete(): void {
    this._isTaskDeleteTriggered = true;
    const rows = this._plannerRows();
    const index = rows.indexOf(this._elementRef.nativeElement);
    const fallbackId =
      rows[index + 1]?.getAttribute('data-task-id') ??
      rows[index - 1]?.getAttribute('data-task-id') ??
      null;
    const fallbackEl = this._localAddButton();
    this._taskService
      .getByIdWithSubTaskData$(this.task().id)
      .pipe(first(), takeUntilDestroyed(this._destroyRef))
      .subscribe((task) => {
        if (task) {
          this._taskService.remove(task);
          this._restoreFocus(null, fallbackId, fallbackEl);
        }
      });
  }

  private _reorderAllDay(direction: 'up' | 'down' | 'top' | 'bottom'): void {
    const host = this._elementRef.nativeElement as HTMLElement;
    if (host.closest('.scheduled-items')) {
      return;
    }
    const scope = host.closest<HTMLElement>('[data-planner-selection-scope]');
    const rows = scope
      ? Array.from(
          scope.querySelectorAll<HTMLElement>(
            '.normal-tasks planner-task[data-task-selectable="true"]',
          ),
        )
      : [];
    const fromIndex = rows.indexOf(host);
    const toIndex =
      direction === 'up'
        ? fromIndex - 1
        : direction === 'down'
          ? fromIndex + 1
          : direction === 'top'
            ? 0
            : rows.length - 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) {
      return;
    }
    const day = this.day();
    if (!day) {
      return;
    }
    const fallbackEl = this._localAddButton();
    if (day === this._dateService.todayStr()) {
      const props = {
        taskId: this.task().id,
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        doneTaskIds: rows.map((row) => row.getAttribute('data-task-id') as string),
      };
      const action =
        direction === 'up'
          ? moveTaskUpInTodayList(props)
          : direction === 'down'
            ? moveTaskDownInTodayList(props)
            : direction === 'top'
              ? moveTaskToTopInTodayList(props)
              : moveTaskToBottomInTodayList(props);
      this._store.dispatch(action);
    } else {
      this._store.dispatch(
        PlannerActions.moveInList({ targetDay: day, fromIndex, toIndex }),
      );
    }
    this._restoreFocus(this.task().id, null, fallbackEl);
  }

  private _runMutationWithFocus(mutation: () => void): void {
    const rows = this._plannerRows();
    const host = this._elementRef.nativeElement as HTMLElement;
    const index = rows.indexOf(host);
    const fallbackId =
      rows[index + 1]?.getAttribute('data-task-id') ??
      rows[index - 1]?.getAttribute('data-task-id') ??
      null;
    const fallbackEl = this._localAddButton();
    mutation();
    this._restoreFocus(this.task().id, fallbackId, fallbackEl);
  }

  private _runCompletionWithFocus(): void {
    const host = this._elementRef.nativeElement as HTMLElement;
    if (this.task().isDone || !host.closest('planner-day-overdue')) {
      this._runMutationWithFocus(() => this.toggleTaskDone());
      return;
    }
    const rows = this._plannerRows();
    const index = rows.indexOf(host);
    this._completionFocusFallback = {
      id:
        rows[index + 1]?.getAttribute('data-task-id') ??
        rows[index - 1]?.getAttribute('data-task-id') ??
        null,
      element: this._localAddButton(),
    };
    this.toggleTaskDone();
  }

  private _restoreFocus(
    preferredId: string | null,
    fallbackId: string | null,
    fallbackEl: HTMLElement | null,
  ): void {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) {
        return;
      }
      const row =
        (preferredId && this._multiSelect.findLiveRowEl(preferredId)) ||
        (fallbackId && this._multiSelect.findLiveRowEl(fallbackId));
      if (row) {
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (fallbackEl?.isConnected) {
        fallbackEl.focus({ preventScroll: true });
      }
    });
  }

  private _localAddButton(): HTMLElement | null {
    return (
      (this._elementRef.nativeElement as HTMLElement)
        .closest<HTMLElement>('[data-planner-selection-scope]')
        ?.querySelector<HTMLElement>('add-task-inline button') ??
      document.querySelector<HTMLElement>(
        'planner-day[data-planner-selection-scope] add-task-inline button',
      )
    );
  }

  private _openContextMenuFromKeyboard(): void {
    const host = this._elementRef.nativeElement as HTMLElement;
    if (!this.isContextMenuLoaded()) {
      this.isContextMenuLoaded.set(true);
      setTimeout(() => this.taskContextMenu()?.open(undefined, true, host));
      return;
    }
    this.taskContextMenu()?.open(undefined, true, host);
  }

  private _isNativeContextMenuKey(event: KeyboardEvent): boolean {
    return (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === 'ContextMenu' ||
        event.key === 'Menu' ||
        event.code === 'ContextMenu')
    );
  }

  private _openTaskDialog(component: Parameters<MatDialog['open']>[0]): void {
    const rows = this._plannerRows();
    const index = rows.indexOf(this._elementRef.nativeElement);
    const fallbackId =
      rows[index + 1]?.getAttribute('data-task-id') ??
      rows[index - 1]?.getAttribute('data-task-id') ??
      null;
    const fallbackEl = this._localAddButton();
    this._matDialog
      .open(component, { autoFocus: false, data: { task: this.task() } })
      .afterClosed()
      .subscribe(() => {
        this._restoreFocus(this.task().id, fallbackId, fallbackEl);
      });
  }

  // A confirmed horizontal swipe (open menu / mark done) is not a drag, so
  // cancel the pending long-press drag-ready state before it can fire mid-swipe.
  onSwipeStart(): void {
    this._cancelDragReady();
  }

  private _cancelDragReady(): void {
    window.clearTimeout(this._dragReadyTimeout);
    this.isDragReady.set(false);
  }

  onSwipeRightTriggered(isTriggered: boolean): void {
    if (this.task().isDone) {
      this.showUndoneAnimation.set(isTriggered);
    } else {
      this.showDoneAnimation.set(isTriggered);
    }
  }

  toggleTaskDone(): void {
    window.clearTimeout(this._doneAnimationTimeout);
    const t = this.task();
    this._doneAnimationTimeout = this._taskService.toggleDoneWithAnimation(
      t.id,
      t.isDone,
      (v) => this.showDoneAnimation.set(v),
    );
  }

  openContextMenu(event?: TouchEvent | MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.isContextMenuLoaded()) {
      this.isContextMenuLoaded.set(true);
      setTimeout(() => {
        this.taskContextMenu()?.open(event);
      });
      return;
    }
    this.taskContextMenu()?.open(event);
  }

  estimateTimeClick(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
  }

  updateTimeEstimate(val: number): void {
    this._taskService.update(this.task().id, {
      timeEstimate: val,
    });
  }
}
