import { AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';

import { of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { T } from 'src/app/t.const';

import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';

import { ConfettiService } from '../../../core/confetti/confetti.service';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { FocusModeService } from '../focus-mode.service';
import { FocusModeMode } from '../focus-mode.model';
import {
  selectCurrentTask,
  selectLastCurrentTask,
} from '../../tasks/store/task.selectors';
import {
  cancelFocusSession,
  hideFocusOverlay,
  selectFocusTask,
  selectFocusDuration,
  startBreak,
} from '../store/focus-mode.actions';
import { selectCurrentCycle } from '../store/focus-mode.selectors';
import { selectFocusModeConfig } from '../../config/store/global-config.reducer';
import { FocusModeStrategyFactory } from '../focus-mode-strategies';
import { unsetCurrentTask } from '../../tasks/store/task.actions';
import { MatIcon } from '@angular/material/icon';
import { TaskTrackingInfoComponent } from '../task-tracking-info/task-tracking-info.component';

@Component({
  selector: 'focus-mode-session-done',
  templateUrl: './focus-mode-session-done.component.html',
  styleUrls: ['./focus-mode-session-done.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MsToStringPipe, TranslatePipe, MatIcon, TaskTrackingInfoComponent],
})
export class FocusModeSessionDoneComponent implements AfterViewInit {
  private _store = inject(Store);
  private readonly _confettiService = inject(ConfettiService);
  private readonly _focusModeService = inject(FocusModeService);
  private readonly _strategyFactory = inject(FocusModeStrategyFactory);

  mode = this._focusModeService.mode;
  FocusModeMode = FocusModeMode;
  currentTask = toSignal(this._store.select(selectCurrentTask));
  focusModeConfig = toSignal(this._store.select(selectFocusModeConfig));
  currentCycle = toSignal(this._store.select(selectCurrentCycle));
  taskTitle = toSignal(
    this._store.select(selectLastCurrentTask).pipe(
      switchMap((lastCurrentTask) =>
        lastCurrentTask
          ? of(lastCurrentTask.title)
          : this._store.select(selectCurrentTask).pipe(map((task) => task?.title)),
      ),
      take(1),
    ),
  );
  lastSessionTotalDuration =
    this._focusModeService.lastSessionTotalDurationOrTimeElapsedFallback;
  T: typeof T = T;

  async ngAfterViewInit(): Promise<void> {
    const defaults = { startVelocity: 80, spread: 720, ticks: 600, zIndex: 0 };

    const particleCount = 200;
    // since particles fall down, start a bit higher than random
    this._confettiService.createConfetti({
      ...defaults,
      particleCount,
      origin: { x: 0.5, y: 1 },
    });
    this._confettiService.createConfetti({
      ...defaults,
      particleCount,
      origin: { x: 0.5, y: 1 },
    });
  }

  cancelAndCloseFocusOverlay(): void {
    this._store.dispatch(hideFocusOverlay());
    this._store.dispatch(cancelFocusSession());
  }

  startNextFocusSession(): void {
    this._store.dispatch(selectFocusTask());
  }

  continueWithFocusSession(): void {
    this._store.dispatch(selectFocusDuration());
  }

  startBreakManually(): void {
    const mode = this.mode();
    const cycle = this.currentCycle() ?? 1;
    const currentTaskId = this.currentTask()?.id;
    const config = this.focusModeConfig();
    const strategy = this._strategyFactory.getStrategy(mode);

    const breakInfo = strategy.getBreakDuration(cycle);
    if (breakInfo) {
      // Pause task tracking during break if enabled
      const shouldPauseTracking = config?.isPauseTrackingDuringBreak && currentTaskId;
      if (shouldPauseTracking) {
        this._store.dispatch(unsetCurrentTask());
      }

      this._store.dispatch(
        startBreak({
          duration: breakInfo.duration,
          isLongBreak: breakInfo.isLong,
          pausedTaskId: shouldPauseTracking ? currentTaskId : undefined,
        }),
      );
    }
  }
}
