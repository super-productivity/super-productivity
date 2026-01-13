import { inject, Injectable } from '@angular/core';
import { ENCRYPT_FN, DECRYPT_FN } from '../encryption/encryption.token';
import { SyncOperation } from '../sync-providers/provider.interface';
import { DecryptError } from '../core/errors/sync-errors';

/**
 * Handles E2E encryption/decryption of operation payloads for SuperSync.
 * Uses AES-256-GCM with Argon2id key derivation (same as legacy sync providers).
 */
@Injectable({
  providedIn: 'root',
})
export class OperationEncryptionService {
  private readonly _encrypt = inject(ENCRYPT_FN);
  private readonly _decrypt = inject(DECRYPT_FN);

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
    try {
      const decryptedStr = await this._decrypt(op.payload, encryptKey);
      const parsedPayload = JSON.parse(decryptedStr);
      return {
        ...op,
        payload: parsedPayload,
        isPayloadEncrypted: false,
      };
    } catch (e) {
      throw new DecryptError('Failed to decrypt operation payload', e);
    }
  }

  /**
   * Batch encrypt operations for upload.
   */
  async encryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    return Promise.all(ops.map((op) => this.encryptOperation(op, encryptKey)));
  }

  /**
   * Batch decrypt operations after download.
   * Non-encrypted ops pass through unchanged.
   */
  async decryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    return Promise.all(ops.map((op) => this.decryptOperation(op, encryptKey)));
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
    try {
      const decryptedStr = await this._decrypt(encryptedPayload, encryptKey);
      return JSON.parse(decryptedStr) as T;
    } catch (e) {
      throw new DecryptError('Failed to decrypt payload', e);
    }
  }
}
