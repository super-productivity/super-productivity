import { createECDH, createHash, createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  captureKeyFingerprint,
  CaptureKeyPair,
  generateCaptureKeyPair,
  openCapture,
} from '../src/encryption/capture-open';

/**
 * The vector is the one pinned in
 * packages/super-sync-server/tests/capture-seal.spec.ts: user private key
 * 0x01 × 32, ephemeral private key 0x02 × 32, IV 0x03 × 12, item id "item-1".
 */

const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);
const VECTOR_CT =
  'VvPcrvop4zkadZl48K6FngoPEOmueJnbVQpq/L3kuXad+gVrd8UPZvLd5bkSyJANaDo07JGPJM67pw7l2yyLylKJEyur+1ke1Pc=';
const VECTOR_PAYLOAD = { v: 1, title: 'Buy milk', createdAt: 1, client: 'Claude' };

/** A key pair from a fixed private scalar, in the app's storage format. */
const fixedKeyPair = (fill: number): { pair: CaptureKeyPair; point: Buffer } => {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.alloc(32, fill));
  const point = ecdh.getPublicKey();
  const pkcs8 = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: Buffer.alloc(32, fill).toString('base64url'),
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  }).export({ format: 'der', type: 'pkcs8' });
  return {
    point,
    pair: {
      v: 1,
      privateKeyPkcs8: pkcs8.toString('base64'),
      publicKeySpki: Buffer.concat([P256_SPKI_PREFIX, point]).toString('base64'),
    },
  };
};

const vectorSealed = (): string =>
  Buffer.concat([
    Buffer.from([0x01]),
    fixedKeyPair(2).point,
    Buffer.alloc(12, 3),
    Buffer.from(VECTOR_CT, 'base64'),
  ]).toString('base64');

describe('openCapture', () => {
  it('opens the pinned server vector', async () => {
    const { pair } = fixedKeyPair(1);
    expect(await openCapture(pair, 'item-1', vectorSealed())).toEqual(VECTOR_PAYLOAD);
  });

  it('refuses another item id, another key, tampering and truncation', async () => {
    const { pair } = fixedKeyPair(1);
    const sealed = vectorSealed();
    const bytes = Buffer.from(sealed, 'base64');
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 1] ^= 0x01;
    const badVersion = Buffer.from(bytes);
    badVersion[0] = 0x02;

    await expect(openCapture(pair, 'item-2', sealed)).rejects.toMatchObject({
      code: 'decrypt',
    });
    await expect(
      openCapture(fixedKeyPair(4).pair, 'item-1', sealed),
    ).rejects.toMatchObject({
      code: 'decrypt',
    });
    await expect(
      openCapture(pair, 'item-1', flipped.toString('base64')),
    ).rejects.toMatchObject({ code: 'decrypt' });
    await expect(
      openCapture(pair, 'item-1', bytes.subarray(0, 90).toString('base64')),
    ).rejects.toMatchObject({ code: 'truncated' });
    await expect(
      openCapture(pair, 'item-1', badVersion.toString('base64')),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('refuses an off-curve ephemeral key and invalid base64 as malformed', async () => {
    const { pair } = fixedKeyPair(1);
    const offCurve = Buffer.from(vectorSealed(), 'base64');
    offCurve.fill(0x07, 2, 66);

    await expect(
      openCapture(pair, 'item-1', offCurve.toString('base64')),
    ).rejects.toMatchObject({ code: 'malformed' });
    await expect(openCapture(pair, 'item-1', '%%%')).rejects.toMatchObject({
      code: 'malformed',
    });
  });
});

describe('capture keys', () => {
  it('generates exportable P-256 pairs', async () => {
    const pair = await generateCaptureKeyPair();
    expect(pair.v).toBe(1);
    // Uncompressed P-256 SPKI: 26-byte prefix + 65-byte point.
    const spki = Buffer.from(pair.publicKeySpki, 'base64');
    expect(spki.subarray(0, 26).equals(P256_SPKI_PREFIX)).toBe(true);
    expect(spki).toHaveLength(91);
  });

  it('fingerprints like the server: base64url SHA-256 of the SPKI', async () => {
    const { pair } = fixedKeyPair(1);
    const expected = createHash('sha256')
      .update(Buffer.from(pair.publicKeySpki, 'base64'))
      .digest('base64url');
    expect(await captureKeyFingerprint(pair.publicKeySpki)).toBe(expected);
  });
});
