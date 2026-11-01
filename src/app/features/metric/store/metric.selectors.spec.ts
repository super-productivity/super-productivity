import {
  selectEvaluationLineChartData,
  selectFocusSessionLineChartData,
  selectFocusSessionLineChartDataComplete,
  selectSimpleCounterClickCounterLineChartData,
  selectSimpleCounterStopWatchLineChartData,
} from './metric.selectors';
import { T } from '../../../t.const';
import { MetricState } from '../metric.model';
import { initialSimpleCounterState } from '../../simple-counter/store/simple-counter.reducer';
import {
  SimpleCounter,
  SimpleCounterType,
} from '../../simple-counter/simple-counter.model';

/* eslint-disable @typescript-eslint/naming-convention */
const createMockSimpleCounter = (
  overrides: Partial<SimpleCounter> & { id: string },
): SimpleCounter => ({
  title: overrides.id,
  isEnabled: true,
  icon: null,
  type: SimpleCounterType.ClickCounter,
  isOn: false,
  countOnDay: {},
  ...overrides,
});

describe('Metric Selectors - SimpleCounter Click Counter', () => {
  it('should return chart data for click counters', () => {
    const counter1 = createMockSimpleCounter({
      id: 'c1',
      title: 'Water',
      type: SimpleCounterType.ClickCounter,
      countOnDay: { '2024-01-01': 3, '2024-01-02': 5 },
    });
    const counter2 = createMockSimpleCounter({
      id: 'c2',
      title: 'Coffee',
      type: SimpleCounterType.ClickCounter,
      countOnDay: { '2024-01-01': 1 },
    });
    const stopwatch = createMockSimpleCounter({
      id: 's1',
      title: 'Exercise',
      type: SimpleCounterType.StopWatch,
      countOnDay: { '2024-01-01': 60000 },
    });

    const result = selectSimpleCounterClickCounterLineChartData.projector(
      [counter1, counter2, stopwatch],
      { howMany: 10 },
    );

    expect(result.labels).toEqual(['2024-01-01', '2024-01-02']);
    expect(result.datasets.length).toBe(2);
    expect(result.datasets[0].label).toBe('Water');
    expect(result.datasets[0].data).toEqual([3, 5]);
    expect(result.datasets[1].label).toBe('Coffee');
    expect(result.datasets[1].data).toEqual([1, undefined]);
  });

  it('should exclude stopwatch counters', () => {
    const stopwatch = createMockSimpleCounter({
      id: 's1',
      type: SimpleCounterType.StopWatch,
      countOnDay: { '2024-01-01': 60000 },
    });
    const result = selectSimpleCounterClickCounterLineChartData.projector([stopwatch], {
      howMany: 10,
    });

    expect(result.datasets[0].data).toEqual([]);
  });

  it('should slice to howMany days', () => {
    const counter = createMockSimpleCounter({
      id: 'c1',
      type: SimpleCounterType.ClickCounter,
      countOnDay: { '2024-01-01': 1, '2024-01-02': 2, '2024-01-03': 3 },
    });
    const result = selectSimpleCounterClickCounterLineChartData.projector([counter], {
      howMany: 2,
    });

    expect(result.labels).toEqual(['2024-01-02', '2024-01-03']);
    expect(result.datasets[0].data).toEqual([2, 3]);
  });

  it('should handle empty state', () => {
    const result = selectSimpleCounterClickCounterLineChartData.projector([], {
      howMany: 10,
    });

    expect(result.labels).toEqual([]);
    expect(result.datasets[0].data).toEqual([]);
  });
});

describe('Metric Selectors - SimpleCounter StopWatch', () => {
  it('should return chart data for stopwatch counters in minutes', () => {
    const stopwatch = createMockSimpleCounter({
      id: 's1',
      title: 'Exercise',
      type: SimpleCounterType.StopWatch,
      countOnDay: { '2024-01-01': 1800000, '2024-01-02': 3600000 },
    });
    const clicker = createMockSimpleCounter({
      id: 'c1',
      type: SimpleCounterType.ClickCounter,
      countOnDay: { '2024-01-01': 5 },
    });

    const allCounters: SimpleCounter[] = [stopwatch, clicker];
    const result = selectSimpleCounterStopWatchLineChartData.projector(allCounters, {
      howMany: 10,
    });

    expect(result.labels).toEqual(['2024-01-01', '2024-01-02']);
    expect(result.datasets.length).toBe(1);
    expect(result.datasets[0].label).toBe('Exercise');
    expect(result.datasets[0].data).toEqual([30, 60]);
  });

  it('should exclude click counters', () => {
    const clicker = createMockSimpleCounter({
      id: 'c1',
      type: SimpleCounterType.ClickCounter,
      countOnDay: { '2024-01-01': 5 },
    });

    const result = selectSimpleCounterStopWatchLineChartData.projector([clicker], {
      howMany: 10,
    });

    expect(result.datasets[0].data).toEqual([]);
  });

  it('should slice to howMany days', () => {
    const stopwatch = createMockSimpleCounter({
      id: 's1',
      type: SimpleCounterType.StopWatch,
      countOnDay: { '2024-01-01': 60000, '2024-01-02': 120000, '2024-01-03': 180000 },
    });

    const result = selectSimpleCounterStopWatchLineChartData.projector([stopwatch], {
      howMany: 1,
    });

    expect(result.labels).toEqual(['2024-01-03']);
    expect(result.datasets[0].data).toEqual([3]);
  });

  it('should handle empty counters', () => {
    const result = selectSimpleCounterStopWatchLineChartData.projector([], {
      howMany: 10,
    });

    expect(result.labels).toEqual([]);
    expect(result.datasets[0].data).toEqual([]);
  });
});

describe('Metric Selectors - Shared counter dates', () => {
  for (const [type, selector] of [
    [SimpleCounterType.ClickCounter, selectSimpleCounterClickCounterLineChartData],
    [SimpleCounterType.StopWatch, selectSimpleCounterStopWatchLineChartData],
  ] as const) {
    it(`deduplicates and sorts ${type} dates before limiting the chart`, () => {
      const unit = type === SimpleCounterType.StopWatch ? 60000 : 1;
      const counters = [
        createMockSimpleCounter({
          id: 'first',
          type,
          countOnDay: { '2024-01-03': unit, '2024-01-01': unit, '2024-01-02': 0 },
        }),
        createMockSimpleCounter({
          id: 'second',
          type,
          countOnDay: { '2024-01-02': 2 * unit, '2024-01-01': unit },
        }),
      ];
      counters.forEach((counter) => {
        Object.freeze(counter.countOnDay);
        Object.freeze(counter);
      });
      Object.freeze(counters);

      const chart = selector.projector(counters, { howMany: 2 });

      expect(chart.labels).toEqual(['2024-01-02', '2024-01-03']);
      expect(chart.datasets.map((dataset) => dataset.label)).toEqual(['first', 'second']);
      expect(chart.datasets.map((dataset) => dataset.data)).toEqual([
        [undefined, 1],
        [2, undefined],
      ]);
      // Zero retains the existing "all days" slice behavior.
      expect(selector.projector(counters, { howMany: 0 }).labels).toEqual([
        '2024-01-01',
        '2024-01-02',
        '2024-01-03',
      ]);
    });
  }
});

describe('Metric Selectors - Focus Sessions', () => {
  const dayOne = '2024-01-01';
  const dayTwo = '2024-01-02';

  const mockState: MetricState = {
    ids: [dayOne, dayTwo],
    entities: {
      [dayOne]: {
        id: dayOne,
        focusSessions: [25 * 60 * 1000, 15 * 60 * 1000],
      },
      [dayTwo]: {
        id: dayTwo,
        focusSessions: [],
      },
    },
  };

  it('should create focus session chart data for all days', () => {
    const chart = selectFocusSessionLineChartDataComplete.projector(mockState);

    expect(chart.labels).toEqual([dayOne, dayTwo]);
    expect(chart.datasets[0].label).toBe(T.F.METRIC.CMP.CHART_FOCUS_SESSIONS);
    expect(chart.datasets[0].data).toEqual([2, 0]);
    expect(chart.datasets[1].label).toBe(T.F.METRIC.CMP.CHART_FOCUS_MINUTES);
    expect(chart.datasets[1].data).toEqual([40, 0]);
  });

  it('should slice focus session data when howMany is provided', () => {
    const chart = selectFocusSessionLineChartDataComplete.projector(mockState);
    const sliced = selectFocusSessionLineChartData.projector(chart, { howMany: 1 });

    expect(sliced.labels).toEqual([dayTwo]);
    expect(sliced.datasets[0].data).toEqual([0]);
    expect(sliced.datasets[1].data).toEqual([0]);
  });
});

describe('Metric Selectors - Evaluation', () => {
  it('should chart impact and energy for rated days in date order', () => {
    const mockState: MetricState = {
      ids: ['2024-01-03', '2024-01-01', '2024-01-02'],
      entities: {
        '2024-01-01': { id: '2024-01-01', impactOfWork: 3, energyCheckin: 2 },
        '2024-01-02': { id: '2024-01-02', focusSessions: [60000] },
        '2024-01-03': { id: '2024-01-03', impactOfWork: null, energyCheckin: 1 },
      },
    };

    const chart = selectEvaluationLineChartData.projector(mockState);

    expect(chart.labels).toEqual(['2024-01-01', '2024-01-03']);
    expect(chart.datasets[0].label).toBe(T.F.METRIC.CMP.CHART_IMPACT);
    expect(chart.datasets[0].data).toEqual([3, undefined]);
    expect(chart.datasets[1].label).toBe(T.F.METRIC.CMP.CHART_ENERGY);
    expect(chart.datasets[1].data).toEqual([2, 1]);
  });

  it('should treat a cleared impact rating (0) as a gap', () => {
    const mockState: MetricState = {
      ids: ['2024-01-01'],
      entities: { '2024-01-01': { id: '2024-01-01', impactOfWork: 0, energyCheckin: 3 } },
    };

    const chart = selectEvaluationLineChartData.projector(mockState);

    expect(chart.labels).toEqual(['2024-01-01']);
    expect(chart.datasets[0].data).toEqual([undefined]);
    expect(chart.datasets[1].data).toEqual([3]);
  });

  it('should return no labels when no day is rated', () => {
    const mockState: MetricState = {
      ids: ['2024-01-01'],
      entities: { '2024-01-01': { id: '2024-01-01', focusSessions: [] } },
    };

    expect(selectEvaluationLineChartData.projector(mockState).labels).toEqual([]);
  });
});

describe('Metric chart selectors with concurrent chart subscriptions', () => {
  it('keeps unchanged chart references across unrelated tracking ticks', () => {
    const clickProps = { howMany: 60 };
    const stopwatchProps = { howMany: 60 };
    const state = { simpleCounter: initialSimpleCounterState, tick: 0 };
    const clicks = selectSimpleCounterClickCounterLineChartData(state, clickProps);
    const stopwatch = selectSimpleCounterStopWatchLineChartData(state, stopwatchProps);
    const next = { ...state, tick: 1 };

    expect(selectSimpleCounterClickCounterLineChartData(next, clickProps)).toBe(clicks);
    expect(selectSimpleCounterStopWatchLineChartData(next, stopwatchProps)).toBe(
      stopwatch,
    );
  });

  it('still updates both charts when their counter data changes', () => {
    const clickProps = { howMany: 60 };
    const stopwatchProps = { howMany: 60 };
    const state = { simpleCounter: initialSimpleCounterState };
    const clicks = selectSimpleCounterClickCounterLineChartData(state, clickProps);
    const stopwatch = selectSimpleCounterStopWatchLineChartData(state, stopwatchProps);
    const next = {
      simpleCounter: {
        ids: ['click', 'watch'],
        entities: {
          click: createMockSimpleCounter({
            id: 'click',
            countOnDay: { '2026-10-23': 3 },
          }),
          watch: createMockSimpleCounter({
            id: 'watch',
            type: SimpleCounterType.StopWatch,
            countOnDay: { '2026-10-23': 120000 },
          }),
        },
      },
    };
    const nextClicks = selectSimpleCounterClickCounterLineChartData(next, clickProps);
    const nextStopwatch = selectSimpleCounterStopWatchLineChartData(next, stopwatchProps);
    expect(nextClicks).not.toBe(clicks);
    expect(nextStopwatch).not.toBe(stopwatch);
    expect(nextClicks.datasets[0].data).toEqual([3]);
    expect(nextStopwatch.datasets[0].data).toEqual([2]);
  });
});
