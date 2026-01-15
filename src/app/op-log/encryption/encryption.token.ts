import { InjectionToken } from '@angular/core';
import { encrypt, decrypt, decryptWithMigration, DecryptResult } from './encryption';

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

export type EncryptFn = (data: string, password: string) => Promise<string>;
export type DecryptFn = (data: string, password: string) => Promise<string>;
export type DecryptWithMigrationFn = (
  data: string,
  password: string,
) => Promise<DecryptResult>;
