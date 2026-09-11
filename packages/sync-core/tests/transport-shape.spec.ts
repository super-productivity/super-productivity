import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Spec imports only from the barrel so the public-API contract is the
// single tested surface...
import {
  MIN_ENCRYPTED_PAYLOAD_TRANSPORT_BYTES,
  encrypt,
  isEncryptedPayloadTransportShape,
  setArgon2ParamsForTesting,
} from '../src';
// ...except this internal constant, imported to pin the classifier's
// duplicated minimum to the producer's envelope layout (transport-shape.ts
// stays dependency-free on purpose, so it cannot import this itself).
import { IV_LENGTH } from '../src/encryption/web-crypto';

const toBase64 = (bytes: number, fill = 7): string =>
  Buffer.alloc(bytes, fill).toString('base64');

describe('isEncryptedPayloadTransportShape', () => {
  beforeAll(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterAll(() => {
    setArgon2ParamsForTesting();
  });

  it('pins the minimum to the legacy envelope [IV][ct+tag(16)]', () => {
    expect(MIN_ENCRYPTED_PAYLOAD_TRANSPORT_BYTES).toBe(IV_LENGTH + 16);
  });

  it('accepts real encrypt() output', async () => {
    const ciphertext = await encrypt('some very secret data', 'pw');
    expect(isEncryptedPayloadTransportShape(ciphertext)).toBe(true);
  });

  it('accepts the minimal 28-byte legacy envelope', () => {
    expect(isEncryptedPayloadTransportShape(toBase64(28))).toBe(true);
  });

  it('accepts an unpadded canonical base64 string above the minimum', () => {
    // 30 bytes -> 40 base64 chars, no padding.
    expect(isEncryptedPayloadTransportShape(toBase64(30))).toBe(true);
  });

  it('rejects envelopes below the 28-byte minimum', () => {
    expect(isEncryptedPayloadTransportShape(toBase64(27))).toBe(false);
    expect(isEncryptedPayloadTransportShape(toBase64(1))).toBe(false);
    expect(isEncryptedPayloadTransportShape('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isEncryptedPayloadTransportShape(undefined)).toBe(false);
    expect(isEncryptedPayloadTransportShape(null)).toBe(false);
    expect(isEncryptedPayloadTransportShape(42)).toBe(false);
    expect(isEncryptedPayloadTransportShape({ task: { title: 'plaintext' } })).toBe(
      false,
    );
    expect(isEncryptedPayloadTransportShape([toBase64(44)])).toBe(false);
  });

  it('rejects plaintext JSON strings', () => {
    const plaintext = JSON.stringify({
      task: { id: 'task-1', title: 'a fairly long plaintext task title' },
    });
    expect(isEncryptedPayloadTransportShape(plaintext)).toBe(false);
  });

  it('rejects non-canonical base64', () => {
    const valid = toBase64(44);
    // Length not a multiple of 4.
    expect(isEncryptedPayloadTransportShape(valid.slice(0, -1))).toBe(false);
    // Embedded whitespace / newlines.
    expect(
      isEncryptedPayloadTransportShape(`${valid.slice(0, 8)} ${valid.slice(9)}`),
    ).toBe(false);
    expect(isEncryptedPayloadTransportShape(`${valid}\n`)).toBe(false);
    // base64url alphabet.
    expect(isEncryptedPayloadTransportShape(valid.replace(/[A-Za-z]/, '-'))).toBe(false);
    expect(isEncryptedPayloadTransportShape(valid.replace(/[A-Za-z]/, '_'))).toBe(false);
  });

  it('rejects malformed padding', () => {
    const unpadded = toBase64(30); // 40 chars, no '='
    expect(isEncryptedPayloadTransportShape(`${unpadded.slice(0, 36)}A===`)).toBe(false);
    // '=' anywhere but the end.
    expect(
      isEncryptedPayloadTransportShape(`${unpadded.slice(0, 8)}=${unpadded.slice(9)}`),
    ).toBe(false);
  });
});
