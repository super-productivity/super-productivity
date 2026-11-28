import { createHash } from 'crypto';

// No 0/O, 1/I/L: the user compares it by eye between two screens, the same
// alphabet and shape as the Connect match code (connect-request.store.ts).
const MATCH_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Short code a user can compare between the browser that registered a
 * passkey and the email confirmation page (#9032). Derived only from the
 * submitted credential id, so every caller computes the same value: the
 * register/verify response, and the confirmation page from the stored
 * pending row. It is not a secret and must never be the only check.
 */
export const matchCodeForCredentialId = (credentialId: Uint8Array): string => {
  const digest = createHash('sha256').update(credentialId).digest();
  const chars = Array.from(
    digest.subarray(0, 6),
    (b) => MATCH_CODE_ALPHABET[b % MATCH_CODE_ALPHABET.length],
  ).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
};
