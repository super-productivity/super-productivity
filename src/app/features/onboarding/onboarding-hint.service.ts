import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ofType } from '@ngrx/effects';
import { NavigationEnd, Router } from '@angular/router';
import { Action, Store } from '@ngrx/store';
import { Observable, Subscription } from 'rxjs';
import { concatMap, filter, first } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { isTouchActive } from '../../util/input-intent';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigService } from '../config/global-config.service';
import { ProjectService } from '../project/project.service';
import { INBOX_PROJECT } from '../project/project.const';
import { TODAY_TAG } from '../tag/tag.const';
import { TaskService } from '../tasks/task.service';
import { TaskFocusService } from '../tasks/task-focus.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { WorkContextService } from '../work-context/work-context.service';
import { QuickTourService } from './quick-tour.service';

export type OnboardingStep =
  | 'create-task'
  | 'task-swipe-left'
  | 'today-and-inbox'
  // Shown once on the next page when the user left Today on the last tip.
  | 'quick-tour-offer'
  // "No thanks": names the way back, then guidance ends.
  | 'quick-tour-declined';

/** How long the "It's under Help → Quick tour" line stays after No thanks. */
export const QUICK_TOUR_DECLINED_MS = 2500;

type OnboardingPhase = 'idle' | 'await-first-task' | OnboardingStep;

/** More projects than the default ones means this is not a new user. */
const RETURNING_USER_MIN_PROJECTS = 3;

/**
 * First-run guidance: value first, no upfront decision. New installs already
 * start with a calm feature set (see NEW_INSTALL_APP_FEATURES), so guidance
 * only teaches the basics and never changes settings.
 *
 * 1. Point at "+" until the user creates their first real task (any local
 *    creation path; example tasks and repeat instances do not count).
 * 2. Phones only: on the task row, "swipe left for more actions" (advances once
 *    the task menu was opened and closed, a task is marked done or the first
 *    task is deleted).
 * 3. Point at the first task's "Inbox" label and explain it (#8824): it shows
 *    in Today because it is planned for today, and lives in the Inbox because
 *    it has no project. Only shown while that is true.
 *
 * The last tip offers the quick tour (Show me more / No thanks). Leaving Today
 * while it shows offers it once more on the next page; leaving again, ✕ or an
 * earlier tip closed ends guidance without it. Help → Quick tour always works.
 *
 * Starting a Help tour ends guidance, so only one of them is ever on screen.
 * No step advances on a timer; only the No thanks line goes away on its own.
 * Reloading after the first task ends guidance.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingHintService {
  private _layoutService = inject(LayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _taskFocusService = inject(TaskFocusService);
  private _projectService = inject(ProjectService);
  private _globalConfigService = inject(GlobalConfigService);
  private _router = inject(Router);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);
  private _localActions$: Observable<Action> = inject(LOCAL_ACTIONS);
  private _quickTourService = inject(QuickTourService);

  private _phase = signal<OnboardingPhase>('idle');
  private _wasTaskMenuOpened = false;
  private _isFirstTaskComposerAutoCloseUsed = false;
  private _startSub: Subscription | null = null;
  private _taskAddSub: Subscription | null = null;
  private _taskDoneSub: Subscription | null = null;
  private _navigationSub: Subscription | null = null;
  private _declinedTimeout: ReturnType<typeof setTimeout> | null = null;
  private _taskEntities = this._store.selectSignal(selectTaskEntities);
  private _activeWorkContextId = toSignal(this._workContextService.activeWorkContextId$, {
    initialValue: null,
  });

  readonly firstTaskId = signal<string | null>(null);

  /** Row the swipe hints point at: the first task while undone, else any undone task. */
  readonly swipeTargetTaskId = computed(() => {
    const id = this.firstTaskId();
    const task = id ? this._taskEntities()[id] : undefined;
    return task && !task.isDone ? task.id : null;
  });

  /**
   * Hints hide while the composer, the phone menu, a task panel or task menu is
   * open. They sit above the phone menu otherwise.
   */
  readonly currentStep = computed<OnboardingStep | null>(() => {
    const phase = this._phase();
    if (
      phase === 'idle' ||
      this._layoutService.isShowAddTaskBar() ||
      this._layoutService.isMobileSideNavOpen()
    ) {
      return null;
    }
    if (phase === 'await-first-task') {
      return 'create-task';
    }
    if (phase === 'task-swipe-left' || phase === 'today-and-inbox') {
      const isTaskUiOpen =
        this._taskFocusService.isTaskContextMenuOpen() ||
        this._taskService.selectedTaskId() !== null;
      return isTaskUiOpen ? null : phase;
    }
    return phase;
  });

  constructor() {
    if (!OnboardingHintService.isOnboardingInProgress()) {
      return;
    }
    // The first task was already added in an earlier session (or a preset was
    // chosen in the previous onboarding flow): don't start over.
    if (localStorage.getItem(LS.ONBOARDING_PRESET_DONE)) {
      this._markDone();
      return;
    }

    // "Swipe left" is learned once the task menu was opened and closed again.
    effect(() => {
      const isMenuOpen = this._taskFocusService.isTaskContextMenuOpen();
      if (this._phase() !== 'task-swipe-left') {
        return;
      }
      if (isMenuOpen) {
        this._wasTaskMenuOpened = true;
      } else if (this._wasTaskMenuOpened) {
        untracked(() => this._advanceToLastStep());
      }
    });

    // A deleted first task leaves nothing to swipe or explain; the hint would
    // otherwise stay stuck on an empty list. The task menu closes before the
    // delete is confirmed, so this also covers the last step.
    // Moving to a project can leave the row on Today, but invalidates the Inbox tip.
    effect(() => {
      const phase = this._phase();
      const id = this.firstTaskId();
      if (
        (phase === 'task-swipe-left' || phase === 'today-and-inbox') &&
        id &&
        (!this._taskEntities()[id] ||
          (phase === 'today-and-inbox' &&
            this._taskEntities()[id]?.projectId !== INBOX_PROJECT.id))
      ) {
        untracked(() => this._markDone());
      }
    });

    // Help → Quick tour during guidance: only one of them is on screen.
    effect(() => {
      if (this._quickTourService.isActive() && untracked(this._phase) !== 'idle') {
        untracked(() => this._markDone());
      }
    });

    // A returning user who sets up sync needs no new-user guidance.
    effect(() => {
      if (this._globalConfigService.sync()?.isEnabled) {
        untracked(() => this._markDone());
      }
    });

    this._startSub = this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(
        concatMap(() => this._projectService.list$),
        first(),
      )
      .subscribe((projects) => {
        // Tasks we did not seed ourselves mean an install that predates the
        // onboarding flags, not a new user.
        const hasNonExampleTasks =
          !localStorage.getItem(LS.EXAMPLE_TASKS_CREATED) &&
          Object.keys(this._taskEntities()).length > 0;
        if (
          projects.length >= RETURNING_USER_MIN_PROJECTS ||
          hasNonExampleTasks ||
          this._globalConfigService.sync()?.isEnabled
        ) {
          this._markDone();
          return;
        }
        this._phase.set('await-first-task');
      });

    this._taskAddSub = this._localActions$
      .pipe(
        ofType(TaskSharedActions.addTask),
        filter(({ isExampleTask, task }) => !isExampleTask && !task.repeatCfgId),
      )
      .subscribe(({ task }) => this._onFirstTaskCandidate(task.id));

    // The last tip is done once the user moves on to any page, e.g. the Inbox;
    // the tour is offered there once more, and leaving again ends it.
    this._navigationSub = this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const phase = this._phase();
        if (phase === 'today-and-inbox') {
          this._phase.set('quick-tour-offer');
        } else if (phase === 'quick-tour-offer' || phase === 'quick-tour-declined') {
          this._markDone();
        }
      });

    // Marking a task done (swipe right, checkbox, ...) completes the swipe hint.
    this._taskDoneSub = this._localActions$
      .pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
      )
      .subscribe(() => {
        if (this._phase() === 'task-swipe-left') {
          this._advanceToLastStep();
        }
      });
  }

  static isOnboardingInProgress(): boolean {
    return (
      !localStorage.getItem(LS.ONBOARDING_HINTS_DONE) &&
      !localStorage.getItem(LS.IS_SKIP_TOUR)
    );
  }

  /**
   * On phones the composer covers the task list; close it after the first real
   * task so the swipe tips next to it become visible. Later tasks keep it open.
   */
  shouldAutoCloseFirstTaskComposer(taskId: string): boolean {
    if (
      this._isFirstTaskComposerAutoCloseUsed ||
      this._phase() !== 'task-swipe-left' ||
      this.firstTaskId() !== taskId
    ) {
      return false;
    }
    this._isFirstTaskComposerAutoCloseUsed = true;
    return true;
  }

  /** Touch input on the phone layout, where tasks are handled with swipes. */
  isSwipeLayout(): boolean {
    return isTouchActive() && this._layoutService.isShowMobileBottomNav();
  }

  /** ✕ / Esc: ends guidance quietly, without offering the tour. */
  skip(): void {
    this._markDone();
  }

  /** Show me more: the tour continues on the task the last tip explained. */
  showMeMore(): void {
    const taskId = this.firstTaskId();
    this._markDone();
    this._quickTourService.start(taskId, this._wasTaskMenuOpened);
  }

  /** No thanks: say where the tour lives, then go. */
  decline(): void {
    this._phase.set('quick-tour-declined');
    this._clearDeclinedTimeout();
    this._declinedTimeout = setTimeout(() => this._markDone(), QUICK_TOUR_DECLINED_MS);
  }

  private _onFirstTaskCandidate(taskId: string): void {
    if (this._phase() !== 'await-first-task' || !this._taskEntities()[taskId]) {
      return;
    }
    // From here on a reload counts as having finished the first step.
    localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
    this.firstTaskId.set(taskId);

    if (this.isSwipeLayout()) {
      this._wasTaskMenuOpened = false;
      this._phase.set('task-swipe-left');
    } else {
      this._advanceToLastStep();
    }
  }

  /**
   * The last tip explains the first task's own place, so it only shows where
   * that holds: in the Inbox and on Today. A task created in a project or
   * elsewhere, or already deleted, ends guidance instead, so there is no place
   * to offer the tour; Help → Quick tour still has it.
   */
  private _advanceToLastStep(): void {
    const id = this.firstTaskId();
    const task = id ? this._taskEntities()[id] : undefined;
    if (
      task?.projectId === INBOX_PROJECT.id &&
      this._activeWorkContextId() === TODAY_TAG.id
    ) {
      this._phase.set('today-and-inbox');
    } else {
      this._markDone();
    }
  }

  private _clearDeclinedTimeout(): void {
    if (this._declinedTimeout !== null) {
      clearTimeout(this._declinedTimeout);
      this._declinedTimeout = null;
    }
  }

  private _markDone(): void {
    localStorage.setItem(LS.ONBOARDING_PRESET_DONE, 'true');
    localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
    this._startSub?.unsubscribe();
    this._startSub = null;
    this._taskAddSub?.unsubscribe();
    this._taskAddSub = null;
    this._taskDoneSub?.unsubscribe();
    this._taskDoneSub = null;
    this._navigationSub?.unsubscribe();
    this._navigationSub = null;
    this._clearDeclinedTimeout();
    this.firstTaskId.set(null);
    this._phase.set('idle');
  }
}
