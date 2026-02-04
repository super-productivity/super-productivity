import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import {
  SimpleCounterCfgFields,
  SimpleCounterCopy,
  SimpleCounterType,
} from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { DateService } from 'src/app/core/date/date.service';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { InputDurationDirective } from '../../../ui/duration/input-duration.directive';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { ChartConfiguration } from 'chart.js';
import { LineChartData } from '../../metric/metric.model';
import { getSimpleCounterStreakDuration } from '../get-simple-counter-streak-duration';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { LazyChartComponent } from '../../metric/lazy-chart/lazy-chart.component';
import { MatDialog } from '@angular/material/dialog';
import { DialogSimpleCounterEditSettingsComponent } from '../dialog-simple-counter-edit-settings/dialog-simple-counter-edit-settings.component';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { getDbDateStr } from '../../../util/get-db-date-str';

const CHART_DAYS = 28;
const CHART_COLOR = '#4bc0c0';
const GOAL_LINE_COLOR = '#9e9e9e';

@Component({
  selector: 'dialog-simple-counter-edit',
  templateUrl: './dialog-simple-counter-edit.component.html',
  styleUrls: ['./dialog-simple-counter-edit.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatFormFieldModule,
    MatInputModule,
    InputDurationDirective,
    MatIcon,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    LazyChartComponent,
    MsToStringPipe,
  ],
})
export class DialogSimpleCounterEditComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogSimpleCounterEditComponent>);
  private readonly _matDialog = inject(MatDialog);
  private readonly _counterService = inject(SimpleCounterService);
  private readonly _dateService = inject(DateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  readonly dialogData = inject<{
    simpleCounter: SimpleCounterCopy;
    selectedDate?: string;
  }>(MAT_DIALOG_DATA);
  readonly T = T;
  readonly SimpleCounterType = SimpleCounterType;
  readonly todayStr = this._dateService.todayStr();
  private readonly _settingsKeys: (keyof SimpleCounterCfgFields)[] = [
    'title',
    'isEnabled',
    'icon',
    'type',
    'isTrackStreaks',
    'streakMinValue',
    'streakMode',
    'streakWeekDays',
    'streakWeeklyFrequency',
    'countdownDuration',
  ];

  // State
  readonly localCounter = signal<SimpleCounterCopy>({
    ...this.dialogData.simpleCounter,
    countOnDay: { ...this.dialogData.simpleCounter.countOnDay },
    streakWeekDays: this.dialogData.simpleCounter.streakWeekDays
      ? { ...this.dialogData.simpleCounter.streakWeekDays }
      : undefined,
  });

  selectedDateStr = signal(this.dialogData.selectedDate || this.todayStr);

  // Computed values
  readonly selectedValue = computed(() => {
    const counter = this.localCounter();
    const date = this.selectedDateStr();
    return counter.countOnDay[date] || 0;
  });

  readonly currentStreak = computed(() =>
    getSimpleCounterStreakDuration(this.localCounter()),
  );

  readonly chartData = computed((): LineChartData => {
    const counter = this.localCounter();
    const dates = this._getChartDates();

    const values = dates.map((date) => {
      const rawValue = counter.countOnDay[date] || 0;
      return counter.type === SimpleCounterType.StopWatch
        ? Math.round(rawValue / 60000) // Convert ms to minutes for display
        : rawValue;
    });

    const labels = dates.map((date) => this._formatChartLabel(date, counter));
    const goalValueRaw = counter.streakMinValue;
    const goalValue =
      goalValueRaw == null
        ? null
        : counter.type === SimpleCounterType.StopWatch
          ? Math.round(goalValueRaw / 60000)
          : goalValueRaw;

    const datasets: LineChartData['datasets'] = [
      {
        data: values,
        label: counter.type === SimpleCounterType.StopWatch ? 'Duration' : 'Count',
        fill: false,
        borderColor: CHART_COLOR,
      },
    ];

    if (goalValue != null) {
      datasets.push({
        data: dates.map(() => goalValue),
        label: 'Daily goal',
        fill: false,
        borderColor: GOAL_LINE_COLOR,
        borderDash: [6, 6],
        pointRadius: 0,
        pointHitRadius: 0,
      });
    }

    return {
      labels,
      datasets,
    };
  });

  readonly chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    aspectRatio: 3,
    maintainAspectRatio: true,
    scales: {
      y: {
        min: 0,
        ticks: { precision: 0 },
      },
    },
    onHover: (event, activeElements) => {
      const canvas = event.native?.target as HTMLCanvasElement;
      if (canvas) {
        canvas.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
      }
    },
  };

  onChartClick(event: { active: { index: number }[] }): void {
    if (!event.active?.length) return;

    const index = event.active[0].index;
    const dates = this._getChartDates();

    if (dates[index]) {
      this.selectedDateStr.set(dates[index]);
    }
  }

  updateValue(value: number): void {
    const date = this.selectedDateStr();
    this.localCounter.update((counter) => ({
      ...counter,
      countOnDay: {
        ...counter.countOnDay,
        [date]: value,
      },
    }));
  }

  openSettingsDialog(): void {
    this._matDialog
      .open(DialogSimpleCounterEditSettingsComponent, {
        data: { simpleCounter: this.localCounter() },
        restoreFocus: true,
        width: '600px',
      })
      .afterClosed()
      .subscribe((settings?: Partial<SimpleCounterCopy>) => {
        if (!settings || Object.keys(settings).length === 0) {
          return;
        }
        this.localCounter.update((counter) => ({
          ...counter,
          ...settings,
        }));
        Object.assign(this.dialogData.simpleCounter, settings);
      });
  }

  save(): void {
    const localData = this.localCounter();
    const originalData = this.dialogData.simpleCounter;
    const settingsChanges = this._getSettingsChanges(originalData, localData);

    // Only save changed values
    Object.entries(localData.countOnDay).forEach(([date, value]) => {
      const originalValue = originalData.countOnDay[date] || 0;
      if (value !== originalValue) {
        this._counterService.setCounterForDate(originalData.id, date, value);
      }
    });

    if (Object.keys(settingsChanges).length > 0) {
      this._counterService.updateSimpleCounter(originalData.id, settingsChanges);
    }

    this.close();
  }

  close(): void {
    this._dialogRef.close();
  }

  formatSelectedDate(): string {
    const date = this.selectedDateStr();
    if (date === this.todayStr) return 'Today';

    return new Date(date).toLocaleDateString(this._dateTimeFormatService.currentLocale, {
      day: 'numeric',
      month: 'numeric',
    });
  }

  private _getChartDates(): string[] {
    const counter = this.localCounter();
    const allDates = Object.keys(counter.countOnDay).sort();

    if (!allDates.length) return [];

    // Fill in missing dates from first entry to today
    const startDate = new Date(allDates[0]);
    const endDate = new Date();
    const dates: string[] = [];

    for (const d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(getDbDateStr(d));
    }

    // Return last 28 days
    return dates.slice(-CHART_DAYS);
  }

  private _formatChartLabel(dateStr: string, counter: SimpleCounterCopy): string {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();

    const baseLabel = date.toLocaleDateString(this._dateTimeFormatService.currentLocale, {
      month: 'numeric',
      day: 'numeric',
    });

    if (!counter.isTrackStreaks || !counter.streakWeekDays?.[dayOfWeek]) {
      return baseLabel;
    }

    const value = counter.countOnDay[dateStr] || 0;
    const streakMet = value >= (counter.streakMinValue || 0);
    return `${baseLabel}${streakMet ? '🔥' : '❌'}`;
  }

  private _getSettingsChanges(
    original: SimpleCounterCopy,
    updated: SimpleCounterCopy,
  ): Partial<SimpleCounterCopy> {
    const changes: Partial<SimpleCounterCopy> = {};
    this._settingsKeys.forEach((key) => {
      if (!this._isFieldEqual(key, original[key], updated[key])) {
        (changes as any)[key] = updated[key];
      }
    });

    return changes;
  }

  private _isFieldEqual(
    key: keyof SimpleCounterCfgFields,
    originalValue: SimpleCounterCopy[keyof SimpleCounterCfgFields],
    updatedValue: SimpleCounterCopy[keyof SimpleCounterCfgFields],
  ): boolean {
    if (key === 'streakWeekDays') {
      const o = originalValue as Record<number, boolean> | undefined;
      const u = updatedValue as Record<number, boolean> | undefined;
      const allKeys = new Set([
        ...(o ? Object.keys(o) : []),
        ...(u ? Object.keys(u) : []),
      ]);
      for (const day of allKeys) {
        if (Boolean(o?.[day as any]) !== Boolean(u?.[day as any])) {
          return false;
        }
      }
      return true;
    }
    return originalValue === updatedValue;
  }
}
