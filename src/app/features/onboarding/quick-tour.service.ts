import { computed, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter, first } from 'rxjs/operators';
import { Log } from '../../core/log';
import { LS } from '../../core/persistence/storage-keys.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { isTouchActive } from '../../util/input-intent';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { GlobalConfigService } from '../config/global-config.service';
import { addProject } from '../project/store/project.actions';
import { addTag } from '../tag/store/tag.actions';
import { TODAY_TAG } from '../tag/tag.const';
import { TaskService } from '../tasks/task.service';
import { TaskFocusService } from '../tasks/task-focus.service';
import { addSubTask, setCurrentTask } from '../tasks/store/task.actions';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { selectUndoneTodayTaskIds } from '../work-context/store/work-context.selectors';

export type QuickTourStep =
  | 'track-time'
  | 'add-subtask'
  | 'task-menu'
  | 'organize'
  | 'planner'
  | 'want-more';

const QUICK_TOUR_STEPS: readonly QuickTourStep[] = [
  'track-time',
  'add-subtask',
  'task-menu',
  'organize',
  'planner',
  'want-more',
];

const TASK_STEPS: readonly QuickTourStep[] = ['track-time', 'add-subtask', 'task-menu'];

/** How long the ✓ shows after the user did what a step asked. */
export const QUICK_TOUR_ACK_MS = 600;

const TODAY_ROUTE = `/tag/${TODAY_TAG.id}/tasks`;

interface QuickTourStepsCtx {
  isTouch: boolean;
  isTimeTrackingEnabled: boolean;
  isPlannerEnabled: boolean;
  hasTask: boolean;
  /** The user opened the task menu during part 1, so touch skips its menu step. */
  isTaskMenuLearned: boolean;
}

/**
 * The steps for this layout and feature set. Touch has no hover ▶ and no right
 * click, so its single task step uses the swipe-left menu part 1 taught.
 */
export const getQuickTourSteps = (ctx: QuickTourStepsCtx): QuickTourStep[] => {
  const taskSteps: QuickTourStep[] = !ctx.hasTask
    ? []
    : ctx.isTouch
      ? ctx.isTaskMenuLearned
        ? []
        : ['task-menu']
      : ctx.isTimeTrackingEnabled
        ? ['track-time', 'add-subtask']
        : ['add-subtask'];
  return [
    ...taskSteps,
    'organize',
    ...(ctx.isPlannerEnabled ? (['planner'] as const) : []),
    'want-more',
  ];
};

interface QuickTourState {
  steps: QuickTourStep[];
  index: number;
  taskId: string | null;
  isTaskMenuLearned: boolean;
  /** The step that adds "Timer's running…", because the step before started it. */
  timerNoteStep: QuickTourStep | null;
}

interface PersistedQuickTourState {
  step: QuickTourStep;
  taskId: string | null;
  /** Missing in state saved before this field existed. */
  isTaskMenuLearned?: boolean;
}

/**
 * Onboarding part 2: a few steps on the user's own task and the nav, then the
 * "Want more?" card. Started from part 1's last tip or Help → Quick tour.
 *
 * Kept apart from OnboardingHintService on purpose: part 1 ends on reload,
 * the tour resumes. State is device-local and never synced; the tour only
 * points at things and writes no config.
 */
@Injectable({ providedIn: 'root' })
export class QuickTourService {
  private _router = inject(Router);
  private _store = inject(Store);
  private _layoutService = inject(LayoutService);
  private _taskService = inject(TaskService);
  private _taskFocusService = inject(TaskFocusService);
  private _globalConfigService = inject(GlobalConfigService);
  private _localActions$: Observable<Action> = inject(LOCAL_ACTIONS);

  private _state = signal<QuickTourState | null>(null);
  private _ackTimeout: ReturnType<typeof setTimeout> | null = null;
  private _taskEntities = this._store.selectSignal(selectTaskEntities);
  private _undoneTodayTaskIds = this._store.selectSignal(selectUndoneTodayTaskIds);

  /** True for the ✓ beat after a step was done, before the tour moves on. */
  readonly isAcknowledging = signal(false);
  readonly isActive = computed(() => this._state() !== null);
  readonly tourTaskId = computed(() => this._state()?.taskId ?? null);
  readonly stepNr = computed(() => (this._state()?.index ?? 0) + 1);
  readonly stepCount = computed(() => this._state()?.steps.length ?? 0);

  private _rawStep = computed<QuickTourStep | null>(() => {
    const state = this._state();
    return state ? (state.steps[state.index] ?? null) : null;
  });

  /** The step to show. Hidden while the composer or, for task steps, the task menu is open. */
  readonly currentStep = computed<QuickTourStep | null>(() => {
    const step = this._rawStep();
    if (!step || this._layoutService.isShowAddTaskBar()) {
      return null;
    }
    if (TASK_STEPS.includes(step) && this._taskFocusService.isTaskContextMenuOpen()) {
      return null;
    }
    return step;
  });

  readonly isTimerNoteShown = computed(() => {
    const step = this.currentStep();
    return (
      step !== null &&
      step === this._state()?.timerNoteStep &&
      this._taskService.currentTaskId() !== null
    );
  });

  constructor() {
    this._localActions$
      .pipe(ofType(setCurrentTask), takeUntilDestroyed())
      .subscribe(({ id }) => {
        if (id !== null) {
          this._completeTaskStep(['track-time', 'task-menu'], true);
        }
      });
    this._localActions$
      .pipe(ofType(addSubTask), takeUntilDestroyed())
      .subscribe(() => this._completeTaskStep(['add-subtask', 'task-menu'], false));
    this._localActions$
      .pipe(ofType(addProject, addTag), takeUntilDestroyed())
      .subscribe(() => this.complete('organize'));
    this._router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        if (event.urlAfterRedirects.startsWith('/planner')) {
          this.complete('planner');
        }
      });

    const persisted = this._readPersisted();
    if (persisted) {
      inject(DataInitStateService)
        .isAllDataLoadedInitially$.pipe(first())
        .subscribe(() => this._resume(persisted));
    }
  }

  /**
   * Starts (or restarts) the tour on Today. Without a task the task steps are
   * skipped; by default the tour uses the first undone task in Today.
   */
  start(taskId?: string | null, isTaskMenuLearned = false): void {
    const id = this._isUndoneTask(taskId) ? taskId : this._findFirstTodayTaskId();
    this._clearAck();
    this._setState({
      steps: this._getSteps(id !== null, isTaskMenuLearned),
      index: 0,
      taskId: id,
      isTaskMenuLearned,
      timerNoteStep: null,
    });
    if (!this._router.url.startsWith(TODAY_ROUTE)) {
      void this._router.navigateByUrl(TODAY_ROUTE);
    }
  }

  next(): void {
    this._clearAck();
    this._advance();
  }

  /** The user did what `step` asks: show ✓, then move on. */
  complete(step: QuickTourStep): void {
    if (this._rawStep() !== step || this.isAcknowledging()) {
      return;
    }
    this.isAcknowledging.set(true);
    this._ackTimeout = setTimeout(() => {
      this._ackTimeout = null;
      this.isAcknowledging.set(false);
      this._advance();
    }, QUICK_TOUR_ACK_MS);
  }

  /** The step's anchor is not on screen (feature off, nothing to point at). */
  skipStep(step: QuickTourStep): void {
    if (this._rawStep() === step && !this.isAcknowledging()) {
      this._advance();
    }
  }

  end(): void {
    this._clearAck();
    this._state.set(null);
    localStorage.removeItem(LS.QUICK_TOUR_STATE);
  }

  openSettings(): void {
    this.end();
    void this._router.navigate(['/config'], { queryParams: { section: 'appFeatures' } });
  }

  private _completeTaskStep(steps: QuickTourStep[], isTrackingStarted: boolean): void {
    const step = untracked(this._rawStep);
    const state = untracked(this._state);
    if (!state || !step || !steps.includes(step) || this.isAcknowledging()) {
      return;
    }
    if (isTrackingStarted) {
      this._setState({ ...state, timerNoteStep: state.steps[state.index + 1] ?? null });
    }
    this.complete(step);
  }

  private _advance(): void {
    const state = this._state();
    if (!state) {
      return;
    }
    if (state.index + 1 >= state.steps.length) {
      this.end();
      return;
    }
    this._setState({ ...state, index: state.index + 1 });
  }

  private _resume({
    step,
    taskId,
    isTaskMenuLearned = false,
  }: PersistedQuickTourState): void {
    // Help → Quick tour may have started a fresh tour meanwhile.
    if (this._state()) {
      return;
    }
    const id = this._isUndoneTask(taskId) ? taskId : null;
    const steps = this._getSteps(id !== null, isTaskMenuLearned);
    const index = steps.indexOf(step);
    if (index === -1) {
      // The step no longer applies, e.g. its feature was switched off.
      this.end();
      return;
    }
    this._setState({ steps, index, taskId: id, isTaskMenuLearned, timerNoteStep: null });
  }

  private _getSteps(hasTask: boolean, isTaskMenuLearned: boolean): QuickTourStep[] {
    const appFeatures = this._globalConfigService.appFeatures();
    return getQuickTourSteps({
      isTouch: isTouchActive(),
      isTimeTrackingEnabled: appFeatures.isTimeTrackingEnabled,
      isPlannerEnabled: appFeatures.isPlannerEnabled,
      hasTask,
      isTaskMenuLearned,
    });
  }

  private _isUndoneTask(id: string | null | undefined): id is string {
    const task = id ? this._taskEntities()[id] : undefined;
    return !!task && !task.isDone;
  }

  /** Top-level only: the steps add a subtask to it. */
  private _findFirstTodayTaskId(): string | null {
    const entities = this._taskEntities();
    return this._undoneTodayTaskIds().find((id) => !entities[id]?.parentId) ?? null;
  }

  private _setState(state: QuickTourState): void {
    this._state.set(state);
    const persisted: PersistedQuickTourState = {
      step: state.steps[state.index],
      taskId: state.taskId,
      isTaskMenuLearned: state.isTaskMenuLearned,
    };
    localStorage.setItem(LS.QUICK_TOUR_STATE, JSON.stringify(persisted));
  }

  private _readPersisted(): PersistedQuickTourState | null {
    const raw = localStorage.getItem(LS.QUICK_TOUR_STATE);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isPersistedState(parsed)) {
        return parsed;
      }
    } catch (e) {
      Log.warn('[QuickTour] Ignoring unreadable saved tour state', e);
    }
    localStorage.removeItem(LS.QUICK_TOUR_STATE);
    return null;
  }

  private _clearAck(): void {
    if (this._ackTimeout !== null) {
      clearTimeout(this._ackTimeout);
      this._ackTimeout = null;
    }
    this.isAcknowledging.set(false);
  }
}

const isPersistedState = (value: unknown): value is PersistedQuickTourState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { step, taskId, isTaskMenuLearned } = value as Record<string, unknown>;
  return (
    QUICK_TOUR_STEPS.includes(step as QuickTourStep) &&
    (taskId === null || typeof taskId === 'string') &&
    (isTaskMenuLearned === undefined || typeof isTaskMenuLearned === 'boolean')
  );
};
