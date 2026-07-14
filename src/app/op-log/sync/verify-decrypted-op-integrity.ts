import { extractActionPayload } from '@sp/sync-core';
import { SyncOperation } from '../sync-providers/provider.interface';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import { isSingletonEntityId } from '../core/entity-registry';
import { OperationIntegrityError } from '../core/errors/sync-errors';
import { ACTION_TYPE_ALIASES } from '../apply/operation-converter.util';
import { SyncLog } from '../../core/log';
import {
  extractFullStateFromPayload,
  FULL_STATE_OP_TYPES,
  OpType,
} from '../core/operation.types';
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  migrateState,
} from '@sp/shared-schema';

let _validateAllDataPromise:
  | Promise<typeof import('../validation/validation-fn').validateAllData>
  | undefined;

const _loadValidateAllData = (): Promise<
  typeof import('../validation/validation-fn').validateAllData
> => {
  if (!_validateAllDataPromise) {
    _validateAllDataPromise = import('../validation/validation-fn')
      .then((m) => m.validateAllData)
      .catch((err) => {
        _validateAllDataPromise = undefined;
        throw err;
      });
  }
  return _validateAllDataPromise;
};

const _isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const _restoreKnownFullStateOmissionsForValidation = (fullState: unknown): unknown => {
  if (!_isRecord(fullState)) {
    return fullState;
  }

  // Pre-section backups are still supported by the loadAllData reducers.
  const stateForValidation = Object.hasOwn(fullState, 'section')
    ? fullState
    : { ...fullState, section: { ids: [], entities: {} } };
  const globalConfig = stateForValidation['globalConfig'];
  if (!_isRecord(globalConfig)) {
    return stateForValidation;
  }
  const syncConfig = globalConfig['sync'];
  if (!_isRecord(syncConfig) || Object.hasOwn(syncConfig, 'syncInterval')) {
    return stateForValidation;
  }

  // Snapshot uploads intentionally omit this device-local setting. Its actual
  // value is restored downstream; only its required numeric shape matters here.
  return {
    ...stateForValidation,
    globalConfig: {
      ...globalConfig,
      sync: { ...syncConfig, syncInterval: 0 },
    },
  };
};

const _migrateFullStateForValidation = (
  op: SyncOperation,
  fullState: unknown,
): unknown => {
  const rawSchemaVersion = (op as { schemaVersion?: unknown }).schemaVersion;
  const schemaVersion = rawSchemaVersion === undefined ? 1 : rawSchemaVersion;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION ||
    schemaVersion >= CURRENT_SCHEMA_VERSION
  ) {
    return fullState;
  }

  const migrationResult = migrateState(fullState, schemaVersion, CURRENT_SCHEMA_VERSION);
  return migrationResult.success ? migrationResult.data : fullState;
};

/**
 * Verifies that a just-decrypted operation's UNAUTHENTICATED metadata is
 * consistent with its AUTHENTICATED payload.
 *
 * SuperSync E2EE (AES-256-GCM) covers only `op.payload`; every other field —
 * `entityId`, `opType`, `actionType`, `vectorClock`, `timestamp`,
 * `isPayloadEncrypted`, ... — travels as plaintext beside the ciphertext and is
 * NOT bound by the GCM auth tag (no Additional Authenticated Data). A
 * malicious/compromised sync server or a TLS MITM therefore cannot read or
 * forge payload *contents*, but it CAN tamper with the metadata.
 * GHSA-8pxh-mgc7-gp3g.
 *
 * This is DEFENSE-IN-DEPTH that closes one vector: retagging an *encrypted*
 * LWW-update op with a different `entityId` to redirect the (authenticated)
 * changes onto an attacker-chosen entity. `convertOpToAction()` would otherwise
 * resolve the mismatch by trusting the tampered `op.entityId` over the
 * authenticated `payload.id` (it coerces `payload.id = op.entityId` — including
 * when `payload.id` is absent — and only warns). Here we treat the
 * authenticated `payload.id` as ground truth and fail CLOSED: an in-scope LWW op
 * whose authenticated payload does not carry a string `id` equal to
 * `op.entityId` is rejected. The gate mirrors `convertOpToAction`'s coercion
 * predicate exactly (same alias resolution, same singleton exclusion) so the two
 * boundaries cannot drift and leave a hole.
 *
 * Scope: only encrypted ops reach this boundary (it is called from the decrypt
 * path), so unencrypted ops — where neither side is authenticated and the
 * #7330 producer-drift coercion still legitimately applies — are unaffected.
 *
 * NOTE: interim hardening only. The plaintext-injection downgrade (a forged op
 * with `isPayloadEncrypted=false` that would skip decryption AND this check) is
 * handled separately by `assertOpsEncryptedWhenExpected` at the download
 * boundary. Full-state `opType` promotion is handled below by
 * `assertDecryptedFullStateOpIntegrity`. Still OPEN pending the durable fix
 * (bind metadata as GCM AAD behind an envelope-versioned migration):
 *  - Within-LWW `entityType`/`actionType` swap (ids left equal so this passes).
 *  - `vectorClock`/`timestamp` reorder/replay.
 * See GHSA-8pxh-mgc7-gp3g and
 * docs/sync-and-op-log/supersync-encryption-architecture.md.
 *
 * @throws OperationIntegrityError when tampering is detected.
 */
export const assertDecryptedOpMetadataIntegrity = (
  op: SyncOperation,
  decryptedPayload: unknown,
): void => {
  // Resolve aliases first, exactly like convertOpToAction (operation-converter
  // .util.ts) — otherwise a future LWW-action rename in ACTION_TYPE_ALIASES
  // would make this gate skip an op the converter still LWW-coerces, silently
  // reopening the retarget hole.
  const actionType = ACTION_TYPE_ALIASES[op.actionType] ?? op.actionType;

  // Only non-singleton LWW single-entity updates carry a canonical `payload.id`
  // that must equal `op.entityId`. Singletons use SINGLETON_ENTITY_ID (no `id`).
  if (
    !isLwwUpdateActionType(actionType) ||
    !op.entityId ||
    isSingletonEntityId(op.entityId)
  ) {
    return;
  }

  const actionPayload = extractActionPayload(decryptedPayload);
  const payloadId = actionPayload?.['id'];

  // Fail closed: the authenticated payload MUST carry a string `id` equal to the
  // (unauthenticated) `op.entityId`. Missing / non-string / mismatched all mean
  // the metadata cannot be trusted — convertOpToAction coerces `id = op.entityId`
  // in every one of those cases, so anything but a positive match is rejected.
  if (typeof payloadId === 'string' && payloadId === op.entityId) {
    return;
  }

  // Log ids only — never payload content (op log is exportable). Rule 9.
  SyncLog.err(
    '[assertDecryptedOpMetadataIntegrity] encrypted op entityId does not match authenticated payload.id — rejecting (possible sync-server tampering)',
    {
      opId: op.id,
      entityType: op.entityType,
      opEntityId: op.entityId,
      payloadId: typeof payloadId === 'string' ? payloadId : `<${typeof payloadId}>`,
      actionType: op.actionType,
    },
  );
  throw new OperationIntegrityError(
    `Operation ${op.id} failed metadata integrity check: encrypted payload id ` +
      `does not match op.entityId (possible sync-server tampering). ` +
      `GHSA-8pxh-mgc7-gp3g`,
  );
};

/**
 * Rejects an encrypted operation whose unauthenticated `opType` was promoted
 * to a full-state operation while its authenticated payload is not complete
 * application data.
 *
 * Full-state payloads exist in two legitimate formats: direct app data for
 * SYNC_IMPORT/BACKUP_IMPORT and an `appDataComplete` wrapper for REPAIR (plus
 * legacy wrapped imports). Validation is loaded lazily because Typia's
 * generated full-state validator is large and must stay out of the initial
 * application bundle.
 *
 * Supported legacy state is migrated on a copy before validation because this
 * boundary runs before RemoteOpsProcessingService's normal operation processing.
 * Known compatible omissions are also restored on that copy: pre-section backups
 * and the device-local sync interval intentionally stripped from wire snapshots.
 * The decrypted payload itself remains unchanged for the existing downstream path.
 * This check intentionally uses structural Typia validation only. Cross-model
 * relationship validation would turn recoverable data inconsistencies into a
 * security failure and is not needed to distinguish ordinary entity payloads
 * from complete state.
 *
 * @throws OperationIntegrityError when a full-state op carries a non-full-state payload.
 */
export const assertDecryptedFullStateOpIntegrity = async (
  op: SyncOperation,
  decryptedPayload: unknown,
): Promise<void> => {
  if (!FULL_STATE_OP_TYPES.has(op.opType as OpType)) {
    return;
  }

  const validateAllData = await _loadValidateAllData();
  const fullState = extractFullStateFromPayload(decryptedPayload);
  const migratedState = _migrateFullStateForValidation(op, fullState);
  const stateToValidate = _restoreKnownFullStateOmissionsForValidation(migratedState);
  const validationResult = validateAllData(stateToValidate);
  if (validationResult.success) {
    return;
  }

  // Never log validator values: they can contain task titles, notes, and other
  // user content. `opType` is safe here because it matched the fixed allowlist.
  SyncLog.err(
    '[assertDecryptedFullStateOpIntegrity] encrypted full-state op payload is not complete app data — rejecting (possible sync-server tampering)',
    {
      opId: op.id,
      opType: op.opType,
      validationErrorCount: validationResult.errors.length,
    },
  );
  throw new OperationIntegrityError(
    `Operation ${op.id} failed metadata integrity check: encrypted payload is not ` +
      `valid full-state data for ${op.opType} (possible sync-server tampering). ` +
      `GHSA-8pxh-mgc7-gp3g`,
  );
};
