import { toSyncLogError, type SyncLogError } from '../sync-logger';
import { WebCryptoNotAvailableError } from '../web-crypto-error';

/**
 * Which step of the Argon2id path failed before the legacy fallback ran:
 * `kdf` — Argon2id key derivation (hash-wasm / WebAssembly) threw;
 * `aes` — the key was derived but AES-GCM decryption failed (wrong key,
 * corrupt ciphertext).
 */
export type Argon2FailureStage = 'kdf' | 'aes';

const MAX_KDF_MESSAGE_LENGTH = 200;

/**
 * Thrown by `decrypt()` / `decryptBatch()` when the Argon2id path AND the
 * legacy PBKDF2 fallback both failed. Before #4514 only the fallback's error
 * surfaced, so a broken key derivation (e.g. a WebAssembly allocation failure
 * on a memory-constrained WebView) looked exactly like a wrong password.
 *
 * Log-safe by construction: carries error NAMES only, plus the message of a
 * KDF-stage failure (hash-wasm / WebAssembly errors describe the environment,
 * never the password or data). AES-stage messages are omitted because crypto
 * errors are not guaranteed to be content-free.
 */
export class DecryptFailedError extends Error {
  override name = 'DecryptFailedError';

  constructor(
    readonly primaryStage: Argon2FailureStage,
    readonly primaryError: SyncLogError,
    readonly fallbackError: SyncLogError,
    primaryKdfMessage?: string,
  ) {
    super(
      `Decryption failed: argon2id ${primaryStage} step threw ${primaryError.name}` +
        (primaryKdfMessage ? ` (${primaryKdfMessage})` : '') +
        `; legacy fallback threw ${fallbackError.name}`,
    );
  }
}

const kdfMessage = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !error.message) {
    return undefined;
  }
  return error.message.length > MAX_KDF_MESSAGE_LENGTH
    ? `${error.message.slice(0, MAX_KDF_MESSAGE_LENGTH)}…`
    : error.message;
};

/**
 * Builds the error to throw once both decrypt paths failed. A
 * `WebCryptoNotAvailableError` from the fallback is an environment failure the
 * host handles by type, so it is rethrown unchanged.
 */
export const toDecryptFailure = (
  primaryError: unknown,
  primaryStage: Argon2FailureStage,
  fallbackError: unknown,
): unknown => {
  if (fallbackError instanceof WebCryptoNotAvailableError) {
    return fallbackError;
  }
  return new DecryptFailedError(
    primaryStage,
    toSyncLogError(primaryError),
    toSyncLogError(fallbackError),
    primaryStage === 'kdf' ? kdfMessage(primaryError) : undefined,
  );
};
