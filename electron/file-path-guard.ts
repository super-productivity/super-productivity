import * as path from 'path';

/**
 * Returns true if `targetPath` resolves to a location strictly inside `dir`.
 *
 * Security boundary: several IPC handlers receive file paths from the renderer,
 * which executes untrusted plugin code (plugin scripts run via `new Function`
 * in `src/app/plugins/plugin-runner.ts`). Without constraining the path, a
 * plugin could read/write arbitrary files via the exposed `window.ea` bridge.
 * See GHSA-x937-wf3j-88q3.
 *
 * `path.relative` is used instead of a `startsWith` string compare so that
 * `..` traversal is collapsed and a sibling directory sharing a name prefix
 * (e.g. `backups` vs `backups-evil`) is not mistaken for a child.
 *
 * Containment is purely lexical (no `fs.realpath`): a symlink planted *inside*
 * `dir` pointing outside would pass. That requires pre-existing local
 * filesystem write access, which is outside the threat model here (untrusted
 * renderer/plugin-supplied path strings), so symlink resolution is omitted.
 */
export const isPathInsideDir = (dir: string, targetPath: string): boolean => {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return false;
  }
  const rel = path.relative(path.resolve(dir), path.resolve(targetPath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
