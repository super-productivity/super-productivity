const MINUTES_PER_HOUR = 60;
const MAX_HOUR_MINUTES = 23 * MINUTES_PER_HOUR;
const MAX_MINUTES_IN_DAY = MAX_HOUR_MINUTES + 59;
const START_OF_NEXT_DAY_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const getValidStartOfNextDayHour = (
  startOfNextDay: number | undefined,
): number | undefined => {
  if (
    typeof startOfNextDay !== 'number' ||
    !Number.isFinite(startOfNextDay) ||
    startOfNextDay < 0 ||
    startOfNextDay > 23
  ) {
    return undefined;
  }

  return Math.floor(startOfNextDay);
};

export const parseStartOfNextDayTimeToMinutes = (time: string | number): number => {
  if (typeof time === 'number') {
    const hour = getValidStartOfNextDayHour(time);
    return hour == null ? 0 : hour * MINUTES_PER_HOUR;
  }

  const match = START_OF_NEXT_DAY_TIME_RE.exec(time);
  if (!match) {
    return 0;
  }

  const [, hourStr, minuteStr] = match;
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const hoursInMinutes = hour * MINUTES_PER_HOUR;

  return hoursInMinutes + minute;
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
  if (!START_OF_NEXT_DAY_TIME_RE.test(startOfNextDayTime)) {
    return undefined;
  }

  return Math.floor(
    parseStartOfNextDayTimeToMinutes(startOfNextDayTime) / MINUTES_PER_HOUR,
  );
};

export const getStartOfNextDayDiffMs = (
  startOfNextDayTime: string | undefined,
  startOfNextDay: number | undefined,
): number => {
  if (
    typeof startOfNextDayTime === 'string' &&
    START_OF_NEXT_DAY_TIME_RE.test(startOfNextDayTime)
  ) {
    return (
      clampStartOfNextDayMinutes(parseStartOfNextDayTimeToMinutes(startOfNextDayTime)) *
      60 *
      1000
    );
  }

  const hour = getValidStartOfNextDayHour(startOfNextDay);
  if (hour != null) {
    return hour * MINUTES_PER_HOUR * 60 * 1000;
  }

  return 0;
};
