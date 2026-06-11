import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FocusModeService } from '../focus-mode.service';
import { FocusMainUIState, FocusModeMode } from '../focus-mode.model';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { Store } from '@ngrx/store';
import {
  completeBreak,
  exitBreakToPlanning,
  pauseFocusSession,
  resetCycles,
  skipBreak,
  startBreak,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskTrackingInfoComponent } from '../task-tracking-info/task-tracking-info.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../tasks/task.service';
import { unsetCurrentTask } from '../../tasks/store/task.actions';

@Component({
  selector: 'focus-mode-break',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconButton,
    MatProgressSpinnerModule,
    MatTooltip,
    MsToMinuteClockStringPipe,
    MatIcon,
    TranslatePipe,
    TaskTrackingInfoComponent,
  ],
  templateUrl: './focus-mode-break.component.html',
  styleUrl: './focus-mode-break.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeBreakComponent {
  readonly focusModeService = inject(FocusModeService);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  T: typeof T = T;

  private readonly _pausedTaskId = toSignal(this._store.select(selectPausedTaskId));
  readonly remainingTime = computed(() => {
    return this.focusModeService.timeRemaining() || 0;
  });

  readonly progressPercentage = computed(() => {
    return this.focusModeService.progress() || 0;
  });

  readonly isBreakPaused = computed(() => this.focusModeService.isSessionPaused());
  readonly isBreakOffer = computed(
    () =>
      !this.focusModeService.isSessionRunning() &&
      this.focusModeService.mainState() === FocusMainUIState.BreakOffer,
  );

  readonly isPomodoro = computed(
    () => this.focusModeService.mode() === FocusModeMode.Pomodoro,
  );

  skipBreak(): void {
    this._store.dispatch(skipBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  completeBreak(): void {
    // Get pausedTaskId before break ends (passed in action to avoid race condition)
    this._store.dispatch(completeBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  pauseBreak(): void {
    // Bug #5995 Fix: currentTaskId takes precedence because pausedTaskId may not yet
    // be set in the store when pausing immediately after break starts
    const currentTaskId = this._taskService.currentTaskId();
    const storePausedTaskId = this._pausedTaskId();
    const pausedTaskId = currentTaskId || storePausedTaskId;
    this._store.dispatch(pauseFocusSession({ pausedTaskId }));
  }

  resumeBreak(): void {
    if (this.isBreakOffer()) {
      const currentTaskId = this._taskService.currentTaskId();
      const storePausedTaskId = this._pausedTaskId();
      // Flowtime: storePausedTaskId takes precedence here (opposite of pauseBreak) because
      // currentTaskId is cleared when break starts, so store value is the reliable source
      const pausedTaskId = storePausedTaskId ?? currentTaskId;
      const config = this.focusModeService.focusModeConfig();
      if (config?.isPauseTrackingDuringBreak) {
        this._store.dispatch(unsetCurrentTask());
      }
      this._store.dispatch(
        startBreak({
          duration: this.focusModeService.sessionDuration(),
          isLongBreak: this.focusModeService.isBreakLong(),
          pausedTaskId,
        }),
      );
    } else {
      this._store.dispatch(unPauseFocusSession());
    }
  }

  resetCycles(): void {
    this._store.dispatch(resetCycles());
  }

  exitToPlanning(): void {
    this._store.dispatch(exitBreakToPlanning({ pausedTaskId: this._pausedTaskId() }));
  }
}
