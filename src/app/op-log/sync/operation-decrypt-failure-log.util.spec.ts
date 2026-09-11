import {
  buildDecryptFailureLogArgs,
  MAX_LOGGED_DECRYPT_FAILURES,
} from './operation-decrypt-failure-log.util';
import { OperationBatchDecryptionDiagnosis } from './operation-encryption.service';
import { MAX_DATA_LENGTH } from '../../core/log';

describe('buildDecryptFailureLogArgs', () => {
  const serverOp = (
    serverSeq: number,
    id: string,
  ): { serverSeq: number; op: { id: string } } => ({
    serverSeq,
    op: { id },
  });

  const diagnosisWith = (
    partial: Partial<OperationBatchDecryptionDiagnosis>,
  ): OperationBatchDecryptionDiagnosis => ({
    encryptedOperationCount: 1,
    decryptedCount: 0,
    parsedCount: 0,
    passwordEvidence: 'no-operation-decrypted',
    failures: [],
    ...partial,
  });

  it('maps a failure to its server sequence by batch index, not by untrusted id', () => {
    // Both envelopes carry the same id; only the index may pick the seq.
    const [summary, ...failures] = buildDecryptFailureLogArgs(
      diagnosisWith({
        encryptedOperationCount: 2,
        decryptedCount: 1,
        parsedCount: 1,
        passwordEvidence: 'confirmed-for-some-operations',
        failures: [
          {
            operationId: 'op-dup',
            encryptedBatchIndex: 1,
            stage: 'decrypt',
            errorName: 'OperationError',
          },
        ],
      }),
      [serverOp(41, 'op-dup'), serverOp(42, 'op-dup')],
      0,
    );

    expect(summary).toEqual({
      encryptedOperationCount: 2,
      decryptedCount: 1,
      parsedCount: 1,
      decryptedOpsInEarlierBatches: 0,
      passwordEvidence: 'confirmed-for-some-operations',
      failureCount: 1,
    });
    expect(failures).toEqual([
      {
        opId: 'op-dup',
        encryptedBatchIndex: 1,
        stage: 'decrypt',
        errorName: 'OperationError',
        serverSeq: 42,
      },
    ]);
  });

  it('omits serverSeq when the envelope at the index does not carry the attributed op', () => {
    const [, failure] = buildDecryptFailureLogArgs(
      diagnosisWith({
        failures: [{ operationId: 'op-a', encryptedBatchIndex: 0, stage: 'decrypt' }],
      }),
      [serverOp(7, 'a-different-op')],
      0,
    );

    expect(failure).toEqual({
      opId: 'op-a',
      encryptedBatchIndex: 0,
      stage: 'decrypt',
    });
  });

  it('caps logged failures while reporting the systemic wrong-password shape', () => {
    const failures = Array.from({ length: 500 }, (_, i) => ({
      operationId: `op-${i}`,
      encryptedBatchIndex: i,
      stage: 'decrypt' as const,
      errorName: 'OperationError',
    }));
    const args = buildDecryptFailureLogArgs(
      diagnosisWith({
        encryptedOperationCount: 500,
        passwordEvidence: 'no-operation-decrypted',
        failures,
      }),
      failures.map((f, i) => serverOp(i + 1, f.operationId)),
      0,
    );

    expect(args.length).toBe(1 + MAX_LOGGED_DECRYPT_FAILURES);
    expect(args[0].passwordEvidence).toBe('no-operation-decrypted');
    expect(args[0].failureCount).toBe(500);
  });

  it('promotes password evidence when earlier batches decrypted with the same key', () => {
    // The #9256 shape: a single corrupt op alone on the final page decrypts
    // nothing in ITS batch, but the pages before it prove the password.
    const [summary] = buildDecryptFailureLogArgs(
      diagnosisWith({
        failures: [{ operationId: 'op-final', encryptedBatchIndex: 0, stage: 'decrypt' }],
      }),
      [serverOp(43, 'op-final')],
      42,
    );

    expect(summary.passwordEvidence).toBe('confirmed-for-some-operations');
    expect(summary.decryptedOpsInEarlierBatches).toBe(42);
  });

  it('reports a batch-runtime-only failure as a lone summary with full counts', () => {
    const args = buildDecryptFailureLogArgs(
      diagnosisWith({
        encryptedOperationCount: 3,
        decryptedCount: 3,
        parsedCount: 3,
        passwordEvidence: 'confirmed-for-some-operations',
        failures: [],
      }),
      [serverOp(1, 'op-1'), serverOp(2, 'op-2'), serverOp(3, 'op-3')],
      0,
    );

    expect(args.length).toBe(1);
    expect(args[0].failureCount).toBe(0);
    expect(args[0].decryptedCount).toBe(3);
  });

  it('clamps oversized op ids for display but id-matches on the full value', () => {
    const longId = 'x'.repeat(255);
    const [, failure] = buildDecryptFailureLogArgs(
      diagnosisWith({
        failures: [{ operationId: longId, encryptedBatchIndex: 0, stage: 'decrypt' }],
      }),
      [serverOp(9, longId)],
      0,
    );

    expect(failure.opId).toBe('x'.repeat(64));
    // Clamping must not defeat the envelope id-guard.
    expect(failure.serverSeq).toBe(9);
  });

  it('keeps every arg under the log-export truncation cap at maximal field sizes', () => {
    // Log.exportLogHistory() turns any arg whose JSON exceeds MAX_DATA_LENGTH
    // into an unparseable 'short:...' string — the whole reason the builder
    // returns separate args instead of one payload.
    const longId = 'y'.repeat(255);
    const failures = Array.from({ length: 3 }, (_, i) => ({
      operationId: longId,
      encryptedBatchIndex: i,
      stage: 'decrypt' as const,
      errorName: 'WebCryptoNotAvailableError',
    }));
    const args = buildDecryptFailureLogArgs(
      diagnosisWith({
        encryptedOperationCount: Number.MAX_SAFE_INTEGER,
        decryptedCount: Number.MAX_SAFE_INTEGER,
        parsedCount: Number.MAX_SAFE_INTEGER,
        failures,
      }),
      // Matching envelopes so the entries also carry the longest possible
      // serverSeq — the optional field that adds the most length.
      failures.map((f) => serverOp(Number.MAX_SAFE_INTEGER, f.operationId)),
      Number.MAX_SAFE_INTEGER,
    );

    expect((args[1] as { serverSeq?: number }).serverSeq).toBe(Number.MAX_SAFE_INTEGER);
    for (const arg of args) {
      expect(JSON.stringify(arg).length).toBeLessThan(MAX_DATA_LENGTH);
    }
  });
});
