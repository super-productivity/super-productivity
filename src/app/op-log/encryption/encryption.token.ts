import { InjectionToken } from '@angular/core';
import {
  encrypt,
  decrypt,
  decryptWithMigration,
  DecryptResult,
  encryptBatch,
  decryptBatch,
} from './encryption';

/**
 * Injection token for the encrypt function.
 * Allows tests to provide a fast mock implementation.
 */
export const ENCRYPT_FN = new InjectionToken<typeof encrypt>('ENCRYPT_FN', {
  providedIn: 'root',
  factory: () => encrypt,
});

/**
 * Injection token for the decrypt function.
 * Allows tests to provide a fast mock implementation.
 */
export const DECRYPT_FN = new InjectionToken<typeof decrypt>('DECRYPT_FN', {
  providedIn: 'root',
  factory: () => decrypt,
});

/**
 * Injection token for the decrypt-with-migration function.
 * Use this when you need to handle legacy encryption migration.
 */
export const DECRYPT_WITH_MIGRATION_FN = new InjectionToken<typeof decryptWithMigration>(
  'DECRYPT_WITH_MIGRATION_FN',
  {
    providedIn: 'root',
    factory: () => decryptWithMigration,
  },
);

/**
 * Injection token for batch encrypt function.
 * Optimized for encrypting multiple items - derives key once instead of per-item.
 * Critical for mobile performance.
 */
export const ENCRYPT_BATCH_FN = new InjectionToken<typeof encryptBatch>(
  'ENCRYPT_BATCH_FN',
  {
    providedIn: 'root',
    factory: () => encryptBatch,
  },
);

/**
 * Injection token for batch decrypt function.
 * Optimized for decrypting multiple items - caches derived keys by salt.
 * Critical for mobile performance.
 */
export const DECRYPT_BATCH_FN = new InjectionToken<typeof decryptBatch>(
  'DECRYPT_BATCH_FN',
  {
    providedIn: 'root',
    factory: () => decryptBatch,
  },
);

export type EncryptFn = (data: string, password: string) => Promise<string>;
export type DecryptFn = (data: string, password: string) => Promise<string>;
export type DecryptWithMigrationFn = (
  data: string,
  password: string,
) => Promise<DecryptResult>;
export type EncryptBatchFn = (dataItems: string[], password: string) => Promise<string[]>;
export type DecryptBatchFn = (dataItems: string[], password: string) => Promise<string[]>;
