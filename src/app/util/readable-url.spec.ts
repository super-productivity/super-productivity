import { readableUrl } from './readable-url';

describe('readableUrl', () => {
  it('returns host and decoded path', () => {
    expect(readableUrl('https://www.example.com/foo/bar-baz')).toBe(
      'example.com: foo bar baz',
    );
  });

  it('returns just the host when there is no path', () => {
    expect(readableUrl('https://example.com/')).toBe('example.com');
  });

  it('returns the original string for invalid URLs', () => {
    expect(readableUrl('not a url')).toBe('not a url');
  });
});
