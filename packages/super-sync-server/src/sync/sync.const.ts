export {
  SUPER_SYNC_CLIENT_ID_REGEX as CLIENT_ID_REGEX,
  SUPER_SYNC_MAX_CLIENT_ID_LENGTH as MAX_CLIENT_ID_LENGTH,
} from '@sp/shared-schema';

/**
 * Approximate bytes-per-op used when decrementing `users.storage_used_bytes`
 * during DELTA-op cleanup-deletes. ONLY valid for ordinary CRT/UPD/DEL ops
 * whose payloads observably cluster around 150-300 bytes — picking 1024 is a
 * conservative over-estimate so the cleanup loop reliably makes progress;
 * drift is reconciled once at the end of `freeStorageForUpload` via a single
 * `updateStorageUsage` scan.
 *
 * DO NOT use for full-state ops (SYNC_IMPORT / BACKUP_IMPORT / REPAIR). Their
 * payloads can be up to 20MB, so 1024 undercounts by ~20000x and the cached
 * counter ends up permanently low if reconcile fails. `deleteOldestRestorePointAndOps`
 * measures the exact `pg_column_size(payload)` for those 1-2 rows BEFORE
 * deleting; the persisted payload_bytes value avoids reintroducing the
 * SUM(pg_column_size) DoS that scanning every delta op caused.
 */
export const APPROX_BYTES_PER_OP = 1024;

/**
 * Locally-computed approximation of how many bytes an operation's payload and
 * vector clock will occupy on disk. Used by both the route layer (for quota
 * gating and post-commit counter deltas) and the service layer (for the atomic
 * counter write inside the upload transaction). Keeping a single
 * implementation guarantees the gate, the operation payload_bytes column, and
 * the increment cannot disagree about what "size" means.
 *
 * Robust against malformed payloads: if JSON.stringify throws (e.g. BigInt,
 * circular ref), the op is charged APPROX_BYTES_PER_OP so the counter cannot
 * be bypassed by submitting unserializable ops that still persist as JSONB.
 * `fallback` is `true` in that case so callers can observe the rate of
 * unserializable ops via a single log line (never the op content).
 */
export const computeOpStorageBytes = (op: {
  payload: unknown;
  vectorClock: unknown;
}): { bytes: number; fallback: boolean } => {
  try {
    return {
      bytes:
        Buffer.byteLength(JSON.stringify(op.payload ?? null), 'utf8') +
        Buffer.byteLength(JSON.stringify(op.vectorClock ?? {}), 'utf8'),
      fallback: false,
    };
  } catch {
    return { bytes: APPROX_BYTES_PER_OP, fallback: true };
  }
};
