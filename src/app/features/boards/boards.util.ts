import { BoardPanelCfg, BoardSortField } from './boards.model';
import { TaskCopy } from '../tasks/task.model';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

const VALID_SORT_FIELDS: ReadonlySet<BoardSortField> = new Set([
  'dueDate',
  'created',
  'title',
  'timeEstimate',
]);

/**
 * Normalizes a panel cfg for persistence and hydration:
 * - Migrates legacy `sortByDue` → `sortBy`/`sortDir`.
 * - Coerces `null` values (from Formly) on optional string-union fields to absent.
 * - Drops unknown `sortBy` values (e.g. from a newer client synced down).
 * Idempotent.
 */
export const sanitizePanelCfg = (panel: BoardPanelCfg): BoardPanelCfg => {
  const out: BoardPanelCfg = { ...panel };

  if (out.sortByDue === 'asc' || out.sortByDue === 'desc') {
    out.sortBy = 'dueDate';
    out.sortDir = out.sortByDue;
  }
  delete (out as Partial<BoardPanelCfg>).sortByDue;

  // Drop `sortBy` if null/undefined OR unknown value — prevents buildComparator
  // from getting an unhandled field and returning undefined at runtime.
  if (out.sortBy == null || !VALID_SORT_FIELDS.has(out.sortBy)) {
    delete (out as Partial<BoardPanelCfg>).sortBy;
  }
  if (out.sortDir == null) {
    delete (out as Partial<BoardPanelCfg>).sortDir;
  }
  if (out.includedTagsMatch == null) {
    delete (out as Partial<BoardPanelCfg>).includedTagsMatch;
  }
  if (out.excludedTagsMatch == null) {
    delete (out as Partial<BoardPanelCfg>).excludedTagsMatch;
  }

  return out;
};

/**
 * Normalize a task's due moment to a comparable millisecond timestamp, or null
 * if undated. Timezone-safe: uses `dateStrToUtcDate` for YYYY-MM-DD strings,
 * matching task.selectors.ts.
 */
const getDueTs = (task: TaskCopy): number | null => {
  if (task.dueWithTime) return task.dueWithTime;
  if (task.dueDay) {
    return dateStrToUtcDate(task.dueDay).getTime();
  }
  return null;
};

const NO_OP_COMPARATOR = (): number => 0;

/**
 * Rewrite a task's tagIds so it will match the given panel's include/exclude
 * filter after a cross-panel drop. Pure function — never mutates inputs.
 *
 * Semantics (matches the panel-filter rules):
 * - Included tags:
 *   - Default ('all'): append every required tag (caller de-dupes if needed).
 *   - 'any': append the FIRST required tag only when the task has none of them.
 * - Excluded tags:
 *   - Default ('any'): strip ALL excluded tags the task carries.
 *   - 'all': strip only the FIRST excluded tag when the task has ALL excluded
 *     tags (breaks the AND-exclude condition without over-removing).
 *
 * Duplicates are not de-duplicated here; callers that care should pass the
 * result through `unique()`.
 */
export const rewriteTagIdsForPanel = (
  currentTagIds: readonly string[],
  panelCfg: Pick<
    BoardPanelCfg,
    'includedTagIds' | 'includedTagsMatch' | 'excludedTagIds' | 'excludedTagsMatch'
  >,
): string[] => {
  let next: string[] = [...currentTagIds];

  if (panelCfg.includedTagIds?.length) {
    if (panelCfg.includedTagsMatch === 'any') {
      const hasAny = panelCfg.includedTagIds.some((id) => next.includes(id));
      if (!hasAny) {
        next = next.concat(panelCfg.includedTagIds[0]);
      }
    } else {
      next = next.concat(panelCfg.includedTagIds);
    }
  }

  if (panelCfg.excludedTagIds?.length) {
    if (panelCfg.excludedTagsMatch === 'all') {
      const hasAll = panelCfg.excludedTagIds.every((id) => next.includes(id));
      if (hasAll) {
        const firstExcluded = panelCfg.excludedTagIds[0];
        next = next.filter((id) => id !== firstExcluded);
      }
    } else {
      const excluded = panelCfg.excludedTagIds;
      next = next.filter((id) => !excluded.includes(id));
    }
  }

  return next;
};

/**
 * Returns an ascending comparator for the given field. Callers multiply by -1
 * for descending. Returns a no-op comparator for unknown fields, so an invalid
 * persisted `sortBy` degrades to manual order instead of crashing the panel.
 */
export const buildComparator = (
  field: BoardSortField,
): ((a: TaskCopy, b: TaskCopy) => number) => {
  switch (field) {
    case 'title':
      return (a, b) => (a.title || '').localeCompare(b.title || '');
    case 'created':
      return (a, b) => (a.created || 0) - (b.created || 0);
    case 'timeEstimate':
      return (a, b) => (a.timeEstimate || 0) - (b.timeEstimate || 0);
    case 'dueDate':
      return (a, b) => {
        // Fast path: both have only dueDay (string) → lex compare (YYYY-MM-DD
        // is fixed-width, so < / > work and are faster than localeCompare).
        if (!a.dueWithTime && !b.dueWithTime && a.dueDay && b.dueDay) {
          return a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0;
        }
        const aTs = getDueTs(a);
        const bTs = getDueTs(b);
        if (aTs === null && bTs === null) return 0;
        // Nulls last in ascending order — caller reverses for descending.
        if (aTs === null) return 1;
        if (bTs === null) return -1;
        return aTs - bTs;
      };
    default:
      return NO_OP_COMPARATOR;
  }
};
