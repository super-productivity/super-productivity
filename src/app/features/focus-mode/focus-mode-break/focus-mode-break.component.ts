import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FocusModeService } from '../focus-mode.service';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { Store } from '@ngrx/store';
import {
  completeBreak,
  exitBreakToPlanning,
  pauseFocusSession,
  skipBreak,
  unPauseFocusSession,
} from '../store/focus-mode.actions';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskTrackingInfoComponent } from '../task-tracking-info/task-tracking-info.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../tasks/task.service';

@Component({
  selector: 'focus-mode-break',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconButton,
    MatProgressSpinnerModule,
    MatTooltip,
    MsToClockStringPipe,
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

  // Get pausedTaskId before break ends (passed in action to avoid race condition)
  private readonly _pausedTaskId = toSignal(this._store.select(selectPausedTaskId));

  readonly remainingTime = computed(() => {
    return this.focusModeService.timeRemaining() || 0;
  });

  readonly progressPercentage = computed(() => {
    return this.focusModeService.progress() || 0;
  });

  readonly breakTypeLabel = computed(() =>
    this.focusModeService.isBreakLong()
      ? T.F.FOCUS_MODE.LONG_BREAK
      : T.F.FOCUS_MODE.SHORT_BREAK,
  );

  readonly isBreakPaused = computed(() => this.focusModeService.isSessionPaused());

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
    this._store.dispatch(unPauseFocusSession());
  }

  exitToPlanning(): void {
    this._store.dispatch(exitBreakToPlanning({ pausedTaskId: this._pausedTaskId() }));
  }
}
