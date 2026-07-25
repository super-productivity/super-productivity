import { effect, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { msToMinuteClockString } from '../../ui/duration/ms-to-minute-clock-string.pipe';
import { msToString } from '../../ui/duration/ms-to-string.pipe';
import { FocusModeMode } from '../../features/focus-mode/focus-mode.model';
import { T } from 'src/app/t.const';
import { TranslateService } from '@ngx-translate/core';
import { TaskService } from '../../features/tasks/task.service';
import { DateService } from '../date/date.service';

@Injectable({
  providedIn: 'root',
})
export class BrowserTitleService {
  private _titleService = inject(Title);
  private _focusModeService = inject(FocusModeService);
  private _translateService = inject(TranslateService);
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);

  private readonly _baseTitle = 'Super Productivity';
  private readonly _currentTask = toSignal(this._taskService.currentTask$, {
    initialValue: null,
  });

  constructor() {
    effect(() => {
      const focusTitle = this._getTitle(
        this._focusModeService.mode(),
        this._focusModeService.timeRemaining(),
        this._focusModeService.isBreakActive(),
        this._focusModeService.isRunning(),
        this._focusModeService.isSessionPaused(),
        this._focusModeService.isInOvertime(),
        this._focusModeService.timeElapsed(),
      );
      this._titleService.setTitle(
        focusTitle === this._baseTitle ? this._getTrackingTitle() : focusTitle,
      );
    });
  }

  private _getTrackingTitle(): string {
    const task = this._currentTask();
    if (!task) {
      return this._baseTitle;
    }
    // Today's total on the task, not time since tracking started - no start
    // timestamp is persisted.
    const timeToday = task.timeSpentOnDay[this._dateService.todayStr()] ?? 0;
    return `${msToString(timeToday, false, true) || '0m'} - ${task.title}`;
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
      const isCountTimeDown = mode !== FocusModeMode.Flowtime || isBreakActive;
      const displayTime = isCountTimeDown && !isInOvertime ? timeRemaining : timeElapsed;

      const timeStr = msToMinuteClockString(displayTime);

      const [minutes, seconds] = timeStr.split(':');
      const formattedTime = `${minutes.padStart(2, '0')}:${seconds}`;

      const breakStr = isBreakActive
        ? ` (${this._translateService.instant(T.F.FOCUS_MODE.BROWSER_TITLE_BREAK)})`
        : '';

      const isActuallyPaused = isSessionPaused && !(isBreakActive && timeElapsed === 0);

      if (isActuallyPaused) {
        return `${this._translateService.instant(
          T.F.FOCUS_MODE.BROWSER_TITLE_PAUSED,
        )} ${formattedTime}${breakStr}`;
      }

      return `${formattedTime}${breakStr}`;
    }

    return this._baseTitle;
  }
}
