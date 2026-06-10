import * as fs from 'fs';
import * as path from 'path';

/**
 * Canonicalize a path for containment checks: resolve the deepest existing
 * ancestor with `fs.realpathSync.native` and re-append the (possibly
 * not-yet-existing) tail. This collapses symlinks AND filesystem-level aliases
 * — case-insensitive names on macOS APFS / NTFS and Windows 8.3 short names —
 * so a renderer cannot slip a check with e.g. a case-variant of the protected
 * dir (`…/SUPERPRODUCTIVITY/simpleSettings`), which a purely lexical compare
 * treats as a different, "outside" path.
 *
 * The leaf often does not exist yet (a `FILE_SYNC_SAVE` target), hence the
 * deepest-existing-ancestor walk; with no existing ancestor we fall back to a
 * lexical resolve (`path.dirname` of a root is a fixed point, ending the loop).
 * The catch intentionally swallows ANY realpath error (ENOENT, but also EACCES /
 * ELOOP / ENOTDIR) and keeps walking up, so an unresolvable component is treated
 * lexically — keeping the deny direction (`assertPathOutside`) fail-closed.
 */
const canonicalize = (p: string): string => {
  const resolved = path.resolve(p);
  let current = resolved;
  const tail: string[] = [];
  while (true) {
    try {
      const real = fs.realpathSync.native(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
};

/**
 * Returns true if `targetPath` resolves to a location strictly inside `dir`
 * (`dir` itself is NOT "inside").
 *
 * Security boundary: several IPC handlers receive file paths from the renderer,
 * which executes untrusted plugin code (plugin scripts run via `new Function`
 * in `src/app/plugins/plugin-runner.ts`). Without constraining the path, a
 * plugin could read/write arbitrary files via the exposed `window.ea` bridge.
 * See GHSA-x937-wf3j-88q3.
 *
 * `path.relative` (over canonical paths) is used instead of a `startsWith`
 * string compare so that `..` traversal is collapsed and a sibling directory
 * sharing a name prefix (e.g. `backups` vs `backups-evil`) is not mistaken for
 * a child. Paths are canonicalized first (see `canonicalize`) so symlinks and
 * case-insensitive / 8.3 short-name aliases cannot bypass the check.
 */
export const isPathInsideDir = (dir: string, targetPath: string): boolean => {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return false;
  }
  const rel = path.relative(canonicalize(dir), canonicalize(targetPath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Generic, path-free error so the offending path never leaks back to the
// untrusted renderer (handlers further sanitize via createSafeIpcError).
const pathNotAllowed = (message: string): Error => {
  const e = new Error(message);
  e.name = 'PathNotAllowedError';
  delete (e as { stack?: string }).stack;
  return e;
};

/**
 * Throw if `candidate` is `dir` itself or resolves inside it. The deny direction
 * for IPCs that must never touch the app's private dir (userData) — which holds
 * settings/grants/db, so writing there is a privilege-escalation primitive (e.g.
 * forging the nodeExecution grant file). Fails closed on a non-string candidate.
 */
export const assertPathOutside = (dir: string, candidate: string): void => {
  if (
    typeof candidate !== 'string' ||
    canonicalize(candidate) === canonicalize(dir) ||
    isPathInsideDir(dir, candidate)
  ) {
    throw pathNotAllowed('Path is inside a protected directory');
  }
};
