import { Pipe, PipeTransform } from '@angular/core';

/**
 * Rewrites a duration typed by the user into the short form the parsers
 * understand: commas become decimal points ("1,5h" → "1.5h"), a space between
 * a number and its unit is dropped ("45 m", "1 h 30 m") and spelled-out units
 * are shortened ("30 min", "2 hours", "1hr" → "30m", "2h", "1h").
 */
export const normalizeDurationString = (strValue: string): string =>
  strValue
    .replace(/,/g, '.')
    .replace(/(\d)\s+(?=(?:[hms]|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b)/gi, '$1')
    .replace(/(\d)(?:hours?|hrs?)\b/gi, '$1h')
    .replace(/(\d)(?:minutes?|mins?)\b/gi, '$1m')
    .replace(/(\d)(?:seconds?|secs?)\b/gi, '$1s');

export const stringToMs = (strValue: string, args?: unknown): number => {
  if (!strValue) {
    return 0;
  }

  strValue = normalizeDurationString(strValue);

  // First try to parse simple formats like "1.5h", "30m", etc.
  // also accept (fractional) numbers without specifier
  const simpleFormatMatch = strValue.trim().match(/^(\d*\.?\d+)([smh]?)$/);
  if (simpleFormatMatch) {
    const amount = parseFloat(simpleFormatMatch[1]);
    const unit = simpleFormatMatch[2].toLowerCase();

    switch (unit) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 1000 * 60;
      case 'h':
        return amount * 1000 * 60 * 60;
      case '':
        if (simpleFormatMatch[1].includes('.') || amount <= 8) {
          // treat all fractional values and integers <= 8 as hours
          return amount * 1000 * 60 * 60;
        } else {
          // treat integers > 8 as minutes
          return amount * 1000 * 60;
        }
    }
  }

  // Parse full time strings like "hh:mm" or "h:mm"
  const fullStringMatch = strValue.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (fullStringMatch) {
    const hours = parseFloat(fullStringMatch[1]);
    const minutes = parseFloat(fullStringMatch[2]);
    // eslint-disable-next-line no-mixed-operators
    return hours * 60 * 60 * 1000 + minutes * 60 * 1000;
  }

  // complex patterns
  let h: number | undefined;
  let m: number | undefined;
  let s: number | undefined;
  let previousLastChar: string | undefined;

  // Add spaces after letters to ease further splitting.
  strValue = strValue.replace(/([a-zA-Z]+)\s*/g, '$1 ');

  const arrValue = strValue.trim().split(' ');

  arrValue.forEach((val: string) => {
    if (val.length > 0) {
      const lastChar = val.slice(-1).toLowerCase();
      const amount = parseFloat(val);

      if (lastChar === 's') {
        s = amount;
      } else if (lastChar === 'm') {
        m = amount;
      } else if (lastChar === 'h') {
        h = amount;
      } else {
        if (previousLastChar === 's') {
          // Don't track milliseconds.
        } else if (previousLastChar === 'm') {
          s = amount;
        } else if (previousLastChar === 'h') {
          m = amount;
        }
      }
      previousLastChar = lastChar;
    }
  });

  if (typeof s === 'number' || typeof m === 'number' || typeof h === 'number') {
    s = typeof s === 'number' && !isNaN(s) ? s : 0;
    m = typeof m === 'number' && !isNaN(m) ? m : 0;
    h = typeof h === 'number' && !isNaN(h) ? h : 0;

    // prettier-ignore
    return +(s * 1000)
      + (m * 1000 * 60)
      + (h * 1000 * 60 * 60);
  } else {
    return 0;
  }
};

@Pipe({ name: 'stringToMs' })
export class StringToMsPipe implements PipeTransform {
  transform: (value: string, ...args: unknown[]) => number = stringToMs;
}
