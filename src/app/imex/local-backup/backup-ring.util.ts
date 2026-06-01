import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';

const entityCount = (val: unknown): number => {
  const ids = (val as { ids?: unknown })?.ids;
  return Array.isArray(ids) ? ids.length : 0;
};

/** A human-meaningful summary of a backup blob, for restore prompts and ranking. */
export interface BackupSummary {
  taskCount: number;
  projectCount: number;
  noteCount: number;
}

/**
 * Parses a backup blob and counts the user-visible entities it holds. Returns
 * null for empty/corrupt blobs. Used both to show the user what a backup
 * contains before they restore it (#7901) and to rank two ring generations.
 */
export const summarizeBackupStr = (
  str: string | null | undefined,
): BackupSummary | null => {
  if (!str) {
    return null;
  }
  try {
    const s = JSON.parse(str) as Record<string, unknown>;
    return {
      taskCount: entityCount(s.task),
      projectCount: entityCount(s.project),
      noteCount: entityCount(s.note),
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

/** Total user-visible entity weight, used to rank two usable generations. */
const backupWeight = (str: string | null | undefined): number => {
  const s = summarizeBackupStr(str);
  return s ? s.taskCount + s.projectCount + s.noteCount : 0;
};

/**
 * Picks the best backup to restore from the two-generation ring.
 *
 * When both slots are usable, prefers the one carrying MORE data, tie-breaking
 * to the primary (newest). This matters after an eviction: if the live store
 * boots near-empty and a 5-min backup writes that degraded state to the primary,
 * the ring still holds the full copy in `prev` — and restore must surface the
 * full copy, not the newer-but-smaller one. Preferring "more complete" is the
 * safe default for an explicit recovery action (the caller shows the user the
 * counts first, so a deliberate shrink can still be cancelled).
 *
 * If only one slot is usable, returns it. If neither is usable, falls back to
 * whichever raw blob exists so the caller can still surface or parse it; returns
 * null only when both slots are empty.
 *
 * See issue #7901.
 */
export const selectBestBackupStr = (
  primary: string | null | undefined,
  prev: string | null | undefined,
): string | null => {
  const isPrimaryUsable = isUsableBackupStr(primary);
  const isPrevUsable = isUsableBackupStr(prev);
  if (isPrimaryUsable && isPrevUsable) {
    return backupWeight(prev) > backupWeight(primary)
      ? (prev as string)
      : (primary as string);
  }
  if (isPrimaryUsable) {
    return primary as string;
  }
  if (isPrevUsable) {
    return prev as string;
  }
  // Neither slot is usable — return any non-empty raw blob so the caller can
  // still try to parse/surface it; treat empty strings as "no backup" (null).
  return primary || prev || null;
};
