import { resolveBgImageToDataUrl } from './resolve-bg-image-to-data-url.util';

describe('resolveBgImageToDataUrl', () => {
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

  // Outside Electron (the unit-test environment) file:// URLs are not inlined
  // and pass through unchanged; the on-disk read path only runs under Electron.
  it('does not inline file:// URLs outside Electron', async () => {
    const url = 'file:///home/user/bg.png';
    expect(await resolveBgImageToDataUrl(url)).toBe(url);
  });
});
