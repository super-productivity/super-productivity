import { normalizeDurationString, stringToMs } from './string-to-ms.pipe';

// A whole or decimal number: "2", "1.5", ".5"
const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;

export interface ProcessDurationInputResult {
  isValid: boolean;
  milliseconds: number | null;
  shouldUpdate: boolean;
}

export const processDurationInput = (
  strVal: string,
  isAllowSeconds: boolean = false,
  previousMsValue?: number | null,
): ProcessDurationInputResult => {
  try {
    // "1 hour 30 minutes", "1 h 30 m" and "1,5h 2,5m" are checked in the
    // short form ("1h 30m", "1.5h 2.5m") that stringToMs parses.
    const normalized = normalizeDurationString(strVal).trim();
    const AllowedPatterns = [
      // Allow any number with h, m units, or combinations like "2h 30m" or "1.5h 2.5m"
      new RegExp(`(^${NUM}h(?:\\s*${NUM}m)?$)|(^${NUM}m$)`, 'i'),

      // Allow fractional hours with or without h specifier
      /^\d*[.,]\d+h?$/i,

      // Allow integer numbers without specifier (treated as hours if <= 8 or fractional, else as minutes)
      /^\d+$/,

      // Allow full duration as hh:mm or h:mm
      /^(\d{1,2}):(\d{2})$/,
    ];

    if (isAllowSeconds) {
      AllowedPatterns.push(
        // Allow combinations like "2h 30m 45s"
        new RegExp(
          `(^${NUM}h(?:\\s*${NUM}m)?(?:\\s*${NUM}s)?$)|(^${NUM}m(?:\\s*${NUM}s)?$)|(^${NUM}s$)`,
          'i',
        ),
      );
    }

    // If input is not a valid duration string
    if (!AllowedPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        isValid: false,
        milliseconds: null,
        shouldUpdate: false,
      };
    }

    // Convert input string to milliseconds
    const ms = strVal ? stringToMs(strVal) : 0;

    return {
      isValid: true,
      milliseconds: ms,
      shouldUpdate: true,
    };
  } catch (err) {
    return {
      isValid: false,
      milliseconds: null,
      shouldUpdate: true,
    };
  }
};
