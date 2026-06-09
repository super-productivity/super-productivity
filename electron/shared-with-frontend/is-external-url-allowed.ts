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
 * Shared between the Angular renderer (link rendering) and the Electron main
 * process (shell.openExternal call sites) so both layers enforce one policy.
 */
export const ALLOWED_EXTERNAL_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'file:'];

const _isSlash = (char: string): boolean => char === '/' || char === '\\';

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
    // remote SMB reference and leaks the user's NTLM hash. Gate on the RAW
    // string: Chromium (renderer) and Node (main) parse file: hosts/paths
    // differently, so `parsed.host` / `parsed.pathname` are not portable.
    const lower = trimmed.toLowerCase();
    return lower.startsWith('file:///') && lower[8] !== '/' && lower[8] !== '\\';
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
