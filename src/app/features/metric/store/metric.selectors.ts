import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LineChartData, Metric, MetricState } from '../metric.model';
import { sortWorklogDates } from '../../../util/sortWorklogDates';
import { METRIC_FEATURE_NAME, metricAdapter } from './metric.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  selectAllSimpleCounters,
  selectSimpleCounterFeatureState,
} from '../../simple-counter/store/simple-counter.reducer';
import { unique } from '../../../util/unique';
import {
  SimpleCounter,
  SimpleCounterState,
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

/**
 * Selects metrics for the last N days from a given date.
 * Returns array of metrics ordered chronologically (oldest to newest).
 */
export const selectLastNDaysMetrics = createSelector(
  selectMetricFeatureState,
  (state: MetricState, props: { days: number; endDate?: string }): Metric[] => {
    const ids = state.ids as string[];
    const sorted = sortWorklogDates(ids);

    // Find the index of the end date (or use today if not specified)
    const endDate = props.endDate || getDbDateStr();
    const endIndex = sorted.indexOf(endDate);

    // If end date not found, use the latest date
    const actualEndIndex = endIndex >= 0 ? endIndex : sorted.length - 1;

    // Get the last N days (inclusive)
    const startIndex = Math.max(0, actualEndIndex - props.days + 1);
    const selectedIds = sorted.slice(startIndex, actualEndIndex + 1);

    return selectedIds
      .map((id) => state.entities[id])
      .filter((metric): metric is Metric => metric != null);
  },
);

// STATISTICS
export const selectSimpleCounterClickCounterLineChartData = createSelector(
  selectSimpleCounterFeatureState,
  (simpleCounterState: SimpleCounterState, props: { howMany: number }): LineChartData => {
    // NOTE: for the most weird reasons that fixes the problem with the page refreshing on every single action ???
    // it doesn't matter if I use the alternative approach here or below for selectSimpleCounterStopWatchLineChartData
    // just having this here fixes the issue for both and vice versa
    const simpleCounterItems: SimpleCounter[] = Object.values(
      simpleCounterState.entities,
    ) as SimpleCounter[];

    const f = -1 * props.howMany;
    const chart: LineChartData = {
      labels: [],
      datasets: [{ data: [] }],
    };
    const stopwatchItems = simpleCounterItems.filter(
      (item) => item.type === SimpleCounterType.ClickCounter,
    );
    let allDays: string[] = [];
    stopwatchItems.forEach((item, i) => {
      allDays = allDays.concat(Object.keys(item.countOnDay));
    });
    const allDaysSorted = sortWorklogDates(unique(allDays)).slice(f);
    chart.labels = allDaysSorted;

    stopwatchItems.forEach((item, j) => {
      chart.datasets[j] = { data: [], label: item.title };
      allDaysSorted.forEach((day) => {
        const valueForDay = item.countOnDay[day];
        chart.datasets[j].data.push(valueForDay ? valueForDay : undefined);
      });
    });
    return chart;
  },
);

export const selectSimpleCounterStopWatchLineChartData = createSelector(
  selectAllSimpleCounters,
  (simpleCounterItems: SimpleCounter[], props: { howMany: number }): LineChartData => {
    const f = -1 * props.howMany;
    const chart: LineChartData = {
      labels: [],
      datasets: [{ data: [] }],
    };
    const stopwatchItems = simpleCounterItems.filter(
      (item) => item.type === SimpleCounterType.StopWatch,
    );
    let allDays: string[] = [];
    stopwatchItems.forEach((item, i) => {
      allDays = allDays.concat(Object.keys(item.countOnDay));
    });
    const allDaysSorted = sortWorklogDates(unique(allDays)).slice(f);
    chart.labels = allDaysSorted;

    stopwatchItems.forEach((item, j) => {
      chart.datasets[j] = { data: [], label: item.title };
      allDaysSorted.forEach((day) => {
        const valueForDay = item.countOnDay[day];
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
