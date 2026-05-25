import {
  CURRENT_SCHEMA_VERSION,
  migrateOperation,
  type OperationLike,
} from '@sp/shared-schema';
import { Operation } from './sync.types';
import { ALLOWED_ENTITY_TYPES } from './services/validation.service';

/**
 * Maximum state size during replay (100MB).
 * Prevents memory exhaustion from malicious or corrupted data.
 */
export const MAX_REPLAY_STATE_SIZE_BYTES = 100 * 1024 * 1024;

const REPLAY_SIZE_CHECK_THRESHOLD_BYTES = MAX_REPLAY_STATE_SIZE_BYTES * 0.8;

/**
 * Reject these as property keys when applying user-supplied ids to the
 * replayed state object. Assigning to `state[key]` with one of these names
 * triggers a prototype-mutating setter (`__proto__`) or replaces an
 * inherited slot (`constructor`/`prototype`).
 */
const isUnsafeEntityKey = (key: string): boolean =>
  key === '__proto__' || key === 'constructor' || key === 'prototype';

const isReplayFullStateOpType = (opType: string): boolean =>
  opType === 'SYNC_IMPORT' || opType === 'BACKUP_IMPORT' || opType === 'REPAIR';

/**
 * Generous upper bound on the JSON structural overhead of inserting one new
 * `state[entityType][entityId] = {...}` slot: the id key's quotes + colon +
 * comma (~4 bytes) plus, when the entity-type map is new, a `"type":{}`
 * wrapper (~6 bytes). Padded to 32 so the running delta accounting can NEVER
 * under-count — the replay size guard's correctness (and the decision to skip
 * the final exact measurement when the upper bound proves safety) depends on
 * this being an over-estimate.
 */
const REPLAY_ENTITY_KEY_JSON_OVERHEAD_BYTES = 32;

const getReplayPayloadDeltaBytes = (opType: string, payload: unknown): number => {
  if (opType === 'DEL') return 0;
  return Buffer.byteLength(JSON.stringify(payload ?? ''), 'utf8');
};

const getReplayEntityKeyDeltaBytes = (
  entityType: string,
  entityId: string | null,
): number =>
  Buffer.byteLength(entityType, 'utf8') +
  (entityId ? Buffer.byteLength(entityId, 'utf8') : 0) +
  REPLAY_ENTITY_KEY_JSON_OVERHEAD_BYTES;

/**
 * Throws if the serialized state exceeds the replay cap. The return value is
 * load-bearing, NOT incidental: callers assign it back to `estimatedBytes` to
 * reset the running delta-accounting baseline. Do not "simplify" this to
 * `void`.
 */
export const assertReplayStateSize = (state: Record<string, unknown>): number => {
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (stateBytes > MAX_REPLAY_STATE_SIZE_BYTES) {
    throw new Error(
      `State too large during replay: ${Math.round(stateBytes / 1024 / 1024)}MB ` +
        `(max: ${Math.round(MAX_REPLAY_STATE_SIZE_BYTES / 1024 / 1024)}MB)`,
    );
  }
  return stateBytes;
};

const encryptedOpsNotSupportedMessage = (encryptedOpCount: number): string =>
  `ENCRYPTED_OPS_NOT_SUPPORTED: Cannot generate snapshot - ${encryptedOpCount} operations have encrypted payloads. ` +
  `Server-side restore is not available when E2E encryption is enabled. ` +
  `Alternative: Use the client app's "Sync Now" button which can decrypt and restore locally.`;

/**
 * Typed error thrown when snapshot generation hits encrypted ops the server
 * cannot decrypt. Route handlers should `instanceof`-check this instead of
 * substring-matching the message, and must NOT echo `message` back to the
 * client — it contains the encrypted-op count (data-volume side-channel).
 */
export class EncryptedOpsNotSupportedError extends Error {
  readonly encryptedOpCount: number;
  constructor(encryptedOpCount: number) {
    super(encryptedOpsNotSupportedMessage(encryptedOpCount));
    this.name = 'EncryptedOpsNotSupportedError';
    this.encryptedOpCount = encryptedOpCount;
  }
}

export type ReplayOperationRow = {
  id: string;
  serverSeq: number;
  opType: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  schemaVersion: number;
  isPayloadEncrypted: boolean;
};

export const assertContiguousReplayBatch = (
  ops: ReplayOperationRow[],
  expectedFirstSeq: number,
  targetSeq: number,
): void => {
  if (ops.length === 0) {
    throw new Error(
      `SNAPSHOT_REPLAY_INCOMPLETE: Missing operations from seq ${expectedFirstSeq} to ${targetSeq}.`,
    );
  }

  let expectedSeq = expectedFirstSeq;
  for (const op of ops) {
    if (op.serverSeq !== expectedSeq) {
      throw new Error(
        `SNAPSHOT_REPLAY_INCOMPLETE: Expected seq ${expectedSeq} but got ${op.serverSeq} while replaying to seq ${targetSeq}.`,
      );
    }
    expectedSeq++;
  }
};

/**
 * Replay operations to build state.
 * Used internally by snapshot generation methods.
 */
export const replayOpsToState = (
  ops: ReplayOperationRow[],
  initialState: Record<string, unknown> = {},
): Record<string, unknown> => {
  const state = { ...(initialState as Record<string, Record<string, unknown>>) };
  let estimatedBytes = Object.keys(state).length === 0 ? 2 : assertReplayStateSize(state);
  let accumulatedDeltaBytes = 0;

  for (let i = 0; i < ops.length; i++) {
    const row = ops[i];

    // Server cannot decrypt E2E payloads. Snapshot callers reject encrypted
    // ranges upfront; this guard prevents accidental partial replays.
    if (row.isPayloadEncrypted) {
      throw new EncryptedOpsNotSupportedError(1);
    }

    let opType = row.opType as Operation['opType'];
    let entityType = row.entityType;
    let entityId = row.entityId;
    let payload = row.payload;
    accumulatedDeltaBytes +=
      getReplayPayloadDeltaBytes(opType, payload) +
      getReplayEntityKeyDeltaBytes(entityType, entityId);
    let forceStateSizeMeasurement = false;

    const opSchemaVersion = row.schemaVersion ?? 1;

    // Prepare list of operations to process (may be expanded by migration)
    let opsToProcess: Array<{
      opType: string;
      entityType: string;
      entityId: string | null;
      payload: unknown;
    }> = [{ opType, entityType, entityId, payload }];

    if (opSchemaVersion < CURRENT_SCHEMA_VERSION) {
      const opLike: OperationLike = {
        id: row.id,
        opType,
        entityType,
        entityId: entityId ?? undefined,
        payload,
        schemaVersion: opSchemaVersion,
      };

      const migrationResult = migrateOperation(opLike, CURRENT_SCHEMA_VERSION);
      if (!migrationResult.success) {
        continue;
      }
      const migratedOp = migrationResult.data;
      if (!migratedOp) continue;

      // Handle array result (operation was split into multiple)
      if (Array.isArray(migratedOp)) {
        opsToProcess = migratedOp.map((op) => ({
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId ?? null,
          payload: op.payload,
        }));
      } else {
        opsToProcess = [
          {
            opType: migratedOp.opType,
            entityType: migratedOp.entityType,
            entityId: migratedOp.entityId ?? null,
            payload: migratedOp.payload,
          },
        ];
      }
    }

    // Process all operations (original or migrated)
    for (const opToProcess of opsToProcess) {
      const {
        opType: processOpType,
        entityType: processEntityType,
        entityId: processEntityId,
        payload: processPayload,
      } = opToProcess;

      // Handle full-state operations BEFORE entity type check.
      // These operations REPLACE the entire state (they represent a complete
      // snapshot of the app), so we must clear existing keys first —
      // otherwise stale entity types from a prior state survive a "reset"
      // and `_resolveExpectedFirstSeq`'s leading-gap acceptance becomes
      // incorrect (the gap is only safe if the full-state op truly resets).
      if (isReplayFullStateOpType(processOpType)) {
        const fullState =
          processPayload &&
          typeof processPayload === 'object' &&
          'appDataComplete' in processPayload
            ? (processPayload as { appDataComplete: unknown }).appDataComplete
            : processPayload;
        // A malformed full-state op (null/primitive payload) would silently
        // wipe state if we cleared first. Refuse to replay it — a corrupt
        // SYNC_IMPORT is invariant-breaking, not a no-op.
        if (!fullState || typeof fullState !== 'object') {
          throw new Error(
            `SNAPSHOT_REPLAY_INCOMPLETE: ${processOpType} op ${row.id} has non-object payload`,
          );
        }
        for (const key of Object.keys(state)) {
          delete state[key];
        }
        // Copy key-by-key (not Object.assign) so a malicious `__proto__`
        // key in the client-uploaded payload cannot pollute Object's
        // prototype via the `__proto__` setter. JSON.parse creates
        // `__proto__` as an own data property (no setter), but
        // Object.assign would then `state['__proto__'] = …`, which DOES
        // trigger the setter and pollute the prototype chain.
        const fullStateRecord = fullState as Record<string, unknown>;
        for (const key of Object.keys(fullStateRecord)) {
          if (isUnsafeEntityKey(key)) continue;
          state[key] = fullStateRecord[key] as Record<string, unknown>;
        }
        forceStateSizeMeasurement = true;
        continue;
      }

      if (!ALLOWED_ENTITY_TYPES.has(processEntityType)) continue;

      if (!state[processEntityType]) {
        state[processEntityType] = {};
      }

      // Client-supplied id used as a property key. Bracket-assignment of
      // `__proto__` (or `constructor`/`prototype`) invokes the
      // `Object.prototype.__proto__` setter, which would swap the prototype
      // of the entity map and let malicious payload keys leak via the
      // prototype chain. Skip these keys entirely.
      if (processEntityId && isUnsafeEntityKey(processEntityId)) {
        continue;
      }
      switch (processOpType) {
        case 'CRT':
        case 'UPD':
          if (processEntityId) {
            state[processEntityType][processEntityId] = {
              ...(state[processEntityType][processEntityId] as Record<string, unknown>),
              ...(processPayload as Record<string, unknown>),
            };
          }
          break;
        case 'DEL':
          if (processEntityId) {
            delete state[processEntityType][processEntityId];
          }
          break;
        case 'MOV':
          if (processEntityId && processPayload) {
            state[processEntityType][processEntityId] = {
              ...(state[processEntityType][processEntityId] as Record<string, unknown>),
              ...(processPayload as Record<string, unknown>),
            };
          }
          break;
        case 'BATCH':
          if (processPayload && typeof processPayload === 'object') {
            const batchPayload = processPayload as Record<string, unknown>;
            if (batchPayload.entities && typeof batchPayload.entities === 'object') {
              const entities = batchPayload.entities as Record<string, unknown>;
              for (const [id, entity] of Object.entries(entities)) {
                // Same prototype-pollution guard as the per-op entityId
                // check: JSON.parse can produce `__proto__` as an own data
                // property of `entities`, and `state[type][id] = …` with
                // that id would trigger the setter.
                if (isUnsafeEntityKey(id)) continue;
                state[processEntityType][id] = {
                  ...(state[processEntityType][id] as Record<string, unknown>),
                  ...(entity as Record<string, unknown>),
                };
              }
            } else if (processEntityId) {
              state[processEntityType][processEntityId] = {
                ...(state[processEntityType][processEntityId] as Record<string, unknown>),
                ...batchPayload,
              };
            }
          }
          break;
      }
    }

    if (
      forceStateSizeMeasurement ||
      estimatedBytes + accumulatedDeltaBytes > REPLAY_SIZE_CHECK_THRESHOLD_BYTES
    ) {
      estimatedBytes = assertReplayStateSize(state);
      accumulatedDeltaBytes = 0;
    }
  }
  // `estimatedBytes + accumulatedDeltaBytes` is a proven over-estimate of the
  // true serialized size (payload byteLength upper-bounds merged growth, DEL
  // contributes 0, entity-key overhead is padded). When it is within the cap
  // the true size is too, so the exact final measurement is provably
  // redundant — skipping it keeps the common small/incremental replay at zero
  // expensive full stringifications. The exact check still runs (and throws)
  // whenever the bound does not prove safety; any state that truly exceeds
  // the cap pushes the over-estimate past it and trips this.
  if (estimatedBytes + accumulatedDeltaBytes > MAX_REPLAY_STATE_SIZE_BYTES) {
    assertReplayStateSize(state);
  }
  return state;
};

/**
 * Decide where contiguity checking should start for the current batch.
 *
 * The replay base may sit below the lowest op that physically exists, e.g.:
 *   - After a clean-slate upload (`sync.service.ts` preserves `lastSeq` but deletes ops).
 *   - After retention pruning (`deleteOldestRestorePointAndOps`) trimmed older ops.
 * In both cases the surviving lowest-seq op is guaranteed to be a full-state op
 * (SYNC_IMPORT / BACKUP_IMPORT / REPAIR) that resets state during replay. Accept
 * this leading gap only on the first batch and only when that invariant holds;
 * mid-stream gaps still indicate corruption and must throw.
 */
export const _resolveExpectedFirstSeq = (
  batchOps: ReplayOperationRow[],
  currentSeq: number,
  startSeq: number,
  targetSeq: number,
): number => {
  if (currentSeq !== startSeq || batchOps.length === 0) {
    return currentSeq + 1;
  }
  const firstOp = batchOps[0];
  if (firstOp.serverSeq <= currentSeq + 1) {
    return currentSeq + 1;
  }
  const isFullStateOp =
    firstOp.opType === 'SYNC_IMPORT' ||
    firstOp.opType === 'BACKUP_IMPORT' ||
    firstOp.opType === 'REPAIR';
  if (!isFullStateOp) {
    throw new Error(
      `SNAPSHOT_REPLAY_INCOMPLETE: Expected operation serverSeq ${currentSeq + 1} but got ${firstOp.serverSeq} while replaying to ${targetSeq}`,
    );
  }
  return firstOp.serverSeq;
};
