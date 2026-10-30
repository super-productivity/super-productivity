import {
  createCipheriv,
  createECDH,
  ECDH,
  createHash,
  createPublicKey,
  hkdfSync,
  randomBytes,
} from 'crypto';

/**
 * Seals a capture to the user's ECDH P-256 public key, so the server stores
 * only ciphertext only the user's devices can open.
 *
 * Wire, base64: [0x01][ephemeral public key, SEC1 uncompressed, 65][iv, 12][ciphertext ‖ tag, 16].
 * Key: HKDF-SHA-256(ECDH(ephemeral, user), salt = empty,
 *      info = "sp-capture-v1" ‖ ephemeral key ‖ user key (both SEC1 uncompressed)), 32 bytes.
 * Cipher: AES-256-GCM, AAD = 0x01 ‖ UTF-8 item id, which binds a ciphertext
 * to its row so it can't be replayed under another item id.
 *
 * The app's open side (packages/sync-core) must match this byte for byte;
 * the spec's vectors are the shared reference.
 */

export const SEAL_VERSION = 0x01;
export const SEAL_INFO_LABEL = 'sp-capture-v1';
const EC_POINT_BYTES = 65;
const IV_BYTES = 12;

export class InvalidCaptureKeyError extends Error {}

/**
 * Parses a base64 SPKI DER public key and returns its SEC1 uncompressed point.
 * Throws InvalidCaptureKeyError for anything but a P-256 EC key.
 */
export const parseCapturePublicKey = (publicKeySpkiBase64: string): Buffer => {
  const der = Buffer.from(publicKeySpkiBase64, 'base64');
  let jwk: { kty?: string; crv?: string; x?: string; y?: string };
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    // Canonical bytes only: the fingerprint hashes them, so one key must
    // have one encoding.
    if (!key.export({ format: 'der', type: 'spki' }).equals(der)) throw new Error();
    jwk = key.export({ format: 'jwk' });
  } catch {
    throw new InvalidCaptureKeyError('Not a valid SPKI public key');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new InvalidCaptureKeyError('Capture key must be an ECDH P-256 key');
  }
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
};

/** Base64url SHA-256 of the SPKI DER bytes; what devices compare on claim. */
export const captureKeyFingerprint = (publicKeySpkiBase64: string): string =>
  createHash('sha256')
    .update(Buffer.from(publicKeySpkiBase64, 'base64'))
    .digest('base64url');

export const deriveCaptureKey = (
  sharedSecret: Buffer,
  ephemeralPoint: Buffer,
  userPoint: Buffer,
): Buffer => {
  const info = Buffer.concat([
    Buffer.from(SEAL_INFO_LABEL, 'utf8'),
    ephemeralPoint,
    userPoint,
  ]);
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.alloc(0), info, 32));
};

export const captureAad = (itemId: string): Buffer =>
  Buffer.concat([Buffer.from([SEAL_VERSION]), Buffer.from(itemId, 'utf8')]);

export const sealCapture = (
  userPoint: Buffer,
  itemId: string,
  payload: Record<string, unknown>,
): string => {
  const ephemeral = createECDH('prime256v1');
  const ephemeralPoint = ephemeral.generateKeys();
  const key = deriveCaptureKey(
    ephemeral.computeSecret(userPoint),
    ephemeralPoint,
    userPoint,
  );
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(captureAad(itemId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([SEAL_VERSION]),
    ephemeralPoint,
    iv,
    ciphertext,
    cipher.getAuthTag(),
  ]).toString('base64');
};

export const SEAL_HEADER_BYTES = 1 + EC_POINT_BYTES + IV_BYTES;
const TAG_BYTES = 16;

/**
 * Shape check for a capture a device sealed itself: canonical base64,
 * version byte, an ephemeral key on the curve, room for the tag. The content
 * stays unverifiable here; the importing app validates it after opening.
 */
export const isWellFormedSeal = (sealedBase64: string, maxBytes: number): boolean => {
  const bytes = Buffer.from(sealedBase64, 'base64');
  if (bytes.toString('base64') !== sealedBase64) return false;
  if (bytes.length <= SEAL_HEADER_BYTES + TAG_BYTES || bytes.length > maxBytes) {
    return false;
  }
  if (bytes[0] !== SEAL_VERSION) return false;
  try {
    // Throws for a point that is not on P-256.
    ECDH.convertKey(bytes.subarray(1, 1 + EC_POINT_BYTES), 'prime256v1');
    return bytes[1] === 0x04;
  } catch {
    return false;
  }
};
