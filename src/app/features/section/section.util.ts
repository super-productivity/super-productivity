import { WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';
import { Section } from './section.model';

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

/**
 * Splits a context's main-list tasks by section the way the work view renders
 * them: tasks in no section first, then each section's tasks. Shared with the
 * Android widget so both list the same order.
 */
export const groupTasksBySection = <T extends { id: string }>(
  tasks: T[],
  sections: readonly Section[],
): { dict: Record<string, T[]>; noSection: T[] } => {
  if (!sections.length) {
    return { dict: {}, noSection: tasks };
  }

  // section.taskIds is authoritative for in-section order — drag-drop
  // reorders go through addTaskToSection's reducer. Walking sections
  // first (rather than tasks first) lets us respect that order while
  // staying defensive against stale ids and tasks that aren't yet in
  // any section.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const dict: Record<string, T[]> = {};
  const inSection = new Set<string>();
  for (const s of sections) {
    const list: T[] = [];
    for (const tId of s.taskIds ?? []) {
      const t = taskById.get(tId);
      if (t) {
        list.push(t);
        inSection.add(tId);
      }
    }
    dict[s.id] = list;
  }
  const noSection = tasks.filter((t) => !inSection.has(t.id));

  return { dict, noSection };
};
