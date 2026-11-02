import { timingSafeEqual } from 'crypto';

/**
 * Constant-time buffer compare that is also safe on a length mismatch:
 * `timingSafeEqual` throws instead of returning false when the buffers
 * differ in length, and a bare length check up front would leak the length
 * of the secret through timing.
 */
export const timingSafeEqualLenient = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) {
    // Dummy comparison to mitigate timing attacks on length differences.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
};
