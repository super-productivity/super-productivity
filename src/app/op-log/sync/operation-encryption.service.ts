import { Injectable } from '@angular/core';
import {
  decrypt,
  decryptBatch,
  decryptBatchSettled,
  encrypt,
  encryptBatch,
} from '@sp/sync-core';
import { SyncOperation } from '../sync-providers/provider.interface';
import { DecryptError } from '../core/errors/sync-errors';
import { isFullStateOpType } from '../core/operation.types';
import {
  assertDecryptedFullStateOpIntegrity,
  assertDecryptedOpMetadataIntegrity,
} from './verify-decrypted-op-integrity';

export type OperationDecryptionFailureStage = 'envelope' | 'decrypt' | 'parse';

export interface OperationDecryptionFailure {
  operationId: string;
  encryptedBatchIndex: number;
  stage: OperationDecryptionFailureStage;
  /**
   * Sanitized error class name (`toSyncLogError`) for decrypt-stage failures.
   * Read case by case: `OperationError` is the WebCrypto AES-GCM auth-failure
   * signature (wrong key or corrupt ciphertext) — but the no-WebCrypto
   * fallback reports the same auth failure as a bare `Error`;
   * `InvalidCiphertextError`/`InvalidCharacterError` mean mangled ciphertext;
   * `WebCryptoNotAvailableError` is an environment failure and NOT password
   * evidence. Never carries error messages.
   */
  errorName?: string;
}

/**
 * Safe-to-log classification of a failed encrypted batch. `passwordEvidence`
 * distinguishes an isolated corrupt operation from a systemically wrong key:
 * one successful decrypt in the same batch proves the key is not globally
 * wrong, so a wrong password must never be reported as a per-operation
 * failure of the first item.
 *
 * `passwordEvidence` here is BATCH-scoped. The run-scoped value (which also
 * counts pages decrypted earlier in the same download run — the #9256 shape)
 * exists only in the download layer's log payload via
 * `buildDecryptFailureLogArgs`; do not surface this field to users without
 * that promotion.
 */
export interface OperationBatchDecryptionDiagnosis {
  encryptedOperationCount: number;
  decryptedCount: number;
  parsedCount: number;
  passwordEvidence:
    | 'confirmed-for-some-operations'
    | 'no-operation-decrypted'
    | 'not-tested';
  failures: OperationDecryptionFailure[];
}

/**
 * Identifies which encrypted operations could not be processed without
 * retaining ciphertext, decrypted payloads, or the encryption key.
 * An empty `failures` list means the batch primitive failed although every
 * operation decrypted and parsed individually (a runtime-level failure).
 */
export class OperationDecryptionError extends DecryptError {
  override name = 'OperationDecryptionError';
  readonly diagnosis: OperationBatchDecryptionDiagnosis;

  constructor(diagnosis: OperationBatchDecryptionDiagnosis) {
    super('Encrypted operation batch could not be processed');
    this.diagnosis = diagnosis;
  }
}

/**
 * Handles E2E encryption/decryption of operation payloads for SuperSync.
 * Uses AES-256-GCM with Argon2id key derivation.
 *
 * The single-item and batch primitives all share the @sp/sync-core session
 * cache, so repeated calls with the same password reuse the derived key —
 * critical on mobile where Argon2id (64MB, 3 iterations) takes 500ms-2000ms.
 *
 * Tests should use real encryption with weakened Argon2 params
 * (`setArgon2ParamsForTesting({ memorySize: 8, iterations: 1 })`) rather than
 * mocking the package exports.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationEncryptionService {
  /**
   * Encrypts the payload of a SyncOperation.
   * Returns a new operation with encrypted payload and isPayloadEncrypted=true.
   */
  async encryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
    const payloadStr = JSON.stringify(op.payload);
    const encryptedPayload = await encrypt(payloadStr, encryptKey);
    return {
      ...op,
      payload: encryptedPayload,
      isPayloadEncrypted: true,
    };
  }

  /**
   * Decrypts the payload of a SyncOperation.
   * Returns a new operation with decrypted payload.
   * Throws DecryptError if decryption fails.
   * Non-encrypted operations pass through unchanged.
   */
  async decryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
    if (!op.isPayloadEncrypted) {
      return op;
    }
    if (typeof op.payload !== 'string') {
      throw new DecryptError('Encrypted payload must be a string');
    }
    let decryptedStr: string;
    try {
      decryptedStr = await decrypt(op.payload, encryptKey);
    } catch (e) {
      throw new DecryptError('Failed to decrypt operation payload', e);
    }
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(decryptedStr);
    } catch (e) {
      throw new DecryptError('Failed to parse decrypted operation payload as JSON', e);
    }
    // Verify the untrusted metadata against the now-authenticated payload before
    // trusting it downstream (GHSA-8pxh-mgc7-gp3g). Throws on tampering.
    assertDecryptedOpMetadataIntegrity(op, parsedPayload);
    if (isFullStateOpType(op.opType)) {
      await assertDecryptedFullStateOpIntegrity(op, parsedPayload);
    }
    return {
      ...op,
      payload: parsedPayload,
      isPayloadEncrypted: false,
    };
  }

  /**
   * Batch encrypt operations for upload. Derives the Argon2id key once.
   */
  async encryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    if (ops.length === 0) {
      return [];
    }

    const payloadStrings = ops.map((op) => JSON.stringify(op.payload));
    const encryptedPayloads = await encryptBatch(payloadStrings, encryptKey);

    return ops.map((op, index) => ({
      ...op,
      payload: encryptedPayloads[index],
      isPayloadEncrypted: true,
    }));
  }

  /**
   * Batch decrypt operations after download. Caches keys by salt.
   * Non-encrypted ops pass through unchanged.
   */
  async decryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    if (ops.length === 0) {
      return [];
    }

    const encryptedOps: { index: number; op: SyncOperation }[] = [];
    const results: SyncOperation[] = new Array(ops.length);
    const envelopeFailures: OperationDecryptionFailure[] = [];
    let encryptedOpCount = 0;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.isPayloadEncrypted) {
        const encryptedBatchIndex = encryptedOpCount++;
        if (typeof op.payload !== 'string') {
          envelopeFailures.push({
            operationId: op.id,
            encryptedBatchIndex,
            stage: 'envelope',
          });
        } else {
          encryptedOps.push({ index: i, op });
        }
      } else {
        results[i] = op;
      }
    }

    if (envelopeFailures.length > 0) {
      throw new OperationDecryptionError({
        encryptedOperationCount: encryptedOpCount,
        decryptedCount: 0,
        parsedCount: 0,
        passwordEvidence: 'not-tested',
        failures: envelopeFailures,
      });
    }

    if (encryptedOps.length === 0) {
      return ops;
    }

    const encryptedPayloads = encryptedOps.map((item) => item.op.payload as string);
    let decryptedStrings: string[];
    try {
      decryptedStrings = await decryptBatch(encryptedPayloads, encryptKey);
    } catch {
      throw await this._diagnoseFailedBatch(encryptedOps, encryptedPayloads, encryptKey);
    }

    for (let i = 0; i < encryptedOps.length; i++) {
      const { index, op } = encryptedOps[i];
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(decryptedStrings[i]);
      } catch {
        throw new OperationDecryptionError(
          this._diagnoseParseFailures(encryptedOps, decryptedStrings),
        );
      }
      // Verify the untrusted metadata against the now-authenticated payload
      // before trusting it downstream (GHSA-8pxh-mgc7-gp3g). Throws on tampering.
      assertDecryptedOpMetadataIntegrity(op, parsedPayload);
      if (isFullStateOpType(op.opType)) {
        await assertDecryptedFullStateOpIntegrity(op, parsedPayload);
      }
      results[index] = {
        ...op,
        payload: parsedPayload,
        isPayloadEncrypted: false,
      };
    }

    return results;
  }

  /**
   * The batch primitive does not identify which ciphertext failed. Re-check
   * every item via `decryptBatchSettled` only after a batch failure so a
   * wrong key (all items fail) is distinguishable from isolated corruption
   * (some items decrypt). The settled primitive keeps a batch-local key map,
   * so pages spanning more unique salts than the session cache holds cannot
   * thrash Argon2id re-derivations. Each plaintext is parse-checked and
   * discarded, never retained on the returned error.
   */
  private async _diagnoseFailedBatch(
    encryptedOps: { index: number; op: SyncOperation }[],
    encryptedPayloads: string[],
    encryptKey: string,
  ): Promise<Error> {
    try {
      const settled = await decryptBatchSettled(encryptedPayloads, encryptKey);
      const failures: OperationDecryptionFailure[] = [];
      let decryptedCount = 0;
      let parsedCount = 0;
      for (let i = 0; i < settled.length; i++) {
        const item = settled[i];
        if (!item.ok) {
          failures.push({
            operationId: encryptedOps[i].op.id,
            encryptedBatchIndex: i,
            stage: 'decrypt',
            errorName: item.errorName,
          });
          continue;
        }
        decryptedCount++;
        if (this._isParseableJson(item.plaintext)) {
          parsedCount++;
        } else {
          failures.push({
            operationId: encryptedOps[i].op.id,
            encryptedBatchIndex: i,
            stage: 'parse',
          });
        }
      }
      return new OperationDecryptionError({
        encryptedOperationCount: encryptedOps.length,
        decryptedCount,
        parsedCount,
        passwordEvidence:
          decryptedCount > 0 ? 'confirmed-for-some-operations' : 'no-operation-decrypted',
        failures,
      });
    } catch {
      // Diagnosis is best-effort and must never mask the original batch failure.
      return new DecryptError('Failed to decrypt operation payloads');
    }
  }

  /**
   * Batch decryption succeeded but at least one plaintext is not valid JSON.
   * Classify every item so all parse failures are reported at once.
   */
  private _diagnoseParseFailures(
    encryptedOps: { index: number; op: SyncOperation }[],
    decryptedStrings: string[],
  ): OperationBatchDecryptionDiagnosis {
    const failures: OperationDecryptionFailure[] = [];
    let parsedCount = 0;
    for (let i = 0; i < decryptedStrings.length; i++) {
      if (this._isParseableJson(decryptedStrings[i])) {
        parsedCount++;
      } else {
        failures.push({
          operationId: encryptedOps[i].op.id,
          encryptedBatchIndex: i,
          stage: 'parse',
        });
      }
    }
    return {
      encryptedOperationCount: encryptedOps.length,
      decryptedCount: decryptedStrings.length,
      parsedCount,
      passwordEvidence: 'confirmed-for-some-operations',
      failures,
    };
  }

  private _isParseableJson(value: string): boolean {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Encrypts an arbitrary payload (for snapshot uploads).
   */
  async encryptPayload(payload: unknown, encryptKey: string): Promise<string> {
    const payloadStr = JSON.stringify(payload);
    return encrypt(payloadStr, encryptKey);
  }

  /**
   * Decrypts an encrypted payload string and JSON-parses the result.
   */
  async decryptPayload<T = unknown>(
    encryptedPayload: string,
    encryptKey: string,
  ): Promise<T> {
    let decryptedStr: string;
    try {
      decryptedStr = await decrypt(encryptedPayload, encryptKey);
    } catch (e) {
      throw new DecryptError('Failed to decrypt payload', e);
    }
    try {
      return JSON.parse(decryptedStr) as T;
    } catch (e) {
      throw new DecryptError('Failed to parse decrypted payload as JSON', e);
    }
  }
}
