import { metricReducer, initialMetricState } from './metric.reducer';
import * as MetricActions from './metric.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Metric, MetricState } from '../metric.model';
import { DEFAULT_METRIC_FOR_DAY } from '../metric.const';
import { AppDataCompleteLegacy } from '../../../imex/sync/sync.model';

const createMetric = (id: string, partial: Partial<Metric> = {}): Metric => ({
  id,
  ...DEFAULT_METRIC_FOR_DAY,
  ...partial,
});

const createStateWithMetrics = (metrics: Metric[]): MetricState => ({
  ids: metrics.map((m) => m.id),
  entities: metrics.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<string, Metric>,
  ),
});

describe('MetricReducer', () => {
  describe('initial state', () => {
    it('should return empty entity state for unknown action', () => {
      const action = { type: 'UNKNOWN' };
      const result = metricReducer(undefined, action);

      expect(result).toEqual(initialMetricState);
      expect(result.ids).toEqual([]);
      expect(result.entities).toEqual({});
    });
  });

  describe('loadAllData', () => {
    it('should load metrics when available', () => {
      const metrics: Metric[] = [
        createMetric('2024-01-01', { focusSessions: [1000, 2000] }),
        createMetric('2024-01-02', { focusSessions: [3000] }),
      ];
      const metricState = createStateWithMetrics(metrics);
      const appDataComplete = { metric: metricState } as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = metricReducer(initialMetricState, action);

      expect(result.ids).toEqual(['2024-01-01', '2024-01-02']);
      expect(result.entities['2024-01-01']).toEqual(metrics[0]);
      expect(result.entities['2024-01-02']).toEqual(metrics[1]);
    });

    it('should preserve state when metric data is undefined', () => {
      const existingMetric = createMetric('2024-01-01');
      const existingState = createStateWithMetrics([existingMetric]);
      const appDataComplete = { metric: undefined } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = metricReducer(existingState, action);

      expect(result).toBe(existingState);
    });

    it('should preserve state when metric.ids is undefined', () => {
      const existingMetric = createMetric('2024-01-01');
      const existingState = createStateWithMetrics([existingMetric]);
      const appDataComplete = {
        metric: { entities: {} },
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = metricReducer(existingState, action);

      expect(result).toBe(existingState);
    });
  });

  describe('CRUD operations', () => {
    describe('addMetric', () => {
      it('should add new metric to state', () => {
        const metric = createMetric('2024-01-01', { focusSessions: [1000] });
        const action = MetricActions.addMetric({ metric });

        const result = metricReducer(initialMetricState, action);

        expect(result.ids).toContain('2024-01-01');
        expect(result.entities['2024-01-01']).toEqual(metric);
      });

      it('should not affect existing metrics when adding new one', () => {
        const existingMetric = createMetric('2024-01-01');
        const existingState = createStateWithMetrics([existingMetric]);
        const newMetric = createMetric('2024-01-02', { focusSessions: [5000] });

        const action = MetricActions.addMetric({ metric: newMetric });
        const result = metricReducer(existingState, action);

        expect(result.ids).toEqual(['2024-01-01', '2024-01-02']);
        expect(result.entities['2024-01-01']).toEqual(existingMetric);
        expect(result.entities['2024-01-02']).toEqual(newMetric);
      });
    });

    describe('updateMetric', () => {
      it('should update existing metric', () => {
        const existingMetric = createMetric('2024-01-01', { focusSessions: [1000] });
        const existingState = createStateWithMetrics([existingMetric]);

        const action = MetricActions.updateMetric({
          metric: {
            id: '2024-01-01',
            changes: { focusSessions: [1000, 2000] },
          },
        });
        const result = metricReducer(existingState, action);

        expect(result.entities['2024-01-01']!.focusSessions).toEqual([1000, 2000]);
      });

      it('should preserve other properties when updating', () => {
        const existingMetric = createMetric('2024-01-01', {
          focusSessions: [1000],
          notes: 'test notes',
        });
        const existingState = createStateWithMetrics([existingMetric]);

        const action = MetricActions.updateMetric({
          metric: {
            id: '2024-01-01',
            changes: { focusSessions: [1000, 2000] },
          },
        });
        const result = metricReducer(existingState, action);

        expect(result.entities['2024-01-01']!.notes).toBe('test notes');
      });

      it('should create new metric with defaults when updating non-existent entity', () => {
        const action = MetricActions.updateMetric({
          metric: {
            id: '2024-01-01',
            changes: { focusSessions: [1000, 2000] },
          },
        });
        const result = metricReducer(initialMetricState, action);

        expect(result.ids).toContain('2024-01-01');
        expect(result.entities['2024-01-01']!.id).toBe('2024-01-01');
        expect(result.entities['2024-01-01']!.focusSessions).toEqual([1000, 2000]);
        // Should have default values for other properties
        expect(result.entities['2024-01-01']!.remindTomorrow).toBe(
          DEFAULT_METRIC_FOR_DAY.remindTomorrow,
        );
      });
    });

    describe('upsertMetric', () => {
      it('should add metric if it does not exist', () => {
        const metric = createMetric('2024-01-01', { focusSessions: [1000] });
        const action = MetricActions.upsertMetric({ metric });

        const result = metricReducer(initialMetricState, action);

        expect(result.ids).toContain('2024-01-01');
        expect(result.entities['2024-01-01']).toEqual(metric);
      });

      it('should update metric if it already exists', () => {
        const existingMetric = createMetric('2024-01-01', { focusSessions: [1000] });
        const existingState = createStateWithMetrics([existingMetric]);
        const updatedMetric = createMetric('2024-01-01', { focusSessions: [1000, 2000] });

        const action = MetricActions.upsertMetric({ metric: updatedMetric });
        const result = metricReducer(existingState, action);

        expect(result.ids.length).toBe(1);
        expect(result.entities['2024-01-01']!.focusSessions).toEqual([1000, 2000]);
      });
    });

    describe('deleteMetric', () => {
      it('should remove metric by id', () => {
        const metrics = [createMetric('2024-01-01'), createMetric('2024-01-02')];
        const existingState = createStateWithMetrics(metrics);

        const action = MetricActions.deleteMetric({ id: '2024-01-01' });
        const result = metricReducer(existingState, action);

        expect(result.ids).toEqual(['2024-01-02']);
        expect(result.entities['2024-01-01']).toBeUndefined();
        expect(result.entities['2024-01-02']).toBeDefined();
      });

      it('should handle deletion of non-existent id gracefully', () => {
        const existingMetric = createMetric('2024-01-01');
        const existingState = createStateWithMetrics([existingMetric]);

        const action = MetricActions.deleteMetric({ id: 'non-existent' });
        const result = metricReducer(existingState, action);

        expect(result.ids).toEqual(['2024-01-01']);
      });
    });
  });

  describe('logFocusSession', () => {
    it('should return unmodified state if duration is 0', () => {
      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 0 });
      const result = metricReducer(initialMetricState, action);

      expect(result).toBe(initialMetricState);
    });

    it('should return unmodified state if duration is negative', () => {
      const action = MetricActions.logFocusSession({
        day: '2024-01-01',
        duration: -1000,
      });
      const result = metricReducer(initialMetricState, action);

      expect(result).toBe(initialMetricState);
    });

    it('should create new metric with duration when day does not exist', () => {
      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 5000 });
      const result = metricReducer(initialMetricState, action);

      expect(result.ids).toContain('2024-01-01');
      expect(result.entities['2024-01-01']!.id).toBe('2024-01-01');
      expect(result.entities['2024-01-01']!.focusSessions).toEqual([5000]);
    });

    it('should use DEFAULT_METRIC_FOR_DAY properties for new metric', () => {
      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 5000 });
      const result = metricReducer(initialMetricState, action);

      const newMetric = result.entities['2024-01-01']!;
      expect(newMetric.remindTomorrow).toBe(DEFAULT_METRIC_FOR_DAY.remindTomorrow);
      expect(newMetric.reflections).toEqual(DEFAULT_METRIC_FOR_DAY.reflections);
    });

    it('should append duration to existing focusSessions array', () => {
      const existingMetric = createMetric('2024-01-01', { focusSessions: [1000, 2000] });
      const existingState = createStateWithMetrics([existingMetric]);

      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 3000 });
      const result = metricReducer(existingState, action);

      expect(result.entities['2024-01-01']!.focusSessions).toEqual([1000, 2000, 3000]);
    });

    it('should handle metric with undefined focusSessions', () => {
      const existingMetric = createMetric('2024-01-01', { focusSessions: undefined });
      const existingState = createStateWithMetrics([existingMetric]);

      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 5000 });
      const result = metricReducer(existingState, action);

      expect(result.entities['2024-01-01']!.focusSessions).toEqual([5000]);
    });

    it('should preserve other metric properties when appending session', () => {
      const existingMetric = createMetric('2024-01-01', {
        focusSessions: [1000],
        notes: 'important notes',
        remindTomorrow: true,
      });
      const existingState = createStateWithMetrics([existingMetric]);

      const action = MetricActions.logFocusSession({ day: '2024-01-01', duration: 2000 });
      const result = metricReducer(existingState, action);

      expect(result.entities['2024-01-01']!.notes).toBe('important notes');
      expect(result.entities['2024-01-01']!.remindTomorrow).toBe(true);
    });

    it('should handle multiple focus sessions on the same day', () => {
      let state = initialMetricState;

      state = metricReducer(
        state,
        MetricActions.logFocusSession({ day: '2024-01-01', duration: 1000 }),
      );
      state = metricReducer(
        state,
        MetricActions.logFocusSession({ day: '2024-01-01', duration: 2000 }),
      );
      state = metricReducer(
        state,
        MetricActions.logFocusSession({ day: '2024-01-01', duration: 3000 }),
      );

      expect(state.entities['2024-01-01']!.focusSessions).toEqual([1000, 2000, 3000]);
    });
  });
});
