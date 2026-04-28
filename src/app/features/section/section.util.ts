import { Section } from './section.model';

export const MAX_SECTION_TITLE_LENGTH = 200;

/**
 * Authoritative title normalizer. Applied in the reducer so it survives
 * remote sync replay — a peer cannot bypass the cap by talking directly
 * to the op-log. Non-string input (a malformed peer payload with
 * `null`, `undefined`, a Symbol, or an object with a malicious
 * `toString`) returns `''` rather than throwing or materializing a
 * giant intermediate string.
 */
export const sanitizeSectionTitle = (title: unknown): string =>
  typeof title === 'string' ? title.trim().slice(0, MAX_SECTION_TITLE_LENGTH) : '';

/**
 * `true` when `changes` carries an own `title` property (regardless of
 * value type). Use this — not `typeof changes.title === 'string'` — to
 * distinguish "title was intentionally set" from "title is absent",
 * because the value may be `null` from a malformed remote op.
 *
 * `Object.hasOwn` is preferred over `'title' in changes` so a peer
 * payload with a prototype-defined `title` cannot trigger sanitization
 * on a key the entity doesn't actually carry.
 */
export const hasTitleChange = (changes: Partial<Section>): boolean =>
  Object.hasOwn(changes, 'title');
