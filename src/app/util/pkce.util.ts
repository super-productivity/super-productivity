// Shared PKCE (Proof Key for Code Exchange) utility.
// Handles environments where crypto.subtle is unavailable (e.g., Android Capacitor
// on http://localhost) by falling back to hash-wasm.
// @see https://www.chromium.org/blink/webcrypto

import { sha256 as hashWasmSha256 } from 'hash-wasm';

const base64UrlEncode = (buffer: Uint8Array): string => {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * SHA-256 hash with automatic fallback for insecure contexts.
 * Uses crypto.subtle when available, otherwise falls back to hash-wasm.
 */
const sha256 = async (data: Uint8Array): Promise<ArrayBuffer> => {
  if (typeof crypto !== 'undefined' && crypto.subtle !== undefined) {
    return crypto.subtle.digest('SHA-256', data as BufferSource);
  }

  // Fallback to hash-wasm for insecure contexts (e.g., Android Capacitor on http://localhost).
  // hash-wasm is already a dependency (used for Argon2id encryption).
  const hexHash = await hashWasmSha256(data);
  const bytes = new Uint8Array(hexHash.length / 2);
  for (let i = 0; i < hexHash.length; i += 2) {
    bytes[i / 2] = parseInt(hexHash.slice(i, i + 2), 16);
  }
  return bytes.buffer;
};

/** Generate a cryptographically random code verifier (base64url-encoded). */
export const generateCodeVerifier = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
};

/** Generate an S256 code challenge from a code verifier. */
export const generateCodeChallenge = async (verifier: string): Promise<string> => {
  const data = new TextEncoder().encode(verifier);
  const digest = await sha256(data);
  return base64UrlEncode(new Uint8Array(digest));
};
