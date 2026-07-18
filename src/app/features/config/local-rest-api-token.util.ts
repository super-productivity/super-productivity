const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 32;

// Largest multiple of the alphabet size that fits in a byte. Values at or above
// it are discarded instead of being folded in with `%`, which would make the
// first `256 % 62` characters slightly more likely than the rest.
const MAX_UNBIASED_BYTE = Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;

/**
 * Generates the access token for the local REST API.
 *
 * Alphanumeric so it survives being copied out of the settings UI and pasted
 * into a shell command without quoting.
 */
export const generateLocalRestApiToken = (): string => {
  let token = '';

  while (token.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= MAX_UNBIASED_BYTE) {
        continue;
      }
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === TOKEN_LENGTH) {
        break;
      }
    }
  }

  return token;
};
