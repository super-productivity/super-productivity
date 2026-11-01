import { describe, expect, it } from 'vitest';
import { createECDH, generateKeyPairSync } from 'crypto';
import {
  captureAad,
  captureKeyFingerprint,
  deriveCaptureKey,
  InvalidCaptureKeyError,
  parseCapturePublicKey,
  SEAL_VERSION,
  sealCapture,
} from '../src/capture/capture-seal';
import {
  hashCaptureSecret,
  isCaptureSecretValid,
  mintCaptureToken,
  parseCaptureToken,
} from '../src/capture/capture-token';
import { validateCreateTaskArgs } from '../src/capture/create-task.tool';
import { newCaptureKeyPair, openCapture } from './capture-pglite.helper';

/**
 * The seal is the contract with the app's open side, so the vectors below are
 * computed independently (plain Node crypto, fixed keys) and pinned here.
 */

const PAYLOAD = { v: 1, title: 'Buy milk', createdAt: 1, client: 'Claude' };

describe('capture seal', () => {
  it('derives the pinned key and ciphertext for fixed keys', () => {
    const user = createECDH('prime256v1');
    user.setPrivateKey(Buffer.alloc(32, 1));
    const ephemeral = createECDH('prime256v1');
    ephemeral.setPrivateKey(Buffer.alloc(32, 2));
    const key = deriveCaptureKey(
      ephemeral.computeSecret(user.getPublicKey()),
      ephemeral.getPublicKey(),
      user.getPublicKey(),
    );
    expect(key.toString('hex')).toBe(
      'c188ed63b74f47740bbe8a25073229cb4e1a6353de27f546bb82ad123b6cc1ce',
    );

    const sealed = Buffer.concat([
      Buffer.from([SEAL_VERSION]),
      ephemeral.getPublicKey(),
      Buffer.alloc(12, 3),
      Buffer.from(
        'VvPcrvop4zkadZl48K6FngoPEOmueJnbVQpq/L3kuXad+gVrd8UPZvLd5bkSyJANaDo07JGPJM67pw7l2yyLylKJEyur+1ke1Pc=',
        'base64',
      ),
    ]).toString('base64');
    expect(openCapture(user, 'item-1', sealed)).toEqual(PAYLOAD);
  });

  it('round-trips through the user key with a fresh ephemeral key each time', () => {
    const { ecdh, publicKey: spki } = newCaptureKeyPair();
    const point = parseCapturePublicKey(spki);
    const a = sealCapture(point, 'item-1', PAYLOAD);
    const b = sealCapture(point, 'item-1', PAYLOAD);
    expect(a).not.toBe(b);
    expect(openCapture(ecdh, 'item-1', a)).toEqual(PAYLOAD);
    expect(openCapture(ecdh, 'item-1', b)).toEqual(PAYLOAD);
  });

  it('refuses a tampered, truncated, rebound or foreign ciphertext', () => {
    const { ecdh, publicKey: spki } = newCaptureKeyPair();
    const sealed = sealCapture(parseCapturePublicKey(spki), 'item-1', PAYLOAD);
    const bytes = Buffer.from(sealed, 'base64');

    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 20] ^= 0x01;
    expect(() => openCapture(ecdh, 'item-1', flipped.toString('base64'))).toThrow();
    const truncated = bytes.subarray(0, bytes.length - 1).toString('base64');
    expect(() => openCapture(ecdh, 'item-1', truncated)).toThrow();
    expect(() => openCapture(ecdh, 'item-2', sealed)).toThrow();
    expect(() => openCapture(newCaptureKeyPair().ecdh, 'item-1', sealed)).toThrow();
  });

  it('accepts only P-256 SPKI keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64');
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64');
    // A valid key with trailing bytes: same key, different fingerprint.
    const padded = Buffer.concat([
      Buffer.from(newCaptureKeyPair().publicKey, 'base64'),
      Buffer.alloc(3),
    ]).toString('base64');
    for (const bad of [rsa, p384, padded, 'bm90IGEga2V5', '']) {
      expect(() => parseCapturePublicKey(bad)).toThrow(InvalidCaptureKeyError);
    }
  });

  it('fingerprints the SPKI bytes', () => {
    const spki = newCaptureKeyPair().publicKey;
    expect(captureKeyFingerprint(spki)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(captureKeyFingerprint(spki)).not.toBe(
      captureKeyFingerprint(newCaptureKeyPair().publicKey),
    );
  });
});

describe('capture token', () => {
  it('parses what it mints and stores only the hash', () => {
    const { grantId, token, secretHash } = mintCaptureToken();
    expect(token.startsWith(`sp_cap_${grantId}_`)).toBe(true);
    const parsed = parseCaptureToken(token);
    expect(parsed?.grantId).toBe(grantId);
    expect(secretHash).toBe(hashCaptureSecret(parsed!.secret));
    expect(isCaptureSecretValid(parsed!.secret, secretHash)).toBe(true);
    expect(isCaptureSecretValid(`${parsed!.secret}x`, secretHash)).toBe(false);
  });

  it('rejects anything that is not a capture token', () => {
    const { grantId } = mintCaptureToken();
    for (const bad of [
      'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      `sp_cap_${grantId}`,
      `sp_cap_${grantId}_`,
      'sp_cap_not-a-uuid_secret',
      `xp_cap_${grantId}_secret`,
    ]) {
      expect(parseCaptureToken(bad)).toBeNull();
    }
  });
});

describe('validateCreateTaskArgs', () => {
  it('trims the title and drops empty notes', () => {
    expect(validateCreateTaskArgs({ title: '  Buy milk ', notes: '' })).toEqual({
      title: 'Buy milk',
    });
    expect(validateCreateTaskArgs({ title: 'a', notes: 'n' })).toEqual({
      title: 'a',
      notes: 'n',
    });
  });

  it('counts the title in code points', () => {
    expect(typeof validateCreateTaskArgs({ title: '😀'.repeat(500) })).toBe('object');
    expect(typeof validateCreateTaskArgs({ title: '😀'.repeat(501) })).toBe('string');
  });

  it('refuses bad arguments with a message', () => {
    for (const args of [
      {},
      { title: '   ' },
      { title: 1 },
      { title: 'a', notes: 2 },
      { title: 'a', notes: 'x'.repeat(8 * 1024 + 1) },
      { title: 'a', projectId: 'p' },
    ]) {
      expect(typeof validateCreateTaskArgs(args)).toBe('string');
    }
    expect(
      typeof validateCreateTaskArgs({ title: 'a', notes: 'x'.repeat(8 * 1024) }),
    ).toBe('object');
  });

  it('keeps a due day and an optional time', () => {
    expect(validateCreateTaskArgs({ title: 'a', dueDate: '2026-10-16' })).toEqual({
      title: 'a',
      dueDate: '2026-10-16',
    });
    expect(
      validateCreateTaskArgs({
        title: 'a',
        notes: '',
        dueDate: '2028-02-29',
        dueTime: '09:30',
      }),
    ).toEqual({ title: 'a', dueDate: '2028-02-29', dueTime: '09:30' });
  });

  it('keeps a trimmed project title and rejects an empty or long one', () => {
    expect(validateCreateTaskArgs({ title: 'a', project: ' Work ' })).toEqual({
      title: 'a',
      project: 'Work',
    });
    expect(typeof validateCreateTaskArgs({ title: 'a', project: '😀'.repeat(200) })).toBe(
      'object',
    );
    for (const project of ['', '  ', 'x'.repeat(201), 1, null]) {
      expect(typeof validateCreateTaskArgs({ title: 'a', project })).toBe('string');
    }
  });

  it('keeps a repeat in canonical form', () => {
    expect(
      validateCreateTaskArgs({
        title: 'a',
        repeat: { cycle: 'weekly', every: 2, weekdays: ['fri', 'mon'] },
      }),
    ).toEqual({
      title: 'a',
      repeat: { cycle: 'weekly', every: 2, weekdays: ['mon', 'fri'] },
    });
    expect(
      validateCreateTaskArgs({
        title: 'a',
        dueDate: '2026-10-16',
        dueTime: '09:30',
        repeat: { cycle: 'monthly', every: 1 },
      }),
    ).toEqual({
      title: 'a',
      dueDate: '2026-10-16',
      dueTime: '09:30',
      repeat: { cycle: 'monthly' },
    });
  });

  it('refuses a bad repeat', () => {
    for (const repeat of [
      'daily',
      null,
      [],
      {},
      { cycle: 'hourly' },
      { cycle: 'daily', every: 0 },
      { cycle: 'daily', every: 100 },
      { cycle: 'daily', every: 1.5 },
      { cycle: 'daily', every: '2' },
      { cycle: 'daily', weekdays: ['mon'] },
      { cycle: 'weekly', weekdays: [] },
      { cycle: 'weekly', weekdays: ['monday'] },
      { cycle: 'weekly', weekdays: ['mon', 'mon'] },
      { cycle: 'weekly', interval: 2 },
    ]) {
      expect(typeof validateCreateTaskArgs({ title: 'a', repeat })).toBe('string');
    }
  });

  it('refuses a bad due day or time', () => {
    for (const due of [
      { dueTime: '09:30' },
      { dueDate: '2026-02-30' },
      { dueDate: '2026-13-01' },
      { dueDate: '0099-12-31' },
      { dueDate: '0500-06-15' },
      { dueDate: '0999-12-31' },
      { dueDate: '26-10-16' },
      { dueDate: '2026-10-16T09:30' },
      { dueDate: 20261016 },
      { dueDate: '2026-10-16', dueTime: '24:00' },
      { dueDate: '2026-10-16', dueTime: '9:30' },
      { dueDate: '2026-10-16', dueTime: '09:30:00' },
      { dueDate: '2026-10-16', dueTime: 930 },
    ]) {
      expect(typeof validateCreateTaskArgs({ title: 'a', ...due })).toBe('string');
    }
  });
});
