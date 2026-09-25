import { INBOX_PROJECT } from '../../features/project/project.const';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';

const isEntityState = (obj: unknown): obj is { ids: string[] } =>
  typeof obj === 'object' &&
  obj !== null &&
  'ids' in obj &&
  Array.isArray((obj as { ids: unknown }).ids);

const isNonEmptyRecord = (obj: unknown): obj is Record<string, unknown> =>
  typeof obj === 'object' && obj !== null && Object.keys(obj).length > 0;

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
 * Scope is intentionally narrow (these four collections only). Most callers consume
 * it in the "safe" direction, where a false negative merely SKIPS work (a snapshot
 * save, a compaction) and can never cache empty-over-good. `hasNothingWorthUploading`
 * consumes it in the REFUSING direction (#9256), where a false POSITIVE is the
 * dangerous one — it would let a device holding nothing overwrite the server. Keep
 * this predicate narrow for that reason: widen {@link hasAnyUserData} instead, which
 * is scoped to the callers that need the wider notion.
 *
 * Accepts an arbitrary object so callers can pass an NgRx snapshot, a loaded
 * state cache, or a remote payload without type juggling.
 *
 * `ignoreTaskIds` (optional) lets a caller exclude specific task ids from the "has a
 * task?" check — used by the file-based sync conflict gate to treat a store containing
 * only onboarding example tasks as non-meaningful (#7985). It only ever NARROWS the
 * result; omitting it preserves the original behavior for every other caller (the
 * #7892 empty-overwrite guard, snapshot/compaction, first-time-sync detection).
 */
export const hasMeaningfulStateData = (
  state: unknown,
  ignoreTaskIds?: ReadonlySet<string>,
): boolean => {
  if (!state || typeof state !== 'object') {
    return false;
  }
  const s = state as Record<string, unknown>;

  if (isEntityState(s.task)) {
    const meaningfulTaskIds = ignoreTaskIds
      ? s.task.ids.filter((id) => !ignoreTaskIds.has(id))
      : s.task.ids;
    if (meaningfulTaskIds.length > 0) {
      return true;
    }
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

/** `{ project: { [ctxId]: { [date]: … } }, tag: { … } }` — any context with a tracked day. */
const hasTimeTrackingEntries = (timeTracking: unknown): boolean => {
  if (typeof timeTracking !== 'object' || timeTracking === null) {
    return false;
  }
  const { project, tag } = timeTracking as { project?: unknown; tag?: unknown };
  return [project, tag].some(
    (byContext) =>
      typeof byContext === 'object' &&
      byContext !== null &&
      Object.values(byContext).some(isNonEmptyRecord),
  );
};

/** `archiveYoung` / `archiveOld`: archived tasks or flushed time tracking. */
const hasArchiveData = (archive: unknown): boolean => {
  if (typeof archive !== 'object' || archive === null) {
    return false;
  }
  const a = archive as { task?: unknown; timeTracking?: unknown };
  return (
    (isEntityState(a.task) && a.task.ids.length > 0) ||
    hasTimeTrackingEntries(a.timeTracking)
  );
};

/**
 * {@link hasMeaningfulStateData} plus the collections a legacy-migrated client can
 * hold when it has no active task, project, tag or note at all: archived tasks and
 * their flushed time tracking, live time tracking, and task repeat configs (#9932).
 *
 * Only the join-time gate (`SyncLocalStateService.hasMeaningfulStoreData`) uses this.
 * An archive-only client failed the narrow check, so on an empty server nothing
 * seeded its state and a peer's later SYNC_IMPORT was applied over it silently; on
 * file-based providers the remote snapshot was hydrated without a dialog. Either way
 * the archive and worklog on that device were gone.
 *
 * That gate has two flavours: the no-arg fresh-client protections, and the #7985
 * file-based conflict gate which passes the pending example-task ids. The widened
 * dimensions are not narrowable by `ignoreTaskIds` (they carry no task id), but on
 * that second path any tracked time has already emitted a TIME_TRACKING op, which
 * the pending-op gate counts as meaningful before this is consulted.
 *
 * Deliberately kept OUT of `hasMeaningfulStateData` so it cannot leak into that
 * predicate's other consumers — most importantly `hasNothingWorthUploading` (#9256),
 * where saying "has data" too eagerly permits a destructive server overwrite. Time
 * tracked against onboarding example tasks is exactly such a false positive, and
 * `ignoreTaskIds` cannot discount it.
 *
 * Archives are only visible on an archive-inclusive snapshot; the synchronous store
 * snapshot substitutes an empty DEFAULT_ARCHIVE.
 *
 * Everything counted is strictly non-default, which keeps this a subset of
 * `hasServerMigrationStateData` (server-migration.service.ts) — its MODEL_CONFIGS
 * sweep covers all four of these keys — so a client this gate protects always has
 * something for the seeding to ship.
 *
 * Not counted: `simpleCounter` and the remaining non-entity slices. The default state
 * SHIPS three simple counters (DEFAULT_SIMPLE_COUNTERS), so a presence check would
 * call a brand-new install "meaningful" and revive the spurious conflict dialog
 * #7976/#7980 removed. Counting them needs a strictly-non-default test (e.g. a
 * counter with a non-empty countOnDay), not a presence test.
 */
export const hasAnyUserData = (
  state: unknown,
  ignoreTaskIds?: ReadonlySet<string>,
): boolean => {
  if (hasMeaningfulStateData(state, ignoreTaskIds)) {
    return true;
  }
  if (!state || typeof state !== 'object') {
    return false;
  }
  const s = state as Record<string, unknown>;

  if (isEntityState(s.taskRepeatCfg) && s.taskRepeatCfg.ids.length > 0) {
    return true;
  }

  return (
    hasTimeTrackingEntries(s.timeTracking) ||
    hasArchiveData(s.archiveYoung) ||
    hasArchiveData(s.archiveOld)
  );
};
