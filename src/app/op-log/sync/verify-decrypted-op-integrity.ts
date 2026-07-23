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
import { AppDataComplete, MODEL_CONFIGS } from '../model/model-config';

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

let _autoFixTypiaErrorsPromise:
  | Promise<typeof import('../validation/auto-fix-typia-errors').autoFixTypiaErrors>
  | undefined;

const _loadAutoFixTypiaErrors = (): Promise<
  typeof import('../validation/auto-fix-typia-errors').autoFixTypiaErrors
> => {
  if (!_autoFixTypiaErrorsPromise) {
    _autoFixTypiaErrorsPromise = import('../validation/auto-fix-typia-errors')
      .then((m) => m.autoFixTypiaErrors)
      .catch((err) => {
        _autoFixTypiaErrorsPromise = undefined;
        throw err;
      });
  }
  return _autoFixTypiaErrorsPromise;
};

/**
 * A typia error whose path points BELOW a top-level root (has a nested `.`/`[`
 * segment after `$input.<root>`) — e.g. `$input.issueProvider.entities["x"]
 * .allowFetchFallback`. Such an error proves the root container is PRESENT; only
 * a field inside it drifted. A bare-root error (`$input.globalConfig`) is NOT
 * field-level: the whole section is missing.
 *
 * CAVEAT: "present" is not "well-formed" — typia also descends into a present but
 * DEGENERATE container (`globalConfig: {}` or `[]`) and reports only nested errors.
 * So this predicate alone does not prove the root is the right container KIND;
 * `_hasWrongRootContainerKind` is its companion guard on the heal path.
 */
const _isFieldLevelDriftError = (path: string): boolean => {
  const rest = path.startsWith('$input.') ? path.slice('$input.'.length) : path;
  return rest.includes('.') || rest.includes('[');
};

const _isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * True if any PRESENT top-level root has the wrong container kind (array vs
 * object) versus its model default. typia descends into a present-but-mis-typed
 * root and emits only nested errors (never a bare-root error), so without this a
 * `globalConfig: []` would pass `_isFieldLevelDriftError` and then be rebuilt
 * wholesale by `autoFixTypiaErrors`' globalConfig catch-all — healing a malformed
 * container into a "valid" snapshot. A genuine snapshot never carries a mis-typed
 * root; absent/null roots are left to typia's (non-field-level) bare-root errors.
 * Codex-review finding, #9256.
 */
const _hasWrongRootContainerKind = (state: unknown): boolean => {
  if (!_isRecord(state)) {
    return true;
  }
  return Object.entries(MODEL_CONFIGS).some(([key, cfg]) => {
    const value = state[key];
    return (
      value !== undefined &&
      value !== null &&
      Array.isArray(value) !== Array.isArray(cfg.defaultData)
    );
  });
};

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
  if (!(typeof payloadId === 'string' && payloadId === op.entityId)) {
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
  }

  // Second vector on the same LWW update: the multi-task project-move footprint.
  assertEncryptedProjectMoveFootprintIntegrity(op, actionPayload);
};

/**
 * A task project-move LWW update declares its multi-task footprint twice: as the
 * authenticated `payload.projectMoveSubTaskIds` (inside the AES-GCM ciphertext)
 * and as the plaintext `op.entityIds` envelope field. The LWW project-repair
 * reducer (task-shared-meta-reducers/lww-update.meta-reducer.ts) trusts
 * `meta.entityIds` — copied verbatim from that envelope by convertOpToAction —
 * as the source footprint and moves EVERY declared task out of its current
 * project. A compromised sync server could therefore append victim task ids to
 * the envelope of an otherwise-valid encrypted move and orphan those tasks,
 * without touching (or being able to decrypt) the ciphertext.
 *
 * Bind the envelope footprint to the authenticated one: require exact-set
 * equality between `op.entityIds` and `{op.entityId} ∪ projectMoveSubTaskIds`.
 *
 * INTERIM hardening — only enforceable when the authenticated payload actually
 * carries a `projectMoveSubTaskIds` array. Synthetic LWW ops minted by conflict
 * resolution legitimately carry `entityIds` WITHOUT that payload field (their
 * footprint lives only in the plaintext envelope), so they cannot be validated
 * here and are intentionally left untouched to avoid rejecting valid ops. Fully
 * closing the envelope-injection vector needs the durable fix that is still
 * OPEN: bind the complete footprint as GCM AAD behind an envelope-versioned
 * migration so every producer's footprint is authenticated. GHSA-8pxh-mgc7-gp3g.
 *
 * @throws OperationIntegrityError when the declared footprint diverges from the
 *   authenticated one.
 */
const assertEncryptedProjectMoveFootprintIntegrity = (
  op: SyncOperation,
  actionPayload: Record<string, unknown> | undefined,
): void => {
  if (op.entityIds === undefined || !op.entityId) {
    return;
  }
  const subTaskIds = actionPayload?.['projectMoveSubTaskIds'];
  if (!Array.isArray(subTaskIds)) {
    // No authenticated footprint to bind against (e.g. synthetic LWW op) — see
    // the "INTERIM hardening" note above. Leave the op unchanged.
    return;
  }

  const authenticatedFootprint = new Set<string>([
    op.entityId,
    ...subTaskIds.filter((id): id is string => typeof id === 'string'),
  ]);
  // Exact-set equality: same size (no extras, no duplicates, no non-strings) and
  // every declared id is in the authenticated footprint (no injected victim id).
  const isExactSet =
    op.entityIds.length === authenticatedFootprint.size &&
    op.entityIds.every((id) => typeof id === 'string' && authenticatedFootprint.has(id));
  if (isExactSet) {
    return;
  }

  // Log ids/counts only — never payload content (op log is exportable). Rule 9.
  SyncLog.err(
    '[assertDecryptedOpMetadataIntegrity] encrypted op entityIds do not match the authenticated project-move footprint — rejecting (possible sync-server tampering)',
    {
      opId: op.id,
      entityType: op.entityType,
      opEntityId: op.entityId,
      declaredCount: op.entityIds.length,
      authenticatedCount: authenticatedFootprint.size,
      actionType: op.actionType,
    },
  );
  throw new OperationIntegrityError(
    `Operation ${op.id} failed metadata integrity check: encrypted op entityIds do ` +
      `not match the authenticated project-move footprint (possible sync-server ` +
      `tampering). GHSA-8pxh-mgc7-gp3g`,
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
 * FIELD-LEVEL SCHEMA DRIFT is likewise recoverable, not tampering: a required
 * scalar added in a later app version (e.g. JiraCfg.allowFetchFallback / #7628,
 * #9256) is simply absent from an older entity. The normal apply path heals that
 * downstream (RemoteOpsProcessingService Checkpoint D → dataRepair →
 * autoFixTypiaErrors), so a legitimate stale snapshot must NOT be rejected here as
 * forged. We therefore mirror that heal on a throwaway copy before rejecting — but
 * ONLY for errors nested inside a present root (`_isFieldLevelDriftError`) AND only
 * when every present root is the right container kind (`_hasWrongRootContainerKind`).
 * A missing top-level root (single-entity op fraudulently promoted to a full-state
 * opType) or a mis-typed root stays strict and is still rejected — the security
 * boundary is those two filters, NOT what autoFixTypiaErrors happens to be able to
 * rebuild.
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

  // Accept a structurally-complete snapshot whose only faults are recoverable
  // field drift inside present roots (see docstring). Gate strictly: every error
  // must be field-level (else a missing root is in play), AND no present root may
  // be the wrong container kind (else a mis-typed root would heal through). Either
  // failing → reject without healing.
  let validationErrorCount = validationResult.errors.length;
  if (
    validationErrorCount > 0 &&
    validationResult.errors.every((error) => _isFieldLevelDriftError(error.path)) &&
    !_hasWrongRootContainerKind(stateToValidate)
  ) {
    try {
      const autoFixTypiaErrors = await _loadAutoFixTypiaErrors();
      // Heal on a deep copy so the decrypted payload stays untouched for the
      // downstream path. structuredClone mirrors dataRepair's clone-before-heal
      // (data-repair.ts) — the same heal this gate is deliberately not stricter than.
      const healed = autoFixTypiaErrors(
        structuredClone(stateToValidate) as AppDataComplete,
        validationResult.errors,
      );
      const healedResult = validateAllData(healed);
      if (healedResult.success) {
        return;
      }
      // Report what still failed AFTER healing — the real "not complete app data"
      // signal — rather than the pre-heal count.
      validationErrorCount = healedResult.errors.length;
    } catch {
      // Fail closed: any throw while probing recoverability (e.g. the dev-only
      // devError in autoFixTypiaErrors) must not escape as a non-Integrity error —
      // fall through to the strict rejection below so callers see a consistent type.
      SyncLog.err(
        '[assertDecryptedFullStateOpIntegrity] heal probe threw — rejecting as non-full-state',
        { opId: op.id, opType: op.opType },
      );
    }
  }

  // Never log validator values: they can contain task titles, notes, and other
  // user content. `opType` is safe here because it matched the fixed allowlist.
  SyncLog.err(
    '[assertDecryptedFullStateOpIntegrity] encrypted full-state op payload is not complete app data — rejecting (possible sync-server tampering)',
    {
      opId: op.id,
      opType: op.opType,
      validationErrorCount,
    },
  );
  throw new OperationIntegrityError(
    `Operation ${op.id} failed metadata integrity check: encrypted payload is not ` +
      `valid full-state data for ${op.opType} (possible sync-server tampering). ` +
      `GHSA-8pxh-mgc7-gp3g`,
  );
};
