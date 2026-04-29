import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { TaskService } from '../../tasks/task.service';
import { Subject } from 'rxjs';
import { GlobalConfigService } from '../../config/global-config.service';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import { Store } from '@ngrx/store';
import { cancelFocusSession, hideFocusOverlay } from '../store/focus-mode.actions';
import { fadeInAnimation } from '../../../ui/animations/fade.ani';
import { warpAnimation, warpInAnimation } from '../../../ui/animations/warp.ani';
import { T } from 'src/app/t.const';
import { BannerComponent } from '../../../core/banner/banner/banner.component';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { FocusModeMainComponent } from '../focus-mode-main/focus-mode-main.component';
import { FocusModeSessionDoneComponent } from '../focus-mode-session-done/focus-mode-session-done.component';
import { FocusModeBreakComponent } from '../focus-mode-break/focus-mode-break.component';
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
    // The header focus-button indicator takes over once the overlay is hidden
    // and a session/break is in flight, so we no longer need to spawn a banner.
    this._store.dispatch(hideFocusOverlay());
  }

  cancelFocusSession(): void {
    this._store.dispatch(cancelFocusSession());
  }
}
