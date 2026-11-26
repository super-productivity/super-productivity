import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LineChartData, Metric, MetricState } from '../metric.model';
import { sortWorklogDates } from '../../../util/sortWorklogDates';
import { METRIC_FEATURE_NAME, metricAdapter } from './metric.reducer';
import { selectAllSimpleCounters } from '../../simple-counter/store/simple-counter.reducer';
import { unique } from '../../../util/unique';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../../simple-counter/simple-counter.model';

export const selectMetricFeatureState =
  createFeatureSelector<MetricState>(METRIC_FEATURE_NAME);
export const { selectIds, selectEntities, selectAll, selectTotal } =
  metricAdapter.getSelectors();
export const selectAllMetrics = createSelector(selectMetricFeatureState, selectAll);
export const selectLastTrackedMetric = createSelector(
  selectMetricFeatureState,
  (state: MetricState): Metric | null => {
    const ids = state.ids as string[];
    const sorted = sortWorklogDates(ids);
    const id = sorted[sorted.length - 1];
    return state.entities[id] || null;
  },
);

export const selectMetricHasData = createSelector(
  selectMetricFeatureState,
  (state) => state && !!state.ids.length,
);

// DYNAMIC
// -------
export const selectMetricById = createSelector(
  selectMetricFeatureState,
  (state: MetricState, props: { id: string }): Metric | null => {
    // if (!state.entities[props.id]) {
    //   throw new Error('Metric not found');
    // }
    return state.entities[props.id] || null;
  },
);

// Do not forward each chart's props into the shared entity selector: alternating
// click/stopwatch subscriptions otherwise evict its memoized array on every tick.
const selectCounterItemsForCharts = (state: object): SimpleCounter[] =>
  selectAllSimpleCounters(state);

// STATISTICS
export const selectSimpleCounterClickCounterLineChartData = createSelector(
  selectCounterItemsForCharts,
  (simpleCounterItems: SimpleCounter[], props: { howMany: number }): LineChartData => {
    const f = -1 * props.howMany;
    const chart: LineChartData = {
      labels: [],
      datasets: [{ data: [] }],
    };
    const stopwatchItems = simpleCounterItems.filter(
      (item) => item.type === SimpleCounterType.ClickCounter,
    );
    const allDays = unique(
      stopwatchItems.flatMap((item) => Object.keys(item.countOnDay || {})),
    );
    const allDaysSorted = sortWorklogDates(allDays).slice(f);
    chart.labels = allDaysSorted;

    stopwatchItems.forEach((item, j) => {
      chart.datasets[j] = { data: [], label: item.title };
      allDaysSorted.forEach((day) => {
        const valueForDay = item.countOnDay?.[day];
        chart.datasets[j].data.push(valueForDay ? valueForDay : undefined);
      });
    });
    return chart;
  },
);

export const selectSimpleCounterStopWatchLineChartData = createSelector(
  selectCounterItemsForCharts,
  (simpleCounterItems: SimpleCounter[], props: { howMany: number }): LineChartData => {
    const f = -1 * props.howMany;
    const chart: LineChartData = {
      labels: [],
      datasets: [{ data: [] }],
    };
    const stopwatchItems = simpleCounterItems.filter(
      (item) => item.type === SimpleCounterType.StopWatch,
    );
    const allDays = unique(
      stopwatchItems.flatMap((item) => Object.keys(item.countOnDay || {})),
    );
    const allDaysSorted = sortWorklogDates(allDays).slice(f);
    chart.labels = allDaysSorted;

    stopwatchItems.forEach((item, j) => {
      chart.datasets[j] = { data: [], label: item.title };
      allDaysSorted.forEach((day) => {
        const valueForDay = item.countOnDay?.[day];
        chart.datasets[j].data.push(
          valueForDay ? Math.round(valueForDay / 60000) : undefined,
        );
      });
    });
    return chart;
  },
);

export const selectFocusSessionLineChartDataComplete = createSelector(
  selectMetricFeatureState,
  (state: MetricState): LineChartData => {
    const ids = state.ids as string[];
    const sorted = sortWorklogDates(ids);
    const chart: LineChartData = {
      labels: [],
      datasets: [
        { data: [], label: 'Focus sessions' },
        { data: [], label: 'Focus minutes' },
      ],
    };

    sorted.forEach((id) => {
      const metric = state.entities[id];
      if (!metric) {
        return;
      }
      const focusSessions = metric.focusSessions ?? [];
      const totalDuration = focusSessions.reduce((acc, val) => acc + val, 0);

      chart.labels?.push(metric.id);
      chart.datasets[0].data.push(focusSessions.length);
      chart.datasets[1].data.push(Math.round(totalDuration / 60000));
    });

    return chart;
  },
);

export const selectFocusSessionLineChartData = createSelector(
  selectFocusSessionLineChartDataComplete,
  (chart: LineChartData, props: { howMany: number }): LineChartData => {
    const f = -1 * props.howMany;
    return {
      labels: chart.labels?.slice(f),
      datasets: chart.datasets.map((dataset) => ({
        data: dataset.data.slice(f),
        label: dataset.label,
      })),
    };
  },
);

// Full history (no slicing) so the chart's timeframe selector can filter it.
export const selectEvaluationLineChartData = createSelector(
  selectMetricFeatureState,
  (state: MetricState): LineChartData => {
    const ids = state.ids as string[];
    const sorted = sortWorklogDates(ids);
    const chart: LineChartData = {
      labels: [],
      datasets: [
        { data: [], label: 'Impact (1-4)' },
        { data: [], label: 'Energy (1-3)' },
      ],
    };

    sorted.forEach((id) => {
      const metric = state.entities[id];
      if (!metric || (!metric.impactOfWork && !metric.energyCheckin)) {
        return;
      }

      chart.labels?.push(metric.id);
      chart.datasets[0].data.push(metric.impactOfWork || undefined);
      chart.datasets[1].data.push(metric.energyCheckin || undefined);
    });

    return chart;
  },
);

export const selectFocusSessionsByDay = createSelector(
  selectMetricFeatureState,
  (state: MetricState): Record<string, { count: number; total: number }> => {
    const result: Record<string, { count: number; total: number }> = {};
    const ids = state.ids as string[];

    ids.forEach((id) => {
      const metric = state.entities[id];
      if (metric?.focusSessions && metric.focusSessions.length) {
        const total = metric.focusSessions.reduce((acc, val) => acc + val, 0);
        result[id] = {
          count: metric.focusSessions.length,
          total,
        };
      }
    });

    return result;
  },
);
