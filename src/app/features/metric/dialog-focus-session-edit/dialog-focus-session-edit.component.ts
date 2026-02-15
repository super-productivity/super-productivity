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
import { MetricService } from '../metric.service';
import { DateService } from 'src/app/core/date/date.service';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { InputDurationDirective } from '../../../ui/duration/input-duration.directive';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ChartConfiguration } from 'chart.js';
import { LineChartData } from '../metric.model';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { LazyChartComponent } from '../lazy-chart/lazy-chart.component';
import { MatList, MatListItem } from '@angular/material/list';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { getDbDateStr } from '../../../util/get-db-date-str';

const CHART_DAYS = 28;
const CHART_COLOR = '#4bc0c0';

interface FocusSessionListItem {
  duration: number;
  index: number;
}

@Component({
  selector: 'dialog-focus-session-edit',
  templateUrl: './dialog-focus-session-edit.component.html',
  styleUrls: ['./dialog-focus-session-edit.component.scss'],
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
    MatIconButton,
    TranslatePipe,
    LazyChartComponent,
    MsToStringPipe,
    MatList,
    MatListItem,
  ],
})
export class DialogFocusSessionEditComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogFocusSessionEditComponent>);
  private readonly _metricService = inject(MetricService);
  private readonly _dateService = inject(DateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private readonly _translateService = inject(TranslateService);

  readonly dialogData = inject<{ day: string; focusSessions: number[] }>(MAT_DIALOG_DATA);
  readonly T = T;
  readonly todayStr = this._dateService.todayStr();

  // State
  readonly localSessions = signal<number[]>([...this.dialogData.focusSessions]);
  readonly selectedDateStr = signal(this.dialogData.day);
  readonly newSessionDuration = signal(0);

  // Computed values
  readonly sessionList = computed((): FocusSessionListItem[] => {
    return this.localSessions().map((duration, index) => ({
      duration,
      index,
    }));
  });

  readonly totalDuration = computed(() => {
    return this.localSessions().reduce((sum, duration) => sum + duration, 0);
  });

  readonly chartData = computed((): LineChartData => {
    const dates = this._getChartDates();

    // For now, show only the selected day's data
    // In the future, we could fetch data for all days
    const values = dates.map((date) => {
      if (date === this.selectedDateStr()) {
        return Math.round(this.totalDuration() / 60000); // Convert ms to minutes
      }
      return 0; // Placeholder - would need to fetch from state
    });

    const labels = dates.map((date) => this._formatChartLabel(date));

    return {
      labels,
      datasets: [
        {
          data: values,
          label: this._translateService.instant(
            this.T.F.METRIC.FOCUS_SESSION_DIALOG.CHART_LABEL,
          ),
          fill: false,
          borderColor: CHART_COLOR,
        },
      ],
    };
  });

  readonly chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        ticks: { precision: 0 },
      },
    },
  };

  deleteSession(index: number): void {
    this.localSessions.update((sessions) => {
      const newSessions = [...sessions];
      newSessions.splice(index, 1);
      return newSessions;
    });
  }

  updateSession(index: number, duration: number): void {
    this.localSessions.update((sessions) => {
      const newSessions = [...sessions];
      newSessions[index] = duration;
      return newSessions;
    });
  }

  addSession(): void {
    const duration = this.newSessionDuration();
    if (duration > 0) {
      this.localSessions.update((sessions) => [...sessions, duration]);
      this.newSessionDuration.set(0);
    }
  }

  save(): void {
    const day = this.selectedDateStr();
    const sessions = this.localSessions();

    // Update the metric with the new focus sessions array
    this._metricService.updateMetric(day, {
      focusSessions: sessions,
    });

    this.close();
  }

  close(): void {
    this._dialogRef.close();
  }

  formatSelectedDate(): string {
    const date = this.selectedDateStr();
    if (date === this.todayStr) return 'Today';

    return new Date(date).toLocaleDateString(
      this._dateTimeFormatService.currentLocale(),
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      },
    );
  }

  private _getChartDates(): string[] {
    const endDate = new Date(this.selectedDateStr());
    const dates: string[] = [];

    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      dates.push(getDbDateStr(d));
    }

    return dates;
  }

  private _formatChartLabel(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
      month: 'numeric',
      day: 'numeric',
    });
  }
}
