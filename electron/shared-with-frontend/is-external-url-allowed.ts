/**
 * URL schemes that are permitted to reach the OS handler via shell.openExternal.
 *
 * Task notes render Markdown links whose href would otherwise be passed verbatim
 * to the OS handler on click. Without this gate, anyone who can populate note
 * content (multi-device sync, shared/imported backups, issue-provider content)
 * could make a single click silently invoke any OS-registered protocol —
 * `ms-msdt:`, `search-ms:`, etc.
 * See GHSA-hr87-735w-hfq3.
 *
 * The app-deep-link schemes below (obsidian:, vscode:, …) only launch a
 * registered desktop app with a parameter (open a note/file/reference) — a far
 * narrower surface than the OS-level handlers this allowlist exists to block.
 * They are allow-listed because productivity users routinely link tasks to such
 * apps (#8429: obsidian:// links stopped opening after the GHSA-hr87 fix).
 * shortcut: a curated set — if a user needs a scheme that isn't here, the
 * upgrade path is a user-configurable allowlist in settings (MiscConfig).
 *
 * Shared between the Angular renderer (link rendering) and the Electron main
 * process (shell.openExternal call sites) so both layers enforce one policy.
 */
export const ALLOWED_EXTERNAL_URL_SCHEMES = [
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
];

const LOCAL_FILE_URL_PREFIX = 'file:///';
const ASCII_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const _isSlash = (char: string): boolean => char === '/' || char === '\\';
const _isEncodedSlashAt = (value: string, index: number): boolean =>
  value.startsWith('%2f', index) || value.startsWith('%5c', index);
const _hasUncLikeLocalFilePathStart = (value: string): boolean => {
  const firstLocalPathCharIndex = LOCAL_FILE_URL_PREFIX.length;
  return (
    value[firstLocalPathCharIndex] === '/' ||
    value[firstLocalPathCharIndex] === '\\' ||
    _isEncodedSlashAt(value, firstLocalPathCharIndex)
  );
};
const _isLocalFileUrlWithoutUncPrefix = (value: string): boolean =>
  value.startsWith(LOCAL_FILE_URL_PREFIX) && !_hasUncLikeLocalFilePathStart(value);

/**
 * True for a UNC / network path such as `\\host\share` or `//host/share` — i.e.
 * any path whose first two characters are slashes (in either direction).
 *
 * Opening such a path (`shell.openPath` / `shell.openExternal('file://host/…')`)
 * makes the OS reach out to a remote SMB host, leaking the user's NTLM hash.
 * Local absolute paths (`/home/x`, `C:\x`) and POSIX/Windows roots are NOT UNC.
 */
export const isUncPath = (path: unknown): boolean => {
  if (typeof path !== 'string') {
    return false;
  }
  const trimmed = path.trim();
  return trimmed.length >= 2 && _isSlash(trimmed[0]) && _isSlash(trimmed[1]);
};

/**
 * Returns true only for URLs whose scheme is in ALLOWED_EXTERNAL_URL_SCHEMES.
 * Schemeless/relative input and any string that fails URL parsing are rejected.
 * `file:` is restricted to LOCAL files — a `file:` URL with a remote authority
 * (`file://host/share`, or a path-based UNC like `file:////host/share`) is the
 * same NTLM-hash-leak vector as a raw `\\host\share` path and is rejected.
 */
export const isExternalUrlSchemeAllowed = (url: unknown): boolean => {
  if (typeof url !== 'string') {
    return false;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  let parsed: URL;
  try {
    // Raw UNC paths (`\\host\share`, `//host`) and schemeless input throw here.
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  // `protocol` is always lower-cased by the WHATWG URL parser.
  if (!ALLOWED_EXTERNAL_URL_SCHEMES.includes(parsed.protocol)) {
    return false;
  }
  if (parsed.protocol === 'file:') {
    // Allow ONLY the canonical local form `file:///<path>`. Anything with an
    // authority (`file://host/…`) or a path-based UNC (`file:////host`) is a
    // remote SMB reference and leaks the user's NTLM hash. Gate on both the RAW
    // string and the parser-normalized href: raw catches parser differences,
    // normalized catches dot-segment/control-character rewrites.
    const lower = trimmed.toLowerCase();
    if (ASCII_CONTROL_CHAR_RE.test(lower)) {
      return false;
    }
    const normalizedLower = parsed.href.toLowerCase();
    return (
      _isLocalFileUrlWithoutUncPrefix(lower) &&
      _isLocalFileUrlWithoutUncPrefix(normalizedLower)
    );
  }
  return true;
};

/**
 * Returns true if a value is safe to hand to `shell.openPath` (which opens a
 * filesystem path, not a URL). Rejects UNC paths AND `file:`-scheme values with
 * a remote authority — `shell.openPath('file://host/share')` resolves to
 * `\\host\share` on Windows, the same NTLM-leak `isUncPath` blocks for the raw
 * form. Plain local paths (`/home/x`, `C:\x`, `./rel`) are allowed.
 * See GHSA-hr87-735w-hfq3.
 */
export const isPathSafeToOpen = (path: unknown): boolean => {
  if (typeof path !== 'string') {
    return false;
  }
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }
  if (isUncPath(trimmed)) {
    return false;
  }
  // A file:-scheme value must be a LOCAL file URL, not a remote authority.
  if (trimmed.toLowerCase().startsWith('file:')) {
    return isExternalUrlSchemeAllowed(trimmed);
  }
  return true;
};

/**
 * Executable / script extensions that `shell.openPath` must never launch.
 *
 * `shell.openPath` hands the file to the OS default handler, and on Windows
 * `ShellExecute` *runs* these from a plain file with no exec bit — so a renderer
 * (a plugin or XSS) that can drop a file into a writable dir (e.g. the
 * local-file sync folder via `FILE_SYNC_SAVE`) and then call
 * `window.ea.openPath()` on it gets native code execution that bypasses the
 * `nodeExecution` consent gate. A malicious synced FILE attachment whose path
 * points at such a file is the same vector on user click.
 *
 * shortcut: a curated denylist — executable extensions vary by platform and new
 * ones appear. If this proves leaky, the upgrade path is to invert it into an
 * allowlist of openable document types (or a user confirm) at the openPath sink.
 */
const EXECUTABLE_FILE_EXTENSIONS = new Set<string>([
  // Windows — run directly by ShellExecute
  'exe',
  'com',
  'bat',
  'cmd',
  'pif',
  'scr',
  'cpl',
  'msi',
  'msp',
  'msc',
  'vbs',
  'vbe',
  'js',
  'jse',
  'ws',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'psc1',
  'hta',
  'reg',
  'inf',
  'scf',
  'lnk',
  'url',
  'jar',
  'jnlp',
  'gadget',
  'application',
  'appref-ms', // ClickOnce launcher (sibling of .application)
  'settingcontent-ms', // runs arbitrary commands via ShellExecute (LOLBin RCE)
  'library-ms', // crafted library files have been used for code exec
  'wsc', // Windows Script Component (sibling of .wsf/.wsh)
  'chm', // compiled HTML help — executes on open
  'hlp', // legacy WinHelp — executes on open
  'diagcab', // Windows troubleshooter package — runs on open
  'msix',
  'msixbundle',
  'appx',
  'appxbundle',
  // macOS
  'command',
  'app',
  'workflow',
  'action',
  'scpt',
  'pkg', // launches the Installer for an arbitrary package
  'terminal', // Terminal settings file that also runs a command on open
  'fileloc', // location files abused to run commands (CVE-2022-42821)
  'inetloc',
  // Linux / cross-platform
  'sh',
  'bash',
  'zsh',
  'csh',
  'ksh',
  'run',
  'out',
  'bin',
  'appimage',
  'desktop',
  'deb',
  'rpm',
]);

/**
 * True if `path` ends in a known-executable/script extension (see
 * {@link EXECUTABLE_FILE_EXTENSIONS}). Windows strips trailing dots/spaces from
 * filenames (so `evil.bat.` / `evil.bat ` execute as `evil.bat`) and supports
 * NTFS alternate data streams (`evil.bat::$DATA`), so both are normalized away
 * before the check. Double extensions (`invoice.pdf.bat`) resolve to `.bat`.
 */
export const hasExecutableFileExtension = (path: unknown): boolean => {
  if (typeof path !== 'string') {
    return false;
  }
  const trimmed = path.trim();
  // Drop the query/fragment ONLY for a real `file://` URL (`file:///x.bat?y`). In
  // a bare filesystem path `#` is a legal filename char on Windows/NTFS (and `#`,
  // `?` and `:` are all legal on POSIX), so splitting on them there would let
  // `evil.txt#.bat` — whose real extension ShellExecute reads as `.bat` — slip
  // through as the harmless-looking `.txt`. Require the `//` so a POSIX file that
  // merely starts with the literal `file:` isn't mistaken for a URL either.
  const withoutQuery = /^file:\/\//i.test(trimmed) ? trimmed.split(/[?#]/)[0] : trimmed;
  // Strip trailing Windows dots/spaces (a real filesystem normalization).
  const candidate = withoutQuery.replace(/[ .]+$/, '');
  const lastSep = Math.max(candidate.lastIndexOf('/'), candidate.lastIndexOf('\\'));
  const base = candidate.slice(lastSep + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return false; // no extension, or a dotfile with none
  }
  // `.slice` after the dot, then strip an NTFS ADS suffix (`bat:$DATA`).
  const ext = base
    .slice(dot + 1)
    .toLowerCase()
    .split(':')[0];
  return EXECUTABLE_FILE_EXTENSIONS.has(ext);
};
