import { Logger } from '../logger';

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Parse a positive-integer env var with strict validation and an optional
 * upper bound. Trailing garbage ("5000abc"), separators ("5,000"), floats,
 * or negative values are rejected and the caller's `fallback` is used.
 *
 * `maxValue`, when set, clamps the parsed value — this is the difference
 * between "operator misconfigured the knob" (warn + fallback) and "operator
 * picked an unreasonably large value" (warn + clamp).
 */
export const parsePositiveIntegerEnv = (
  name: string,
  fallback: number,
  maxValue?: number,
): number => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return fallback;

  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    Logger.warn(`Invalid ${name}="${rawValue}". Falling back to ${fallback}.`);
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    Logger.warn(`Invalid ${name}="${rawValue}". Falling back to ${fallback}.`);
    return fallback;
  }

  if (maxValue !== undefined && parsed > maxValue) {
    Logger.warn(
      `${name}=${parsed} exceeds maximum ${maxValue}. Clamping to ${maxValue}.`,
    );
    return maxValue;
  }

  return parsed;
};
