import {
  buildDecryptFailureLogArgs,
  MAX_LOGGED_DECRYPT_FAILURES,
  readPayloadSaltKey,
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

  /** Argon2id-shaped base64 payload: [salt (16)][iv (12)][body]. */
  const payloadWithSalt = (saltByte: number, bodyLength = 20): string => {
    let bytes = '';
    for (let i = 0; i < 16; i++) bytes += String.fromCharCode((saltByte + i) % 256);
    for (let i = 0; i < 12 + bodyLength; i++) bytes += String.fromCharCode(i % 256);
    return btoa(bytes);
  };

  const encryptedServerOp = (
    serverSeq: number,
    id: string,
    payload: string,
    clientId = 'client-a',
  ): { serverSeq: number; op: { id: string; clientId: string; payload: string } } => ({
    serverSeq,
    op: { id, clientId, payload },
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

  it('maps a failure to its server sequence by batch index, not by untrusted id', async () => {
    // Both envelopes carry the same id; only the index may pick the seq.
    const [summary, ...failures] = await buildDecryptFailureLogArgs(
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
      decryptedSaltCount: 0,
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

  it('omits serverSeq when the envelope at the index does not carry the attributed op', async () => {
    const [, failure] = await buildDecryptFailureLogArgs(
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

  it('caps logged failures while reporting the systemic wrong-password shape', async () => {
    const failures = Array.from({ length: 500 }, (_, i) => ({
      operationId: `op-${i}`,
      encryptedBatchIndex: i,
      stage: 'decrypt' as const,
      errorName: 'OperationError',
    }));
    const args = await buildDecryptFailureLogArgs(
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

  it('promotes password evidence when earlier batches decrypted with the same key', async () => {
    // The #9256 shape: a single corrupt op alone on the final page decrypts
    // nothing in ITS batch, but the pages before it prove the password.
    const [summary] = await buildDecryptFailureLogArgs(
      diagnosisWith({
        failures: [{ operationId: 'op-final', encryptedBatchIndex: 0, stage: 'decrypt' }],
      }),
      [serverOp(43, 'op-final')],
      42,
    );

    expect(summary.passwordEvidence).toBe('confirmed-for-some-operations');
    expect(summary.decryptedOpsInEarlierBatches).toBe(42);
  });

  it('reports a batch-runtime-only failure as a lone summary with full counts', async () => {
    const args = await buildDecryptFailureLogArgs(
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

  it('clamps oversized op ids for display but id-matches on the full value', async () => {
    const longId = 'x'.repeat(255);
    const [, failure] = await buildDecryptFailureLogArgs(
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

  it('keeps every arg under the log-export truncation cap at maximal field sizes', async () => {
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
    const args = await buildDecryptFailureLogArgs(
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
  describe('salt and envelope diagnostics (#9256)', () => {
    it('reads the 16-byte salt prefix and rejects non-ciphertext shapes', () => {
      const key = readPayloadSaltKey(payloadWithSalt(0xa0));
      expect(key).toBe(
        Array.from({ length: 16 }, (_, i) => (0xa0 + i).toString(16)).join(''),
      );
      expect(readPayloadSaltKey('too-short')).toBeUndefined();
      expect(readPayloadSaltKey('not base64 at all, but long enough')).toBeUndefined();
      expect(readPayloadSaltKey({ some: 'object' })).toBeUndefined();
      // atob drops whitespace, so 24 chars can decode to fewer than 16 bytes.
      expect(readPayloadSaltKey('AAAA AAAA AAAA AAAA AAAA')).toBeUndefined();
    });

    it('logs clientId, payload length and a salt fingerprint, never the payload', async () => {
      const payload = payloadWithSalt(0x10);
      const args = await buildDecryptFailureLogArgs(
        diagnosisWith({
          failures: [
            {
              operationId: 'op-bad',
              encryptedBatchIndex: 0,
              stage: 'decrypt',
              errorName: 'OperationError',
            },
          ],
        }),
        [encryptedServerOp(7, 'op-bad', payload, 'client-b')],
        0,
      );
      const failure = args[1];

      expect(failure.clientId).toBe('client-b');
      expect(failure.payloadLength).toBe(payload.length);
      expect(failure.saltFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(failure.saltDecryptedInRun).toBe(false);
      const serialized = JSON.stringify(args);
      expect(serialized).not.toContain(payload);
      expect(serialized).not.toContain(payload.slice(0, 22));
      expect(serialized).not.toContain(readPayloadSaltKey(payload)!);
    });

    it('marks a failing op whose salt decrypted on an earlier page (same key, damaged data)', async () => {
      const goodSalt = readPayloadSaltKey(payloadWithSalt(0x20))!;
      const args = await buildDecryptFailureLogArgs(
        diagnosisWith({
          failures: [{ operationId: 'op-a', encryptedBatchIndex: 0, stage: 'decrypt' }],
        }),
        [encryptedServerOp(9, 'op-a', payloadWithSalt(0x20, 40))],
        5,
        new Set([goodSalt]),
      );

      expect(args[0].decryptedSaltCount).toBe(1);
      expect(args[1].saltDecryptedInRun).toBe(true);
    });

    it('marks a failing op with an unseen salt (different key) and gives distinct fingerprints', async () => {
      const args = await buildDecryptFailureLogArgs(
        diagnosisWith({
          encryptedOperationCount: 2,
          failures: [
            { operationId: 'op-a', encryptedBatchIndex: 0, stage: 'decrypt' },
            { operationId: 'op-b', encryptedBatchIndex: 1, stage: 'decrypt' },
          ],
        }),
        [
          encryptedServerOp(9, 'op-a', payloadWithSalt(0x30)),
          encryptedServerOp(10, 'op-b', payloadWithSalt(0x40)),
        ],
        5,
        new Set([readPayloadSaltKey(payloadWithSalt(0x20))!]),
      );

      expect(args[1].saltDecryptedInRun).toBe(false);
      expect(args[2].saltDecryptedInRun).toBe(false);
      expect(args[1].saltFingerprint).not.toBe(args[2].saltFingerprint);
    });

    it('counts salts that decrypted inside the failing batch (parse failures decrypted)', async () => {
      const args = await buildDecryptFailureLogArgs(
        diagnosisWith({
          encryptedOperationCount: 3,
          decryptedCount: 2,
          parsedCount: 1,
          passwordEvidence: 'confirmed-for-some-operations',
          failures: [
            { operationId: 'op-parse', encryptedBatchIndex: 1, stage: 'parse' },
            { operationId: 'op-auth', encryptedBatchIndex: 2, stage: 'decrypt' },
          ],
        }),
        [
          encryptedServerOp(1, 'op-ok', payloadWithSalt(0x50)),
          encryptedServerOp(2, 'op-parse', payloadWithSalt(0x60)),
          encryptedServerOp(3, 'op-auth', payloadWithSalt(0x50, 30)),
        ],
        0,
      );

      expect(args[0].decryptedSaltCount).toBe(2);
      expect(args[1].saltDecryptedInRun).toBe(true);
      expect(args[2].saltDecryptedInRun).toBe(true);
    });

    it('counts no salts from a batch an envelope failure aborted before decrypting', async () => {
      // Only the bad envelope is listed; the valid item was never decrypted.
      const args = await buildDecryptFailureLogArgs(
        diagnosisWith({
          encryptedOperationCount: 2,
          passwordEvidence: 'not-tested',
          failures: [
            { operationId: 'op-bad', encryptedBatchIndex: 0, stage: 'envelope' },
          ],
        }),
        [
          encryptedServerOp(1, 'op-bad', payloadWithSalt(0x80)),
          encryptedServerOp(2, 'op-unseen', payloadWithSalt(0x90)),
        ],
        0,
      );

      expect(args[0].decryptedSaltCount).toBe(0);
    });

    it('keeps an entry with every new field at maximal size under the export cap', async () => {
      const [, entry] = await buildDecryptFailureLogArgs(
        diagnosisWith({
          failures: [
            {
              operationId: 'z'.repeat(255),
              encryptedBatchIndex: Number.MAX_SAFE_INTEGER,
              stage: 'envelope',
              errorName: 'WebCryptoNotAvailableError',
            },
          ],
        }),
        // A sparse view: only the attributed index matters for the entry.
        Object.assign([], {
          [Number.MAX_SAFE_INTEGER]: encryptedServerOp(
            Number.MAX_SAFE_INTEGER,
            'z'.repeat(255),
            payloadWithSalt(0x11, 100_000),
            'c'.repeat(255),
          ),
        }),
        Number.MAX_SAFE_INTEGER,
      );

      expect(entry.clientId?.length).toBe(64);
      expect(entry.saltFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(entry.saltDecryptedInRun).toBe(false);
      expect(JSON.stringify(entry).length).toBeLessThan(MAX_DATA_LENGTH);
    });

    it('attributes no envelope fields when the envelope at the index carries another op', async () => {
      const [, failure] = await buildDecryptFailureLogArgs(
        diagnosisWith({
          failures: [{ operationId: 'op-a', encryptedBatchIndex: 0, stage: 'decrypt' }],
        }),
        [encryptedServerOp(3, 'other-op', payloadWithSalt(0x70))],
        0,
      );

      expect(failure).toEqual({
        opId: 'op-a',
        encryptedBatchIndex: 0,
        stage: 'decrypt',
      });
    });
  });
});
