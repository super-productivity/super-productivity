import { OpLog } from '../../core/log';
import type { SyncLogger } from '@sp/sync-core';
import {
  DecryptNoPasswordError,
  EncryptNoPasswordError,
  extractErrorMessage,
  InvalidFilePrefixError,
  JsonParseError,
  PlaintextWhenEncryptionExpectedError,
} from '../core/errors/sync-errors';
import {
  extractSyncFileStateFromPrefix,
  getSyncFilePrefix,
} from '../util/sync-file-prefix';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import { EncryptAndCompressHandlerService } from './encrypt-and-compress-handler.service';
import { getErrorTxt } from '../../util/get-error-text';

describe('EncryptAndCompressHandlerService', () => {
  let service: EncryptAndCompressHandlerService;

  // Prefix format: pf_{compress?}{encrypt?}{version}__
  // e.g., "pf_1__" for uncompressed, unencrypted, version 1
  const makePrefix = (version: number = 1): string => `pf_${version}__`;

  beforeEach(() => {
    service = new EncryptAndCompressHandlerService();
    spyOn(OpLog, 'err').and.stub();
    spyOn(OpLog, 'normal').and.stub();
    spyOn(OpLog, 'log').and.stub();
  });

  it('uses the injected sync logger for safe metadata', async () => {
    const logger = jasmine.createSpyObj<SyncLogger>('SyncLogger', [
      'log',
      'error',
      'err',
      'normal',
      'verbose',
      'info',
      'warn',
      'critical',
      'debug',
    ]);
    const serviceWithLogger = new EncryptAndCompressHandlerService(logger);

    await serviceWithLogger.compressAndEncrypt({
      data: { id: 'test-id' },
      modelVersion: 1,
      isCompress: false,
      isEncrypt: false,
    });

    expect(logger.normal).toHaveBeenCalledWith(
      'EncryptAndCompressHandlerService.compressAndEncrypt()',
      {
        prefix: 'pf_1__',
        modelVersion: 1,
        isCompress: false,
        isEncrypt: false,
      },
    );
  });

  describe('compressAndEncrypt', () => {
    // GHSA-9544-hjjr-fg8h: encryption expected but no key → must throw instead
    // of silently producing plaintext output.
    it('should throw EncryptNoPasswordError when isEncrypt is true but no key is set', async () => {
      await expectAsync(
        service.compressAndEncrypt({
          data: { id: 'test-id' },
          modelVersion: 1,
          isCompress: false,
          isEncrypt: true,
          encryptKey: undefined,
        }),
      ).toBeRejectedWithError(EncryptNoPasswordError);
    });

    it('should throw EncryptNoPasswordError when isEncrypt is true but key is empty', async () => {
      await expectAsync(
        service.compressAndEncryptData(
          { isEncrypt: true, isCompress: false },
          '',
          { id: 'test-id' },
          1,
        ),
      ).toBeRejectedWithError(EncryptNoPasswordError);
    });
  });

  describe('decompressAndDecrypt', () => {
    it('should parse valid JSON successfully', async () => {
      const testData = { test: 'value', number: 42 };
      const jsonStr = JSON.stringify(testData);
      const dataStr = `${makePrefix(1)}${jsonStr}`;

      const result = await service.decompressAndDecrypt<typeof testData>({
        dataStr,
        encryptKey: undefined,
        isEncryptExpected: false,
      });

      expect(result.data).toEqual(testData);
      expect(result.modelVersion).toBe(1);
    });

    it('should throw JsonParseError for invalid JSON', async () => {
      const invalidJson = '{ invalid json }';
      const dataStr = `${makePrefix(1)}${invalidJson}`;

      await expectAsync(
        service.decompressAndDecrypt({
          dataStr,
          encryptKey: undefined,
          isEncryptExpected: false,
        }),
      ).toBeRejectedWithError(JsonParseError);
    });

    it('should throw JsonParseError with position info for truncated JSON', async () => {
      const truncatedJson = '{"key": "value", "truncated';
      const dataStr = `${makePrefix(1)}${truncatedJson}`;

      try {
        await service.decompressAndDecrypt({
          dataStr,
          encryptKey: undefined,
          isEncryptExpected: false,
        });
        fail('Expected JsonParseError to be thrown');
      } catch (e) {
        expect(e instanceof JsonParseError).toBeTrue();
        const error = e as JsonParseError;
        expect(error.message).toContain('Failed to parse JSON data');
        expect(error.message).toContain('corrupted or incomplete');
      }
    });

    it('should include data sample in JsonParseError for debugging', async () => {
      const invalidJson = '{"valid": true}extra garbage here';
      const dataStr = `${makePrefix(1)}${invalidJson}`;

      try {
        await service.decompressAndDecrypt({
          dataStr,
          encryptKey: undefined,
          isEncryptExpected: false,
        });
        fail('Expected JsonParseError to be thrown');
      } catch (e) {
        expect(e instanceof JsonParseError).toBeTrue();
        const error = e as JsonParseError;
        // Position should be extracted from the SyntaxError
        expect(error.position).toBeDefined();
      }
    });

    it('should handle empty JSON string', async () => {
      const dataStr = `${makePrefix(1)}`;

      await expectAsync(
        service.decompressAndDecrypt({
          dataStr,
          encryptKey: undefined,
          isEncryptExpected: false,
        }),
      ).toBeRejectedWithError(JsonParseError);
    });

    it('should parse complex nested JSON', async () => {
      const complexData = {
        tasks: [{ id: '1', title: 'Test' }],
        config: { nested: { deep: { value: true } } },
        numbers: [1, 2, 3],
      };
      const dataStr = `${makePrefix(2)}${JSON.stringify(complexData)}`;

      const result = await service.decompressAndDecrypt<typeof complexData>({
        dataStr,
        encryptKey: undefined,
        isEncryptExpected: false,
      });

      expect(result.data).toEqual(complexData);
      expect(result.modelVersion).toBe(2);
    });

    // GHSA-vrc7-775g-ggqc: the prefix flags live OUTSIDE the AEAD envelope, so a
    // remote attacker can strip the `E` flag and serve plaintext. When encryption
    // is expected the decode must fail closed instead of accepting the plaintext.
    describe('plaintext-when-encryption-expected guard', () => {
      // "pf_1__" (no E flag) is a plaintext blob.
      const plaintextBlob = (): string =>
        `${makePrefix(1)}${JSON.stringify({ secret: 'value' })}`;
      // "pf_E1__" declares encryption in the prefix.
      const encryptedPrefixBlob = (): string => 'pf_E1__ciphertext';

      it('throws PlaintextWhenEncryptionExpectedError when isEncryptExpected but blob is plaintext', async () => {
        await expectAsync(
          service.decompressAndDecrypt({
            dataStr: plaintextBlob(),
            encryptKey: 'the-key',
            isEncryptExpected: true,
          }),
        ).toBeRejectedWithError(PlaintextWhenEncryptionExpectedError);
      });

      it('refuses via decompressAndDecryptData when cfg.isEncrypt but remote is plaintext', async () => {
        await expectAsync(
          service.decompressAndDecryptData(
            { isEncrypt: true, isCompress: false },
            'the-key',
            plaintextBlob(),
          ),
        ).toBeRejectedWithError(PlaintextWhenEncryptionExpectedError);
      });

      it('does NOT attach the payload to the error (privacy)', async () => {
        try {
          await service.decompressAndDecrypt({
            dataStr: plaintextBlob(),
            encryptKey: 'the-key',
            isEncryptExpected: true,
          });
          fail('Expected PlaintextWhenEncryptionExpectedError');
        } catch (e) {
          expect(e instanceof PlaintextWhenEncryptionExpectedError).toBeTrue();
          const err = e as PlaintextWhenEncryptionExpectedError;
          expect(err.additionalLog).toEqual({ isCompressed: false, modelVersion: 1 });
          expect(JSON.stringify(err.additionalLog)).not.toContain('secret');
        }
      });

      it('still accepts plaintext when encryption is NOT expected', async () => {
        const result = await service.decompressAndDecryptData<{ secret: string }>(
          { isEncrypt: false, isCompress: false },
          undefined,
          plaintextBlob(),
        );
        expect(result).toEqual({ secret: 'value' });
      });

      it('accepts plaintext when isEncryptExpected is explicitly false', async () => {
        const result = await service.decompressAndDecrypt<{ secret: string }>({
          dataStr: plaintextBlob(),
          encryptKey: undefined,
          isEncryptExpected: false,
        });
        expect(result.data).toEqual({ secret: 'value' });
      });

      it('does NOT block a genuinely-encrypted blob (guard passes, reaches decrypt path)', async () => {
        // Prefix declares encryption, so the guard is skipped and the normal
        // "encrypted but no key" path throws instead — proving the guard only
        // rejects the plaintext-downgrade case.
        await expectAsync(
          service.decompressAndDecrypt({
            dataStr: encryptedPrefixBlob(),
            encryptKey: undefined,
            isEncryptExpected: true,
          }),
        ).toBeRejectedWithError(DecryptNoPasswordError);
      });
    });

    it('should round-trip compressed unencrypted sync data', async () => {
      const testData = {
        tasks: Array.from({ length: 20 }, (_, i) => ({
          id: `task-${i}`,
          title: `Task ${i}`,
        })),
      };

      const compressed = await service.compressAndEncrypt({
        data: testData,
        modelVersion: 3,
        isCompress: true,
        isEncrypt: false,
      });

      expect(compressed.startsWith('pf_C3__')).toBeTrue();

      const result = await service.decompressAndDecrypt<typeof testData>({
        dataStr: compressed,
        encryptKey: undefined,
        isEncryptExpected: false,
      });

      expect(result).toEqual({
        data: testData,
        modelVersion: 3,
      });
    });
  });
});

describe('JsonParseError', () => {
  beforeEach(() => {
    spyOn(OpLog, 'err').and.stub();
  });

  it('should extract position from SyntaxError message', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 12345');
    const error = new JsonParseError(syntaxError);

    expect(error.position).toBe(12345);
  });

  it('should handle SyntaxError without position', () => {
    const syntaxError = new SyntaxError('Unexpected token');
    const error = new JsonParseError(syntaxError);

    expect(error.position).toBeUndefined();
    expect(error.message).toBe(
      'Failed to parse JSON data. The sync data may be corrupted or incomplete.',
    );
  });

  it('should include position in message when available', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 100');
    const error = new JsonParseError(syntaxError);

    expect(error.message).toContain('at position 100');
  });

  it('should not retain any of the parsed data on the error object', () => {
    // Log history is exportable — no raw-data sample may survive on the error
    // (it used to hold ±50 chars around the parse position, i.e. task titles).
    const syntaxError = new SyntaxError('Unexpected token at position 30');
    const error = new JsonParseError(syntaxError);

    expect(JSON.stringify(Object.getOwnPropertyNames(error))).not.toContain('dataSample');
  });

  it('should have error name set to JsonParseError', () => {
    const error = new JsonParseError(new Error('test'));

    expect(error.name).toBe('JsonParseError');
  });

  it('should produce human-readable error text via getErrorTxt()', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 80999');
    const error = new JsonParseError(syntaxError);

    const errorText = getErrorTxt(error);

    // Should NOT be [object Object]
    expect(errorText).not.toBe('[object Object]');
    expect(errorText).not.toContain('[object Object]');
    // Should contain meaningful message
    expect(errorText).toContain('Failed to parse JSON data');
    expect(errorText).toContain('80999');
  });

  it('should handle non-Error original error', () => {
    const error = new JsonParseError('string error');

    expect(error.position).toBeUndefined();
    expect(error.message).toContain('Failed to parse JSON data');
  });
});

// #9627: `headShape` tells a maintainer reading a log export whether a decode
// failure was a bad RESPONSE or a bad STORED FILE. Its interface doc states what
// OUR OWN body looks like per config — a claim about this encoder. Pin it to the
// encoder's real output rather than to hand-written fixtures, so the doc cannot
// drift from what we actually write.
describe('head-shape of a real encoded body with its header stripped (#9627)', () => {
  let service: EncryptAndCompressHandlerService;

  beforeEach(() => {
    service = new EncryptAndCompressHandlerService();
    spyOn(OpLog, 'log').and.stub();
    spyOn(OpLog, 'normal').and.stub();
    // Same downshift the other real-crypto specs use: this asserts a body
    // SHAPE, not KDF strength, and production Argon2id costs ~190ms and 64MiB
    // per encrypted case in the browser runner.
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterEach(() => {
    setArgon2ParamsForTesting();
    clearSessionKeyCache();
  });

  /** Encodes for real, drops the `pf_…__` head, and reports what we see instead. */
  const shapeOfHeadlessBody = async (cfg: {
    isCompress: boolean;
    isEncrypt: boolean;
  }): Promise<{ headShape: unknown; prefixAt: unknown }> => {
    const modelVersion = 1;
    const encoded = await service.compressAndEncrypt({
      data: { version: 2, ops: [], lastUpdate: 1 },
      modelVersion,
      isCompress: cfg.isCompress,
      isEncrypt: cfg.isEncrypt,
      encryptKey: cfg.isEncrypt ? 'the-key' : undefined,
    });
    // Strip exactly the prefix the writer produced. Deriving the length from
    // getSyncFilePrefix (rather than scanning for `__`) means a change to the
    // header format breaks this loudly instead of silently asserting the shape
    // of the wrong bytes — which is the contract this block exists to pin.
    const prefix = getSyncFilePrefix({
      isCompress: cfg.isCompress,
      isEncrypt: cfg.isEncrypt,
      modelVersion,
    });
    expect(encoded.startsWith(prefix)).toBe(true);
    const body = encoded.slice(prefix.length);
    expect(body.length).toBeGreaterThan(0);

    expect(() => extractSyncFileStateFromPrefix(body)).toThrowError(
      InvalidFilePrefixError,
    );
    const meta = (OpLog.log as jasmine.Spy).calls.mostRecent().args[1];
    return { headShape: meta.headShape, prefixAt: meta.prefixAt };
  };

  it('reads an ENCRYPTED body as base64 — the #9627 reporter shape', async () => {
    expect(await shapeOfHeadlessBody({ isCompress: false, isEncrypt: true })).toEqual({
      headShape: 'base64',
      prefixAt: -1,
    });
  });

  it('reads a COMPRESSED body as base64', async () => {
    // compressWithGzipToString base64-encodes, so compression alone is enough.
    expect(await shapeOfHeadlessBody({ isCompress: true, isEncrypt: false })).toEqual({
      headShape: 'base64',
      prefixAt: -1,
    });
  });

  it('reads a PLAINTEXT body as json — which is why `json` is ambiguous', async () => {
    // Both flags are off by DEFAULT, so this is the common configuration: our
    // own stored file is raw JSON and is indistinguishable here from an error
    // envelope. Reading `json` as "bad response" would invert the answer.
    expect(await shapeOfHeadlessBody({ isCompress: false, isEncrypt: false })).toEqual({
      headShape: 'json',
      prefixAt: -1,
    });
  });
});

describe('extractErrorMessage', () => {
  it('preserves app-side compression error code wording', () => {
    const error = new Error('');
    Object.defineProperty(error, 'code', {
      value: 'Z_BUF_ERROR',
    });

    expect(extractErrorMessage(error)).toBe('Compression error: buf error');
  });
});
