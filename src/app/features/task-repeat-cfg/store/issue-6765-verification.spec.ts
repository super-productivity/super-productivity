/**
 * Verification tests for issue #6765:
 * "Recurring Tasks - Issues with Yearly Tasks"
 *
 * These tests verify the hypothesized root causes:
 * 1. undefined startDate falls back to 1970-01-01 → January 1st recurrence
 * 2. setMonth overflow in yearly date calculations
 * 3. setDate-before-setMonth order bug in getNewestPossibleDueDate
 */
import { getFirstRepeatOccurrence } from './get-first-repeat-occurrence.util';
import { getNextRepeatOccurrence } from './get-next-repeat-occurrence.util';
import { getNewestPossibleDueDate } from './get-newest-possible-due-date.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

const createCfg = (overrides: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'test-id',
  ...overrides,
});

describe('Issue #6765 verification', () => {
  // ========================================================================
  // HYPOTHESIS 1: undefined startDate → fallback to 1970-01-01 → January 1st
  // ========================================================================
  describe('Hypothesis 1: undefined startDate produces January 1st for YEARLY', () => {
    it('getFirstRepeatOccurrence with undefined startDate should produce January occurrence', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: undefined,
        lastTaskCreationDay: undefined,
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      // With undefined startDate, fallback is 1970-01-01
      // So month=0 (January), day=1 → yearly recurrence on January 1st
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(1);
      // This confirms the hypothesis: undefined startDate → January 1st
    });

    it('getNextRepeatOccurrence with undefined startDate should produce January occurrence', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: undefined,
        lastTaskCreationDay: '2025-01-01',
      });

      const result = getNextRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(1);
    });

    it('getNewestPossibleDueDate with undefined startDate and YEARLY should use January 1st', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: undefined,
        lastTaskCreationDay: '1970-01-01',
      });

      const result = getNewestPossibleDueDate(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(1);
    });
  });

  // ========================================================================
  // HYPOTHESIS 1b: Correct startDate (May 1st) should NOT produce January
  // ========================================================================
  describe('Correct startDate (May 1st) should preserve month/day', () => {
    it('getFirstRepeatOccurrence with May 1st startDate returns May 1st', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(4); // May (0-indexed)
      expect(result!.getDate()).toBe(1);
    });

    it('getNextRepeatOccurrence with May 1st startDate returns May 1st next year', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
        lastTaskCreationDay: '2026-05-01',
      });

      const result = getNextRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2027);
      expect(result!.getMonth()).toBe(4); // May
      expect(result!.getDate()).toBe(1);
    });

    it('getNewestPossibleDueDate with May 1st startDate on June 1st returns May 1st', () => {
      const today = new Date('2026-06-01T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
        lastTaskCreationDay: '2025-05-01',
      });

      const result = getNewestPossibleDueDate(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(4); // May
      expect(result!.getDate()).toBe(1);
    });
  });

  // ========================================================================
  // HYPOTHESIS 2: setMonth overflow in getNextRepeatOccurrence
  // ========================================================================
  describe('Hypothesis 2: setMonth overflow in getNextRepeatOccurrence YEARLY', () => {
    it('should correctly handle April 30 repeat when checkDate has 31 days in month', () => {
      // Start date is April 30, last creation was April 30 2025
      // fromDate is July 31, 2025 — checkDate starts as August 1 (July 31 + 1)
      // setYearlyDate: setMonth(3) on Aug 1 → April 1 (OK), setDate(30) → April 30 ✓
      // BUT if checkDate were March 31 → setMonth(3) → April 31 → May 1!
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2025-04-30',
        lastTaskCreationDay: '2025-04-30',
      });
      const fromDate = new Date('2025-07-31T12:00:00');

      const result = getNextRepeatOccurrence(cfg, fromDate);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(3); // April (0-indexed)
      expect(result!.getDate()).toBe(30);
    });

    it('should correctly handle Feb 15 repeat when fromDate is March 30', () => {
      // fromDate March 30 → checkDate March 31
      // setYearlyDate: setMonth(1) on March 31 → Feb 31 → March 3!
      // Then setDate(15) → March 15 (WRONG, should be Feb 15)
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2025-02-15',
        lastTaskCreationDay: '2025-02-15',
      });
      const fromDate = new Date('2025-03-30T12:00:00');

      const result = getNextRepeatOccurrence(cfg, fromDate);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(1); // February
      expect(result!.getDate()).toBe(15);
    });

    it('should correctly handle June 30 repeat when fromDate is Jan 30 of next year', () => {
      // checkDate = Jan 31
      // setYearlyDate: setMonth(5) on Jan 31 → June has 30 days → July 1!
      // setDate(30) → July 30 (WRONG!)
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2025-06-30',
        lastTaskCreationDay: '2025-06-30',
      });
      const fromDate = new Date('2026-01-30T12:00:00');

      const result = getNextRepeatOccurrence(cfg, fromDate);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(5); // June
      expect(result!.getDate()).toBe(30);
    });
  });

  // ========================================================================
  // HYPOTHESIS 3: setDate-before-setMonth in getNewestPossibleDueDate YEARLY
  // ========================================================================
  describe('Hypothesis 3: setDate/setMonth order bug in getNewestPossibleDueDate', () => {
    it('should handle Jan 31 start when today is in Feb (short month)', () => {
      // Today is Feb 15. For yearly Jan 31 repeat:
      // checkDate = Feb 15 → setDate(31) → Feb 31 → March 3
      // Then setMonth(0) → January 3 (WRONG, should be January 31)
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2025-01-31',
        lastTaskCreationDay: '2024-01-31',
      });
      const today = new Date('2026-02-15T12:00:00');

      const result = getNewestPossibleDueDate(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(0); // January
      expect(result!.getDate()).toBe(31);
    });

    it('should handle March 31 start when today is in June', () => {
      // Today is June 15. For yearly March 31:
      // checkDate = June 15 → setDate(31) → July 1 (June has 30 days)
      // setMonth(2) → March 1 (WRONG, should be March 31)
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2025-03-31',
        lastTaskCreationDay: '2025-03-31',
      });
      const today = new Date('2026-06-15T12:00:00');

      const result = getNewestPossibleDueDate(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(2); // March
      expect(result!.getDate()).toBe(31);
    });

    it('should handle May 1st correctly (the exact issue #6765 scenario)', () => {
      // The exact user scenario: yearly May 1st, today is March 8
      // checkDate = March 8 → setDate(1) → March 1 → setMonth(4) → May 1 ✓
      // (This specific case shouldn't overflow, but let's verify)
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
        lastTaskCreationDay: '2025-05-01',
      });
      const today = new Date('2026-06-01T12:00:00');

      const result = getNewestPossibleDueDate(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(4); // May
      expect(result!.getDate()).toBe(1);
    });
  });

  // ========================================================================
  // EXACT USER SCENARIO from issue #6765
  // ========================================================================
  describe('Exact issue #6765 scenario: yearly May 1st created on March 8', () => {
    it('getFirstRepeatOccurrence should return May 1, 2026', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
      });

      const result = getFirstRepeatOccurrence(cfg, today);

      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2026);
      expect(result!.getMonth()).toBe(4); // May
      expect(result!.getDate()).toBe(1);
    });

    it('getNewestPossibleDueDate should return null (start date in future)', () => {
      const today = new Date('2026-03-08T12:00:00');
      const cfg = createCfg({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: '2026-05-01',
        lastTaskCreationDay: '2025-05-01',
      });

      const result = getNewestPossibleDueDate(cfg, today);

      // Start date is in the future, so no due date yet
      expect(result).toBeNull();
    });
  });
});
