import { RoundTimeOption } from './round-time-option.model';

// Simple Duration interface to replace moment.Duration
export interface SimpleDuration {
  asMilliseconds(): number;
}

export const roundDuration = (
  val: SimpleDuration | number,
  roundTo: RoundTimeOption,
  isRoundUp: boolean = false,
): SimpleDuration => {
  const value = typeof val === 'number' ? val : val.asMilliseconds();
  const roundedMs = roundDurationVanilla(value, roundTo, isRoundUp);
  return {
    asMilliseconds: () => roundedMs,
  };
};

export const roundMinutes = (
  minutes: number,
  factor: number,
  isRoundUp: boolean,
): number => {
  return isRoundUp
    ? Math.ceil(minutes / factor) * factor
    : Math.round(minutes / factor) * factor;
};

export const roundDurationVanilla = (
  val: number,
  roundTo: RoundTimeOption,
  isRoundUp: boolean = false,
): number => {
  const asMinutes = parseMsToMinutes(val);
  const A_MINUTE = 60000;

  switch (roundTo) {
    case '5M':
      return roundMinutes(asMinutes, 5, isRoundUp) * A_MINUTE;

    case 'QUARTER':
      return roundMinutes(asMinutes, 15, isRoundUp) * A_MINUTE;

    case 'HALF':
      return roundMinutes(asMinutes, 30, isRoundUp) * A_MINUTE;

    case 'HOUR':
      return roundMinutes(asMinutes, 60, isRoundUp) * A_MINUTE;

    default:
      return val;
  }
};

export const parseMsToMinutes = (ms: number = 0): number => {
  return Math.round(ms / 60000);
};
