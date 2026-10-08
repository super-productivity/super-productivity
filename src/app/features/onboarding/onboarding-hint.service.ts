import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ofType } from '@ngrx/effects';
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
import { TaskService } from '../tasks/task.service';
import { TaskFocusService } from '../tasks/task-focus.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { WorkContextService } from '../work-context/work-context.service';

export type OnboardingStep =
  | 'create-task'
  | 'task-swipe-left'
  | 'task-swipe-right'
  | 'explore-inbox';

type OnboardingPhase = 'idle' | 'await-first-task' | OnboardingStep;

const readExampleTaskIds = (): string[] => {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(LS.EXAMPLE_TASK_IDS) ?? '[]');
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

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
 *    the task menu was opened and closed), then "swipe right to mark it as done"
 *    (ends once a task is marked done).
 * 3. If the seeded example tasks are still in the Inbox, point at the Inbox once
 *    (ends when the Inbox is opened). Otherwise they are easy to never find, and
 *    they explain what else can be switched on.
 *
 * No step advances on a timer. Reloading after the first task ends guidance.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingHintService {
  private _layoutService = inject(LayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _taskFocusService = inject(TaskFocusService);
  private _projectService = inject(ProjectService);
  private _globalConfigService = inject(GlobalConfigService);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);
  private _localActions$: Observable<Action> = inject(LOCAL_ACTIONS);

  private _phase = signal<OnboardingPhase>('idle');
  private _wasTaskMenuOpened = false;
  private _isFirstTaskComposerAutoCloseUsed = false;
  private _startSub: Subscription | null = null;
  private _taskAddSub: Subscription | null = null;
  private _taskDoneSub: Subscription | null = null;
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

  /** Hints hide while the composer, a task panel or task menu is open. */
  readonly currentStep = computed<OnboardingStep | null>(() => {
    const phase = this._phase();
    if (phase === 'idle' || this._layoutService.isShowAddTaskBar()) {
      return null;
    }
    if (phase === 'await-first-task') {
      return 'create-task';
    }
    if (phase === 'task-swipe-left' || phase === 'task-swipe-right') {
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
        this._phase.set('task-swipe-right');
      }
    });

    // The Inbox tip is done once the Inbox is open.
    effect(() => {
      if (
        this._phase() === 'explore-inbox' &&
        this._activeWorkContextId() === INBOX_PROJECT.id
      ) {
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

    // Marking a task done (swipe right, checkbox, ...) completes the swipe hints.
    this._taskDoneSub = this._localActions$
      .pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
      )
      .subscribe(() => {
        const phase = this._phase();
        if (phase === 'task-swipe-left' || phase === 'task-swipe-right') {
          this._advanceToExplore();
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

  skip(): void {
    this._markDone();
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
      this._advanceToExplore();
    }
  }

  /** Point at the Inbox only while the seeded example tasks are still there. */
  private _advanceToExplore(): void {
    const entities = this._taskEntities();
    const hasExampleTasksInInbox = readExampleTaskIds().some((id) => {
      const task = entities[id];
      return !!task && task.projectId === INBOX_PROJECT.id && !task.isDone;
    });
    if (hasExampleTasksInInbox && this._activeWorkContextId() !== INBOX_PROJECT.id) {
      this._phase.set('explore-inbox');
    } else {
      this._markDone();
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
    this.firstTaskId.set(null);
    this._phase.set('idle');
  }
}
