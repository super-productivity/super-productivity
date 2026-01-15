import { inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { select, Store } from '@ngrx/store';
import {
  addMetric,
  deleteMetric,
  updateMetric,
  upsertMetric,
  logFocusSession,
} from './store/metric.actions';
import { combineLatest, Observable } from 'rxjs';
import { LineChartData, Metric, MetricState } from './metric.model';
import {
  selectMetricById,
  selectMetricHasData,
  selectFocusSessionLineChartData,
  selectFocusSessionsByDay,
  selectSimpleCounterClickCounterLineChartData,
  selectSimpleCounterStopWatchLineChartData,
  selectLastNDaysMetrics,
  selectAllMetrics,
} from './store/metric.selectors';
import { map } from 'rxjs/operators';
import { DEFAULT_METRIC_FOR_DAY } from './metric.const';
import { DateService } from 'src/app/core/date/date.service';
import {
  calculateAverageProductivityScore,
  calculateProductivityScore,
  calculateProductivityTrend,
  calculateSustainabilityScore,
  focusSessionsToMinutes,
  TrendIndicator,
} from './metric-scoring.util';
import { WorklogService } from '../worklog/worklog.service';
import { Worklog } from '../worklog/worklog.model';
import { getTimeSpentForDay } from '../worklog/util/get-time-spent-for-day.util';

const MIN_FOCUS_SESSION_DURATION = 1000;

export interface ProductivityBreakdownItem {
  day: string;
  score: number | null;
  impactRating: number | null;
  focusedMinutes: number;
  totalWorkMinutes: number;
  energyCheckin: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class MetricService {
  private _store$ = inject<Store<MetricState>>(Store);
  private _dateService = inject(DateService);
  private _worklogService = inject(WorklogService);

  hasData = toSignal(this._store$.pipe(select(selectMetricHasData)), {
    initialValue: false,
  });

  focusSessionsByDay = toSignal(this._store$.pipe(select(selectFocusSessionsByDay)), {
    initialValue: {} as Record<string, { count: number; total: number }>,
  });

  getMetricForDay$(day: string = this._dateService.todayStr()): Observable<Metric> {
    return this._store$.pipe(select(selectMetricById, { id: day })).pipe(
      map((metric) => {
        return metric
          ? {
              ...metric,
              focusSessions: metric.focusSessions ?? [],
              reflections: metric.reflections ?? [],
            }
          : {
              id: day,
              ...DEFAULT_METRIC_FOR_DAY,
              focusSessions: [],
              reflections: [],
            };
      }),
    );
  }

  addMetric(metric: Metric): void {
    this._store$.dispatch(
      addMetric({
        metric: {
          ...metric,
          id: metric.id || this._dateService.todayStr(),
        },
      }),
    );
  }

  deleteMetric(id: string): void {
    this._store$.dispatch(deleteMetric({ id }));
  }

  updateMetric(id: string, changes: Partial<Metric>): void {
    this._store$.dispatch(updateMetric({ metric: { id, changes } }));
  }

  upsertMetric(metric: Metric): void {
    this._store$.dispatch(upsertMetric({ metric }));
  }

  upsertTodayMetric(metricIn: Partial<Metric>): void {
    const day = this._dateService.todayStr();
    const metric = {
      id: day,
      ...DEFAULT_METRIC_FOR_DAY,
      ...metricIn,
    } as Metric;
    this._store$.dispatch(upsertMetric({ metric }));
  }

  logFocusSession(duration: number, day: string = this._dateService.todayStr()): void {
    if (!duration || duration < MIN_FOCUS_SESSION_DURATION) {
      return;
    }

    this._store$.dispatch(
      logFocusSession({
        day,
        duration,
      }),
    );
  }

  // STATISTICS
  getSimpleClickCounterMetrics$(howMany: number = 60): Observable<LineChartData> {
    return this._store$.select(selectSimpleCounterClickCounterLineChartData, { howMany });
  }

  getSimpleCounterStopwatchMetrics$(howMany: number = 60): Observable<LineChartData> {
    return this._store$.select(selectSimpleCounterStopWatchLineChartData, { howMany });
  }

  getFocusSessionMetrics$(howMany: number = 60): Observable<LineChartData> {
    return this._store$.select(selectFocusSessionLineChartData, { howMany });
  }

  getAllMetrics$(): Observable<Metric[]> {
    return this._store$.select(selectAllMetrics);
  }

  getFocusSummaryForDay(day: string): { count: number; total: number } | undefined {
    return this.focusSessionsByDay()[day];
  }

  private _deriveTotalWorkMinutes(
    worklog: Worklog,
    metric: Metric,
    focusedMinutes: number,
  ): number {
    const timeSpentMs = getTimeSpentForDay(worklog, metric.id);
    if (timeSpentMs !== undefined) {
      return timeSpentMs / (1000 * 60);
    }
    if (metric.totalWorkMinutes != null) {
      return metric.totalWorkMinutes;
    }
    return Math.max(focusedMinutes, 0);
  }

  private _mapToBreakdown(metric: Metric, worklog: Worklog): ProductivityBreakdownItem {
    const focusSessions = metric.focusSessions ?? [];
    const focusedMinutes = focusSessionsToMinutes(focusSessions);
    const totalWorkMinutes = this._deriveTotalWorkMinutes(
      worklog,
      metric,
      focusedMinutes,
    );

    // Only calculate score if we have required data (impactOfWork)
    // Focus sessions can be 0 - the score will just reflect impact and total work
    const score = metric.impactOfWork
      ? calculateProductivityScore(metric.impactOfWork, focusedMinutes, totalWorkMinutes)
      : null;

    return {
      day: metric.id,
      score,
      impactRating: metric.impactOfWork ?? null,
      focusedMinutes,
      totalWorkMinutes,
      energyCheckin: metric.energyCheckin ?? null,
    };
  }

  /**
   * Gets the average productivity score for the last N days.
   * @param days Number of days to include in average (default 7)
   * @param endDate Optional end date (default today)
   * @returns Observable of average score or null if insufficient data
   */
  getAverageProductivityScore$(
    days: number = 7,
    endDate?: string,
  ): Observable<number | null> {
    return this._store$
      .pipe(select(selectLastNDaysMetrics, { days, endDate }))
      .pipe(map((metrics) => calculateAverageProductivityScore(metrics)));
  }

  /**
   * Gets the productivity trend comparing current period to previous period.
   * @param days Number of days per period (default 7)
   * @param endDate Optional end date (default today)
   * @returns Observable of trend indicator or null if insufficient data
   */
  getProductivityTrend$(
    days: number = 7,
    endDate?: string,
  ): Observable<TrendIndicator | null> {
    return combineLatest([
      this._store$.pipe(select(selectLastNDaysMetrics, { days, endDate })),
      this._store$.pipe(
        select(selectLastNDaysMetrics, {
          days,
          endDate: this._getPreviousPeriodDate(days, endDate),
        }),
      ),
    ]).pipe(
      map(([currentPeriod, previousPeriod]) =>
        calculateProductivityTrend(currentPeriod, previousPeriod),
      ),
    );
  }

  getProductivityBreakdown$(
    days: number = 7,
    endDate?: string,
  ): Observable<ProductivityBreakdownItem[]> {
    return combineLatest([
      this._store$.pipe(select(selectLastNDaysMetrics, { days, endDate })),
      this._worklogService.worklog$,
    ]).pipe(
      map(([metrics, worklog]) => {
        return metrics.map((metric) => this._mapToBreakdown(metric, worklog));
      }),
    );
  }

  getAverageSustainabilityScore$(
    days: number = 7,
    endDate?: string,
  ): Observable<number | null> {
    return combineLatest([
      this._store$.pipe(select(selectLastNDaysMetrics, { days, endDate })),
      this._worklogService.worklog$,
    ]).pipe(
      map(([metrics, worklog]) => this._calculateSustainabilityAverage(metrics, worklog)),
    );
  }

  getSustainabilityTrend$(
    days: number = 7,
    endDate?: string,
  ): Observable<TrendIndicator | null> {
    return combineLatest([
      this._store$.pipe(select(selectLastNDaysMetrics, { days, endDate })),
      this._store$.pipe(
        select(selectLastNDaysMetrics, {
          days,
          endDate: this._getPreviousPeriodDate(days, endDate),
        }),
      ),
      this._worklogService.worklog$,
    ]).pipe(
      map(([currentPeriod, previousPeriod, worklog]) => {
        const currentAvg = this._calculateSustainabilityAverage(currentPeriod, worklog);
        const previousAvg = this._calculateSustainabilityAverage(previousPeriod, worklog);

        if (currentAvg === null || previousAvg === null) {
          return null;
        }

        const change = currentAvg - previousAvg;
        const roundedChange = Math.round(change);
        const changePercent =
          previousAvg !== 0 ? Math.round((change / previousAvg) * 100) : 0;
        const direction = Math.abs(change) < 2 ? 'stable' : change > 0 ? 'up' : 'down';

        return {
          direction,
          change: roundedChange,
          changePercent,
        } as TrendIndicator;
      }),
    );
  }

  private _getPreviousPeriodDate(days: number, endDate?: string): string {
    const end = endDate ? new Date(endDate) : new Date();
    // Go back by the number of days to get the end of the previous period
    end.setDate(end.getDate() - days);
    return end.toISOString().split('T')[0];
  }

  private _calculateSustainabilityAverage(
    metrics: Metric[],
    worklog: Worklog,
  ): number | null {
    const scores = metrics
      .map((metric) => this._calculateSustainabilityScore(metric, worklog))
      .filter((score): score is number => score != null);

    if (!scores.length) {
      return null;
    }

    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return Math.round(average);
  }

  private _calculateSustainabilityScore(metric: Metric, worklog: Worklog): number | null {
    // Only calculate if we have energy checkin data (focus time can be 0)
    if (metric.energyCheckin == null) {
      return null;
    }

    const focusSessions = metric.focusSessions ?? [];
    const focusedMinutes = focusSessionsToMinutes(focusSessions);
    const totalWorkMinutes = this._deriveTotalWorkMinutes(
      worklog,
      metric,
      focusedMinutes,
    );

    // calculateSustainabilityScore already returns a rounded value
    return calculateSustainabilityScore(
      focusedMinutes,
      totalWorkMinutes,
      600,
      metric.energyCheckin,
    );
  }
}
