import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FocusModeService } from '../focus-mode.service';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { Store } from '@ngrx/store';
import { completeBreak, skipBreak } from '../store/focus-mode.actions';
import { selectPausedTaskId } from '../store/focus-mode.selectors';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskTrackingInfoComponent } from '../task-tracking-info/task-tracking-info.component';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'focus-mode-break',
  standalone: true,
  imports: [
    MatButtonModule,
    MatProgressSpinnerModule,
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

  skipBreak(): void {
    this._store.dispatch(skipBreak({ pausedTaskId: this._pausedTaskId() }));
  }

  completeBreak(): void {
    this._store.dispatch(completeBreak({ pausedTaskId: this._pausedTaskId() }));
  }
}
