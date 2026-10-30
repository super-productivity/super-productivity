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

/** Argon2id wire format: `[SALT (16)][IV (12)][ciphertext + tag]`, base64. */
const SALT_BYTE_LENGTH = 16;
/** 24 base64 chars decode to 18 bytes — the shortest whole-quantum prefix holding the salt. */
const SALT_BASE64_PREFIX_LENGTH = 24;
/** Hex chars of SHA-256(salt) kept in the log: enough to tell salts apart, not to recover one. */
const SALT_FINGERPRINT_HEX_LENGTH = 8;

export interface DecryptFailureLogSummary {
  encryptedOperationCount: number;
  decryptedCount: number;
  parsedCount: number;
  decryptedOpsInEarlierBatches: number;
  passwordEvidence: OperationBatchDecryptionDiagnosis['passwordEvidence'];
  failureCount: number;
  /** Distinct salts among the ops that decrypted in this run (incl. this batch). */
  decryptedSaltCount: number;
}

export interface DecryptFailureLogEntry {
  opId: string;
  encryptedBatchIndex: number;
  stage: OperationDecryptionFailureStage;
  errorName?: string;
  serverSeq?: number;
  /** Authoring client of the envelope at this index (untrusted, clamped). */
  clientId?: string;
  /** Length of the base64 transport payload (ASCII, so chars = bytes). */
  payloadLength?: number;
  /** First hex chars of SHA-256 of the payload's 16-byte Argon2id salt. */
  saltFingerprint?: string;
  /**
   * Whether an op with the SAME salt decrypted in this run. One device session
   * encrypts with one salt per password, so `true` with an auth failure means
   * the same derived key and points at damaged data. `false` only says another
   * session wrote it: under a different password, or the same one and damaged.
   */
  saltDecryptedInRun?: boolean;
}

interface EncryptedServerOpRef {
  serverSeq: number;
  op: { id: string; clientId?: string; payload?: unknown };
}

const clampId = (id: string): string =>
  id.length > MAX_LOGGED_OP_ID_LENGTH ? id.slice(0, MAX_LOGGED_OP_ID_LENGTH) : id;

/**
 * Hex of the 16-byte Argon2id salt that prefixes an encrypted payload, or
 * undefined when the payload is not a decodable base64 string of that shape.
 * The salt is not secret (it travels in every ciphertext); it is kept only in
 * memory and logged solely as a truncated hash. A legacy PBKDF2 payload has no
 * salt, so its "salt" is IV + ciphertext bytes and never matches another op's.
 */
export const readPayloadSaltKey = (payload: unknown): string | undefined => {
  if (typeof payload !== 'string' || payload.length < SALT_BASE64_PREFIX_LENGTH) {
    return undefined;
  }
  try {
    const prefix = atob(payload.slice(0, SALT_BASE64_PREFIX_LENGTH));
    // atob drops whitespace, so 24 chars can decode to fewer than 16 bytes.
    if (prefix.length < SALT_BYTE_LENGTH) {
      return undefined;
    }
    let hex = '';
    for (let i = 0; i < SALT_BYTE_LENGTH; i++) {
      hex += prefix.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return undefined;
  }
};

const fingerprintSaltKey = async (saltKey: string): Promise<string | undefined> => {
  try {
    const bytes = new Uint8Array(SALT_BYTE_LENGTH);
    for (let i = 0; i < SALT_BYTE_LENGTH; i++) {
      bytes[i] = parseInt(saltKey.slice(i * 2, (i + 1) * 2), 16);
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (let i = 0; i < SALT_FINGERPRINT_HEX_LENGTH / 2; i++) {
      hex += digest[i].toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    // No WebCrypto (or a broken one): the fingerprint is optional diagnostics.
    return undefined;
  }
};

/**
 * Salt keys of the ops in a failed batch that nonetheless decrypted. A batch
 * that decrypted nothing contributes none: an envelope failure aborts it before
 * any decrypt while listing only the bad envelopes. Otherwise every item
 * without a decrypt-stage failure got past AES-GCM (parse failures did).
 */
const collectDecryptedSaltKeysInBatch = (
  diagnosis: OperationBatchDecryptionDiagnosis,
  encryptedServerOps: readonly EncryptedServerOpRef[],
): string[] => {
  if (diagnosis.decryptedCount === 0) {
    return [];
  }
  const undecrypted = new Set(
    diagnosis.failures
      .filter((failure) => failure.stage !== 'parse')
      .map((failure) => failure.encryptedBatchIndex),
  );
  const keys: string[] = [];
  encryptedServerOps.forEach((serverOp, index) => {
    if (undecrypted.has(index)) {
      return;
    }
    const key = readPayloadSaltKey(serverOp.op.payload);
    if (key !== undefined) {
      keys.push(key);
    }
  });
  return keys;
};

/**
 * Builds the safe-to-log arguments for a failed encrypted download batch:
 * one summary plus up to MAX_LOGGED_DECRYPT_FAILURES failure entries. They
 * are separate args ON PURPOSE — `Log.exportLogHistory()` truncates each
 * serialized arg over `MAX_DATA_LENGTH` (400 chars) into an unparseable
 * string, so a single combined payload loses failures exactly in the
 * multi-failure case. Each arg here stays well under the cap even at the
 * clamped max opId length.
 *
 * Contains only operation and client identifiers, sequence numbers, counts,
 * payload lengths, fixed stages, sanitized error names and truncated salt
 * hashes — never ciphertext, plaintext, or key material (sync rule 9).
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
 *
 * `saltKeysDecryptedEarlier` (from `readPayloadSaltKey`) holds the salts of the
 * ops decrypted on earlier pages of the run; with the salts that decrypted in
 * this batch it answers `saltDecryptedInRun` per failure (#9256: same key and
 * damaged data, or a different key).
 */
export const buildDecryptFailureLogArgs = async (
  diagnosis: OperationBatchDecryptionDiagnosis,
  encryptedServerOps: readonly EncryptedServerOpRef[],
  decryptedOpsInEarlierBatches: number,
  saltKeysDecryptedEarlier: ReadonlySet<string> = new Set(),
): Promise<[DecryptFailureLogSummary, ...DecryptFailureLogEntry[]]> => {
  const decryptedSaltKeys = new Set(saltKeysDecryptedEarlier);
  for (const key of collectDecryptedSaltKeysInBatch(diagnosis, encryptedServerOps)) {
    decryptedSaltKeys.add(key);
  }
  const failures = await Promise.all(
    diagnosis.failures
      .slice(0, MAX_LOGGED_DECRYPT_FAILURES)
      .map(async (failure): Promise<DecryptFailureLogEntry> => {
        const candidate = encryptedServerOps[failure.encryptedBatchIndex];
        // Envelope fields are attributed only when the envelope carries the
        // failing op's id, exactly like serverSeq.
        const serverOp = candidate?.op.id === failure.operationId ? candidate : undefined;
        const payload = serverOp?.op.payload;
        const saltKey = readPayloadSaltKey(payload);
        const saltFingerprint =
          saltKey !== undefined ? await fingerprintSaltKey(saltKey) : undefined;
        return {
          opId: clampId(failure.operationId),
          encryptedBatchIndex: failure.encryptedBatchIndex,
          stage: failure.stage,
          ...(failure.errorName !== undefined ? { errorName: failure.errorName } : {}),
          ...(serverOp ? { serverSeq: serverOp.serverSeq } : {}),
          ...(typeof serverOp?.op.clientId === 'string'
            ? { clientId: clampId(serverOp.op.clientId) }
            : {}),
          ...(typeof payload === 'string' ? { payloadLength: payload.length } : {}),
          ...(saltFingerprint !== undefined ? { saltFingerprint } : {}),
          ...(saltKey !== undefined
            ? { saltDecryptedInRun: decryptedSaltKeys.has(saltKey) }
            : {}),
        };
      }),
  );
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
    decryptedSaltCount: decryptedSaltKeys.size,
  };
  return [summary, ...failures];
};
