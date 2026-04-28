export const MAX_SECTION_TITLE_LENGTH = 200;

/**
 * Authoritative title normalizer. Applied in the reducer so it survives
 * remote sync replay — a peer cannot bypass the cap by talking directly
 * to the op-log. Non-string input (a malformed peer payload with
 * `null`, `undefined`, a Symbol, or an object with a malicious
 * `toString`) returns `''` rather than throwing.
 */
export const sanitizeSectionTitle = (title: unknown): string =>
  typeof title === 'string' ? title.trim().slice(0, MAX_SECTION_TITLE_LENGTH) : '';
