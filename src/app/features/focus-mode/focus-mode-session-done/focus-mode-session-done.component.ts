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
  selectFocusTask,
  selectFocusDuration,
} from '../store/focus-mode.actions';
import { selectFocusModeConfig } from '../../config/store/global-config.reducer';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'focus-mode-session-done',
  templateUrl: './focus-mode-session-done.component.html',
  styleUrls: ['./focus-mode-session-done.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MsToStringPipe, TranslatePipe, MatIcon],
})
export class FocusModeSessionDoneComponent implements AfterViewInit {
  private _store = inject(Store);
  private readonly _confettiService = inject(ConfettiService);
  private readonly _focusModeService = inject(FocusModeService);

  mode = this._focusModeService.mode;
  FocusModeMode = FocusModeMode;
  currentTask = toSignal(this._store.select(selectCurrentTask));
  focusModeConfig = toSignal(this._store.select(selectFocusModeConfig));
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
    // Cancelling the session clears tracking and hides the overlay, returning
    // the user to wherever they were before focus mode (no forced navigation).
    this._store.dispatch(cancelFocusSession());
  }

  startNextFocusSession(): void {
    this._store.dispatch(selectFocusTask());
  }

  continueWithFocusSession(): void {
    this._store.dispatch(selectFocusDuration());
  }
}
