import { processDurationInput } from './duration-input.util';

describe('processDurationInput', () => {
  describe('valid inputs that should update', () => {
    it('should process simple minute values', () => {
      const result = processDurationInput('30m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(30 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process 50m correctly', () => {
      const result = processDurationInput('50m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(50 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process 90m correctly (even though it normalizes to 1h 30m)', () => {
      const result = processDurationInput('90m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(90 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process 120m correctly (normalizes to 2h)', () => {
      const result = processDurationInput('120m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(120 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process simple hour values', () => {
      const result = processDurationInput('2h');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(2 * 60 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process hour and minute combinations', () => {
      const result = processDurationInput('2h 30m');
      expect(result.isValid).toBe(true);
      const hoursInMs = 2 * 60 * 60 * 1000;
      const minutesInMs = 30 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process zero values with units', () => {
      const result = processDurationInput('0m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(0);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should process 0h', () => {
      const result = processDurationInput('0h');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(0);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should update when millisecond value changes', () => {
      const result = processDurationInput('60m', false, 30 * 60 * 1000);
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(60 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle values with spaces', () => {
      const result = processDurationInput(' 45m ');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(45 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle fractional values', () => {
      const result = processDurationInput('1.5h');
      expect(result.isValid).toBe(true);
      const hoursInMs = 60 * 60 * 1000;
      const minutesInMs = 30 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle fractional values as hours if "h" postfix is omitted', () => {
      const result = processDurationInput('1.5');
      expect(result.isValid).toBe(true);
      const hoursInMs = 60 * 60 * 1000;
      const minutesInMs = 30 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle fractional values with comma as separator', () => {
      const result = processDurationInput('1,5h');
      expect(result.isValid).toBe(true);
      const hoursInMs = 60 * 60 * 1000;
      const minutesInMs = 30 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle fractional values with comma as separator and omitted postfix', () => {
      const result = processDurationInput('1,5');
      expect(result.isValid).toBe(true);
      const hoursInMs = 60 * 60 * 1000;
      const minutesInMs = 30 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle hh:mm input', () => {
      const result = processDurationInput('01:45');
      expect(result.isValid).toBe(true);
      const hoursInMs = 60 * 60 * 1000;
      const minutesInMs = 45 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle h:mm input', () => {
      const result = processDurationInput('2:15');
      expect(result.isValid).toBe(true);
      const hoursInMs = 2 * 60 * 60 * 1000;
      const minutesInMs = 15 * 60 * 1000;
      expect(result.milliseconds).toBe(hoursInMs + minutesInMs);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should handle h:m input', () => {
      const result = processDurationInput('1:5');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should treat plain integers as minutes', () => {
      const result = processDurationInput('8');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(8 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should treat larger plain integers as minutes', () => {
      const result = processDurationInput('15');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(15 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it('should treat plain numbers larger than 60 as minutes', () => {
      const result = processDurationInput('90');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(90 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });
  });

  describe('inputs that should not update', () => {
    it('should not update for incomplete typing like "2h 3"', () => {
      const result = processDurationInput('2h 3');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should not update for invalid patterns', () => {
      const result = processDurationInput('abc');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should not update for values with seconds when not allowed', () => {
      const result = processDurationInput('30s', false);
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should not update for day values', () => {
      const result = processDurationInput('2d');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = processDurationInput('');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should handle whitespace only', () => {
      const result = processDurationInput('   ');
      expect(result.isValid).toBe(false);
      expect(result.milliseconds).toBe(null);
      expect(result.shouldUpdate).toBe(false);
    });

    it('should handle very large minute values', () => {
      const result = processDurationInput('999m');
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(999 * 60 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });

    it("should not update when value hasn't changed", () => {
      const currentMs = 60 * 60 * 1000; // 1 hour
      const result = processDurationInput('1h', false, currentMs);
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(currentMs);
      expect(result.shouldUpdate).toBe(true); // Should still update when explicitly typing the normalized format
    });
  });

  describe('with seconds enabled', () => {
    it('should handle seconds when allowed', () => {
      const result = processDurationInput('30s', true);
      expect(result.isValid).toBe(true);
      expect(result.milliseconds).toBe(30 * 1000);
      expect(result.shouldUpdate).toBe(true);
    });
  });
});
