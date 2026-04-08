import { effect, inject, Injectable, signal } from '@angular/core';
import { ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, Subscription } from 'rxjs';
import { concatMap, filter, first, take } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { selectActiveWorkContext } from '../work-context/store/work-context.selectors';
import { isTouchActive } from '../../util/input-intent';
import { TaskService } from '../tasks/task.service';
import { TaskFocusService } from '../tasks/task-focus.service';

export type OnboardingStep =
  | 'create-task'
  | 'task-tap'
  | 'task-swipe-left'
  | 'task-swipe-right'
  | 'explore';

/** How long desktop and mobile onboarding steps stay visible before progressing/dismissing */
const TASK_TAP_AUTO_ADVANCE_MS = 8000;
const TASK_SWIPE_LEFT_AUTO_ADVANCE_MS = 16000;
const TASK_SWIPE_RIGHT_AUTO_ADVANCE_MS = 16000;
const EXPLORE_AUTO_DISMISS_MS = 16000;
/** Delay after add-task-bar closes before showing explore hint */
const EXPLORE_SHOW_DELAY_MS = 1000;

@Injectable({ providedIn: 'root' })
export class OnboardingHintService {
  currentStep = signal<OnboardingStep | null>(null);

  private _actions$: Observable<Action> = inject(LOCAL_ACTIONS);
  private _layoutService = inject(LayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _taskFocusService = inject(TaskFocusService);
  private _store = inject(Store);
  private _isStarted = false;
  private _waitingForBarClose = false;
  private _waitingForTaskPanelClose = false;
  private _waitingForTaskContextMenuClose = false;
  private _startSub: Subscription | null = null;
  private _listenSub: Subscription | null = null;
  private _doneHintSub: Subscription | null = null;
  private _postCreateShowTimeout: ReturnType<typeof setTimeout> | null = null;
  private _stepAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;
  private _stepDismissTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (localStorage.getItem(LS.ONBOARDING_HINTS_DONE)) {
      return;
    }

    if (isTouchActive()) {
      this._listenForTaskCompletion();
    }

    // Effect 1: Hide create-task hint when add-task-bar opens, show next step when it closes
    effect(() => {
      const isOpen = this._layoutService.isShowAddTaskBar();
      if (isOpen && this.currentStep() === 'create-task') {
        this.currentStep.set(null);
      }
      if (!isOpen && this._waitingForBarClose) {
        this._waitingForBarClose = false;
        this._postCreateShowTimeout = setTimeout(
          () => this._showPostCreateStep(),
          EXPLORE_SHOW_DELAY_MS,
        );
      }
    });

    // Effect 2: Advance from task-tap when user opens the task detail panel
    effect(() => {
      const selectedTaskId = this._taskService.selectedTaskId();
      if (this.currentStep() === 'task-tap' && selectedTaskId) {
        this.currentStep.set(null);
        this._waitingForTaskPanelClose = true;
        this._clearStepTimeouts();
      }
      if (this._waitingForTaskPanelClose && selectedTaskId === null) {
        this._waitingForTaskPanelClose = false;
        this._showTaskSwipeLeftStep();
      }
    });

    // Effect 3: Advance from task-swipe-left when user opens the context menu
    effect(() => {
      const isContextMenuOpen = this._taskFocusService.isTaskContextMenuOpen();
      if (this.currentStep() === 'task-swipe-left' && isContextMenuOpen) {
        this.currentStep.set(null);
        this._waitingForTaskContextMenuClose = true;
        this._clearStepTimeouts();
      }
      if (this._waitingForTaskContextMenuClose && !isContextMenuOpen) {
        this._waitingForTaskContextMenuClose = false;
        this._showTaskSwipeRightStep();
      }
    });

    if (localStorage.getItem(LS.ONBOARDING_PRESET_DONE)) {
      this._startOnboarding();
    }
  }

  static isOnboardingInProgress(): boolean {
    // Onboarding is fully completed
    if (localStorage.getItem(LS.ONBOARDING_HINTS_DONE)) {
      return false;
    }
    // Already past preset selection, hints still pending
    if (localStorage.getItem(LS.ONBOARDING_PRESET_DONE)) {
      return true;
    }
    // Fresh user still on preset selection screen (no preset done, no skip tour)
    return !localStorage.getItem(LS.IS_SKIP_TOUR);
  }

  startAfterPresetSelection(): void {
    if (localStorage.getItem(LS.ONBOARDING_HINTS_DONE)) {
      return;
    }
    this._startOnboarding();
  }

  skip(): void {
    localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
    this.currentStep.set(null);
    this._waitingForBarClose = false;
    this._waitingForTaskPanelClose = false;
    this._waitingForTaskContextMenuClose = false;
    this._startSub?.unsubscribe();
    this._listenSub?.unsubscribe();
    this._doneHintSub?.unsubscribe();
    this._clearStepTimeouts();
  }

  private _startOnboarding(): void {
    if (this._isStarted) {
      return;
    }
    this._isStarted = true;

    this._startSub = this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(
        concatMap(() => this._store.select(selectActiveWorkContext)),
        take(1),
      )
      .subscribe((ctx) => {
        if (ctx.taskIds.length > 0) {
          // Tasks already exist (e.g. from example tasks) — skip "create-task"
          // and move directly to the next relevant onboarding hint.
          this._showPostCreateStep();
        } else {
          this.currentStep.set('create-task');
          this._listenForTaskCreation();
        }
      });
  }

  private _listenForTaskCreation(): void {
    this._listenSub = this._actions$
      .pipe(ofType(TaskSharedActions.addTask), first())
      .subscribe(() => {
        this._listenSub?.unsubscribe();
        this._waitingForBarClose = true;
        // If the bar is already closed (e.g. keyboard shortcut), start the delay now
        if (!this._layoutService.isShowAddTaskBar()) {
          this._waitingForBarClose = false;
          this._postCreateShowTimeout = setTimeout(
            () => this._showPostCreateStep(),
            EXPLORE_SHOW_DELAY_MS,
          );
        }
      });
  }

  private _showPostCreateStep(): void {
    if (isTouchActive() && this._layoutService.isShowMobileBottomNav()) {
      this._showTaskTapStep();
      return;
    }
    this._showExploreStep();
  }

  private _showTaskTapStep(): void {
    this._clearStepTimeouts();
    this.currentStep.set('task-tap');
    this._stepAdvanceTimeout = setTimeout(
      () => this._showTaskSwipeLeftStep(),
      TASK_TAP_AUTO_ADVANCE_MS,
    );
  }

  private _showTaskSwipeLeftStep(): void {
    this._clearStepTimeouts();
    this._waitingForTaskContextMenuClose = false;
    this.currentStep.set('task-swipe-left');
    this._stepAdvanceTimeout = setTimeout(
      () => this._showTaskSwipeRightStep(),
      TASK_SWIPE_LEFT_AUTO_ADVANCE_MS,
    );
  }

  private _showTaskSwipeRightStep(): void {
    this._clearStepTimeouts();
    this.currentStep.set('task-swipe-right');
    this._stepDismissTimeout = setTimeout(
      () => this.skip(),
      TASK_SWIPE_RIGHT_AUTO_ADVANCE_MS,
    );
  }

  private _showExploreStep(): void {
    this._clearStepTimeouts();
    this.currentStep.set('explore');
    this._stepDismissTimeout = setTimeout(() => this.skip(), EXPLORE_AUTO_DISMISS_MS);
  }

  private _clearStepTimeouts(): void {
    if (this._postCreateShowTimeout !== null) {
      clearTimeout(this._postCreateShowTimeout);
      this._postCreateShowTimeout = null;
    }
    if (this._stepAdvanceTimeout !== null) {
      clearTimeout(this._stepAdvanceTimeout);
      this._stepAdvanceTimeout = null;
    }
    if (this._stepDismissTimeout !== null) {
      clearTimeout(this._stepDismissTimeout);
      this._stepDismissTimeout = null;
    }
  }

  private _listenForTaskCompletion(): void {
    this._doneHintSub = this._actions$
      .pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
      )
      .subscribe(() => {
        if (this.currentStep() === 'task-swipe-right') {
          this._showExploreStep();
        }
      });
  }
}
