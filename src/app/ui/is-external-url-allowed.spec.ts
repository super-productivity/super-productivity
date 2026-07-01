import {
  ALLOWED_EXTERNAL_URL_SCHEMES,
  hasExecutableFileExtension,
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
      'webexteams://im?space=ff135070-68f8-11f1-9229-c7e6cca7a7cd&message=f4f13440-6b50-11f1-8868-03e71232fa87',
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
        'webexteams:',
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

describe('hasExecutableFileExtension (shell.openPath execution gate)', () => {
  it('flags executable / script extensions across platforms', () => {
    [
      'C:\\Users\\me\\evil.bat',
      '/home/u/evil.sh',
      './rel/evil.cmd',
      'x.exe',
      'x.com',
      'x.vbs',
      'x.js',
      'x.jse',
      'x.wsf',
      'x.hta',
      'x.ps1',
      'x.msi',
      'x.scr',
      'x.lnk',
      'x.reg',
      'x.jar',
      'payload.command',
      'payload.app',
      'payload.desktop',
      'payload.appimage',
      'payload.run',
      'file:///C:/tools/evil.bat',
    ].forEach((p) => expect(hasExecutableFileExtension(p)).toBe(true));
  });

  it('is case-insensitive and resolves double extensions to the last one', () => {
    ['EVIL.BAT', 'x.ExE', 'invoice.pdf.bat', 'photo.png.cmd'].forEach((p) =>
      expect(hasExecutableFileExtension(p)).toBe(true),
    );
  });

  it('normalizes Windows trailing dots/spaces and NTFS alternate data streams', () => {
    [
      'evil.bat.', // trailing dot — Windows executes as evil.bat
      'evil.bat   ', // trailing spaces
      'evil.bat . ',
      'evil.bat::$DATA', // NTFS ADS
      'C:\\x\\evil.bat:stream',
      'file:///C:/x.bat?download=1', // query stripped before the check
    ].forEach((p) => expect(hasExecutableFileExtension(p)).toBe(true));
  });

  it('allows documents, folders, and extensionless paths', () => {
    [
      '/home/u/report.pdf',
      'C:\\docs\\sheet.xlsx',
      'notes.txt',
      'image.png',
      'archive.zip',
      'data.json',
      'page.html',
      '/home/u/folder',
      'C:\\Users\\me',
      'README',
      '.bashrc', // dotfile with no extension
    ].forEach((p) => expect(hasExecutableFileExtension(p)).toBe(false));
  });

  it('does NOT treat `#`/`?` in a bare path as a URL delimiter (real ext wins)', () => {
    // `#` is a legal Windows/NTFS filename char; both `#` and `?` are legal on
    // POSIX. Splitting on them for a bare path would misread the extension and
    // let the executable through. The real extension must win here.
    [
      'C:\\sync\\evil.txt#.bat', // ShellExecute runs this as .bat
      '/home/u/evil.txt#.sh',
      '/home/u/launcher.txt?.desktop',
      'C:\\sync\\report.pdf#.cmd',
      // POSIX filename that merely starts with the literal `file:` (not a URL) —
      // `#`/`?` are legal chars here, so the real `.sh`/`.desktop` ext must win.
      'file:notes.txt#.sh',
      'file:launcher.txt?.desktop',
    ].forEach((p) => expect(hasExecutableFileExtension(p)).toBe(true));
  });

  it('flags additional ShellExecute / launcher vectors', () => {
    [
      'x.settingcontent-ms',
      'x.appref-ms',
      'x.library-ms',
      'x.wsc',
      'x.chm',
      'x.hlp',
      'x.diagcab',
      'x.msix',
      'x.appx',
      'payload.pkg',
      'payload.terminal',
      'payload.fileloc',
      'payload.inetloc',
    ].forEach((p) => expect(hasExecutableFileExtension(p)).toBe(true));
  });

  it('returns false for non-string input', () => {
    [undefined, null, 42, { path: 'x.bat' }].forEach((p) =>
      expect(hasExecutableFileExtension(p as unknown as string)).toBe(false),
    );
  });
});
