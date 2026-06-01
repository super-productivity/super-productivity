import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';

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
 * See issue #7901.
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
