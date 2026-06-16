import {
  setUntil,
  setYearDay,
  toggleByDay,
  toggleByMonth,
  toggleMonthDay,
  toggleNthDay,
  weekdayAnnotations,
} from './rrule-calendar-ops.util';
import { rruleToFormModel } from './rrule-form.util';

// Fixed reference date (10 Jun 2020) so the form-model defaults are deterministic.
const REF = new Date('2020-06-10T12:00:00Z');

describe('rrule-calendar-ops.util', () => {
  describe('toggleMonthDay', () => {
    it('switches a non-monthly rule into a fresh day-of-month set', () => {
      expect(toggleMonthDay('FREQ=DAILY', REF, 15)).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    });
    it('adds a second day within day-of-month mode (sorted)', () => {
      expect(toggleMonthDay('FREQ=MONTHLY;BYMONTHDAY=15', REF, 20)).toBe(
        'FREQ=MONTHLY;BYMONTHDAY=15,20',
      );
    });
    it('removes a day that was already selected', () => {
      expect(toggleMonthDay('FREQ=MONTHLY;BYMONTHDAY=15', REF, 15)).toBe('FREQ=MONTHLY');
    });
  });

  describe('setYearDay', () => {
    it('sets the single yearly date (month + day)', () => {
      expect(setYearDay('FREQ=DAILY', REF, 6, 10)).toBe(
        'FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10',
      );
    });
    it('clears when the active date is re-selected', () => {
      expect(setYearDay('FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10', REF, 6, 10)).toBe(
        'FREQ=YEARLY',
      );
    });
    it('moves the date when a different day is selected', () => {
      expect(setYearDay('FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10', REF, 3, 5)).toBe(
        'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=5',
      );
    });
  });

  describe('setUntil', () => {
    it('sets UNTIL (noon UTC) and the end-type', () => {
      expect(setUntil('FREQ=WEEKLY;BYDAY=MO', REF, '2026-12-31')).toBe(
        'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T120000Z',
      );
    });
  });

  describe('toggleByDay', () => {
    it('starts a fresh monthly weekday set', () => {
      expect(toggleByDay('FREQ=DAILY', REF, 'MO', 'MONTHLY')).toBe(
        'FREQ=MONTHLY;BYDAY=MO',
      );
    });
    it('adds a weekday within the set (Mon-first)', () => {
      expect(toggleByDay('FREQ=MONTHLY;BYDAY=MO', REF, 'WE', 'MONTHLY')).toBe(
        'FREQ=MONTHLY;BYDAY=MO,WE',
      );
    });
    it('yearly weekday set keeps BYMONTH', () => {
      expect(toggleByDay('FREQ=YEARLY;BYMONTH=6', REF, 'SA', 'YEARLY')).toBe(
        'FREQ=YEARLY;BYMONTH=6;BYDAY=SA',
      );
    });
  });

  describe('toggleNthDay', () => {
    it('starts a fresh nth-weekday row', () => {
      expect(toggleNthDay('FREQ=DAILY', REF, 'MO', 2, 'MONTHLY')).toBe(
        'FREQ=MONTHLY;BYDAY=2MO',
      );
    });
    it('adds a second ordinal/weekday', () => {
      expect(toggleNthDay('FREQ=MONTHLY;BYDAY=2MO', REF, 'SU', 4, 'MONTHLY')).toBe(
        'FREQ=MONTHLY;BYDAY=2MO,4SU',
      );
    });
    it('removes a weekday at its ordinal', () => {
      expect(toggleNthDay('FREQ=MONTHLY;BYDAY=2MO', REF, 'MO', 2, 'MONTHLY')).toBe(
        'FREQ=MONTHLY',
      );
    });
    it('supports the last (-1) ordinal', () => {
      expect(toggleNthDay('FREQ=DAILY', REF, 'FR', -1, 'MONTHLY')).toBe(
        'FREQ=MONTHLY;BYDAY=-1FR',
      );
    });
  });

  describe('toggleByMonth', () => {
    it('adds a month constraint to any frequency', () => {
      expect(toggleByMonth('FREQ=DAILY', REF, 6)).toBe('FREQ=DAILY;BYMONTH=6');
    });
    it('removes a month that was set', () => {
      expect(toggleByMonth('FREQ=DAILY;BYMONTH=6', REF, 6)).toBe('FREQ=DAILY');
    });
    it('keeps months sorted', () => {
      expect(toggleByMonth('FREQ=DAILY;BYMONTH=6', REF, 3)).toBe(
        'FREQ=DAILY;BYMONTH=3,6',
      );
    });
  });

  describe('weekdayAnnotations', () => {
    it('marks nth ordinals per weekday (MO=0 … SU=6)', () => {
      const a = weekdayAnnotations(rruleToFormModel('FREQ=MONTHLY;BYDAY=2MO,4SU', REF));
      expect(a.get(0)?.nth).toEqual(['2']); // MO
      expect(a.get(6)?.nth).toEqual(['4']); // SU
      expect(a.get(0)?.selected).toBe(false);
    });
    it('marks the last ordinal as L', () => {
      const a = weekdayAnnotations(rruleToFormModel('FREQ=MONTHLY;BYDAY=-1FR', REF));
      expect(a.get(4)?.nth).toEqual(['L']); // FR
    });
    it('marks selected days for monthly weekday set', () => {
      const a = weekdayAnnotations(rruleToFormModel('FREQ=MONTHLY;BYDAY=MO,WE', REF));
      expect(a.get(0)?.selected).toBe(true); // MO
      expect(a.get(2)?.selected).toBe(true); // WE
      expect(a.get(0)?.nth).toEqual([]);
    });
    it('marks in-months days for yearly weekday set', () => {
      const a = weekdayAnnotations(
        rruleToFormModel('FREQ=YEARLY;BYMONTH=6;BYDAY=SA', REF),
      );
      expect(a.get(5)?.inMonths).toBe(true); // SA
    });
  });
});
