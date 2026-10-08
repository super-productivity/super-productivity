import {
  compareVectorClocks,
  // The server prunes the clocks it stores; this port of it never touches a
  // durable client clock.
  // eslint-disable-next-line no-restricted-imports
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
  VectorClock,
} from '@sp/sync-core';
import type {
  OperationSyncCapable,
  OpUploadResponse,
  OpUploadResult,
  ServerSyncOperation,
  SnapshotUploadResponse,
  SuperSyncOpDownloadResponse,
  SyncOperation,
} from '@sp/sync-providers/provider-types';

/**
 * In-memory SuperSync server for the sync fuzz harness.
 *
 * The decision logic is a PORT of packages/super-sync-server. It cannot be
 * imported into the Karma bundle: those modules pull in Prisma and a node `fs`
 * logger. This file must stay free of Angular imports so the server's vitest
 * can load it.
 *
 * Checked against the real server code by the parity specs in
 * packages/super-sync-server/tests/: sync-fuzz-server-parity.pglite.spec.ts
 * for the first three, sync-fuzz-server-full-state-parity.pglite.spec.ts for
 * the last two:
 * - conflict.ts: detectConflict (the production SQL, on PGlite) and the pure
 *   entity-id, duplicate and in-request retry helpers;
 * - validation.service.ts: ValidationService.validateOp against
 *   validateOpSubset, on the op shapes the subset covers;
 * - operation-upload.service.ts: OperationUploadService.processOperation (on
 *   PGlite) against uploadOps, per op: accepted or not, error code,
 *   existingClock and serverSeq, including in-request retries, stored
 *   duplicates and the clock-drift clamp;
 * - sync.service.ts: SyncService.uploadOps (on PGlite, the Prisma client
 *   mocked onto it) against uploadBatch, with full-state ops: the
 *   state-replacement fence, the REPAIR base check, the clean-slate wipe and
 *   its rollback, the latest-full-state marker, and clock pruning that keeps
 *   the latest full-state author;
 * - operation-download.service.ts: getOpsSinceWithSeq (same mock) against the
 *   port's: the snapshot skip, the snapshot vector clock, client exclusion
 *   and the gap cases.
 *
 * Asserted on this port only, NOT checked against the real code:
 * - the upload route (sync.routes.ops-handler.ts): the piggyback of the ops
 *   since `lastKnownServerSeq` without the uploader's own, except after a
 *   fence rejection;
 * - the snapshot route (sync.routes.snapshot-handler.ts, uploadSnapshot): the
 *   409 for a second `initial` import and the durable op-id check;
 * - the download route (sync.routes.ts): the `limit + 1` probe for `hasMore`.
 *
 * Not modeled: quotas, rate limits, the request dedup caches (a retry is
 * re-processed; for the single-threaded fuzz that answers as the cache would,
 * except a REPAIR_STALE or INVALID_OP_ID retried within 5 minutes),
 * WebSocket notifications, pruning and cleanup jobs (so no download gap),
 * DELETE /api/sync/data (deleteAllData throws FuzzUnsupportedTransportError),
 * and the validation rules outside the subset (op id, op type and entity
 * type checks, clock sanitizing, payload size and depth, BATCH payloads).
 *
 * E2EE: the real server accepts only end-to-end encrypted uploads
 * (violatesE2eeGate in sync.routes.payload.ts): every payload is a ciphertext
 * string that it never reads. The fuzz uploads plaintext because it has no
 * key, so every upload decision reads the op through `asOpaque`, which puts a
 * ciphertext stand-in in place of the payload: validation passes the payload
 * rules as for any gate-checked string, and the duplicate and retry checks
 * skip payload equality as for two encrypted ops. The parity spec checks that
 * no verdict changes with the payload. The helpers keep their plaintext
 * branches only for parity with the real functions.
 */

export const TASK_TIME_DELTA_ACTION_TYPE = '[TimeTracking] Sync time spent';
const MAX_CLOCK_DRIFT_MS = 60 * 1000; // DEFAULT_SYNC_CONFIG.maxClockDriftMs
const MISC_TASKS_SPLIT_SCHEMA_VERSION = 2;
const PIGGYBACK_LIMIT = 500;
const FULL_STATE_OP_TYPES = new Set(['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR']);
/** The action type the snapshot route stores on a full-state op. */
export const FULL_STATE_ACTION_TYPE = '[SP_ALL] Load(import) all data';
/** sync.types.ts STATE_REPLACEMENT_REQUIRED_ERROR: the fence's rejection text. */
export const STATE_REPLACEMENT_REQUIRED_ERROR =
  'Download the latest full-state replacement before retrying';

/** sync.types.ts isCausalFullStateOperation (and latestCausalFullStateSql). */
export const isCausalFullState = (
  op: Pick<SyncOperation, 'opType' | 'repairBaseServerSeq'>,
): boolean =>
  op.opType === 'SYNC_IMPORT' ||
  op.opType === 'BACKUP_IMPORT' ||
  (op.opType === 'REPAIR' && op.repairBaseServerSeq != null);

/** The body of POST /api/sync/snapshot (UploadSnapshotRequest), as the fuzz sends it. */
export interface FakeSnapshotRequest {
  state: unknown;
  clientId: string;
  reason: 'initial' | 'recovery' | 'migration';
  vectorClock: VectorClock;
  schemaVersion?: number;
  isPayloadEncrypted?: boolean;
  opId: string;
  isCleanSlate?: boolean;
  snapshotOpType?: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';
  syncImportReason?: string;
  repairBaseServerSeq?: number;
}

/** user_sync_state's latest-full-state marker: its seq and unpruned merged clock. */
export interface FullStateMarker {
  seq: number;
  clock: VectorClock;
}

export type ConflictType =
  | 'concurrent'
  | 'superseded'
  | 'equal_different_client'
  | 'unknown';

export interface ConflictResult {
  hasConflict: boolean;
  reason?: string;
  conflictType?: ConflictType;
  existingClock?: VectorClock;
}

/** A persisted row, in the shape the real server stores and compares. */
export interface StoredOperation {
  serverSeq: number;
  receivedAt: number;
  clientTimestamp: number;
  /** Stored with the pruned clock and normalized `entityIds` (getStoredEntityIds). */
  op: SyncOperation;
}

// ---------------------------------------------------------------------------
// conflict.ts — ported verbatim in behavior
// ---------------------------------------------------------------------------

export const resolveConflictForExistingOp = (
  op: SyncOperation,
  entityId: string,
  existingOp: { actionType?: string; clientId: string; vectorClock: unknown },
): ConflictResult => {
  const existingClock = existingOp.vectorClock as VectorClock;
  const comparison = compareVectorClocks(op.vectorClock, existingClock);
  if (
    comparison === 'CONCURRENT' &&
    op.actionType === TASK_TIME_DELTA_ACTION_TYPE &&
    existingOp.actionType === TASK_TIME_DELTA_ACTION_TYPE
  ) {
    return { hasConflict: false };
  }
  if (comparison === 'GREATER_THAN') return { hasConflict: false };
  if (comparison === 'EQUAL' && op.clientId === existingOp.clientId) {
    return { hasConflict: false };
  }
  const entity = `${op.entityType}:${entityId}`;
  if (comparison === 'EQUAL') {
    return {
      hasConflict: true,
      conflictType: 'equal_different_client',
      reason: `Equal vector clocks from different clients for ${entity} (client ${op.clientId} vs ${existingOp.clientId})`,
      existingClock,
    };
  }
  if (comparison === 'CONCURRENT') {
    return {
      hasConflict: true,
      conflictType: 'concurrent',
      reason: `Concurrent modification detected for ${entity}`,
      existingClock,
    };
  }
  if (comparison === 'LESS_THAN') {
    return {
      hasConflict: true,
      conflictType: 'superseded',
      reason: `Superseded operation: server has newer version of ${entity}`,
      existingClock,
    };
  }
  return {
    hasConflict: true,
    conflictType: 'unknown',
    reason: `Unknown vector clock comparison result for ${entity}`,
    existingClock,
  };
};

const isLegacyMiscConfigOperation = (op: SyncOperation): boolean =>
  op.schemaVersion < MISC_TASKS_SPLIT_SCHEMA_VERSION &&
  op.entityType === 'GLOBAL_CONFIG' &&
  op.entityId === 'misc';

export const getConflictEntityIds = (op: SyncOperation): string[] => {
  const raw = [
    ...(op.entityId ? [op.entityId] : []),
    ...(op.entityIds?.length ? op.entityIds : []),
  ];
  if (isLegacyMiscConfigOperation(op)) raw.push('tasks');
  return Array.from(new Set(raw));
};

export const getStoredEntityIds = (op: SyncOperation): string[] => {
  const ids = Array.from(
    new Set(op.entityIds?.length ? op.entityIds : op.entityId ? [op.entityId] : []),
  );
  return ids.length <= 1 && ids[0] === op.entityId ? [] : ids;
};

export const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => toStableJsonValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, toStableJsonValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

export const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(toStableJsonValue(value)) ?? 'undefined';

const areJsonValuesEqual = (a: unknown, b: unknown): boolean =>
  stableJsonStringify(a) === stableJsonStringify(b);

export const isSameDuplicateTimestamp = (
  existingTimestamp: number,
  existingReceivedAt: number,
  incomingStoredTimestamp: number,
  incomingOriginalTimestamp: number,
  maxClockDriftMs: number,
): boolean =>
  existingTimestamp === incomingStoredTimestamp ||
  (existingTimestamp === existingReceivedAt + maxClockDriftMs &&
    existingTimestamp <= incomingOriginalTimestamp);

/** isSameDuplicateOperation, minus the userId check (one user per fake server). */
export const isSameDuplicateOperation = (
  existing: StoredOperation,
  op: SyncOperation,
  maxClockDriftMs: number,
  originalTimestamp: number = op.timestamp,
): boolean => {
  const storedClock = existing.op.vectorClock;
  const storedVectorClock = limitVectorClockSize(op.vectorClock, [
    op.clientId,
    ...(storedClock && typeof storedClock === 'object' ? Object.keys(storedClock) : []),
  ]);
  const incomingEncrypted = op.isPayloadEncrypted ?? false;
  const existingEncrypted = existing.op.isPayloadEncrypted ?? false;
  const payloadsMatch =
    (existingEncrypted && incomingEncrypted) ||
    areJsonValuesEqual(existing.op.payload, op.payload);
  return (
    existing.op.clientId === op.clientId &&
    existing.op.actionType === op.actionType &&
    existing.op.opType === op.opType &&
    existing.op.entityType === op.entityType &&
    (existing.op.entityId ?? null) === (op.entityId ?? null) &&
    areJsonValuesEqual(existing.op.entityIds ?? [], getStoredEntityIds(op)) &&
    payloadsMatch &&
    areJsonValuesEqual(existing.op.vectorClock, storedVectorClock) &&
    existing.op.schemaVersion === op.schemaVersion &&
    isSameDuplicateTimestamp(
      existing.clientTimestamp,
      existing.receivedAt,
      op.timestamp,
      originalTimestamp,
      maxClockDriftMs,
    ) &&
    existingEncrypted === incomingEncrypted &&
    (existing.op.syncImportReason ?? null) === (op.syncImportReason ?? null) &&
    (existing.op.repairBaseServerSeq ?? null) === (op.repairBaseServerSeq ?? null)
  );
};

export const isSameIncomingOperation = (
  first: SyncOperation,
  second: SyncOperation,
  firstOriginalTimestamp: number = first.timestamp,
  secondOriginalTimestamp: number = second.timestamp,
): boolean => {
  const bothEncrypted =
    (first.isPayloadEncrypted ?? false) && (second.isPayloadEncrypted ?? false);
  return (
    first.clientId === second.clientId &&
    first.actionType === second.actionType &&
    first.opType === second.opType &&
    first.entityType === second.entityType &&
    first.entityId === second.entityId &&
    areJsonValuesEqual(getStoredEntityIds(first), getStoredEntityIds(second)) &&
    (bothEncrypted || areJsonValuesEqual(first.payload, second.payload)) &&
    areJsonValuesEqual(
      limitVectorClockSize(first.vectorClock, [first.clientId]),
      limitVectorClockSize(second.vectorClock, [second.clientId]),
    ) &&
    first.schemaVersion === second.schemaVersion &&
    firstOriginalTimestamp === secondOriginalTimestamp &&
    (first.isPayloadEncrypted ?? false) === (second.isPayloadEncrypted ?? false) &&
    (first.syncImportReason ?? null) === (second.syncImportReason ?? null) &&
    (first.repairBaseServerSeq ?? null) === (second.repairBaseServerSeq ?? null)
  );
};

const isValidCalendarDate = (value: unknown): boolean => {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate()
  );
};

/**
 * The part of services/validation.service.ts validateOp (and the payload shape
 * rules of sync.types.ts validatePayload) that ops built by the app can
 * plausibly fail, in the same order. Not ported: the op id, op type and entity
 * type checks, clock sanitizing, payload size and depth limits, and BATCH
 * payloads. Fuzz ops are small, use real action types and never batch.
 */
export const validateOpSubset = (
  op: SyncOperation,
  requestClientId: string,
): { errorCode: string; error: string } | undefined => {
  if (op.clientId !== requestClientId) {
    return { errorCode: 'INVALID_CLIENT_ID', error: 'clientId does not match request' };
  }
  const isFullState = FULL_STATE_OP_TYPES.has(op.opType);
  const isBulk = op.entityType === 'ALL' || op.entityType === 'RECOVERY';
  if (op.entityId !== undefined && op.entityId !== null && !op.entityId.trim()) {
    return { errorCode: 'INVALID_ENTITY_ID', error: 'empty entityId' };
  }
  if ((op.entityIds ?? []).some((id) => typeof id !== 'string' || !id.trim())) {
    return { errorCode: 'INVALID_ENTITY_ID', error: 'invalid entityIds element' };
  }
  if (!isFullState && !isBulk && !op.entityId) {
    return { errorCode: 'MISSING_ENTITY_ID', error: 'requires entityId' };
  }
  if (op.payload === undefined) {
    return { errorCode: 'INVALID_PAYLOAD', error: 'Missing payload' };
  }
  if (op.actionType === TASK_TIME_DELTA_ACTION_TYPE && !op.isPayloadEncrypted) {
    const wrapper = op.payload as Record<string, unknown> | null;
    const inner = wrapper?.['actionPayload'];
    const p = (inner && typeof inner === 'object' ? inner : wrapper) as Record<
      string,
      unknown
    > | null;
    const duration = p?.['duration'];
    if (
      !p ||
      p['taskId'] !== op.entityId ||
      !isValidCalendarDate(p['date']) ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < 0
    ) {
      return { errorCode: 'INVALID_PAYLOAD', error: 'Invalid task-time sync payload' };
    }
  }
  if (
    op.schemaVersion !== undefined &&
    (!Number.isInteger(op.schemaVersion) ||
      op.schemaVersion < 1 ||
      op.schemaVersion > 100)
  ) {
    return { errorCode: 'INVALID_SCHEMA_VERSION', error: 'Invalid schema version' };
  }
  if (!Number.isSafeInteger(op.timestamp)) {
    return { errorCode: 'INVALID_TIMESTAMP', error: 'Invalid timestamp' };
  }
  // validatePayload: full-state ops skip it; DEL also allows null; a string is
  // an encrypted payload; anything else must be a non-null object.
  const payload: unknown = op.payload;
  const isObject =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload);
  const isValidShape =
    isFullState ||
    typeof payload === 'string' ||
    isObject ||
    (op.opType === 'DEL' && payload === null);
  if (!isValidShape) {
    return { errorCode: 'INVALID_PAYLOAD', error: 'Invalid payload shape' };
  }
  return undefined;
};

/** The op as the E2EE-only server sees it: a ciphertext it cannot read. */
const asOpaque = (op: SyncOperation): SyncOperation => ({
  ...op,
  payload: 'e2ee-ciphertext',
  isPayloadEncrypted: true,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// The server: one user, one op table
// ---------------------------------------------------------------------------

export interface FakeServerRejection {
  clientId: string;
  opId: string;
  actionType: string;
  entity: string;
  errorCode: string;
}

export class FakeSuperSyncServer {
  readonly rows: StoredOperation[] = [];
  /** Every rejection, for oracles and failure reports. */
  readonly rejections: FakeServerRejection[] = [];
  private _lastSeq = 0;
  /** user_sync_state.latest_state_replacement_seq: null until resolved. */
  private _latestStateReplacementSeq: number | null = null;
  /** user_sync_state.latest_full_state_seq / _vector_clock (unpruned). */
  private _latestFullState: FullStateMarker | null = null;

  constructor(private readonly _now: () => number = () => Date.now()) {}

  get latestSeq(): number {
    return this.rows.length ? this._lastSeq : 0;
  }

  /** For the parity spec: the fence and the full-state marker. */
  get syncState(): {
    lastSeq: number;
    latestStateReplacementSeq: number | null;
    latestFullState: FullStateMarker | null;
  } {
    return clone({
      lastSeq: this._lastSeq,
      latestStateReplacementSeq: this._latestStateReplacementSeq,
      latestFullState: this._latestFullState,
    });
  }

  /** The latest op touching `entityType:entityId` via entity_id or entity_ids. */
  latestEntityOp(entityType: string, entityId: string): StoredOperation | undefined {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const { op } = this.rows[i];
      if (
        op.entityType === entityType &&
        (op.entityId === entityId || (op.entityIds ?? []).includes(entityId))
      ) {
        return this.rows[i];
      }
    }
    return undefined;
  }

  /** conflict.ts detectConflict. */
  detectConflict(op: SyncOperation): ConflictResult {
    if (FULL_STATE_OP_TYPES.has(op.opType)) return { hasConflict: false };
    const entityIds = getConflictEntityIds(op);
    if (entityIds.length === 1 || isLegacyMiscConfigOperation(op)) {
      for (const entityId of entityIds) {
        const result = this._detectConflictForEntity(op, entityId);
        if (result.hasConflict) return result;
      }
      return { hasConflict: false };
    }
    // detectConflictForEntities: batches of 100, first conflict wins.
    for (const entityId of entityIds) {
      const existing = this.latestEntityOp(op.entityType, entityId);
      if (!existing) continue;
      const result = resolveConflictForExistingOp(op, entityId, existing.op);
      if (result.hasConflict) return result;
    }
    return { hasConflict: false };
  }

  /** detectConflictForEntity, including its pre-v2 GLOBAL_CONFIG:misc alias. */
  private _detectConflictForEntity(op: SyncOperation, entityId: string): ConflictResult {
    const existing = this.latestEntityOp(op.entityType, entityId);
    if (op.entityType === 'GLOBAL_CONFIG' && entityId === 'tasks') {
      const legacy = [...this.rows]
        .reverse()
        .find(
          (row) =>
            row.op.entityType === 'GLOBAL_CONFIG' &&
            row.op.entityId === 'misc' &&
            row.op.schemaVersion < MISC_TASKS_SPLIT_SCHEMA_VERSION,
        );
      if (legacy && (!existing || legacy.serverSeq > existing.serverSeq)) {
        // The server selects no action_type for the legacy row.
        const { clientId, vectorClock } = legacy.op;
        return resolveConflictForExistingOp(op, entityId, { clientId, vectorClock });
      }
    }
    return existing
      ? resolveConflictForExistingOp(op, entityId, existing.op)
      : { hasConflict: false };
  }

  /**
   * POST /api/sync/ops (sync.routes.ops-handler.ts): sync.service.ts
   * uploadOps, then the piggyback of other clients' ops. A fence rejection
   * piggybacks the uploader's own ops too, so it receives a replacement it
   * authored itself.
   */
  uploadOps(
    rawOps: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): OpUploadResponse {
    const results = this.uploadBatch(rawOps, clientId, { lastKnownServerSeq });
    const isFenceRejection =
      results.length > 0 &&
      results.every(
        (r) =>
          !r.accepted &&
          r.errorCode === 'INTERNAL_ERROR' &&
          r.error === STATE_REPLACEMENT_REQUIRED_ERROR,
      );
    let newOps: ServerSyncOperation[] | undefined;
    let latestSeq = this.latestSeq;
    let hasMorePiggyback = false;
    if (lastKnownServerSeq !== undefined) {
      const piggyback = this.getOpsSinceWithSeq(
        lastKnownServerSeq,
        isFenceRejection ? undefined : clientId,
        PIGGYBACK_LIMIT,
        false,
      );
      newOps = piggyback.ops;
      latestSeq = piggyback.latestSeq;
      if (newOps.length === PIGGYBACK_LIMIT) {
        hasMorePiggyback = newOps[newOps.length - 1].serverSeq < latestSeq;
      }
    }
    return clone({
      results,
      newOps: newOps && newOps.length > 0 ? newOps : undefined,
      latestSeq,
      ...(hasMorePiggyback ? { hasMorePiggyback: true } : {}),
    });
  }

  /**
   * sync.service.ts SyncService.uploadOps: the state-replacement fence, the
   * REPAIR base check and the clean-slate wipe (all or nothing), then the
   * per-op loop; accepted imports move the fence.
   */
  uploadBatch(
    rawOps: SyncOperation[],
    clientId: string,
    options: {
      isCleanSlate?: boolean;
      repairBaseServerSeq?: number;
      allowLegacyRepairWithoutBase?: boolean;
      lastKnownServerSeq?: number;
    } = {},
  ): OpUploadResult[] {
    const { isCleanSlate, repairBaseServerSeq, lastKnownServerSeq } = options;
    if (isCleanSlate && rawOps.length === 0) return [];
    const ops = clone(rawOps);
    const now = this._now();
    const containsRepair = ops.some((op) => op.opType === 'REPAIR');
    const isLegacyRepairUpload =
      containsRepair &&
      repairBaseServerSeq === undefined &&
      !!options.allowLegacyRepairWithoutBase;
    const shouldCleanSlate = !!isCleanSlate && !containsRepair;
    if (isCleanSlate) {
      const invalid = ops.map((op) => validateOpSubset(asOpaque(op), clientId));
      if (invalid.some((v) => v)) {
        return ops.map((op, i) => ({
          opId: op.id,
          accepted: false,
          error: invalid[i]?.error ?? 'Clean-slate batch contains an invalid operation',
          errorCode: invalid[i]?.errorCode ?? 'INTERNAL_ERROR',
        }));
      }
    }
    // The transaction: a clean slate that any op rejects rolls back, the
    // fence's lazy resolution included.
    const saved = this._saveTransactionState();
    const needsSyncStateLock =
      shouldCleanSlate ||
      lastKnownServerSeq !== undefined ||
      (containsRepair && !isLegacyRepairUpload);
    if (needsSyncStateLock) {
      // The real server resolves an unset fence from the retained import
      // rows (resolveRetainedReplacementSeq). Every import this port keeps
      // was accepted after the fence was last reset, so that is always none
      // here: 0, the resolved "no retained replacement". Porting pruning or
      // DELETE /api/sync/data breaks that: restore the lazy lookup then.
      this._latestStateReplacementSeq ??= 0;
      if (
        lastKnownServerSeq !== undefined &&
        lastKnownServerSeq < this._latestStateReplacementSeq
      ) {
        return ops.map((op) => ({
          opId: op.id,
          accepted: false,
          error: STATE_REPLACEMENT_REQUIRED_ERROR,
          errorCode: 'INTERNAL_ERROR',
        }));
      }
    }
    if (containsRepair && !isLegacyRepairUpload) {
      // The raw allocator (last_seq), not getLatestSeq.
      if (repairBaseServerSeq === undefined || repairBaseServerSeq !== this._lastSeq) {
        return ops.map((op) =>
          op.opType === 'REPAIR'
            ? {
                opId: op.id,
                accepted: false,
                error: 'REPAIR snapshot does not include current server state',
                errorCode: 'REPAIR_STALE',
              }
            : {
                opId: op.id,
                accepted: false,
                error: 'Batch deferred because its REPAIR snapshot is stale',
                errorCode: 'INTERNAL_ERROR',
              },
        );
      }
    }
    if (shouldCleanSlate) {
      // The allocator (_lastSeq) survives, so sequence numbers continue.
      this.rows.length = 0;
      this._latestFullState = null;
      this._latestStateReplacementSeq = null;
    }
    const firstById = new Map<string, { op: SyncOperation; ts: number }>();
    const results = ops.map((op) => {
      const first = firstById.get(op.id);
      if (!first) firstById.set(op.id, { op: { ...op }, ts: op.timestamp });
      return this._processOperation(clientId, op, now, first);
    });
    let latestAcceptedReplacementSeq: number | undefined;
    ops.forEach((op, i) => {
      const { accepted, serverSeq } = results[i];
      if (
        accepted &&
        serverSeq !== undefined &&
        (op.opType === 'SYNC_IMPORT' || op.opType === 'BACKUP_IMPORT')
      ) {
        latestAcceptedReplacementSeq = Math.max(
          latestAcceptedReplacementSeq ?? 0,
          serverSeq,
        );
      }
    });
    if (latestAcceptedReplacementSeq !== undefined) {
      this._latestStateReplacementSeq = latestAcceptedReplacementSeq;
    }
    if (isCleanSlate && results.some((r) => !r.accepted)) {
      this._restoreTransactionState(saved);
      return results.map((r) =>
        r.accepted
          ? {
              opId: r.opId,
              accepted: false,
              error: 'Clean-slate replacement was rolled back',
              errorCode: 'INTERNAL_ERROR',
            }
          : r,
      );
    }
    return results;
  }

  /**
   * POST /api/sync/snapshot (sync.routes.snapshot-handler.ts), after the E2EE
   * gate, the request dedup cache and the quota checks. A 409 is thrown as
   * the SuperSync provider throws it; every other outcome is the response.
   */
  uploadSnapshot(request: FakeSnapshotRequest): SnapshotUploadResponse {
    const {
      state,
      clientId,
      reason,
      vectorClock,
      schemaVersion,
      isPayloadEncrypted,
      opId,
      isCleanSlate,
      snapshotOpType,
      syncImportReason,
      repairBaseServerSeq,
    } = request;
    const shouldCleanSlate = snapshotOpType === 'REPAIR' ? false : isCleanSlate;
    const isLegacyRepairUpload =
      snapshotOpType === 'REPAIR' &&
      repairBaseServerSeq === undefined &&
      isCleanSlate === true;
    if (reason === 'initial' && !shouldCleanSlate) {
      const existing = this._findExistingSyncImport(opId);
      if (existing) {
        if (opId && existing.op.id === opId) {
          return { accepted: true, serverSeq: existing.serverSeq };
        }
        throw new FakeSyncImportExistsError();
      }
    }
    const op: SyncOperation = {
      id: opId,
      clientId,
      actionType: FULL_STATE_ACTION_TYPE,
      opType: snapshotOpType ?? 'SYNC_IMPORT',
      entityType: 'ALL',
      payload: state,
      vectorClock,
      timestamp: this._now(),
      schemaVersion: schemaVersion ?? 1,
      isPayloadEncrypted: isPayloadEncrypted ?? false,
      ...(syncImportReason ? { syncImportReason } : {}),
      ...(repairBaseServerSeq !== undefined ? { repairBaseServerSeq } : {}),
    } as SyncOperation;
    // Inside the per-user storage lock:
    if (shouldCleanSlate || snapshotOpType === 'REPAIR') {
      const existing = this.rows.find((row) => row.op.id === opId);
      if (existing) {
        const isExactRetry =
          FULL_STATE_OP_TYPES.has(existing.op.opType) &&
          isSameIncomingOperation(
            asOpaque({ ...existing.op, timestamp: op.timestamp }),
            asOpaque(op),
            0,
            0,
          );
        return isExactRetry
          ? { accepted: true, serverSeq: existing.serverSeq }
          : {
              accepted: false,
              error: 'Operation ID already belongs to a different operation',
              errorCode: 'INVALID_OP_ID',
            };
      }
    }
    // Left out, as they answer like the checks above and in uploadBatch here:
    // the route's own REPAIR base check (against getLatestSeq, which only
    // differs from the allocator while no row exists), and turning a
    // DUPLICATE_OPERATION into success (every retry the fuzz can send hits
    // the `initial` or the op-id check first).
    const [result] = this.uploadBatch([op], clientId, {
      isCleanSlate: shouldCleanSlate,
      repairBaseServerSeq,
      allowLegacyRepairWithoutBase: isLegacyRepairUpload,
    });
    return {
      accepted: result.accepted,
      serverSeq: result.serverSeq,
      error: result.error,
      errorCode: result.errorCode,
    };
  }

  /**
   * services/operation-upload.service.ts processOperation. Decisions read the
   * op through asOpaque: the real server only ever sees E2EE payloads.
   */
  private _processOperation(
    clientId: string,
    op: SyncOperation,
    now: number,
    firstRequestOperation?: { op: SyncOperation; ts: number },
  ): OpUploadResult {
    const originalTimestamp = op.timestamp;
    if (op.timestamp > now + MAX_CLOCK_DRIFT_MS) op.timestamp = now + MAX_CLOCK_DRIFT_MS;
    const reject = (
      errorCode: string,
      error: string,
      existingClock?: VectorClock,
    ): OpUploadResult => {
      this.rejections.push({
        clientId,
        opId: op.id,
        actionType: op.actionType,
        entity: `${op.entityType}:${op.entityId ?? (op.entityIds ?? []).join(',')}`,
        errorCode,
      });
      return { opId: op.id, accepted: false, error, errorCode, existingClock };
    };
    if (firstRequestOperation) {
      return isSameIncomingOperation(
        asOpaque(firstRequestOperation.op),
        asOpaque(op),
        firstRequestOperation.ts,
        originalTimestamp,
      )
        ? reject('DUPLICATE_OPERATION', 'Duplicate operation ID')
        : reject(
            'INVALID_OP_ID',
            'Operation ID already belongs to a different operation',
          );
    }
    const invalid = validateOpSubset(asOpaque(op), clientId);
    if (invalid) return reject(invalid.errorCode, invalid.error);
    // The unpruned clock, for the full-state marker.
    const fullStateClock = isCausalFullState(op) ? { ...op.vectorClock } : undefined;
    const existing = this.rows.find((row) => row.op.id === op.id);
    if (existing) {
      return isSameDuplicateOperation(
        { ...existing, op: asOpaque(existing.op) },
        asOpaque(op),
        MAX_CLOCK_DRIFT_MS,
        originalTimestamp,
      )
        ? reject('DUPLICATE_OPERATION', 'Duplicate operation ID')
        : reject(
            'INVALID_OP_ID',
            'Operation ID already belongs to a different operation',
          );
    }
    const conflict = this.detectConflict(op);
    if (conflict.hasConflict) {
      const code =
        conflict.conflictType === 'concurrent' ||
        conflict.conflictType === 'equal_different_client'
          ? 'CONFLICT_CONCURRENT'
          : 'CONFLICT_SUPERSEDED';
      return reject(code, conflict.reason ?? code, conflict.existingClock);
    }
    const serverSeq = ++this._lastSeq;
    // Pruning runs AFTER comparison, BEFORE storage. An oversized clock keeps
    // the latest causal full-state author (this op, if it is one).
    const author = fullStateClock
      ? op.clientId
      : Object.keys(op.vectorClock).length > MAX_VECTOR_CLOCK_SIZE
        ? this._latestCausalFullState()?.op.clientId
        : undefined;
    const protectedIds =
      Object.keys(op.vectorClock).length > MAX_VECTOR_CLOCK_SIZE && author
        ? [author]
        : [];
    const stored: SyncOperation = {
      ...op,
      vectorClock: limitVectorClockSize(op.vectorClock, [op.clientId, ...protectedIds]),
      entityIds: getStoredEntityIds(op),
      isPayloadEncrypted: op.isPayloadEncrypted ?? false,
    };
    if (fullStateClock) {
      // The marker: every earlier stored clock merged with this op's own.
      const merged = this._aggregateClock((row) => row.serverSeq < serverSeq);
      for (const [id, counter] of Object.entries(fullStateClock)) {
        merged[id] = Math.max(merged[id] ?? 0, counter);
      }
      this._latestFullState = { seq: serverSeq, clock: merged };
    }
    this.rows.push({
      serverSeq,
      receivedAt: now,
      clientTimestamp: op.timestamp,
      op: stored,
    });
    return { opId: op.id, accepted: true, serverSeq };
  }

  /**
   * services/operation-download.service.ts getOpsSinceWithSeq: a cursor before
   * the latest causal full-state op starts at that op (the snapshot skip).
   */
  getOpsSinceWithSeq(
    sinceSeq: number,
    excludeClient: string | undefined,
    limit: number,
    includeSnapshotMetadata: boolean = true,
  ): {
    ops: ServerSyncOperation[];
    latestSeq: number;
    gapDetected: boolean;
    snapshotVectorClock?: VectorClock;
  } {
    const latestSeq = this._lastSeq;
    if (latestSeq === 0) return { ops: [], latestSeq, gapDetected: sinceSeq > 0 };
    const snapshotRow = this._latestCausalFullState(latestSeq);
    let effectiveSinceSeq = sinceSeq;
    let snapshotVectorClock: VectorClock | undefined;
    if (snapshotRow && sinceSeq < snapshotRow.serverSeq) {
      effectiveSinceSeq = snapshotRow.serverSeq - 1;
      if (includeSnapshotMetadata) {
        const preserve = [
          ...(excludeClient ? [excludeClient] : []),
          snapshotRow.op.clientId,
        ];
        const clock =
          this._latestFullState?.seq === snapshotRow.serverSeq
            ? this._latestFullState.clock
            : this._aggregateClock((row) => row.serverSeq <= snapshotRow.serverSeq);
        snapshotVectorClock = limitVectorClockSize(clock, preserve);
      }
    }
    const ops = this.rows
      .filter(
        (row) =>
          row.serverSeq > effectiveSinceSeq &&
          row.serverSeq <= latestSeq &&
          (!excludeClient || row.op.clientId !== excludeClient),
      )
      .slice(0, limit)
      .map((row) => this._toServerOp(row));
    const minSeq = this.rows.length ? this.rows[0].serverSeq : null;
    if (ops.length === 0 && minSeq === null) {
      return { ops: [], latestSeq: 0, gapDetected: sinceSeq > 0 };
    }
    let gapDetected = sinceSeq > latestSeq && latestSeq > 0;
    if (sinceSeq > 0 && latestSeq > 0) {
      if (minSeq !== null && effectiveSinceSeq < minSeq - 1) gapDetected = true;
      if (!excludeClient && ops.length > 0 && ops[0].serverSeq > effectiveSinceSeq + 1) {
        gapDetected = true;
      }
    }
    return {
      ops,
      latestSeq,
      gapDetected,
      ...(snapshotVectorClock ? { snapshotVectorClock } : {}),
    };
  }

  /** GET /api/sync/ops (sync.routes.ts): limit+1 probe for `hasMore`. */
  downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): SuperSyncOpDownloadResponse {
    const maxLimit = Math.min(limit, 1000);
    const result = this.getOpsSinceWithSeq(sinceSeq, excludeClient, maxLimit + 1);
    const hasMore = result.ops.length > maxLimit;
    if (hasMore) result.ops.pop();
    return clone({
      ops: result.ops,
      hasMore,
      latestSeq: result.latestSeq,
      gapDetected: result.gapDetected || undefined,
      snapshotVectorClock: result.snapshotVectorClock,
      serverTime: this._now(),
      capabilities: { causalRepairSnapshots: true },
    });
  }

  /** latestCausalFullStateSql: the newest causal full-state row, up to `maxSeq`. */
  private _latestCausalFullState(maxSeq?: number): StoredOperation | undefined {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (
        (maxSeq === undefined || row.serverSeq <= maxSeq) &&
        isCausalFullState(row.op)
      ) {
        return row;
      }
    }
    return undefined;
  }

  /** sync.routes.quota.ts findExistingSyncImport: this op id, else the newest full-state op. */
  private _findExistingSyncImport(opId: string): StoredOperation | undefined {
    const exact = this.rows.find((row) => row.op.id === opId);
    if (exact && FULL_STATE_OP_TYPES.has(exact.op.opType)) return exact;
    return [...this.rows].reverse().find((row) => FULL_STATE_OP_TYPES.has(row.op.opType));
  }

  /** The per-client max of the stored (pruned) clocks of the matching rows. */
  private _aggregateClock(match: (row: StoredOperation) => boolean): VectorClock {
    const clock: VectorClock = {};
    for (const row of this.rows.filter(match)) {
      for (const [id, counter] of Object.entries(row.op.vectorClock)) {
        clock[id] = Math.max(clock[id] ?? 0, counter);
      }
    }
    return clock;
  }

  private _saveTransactionState(): object {
    return {
      rows: [...this.rows],
      lastSeq: this._lastSeq,
      latestFullState: this._latestFullState,
      latestStateReplacementSeq: this._latestStateReplacementSeq,
    };
  }

  private _restoreTransactionState(saved: object): void {
    const s = saved as {
      rows: StoredOperation[];
      lastSeq: number;
      latestFullState: FullStateMarker | null;
      latestStateReplacementSeq: number | null;
    };
    this.rows.splice(0, this.rows.length, ...s.rows);
    this._lastSeq = s.lastSeq;
    this._latestFullState = s.latestFullState;
    this._latestStateReplacementSeq = s.latestStateReplacementSeq;
  }

  private _toServerOp(row: StoredOperation): ServerSyncOperation {
    const { entityIds, ...op } = row.op;
    return {
      serverSeq: row.serverSeq,
      receivedAt: row.receivedAt,
      op: { ...op, ...(entityIds && entityIds.length ? { entityIds } : {}) },
    };
  }
}

/** Thrown for the transports the fuzz does not model. */
export class FuzzUnsupportedTransportError extends Error {}

/**
 * The 409 SYNC_IMPORT_EXISTS reply, as the SuperSync provider throws it
 * (SuperSyncHttpStatusError: the status line, then the server's reason).
 */
export class FakeSyncImportExistsError extends Error {
  readonly status = 409;
  readonly code = 'SYNC_IMPORT_EXISTS';
  constructor() {
    super('HTTP 409 Conflict — SYNC_IMPORT_EXISTS');
  }
}

/** One device's SuperSync client: own cursor, shared server, JSON on the wire. */
export class FakeSuperSyncClient implements OperationSyncCapable<'superSyncOps'> {
  readonly supportsOperationSync = true;
  readonly providerMode = 'superSyncOps' as const;
  private _lastServerSeq = 0;

  constructor(private readonly _server: FakeSuperSyncServer) {}

  async uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse> {
    return this._server.uploadOps(ops, clientId, lastKnownServerSeq);
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit?: number,
  ): Promise<SuperSyncOpDownloadResponse> {
    return this._server.downloadOps(sinceSeq, excludeClient, limit);
  }

  async getLastServerSeq(): Promise<number> {
    return this._lastServerSeq;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    this._lastServerSeq = seq;
  }

  /**
   * The real provider says true only after a download response advertised
   * the capability; every response of this server does, and every sync
   * downloads before it uploads.
   */
  supportsCausalRepairSnapshots(): boolean {
    return true;
  }

  async uploadSnapshot(
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: VectorClock,
    schemaVersion: number,
    isPayloadEncrypted: boolean | undefined,
    opId: string,
    isCleanSlate?: boolean,
    snapshotOpType?: string,
    syncImportReason?: string,
    repairBaseServerSeq?: number,
  ): Promise<SnapshotUploadResponse> {
    // JSON on the wire, as the provider sends it.
    const request = clone({
      state,
      clientId,
      reason,
      vectorClock,
      schemaVersion,
      isPayloadEncrypted,
      opId,
      isCleanSlate,
      snapshotOpType,
      ...(syncImportReason ? { syncImportReason } : {}),
      ...(repairBaseServerSeq !== undefined ? { repairBaseServerSeq } : {}),
    }) as FakeSnapshotRequest;
    return clone(this._server.uploadSnapshot(request));
  }

  async deleteAllData(): Promise<{ success: boolean }> {
    throw new FuzzUnsupportedTransportError('deleteAllData');
  }
}
