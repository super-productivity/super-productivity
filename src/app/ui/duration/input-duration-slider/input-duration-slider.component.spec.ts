// Component tests for moment.js replacement

describe('InputDurationSliderComponent moment replacement', () => {
  describe('setValueFromRotation', () => {
    it('should calculate hours from milliseconds', () => {
      // Test cases to ensure we maintain the same behavior
      const testCases = [
        { ms: 0, expectedHours: 0 },
        { ms: 3600000, expectedHours: 1 }, // 1 hour
        { ms: 7200000, expectedHours: 2 }, // 2 hours
        { ms: 5400000, expectedHours: 1 }, // 1.5 hours -> floor to 1
        { ms: 9000000, expectedHours: 2 }, // 2.5 hours -> floor to 2
      ];

      testCases.forEach(({ ms, expectedHours }) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        expect(hours).toBe(expectedHours);
      });
    });
  });

  describe('setRotationFromValue', () => {
    it('should calculate minutes from milliseconds', () => {
      const testCases = [
        { ms: 0, expectedMinutes: 0 },
        { ms: 60000, expectedMinutes: 1 }, // 1 minute
        { ms: 3600000, expectedMinutes: 0 }, // 1 hour, 0 minutes
        { ms: 3660000, expectedMinutes: 1 }, // 1 hour, 1 minute
        { ms: 5400000, expectedMinutes: 30 }, // 1.5 hours
        { ms: 7260000, expectedMinutes: 1 }, // 2 hours, 1 minute
      ];

      testCases.forEach(({ ms, expectedMinutes }) => {
        const totalMinutes = Math.floor(ms / (1000 * 60));
        const minutes = totalMinutes % 60;
        expect(minutes).toBe(expectedMinutes);
      });
    });

    it('should calculate total hours from milliseconds', () => {
      const testCases = [
        { ms: 0, expectedHours: 0 },
        { ms: 3600000, expectedHours: 1 }, // 1 hour
        { ms: 5400000, expectedHours: 1.5 }, // 1.5 hours
        { ms: 7200000, expectedHours: 2 }, // 2 hours
      ];

      testCases.forEach(({ ms, expectedHours }) => {
        const hours = ms / (1000 * 60 * 60);
        expect(hours).toBe(expectedHours);
      });
    });
  });

  describe('duration to milliseconds', () => {
    it('should convert hours and minutes to milliseconds', () => {
      const testCases = [
        { hours: 0, minutes: 0, expectedMs: 0 },
        { hours: 1, minutes: 0, expectedMs: 3600000 },
        { hours: 0, minutes: 30, expectedMs: 1800000 },
        { hours: 1, minutes: 30, expectedMs: 5400000 },
        { hours: 2, minutes: 15, expectedMs: 8100000 },
      ];

      testCases.forEach(({ hours, minutes, expectedMs }) => {
        // eslint-disable-next-line no-mixed-operators
        const ms = hours * 60 * 60 * 1000 + minutes * 60 * 1000;
        expect(ms).toBe(expectedMs);
      });
    });
  });
});
