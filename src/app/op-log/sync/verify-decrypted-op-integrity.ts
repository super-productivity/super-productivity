import { extractActionPayload } from '@sp/sync-core';
import { SyncOperation } from '../sync-providers/provider.interface';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import { isSingletonEntityId } from '../core/entity-registry';
import { OperationIntegrityError } from '../core/errors/sync-errors';
import { ACTION_TYPE_ALIASES } from '../apply/operation-converter.util';
import { SyncLog } from '../../core/log';

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
 * boundary. Still OPEN pending the durable fix (bind metadata as GCM AAD behind
 * an envelope-versioned migration):
 *  - `opType` promotion to a full-state (`loadAllData`) op.
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
