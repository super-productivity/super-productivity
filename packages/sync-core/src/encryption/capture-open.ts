import {
  decodeBase64,
  encodeBase64,
  getRequiredSubtle,
  TEXT_DECODER,
  TEXT_ENCODER,
} from './web-crypto';

/**
 * Agent task capture: the app's side of the SuperSync capture seal. The
 * server seals each capture to the user's ECDH P-256 public key; only a
 * device holding the synced private key opens it.
 *
 * Wire, base64: [0x01][ephemeral public key, SEC1 uncompressed, 65][iv, 12][ciphertext ‖ tag, 16].
 * Key: HKDF-SHA-256(ECDH(user, ephemeral), salt = empty,
 *      info = "sp-capture-v1" ‖ ephemeral key ‖ user key (both SEC1 uncompressed)), 32 bytes.
 * Cipher: AES-256-GCM, AAD = 0x01 ‖ UTF-8 item id.
 *
 * Must match packages/super-sync-server/src/capture/capture-seal.ts byte for
 * byte; both specs pin the same vector. WebCrypto only: no fallback, so
 * callers check isCryptoSubtleAvailable() first.
 */

export interface CaptureKeyPair {
  /** 1 today. A number, not a literal: it is persisted and synced, and a
   * future version must reach older clients as data they skip. */
  v: number;
  /** Base64 PKCS#8 DER. */
  privateKeyPkcs8: string;
  /** Base64 SPKI DER; what the server stores and fingerprints. */
  publicKeySpki: string;
}

export type CaptureOpenErrorCode =
  | 'malformed'
  | 'version'
  | 'truncated'
  | 'decrypt'
  | 'json';

export class CaptureOpenError extends Error {
  constructor(readonly code: CaptureOpenErrorCode) {
    super(`Capture could not be opened: ${code}`);
    this.name = 'CaptureOpenError';
  }
}

const SEAL_VERSION = 0x01;
const INFO_LABEL = 'sp-capture-v1';
const POINT_BYTES = 65;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + POINT_BYTES + IV_BYTES;
const ECDH_P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const utf8 = (text: string): Uint8Array => TEXT_ENCODER.encode(text);

export const generateCaptureKeyPair = async (): Promise<CaptureKeyPair> => {
  const subtle = getRequiredSubtle();
  const pair = await subtle.generateKey(ECDH_P256, true, ['deriveBits']);
  return {
    v: 1,
    privateKeyPkcs8: encodeBase64(await subtle.exportKey('pkcs8', pair.privateKey)),
    publicKeySpki: encodeBase64(await subtle.exportKey('spki', pair.publicKey)),
  };
};

/** Base64url SHA-256 of the SPKI DER bytes, as the server computes it. */
export const captureKeyFingerprint = async (publicKeySpki: string): Promise<string> => {
  const digest = await getRequiredSubtle().digest('SHA-256', decodeBase64(publicKeySpki));
  return encodeBase64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const deriveOpenKey = async (
  key: CaptureKeyPair,
  ephemeralPoint: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> => {
  const subtle = getRequiredSubtle();
  const privateKey = await subtle.importKey(
    'pkcs8',
    decodeBase64(key.privateKeyPkcs8),
    ECDH_P256,
    false,
    ['deriveBits'],
  );
  const publicKey = await subtle.importKey(
    'spki',
    decodeBase64(key.publicKeySpki),
    ECDH_P256,
    true,
    [],
  );
  const userPoint = new Uint8Array(await subtle.exportKey('raw', publicKey));
  // An invalid point is the item's fault, not the key's: one bad item must
  // not fail the whole batch.
  const ephemeral = await subtle
    .importKey('raw', ephemeralPoint, ECDH_P256, false, [])
    .catch(() => {
      throw new CaptureOpenError('malformed');
    });
  const shared = await subtle.deriveBits(
    { name: 'ECDH', public: ephemeral },
    privateKey,
    256,
  );
  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: concat(utf8(INFO_LABEL), ephemeralPoint, userPoint),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
};

/**
 * Opens one sealed capture and returns its parsed JSON payload. Throws
 * CaptureOpenError (no content in the message) for anything that does not
 * authenticate under this key and item id.
 */
export const openCapture = async (
  key: CaptureKeyPair,
  itemId: string,
  sealed: string,
): Promise<unknown> => {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(decodeBase64(sealed));
  } catch {
    throw new CaptureOpenError('malformed');
  }
  if (bytes[0] !== SEAL_VERSION) throw new CaptureOpenError('version');
  if (bytes.length < HEADER_BYTES + TAG_BYTES) throw new CaptureOpenError('truncated');

  const aesKey = await deriveOpenKey(key, bytes.slice(1, 1 + POINT_BYTES));
  let plain: ArrayBuffer;
  try {
    plain = await getRequiredSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(1 + POINT_BYTES, HEADER_BYTES),
        additionalData: concat(new Uint8Array([SEAL_VERSION]), utf8(itemId)),
        tagLength: TAG_BYTES * 8,
      },
      aesKey,
      bytes.slice(HEADER_BYTES),
    );
  } catch {
    throw new CaptureOpenError('decrypt');
  }
  try {
    return JSON.parse(TEXT_DECODER.decode(plain));
  } catch {
    throw new CaptureOpenError('json');
  }
};
