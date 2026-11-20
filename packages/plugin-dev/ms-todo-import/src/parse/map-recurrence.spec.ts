import { describeRecurrence, mapRecurrence } from './map-recurrence';

// 2026-12-01 is a Tuesday, the first Tuesday of December.
const START = '2026-12-01';

describe('mapRecurrence', () => {
  it.each([
    ['daily', { type: 'daily', interval: 1 }, { quickSetting: 'DAILY' }],
    [
      'every 3 days',
      { type: 'daily', interval: 3 },
      { quickSetting: 'CUSTOM', repeatCycle: 'DAILY', repeatEvery: 3 },
    ],
    [
      'weekdays',
      {
        type: 'weekly',
        interval: 1,
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      },
      { quickSetting: 'MONDAY_TO_FRIDAY' },
    ],
    [
      'weekly on the due weekday',
      { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      { quickSetting: 'WEEKLY_CURRENT_WEEKDAY' },
    ],
    [
      'every 2 weeks on mon and fri',
      { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'friday'] },
      {
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        monday: true,
        friday: true,
      },
    ],
    [
      'monthly on the due day',
      { type: 'absoluteMonthly', interval: 1, dayOfMonth: 1 },
      { quickSetting: 'MONTHLY_CURRENT_DATE' },
    ],
    [
      'every 3 months on the due day',
      { type: 'absoluteMonthly', interval: 3, dayOfMonth: 1 },
      { quickSetting: 'CUSTOM', repeatCycle: 'MONTHLY', repeatEvery: 3 },
    ],
    [
      'yearly on the due date',
      { type: 'absoluteYearly', interval: 1, dayOfMonth: 1, month: 12 },
      { quickSetting: 'YEARLY_CURRENT_DATE' },
    ],
    [
      'first tuesday of the month',
      { type: 'relativeMonthly', interval: 1, index: 'first', daysOfWeek: ['tuesday'] },
      { quickSetting: 'MONTHLY_NTH_WEEKDAY' },
    ],
  ])('maps %s', (_name, pattern, expected) => {
    expect(mapRecurrence({ pattern, range: { type: 'noEnd' } }, START)).toEqual(expected);
  });

  it('maps the full shape Graph actually returns (zero-filled fields, placeholder end)', () => {
    // captured from a real account: unused fields are 0 / [] and noEnd still
    // carries endDate 0001-01-01 and a startDate older than the due day
    const range = {
      type: 'noEnd',
      startDate: '2024-03-05',
      endDate: '0001-01-01',
      numberOfOccurrences: 0,
      recurrenceTimeZone: 'UTC',
    };
    const zeroed = { dayOfMonth: 0, month: 0, index: 'first', firstDayOfWeek: 'sunday' };
    expect(
      mapRecurrence(
        {
          pattern: { ...zeroed, type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
          range,
        },
        START,
      ),
    ).toEqual({ quickSetting: 'WEEKLY_CURRENT_WEEKDAY' });
    expect(
      mapRecurrence(
        {
          pattern: {
            ...zeroed,
            type: 'absoluteMonthly',
            interval: 1,
            dayOfMonth: 1,
            daysOfWeek: [],
          },
          range,
        },
        START,
      ),
    ).toEqual({ quickSetting: 'MONTHLY_CURRENT_DATE' });
  });

  it.each([
    ['a monthly day other than the due day', { type: 'absoluteMonthly', dayOfMonth: 15 }],
    [
      'a yearly date other than the due date',
      { type: 'absoluteYearly', dayOfMonth: 1, month: 6 },
    ],
    [
      'the last weekday of the month',
      { type: 'relativeMonthly', index: 'last', daysOfWeek: ['tuesday'] },
    ],
    ['an unknown pattern type', { type: 'hourly' }],
    ['a zero interval', { type: 'daily', interval: 0 }],
    ['a weekly rule without days', { type: 'weekly', daysOfWeek: [] }],
  ])('rejects %s', (_name, pattern) => {
    expect(mapRecurrence({ pattern }, START)).toBeNull();
  });

  it('keeps an end date as the last repeat day', () => {
    expect(
      mapRecurrence(
        {
          pattern: { type: 'daily', interval: 1 },
          range: { type: 'endDate', endDate: '2027-01-31' },
        },
        START,
      ),
    ).toEqual({ quickSetting: 'DAILY', repeatUntilDay: '2027-01-31' });
  });

  it('rejects a fixed number of occurrences and an end before the start', () => {
    const pattern = { type: 'daily', interval: 1 };
    expect(
      mapRecurrence(
        { pattern, range: { type: 'numbered', numberOfOccurrences: 5 } },
        START,
      ),
    ).toBeNull();
    expect(
      mapRecurrence(
        { pattern, range: { type: 'endDate', endDate: '2026-11-30' } },
        START,
      ),
    ).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('describes weekly, monthly and relative rules in plain English', () => {
    expect(
      describeRecurrence({
        pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'friday'] },
        range: { type: 'endDate', endDate: '2027-01-31' },
      }),
    ).toBe('every 2 weeks on monday, friday until 2027-01-31');
    expect(
      describeRecurrence({
        pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 },
      }),
    ).toBe('every month on day 15');
    expect(
      describeRecurrence({
        pattern: {
          type: 'relativeMonthly',
          interval: 1,
          index: 'last',
          daysOfWeek: ['friday'],
        },
        range: { type: 'numbered', numberOfOccurrences: 4 },
      }),
    ).toBe('every month on the last friday 4 times');
  });
});
