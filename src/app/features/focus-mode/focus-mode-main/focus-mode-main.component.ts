import { animate, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { Log } from '../../../core/log';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import { from, Observable, of } from 'rxjs';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import { switchMap, take } from 'rxjs/operators';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { IssueService } from '../../issue/issue.service';
import { Store } from '@ngrx/store';
import {
  adjustRemainingTime,
  completeFocusSession,
  completeTask,
  focusModeLoaded,
  pauseFocusSession,
  selectFocusTask,
  setFocusModeMode,
  setFocusSessionDuration,
  startFocusPreparation,
  startFocusSession,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { ICAL_TYPE } from '../../issue/issue.const';
import { TaskTitleComponent } from '../../../ui/task-title/task-title.component';
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
import { BreathingDotComponent } from '../../../ui/breathing-dot/breathing-dot.component';
import {
  FOCUS_MODE_DEFAULTS,
  FocusMainUIState,
  FocusModeMode,
} from '../focus-mode.model';
import { FocusModeCountdownComponent } from '../focus-mode-countdown/focus-mode-countdown.component';
import { InputDurationSliderComponent } from '../../../ui/duration/input-duration-slider/input-duration-slider.component';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from '../../../ui/segmented-button-group/segmented-button-group.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { FocusModeStorageService } from '../focus-mode-storage.service';
import { ANI_STANDARD_TIMING } from '../../../ui/animations/animation.const';
import { FocusModeTaskSelectorComponent } from '../focus-mode-task-selector/focus-mode-task-selector.component';
import { DialogPomodoroSettingsComponent } from '../dialog-pomodoro-settings/dialog-pomodoro-settings.component';

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
    expandAnimation,
    fadeAnimation,
    slideInOutFromBottomAni,
  ],
  imports: [
    TaskTitleComponent,
    BreathingDotComponent,
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
    MatFabButton,
    InputDurationSliderComponent,
    SegmentedButtonGroupComponent,
    FocusModeTaskSelectorComponent,
  ],
  host: {
    ['[class.isSessionRunning]']: 'isSessionRunning()',
    ['[class.isSessionNotRunning]']: '!isSessionRunning()',
  },
})
export class FocusModeMainComponent {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _taskAttachmentService = inject(TaskAttachmentService);
  private readonly _issueService = inject(IssueService);
  private readonly _store = inject(Store);
  private readonly _focusModeStorage = inject(FocusModeStorageService);
  private readonly _matDialog = inject(MatDialog);

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

  readonly parentTask = toSignal(
    this.taskService.currentTask$.pipe(
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

  isShowModeSelector = computed(() => this._isPreparation());
  isShowPomodoroSettings = computed(
    () => this._isPreparation() && this.mode() === FocusModeMode.Pomodoro,
  );
  isShowSimpleCounters = computed(() => this._isInProgress());
  isShowPauseButton = computed(() => this._isInProgress());
  isShowCompleteSessionButton = computed(() => this._isInProgress());
  isShowBottomControls = computed(() => this._isInProgress());
  isShowCountdown = computed(() => this._isCountdown());
  isShowPlayButton = computed(() => this._isPreparation());
  isShowDurationSlider = computed(
    () => this._isPreparation() && this.mode() === FocusModeMode.Countdown,
  );
  isShowTimeAdjustButtons = computed(
    () => this._isInProgress() && this.mode() !== FocusModeMode.Flowtime,
  );

  // Play button should be disabled when sync with tracking is enabled but no task is selected
  isPlayButtonDisabled = computed(() => {
    const config = this.focusModeConfig();
    return config?.isSyncSessionWithTracking && !this.currentTask();
  });

  // Mode selector options
  readonly modeOptions: ReadonlyArray<SegmentedButtonOption> = [
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
    const t = this.currentTask();
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
      const t = this.currentTask();
      if (!t) {
        Log.warn('changeTaskNotes: currentTask is null, skipping update');
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
    this._store.dispatch(completeFocusSession({ isManual: true }));
  }

  adjustTime(amountMs: number): void {
    this._store.dispatch(adjustRemainingTime({ amountMs }));
  }

  switchToTask(taskId: string): void {
    this.taskService.setCurrentId(taskId);
  }

  startSession(): void {
    const config = this.focusModeConfig();

    // If sync with tracking is enabled, require a task to be selected
    if (config?.isSyncSessionWithTracking && !this.currentTask()) {
      this.openTaskSelector();
      return;
    }

    const shouldSkipPreparation = config?.isSkipPreparation || false;
    if (shouldSkipPreparation) {
      const duration =
        this.mode() === FocusModeMode.Flowtime ? 0 : this.displayDuration();
      this._store.dispatch(
        startFocusSession({
          duration,
          isManualSessionCompletion: !!config?.isManualBreakStart,
        }),
      );
      return;
    }

    this._store.dispatch(startFocusPreparation());
  }

  onCountdownComplete(): void {
    // For Flowtime mode, duration must be 0 to count indefinitely
    const duration = this.mode() === FocusModeMode.Flowtime ? 0 : this.displayDuration();
    this._store.dispatch(
      startFocusSession({
        duration,
        isManualSessionCompletion: !!this.focusModeConfig()?.isManualBreakStart,
      }),
    );
    // Main UI state transitions are now handled by the store
  }

  pauseSession(): void {
    const currentTaskId = this.taskService.currentTaskId();
    this._store.dispatch(pauseFocusSession({ pausedTaskId: currentTaskId }));
  }

  resumeSession(): void {
    this._store.dispatch(unPauseFocusSession());
  }

  selectMode(mode: FocusModeMode | string | number): void {
    if (!Object.values(FocusModeMode).includes(mode as FocusModeMode)) {
      return;
    }
    this._store.dispatch(setFocusModeMode({ mode: mode as FocusModeMode }));
  }

  openPomodoroSettings(): void {
    this._matDialog.open(DialogPomodoroSettingsComponent);
  }

  onDurationChange(duration: number): void {
    this.displayDuration.set(duration);
    this._store.dispatch(setFocusSessionDuration({ focusSessionDuration: duration }));
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
