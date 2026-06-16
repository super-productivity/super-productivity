import { resolveBgImageToDataUrl } from './resolve-bg-image-to-data-url.util';

describe('resolveBgImageToDataUrl', () => {
  afterEach(() => {
    delete (window as { ea?: unknown }).ea;
  });

  it('returns null for empty input', async () => {
    expect(await resolveBgImageToDataUrl(null)).toBeNull();
    expect(await resolveBgImageToDataUrl(undefined)).toBeNull();
    expect(await resolveBgImageToDataUrl('')).toBeNull();
  });

  it('passes through non-file URLs unchanged', async () => {
    const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAA==';
    expect(await resolveBgImageToDataUrl(dataUrl)).toBe(dataUrl);
    expect(await resolveBgImageToDataUrl('https://example.com/bg.png')).toBe(
      'https://example.com/bg.png',
    );
  });

  it('drops legacy file:// values (no IPC reads renderer-supplied paths anymore)', async () => {
    // Phase 4 of #8228: the IPC that resolved renderer-supplied file://
    // paths was removed. Existing pre-#8228 configs with file:// values
    // render no background until the user re-picks via the cache-backed
    // image picker.
    expect(await resolveBgImageToDataUrl('file:///home/user/bg.png')).toBeNull();
  });

  it('resolves image:<id> via the main-owned image cache IPC', async () => {
    const imageCacheGetDataUrl = jasmine
      .createSpy('imageCacheGetDataUrl')
      .and.resolveTo('data:image/png;base64,abc');
    (window as { ea?: unknown }).ea = { imageCacheGetDataUrl };

    const result = await resolveBgImageToDataUrl(`image:${'a'.repeat(32)}`);

    expect(imageCacheGetDataUrl).toHaveBeenCalledWith('a'.repeat(32));
    expect(result).toBe('data:image/png;base64,abc');
  });

  it('returns null when image:<id> is unknown', async () => {
    (window as { ea?: unknown }).ea = {
      imageCacheGetDataUrl: jasmine.createSpy('imageCacheGetDataUrl').and.resolveTo(null),
    };
    expect(await resolveBgImageToDataUrl(`image:${'a'.repeat(32)}`)).toBeNull();
  });
});
