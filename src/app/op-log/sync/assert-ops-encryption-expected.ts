import { SyncOperation } from '../sync-providers/provider.interface';
import { OperationIntegrityError } from '../core/errors/sync-errors';
import { SyncLog } from '../../core/log';

/**
 * Fails closed when a mandatory-encryption op stream contains a PLAINTEXT op.
 *
 * The `isPayloadEncrypted` flag is itself unauthenticated plaintext metadata
 * (GHSA-8pxh-mgc7-gp3g). A compromised SuperSync server or a MITM can set it to
 * `false` and supply a fully attacker-authored plaintext op. Such an op skips
 * decryption AND the payload/metadata integrity check
 * (`assertDecryptedOpMetadataIntegrity`) entirely and is applied verbatim —
 * arbitrary op forgery on an encryption-mandatory client, strictly more powerful
 * than retagging a genuine ciphertext op.
 *
 * Why rejecting is safe (no legit plaintext to lose): SuperSync makes encryption
 * mandatory, and enabling it re-uploads all data encrypted after deleting the
 * server copy (`SuperSyncEncryptionToggleService.enableEncryption` →
 * `deleteAndReuploadWithNewEncryption`). So once encryption is active, NO
 * legitimate plaintext op remains on the server; any inbound plaintext op is
 * stale or injected → reject the whole batch (fail closed).
 *
 * This is the SuperSync op-level mirror of the file-based download guard
 * (GHSA-vrc7) and the `EncryptNoPasswordError` upload guard (GHSA-9544). Callers
 * must scope `isEncryptionExpected` to the mandatory-encryption provider
 * (`isEncryptionMandatory`) with encryption enabled in config
 * (`isEncryptionEnabled()`, NOT key presence — the key can be transiently gone
 * in the dropped-credential state while encryption is still mandatory).
 * File-snapshot providers have different, non-mandatory semantics and their own
 * download guard, and a never-encrypted SuperSync account
 * (`isEncryptionEnabled() === false`) legitimately carries plaintext.
 *
 * @throws OperationIntegrityError if any op is not flagged encrypted.
 */
export const assertOpsEncryptedWhenExpected = (
  ops: readonly SyncOperation[],
  isEncryptionExpected: boolean,
): void => {
  if (!isEncryptionExpected) {
    return;
  }
  const plaintextOp = ops.find((op) => op.isPayloadEncrypted !== true);
  if (!plaintextOp) {
    return;
  }

  // Log ids only — never payload content (op log is exportable). Rule 9.
  SyncLog.err(
    '[assertOpsEncryptedWhenExpected] received a plaintext op while encryption is mandatory — rejecting (possible sync-server tampering/downgrade)',
    {
      opId: plaintextOp.id,
      entityType: plaintextOp.entityType,
      actionType: plaintextOp.actionType,
    },
  );
  throw new OperationIntegrityError(
    `Operation ${plaintextOp.id} is unencrypted but encryption is mandatory ` +
      `(possible sync-server tampering/downgrade). GHSA-8pxh-mgc7-gp3g`,
  );
};
