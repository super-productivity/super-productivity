import { INBOX_PROJECT } from '../../features/project/project.const';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';

const isEntityState = (obj: unknown): obj is { ids: string[] } =>
  typeof obj === 'object' &&
  obj !== null &&
  'ids' in obj &&
  Array.isArray((obj as { ids: unknown }).ids);

const isNonEmptyRecord = (obj: unknown): obj is Record<string, unknown> =>
  typeof obj === 'object' && obj !== null && Object.keys(obj).length > 0;

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
 * Returns true if the given (partial) app state contains user-created data worth
 * protecting: a task (active or archived), a non-INBOX project, a non-system tag,
 * a note, a task repeat config, or tracked time (live or archived). The default
 * app state returns false.
 *
 * Single source of truth for "does this state actually have user data?", used by:
 * - SyncLocalStateService — the fresh-client / genesis-client gate. A false
 *   negative here is NOT safe: the client adopts a peer's state over its own or
 *   its genesis state is never seeded. Archive-only / worklog-only legacy data
 *   was lost that way before archives and time tracking were counted (#9932).
 *   Archives are only visible on an archive-inclusive snapshot; the synchronous
 *   store snapshot substitutes an empty DEFAULT_ARCHIVE.
 * - the snapshot/compaction empty-overwrite guard (#7892) and the local-backup
 *   skip, where a false negative merely skips work.
 *
 * Everything counted must be strictly non-default so this stays a subset of
 * `hasServerMigrationStateData` (server-migration.service.ts): when the gate says
 * "meaningful", the seeding it triggers must find something to ship.
 *
 * `ignoreTaskIds` excludes specific active task ids from the "has a task?" check
 * (onboarding example tasks on the file-based conflict gate, #7985). It only ever
 * NARROWS the result.
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

  if (isEntityState(s.taskRepeatCfg) && s.taskRepeatCfg.ids.length > 0) {
    return true;
  }

  return (
    hasTimeTrackingEntries(s.timeTracking) ||
    hasArchiveData(s.archiveYoung) ||
    hasArchiveData(s.archiveOld)
  );
};
