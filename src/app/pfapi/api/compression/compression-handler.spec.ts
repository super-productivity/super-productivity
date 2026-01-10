import { PFLog } from '../../../core/log';
import { DecompressError } from '../errors/errors';
import {
  compressWithGzipToString,
  decompressGzipFromString,
} from './compression-handler';

describe('compression-handler', () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    spyOn(PFLog, 'err').and.stub();
    spyOn(console, 'log').and.stub();
    originalFetch = (globalThis as any).fetch;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('compresses and decompresses strings losslessly', async () => {
    (globalThis as any).fetch = jasmine.createSpy('fetch').and.callFake((url: string) => {
      const base64 = url.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return Promise.resolve(new Response(bytes));
    });

    const payload = {
      text: 'Hello 😀',
      numbers: [1, 2, 3],
      nested: { active: true, count: 42 },
    };
    const serialized = JSON.stringify(payload);

    const compressed = await compressWithGzipToString(serialized);
    expect(typeof compressed).toBe('string');
    expect(compressed.startsWith('data:')).toBeFalse();

    const decompressed = await decompressGzipFromString(compressed);

    expect(decompressed).toEqual(serialized);
    expect(JSON.parse(decompressed)).toEqual(payload);
  });

  it('throws DecompressError when base64 cannot be decoded', async () => {
    (globalThis as any).fetch = jasmine
      .createSpy('fetch')
      .and.callFake(() => Promise.reject(new Error('fetch failed')));

    await expectAsync(decompressGzipFromString('invalid-base64')).toBeRejectedWithError(
      DecompressError,
    );
  });

  it('throws DecompressError with meaningful message from fetch error', async () => {
    (globalThis as any).fetch = jasmine
      .createSpy('fetch')
      .and.callFake(() => Promise.reject(new Error('Network request failed')));

    try {
      await decompressGzipFromString('invalid-base64');
      fail('Expected error to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DecompressError);
      const error = e as DecompressError;
      expect(error.message).toBe('Network request failed');
      // Should NOT be a minified class name
      expect(error.message).not.toMatch(/^[A-Z]{1,3}$/);
    }
  });

  it('throws DecompressError with meaningful message from TypeError with cause', async () => {
    const innerError = new Error('incorrect header check');
    const outerError = new TypeError('', { cause: innerError });
    (globalThis as any).fetch = jasmine
      .createSpy('fetch')
      .and.callFake(() => Promise.reject(outerError));

    try {
      await decompressGzipFromString('invalid-base64');
      fail('Expected error to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DecompressError);
      const error = e as DecompressError;
      expect(error.message).toBe('incorrect header check');
    }
  });

  it('throws DecompressError with meaningful message from zlib error code', async () => {
    const zlibError = Object.assign(new Error(''), { code: 'Z_DATA_ERROR' });
    (globalThis as any).fetch = jasmine
      .createSpy('fetch')
      .and.callFake(() => Promise.reject(zlibError));

    try {
      await decompressGzipFromString('invalid-base64');
      fail('Expected error to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DecompressError);
      const error = e as DecompressError;
      expect(error.message).toBe('Compression error: data error');
    }
  });
});
