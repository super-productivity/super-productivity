/**
 * Deduplicates by reference/value identity, keeping the first occurrence.
 *
 * NOTE: `Set` uses SameValueZero, so `NaN` deduplicates here while the previous
 * `indexOf`-based implementation kept every `NaN`. Every call site passes string
 * id arrays, so this is a behaviour change nobody can observe — but a numeric
 * caller relying on the old quirk would be affected.
 */
export const unique = <T>(array: T[]): T[] => [...new Set(array)];
