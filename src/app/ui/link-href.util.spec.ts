import { toRenderableHref } from './link-href.util';

describe('toRenderableHref', () => {
  describe('hrefs that already carry an allow-listed scheme', () => {
    [
      'http://example.com',
      'https://example.com/path?q=1#frag',
      'mailto:user@example.com',
      'tel:+1234567890',
      'file:///home/user/notes.txt',
      'obsidian://open?vault=Notes',
      'x-devonthink-item://23082026-1234-5678-9ABC-DEF012345678',
    ].forEach((href) => {
      it(`returns "${href}" untouched`, () => {
        expect(toRenderableHref(href)).toBe(href);
      });
    });

    it('trims surrounding whitespace so the validated and rendered strings match', () => {
      expect(toRenderableHref('  https://example.com  ')).toBe('https://example.com');
    });
  });

  describe('schemeless web hosts', () => {
    [
      ['www.example.com', 'http://www.example.com'],
      ['www.example.com/path', 'http://www.example.com/path'],
      ['example.com/path?q=1', 'http://example.com/path?q=1'],
      ['sub.example.co.uk/x#frag', 'http://sub.example.co.uk/x#frag'],
      ['//example.com/x', 'https://example.com/x'],
    ].forEach(([raw, expected]) => {
      it(`normalizes "${raw}" to "${expected}"`, () => {
        expect(toRenderableHref(raw)).toBe(expected);
      });
    });
  });

  describe('not renderable as a link', () => {
    [
      // Unsafe schemes (GHSA-hr87-735w-hfq3).
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'ms-msdt:/id PCWDiagnostic',
      'ftp://files.example.com',
      'file://host/share',
      '\\\\host\\share',
      // Relative / in-document targets — nothing sensible to open externally.
      '#section',
      './notes.md',
      '/abs/path',
      '',
      '   ',
      // `.md`/`.zip`/`.mov` are registrable TLDs: a relative file reference must
      // never become a one-click visit to a stranger's domain.
      'readme.md',
      'report.zip',
      'screenshot.mov',
      // A bare host is the same string shape as the above, so it stays text.
      'example.com',
      // Scheme-shaped hrefs must reach the gate unrewritten, so a future
      // dot-containing allow-listed scheme cannot be hijacked by the prefix.
      'com.acme.notes://abc',
      'ms.msdt:1234',
      // `host:port@other` is userinfo, not a port — never a bare host.
      'trusted-bank.com:8080@evil.com/login',
    ].forEach((href) => {
      it(`returns null for "${href}"`, () => {
        expect(toRenderableHref(href)).toBeNull();
      });
    });
  });

  it('normalizes to a string the scheme gate itself accepts', () => {
    // The value handed to the anchor is the value that was validated — the
    // check-one-thing-render-another gap is what makes this pattern leak.
    ['www.example.com', 'example.com/x', '//example.com/x'].forEach((raw) => {
      const href = toRenderableHref(raw) as string;
      expect(href.startsWith('http://') || href.startsWith('https://')).toBe(true);
    });
  });
});
