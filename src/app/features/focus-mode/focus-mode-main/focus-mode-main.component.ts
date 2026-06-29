import { animate, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { Log } from '../../../core/log';
import { from, Observable, of, Subject, timer } from 'rxjs';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { debounceTime, switchMap, take } from 'rxjs/operators';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { fadeAnimation, fadeSwapAnimation } from '../../../ui/animations/fade.ani';
import { IssueService } from '../../issue/issue.service';
import { Store } from '@ngrx/store';
import {
  adjustRemainingTime,
  cancelFocusSession,
  completeFocusSession,
  completeTask,
  endFlowtimeSession,
  focusModeLoaded,
  pauseFocusSession,
  resetCycles,
  selectFocusTask,
  setFocusModeMode,
  setFocusSessionDuration,
  startFocusPreparation,
  startFocusSession,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { ICAL_TYPE } from '../../issue/issue.const';
import { MatFabButton, MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { InlineMarkdownComponent } from '../../../ui/inline-markdown/inline-markdown.component';
import { AsyncPipe } from '@angular/common';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { SimpleCounterButtonComponent } from '../../simple-counter/simple-counter-button/simple-counter-button.component';
import { TaskAttachmentListComponent } from '../../tasks/task-attachment/task-attachment-list/task-attachment-list.component';
import { slideInOutFromBottomAni } from '../../../ui/animations/slide-in-out-from-bottom.ani';
import { FocusModeService } from '../focus-mode.service';
import { FocusModeLayoutComponent } from '../focus-mode-layout/focus-mode-layout.component';
import { FocusClockFaceComponent } from '../focus-clock-face/focus-clock-face.component';
import { FocusModeTaskRowComponent } from '../focus-mode-task-row/focus-mode-task-row.component';
import {
  FOCUS_MODE_DEFAULTS,
  FocusMainUIState,
  FocusModeMode,
} from '../focus-mode.model';
import { FocusModeCountdownComponent } from '../focus-mode-countdown/focus-mode-countdown.component';
import { FocusModePreparationRocketComponent } from '../focus-mode-countdown/rocket/focus-mode-preparation-rocket.component';
import { InputDurationSliderComponent } from '../../../ui/duration/input-duration-slider/input-duration-slider.component';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from '../../../ui/segmented-button-group/segmented-button-group.component';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { ANI_STANDARD_TIMING } from '../../../ui/animations/animation.const';
import { FocusModeTaskSelectorComponent } from '../focus-mode-task-selector/focus-mode-task-selector.component';
import { DialogPomodoroSettingsComponent } from '../dialog-pomodoro-settings/dialog-pomodoro-settings.component';
import { DialogFlowtimeSettingsComponent } from '../dialog-flowtime-settings/dialog-flowtime-settings.component';

@Component({
  selector: 'focus-mode-main',
  templateUrl: './focus-mode-main.component.html',
  styleUrls: ['./focus-mode-main.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('modeSwitchFade', [
      transition('* => *', [
        style({ opacity: 0, transform: 'scale(0.8)' }),
        animate(ANI_STANDARD_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
      ]),
    ]),
    fadeAnimation,
    fadeSwapAnimation,
    slideInOutFromBottomAni,
  ],
  imports: [
    FocusModeLayoutComponent,
    FocusClockFaceComponent,
    FocusModeTaskRowComponent,
    MatIconButton,
    MatTooltip,
    MatIcon,
    InlineMarkdownComponent,
    TaskAttachmentListComponent,
    AsyncPipe,
    MsToMinuteClockStringPipe,
    TranslatePipe,
    IssueIconPipe,
    SimpleCounterButtonComponent,
    MatMiniFabButton,
    FocusModeCountdownComponent,
    FocusModePreparationRocketComponent,
    MatFabButton,
    InputDurationSliderComponent,
    SegmentedButtonGroupComponent,
    FocusModeTaskSelectorComponent,
  ],
  host: {
    ['[class.isSessionRunning]']: 'isSessionRunning()',
    ['[class.isSessionNotRunning]']: '!isSessionRunning()',
    ['[class.isWindowBlurred]']: '!isWindowFocused()',
  },
})
export class FocusModeMainComponent {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _taskAttachmentService = inject(TaskAttachmentService);
  private readonly _issueService = inject(IssueService);
  private readonly _store = inject(Store);
  private readonly _focusModeStorage = inject(FocusModeStorageService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _destroyRef = inject(DestroyRef);

  // How long the default inline rocket "lift off" plays before the session
  // starts. Matches the inline launch animation (0.8s: cross-fade in → settle →
  // launch) so the rocket fully clears before the InProgress view replaces the
  // play button.
  private readonly _LAUNCH_DURATION_MS = 800;
  // True while the brief inline rocket launch plays (default, prep screen off).
  readonly isLaunching = signal(false);

  readonly simpleCounterService = inject(SimpleCounterService);
  readonly taskService = inject(TaskService);
  readonly focusModeService = inject(FocusModeService);
  readonly focusModeConfig = this.focusModeService.focusModeConfig;

  readonly FocusModeMode = FocusModeMode;

  timeElapsed = this.focusModeService.timeElapsed;
  isCountTimeDown = this.focusModeService.isCountTimeDown;
  isSessionRunning = this.focusModeService.isSessionRunning;
  mode = this.focusModeService.mode;
  mainState = this.focusModeService.mainState;
  currentTask = toSignal(this.taskService.currentTask$);

  // Pausing the focus session intentionally dispatches `unsetCurrentTask`
  // (stops time accumulation). Without a fallback, the UI would flash the
  // "Select task to focus" placeholder during every pause. Resolve the
  // paused task from the store so the title stays put.
  private readonly _pausedTaskId = this._store.selectSignal(selectPausedTaskId);
  private readonly _pausedTask = toSignal(
    toObservable(this._pausedTaskId).pipe(
      switchMap((id) => (id ? this.taskService.getByIdLive$(id) : of(null))),
    ),
  );

  readonly displayedTask = computed(() => {
    const tracked = this.currentTask();
    if (tracked) return tracked;
    if (this.focusModeService.isSessionPaused()) {
      return this._pausedTask() ?? null;
    }
    return null;
  });

  // Quantize progress to 0.1% to reduce SVG repaints (~33% fewer updates)
  quantizedProgress = computed(
    () => Math.round((this.focusModeService.progress() || 0) * 10) / 10,
  );

  readonly parentTask = toSignal(
    toObservable(this.displayedTask).pipe(
      switchMap((t) =>
        t && t.parentId ? this.taskService.getByIdLive$(t.parentId) : of(null),
      ),
    ),
  );

  readonly parentTaskTitle = computed(() => {
    const parent = this.parentTask();
    if (!parent) {
      return null;
    }
    return parent.title;
  });

  private readonly _isPreparation = computed(
    () => this.mainState() === FocusMainUIState.Preparation,
  );
  private readonly _isCountdown = computed(
    () => this.mainState() === FocusMainUIState.Countdown,
  );
  private readonly _isInProgress = computed(
    () => this.mainState() === FocusMainUIState.InProgress,
  );

  displayDuration = signal(25 * 60 * 1000); // Default 25 minutes
  isTaskSelectorOpen = signal(false);

  // Pomodoro's work duration lives in synced global config. Persisting on every
  // keystroke emits one sync op per character, so coalesce rapid edits and write
  // once the user pauses (or when the session starts — see startSession()).
  private readonly _pomodoroDurationToPersist$ = new Subject<number>();

  // OS-level window focus. When the user tabs away (or focuses another app),
  // hide the muted control buttons so we don't blink at them.
  readonly isWindowFocused = signal(
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );

  isShowModeSelector = computed(() => this._isPreparation());
  isShowPomodoroSettings = computed(
    () => this._isPreparation() && this.mode() === FocusModeMode.Pomodoro,
  );
  isShowFlowtimeSettings = computed(
    () => this._isPreparation() && this.mode() === FocusModeMode.Flowtime,
  );
  isShowSimpleCounters = computed(() => this._isInProgress());
  isShowCompleteSessionButton = computed(() => this._isInProgress());
  isShowBottomControls = computed(() => this._isInProgress());
  isShowCountdown = computed(() => this._isCountdown());
  isShowPlayButton = computed(() => this._isPreparation());
  isShowDurationSlider = computed(
    () =>
      this._isPreparation() &&
      (this.mode() === FocusModeMode.Countdown || this.mode() === FocusModeMode.Pomodoro),
  );
  isShowTimeAdjustButtons = computed(
    () => this._isInProgress() && this.mode() !== FocusModeMode.Flowtime,
  );
  isPomodoro = computed(() => this.mode() === FocusModeMode.Pomodoro);

  // Play button should be disabled when no task is selected.
  // Sync between focus session and tracking is always on, so starting a session
  // without a task would leave tracking with nothing to bind to.
  isPlayButtonDisabled = computed(() => !this.currentTask());

  // Mode selector options
  readonly modeOptions = computed<ReadonlyArray<SegmentedButtonOption>>(() => {
    const currentMode = this.mode();
    const options: ReadonlyArray<SegmentedButtonOption> = [
      {
        id: FocusModeMode.Flowtime,
        icon: 'auto_awesome',
        labelKey: T.F.FOCUS_MODE.FLOWTIME,
        hintKey: T.F.FOCUS_MODE.FLOWTIME_HINT,
      },
      {
        id: FocusModeMode.Pomodoro,
        icon: 'timer',
        labelKey: T.F.FOCUS_MODE.POMODORO,
        hintKey: T.F.FOCUS_MODE.POMODORO_HINT,
      },
      {
        id: FocusModeMode.Countdown,
        icon: 'hourglass_bottom',
        labelKey: T.F.FOCUS_MODE.COUNTDOWN,
        hintKey: T.F.FOCUS_MODE.COUNTDOWN_HINT,
      },
    ];

    return this._isInProgress()
      ? options.filter(
          (option) => option.id === currentMode || option.id === FocusModeMode.Flowtime,
        )
      : options;
  });

  isFocusNotes = signal(false);
  isDragOver = signal(false);
  defaultTaskNotes = signal('');
  T: typeof T = T;

  issueUrl$: Observable<string | null> = this.taskService.currentTask$.pipe(
    switchMap((v) => {
      if (!v) {
        return of(null);
      }
      return v.issueType && v.issueId && v.issueProviderId
        ? from(this._issueService.issueLink(v.issueType, v.issueId, v.issueProviderId))
        : of(null);
    }),
    take(1),
  );

  private _dragEnterTarget?: HTMLElement;

  constructor() {
    this._store.dispatch(focusModeLoaded());

    // Use effect to reactively update defaultTaskNotes
    effect(() => {
      const tasks = this._globalConfigService.tasks();
      if (tasks) {
        this.defaultTaskNotes.set(tasks.notesTemplate);
      }
    });

    effect(() => {
      const duration = this.focusModeService.sessionDuration();
      const mode = this.mode();

      if (mode === FocusModeMode.Flowtime) {
        this.displayDuration.set(0);
        return;
      }

      // Pomodoro's editable duration is its configured work-period — read
      // straight from pomodoroConfig so the slider reflects the persisted
      // value, not the (initially zero) session duration.
      if (mode === FocusModeMode.Pomodoro && this._isPreparation()) {
        const pomodoroDuration = this.focusModeService.pomodoroConfig()?.duration;
        this.displayDuration.set(
          pomodoroDuration && pomodoroDuration > 0
            ? pomodoroDuration
            : FOCUS_MODE_DEFAULTS.SESSION_DURATION,
        );
        return;
      }

      if (duration > 0) {
        this.displayDuration.set(duration);
        return;
      }

      if (mode === FocusModeMode.Countdown) {
        const stored =
          this._focusModeStorage.getLastCountdownDuration() ??
          FOCUS_MODE_DEFAULTS.SESSION_DURATION;
        this.displayDuration.set(stored);
      }
    });

    this._pomodoroDurationToPersist$
      .pipe(debounceTime(400), takeUntilDestroyed())
      .subscribe((duration) => this._persistPomodoroDuration(duration));
  }

  @HostListener('window:focus') onWindowFocus(): void {
    this.isWindowFocused.set(true);
  }

  @HostListener('window:blur') onWindowBlur(): void {
    this.isWindowFocused.set(false);
  }

  @HostListener('dragenter', ['$event']) onDragEnter(ev: DragEvent): void {
    this._dragEnterTarget = ev.target as HTMLElement;
    ev.preventDefault();
    ev.stopPropagation();
    this.isDragOver.set(true);
  }

  @HostListener('dragleave', ['$event']) onDragLeave(ev: DragEvent): void {
    if (this._dragEnterTarget === (ev.target as HTMLElement)) {
      ev.preventDefault();
      ev.stopPropagation();
      this.isDragOver.set(false);
    }
  }

  @HostListener('drop', ['$event']) onDrop(ev: DragEvent): void {
    // Drop attaches to the displayedTask (= currentTask, or the paused task
    // during a paused session) so drops still work mid-pause.
    const t = this.displayedTask();
    if (!t) {
      return;
    }
    this._taskAttachmentService.createFromDrop(ev, t.id);
    ev.stopPropagation();
    this.isDragOver.set(false);
  }

  changeTaskNotes($event: string): void {
    if (
      !this.defaultTaskNotes() ||
      !$event ||
      $event.trim() !== this.defaultTaskNotes().trim()
    ) {
      // Use displayedTask so notes can be edited on the paused task too —
      // the live currentTask is null during pause.
      const t = this.displayedTask();
      if (!t) {
        Log.warn('changeTaskNotes: displayedTask is null, skipping update');
        return;
      }
      this.taskService.update(t.id, { notes: $event });
    }
  }

  finishCurrentTask(): void {
    const sessionRunning = this.isSessionRunning();

    this._store.dispatch(completeTask());

    const t = this.currentTask();
    const id = t && t.id;
    if (id) {
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: {
            id,
            changes: {
              isDone: true,
              doneOn: Date.now(),
            },
          },
        }),
      );
    }

    if (sessionRunning) {
      this.openTaskSelector();
    } else {
      this._store.dispatch(selectFocusTask());
    }
  }

  trackById(_i: number, item: SimpleCounter): string {
    return item.id;
  }

  updateTaskTitleIfChanged(isChanged: boolean, newTitle: string): void {
    if (isChanged) {
      const t = this.currentTask();
      if (!t) {
        Log.warn('updateTaskTitleIfChanged: currentTask is null, skipping update');
        return;
      }
      this.taskService.update(t.id, { title: newTitle });
    }
  }

  completeFocusSession(): void {
    if (this.mode() === FocusModeMode.Flowtime) {
      // Flowtime uses a dedicated action because the end of a session must
      // trigger a break offer effect based on elapsed time, rather than
      // immediately resetting the timer and UI state
      const currentTaskId = this.taskService.currentTaskId();
      this._store.dispatch(endFlowtimeSession({ pausedTaskId: currentTaskId }));
      return;
    }
    this._store.dispatch(completeFocusSession({ isManual: true }));
  }

  adjustTime(amountMs: number): void {
    this._store.dispatch(adjustRemainingTime({ amountMs }));
  }

  switchToTask(taskId: string): void {
    this.taskService.setCurrentId(taskId);
  }

  startSession(): void {
    // Ignore re-entrant starts while the inline launch is already playing (e.g.
    // a keyboard Enter on the still-focused play button, or a rapid double
    // click) — otherwise a second timer would dispatch startFocusSession again
    // and reset the freshly-started session.
    if (this.isLaunching()) {
      return;
    }

    // Persist any pending (debounced) Pomodoro duration edit before starting so
    // a value typed within the debounce window isn't dropped.
    if (this.mode() === FocusModeMode.Pomodoro) {
      this._persistPomodoroDuration(this.displayDuration());
    }

    const config = this.focusModeConfig();

    // Sync between focus session and tracking is always on — require a task
    // before starting so tracking has something to bind to.
    if (!this.currentTask()) {
      this.openTaskSelector();
      return;
    }

    // The full-screen preparation countdown is opt-in (off by default).
    if (config?.isShowPreparation) {
      this._store.dispatch(startFocusPreparation());
      return;
    }

    // Default: play a quick inline rocket launch from the play button, then start.
    this._launchThenStart();
  }

  onCountdownComplete(): void {
    // Opt-in full-prep path: the countdown screen finished, now start the session.
    this._dispatchStartSession();
    // Main UI state transitions are now handled by the store
  }

  private _launchThenStart(): void {
    // Honor "reduce motion": skip the rocket flourish and its timed delay,
    // starting immediately. Otherwise a motion-sensitive user would just wait
    // out an 800ms delay for an animation they never see.
    if (this._prefersReducedMotion()) {
      this._dispatchStartSession();
      return;
    }

    this.isLaunching.set(true);
    timer(this._LAUNCH_DURATION_MS)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => {
        this.isLaunching.set(false);
        // The task could have been deselected during the brief launch window.
        if (!this.currentTask()) {
          return;
        }
        this._dispatchStartSession();
      });
  }

  private _prefersReducedMotion(): boolean {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  }

  private _dispatchStartSession(): void {
    // For Flowtime mode, duration must be 0 to count indefinitely
    const duration = this.mode() === FocusModeMode.Flowtime ? 0 : this.displayDuration();
    this._store.dispatch(startFocusSession({ duration }));
  }

  pauseSession(): void {
    const currentTaskId = this.taskService.currentTaskId();
    this._store.dispatch(pauseFocusSession({ pausedTaskId: currentTaskId }));
  }

  resumeSession(): void {
    this._store.dispatch(unPauseFocusSession());
  }

  resetCycles(): void {
    this._store.dispatch(resetCycles());
  }

  exitToPlanning(): void {
    // Cancelling the session clears tracking and hides the overlay, returning
    // the user to wherever they were before focus mode (no forced navigation).
    this._store.dispatch(cancelFocusSession());
  }

  selectMode(mode: FocusModeMode | string | number): void {
    if (!Object.values(FocusModeMode).includes(mode as FocusModeMode)) {
      return;
    }

    if (this._isInProgress() && mode !== this.mode() && mode !== FocusModeMode.Flowtime) {
      return;
    }

    this._store.dispatch(setFocusModeMode({ mode: mode as FocusModeMode }));
  }

  openPomodoroSettings(): void {
    this._matDialog.open(DialogPomodoroSettingsComponent);
  }

  openFlowtimeSettings(): void {
    this._matDialog.open(DialogFlowtimeSettingsComponent);
  }

  onDurationChange(duration: number): void {
    this.displayDuration.set(duration);

    // Pomodoro's duration is persistent (synced) config, not session store.
    // Debounce the write (see _pomodoroDurationToPersist$) so typing "25" emits
    // one sync op rather than one per keystroke.
    if (this.mode() === FocusModeMode.Pomodoro) {
      this._pomodoroDurationToPersist$.next(duration);
      return;
    }

    this._store.dispatch(setFocusSessionDuration({ focusSessionDuration: duration }));
  }

  private _persistPomodoroDuration(duration: number): void {
    const current = this.focusModeService.pomodoroConfig();
    if (current && current.duration !== duration) {
      this._globalConfigService.updateSection('pomodoro', { ...current, duration }, true);
    }
  }

  openTaskSelector(): void {
    this.isTaskSelectorOpen.set(true);
  }

  closeTaskSelector(): void {
    this.isTaskSelectorOpen.set(false);
  }

  onTaskSelected(taskId: string): void {
    this.switchToTask(taskId);
    this.closeTaskSelector();
  }

  protected readonly ICAL_TYPE = ICAL_TYPE;
}
