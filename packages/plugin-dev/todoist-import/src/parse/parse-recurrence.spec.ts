import { parseTodoistRecurrence } from './parse-recurrence';

// 2026-10-13 is a Tuesday, the second Tuesday of October 2026
const TUE = '2026-10-13';

describe('parseTodoistRecurrence', () => {
  it.each([
    ['every day', { quickSetting: 'DAILY' }],
    ['daily', { quickSetting: 'DAILY' }],
    ['Every  Day', { quickSetting: 'DAILY' }],
    ['every week', { quickSetting: 'WEEKLY_CURRENT_WEEKDAY' }],
    ['every month', { quickSetting: 'MONTHLY_CURRENT_DATE' }],
    ['annually', { quickSetting: 'YEARLY_CURRENT_DATE' }],
    ['every weekday', { quickSetting: 'MONDAY_TO_FRIDAY' }],
    ['every workday', { quickSetting: 'MONDAY_TO_FRIDAY' }],
    ['every last day', { quickSetting: 'MONTHLY_LAST_DAY' }],
    ['every 2nd tuesday', { quickSetting: 'MONTHLY_NTH_WEEKDAY' }],
    ['every 13th', { quickSetting: 'MONTHLY_CURRENT_DATE' }],
    ['every oct 13', { quickSetting: 'YEARLY_CURRENT_DATE' }],
    ['every 13 october', { quickSetting: 'YEARLY_CURRENT_DATE' }],
  ])('maps "%s" to a preset', (rule, expected) => {
    expect(parseTodoistRecurrence(rule, TUE)).toEqual(expected);
  });

  it.each([
    ['every 3 days', { repeatCycle: 'DAILY', repeatEvery: 3 }],
    ['every other day', { repeatCycle: 'DAILY', repeatEvery: 2 }],
    ['every 2 weeks', { repeatCycle: 'WEEKLY', repeatEvery: 2, tuesday: true }],
    ['every 6 months', { repeatCycle: 'MONTHLY', repeatEvery: 6 }],
    ['every 2 years', { repeatCycle: 'YEARLY', repeatEvery: 2 }],
    [
      'every mon, wed and fri',
      {
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        monday: true,
        wednesday: true,
        friday: true,
      },
    ],
    ['every other thursday', { repeatCycle: 'WEEKLY', repeatEvery: 2, thursday: true }],
    [
      'every weekend',
      { repeatCycle: 'WEEKLY', repeatEvery: 1, saturday: true, sunday: true },
    ],
  ])('maps "%s" to a custom schedule', (rule, expected) => {
    expect(parseTodoistRecurrence(rule, TUE)).toEqual({
      quickSetting: 'CUSTOM',
      ...expected,
    });
  });

  it('counts "every!" rules from the completion day', () => {
    expect(parseTodoistRecurrence('every! 2 weeks', TUE)).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      repeatFromCompletionDate: true,
    });
    expect(parseTodoistRecurrence('every! monday', TUE)).toBeNull();
  });

  it('drops the time and start, and keeps the end day', () => {
    expect(parseTodoistRecurrence('every day at 9am', TUE)).toEqual({
      quickSetting: 'DAILY',
    });
    expect(parseTodoistRecurrence('every tue 18:30', TUE)).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'WEEKLY',
      repeatEvery: 1,
      tuesday: true,
    });
    expect(parseTodoistRecurrence('every day starting oct 13', TUE)).toEqual({
      quickSetting: 'DAILY',
    });
    expect(parseTodoistRecurrence('every day until 2027-01-31', TUE)).toEqual({
      quickSetting: 'DAILY',
      repeatUntilDay: '2027-01-31',
    });
    // without a year: the next such day
    expect(parseTodoistRecurrence('every week until mar 1', TUE)).toEqual({
      quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
      repeatUntilDay: '2027-03-01',
    });
    expect(parseTodoistRecurrence('every day until dec 31, 2026', TUE)).toEqual({
      quickSetting: 'DAILY',
      repeatUntilDay: '2026-12-31',
    });
  });

  it.each([
    'every hour',
    'every 3 hours',
    'every last friday',
    'every 3rd tuesday', // the date is the 2nd Tuesday
    'every 14th',
    'every jan 5',
    'every day until someday',
    'every day until 2026-10-01', // before the next date
    'every 0 days',
    'every 1001 days',
    'every constructor',
    'every toString 5',
    'jeden Tag',
    'tomorrow',
  ])('leaves "%s" unmapped', (rule) => {
    expect(parseTodoistRecurrence(rule, TUE)).toBeNull();
  });
});
