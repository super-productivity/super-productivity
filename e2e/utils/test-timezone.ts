/**
 * Keeps the E2E suite's wall clock far away from midnight.
 *
 * A day rollover mid-run silently breaks any date-sensitive spec: the TODAY_TAG
 * repair selector clears `taskIds` once `todayStr` moves on, tasks drop into the
 * "From previous days" panel, and ordering assertions fail for reasons that have
 * nothing to do with the change under test. Run 33808991574 hit exactly this —
 * a 21:38 UTC push ran the WebDAV suite straight through 00:00 Europe/Berlin.
 *
 * Day rollover itself is still worth testing, but from a dedicated spec that
 * seeds `dueDay` or moves `startOfNextDayDiff` — not by accident at 00:00 in CI.
 */

/**
 * Candidates are DST-free, so the offset cannot shift while tests run, and are
 * spaced at most 4h apart, so the picked zone always lands within 2h of midday.
 *
 * None of them is UTC itself, deliberately: at UTC+0 every local-vs-UTC
 * divergence collapses, so an off-by-one-day regression in `toISOString()` or
 * `dateStrToUtcDate` would pass silently (see
 * tests/recurring/skip-overdue-reaps-timed-instance.spec.ts, which exists
 * because the unit suites cannot catch that drift).
 */
const CANDIDATE_TIMEZONES = [
  'Pacific/Honolulu', // UTC-10
  'America/Regina', // UTC-6
  'America/Sao_Paulo', // UTC-3
  'Africa/Lagos', // UTC+1
  'Africa/Nairobi', // UTC+3
  'Asia/Dhaka', // UTC+6
  'Asia/Shanghai', // UTC+8
  'Pacific/Guadalcanal', // UTC+11
] as const;

const MIDDAY_HOUR = 12;

/** Local time in the given zone, as fractional hours since midnight. */
const localHourIn = (timeZone: string, now: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const partValue = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some ICU versions report midnight as hour 24 under hour12: false
  const hour = partValue('hour') % 24;
  const minuteFraction = partValue('minute') / 60;
  return hour + minuteFraction;
};

/**
 * Picks the candidate zone whose local time is closest to midday, leaving ~10h
 * of margin to the next day boundary regardless of when CI is triggered.
 *
 * Independent of `process.env.TZ` — every zone is resolved explicitly — so it is
 * safe to call before the suite's timezone has been set.
 */
export const pickTestTimezone = (now: Date = new Date()): string =>
  CANDIDATE_TIMEZONES.reduce((best, zone) =>
    Math.abs(localHourIn(zone, now) - MIDDAY_HOUR) <
    Math.abs(localHourIn(best, now) - MIDDAY_HOUR)
      ? zone
      : best,
  );
