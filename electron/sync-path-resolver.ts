import * as fs from 'fs';
import * as path from 'path';
import { assertPathOutside } from './file-path-guard';

/**
 * Resolve a renderer-supplied relative path against the main-owned sync folder.
 *
 * The threat model (issue #8228): the renderer (and any plugin / XSS in it)
 * cannot be trusted to supply absolute filesystem paths. Before this resolver
 * the FILE_SYNC_* IPCs accepted any absolute path outside `userData`, which
 * is nearly the whole filesystem. After this resolver the renderer hands
 * over a *relative* path; the main process owns the only legitimate root.
 *
 * Earlier design notes considered a multi-grant capability model with
 * opaque `grantId`s. We dropped it: this app has exactly one user-pickable
 * filesystem location (the sync folder); background images go through
 * copy-to-cache (no folder grant); plugins do not get folder grants; backups
 * use a main-derived path. The opaque-id pattern adds zero marginal security
 * over a featureless `{ relativePath }` API — an XSS in the renderer would
 * just replay the id from memory. The security boundary is "main owns the
 * canonical root and the resolver logic", not the id.
 *
 * Layered defenses (any failure → opaque `PathNotAllowedError`, no path
 * embedded in the message):
 *
 *   1. Both inputs are strings. Failures fail closed.
 *   2. The sync root is canonicalized at resolve time (`fs.realpathSync.native`).
 *      A missing/inaccessible root denies.
 *   3. The canonical root must not equal or live inside `userData` — a user
 *      who picks `userData` as their sync folder would otherwise hand the
 *      renderer authority over settings/grants/db (the same privilege the
 *      `assertPathOutside` backstop already blocks for direct paths).
 *   4. `relativePath` may be `''` or `'.'` (resolves to the root itself, for
 *      directory ops like LIST/CHECK_DIR_EXISTS). Anything else must not be
 *      absolute and must not escape the root (`path.relative` must not start
 *      with `..`).
 *   5. If the leaf exists, it must not be a symlink (v1 policy: refuse
 *      symlinks; simpler and sufficient for this app, the O_NOFOLLOW
 *      alternative is a follow-up).
 *   6. The canonical form of the resolved path (or its deepest existing
 *      ancestor when the leaf doesn't exist yet) must still live inside the
 *      canonical root. Catches symlinks/junctions in intermediate
 *      directories and case-fold / 8.3-shortname aliases (same reasoning as
 *      `electron/file-path-guard.ts`).
 *   7. Ancestor walk fails CLOSED on EACCES — only `ENOENT` is treated as
 *      "leaf-not-yet-existing, keep walking". A user-data-dir restricted by
 *      another process must not become an implicit allow.
 *
 * Acknowledged TOCTOU: between this resolver and the IPC handler's actual
 * `writeFileSync`/`readFileSync`, the leaf can be replaced with a symlink.
 * Switching callers to `open(..., O_NOFOLLOW)` and operating on the fd would
 * shrink the window further (O_NOFOLLOW exists on Linux AND macOS; Windows
 * has no equivalent). Tracked as a follow-up to issue #8228.
 */

const _denied = (): Error => {
  const e = new Error('Path not allowed for the sync folder');
  e.name = 'PathNotAllowedError';
  delete (e as { stack?: string }).stack;
  return e;
};

const _isInsideRoot = (root: string, candidate: string): boolean => {
  if (candidate === root) return true;
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const _isEnoent = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  'code' in e &&
  (e as { code?: unknown }).code === 'ENOENT';

export interface ResolvedSyncPath {
  /** Absolute filesystem path the IPC handler may operate on. */
  readonly absolutePath: string;
  /** Canonicalized sync root the path resolved under. */
  readonly root: string;
  /** True when `relativePath` resolves to the root itself (for LIST/CHECK ops). */
  readonly isRoot: boolean;
}

/**
 * Resolve `(syncFolderPath, relativePath)` to a vetted absolute path.
 *
 * `syncFolderPath` is the main-owned, user-configured root (typically loaded
 * from `simple-store`). It is canonicalized inside this function; callers
 * should NOT pre-canonicalize because the root may have moved since startup.
 *
 * Throws `PathNotAllowedError` on any rejection. The error's `message` is a
 * fixed string — the offending path is never embedded so it cannot be
 * mirrored back to the renderer via the IPC error path.
 */
export const resolveSyncPath = (
  syncFolderPath: string | undefined,
  relativePath: string,
  userDataDir: string,
): ResolvedSyncPath => {
  if (typeof syncFolderPath !== 'string' || syncFolderPath.length === 0) {
    throw _denied();
  }
  if (typeof relativePath !== 'string') {
    throw _denied();
  }
  if (typeof userDataDir !== 'string' || userDataDir.length === 0) {
    throw _denied();
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync.native(syncFolderPath);
  } catch {
    throw _denied();
  }

  // Hard backstop: the sync root may never coincide with or live under the
  // app's private dir, even if the user explicitly picks it. The renderer
  // could otherwise rewrite settings/grants/db via the sync IPCs.
  try {
    assertPathOutside(userDataDir, canonicalRoot);
  } catch {
    throw _denied();
  }

  if (path.isAbsolute(relativePath)) {
    throw _denied();
  }

  // Normalize and join. `path.resolve` handles `''`, `'.'`, and intermediate
  // `..` by collapsing them. The traversal check below uses the resolved
  // joined path, so `'a/../b'` is treated identically to `'b'`.
  const joined = path.resolve(canonicalRoot, relativePath);
  if (!_isInsideRoot(canonicalRoot, joined)) {
    throw _denied();
  }

  const isRoot = joined === canonicalRoot;

  let leafLstat: fs.Stats | null = null;
  try {
    leafLstat = fs.lstatSync(joined);
  } catch (e) {
    if (!_isEnoent(e)) {
      // EACCES / EPERM / EIO etc. on the leaf is a deny, not a "missing leaf".
      throw _denied();
    }
    leafLstat = null;
  }

  if (leafLstat) {
    if (leafLstat.isSymbolicLink()) {
      throw _denied();
    }
    let canonicalLeaf: string;
    try {
      canonicalLeaf = fs.realpathSync.native(joined);
    } catch {
      throw _denied();
    }
    if (!_isInsideRoot(canonicalRoot, canonicalLeaf)) {
      throw _denied();
    }
    return { absolutePath: joined, root: canonicalRoot, isRoot };
  }

  // Leaf does not exist (e.g. FILE_SYNC_SAVE target). Canonicalize the
  // deepest existing ancestor so a directory symlink mid-path can't sneak
  // the write outside the root. Only ENOENT lets us walk up — any other
  // realpath error (EACCES, ELOOP, ENOTDIR) is treated as deny so a
  // permission-restricted ancestor cannot be silently rubber-stamped.
  let cursor = path.dirname(joined);
  while (cursor !== path.dirname(cursor)) {
    let realAncestor: string | null = null;
    try {
      realAncestor = fs.realpathSync.native(cursor);
    } catch (e) {
      if (!_isEnoent(e)) {
        throw _denied();
      }
      realAncestor = null;
    }
    if (realAncestor !== null) {
      if (!_isInsideRoot(canonicalRoot, realAncestor)) {
        throw _denied();
      }
      return { absolutePath: joined, root: canonicalRoot, isRoot };
    }
    cursor = path.dirname(cursor);
  }
  // Walked all the way up without finding any existing ancestor. That means
  // even the canonical root doesn't exist on disk — which we ruled out at
  // step 2 above, so this branch is unreachable. Be paranoid anyway.
  throw _denied();
};
