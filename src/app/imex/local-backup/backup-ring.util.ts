import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import { INBOX_PROJECT } from '../../features/project/project.const';

const entityCount = (val: unknown): number => {
  const ids = (val as { ids?: unknown })?.ids;
  return Array.isArray(ids) ? ids.length : 0;
};

const archiveTaskCount = (archive: unknown): number =>
  entityCount((archive as { task?: unknown })?.task);

/**
 * Counts active + young-archived + old-archived tasks on a backup-shaped
 * object. Single source of truth for the "how many tasks?" question used
 * by both the informed restore prompt (`summarizeBackupStr`) and the A3
 * near-empty write-time overwrite guard (#7925), so "near-empty" means the
 * same thing on the read side and the write side.
 */
export const countAllTasks = (data: unknown): number => {
  if (!data || typeof data !== 'object') {
    return 0;
  }
  const d = data as {
    task?: unknown;
    archiveYoung?: unknown;
    archiveOld?: unknown;
  };
  return (
    entityCount(d.task) +
    archiveTaskCount(d.archiveYoung) +
    archiveTaskCount(d.archiveOld)
  );
};

/**
 * Parse-and-count for the A3 guard: returns null when the stored blob is
 * empty/corrupt (treat as "no existing backup", so we don't skip the write
 * and lose the chance to capture a real first backup).
 */
export const countAllTasksInBackupStr = (
  str: string | null | undefined,
): number | null => {
  if (!str) {
    return null;
  }
  try {
    return countAllTasks(JSON.parse(str));
  } catch {
    return null;
  }
};

/** A human-meaningful summary of a backup blob, used for the restore prompt. */
export interface BackupSummary {
  taskCount: number;
  projectCount: number;
}

/**
 * Parses a backup blob and counts the user-visible entities it holds, so the
 * restore prompt can tell the user what they would restore (#7901). Returns null
 * for empty/corrupt blobs.
 *
 * Counts are chosen to be honest and to match the "has user data?" notion the
 * restore path already relies on:
 * - tasks include archived tasks, so a heavily-archived backup doesn't read as
 *   empty and scare the user into declining a good restore;
 * - projects exclude the always-present INBOX, mirroring hasMeaningfulStateData,
 *   so a user with no projects of their own doesn't see a phantom "1 project".
 */
export const summarizeBackupStr = (
  str: string | null | undefined,
): BackupSummary | null => {
  if (!str) {
    return null;
  }
  try {
    const s = JSON.parse(str) as Record<string, unknown>;
    const projectIds = (s.project as { ids?: unknown })?.ids;
    return {
      taskCount: countAllTasks(s),
      projectCount: Array.isArray(projectIds)
        ? projectIds.filter((id) => id !== INBOX_PROJECT.id).length
        : 0,
    };
  } catch {
    return null;
  }
};

/**
 * A stored backup blob is "usable" only if it is non-empty, parses as JSON, and
 * actually contains user data. This is the gate for restoring or counting a
 * stored generation as available — an empty or corrupt blob must never be
 * restored over (or counted as a substitute for) the user's real data.
 *
 * See issue #7901 (Android local-storage durability).
 */
export const isUsableBackupStr = (str: string | null | undefined): boolean => {
  if (!str) {
    return false;
  }
  try {
    return hasMeaningfulStateData(JSON.parse(str));
  } catch {
    return false;
  }
};

/**
 * True if the backup blob shows the user had sync configured (sync enabled or a
 * provider set). Used to decide whether a startup restore may proceed *silently*:
 * restoring a synced backup re-baselines the sync account (it resets
 * `lastServerSeq` and writes a clean-slate `BACKUP_IMPORT`), which can drop other
 * devices' concurrent work — so a synced backup must go through the informed
 * confirm prompt rather than auto-restore. Conservative: any hint of sync counts.
 * Corrupt/unparseable blobs return false (they never auto-restore anyway —
 * `isUsableBackupStr` gates that). See issue #7901.
 */
export const backupStrHasSyncEnabled = (str: string | null | undefined): boolean => {
  if (!str) {
    return false;
  }
  try {
    const s = JSON.parse(str) as {
      globalConfig?: { sync?: { isEnabled?: unknown; syncProvider?: unknown } };
    };
    const sync = s.globalConfig?.sync;
    if (!sync) {
      return false;
    }
    return (
      sync.isEnabled === true ||
      (sync.syncProvider !== null && sync.syncProvider !== undefined)
    );
  } catch {
    return false;
  }
};

/**
 * Picks the newest usable backup from the two-generation ring: the primary
 * (current) slot first, then the promoted previous generation. If neither slot
 * is usable, falls back to whichever raw blob exists so the caller can still
 * surface or attempt to parse it explicitly. Returns null only when both slots
 * are empty.
 *
 * Newest-wins is intentional: the user expects to restore their latest backup.
 * The previous generation exists only as a fallback for when the newest slot is
 * empty/corrupt (e.g. a half-written eviction artifact) — NOT to second-guess a
 * legitimately smaller newer backup (a bulk-archive or delete makes the newer
 * generation smaller, and silently restoring the older/larger one would
 * resurrect data the user removed). See issue #7901.
 */
export const selectBestBackupStr = (
  primary: string | null | undefined,
  prev: string | null | undefined,
): string | null => {
  if (isUsableBackupStr(primary)) {
    return primary as string;
  }
  if (isUsableBackupStr(prev)) {
    return prev as string;
  }
  // Neither slot is usable — return any non-empty raw blob so the caller can
  // still try to parse/surface it; treat empty strings as "no backup" (null).
  return primary || prev || null;
};
