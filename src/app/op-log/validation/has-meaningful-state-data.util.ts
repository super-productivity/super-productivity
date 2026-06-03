import { INBOX_PROJECT } from '../../features/project/project.const';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';

const isEntityState = (obj: unknown): obj is { ids: string[] } =>
  typeof obj === 'object' &&
  obj !== null &&
  'ids' in obj &&
  Array.isArray((obj as { ids: unknown }).ids);

/**
 * Returns true if the given (partial) app state contains user-created data worth
 * protecting: at least one task, a non-INBOX project, a non-system tag, or a note.
 *
 * The default/initial app state (empty task list, only the INBOX project and the
 * built-in system tags) returns false. This is the single source of truth for the
 * "does this state actually have user data?" question, reused by:
 * - SyncLocalStateService (first-time-sync conflict detection)
 * - the snapshot/compaction empty-overwrite guard (prevents a transient degraded
 *   NgRx state from being cached over a good snapshot — see issue #7892).
 *
 * Scope is intentionally narrow (these four collections only) and is always consumed
 * in the "safe" direction: a false negative merely SKIPS work (a snapshot save, a
 * compaction, or a fresh-client sync prompt) — it can never cache empty-over-good or
 * delete data. Omitting models like simpleCounter / taskRepeatCfg / timeTracking
 * therefore cannot lose data; it would only forgo the snapshot/compaction optimization
 * for a data-less-but-active store, so it is left out of this safety fix by design.
 *
 * Accepts an arbitrary object so callers can pass an NgRx snapshot, a loaded
 * state cache, or a remote payload without type juggling.
 */
export const hasMeaningfulStateData = (state: unknown): boolean => {
  if (!state || typeof state !== 'object') {
    return false;
  }
  const s = state as Record<string, unknown>;

  if (isEntityState(s.task) && s.task.ids.length > 0) {
    return true;
  }

  if (isEntityState(s.project) && s.project.ids.some((id) => id !== INBOX_PROJECT.id)) {
    return true;
  }

  if (isEntityState(s.tag) && s.tag.ids.some((id) => !SYSTEM_TAG_IDS.has(id))) {
    return true;
  }

  if (isEntityState(s.note) && s.note.ids.length > 0) {
    return true;
  }

  return false;
};
