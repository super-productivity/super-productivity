import { Pipe, PipeTransform } from '@angular/core';

type DurationInput =
  | number
  | string
  | { asMilliseconds(): number }
  | { _milliseconds: number }
  | {
      _data: {
        milliseconds?: number;
        seconds?: number;
        minutes?: number;
        hours?: number;
        days?: number;
      };
    }
  | null
  | undefined;

@Pipe({ name: 'durationToString' })
export class DurationToStringPipe implements PipeTransform {
  transform: (value: DurationInput, ...args: unknown[]) => string = durationToString;
}

/* eslint-disable no-mixed-operators */
export const durationToString = (value: DurationInput, args?: unknown): string => {
  if (!value) {
    return '';
  }

  let milliseconds = 0;

  // Handle number (milliseconds)
  if (typeof value === 'number') {
    milliseconds = value;
  }
  // Handle SimpleDuration object with asMilliseconds method
  else if (
    typeof value === 'object' &&
    value !== null &&
    'asMilliseconds' in value &&
    typeof value.asMilliseconds === 'function'
  ) {
    milliseconds = value.asMilliseconds();
  }
  // Handle object with _milliseconds property (moment-like)
  else if (typeof value === 'object' && value !== null && '_milliseconds' in value) {
    milliseconds = (value as { _milliseconds: number })._milliseconds;
  }
  // Handle object with _data property (moment duration internal structure)
  else if (typeof value === 'object' && value !== null && '_data' in value) {
    const dd = (
      value as {
        _data: {
          milliseconds?: number;
          seconds?: number;
          minutes?: number;
          hours?: number;
          days?: number;
        };
      }
    )._data;
    milliseconds =
      (dd.milliseconds || 0) +
      (dd.seconds || 0) * 1000 +
      (dd.minutes || 0) * 60 * 1000 +
      (dd.hours || 0) * 60 * 60 * 1000 +
      (dd.days || 0) * 24 * 60 * 60 * 1000;
  }
  // Handle ISO 8601 duration string
  else if (typeof value === 'string') {
    // Basic ISO 8601 duration parsing
    const match = value.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      const days = parseInt(match[1], 10) || 0;
      const hours = parseInt(match[2], 10) || 0;
      const minutes = parseInt(match[3], 10) || 0;
      const seconds = parseInt(match[4], 10) || 0;
      milliseconds =
        seconds * 1000 +
        minutes * 60 * 1000 +
        hours * 60 * 60 * 1000 +
        days * 24 * 60 * 60 * 1000;
    } else {
      return '';
    }
  } else {
    return '';
  }

  if (milliseconds <= 0) {
    return '';
  }

  // Convert milliseconds to readable format
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  let result = '';
  if (days > 0) result += days + 'd ';
  if (hours > 0) result += hours + 'h ';
  if (minutes > 0) result += minutes + 'm ';
  if (seconds > 0) result += seconds + 's ';

  return result.trim();
};
/* eslint-enable no-mixed-operators */
