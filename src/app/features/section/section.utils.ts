export const MAX_SECTION_TITLE_LENGTH = 200;

/**
 * Authoritative title normalizer. Applied in the reducer so it survives
 * remote sync replay — a peer cannot ship a multi-MB title (or a non-
 * string `null` / `undefined` payload) that bypasses the cap by talking
 * directly to the op-log. Coerces non-string input to an empty string
 * rather than throwing, since the threat model includes malformed peer
 * payloads.
 */
export const sanitizeSectionTitle = (title: unknown): string =>
  String(title ?? '')
    .trim()
    .slice(0, MAX_SECTION_TITLE_LENGTH);
