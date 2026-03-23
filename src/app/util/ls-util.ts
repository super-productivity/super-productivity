/**
 * localStorage utility functions for Super Productivity
 */

/**
 * Check if a key exists in localStorage
 */
export const lsHasKey = (key: string): boolean => {
  return localStorage.getItem(key) !== null;
};

/**
 * Clear localStorage completely
 */
export const clearLS = (): void => {
  localStorage.clear();
};

/**
 * Get item from localStorage with default value
 */
export const lsGetItem = <T = string>(
  key: string,
  defaultValue?: T,
): T | string | null => {
  const item = localStorage.getItem(key);
  return item ?? defaultValue ?? null;
};

/**
 * Get item from localStorage and parse as number, with optional default
 */
export const lsGetNumber = (key: string, defaultValue = 0): number => {
  const item = localStorage.getItem(key);
  return item ? +item : defaultValue;
};

/**
 * Get item from localStorage and parse as boolean, with optional default
 */
export const lsGetBoolean = (key: string, defaultValue = false): boolean => {
  const item = localStorage.getItem(key);
  if (item === null) return defaultValue;
  return item === 'true';
};

/**
 * Get item from localStorage and parse as JSON, with optional default
 */
export function lsGetJSON<T>(key: string): T | null;
export function lsGetJSON<T>(key: string, defaultValue: T): T;
// We need to use function overloads here
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function lsGetJSON<T>(key: string, defaultValue?: T): T | null {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : (defaultValue ?? null);
  } catch {
    return defaultValue ?? null;
  }
}

/**
 * Set item in localStorage
 */
export const lsSetItem = (key: string, value: string | number | boolean): void => {
  localStorage.setItem(key, String(value));
};

/**
 * Set item in localStorage as JSON
 */
export const lsSetJSON = (key: string, value: unknown): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

/**
 * Remove item from localStorage
 */
export const lsRemoveItem = (key: string): void => {
  localStorage.removeItem(key);
};

/**
 * Remove multiple items from localStorage
 */
export const lsRemoveItems = (keys: string[]): void => {
  keys.forEach((key) => localStorage.removeItem(key));
};

/**
 * Get boolean value from localStorage with fallback
 */
export const readBoolLS = (key: string, fallback: boolean): boolean => {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === 'true';
};

/**
 * Get number from localStorage with bounds checking
 */
export const readNumberLSBounded = (
  key: string,
  min: number,
  max: number,
): number | null => {
  const v = localStorage.getItem(key);
  if (v == null) return null;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
};
