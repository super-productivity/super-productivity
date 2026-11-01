import { stringToMs } from './string-to-ms.pipe';

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
    const AllowedPatterns = [
      // Allow any number with h, m units, or combinations like "2h 30m"
      /(^\d+h(?:\s*\d+m)?$)|(^\d+m$)|(^\d+h$)/i,

      // Allow fractional hours with or without h specifier
      /^\d*[.,]\d+h?$/i,

      // Allow integer numbers without specifier (treated as minutes; fractional treated as hours)
      /^\d+$/,

      // Allow full duration as hh:mm or h:mm
      /^(\d{1,2}):(\d{2})$/,
    ];

    if (isAllowSeconds) {
      AllowedPatterns.push(
        // Allow combinations like "2h 30m 45s"
        /(^\d+h(?:\s*\d+m)?(?:\s*\d+s)?$)|(^\d+m(?:\s*\d+s)?$)|(^\d+s$)/i,
      );
    }

    // If input is not a valid duration string
    if (!AllowedPatterns.some((pattern) => pattern.test(strVal.trim()))) {
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
