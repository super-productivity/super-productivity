import {
  OperationBatchDecryptionDiagnosis,
  OperationDecryptionFailureStage,
} from './operation-encryption.service';

/**
 * Wrong-password batches fail on every operation; logging one capped sample
 * plus the total keeps the exported Logs readable while `failureCount` and
 * `passwordEvidence` still make the systemic case unambiguous.
 */
export const MAX_LOGGED_DECRYPT_FAILURES = 3;

/**
 * Op ids are server-controlled free text up to 255 chars by schema; clamping
 * keeps a hostile server from padding the support entry and keeps each
 * failure arg well under the log-export truncation cap. UUIDs (36 chars, the
 * norm) are never clamped.
 */
const MAX_LOGGED_OP_ID_LENGTH = 64;

export interface DecryptFailureLogSummary {
  encryptedOperationCount: number;
  decryptedCount: number;
  parsedCount: number;
  decryptedOpsInEarlierBatches: number;
  passwordEvidence: OperationBatchDecryptionDiagnosis['passwordEvidence'];
  failureCount: number;
}

export interface DecryptFailureLogEntry {
  opId: string;
  encryptedBatchIndex: number;
  stage: OperationDecryptionFailureStage;
  errorName?: string;
  serverSeq?: number;
}

interface EncryptedServerOpRef {
  serverSeq: number;
  op: { id: string };
}

/**
 * Builds the safe-to-log arguments for a failed encrypted download batch:
 * one summary plus up to MAX_LOGGED_DECRYPT_FAILURES failure entries. They
 * are separate args ON PURPOSE — `Log.exportLogHistory()` truncates each
 * serialized arg over `MAX_DATA_LENGTH` (400 chars) into an unparseable
 * string, so a single combined payload loses failures exactly in the
 * multi-failure case. Each arg here stays well under the cap even at the
 * clamped max opId length.
 *
 * Contains only operation identifiers, sequence numbers, counts, fixed
 * stages, and sanitized error names — never ciphertext, plaintext, or key
 * material (sync rule 9).
 *
 * `encryptedServerOps` must be the same isPayloadEncrypted-filtered, ordered
 * view of the page the encryption service classified, so `encryptedBatchIndex`
 * maps back to a server envelope. `serverSeq` is attached per failure only
 * when the envelope at that index carries the attributed operation id — the
 * ids are untrusted and the mapping must never mislabel an operation.
 *
 * `decryptedOpsInEarlierBatches` carries run-level password evidence across
 * pages: a failure on page N with pages 1..N-1 decrypted proves the password
 * is not globally wrong even when nothing in the failing batch decrypted.
 * (The batch-level `decryptedCount > 0` case is already folded into
 * `diagnosis.passwordEvidence` by its producers — only the cross-page
 * promotion happens here.)
 */
export const buildDecryptFailureLogArgs = (
  diagnosis: OperationBatchDecryptionDiagnosis,
  encryptedServerOps: readonly EncryptedServerOpRef[],
  decryptedOpsInEarlierBatches: number,
): [DecryptFailureLogSummary, ...DecryptFailureLogEntry[]] => {
  const failures = diagnosis.failures
    .slice(0, MAX_LOGGED_DECRYPT_FAILURES)
    .map((failure): DecryptFailureLogEntry => {
      const serverOp = encryptedServerOps[failure.encryptedBatchIndex];
      return {
        opId:
          failure.operationId.length > MAX_LOGGED_OP_ID_LENGTH
            ? failure.operationId.slice(0, MAX_LOGGED_OP_ID_LENGTH)
            : failure.operationId,
        encryptedBatchIndex: failure.encryptedBatchIndex,
        stage: failure.stage,
        ...(failure.errorName !== undefined ? { errorName: failure.errorName } : {}),
        ...(serverOp?.op.id === failure.operationId
          ? { serverSeq: serverOp.serverSeq }
          : {}),
      };
    });
  const summary: DecryptFailureLogSummary = {
    encryptedOperationCount: diagnosis.encryptedOperationCount,
    decryptedCount: diagnosis.decryptedCount,
    parsedCount: diagnosis.parsedCount,
    decryptedOpsInEarlierBatches,
    passwordEvidence:
      decryptedOpsInEarlierBatches > 0
        ? 'confirmed-for-some-operations'
        : diagnosis.passwordEvidence,
    failureCount: diagnosis.failures.length,
  };
  return [summary, ...failures];
};
