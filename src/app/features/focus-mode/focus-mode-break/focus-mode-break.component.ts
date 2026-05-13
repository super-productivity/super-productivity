import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { FocusModeService } from '../focus-mode.service';
import { FocusClockFaceComponent } from '../focus-clock-face/focus-clock-face.component';
import { FocusMainUIState, FocusModeMode, getBreakCycle } from '../focus-mode.model';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { Store } from '@ngrx/store';
import {
  cancelFocusSession,
  completeBreak,
  pauseFocusSession,
  resetCycles,
  skipBreak,
  startBreak,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { INBOX_PROJECT } from '../../project/project.const';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskTrackingInfoComponent } from '../task-tracking-info/task-tracking-info.component';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { TaskService } from '../../tasks/task.service';
import { unsetCurrentTask } from '../../tasks/store/task.actions';

@Component({
  selector: 'focus-mode-break',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconButton,
    MatTooltip,
    MsToMinuteClockStringPipe,
    MatIcon,
    TranslatePipe,
    TaskTrackingInfoComponent,
    FocusClockFaceComponent,
  ],
  templateUrl: './focus-mode-break.component.html',
  styleUrl: './focus-mode-break.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeBreakComponent {
  readonly focusModeService = inject(FocusModeService);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _router = inject(Router);
  T: typeof T = T;

  // Get pausedTaskId before break ends (passed in action to avoid race condition)
  private readonly _pausedTaskId = toSignal(this._store.select(selectPausedTaskId));

  // Resolve the paused task so we can show its title above the circle —
  // the focus session's task is unset for the duration of the break.
  readonly displayedTask = toSignal(
    toObservable(this._pausedTaskId).pipe(
      switchMap((id) => (id ? this._taskService.getByIdLive$(id) : of(null))),
    ),
  );

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

  // currentCycle increments at the end of a focus session, so during the
  // break the store has already moved on. getBreakCycle subtracts 1 (clamped)
  // so the counter shows the cycle the break belongs to — "break of cycle N",
  // matching the user's mental model of "Focus + Break = one cycle".
  readonly displayedCycle = computed(() =>
    getBreakCycle(this.focusModeService.currentCycle() ?? 1),
  );

  // Which break-label translation key to show above the digits.
  readonly breakLabelKey = computed(() => {
    if (this.isBreakOffer()) {
      return T.F.FOCUS_MODE.FLOWTIME_BREAK_TITLE;
    }
    return this.focusModeService.isBreakLong()
      ? T.F.FOCUS_MODE.LONG_BREAK_TITLE
      : T.F.FOCUS_MODE.SHORT_BREAK_TITLE;
  });

  skipBreak(): void {
    this._store.dispatch(skipBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  completeBreak(): void {
    this._store.dispatch(completeBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  pauseBreak(): void {
    // Bug #5995 Fix: Prefer currentTaskId (actively tracked task) over stored pausedTaskId
    // - If tracking is active during break: use currentTaskId (ensures effect fires)
    // - If tracking was auto-paused: fall back to stored pausedTaskId
    // This matches the banner's approach for consistent behavior
    const currentTaskId = this._taskService.currentTaskId();
    const storePausedTaskId = this._pausedTaskId();
    const pausedTaskId = currentTaskId || storePausedTaskId;

    this._store.dispatch(pauseFocusSession({ pausedTaskId }));
  }

  resumeBreak(): void {
    if (this.isBreakOffer()) {
      // Prefer the stored pausedTaskId for Flowtime break offers;
      // fallback to the active current task only when no pausedTaskId exists.
      const currentTaskId = this._taskService.currentTaskId();
      const storePausedTaskId = this._pausedTaskId();
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
    // Unified across all timer modes: cancel the focus session (closes the
    // overlay + clears tracking via cancelFocusSession$ effect) and route
    // the user to the Inbox.
    this._store.dispatch(cancelFocusSession());
    this._router.navigateByUrl(`/project/${INBOX_PROJECT.id}/tasks`);
  }
}
