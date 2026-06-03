import { argon2id } from 'hash-wasm';
import { KEY_LENGTH, SALT_LENGTH, getRandomBytes } from './web-crypto';

const DEFAULT_ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MB - memorySize is in KiB
};

let _argon2Params = { ...DEFAULT_ARGON2_PARAMS };

/**
 * Returns a snapshot of the current Argon2 parameters.
 * Tests can override via `setArgon2ParamsForTesting()`.
 */
export const getArgon2Params = (): typeof DEFAULT_ARGON2_PARAMS => ({
  ..._argon2Params,
});

/**
 * Override Argon2 parameters for testing (use weak params to speed up tests).
 * Pass `undefined` to restore defaults.
 *
 * Throws when called in a Node-side production build (`NODE_ENV === 'production'`).
 * The check is a no-op in browser bundles where `process` is undefined; the
 * function name itself is the contract for those environments.
 */
export const setArgon2ParamsForTesting = (
  params?: Partial<typeof DEFAULT_ARGON2_PARAMS>,
): void => {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
    ?.NODE_ENV;
  if (env === 'production') {
    throw new Error('setArgon2ParamsForTesting must not be called in production');
  }
  _argon2Params = params
    ? { ...DEFAULT_ARGON2_PARAMS, ...params }
    : { ...DEFAULT_ARGON2_PARAMS };
};

const deriveKeyBytesArgon = async (
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> =>
  argon2id({
    password,
    salt,
    hashLength: KEY_LENGTH,
    parallelism: _argon2Params.parallelism,
    iterations: _argon2Params.iterations,
    memorySize: _argon2Params.memorySize,
    outputType: 'binary',
  });

/**
 * A key derived from a password via Argon2id, plus the salt used to derive it.
 * Reusable across many encrypt/decrypt calls (only IVs need to be unique).
 */
export interface DerivedKey {
  keyBytes: Uint8Array;
  salt: Uint8Array;
}

/**
 * Derives a key from password using Argon2id. Returns the derived bytes plus
 * the salt for reuse across multiple encrypt operations.
 *
 * @param password The encryption password
 * @param salt Optional salt; if not provided, generates a random 16-byte salt
 */
export const deriveKeyFromPassword = async (
  password: string,
  salt?: Uint8Array,
): Promise<DerivedKey> => {
  const actualSalt = salt ?? getRandomBytes(SALT_LENGTH);
  const keyBytes = await deriveKeyBytesArgon(password, actualSalt);
  return { keyBytes, salt: actualSalt };
};
