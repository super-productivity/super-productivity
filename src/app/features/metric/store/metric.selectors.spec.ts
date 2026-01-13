import {
  selectFocusSessionLineChartData,
  selectFocusSessionLineChartDataComplete,
} from './metric.selectors';
import { MetricState } from '../metric.model';

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
    expect(chart.datasets[0].label).toBe('Focus sessions');
    expect(chart.datasets[0].data).toEqual([2, 0]);
    expect(chart.datasets[1].label).toBe('Focus minutes');
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
