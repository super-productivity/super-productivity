import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import { INBOX_PROJECT } from '../../features/project/project.const';

const entityCount = (val: unknown): number => {
  const ids = (val as { ids?: unknown })?.ids;
  return Array.isArray(ids) ? ids.length : 0;
};

const archiveTaskCount = (archive: unknown): number =>
  entityCount((archive as { task?: unknown })?.task);

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
      taskCount:
        entityCount(s.task) +
        archiveTaskCount(s.archiveYoung) +
        archiveTaskCount(s.archiveOld),
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
