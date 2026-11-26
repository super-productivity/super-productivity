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
import { Observable } from 'rxjs';
import { LineChartData, Metric, MetricState } from './metric.model';
import {
  selectMetricById,
  selectMetricHasData,
  selectFocusSessionLineChartData,
  selectFocusSessionsByDay,
  selectSimpleCounterClickCounterLineChartData,
  selectSimpleCounterStopWatchLineChartData,
  selectAllMetrics,
  selectEvaluationLineChartData,
} from './store/metric.selectors';
import { map } from 'rxjs/operators';
import { DEFAULT_METRIC_FOR_DAY } from './metric.const';
import { DateService } from 'src/app/core/date/date.service';

const MIN_FOCUS_SESSION_DURATION = 1000;

@Injectable({
  providedIn: 'root',
})
export class MetricService {
  private _store$ = inject<Store<MetricState>>(Store);
  private _dateService = inject(DateService);

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

  getEvaluationMetrics$(): Observable<LineChartData> {
    return this._store$.select(selectEvaluationLineChartData);
  }

  getAllMetrics$(): Observable<Metric[]> {
    return this._store$.select(selectAllMetrics);
  }

  getFocusSummaryForDay(day: string): { count: number; total: number } | undefined {
    return this.focusSessionsByDay()[day];
  }
}
