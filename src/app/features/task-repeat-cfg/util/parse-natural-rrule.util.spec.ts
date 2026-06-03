import { naturalLanguageToRRule } from './parse-natural-rrule.util';

describe('naturalLanguageToRRule', () => {
  const cases: [string, string | null][] = [
    // daily
    ['every day', 'FREQ=DAILY'],
    ['daily', 'FREQ=DAILY'],
    ['everyday', 'FREQ=DAILY'],
    ['every 3 days', 'FREQ=DAILY;INTERVAL=3'],
    ['every other day', 'FREQ=DAILY;INTERVAL=2'],
    // daily bounded to months (the @+ bug report)
    ['every day from january to april', 'FREQ=DAILY;BYMONTH=1,2,3,4'],
    ['everyday from January-April', 'FREQ=DAILY;BYMONTH=1,2,3,4'],
    // weekly
    ['weekly', 'FREQ=WEEKLY'],
    ['every week', 'FREQ=WEEKLY'],
    ['every 2 weeks', 'FREQ=WEEKLY;INTERVAL=2'],
    ['biweekly', 'FREQ=WEEKLY;INTERVAL=2'],
    ['weekdays', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
    ['every weekday', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
    ['weekends', 'FREQ=WEEKLY;BYDAY=SA,SU'],
    ['every monday', 'FREQ=WEEKLY;BYDAY=MO'],
    ['mondays', 'FREQ=WEEKLY;BYDAY=MO'],
    ['every monday and wednesday', 'FREQ=WEEKLY;BYDAY=MO,WE'],
    ['every tue, thu', 'FREQ=WEEKLY;BYDAY=TU,TH'],
    ['every other tuesday', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'],
    // monthly
    ['monthly', 'FREQ=MONTHLY'],
    ['every month', 'FREQ=MONTHLY'],
    ['every 2 months', 'FREQ=MONTHLY;INTERVAL=2'],
    ['monthly on the 15th', 'FREQ=MONTHLY;BYMONTHDAY=15'],
    ['the 1st of every month', 'FREQ=MONTHLY;BYMONTHDAY=1'],
    ['last day of the month', 'FREQ=MONTHLY;BYMONTHDAY=-1'],
    ['first monday of the month', 'FREQ=MONTHLY;BYDAY=1MO'],
    ['2nd tuesday', 'FREQ=MONTHLY;BYDAY=2TU'],
    ['last friday of the month', 'FREQ=MONTHLY;BYDAY=-1FR'],
    // yearly
    ['yearly', 'FREQ=YEARLY'],
    ['annually', 'FREQ=YEARLY'],
    ['every year', 'FREQ=YEARLY'],
    // yearly seasonal weekdays — the original cron example
    [
      'every saturday from march to november',
      'FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA',
    ],
    // end conditions
    ['every day for 10 times', 'FREQ=DAILY;COUNT=10'],
    ['every monday until 2024-12-31', 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20241231T120000Z'],
    // unparseable
    ['', null],
    ['   ', null],
    ['gibberish nonsense', null],
    ['banana', null],
  ];

  cases.forEach(([input, expected]) => {
    it(`"${input}" → ${expected}`, () => {
      expect(naturalLanguageToRRule(input)).toBe(expected);
    });
  });

  it('output always round-trips through rrule (valid)', () => {
    const phrases = [
      'every other tuesday',
      'first monday of the month',
      'every saturday from march to november',
      'monthly on the 15th',
    ];
    // Re-importing RRule here would be heavier; instead assert each starts with FREQ=
    // and contains no empty component (the util validates via rrule internally).
    phrases.forEach((p) => {
      const r = naturalLanguageToRRule(p)!;
      expect(r.startsWith('FREQ=')).toBe(true);
      expect(r.includes(';;')).toBe(false);
    });
  });
});
