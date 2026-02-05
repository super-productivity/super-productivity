import { inject, Injectable } from '@angular/core';
import {
  ENCRYPT_FN,
  DECRYPT_FN,
  ENCRYPT_BATCH_FN,
  DECRYPT_BATCH_FN,
} from '../encryption/encryption.token';
import { SyncOperation } from '../sync-providers/provider.interface';
import { DecryptError } from '../core/errors/sync-errors';

/**
 * Handles E2E encryption/decryption of operation payloads for SuperSync.
 * Uses AES-256-GCM with Argon2id key derivation (same as legacy sync providers).
 *
 * PERFORMANCE OPTIMIZATION:
 * Batch encrypt/decrypt methods use key caching to avoid expensive Argon2id
 * derivation (64MB, 3 iterations) for each operation. On mobile devices, this
 * can reduce sync time from minutes to seconds when processing many operations.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationEncryptionService {
  private readonly _encrypt = inject(ENCRYPT_FN);
  private readonly _decrypt = inject(DECRYPT_FN);
  private readonly _encryptBatch = inject(ENCRYPT_BATCH_FN);
  private readonly _decryptBatch = inject(DECRYPT_BATCH_FN);

  /**
   * Encrypts the payload of a SyncOperation.
   * Returns a new operation with encrypted payload and isPayloadEncrypted=true.
   */
  async encryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
    const payloadStr = JSON.stringify(op.payload);
    const encryptedPayload = await this._encrypt(payloadStr, encryptKey);
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
      decryptedStr = await this._decrypt(op.payload, encryptKey);
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
   * Batch encrypt operations for upload.
   * OPTIMIZED: Derives Argon2id key once instead of per-operation.
   * This is critical for mobile performance.
   */
  async encryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    if (ops.length === 0) {
      return [];
    }

    // Convert payloads to strings for batch encryption
    const payloadStrings = ops.map((op) => JSON.stringify(op.payload));

    // Encrypt all payloads with a single key derivation
    const encryptedPayloads = await this._encryptBatch(payloadStrings, encryptKey);

    // Reconstruct operations with encrypted payloads
    return ops.map((op, index) => ({
      ...op,
      payload: encryptedPayloads[index],
      isPayloadEncrypted: true,
    }));
  }

  /**
   * Batch decrypt operations after download.
   * Non-encrypted ops pass through unchanged.
   * OPTIMIZED: Caches Argon2id keys by salt to avoid redundant derivations.
   * This is critical for mobile performance.
   */
  async decryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    if (ops.length === 0) {
      return [];
    }

    // Separate encrypted and non-encrypted operations
    const encryptedOps: { index: number; op: SyncOperation }[] = [];
    const results: SyncOperation[] = new Array(ops.length);

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.isPayloadEncrypted) {
        // Validate that encrypted payloads are strings (matching single-op behavior)
        if (typeof op.payload !== 'string') {
          throw new DecryptError(
            `Encrypted payload must be a string (op ${op.id} has ${typeof op.payload})`,
          );
        }
        encryptedOps.push({ index: i, op });
      } else {
        // Non-encrypted ops pass through unchanged
        results[i] = op;
      }
    }

    if (encryptedOps.length === 0) {
      return ops;
    }

    // Batch decrypt all encrypted payloads
    const encryptedPayloads = encryptedOps.map((item) => item.op.payload as string);
    let decryptedStrings: string[];
    try {
      decryptedStrings = await this._decryptBatch(encryptedPayloads, encryptKey);
    } catch (e) {
      throw new DecryptError('Failed to decrypt operation payloads', e);
    }

    // Reconstruct operations with decrypted payloads
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
   * Returns the encrypted string.
   */
  async encryptPayload(payload: unknown, encryptKey: string): Promise<string> {
    const payloadStr = JSON.stringify(payload);
    return this._encrypt(payloadStr, encryptKey);
  }

  /**
   * Decrypts an encrypted payload string.
   * Returns the parsed payload object.
   */
  async decryptPayload<T = unknown>(
    encryptedPayload: string,
    encryptKey: string,
  ): Promise<T> {
    let decryptedStr: string;
    try {
      decryptedStr = await this._decrypt(encryptedPayload, encryptKey);
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
