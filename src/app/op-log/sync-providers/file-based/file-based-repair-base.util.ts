import { REPAIR_STALE_ERROR_CODE } from '../../core/operation-log.const';
import { SnapshotUploadResponse } from '../provider.interface';

/**
 * #11483: whether a pending REPAIR may still be written to a file-based remote.
 *
 * The #9023 conditional write only proves the remote did not move since this
 * client's last applied download. A REPAIR that stayed pending across a later
 * download (its upload failed and is retried) was built before that download's
 * ops existed, so its payload would drop them. Its `repairBaseServerSeq` is the
 * server seq it was built at; it is current only when that is still the seq
 * committed after the last applied download (`getLastServerSeq()`). Every
 * REPAIR base is taken from that same cursor (the download result, the rebase
 * path and the rejected-full-state reseed), so a current REPAIR always matches.
 * A REPAIR without a base (built outside a sync, or by an older version) cannot
 * prove it is current. Either way the caller answers REPAIR_STALE, and the
 * shared rebase path rebuilds the REPAIR from the current state at that cursor.
 */
export const isRepairBuiltAtCommittedSeq = (
  repairBaseServerSeq: number | undefined,
  committedServerSeq: number | undefined,
): boolean =>
  repairBaseServerSeq !== undefined && repairBaseServerSeq === (committedServerSeq ?? 0);

/** The answer for a REPAIR that would overwrite remote data it does not hold. */
export const repairStaleResponse = (): SnapshotUploadResponse => ({
  accepted: false,
  error: 'REPAIR snapshot does not include current remote state',
  errorCode: REPAIR_STALE_ERROR_CODE,
});
