import { shell } from 'electron';
import { fileURLToPath } from 'node:url';
import {
  hasExecutableFileExtension,
  isPathSafeToOpen,
} from './shared-with-frontend/is-external-url-allowed';

/**
 * True for a local `file:` URL. `isExternalUrlSchemeAllowed` guarantees such a
 * value is the canonical `file:///<path>` form (no remote authority) before it
 * reaches the open sinks below.
 */
export const isLocalFileUrl = (value: string): boolean => /^\s*file:/i.test(value);

/**
 * Open a local filesystem path — or a local `file:` URL — with the OS default
 * handler.
 *
 * A `file:` URL is decoded to a real filesystem path first: on Windows,
 * `shell.openExternal` hands ShellExecute a Chromium-percent-encoded URL
 * (`ü` → `%C3%BC`, space → `%20`), which then searches for a literally-named
 * folder and fails to open it. `fileURLToPath` decodes those escapes and
 * converts `/C:/…` → `C:\…`, so folders/files with non-ASCII names or spaces
 * open correctly. See issue #8695.
 *
 * Enforces the two guards required at every `openPath` sink: reject UNC /
 * remote paths (they make the OS reach a remote SMB host and leak the user's
 * NTLM hash) and never launch an executable/script. See GHSA-hr87-735w-hfq3.
 */
export const openLocalPath = (pathOrFileUrl: string): void => {
  let fsPath = pathOrFileUrl;
  if (isLocalFileUrl(pathOrFileUrl)) {
    try {
      fsPath = fileURLToPath(pathOrFileUrl.trim());
    } catch {
      // Malformed file: URL (e.g. a remote authority fileURLToPath rejects).
      return;
    }
  }
  if (!isPathSafeToOpen(fsPath) || hasExecutableFileExtension(fsPath)) {
    return;
  }
  shell.openPath(fsPath);
};
