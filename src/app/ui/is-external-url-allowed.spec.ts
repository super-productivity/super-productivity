import {
  ALLOWED_EXTERNAL_URL_SCHEMES,
  isExternalUrlSchemeAllowed,
  isPathSafeToOpen,
  isUncPath,
} from '../../../electron/shared-with-frontend/is-external-url-allowed';

describe('isExternalUrlSchemeAllowed', () => {
  describe('allowed schemes', () => {
    const allowed = [
      'http://example.com',
      'https://example.com/path?q=1#frag',
      'HTTPS://EXAMPLE.COM', // scheme is case-insensitive
      'mailto:someone@example.com',
      'file:///home/user/notes.txt',
      '  https://example.com  ', // surrounding whitespace tolerated
      'tel:+123456789',
      'sms:+123456789',
      // App deep-links (#8429): launch a registered app, not an OS handler.
      'obsidian://open?vault=Notes&file=Today',
      'vscode://file/home/user/project/main.ts',
      'vscode-insiders://file/home/user/x.ts',
      'zotero://select/items/0_ABCD1234',
      'logseq://graph/Notes?page=Today',
    ];
    allowed.forEach((url) => {
      it(`allows "${url}"`, () => {
        expect(isExternalUrlSchemeAllowed(url)).toBe(true);
      });
    });

    it('keeps the allowlist in sync with expectations', () => {
      expect(ALLOWED_EXTERNAL_URL_SCHEMES).toEqual([
        'http:',
        'https:',
        'mailto:',
        'file:',
        'tel:',
        'sms:',
        'obsidian:',
        'vscode:',
        'vscode-insiders:',
        'zotero:',
        'logseq:',
      ]);
    });
  });

  describe('blocked schemes (GHSA-hr87-735w-hfq3)', () => {
    const blocked = [
      'ms-calculator:',
      'ms-msdt:/id PCWDiagnostic', // Follina (CVE-2022-30190)
      'search-ms:query=foo',
      'ms-officecmd:{}',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'ftp://example.com',
      'ssh://example.com',
      '\\\\192.168.1.100\\share', // UNC / SMB — NTLM hash capture
      '/\\192.168.1.100\\share',
      // file: with a remote authority is the same SMB / NTLM-leak vector and
      // must be blocked even though `file:` is allow-listed for local files.
      'file://192.168.1.100/share/x',
      'file:////host/share', // path-based UNC, empty host
      'file://///host/share',
      'file:///%5C%5Chost/share', // percent-encoded \\host/share
      'file:///%5c%5chost/share',
      'file:///%5Chost/share',
      'file:///%2F%2Fhost/share', // percent-encoded //host/share
      'file:///%2f%2fhost/share',
      'file:///%2Fhost/share',
      'file:///%2e//host/share', // dot-segment normalizes to file:////host/share
      'file:///%2e%2e/%2F%2Fhost/share',
      'file:///a/..//host/share',
      'file:///./%2F%2Fhost/share',
      'file:///\t//host/share',
      'file:\\\\host\\share',
      'FILE://HOST/share', // case-insensitive
    ];
    blocked.forEach((url) => {
      it(`blocks "${url}"`, () => {
        expect(isExternalUrlSchemeAllowed(url)).toBe(false);
      });
    });

    it('still allows LOCAL file: URLs (Windows drive + POSIX paths)', () => {
      expect(isExternalUrlSchemeAllowed('file:///home/user/notes.txt')).toBe(true);
      expect(isExternalUrlSchemeAllowed('file:///C:/Users/me/doc.pdf')).toBe(true);
    });
  });

  describe('isUncPath', () => {
    it('flags UNC / network paths', () => {
      ['\\\\host\\share', '//host/share', '/\\host', '\\/host', '  \\\\host\\s'].forEach(
        (p) => expect(isUncPath(p)).toBe(true),
      );
    });

    it('does not flag local absolute paths or non-strings', () => {
      ['/home/user/x', 'C:\\Users\\me', './rel', '', '/', 'x', undefined, null].forEach(
        (p) => expect(isUncPath(p as unknown as string)).toBe(false),
      );
    });
  });

  describe('isPathSafeToOpen (shell.openPath gate)', () => {
    it('allows local filesystem paths and local file:// URLs', () => {
      [
        '/home/user/doc.pdf',
        'C:\\Users\\me\\doc.pdf',
        './rel/x',
        'file:///home/x',
      ].forEach((p) => expect(isPathSafeToOpen(p)).toBe(true));
    });

    it('blocks UNC paths AND remote file:// URLs (NTLM leak via shell.openPath)', () => {
      [
        '\\\\host\\share',
        '//host/share',
        'file://host/share',
        'file://192.168.1.100/share/x',
        'file:////host/share',
        'file:///%5C%5Chost/share',
        'file:///%5c%5chost/share',
        'file:///%5Chost/share',
        'file:///%2F%2Fhost/share',
        'file:///%2f%2fhost/share',
        'file:///%2Fhost/share',
        'file:///%2e//host/share',
        'file:///%2e%2e/%2F%2Fhost/share',
        'file:///a/..//host/share',
        'file:///./%2F%2Fhost/share',
        'file:///\t//host/share',
        '',
        undefined,
        null,
      ].forEach((p) => expect(isPathSafeToOpen(p as unknown as string)).toBe(false));
    });
  });

  describe('malformed / non-string input', () => {
    it('blocks empty and whitespace-only strings', () => {
      expect(isExternalUrlSchemeAllowed('')).toBe(false);
      expect(isExternalUrlSchemeAllowed('   ')).toBe(false);
    });

    it('blocks schemeless / relative input', () => {
      expect(isExternalUrlSchemeAllowed('example.com')).toBe(false);
      expect(isExternalUrlSchemeAllowed('//example.com')).toBe(false);
      expect(isExternalUrlSchemeAllowed('./relative/path')).toBe(false);
    });

    it('blocks non-string input', () => {
      expect(isExternalUrlSchemeAllowed(undefined)).toBe(false);
      expect(isExternalUrlSchemeAllowed(null)).toBe(false);
      expect(isExternalUrlSchemeAllowed(42)).toBe(false);
      expect(isExternalUrlSchemeAllowed({ href: 'https://example.com' })).toBe(false);
    });
  });
});
