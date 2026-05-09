const MINUTES_PER_HOUR = 60;
const MAX_HOUR_MINUTES = 23 * MINUTES_PER_HOUR;
const MAX_MINUTES_IN_DAY = MAX_HOUR_MINUTES + 59;

export const parseStartOfNextDayTimeToMinutes = (time: string | number): number => {
  if (typeof time === 'number') {
    return Number.isFinite(time) ? time * MINUTES_PER_HOUR : 0;
  }

  const [hourStr = '0', minuteStr = '0'] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const safeHour = Number.isFinite(hour) ? hour : 0;
  // Clamp the minute component so malformed inputs like "05:99" don't roll
  // minutes into the hour bucket.
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0;

  const hoursInMinutes = safeHour * MINUTES_PER_HOUR;
  return hoursInMinutes + safeMinute;
};

export const clampStartOfNextDayMinutes = (minutes: number): number =>
  Math.max(0, Math.min(MAX_MINUTES_IN_DAY, minutes));

export const getStartOfNextDayHourFromTimeString = (
  startOfNextDayTime: string,
): number | undefined => {
  // Defensive: reducers that call this must stay pure. Sync/REST/plugin payloads
  // can bypass TS and hand in non-strings, which would throw on .split(':').
  if (typeof startOfNextDayTime !== 'string') {
    return undefined;
  }
  const [hourStr, minuteStr] = startOfNextDayTime.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr ?? '0');

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return undefined;
  }

  const safeMinute = Math.max(0, Math.min(59, minute));
  const minutesFromHour = hour * MINUTES_PER_HOUR;
  const totalMinutes = minutesFromHour + safeMinute;

  return Math.floor(clampStartOfNextDayMinutes(totalMinutes) / MINUTES_PER_HOUR);
};

export const getStartOfNextDayDiffMs = (
  startOfNextDayTime: string | undefined,
  startOfNextDay: number | undefined,
): number => {
  if (typeof startOfNextDayTime === 'string') {
    return (
      clampStartOfNextDayMinutes(parseStartOfNextDayTimeToMinutes(startOfNextDayTime)) *
      60 *
      1000
    );
  }

  if (typeof startOfNextDay === 'number' && Number.isFinite(startOfNextDay)) {
    const hour = Math.max(0, Math.min(23, startOfNextDay));
    return hour * MINUTES_PER_HOUR * 60 * 1000;
  }

  return 0;
};
