import { Injectable } from '@angular/core';
import { decrypt, decryptBatch, encrypt, encryptBatch } from '@sp/sync-core';
import { SyncOperation } from '../sync-providers/provider.interface';
import { DecryptError } from '../core/errors/sync-errors';

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
    try {
      const parsedPayload = JSON.parse(decryptedStr);
      return {
        ...op,
        payload: parsedPayload,
        isPayloadEncrypted: false,
      };
    } catch (e) {
      throw new DecryptError('Failed to parse decrypted operation payload as JSON', e);
    }
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

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.isPayloadEncrypted) {
        if (typeof op.payload !== 'string') {
          throw new DecryptError(
            `Encrypted payload must be a string (op ${op.id} has ${typeof op.payload})`,
          );
        }
        encryptedOps.push({ index: i, op });
      } else {
        results[i] = op;
      }
    }

    if (encryptedOps.length === 0) {
      return ops;
    }

    const encryptedPayloads = encryptedOps.map((item) => item.op.payload as string);
    let decryptedStrings: string[];
    try {
      decryptedStrings = await decryptBatch(encryptedPayloads, encryptKey);
    } catch (e) {
      throw new DecryptError('Failed to decrypt operation payloads', e);
    }

    for (let i = 0; i < encryptedOps.length; i++) {
      const { index, op } = encryptedOps[i];
      try {
        const parsedPayload = JSON.parse(decryptedStrings[i]);
        results[index] = {
          ...op,
          payload: parsedPayload,
          isPayloadEncrypted: false,
        };
      } catch (e) {
        throw new DecryptError('Failed to parse decrypted operation payload', e);
      }
    }

    return results;
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
