import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { msToMinuteClockString } from '../../ui/duration/ms-to-minute-clock-string.pipe';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';
import { T } from 'src/app/t.const';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class BrowserTitleService {
  private _titleService = inject(Title);
  private _focusModeService = inject(FocusModeService);
  private _translateService = inject(TranslateService);

  private readonly _baseTitle = 'Super Productivity';

  constructor() {
    effect(() => {
      this._titleService.setTitle(
        this._getTitle(
          this._focusModeService.mode(),
          this._focusModeService.timeRemaining(),
          this._focusModeService.isBreakActive(),
          this._focusModeService.isRunning(),
          this._focusModeService.isSessionPaused(),
          this._focusModeService.isInOvertime(),
          this._focusModeService.timeElapsed(),
        ),
      );
    });
  }

  private _getTitle(
    mode: FocusModeMode,
    timeRemaining: number,
    isBreakActive: boolean,
    isRunning: boolean,
    isSessionPaused: boolean,
    isInOvertime: boolean,
    timeElapsed: number,
  ): string {
    if (isRunning || isSessionPaused) {
      const isCountTimeDown = mode !== FocusModeMode.Flowtime;
      const displayTime = isCountTimeDown && !isInOvertime ? timeRemaining : timeElapsed;

      const timeStr = msToMinuteClockString(displayTime);

      const [minutes, seconds] = timeStr.split(':');
      const formattedTime = `${minutes.padStart(2, '0')}:${seconds}`;

      const breakStr = isBreakActive
        ? ` (${this._translateService.instant(T.F.FOCUS_MODE.BROWSER_TITLE_BREAK)})`
        : '';

      if (isSessionPaused) {
        return `${this._translateService.instant(
          T.F.FOCUS_MODE.BROWSER_TITLE_PAUSED,
        )} ${formattedTime}${breakStr}`;
      }

      return `${formattedTime}${breakStr}`;
    }

    return this._baseTitle;
  }
}
