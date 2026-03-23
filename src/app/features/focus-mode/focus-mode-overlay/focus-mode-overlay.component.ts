import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { TaskService } from '../../tasks/task.service';
import { Subject } from 'rxjs';
import { GlobalConfigService } from '../../config/global-config.service';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import { Store } from '@ngrx/store';
import { selectTimeElapsed } from '../store/focus-mode.selectors';
import {
  cancelFocusSession,
  hideFocusOverlay,
  showFocusOverlay,
} from '../store/focus-mode.actions';
import { fadeInAnimation } from '../../../ui/animations/fade.ani';
import { warpAnimation, warpInAnimation } from '../../../ui/animations/warp.ani';
import { T } from 'src/app/t.const';
import { BannerComponent } from '../../../core/banner/banner/banner.component';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { FocusModeMainComponent } from '../focus-mode-main/focus-mode-main.component';
import { FocusModeSessionDoneComponent } from '../focus-mode-session-done/focus-mode-session-done.component';
import { FocusModeBreakComponent } from '../focus-mode-break/focus-mode-break.component';
import { BannerService } from '../../../core/banner/banner.service';
import { BannerId } from '../../../core/banner/banner.model';
import { FocusModeService } from '../focus-mode.service';
import { FocusScreen } from '../focus-mode.model';

@Component({
  selector: 'focus-mode-overlay',
  templateUrl: './focus-mode-overlay.component.html',
  styleUrls: ['./focus-mode-overlay.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation, fadeInAnimation, warpAnimation, warpInAnimation],
  imports: [
    BannerComponent,
    MatIconButton,
    MatIcon,
    FocusModeMainComponent,
    FocusModeSessionDoneComponent,
    FocusModeBreakComponent,
  ],
})
export class FocusModeOverlayComponent implements OnDestroy {
  readonly taskService = inject(TaskService);
  readonly bannerService = inject(BannerService);
  readonly focusModeService = inject(FocusModeService);

  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _store = inject(Store);

  FocusScreen: typeof FocusScreen = FocusScreen;
  activePage = this.focusModeService.currentScreen;
  isSessionRunning = this.focusModeService.isSessionRunning;

  T: typeof T = T;

  private _onDestroy$ = new Subject<void>();
  isSessionPaused = this.focusModeService.isSessionPaused;

  private _closeOnEscapeKeyListener = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      if (
        this.activePage() === FocusScreen.Main &&
        !this.isSessionRunning() &&
        !this.isSessionPaused()
      ) {
        this.cancelFocusSession();
      }
    }
  };

  constructor() {
    this.bannerService.dismiss(BannerId.FocusMode);
    document.addEventListener('keydown', this._closeOnEscapeKeyListener);

    // No need to navigate anywhere - Main screen handles both pre-session and active session states
    // Just stay on the current screen
  }

  ngOnDestroy(): void {
    this._onDestroy$.next();
    this._onDestroy$.complete();
    document.removeEventListener('keydown', this._closeOnEscapeKeyListener);
  }

  back(): void {
    window.history.back();
  }

  closeOverlay(): void {
    const isOnBreak = this.focusModeService.isBreakActive();

    if (this.isSessionRunning() || isOnBreak) {
      const mode = this.focusModeService.mode();
      const cycle = this.focusModeService.currentCycle();

      // Determine banner message based on session type
      let translationKey: string;
      let icon: string;
      let timer$;
      let progress$;

      if (isOnBreak) {
        // Break is active
        translationKey =
          mode === 'Pomodoro'
            ? T.F.FOCUS_MODE.B.POMODORO_BREAK_RUNNING
            : T.F.FOCUS_MODE.B.BREAK_RUNNING;
        icon = 'free_breakfast';
        timer$ = this.focusModeService.timeToGo$;
        progress$ = this.focusModeService.sessionProgress$;
      } else {
        // Work session is active
        const isCountTimeUp = mode === 'Flowtime';
        translationKey =
          mode === 'Pomodoro'
            ? T.F.FOCUS_MODE.B.POMODORO_SESSION_RUNNING
            : T.F.FOCUS_MODE.B.SESSION_RUNNING;
        icon = 'center_focus_strong';
        timer$ = isCountTimeUp
          ? this._store.select(selectTimeElapsed)
          : this.focusModeService.timeToGo$;
        progress$ = isCountTimeUp ? undefined : this.focusModeService.sessionProgress$;
      }

      // Bug #5954 fix: For breaks, use cycle - 1 since cycle is incremented on session complete
      const translateParams =
        mode === 'Pomodoro'
          ? { cycleNr: isOnBreak ? Math.max(1, (cycle || 1) - 1) : cycle || 1 }
          : undefined;

      this.bannerService.open({
        id: BannerId.FocusMode,
        ico: icon,
        msg: translationKey,
        translateParams,
        timer$,
        progress$,
        action2: {
          label: T.F.FOCUS_MODE.B.TO_FOCUS_OVERLAY,
          fn: () => {
            this._store.dispatch(showFocusOverlay());
          },
        },
        action: {
          label: T.G.CANCEL,
          fn: () => {
            this._store.dispatch(cancelFocusSession());
          },
        },
      });
    }
    this._store.dispatch(hideFocusOverlay());
  }

  cancelFocusSession(): void {
    this._store.dispatch(cancelFocusSession());
  }
}
