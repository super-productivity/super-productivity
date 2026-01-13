// taken from https://github.com/aaronpk/pkce-vanilla-js/blob/master/index.html

// Generate a secure random string using the browser crypto functions
const generateRandomString = (length: number): string => {
  const array = new Uint32Array(length / 2);
  if (!window.crypto?.getRandomValues) {
    alert(
      'WebCrypto API (getRandomValues) not supported in your browser. Please update to the latest version or use a different one',
    );
  }

  window.crypto.getRandomValues(array);
  return Array.from(array, (dec) => ('0' + dec.toString(16)).substr(-2)).join('');
};

// Calculate the SHA256 hash of the input text.
// Returns a promise that resolves to an ArrayBuffer
const sha256 = (plain: string): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  // NOTE: crypto.subtle is supposed to be undefined in insecure contexts
  // @see https://www.chromium.org/blink/webcrypto
  if (window.crypto?.subtle === undefined) {
    alert('WebCrypto API (subtle.digest) is only supported in secure contexts.');
  }

  return window.crypto.subtle.digest('SHA-256', data);
};

// Base64-urlencodes the input string
const base64urlencode = (str: ArrayBuffer): string => {
  // Convert the ArrayBuffer to string using Uint8 array to conver to what btoa accepts.
  // btoa accepts chars only within ascii 0-255 and base64 encodes them.
  // Then convert the base64 encoded to base64url encoded
  //   (replace + with -, replace / with _, trim trailing =)
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str) as any))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

// Return the base64-urlencoded sha256 hash for the PKCE challenge
const pkceChallengeFromVerifier = async (v: string): Promise<string> => {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
};

export const generatePKCECodes = async (
  length: number,
): Promise<{ codeVerifier: string; codeChallenge: string }> => {
  const codeVerifier = generateRandomString(length);
  const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);
  return { codeVerifier, codeChallenge };
};
