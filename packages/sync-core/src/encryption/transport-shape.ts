/**
 * Structural classifier for the encrypted-payload transport shape.
 *
 * The SuperSync server holds no E2EE key, so it cannot prove a payload is
 * ciphertext — but it can require that every uploaded payload has the shape
 * the client encryption in `encryption.ts` produces: canonical
 * standard-alphabet base64 of
 *
 *   Argon2id : `[SALT (16)][IV (12)][AES-GCM ciphertext + auth tag]` (>= 44 bytes)
 *   Legacy   : `[IV (12)][AES-GCM ciphertext + auth tag]`            (>= 28 bytes)
 *
 * This is a shape check, not proof of encryption: base64-encoded plaintext of
 * sufficient length passes it. Its purpose is to reject accidental plaintext
 * (missing client-side encryption) and malformed uploads at the server
 * boundary without decoding, allocating, or logging the value.
 *
 * Deliberately dependency-free: pure string arithmetic with no crypto, DOM,
 * or Node imports, so it stays portable across every consumer environment
 * and testable in isolation. The wire format it encodes is a frozen public
 * contract (see `encryption.ts`); the spec cross-checks the byte minimum
 * against the envelope constants and real `encrypt()` output.
 */

/** `[IV (12)][ciphertext + auth tag (min 16)]` — the legacy-envelope minimum. */
export const MIN_ENCRYPTED_PAYLOAD_TRANSPORT_BYTES = 28;

// Canonical standard-alphabet base64: no whitespace, no base64url characters,
// `=` padding only at the end. Linear scan, no backtracking.
const CANONICAL_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

export const isEncryptedPayloadTransportShape = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  if (value.length % 4 !== 0) return false;
  if (!CANONICAL_BASE64_REGEX.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const dataBytes = (value.length / 4) * 3;
  return dataBytes - padding >= MIN_ENCRYPTED_PAYLOAD_TRANSPORT_BYTES;
};
