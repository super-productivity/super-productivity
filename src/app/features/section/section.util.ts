import { WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';

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

/**
 * Sections are scoped to projects and the singleton TODAY tag only.
 * Custom tags don't host sections — the cleanup overhead (cascading on
 * tag delete + tagIds update) outweighed the use case.
 */
export const isValidSectionContext = (
  contextId: string,
  contextType: WorkContextType,
): boolean =>
  contextType === WorkContextType.PROJECT ||
  (contextType === WorkContextType.TAG && contextId === TODAY_TAG.id);
