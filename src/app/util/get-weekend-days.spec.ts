import { getWeekendDays, isWeekendDay } from './get-weekend-days';

describe('getWeekendDays', () => {
  it('should return Saturday/Sunday for en-US', () => {
    expect(getWeekendDays('en-US')).toEqual([6, 7]);
  });

  it('should return Friday/Saturday for ar-EG when the platform exposes week info', () => {
    const l = new Intl.Locale('ar-EG') as unknown as {
      getWeekInfo?: () => unknown;
      weekInfo?: unknown;
    };
    if (!l.getWeekInfo && !l.weekInfo) {
      pending('Intl.Locale week info not supported in this browser');
      return;
    }
    expect(getWeekendDays('ar-EG')).toEqual([5, 6]);
  });

  it('should fall back to Saturday/Sunday for an invalid locale tag', () => {
    expect(getWeekendDays('not a locale')).toEqual([6, 7]);
  });
});

describe('isWeekendDay', () => {
  it('should map JS Sunday (0) to ISO 7', () => {
    const sunday = new Date(2026, 0, 25);
    const monday = new Date(2026, 0, 26);
    const saturday = new Date(2026, 0, 24);
    expect(isWeekendDay(sunday, [6, 7])).toBe(true);
    expect(isWeekendDay(saturday, [6, 7])).toBe(true);
    expect(isWeekendDay(monday, [6, 7])).toBe(false);
  });

  it('should respect a Friday/Saturday weekend', () => {
    const friday = new Date(2026, 0, 23);
    const sunday = new Date(2026, 0, 25);
    expect(isWeekendDay(friday, [5, 6])).toBe(true);
    expect(isWeekendDay(sunday, [5, 6])).toBe(false);
  });
});
