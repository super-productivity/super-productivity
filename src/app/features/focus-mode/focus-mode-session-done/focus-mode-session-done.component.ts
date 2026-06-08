import { AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { INBOX_PROJECT } from '../../project/project.const';

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
  private readonly _router = inject(Router);

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
    // cancelFocusSession both clears tracking and hides the overlay; pair
    // with router navigation so "Back to planning" deterministically lands
    // the user on the Inbox across all timer modes.
    this._store.dispatch(cancelFocusSession());
    this._router.navigateByUrl(`/project/${INBOX_PROJECT.id}/tasks`);
  }

  startNextFocusSession(): void {
    this._store.dispatch(selectFocusTask());
  }

  continueWithFocusSession(): void {
    this._store.dispatch(selectFocusDuration());
  }
}
