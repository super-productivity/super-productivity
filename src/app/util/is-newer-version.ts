interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const parseVersion = (versionStr: string): ParsedVersion | null => {
  // Tolerate a leading `v` (release tags) and trailing garbage (e.g. display
  // suffixes like `18.6.0AI`) so callers can pass version-ish strings as-is.
  const match = versionStr
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
};

/**
 * Whether `candidate` is a strictly newer version than `current`.
 *
 * Used by the update check, so it must never nag on dev/RC builds that run
 * ahead of the latest published release: equal or older candidates and any
 * unparseable input return `false`.
 *
 * shortcut: prerelease identifiers are not ordered against each other (the
 * GitHub `releases/latest` endpoint never returns prereleases); a stable
 * candidate does outrank a prerelease of the same core version, so RC users
 * are notified of the final release. Full semver ordering if that changes.
 */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const c = parseVersion(candidate);
  const cur = parseVersion(current);
  if (!c || !cur) {
    return false;
  }
  if (c.major !== cur.major) {
    return c.major > cur.major;
  }
  if (c.minor !== cur.minor) {
    return c.minor > cur.minor;
  }
  if (c.patch !== cur.patch) {
    return c.patch > cur.patch;
  }
  return c.prerelease === null && cur.prerelease !== null;
};
