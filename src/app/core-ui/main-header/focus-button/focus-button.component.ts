import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { FocusModeService } from '../../../features/focus-mode/focus-mode.service';
import { MetricService } from '../../../features/metric/metric.service';
import { Store } from '@ngrx/store';
import { showFocusOverlay } from '../../../features/focus-mode/store/focus-mode.actions';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { KeyboardConfig } from '../../../features/config/keyboard-config.model';
import { DateService } from '../../../core/date/date.service';
import { FocusModeMode } from '../../../features/focus-mode/focus-mode.model';
import { ProgressCircleComponent } from '../../../ui/progress-circle/progress-circle.component';
import { MatDialog } from '@angular/material/dialog';
import { DialogFocusSessionEditComponent } from '../../../features/metric/dialog-focus-session-edit/dialog-focus-session-edit.component';
import { LongPressDirective } from '../../../ui/longpress/longpress.directive';
import { first } from 'rxjs/operators';

@Component({
  selector: 'focus-button',
  templateUrl: './focus-button.component.html',
  styleUrls: ['./focus-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconButton,
    MatTooltip,
    MatIcon,
    MsToMinuteClockStringPipe,
    TranslatePipe,
    ProgressCircleComponent,
    LongPressDirective,
  ],
})
export class FocusButtonComponent {
  private readonly _store = inject(Store);
  private readonly _metricService = inject(MetricService);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _dateService = inject(DateService);
  private readonly _matDialog = inject(MatDialog);
  readonly focusModeService = inject(FocusModeService);

  T: typeof T = T;

  readonly kb = computed<KeyboardConfig>(() => {
    return (this._configService.cfg()?.keyboard as KeyboardConfig) || {};
  });

  readonly isSessionRunning = this.focusModeService.isSessionRunning;
  readonly isBreakActive = this.focusModeService.isBreakActive;
  readonly progress = this.focusModeService.progress;
  readonly mode = this.focusModeService.mode;
  readonly FocusModeMode = FocusModeMode;

  readonly focusSummaryToday = computed(() =>
    this._metricService.getFocusSummaryForDay(this._dateService.todayStr()),
  );

  readonly tooltipSuffix = computed(() => {
    const shortcut = this.kb().goToFocusMode;
    return shortcut ? ` [${shortcut}]` : '';
  });

  readonly circleVisible = computed(
    () => this.isSessionRunning() || this.isBreakActive(),
  );

  readonly isCountdownMode = computed(() => {
    const mode = this.mode();
    return mode === FocusModeMode.Countdown || mode === FocusModeMode.Pomodoro;
  });

  readonly circleProgress = computed<number | null>(() => {
    if (!this.circleVisible()) {
      return null;
    }
    // Show progress for both work sessions and breaks in countdown modes
    if (this.isCountdownMode() || this.isBreakActive()) {
      const progress = this.progress();
      return typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : 0;
    }
    return null;
  });

  readonly circleShouldPulse = computed(
    () => this.circleVisible() && this.mode() === FocusModeMode.Flowtime,
  );

  readonly buttonColor = computed(() => (this.circleVisible() ? 'accent' : undefined));

  readonly runningTimeMs = computed<number | null>(() => {
    if (!this.circleVisible()) {
      return null;
    }
    // Breaks always use countdown
    if (this.isBreakActive() || this.isCountdownMode()) {
      const remaining = this.focusModeService.timeRemaining();
      return typeof remaining === 'number' ? Math.max(0, remaining) : 0;
    }
    const elapsed = this.focusModeService.timeElapsed();
    return typeof elapsed === 'number' ? Math.max(0, elapsed) : 0;
  });

  enableFocusMode(): void {
    this._store.dispatch(showFocusOverlay());
  }

  openFocusSessionDialog(): void {
    const dayStr = this._dateService.todayStr();
    this._metricService
      .getMetricForDay$(dayStr)
      .pipe(first())
      .subscribe((metric) => {
        this._matDialog.open(DialogFocusSessionEditComponent, {
          restoreFocus: true,
          data: {
            day: dayStr,
            focusSessions: metric.focusSessions ?? [],
          },
        });
      });
  }
}
