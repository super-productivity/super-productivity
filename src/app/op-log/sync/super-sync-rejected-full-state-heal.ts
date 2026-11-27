import { LS } from '../../core/persistence/storage-keys.const';

/**
 * #11671: before v20.1.0 (#11673) a SuperSync snapshot upload that failed for
 * an unrelated reason (401, proxy 404/413/52x, malformed reply) marked the
 * full-state op rejected, which blocks uploads for good. Current versions no
 * longer create such rejections, but the app does not store why an op was
 * rejected, so an old false one looks like a genuine server verdict.
 *
 * Each device may therefore heal past exactly one rejected full-state op. That
 * covers every pre-v20.1.0 leftover; a genuine rejection gets one retry and
 * then blocks as before, so a server that keeps rejecting (e.g. quota) cannot
 * make the client create a new full-state op on every sync. The check is
 * idempotent for the op already healed, because one sync may check it several
 * times before the replacement op exists.
 */
export const mayHealRejectedSuperSyncFullState = (opId: string): boolean => {
  const healedOpId = localStorage.getItem(LS.SUPER_SYNC_HEALED_REJECTED_FULL_STATE_OP_ID);
  return healedOpId === null || healedOpId === opId;
};

/** Records that this device used its one heal on the given rejected op. */
export const recordRejectedSuperSyncFullStateHeal = (opId: string): void => {
  localStorage.setItem(LS.SUPER_SYNC_HEALED_REJECTED_FULL_STATE_OP_ID, opId);
};
