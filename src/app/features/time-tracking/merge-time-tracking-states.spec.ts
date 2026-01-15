/* eslint-disable @typescript-eslint/naming-convention, no-mixed-operators */
import {
  mergeTimeTrackingStates,
  mergeTimeTrackingStatesForWorkContext,
} from './merge-time-tracking-states';
import { TimeTrackingState, TTWorkContextSessionMap } from './time-tracking.model';

describe('mergeTimeTrackingStates', () => {
  it('should merge time tracking states so newest one wins', () => {
    const current: TimeTrackingState = {
      project: { '1': { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } } },
      tag: { '2': { '2023-01-02': { s: 5, e: 6, b: 7, bt: 8 } } },
    };
    const archiveYoung: TimeTrackingState = {
      project: { '1': { '2023-01-01': { s: 9, e: 10, b: 11, bt: 12 } } },
      tag: { '2': { '2023-01-02': { s: 13, e: 14, b: 15, bt: 16 } } },
    };
    const archiveOld: TimeTrackingState = {
      project: { '1': { '2023-01-01': { s: 17, e: 18, b: 19, bt: 20 } } },
      tag: { '2': { '2023-01-02': { s: 21, e: 22, b: 23, bt: 24 } } },
    };

    const result = mergeTimeTrackingStates({
      current,
      archiveYoung: archiveYoung,
      archiveOld: archiveOld,
    });

    expect(result).toEqual({
      project: { 1: { '2023-01-01': { b: 3, bt: 4, e: 2, s: 1 } } },
      tag: { 2: { '2023-01-02': { b: 7, bt: 8, e: 6, s: 5 } } },
    });
  });
});

describe('mergeTimeTrackingStatesForWorkContext', () => {
  it('should merge time tracking states for work context correctly', () => {
    const current: TTWorkContextSessionMap = {
      '1': { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } },
    };
    const archiveYoung: TTWorkContextSessionMap = {
      '1': { '2023-01-01': { s: 5, e: 6, b: 7, bt: 8 } },
    };
    const archiveOld: TTWorkContextSessionMap = {
      '1': { '2023-01-01': { s: 9, e: 10, b: 11, bt: 12 } },
    };

    const result = mergeTimeTrackingStatesForWorkContext({
      current,
      archiveYoung: archiveYoung,
      archiveOld: archiveOld,
    });

    expect(result).toEqual({ 1: { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } } });
  });

  it('should handle missing dates and contexts correctly', () => {
    const current: TTWorkContextSessionMap = {
      '1': { '2023-01-01': { s: 1, e: 2, b: 3, bt: 4 } },
    };
    const archiveYoung: TTWorkContextSessionMap = {
      '2': { '2023-01-02': { s: 5, e: 6, b: 7, bt: 8 } },
    };
    const archiveOld: TTWorkContextSessionMap = {
      '3': { '2023-01-03': { s: 9, e: 10, b: 11, bt: 12 } },
    };

    const result = mergeTimeTrackingStatesForWorkContext({
      current,
      archiveYoung: archiveYoung,
      archiveOld: archiveOld,
    });

    expect(result).toEqual({
      1: { '2023-01-01': { b: 3, bt: 4, e: 2, s: 1 } },
      2: { '2023-01-02': { b: 7, bt: 8, e: 6, s: 5 } },
      3: { '2023-01-03': { b: 11, bt: 12, e: 10, s: 9 } },
    });
  });

  it('should not create empty context', () => {
    const current: TTWorkContextSessionMap = {
      '1': {},
    };
    const archiveYoung: TTWorkContextSessionMap = {
      '2': {},
    };
    const archiveOld: TTWorkContextSessionMap = {
      '3': { '2023-01-03': { s: 9, e: 10, b: 11, bt: 12 } },
    };

    const result = mergeTimeTrackingStatesForWorkContext({
      current,
      archiveYoung: archiveYoung,
      archiveOld: archiveOld,
    });

    expect(result).toEqual({
      3: { '2023-01-03': { b: 11, bt: 12, e: 10, s: 9 } },
    });
  });

  it('should not create empty entries for dates', () => {
    const current: TTWorkContextSessionMap = {
      '1': { '2023-01-01': {} },
    };
    const archiveYoung: TTWorkContextSessionMap = {
      '2': { '2023-01-02': {} },
    };
    const archiveOld: TTWorkContextSessionMap = {
      '3': { '2023-01-03': { s: 9, e: 10, b: 11, bt: 12 } },
    };

    const result = mergeTimeTrackingStatesForWorkContext({
      current,
      archiveYoung: archiveYoung,
      archiveOld: archiveOld,
    });

    expect(result).toEqual({
      3: { '2023-01-03': { b: 11, bt: 12, e: 10, s: 9 } },
    });
  });

  describe('partial data merging (deep merge behavior)', () => {
    it('should merge partial fields from different sources for same context/date', () => {
      // This tests the critical deep merge behavior:
      // Each source has different fields, result should combine all
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 100 } }, // Only 's' field
      };
      const archiveYoung: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { e: 200 } }, // Only 'e' field
      };
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { b: 300, bt: 400 } }, // Only 'b' and 'bt' fields
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung,
        archiveOld,
      });

      // All fields should be merged together
      expect(result).toEqual({
        1: { '2023-01-01': { s: 100, e: 200, b: 300, bt: 400 } },
      });
    });

    it('should use current value when same field exists in multiple sources', () => {
      // Priority: current > archiveYoung > archiveOld
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 1 } },
      };
      const archiveYoung: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 2, e: 20 } },
      };
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 3, e: 30, b: 300 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung,
        archiveOld,
      });

      // 's' from current (1), 'e' from archiveYoung (20), 'b' from archiveOld (300)
      expect(result).toEqual({
        1: { '2023-01-01': { s: 1, e: 20, b: 300 } },
      });
    });

    it('should merge partial data across different dates for same context', () => {
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 10 } },
      };
      const archiveYoung: TTWorkContextSessionMap = {
        '1': { '2023-01-02': { e: 20 } },
      };
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-03': { b: 30 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung,
        archiveOld,
      });

      expect(result).toEqual({
        1: {
          '2023-01-01': { s: 10 },
          '2023-01-02': { e: 20 },
          '2023-01-03': { b: 30 },
        },
      });
    });
  });

  describe('null/undefined handling', () => {
    it('should handle undefined sources gracefully', () => {
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 1, e: 2 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung: undefined as unknown as TTWorkContextSessionMap,
        archiveOld: undefined as unknown as TTWorkContextSessionMap,
      });

      expect(result).toEqual({
        1: { '2023-01-01': { s: 1, e: 2 } },
      });
    });

    it('should handle null sources gracefully', () => {
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 5, e: 6 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current: null as unknown as TTWorkContextSessionMap,
        archiveYoung: null as unknown as TTWorkContextSessionMap,
        archiveOld,
      });

      expect(result).toEqual({
        1: { '2023-01-01': { s: 5, e: 6 } },
      });
    });

    it('should return empty object when all sources are empty', () => {
      const result = mergeTimeTrackingStatesForWorkContext({
        current: {},
        archiveYoung: {},
        archiveOld: {},
      });

      expect(result).toEqual({});
    });

    it('should handle mixed null/undefined/empty sources', () => {
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 100 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung: null as unknown as TTWorkContextSessionMap,
        archiveOld: {},
      });

      expect(result).toEqual({
        1: { '2023-01-01': { s: 100 } },
      });
    });
  });

  describe('merge priority verification', () => {
    it('should always prefer current over archiveYoung for overlapping fields', () => {
      const current: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 1 } },
      };
      const archiveYoung: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { s: 999 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung,
        archiveOld: {},
      });

      expect(result[1]['2023-01-01'].s).toBe(1);
    });

    it('should always prefer archiveYoung over archiveOld for overlapping fields', () => {
      const archiveYoung: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { e: 2 } },
      };
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { e: 999 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current: {},
        archiveYoung,
        archiveOld,
      });

      expect(result[1]['2023-01-01'].e).toBe(2);
    });

    it('should use archiveOld value when not in current or archiveYoung', () => {
      const archiveOld: TTWorkContextSessionMap = {
        '1': { '2023-01-01': { bt: 42 } },
      };

      const result = mergeTimeTrackingStatesForWorkContext({
        current: {},
        archiveYoung: {},
        archiveOld,
      });

      expect(result[1]['2023-01-01'].bt).toBe(42);
    });
  });

  describe('scale and performance', () => {
    it('should handle many contexts and dates without error', () => {
      // Generate test data with 50 contexts, each with 20 dates
      const generateData = (baseValue: number): TTWorkContextSessionMap => {
        const data: TTWorkContextSessionMap = {};
        for (let ctx = 0; ctx < 50; ctx++) {
          data[`ctx-${ctx}`] = {};
          for (let day = 0; day < 20; day++) {
            data[`ctx-${ctx}`][`2023-01-${String(day + 1).padStart(2, '0')}`] = {
              s: baseValue + ctx * 100 + day,
              e: baseValue + ctx * 100 + day + 1,
            };
          }
        }
        return data;
      };

      const current = generateData(1000);
      const archiveYoung = generateData(2000);
      const archiveOld = generateData(3000);

      const startTime = Date.now();
      const result = mergeTimeTrackingStatesForWorkContext({
        current,
        archiveYoung,
        archiveOld,
      });
      const elapsed = Date.now() - startTime;

      // Verify result has all 50 contexts
      expect(Object.keys(result).length).toBe(50);

      // Verify each context has all 20 dates
      expect(Object.keys(result['ctx-0']).length).toBe(20);

      // Verify current values won (priority check)
      expect(result['ctx-0']['2023-01-01'].s).toBe(1000);

      // Performance baseline: should complete in reasonable time
      // (this is just a sanity check, not a strict performance test)
      expect(elapsed).toBeLessThan(1000); // Should be much faster than 1 second
    });
  });
});
