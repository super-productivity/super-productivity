import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { msToMinuteClockString } from '../../ui/duration/ms-to-minute-clock-string.pipe';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';

@Injectable({
  providedIn: 'root',
})
export class BrowserTitleService {
  private _titleService = inject(Title);
  private _focusModeService = inject(FocusModeService);

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
  ): string {
    if (mode === FocusModeMode.Pomodoro && (isRunning || isSessionPaused)) {
      const timeStr = msToMinuteClockString(timeRemaining);
      const [minutes, seconds] = timeStr.split(':');
      const paddedMinutes = minutes.padStart(2, '0');
      const formattedTime = `${paddedMinutes}:${seconds}`;

      const breakStr = isBreakActive ? ' Break' : '';
      const pausedStr = isSessionPaused ? 'Paused ' : '';
      return `(${pausedStr}${formattedTime}${breakStr}) ${this._baseTitle}`;
    }

    return this._baseTitle;
  }
}
