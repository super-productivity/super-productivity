const MINUTES_PER_HOUR = 60;
const minutesFromHours = 23 * MINUTES_PER_HOUR;
const MAX_MINUTES_IN_DAY = minutesFromHours + 59;

export const parseStartOfNextDayTimeToMinutes = (time: string | number): number => {
  if (typeof time === 'number') {
    return time * MINUTES_PER_HOUR;
  }

  const [hourStr = '0', minuteStr = '0'] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;

  const totalSafeMinutes = safeHour * MINUTES_PER_HOUR;
  return totalSafeMinutes + safeMinute;
};

export const clampStartOfNextDayMinutes = (minutes: number): number =>
  Math.max(0, Math.min(MAX_MINUTES_IN_DAY, minutes));

export const getStartOfNextDayHourFromTimeString = (
  startOfNextDayTime: string,
): number | undefined => {
  const [hourStr, minuteStr] = startOfNextDayTime.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr ?? '0');

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return undefined;
  }

  const minutesFromHour = hour * MINUTES_PER_HOUR;
  const totalMinutes = minutesFromHour + minute;

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

  if (typeof startOfNextDay === 'number') {
    const hour = Math.max(0, Math.min(23, startOfNextDay));
    return hour * MINUTES_PER_HOUR * 60 * 1000;
  }

  return 0;
};
