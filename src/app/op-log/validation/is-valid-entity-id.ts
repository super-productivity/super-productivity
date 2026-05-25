/**
 * Shared predicate for validating that an entity ID is a usable string.
 *
 * Rejects the string literals `'undefined'` and `'null'` because they indicate
 * an ID was toString'd from a missing value somewhere upstream, not a legitimate
 * identifier.
 */
export const isValidEntityId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value !== 'undefined' &&
  value !== 'null';
