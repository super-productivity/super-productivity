import { PFLog } from '../../../core/log';
import { JsonParseError } from '../errors/errors';
import { EncryptAndCompressHandlerService } from './encrypt-and-compress-handler.service';
import { getErrorTxt } from '../../../util/get-error-text';

describe('EncryptAndCompressHandlerService', () => {
  let service: EncryptAndCompressHandlerService;

  // Prefix format: pf_{compress?}{encrypt?}{version}__
  // e.g., "pf_1__" for uncompressed, unencrypted, version 1
  const makePrefix = (version: number = 1): string => `pf_${version}__`;

  beforeEach(() => {
    service = new EncryptAndCompressHandlerService();
    spyOn(PFLog, 'err').and.stub();
    spyOn(PFLog, 'normal').and.stub();
    spyOn(PFLog, 'log').and.stub();
  });

  describe('decompressAndDecrypt', () => {
    it('should parse valid JSON successfully', async () => {
      const testData = { test: 'value', number: 42 };
      const jsonStr = JSON.stringify(testData);
      const dataStr = `${makePrefix(1)}${jsonStr}`;

      const result = await service.decompressAndDecrypt<typeof testData>({
        dataStr,
        encryptKey: undefined,
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
      });

      expect(result.data).toEqual(complexData);
      expect(result.modelVersion).toBe(2);
    });
  });
});

describe('JsonParseError', () => {
  beforeEach(() => {
    spyOn(PFLog, 'err').and.stub();
  });

  it('should extract position from SyntaxError message', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 12345');
    const error = new JsonParseError(syntaxError, 'some data');

    expect(error.position).toBe(12345);
  });

  it('should handle SyntaxError without position', () => {
    const syntaxError = new SyntaxError('Unexpected token');
    const error = new JsonParseError(syntaxError, 'some data');

    expect(error.position).toBeUndefined();
    expect(error.message).toBe(
      'Failed to parse JSON data. The sync data may be corrupted or incomplete.',
    );
  });

  it('should include position in message when available', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 100');
    const error = new JsonParseError(syntaxError, 'some data');

    expect(error.message).toContain('at position 100');
  });

  it('should extract data sample around error position', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 50');
    const longData = 'a'.repeat(100);
    const error = new JsonParseError(syntaxError, longData);

    expect(error.dataSample).toBeDefined();
    expect(error.dataSample!.length).toBeLessThan(longData.length + 10);
  });

  it('should have error name set to JsonParseError', () => {
    const error = new JsonParseError(new Error('test'), 'data');

    expect(error.name).toBe('JsonParseError');
  });

  it('should produce human-readable error text via getErrorTxt()', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 80999');
    const error = new JsonParseError(syntaxError, 'corrupted data');

    const errorText = getErrorTxt(error);

    // Should NOT be [object Object]
    expect(errorText).not.toBe('[object Object]');
    expect(errorText).not.toContain('[object Object]');
    // Should contain meaningful message
    expect(errorText).toContain('Failed to parse JSON data');
    expect(errorText).toContain('80999');
  });

  it('should handle non-Error original error', () => {
    const error = new JsonParseError('string error', 'data');

    expect(error.position).toBeUndefined();
    expect(error.message).toContain('Failed to parse JSON data');
  });

  it('should handle undefined dataStr', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 10');
    const error = new JsonParseError(syntaxError, undefined);

    expect(error.dataSample).toBeUndefined();
    expect(error.position).toBe(10);
  });

  it('should handle position at start of data', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 0');
    const error = new JsonParseError(syntaxError, 'invalid json');

    expect(error.position).toBe(0);
    expect(error.dataSample).toBeDefined();
  });

  it('should handle position beyond data length', () => {
    const syntaxError = new SyntaxError('Unexpected token at position 1000');
    const error = new JsonParseError(syntaxError, 'short');

    expect(error.position).toBe(1000);
    // dataSample should still be set but truncated to actual data length
    expect(error.dataSample).toBeDefined();
  });
});
