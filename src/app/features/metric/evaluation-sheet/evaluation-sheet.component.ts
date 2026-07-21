import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MetricCopy } from '../metric.model';
import { MetricService } from '../metric.service';
import {
  calculateProductivityScore,
  calculateSustainabilityScore,
  getScoreColorGradient,
  TrendIndicator,
} from '../metric-scoring.util';
import { Observable } from 'rxjs';
import { shareReplay, switchMap } from 'rxjs/operators';
import { T } from '../../../t.const';
import { MatDialog } from '@angular/material/dialog';
import { WorkContextService } from '../../work-context/work-context.service';
import { DialogProductivityBreakdownComponent } from '../dialog-productivity-breakdown/dialog-productivity-breakdown.component';
import { FormsModule } from '@angular/forms';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatTooltip } from '@angular/material/tooltip';
import { NgClass } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { getDailyStateInfo } from '../utils/get-daily-state-info.util';
import { ImpactStarsComponent } from '../impact-stars/impact-stars.component';
import { ReflectionNoteComponent } from '../reflection-note/reflection-note.component';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';

@Component({
  selector: 'evaluation-sheet',
  templateUrl: './evaluation-sheet.component.html',
  styleUrls: ['./evaluation-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatRadioGroup,
    MatRadioButton,
    MatTooltip,
    NgClass,
    TranslatePipe,
    MsToClockStringPipe,
    ImpactStarsComponent,
    ReflectionNoteComponent,
  ],
})
export class EvaluationSheetComponent {
  readonly workContextService = inject(WorkContextService);
  private readonly _metricService = inject(MetricService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);

  readonly dayStr$ = input<Observable<string> | null>(null);
  readonly timeWorkedToday = input<number | null>(null);

  readonly T = T;
  // Internal signals

  private readonly _resolvedDay$ = toObservable(this.dayStr$).pipe(
    switchMap((custom$) => custom$ ?? this._globalTrackingIntervalService.todayDateStr$),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  private readonly _day$ = this._resolvedDay$;
  readonly day = toSignal(this._day$, {
    initialValue: this._globalTrackingIntervalService.todayDateStr(),
  });

  // Metric data for the selected day
  readonly metricForDay = toSignal<MetricCopy | undefined>(
    this._day$.pipe(switchMap((day) => this._metricService.getMetricForDay$(day))),
    { initialValue: undefined },
  );

  // Productivity summary (average + trend)
  private readonly _productivityAverage = toSignal(
    this._day$.pipe(
      switchMap((day) => this._metricService.getAverageProductivityScore$(7, day)),
    ),
    { initialValue: null },
  );
  private readonly _productivityTrend = toSignal(
    this._day$.pipe(
      switchMap((day) => this._metricService.getProductivityTrend$(7, day)),
    ),
    { initialValue: null },
  );
  readonly productivitySummary = computed(() => ({
    average: this._productivityAverage(),
    trend: this._productivityTrend(),
  }));

  // Sustainability summary (average + trend)
  private readonly _sustainabilityAverage = toSignal(
    this._day$.pipe(
      switchMap((day) => this._metricService.getAverageSustainabilityScore$(7, day)),
    ),
    { initialValue: null },
  );
  private readonly _sustainabilityTrend = toSignal(
    this._day$.pipe(
      switchMap((day) => this._metricService.getSustainabilityTrend$(7, day)),
    ),
    { initialValue: null },
  );
  readonly sustainabilitySummary = computed(() => ({
    average: this._sustainabilityAverage(),
    trend: this._sustainabilityTrend(),
  }));

  // Computed values
  readonly totalWorkTimeMs = computed(() => {
    const timeWorked = this.timeWorkedToday();
    if (timeWorked != null) {
      return timeWorked;
    }
    const legacyMinutes = this.metricForDay()?.totalWorkMinutes;
    if (typeof legacyMinutes === 'number' && !Number.isNaN(legacyMinutes)) {
      return legacyMinutes * 60 * 1000;
    }
    return this.deepWorkTime();
  });

  readonly totalWorkMinutes = computed(() => {
    const totalMs = this.totalWorkTimeMs();
    return totalMs > 0 ? totalMs / (1000 * 60) : 0;
  });

  readonly deepWorkTime = computed(() => {
    const focusSessions = this.metricForDay()?.focusSessions ?? [];
    return focusSessions.reduce((acc, val) => acc + val, 0);
  });

  readonly deepWorkMinutes = computed(() => {
    return this.deepWorkTime() / (1000 * 60);
  });

  readonly hasProductivityData = computed(() => {
    const impactOfWork = this.metricForDay()?.impactOfWork;
    return !!impactOfWork && impactOfWork > 0;
  });

  readonly hasSustainabilityData = computed(() => {
    return !!this.metricForDay()?.energyCheckin;
  });

  readonly productivityScore = computed(() => {
    const impactRating = this.metricForDay()?.impactOfWork ?? 0;
    const focusedMinutes = this.deepWorkMinutes();
    const totalMinutes = this.totalWorkMinutes();
    return calculateProductivityScore(impactRating, focusedMinutes, totalMinutes);
  });

  readonly sustainabilityScore = computed(() => {
    const focusedMinutes = this.deepWorkMinutes();
    const totalMinutes = this.totalWorkMinutes();
    const energyCheckin = this.metricForDay()?.energyCheckin ?? undefined;

    return calculateSustainabilityScore(focusedMinutes, totalMinutes, energyCheckin);
  });

  readonly dailyStateInfo = computed(() => {
    return getDailyStateInfo(
      this.metricForDay(),
      this.productivityScore(),
      this.sustainabilityScore(),
    );
  });

  updateImpactOfWork(impactOfWork: number): void {
    this._update({ impactOfWork });
  }

  updateEnergyCheckin(energyCheckin: number): void {
    this._update({ energyCheckin });
  }

  getScoreColor(score: number): string {
    return getScoreColorGradient(score);
  }

  getTrendDelta(trend: TrendIndicator | null): string {
    if (!trend || trend.direction === 'stable') {
      return '±0';
    }
    const change = trend.change;
    return change > 0 ? `+${change}` : `${change}`;
  }

  getTrendClass(
    trend: TrendIndicator | null,
  ): 'trend-up' | 'trend-down' | 'trend-stable' {
    if (!trend || trend.direction === 'stable') {
      return 'trend-stable';
    }
    return trend.direction === 'up' ? 'trend-up' : 'trend-down';
  }

  openScoreBreakdown(focus: 'productivity' | 'sustainability'): void {
    this._matDialog.open(DialogProductivityBreakdownComponent, {
      data: {
        days: 7,
        endDate: this.day(),
        focus,
      },
      width: '640px',
    });
  }

  private _update(updateData: Partial<MetricCopy>): void {
    const currentMetric = this.metricForDay();
    if (!currentMetric) {
      return;
    }

    const updatedMetric: MetricCopy = {
      ...currentMetric,
      ...updateData,
    };

    this._metricService.upsertMetric(updatedMetric);
  }
}
