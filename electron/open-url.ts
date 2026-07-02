import { shell } from 'electron';
import { fileURLToPath } from 'node:url';
import {
  hasExecutableFileExtension,
  isPathSafeToOpen,
} from './shared-with-frontend/is-external-url-allowed';

/**
 * True for anything shaped like a `file:` URL. Intentionally broad: at the
 * OPEN_PATH sink there is no `isExternalUrlSchemeAllowed` pre-gate, so this must
 * catch every `file:`-shape value and hand it to `openLocalPath`, which
 * re-validates the decoded path. (At the OPEN_EXTERNAL / navigation sinks,
 * `isExternalUrlSchemeAllowed` has already narrowed the input to a canonical
 * `file:///<path>`.) Note this is deliberately looser than that check and than
 * the renderer's `startsWith('file://')` guard — the safety comes from the
 * post-decode guards in `openLocalPath`, not from this test.
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
