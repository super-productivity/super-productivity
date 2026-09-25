import { RoundTimeOption } from './round-time-option.model';

export const roundTime = (
  val: number | Date,
  roundTo: RoundTimeOption,
  isRoundUp = false,
): Date => {
  const value = typeof val === 'number' ? new Date(val) : val;
  let rounded: number;

  switch (roundTo) {
    case 'QUARTER':
      rounded = Math.round(value.getMinutes() / 15) * 15;
      if (isRoundUp) {
        rounded = Math.ceil(value.getMinutes() / 15) * 15;
      }
      value.setMinutes(rounded, 0, 0);
      return value;
    case 'HALF':
      rounded = Math.round(value.getMinutes() / 30) * 30;
      if (isRoundUp) {
        rounded = Math.ceil(value.getMinutes() / 30) * 30;
      }
      value.setMinutes(rounded, 0, 0);
      return value;

    case 'HOUR':
      rounded = Math.round(value.getMinutes() / 60) * 60;
      if (isRoundUp) {
        rounded = Math.ceil(value.getMinutes() / 60) * 60;
      }
      value.setMinutes(rounded, 0, 0);
      return value;
    default:
      return value;
  }
};
