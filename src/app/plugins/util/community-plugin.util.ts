import { MAX_PLUGIN_ZIP_SIZE } from '../plugin.const';

/**
 * A pinned, installable release of a listed community plugin. The hash pins the
 * exact ZIP that was listed when the entry was added or bumped, so a swapped or
 * re-uploaded release asset fails verification instead of installing. Pinning is
 * not a review: listed plugins are unreviewed third-party code.
 */
export interface CommunityPluginRelease {
  version: string;
  downloadUrl: string;
  /** Lowercase hex SHA-256 of the ZIP at `downloadUrl`. */
  sha256: string;
}

/** An entry of `src/assets/community-plugins.json`; checked by tools/verify-community-plugins.js. */
export interface CommunityPlugin {
  name: string;
  shortDescription: string;
  url: string;
  author: string;
  authorUrl?: string;
  /** The plugin's manifest id; links the entry to an installed plugin. */
  id?: string;
  /** Requires `id`. Without it the entry is a link to the plugin's page only. */
  release?: CommunityPluginRelease;
}

export type CommunityPluginStatus = 'notInstalled' | 'installed' | 'updateAvailable';

// Listed versions are strictly numeric (tools/verify-community-plugins.js); the
// leniency here is for the installed side, whose manifest version is the author's.
const parseVersion = (version: string): number[] | null => {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0];
  return /^\d+(\.\d+)*$/.test(core) ? core.split('.').map(Number) : null;
};

/**
 * Compares dotted numeric versions ("1.10.0" > "1.9.2"), ignoring a leading "v" and
 * any pre-release/build suffix. Returns null when either side is not numeric, so a
 * caller never claims an update it cannot prove.
 */
export const compareVersions = (a: string, b: string): number | null => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return null;
  }
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return 0;
};

/** `installedVersion` is the version of the uploaded plugin with the entry's id, if any. */
export const getCommunityPluginStatus = (
  plugin: CommunityPlugin,
  installedVersion: string | undefined,
): CommunityPluginStatus => {
  if (installedVersion === undefined) {
    return 'notInstalled';
  }
  return plugin.release && compareVersions(plugin.release.version, installedVersion) === 1
    ? 'updateAvailable'
    : 'installed';
};

export type CommunityPluginDownloadFailure =
  | 'download'
  | 'tooLarge'
  | 'hashMismatch'
  | 'manifestMismatch';

export class CommunityPluginDownloadError extends Error {
  override name = 'CommunityPluginDownloadError';

  constructor(
    readonly reason: CommunityPluginDownloadFailure,
    message: string,
  ) {
    super(message);
  }
}

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Whether the ZIP's manifest.json has the listed id and version. Checked before
 * install: `loadPluginFromZip` installs under the manifest's id, so a mismatch would
 * replace a different installed plugin. CI checks the same with `unzip`.
 */
const isListedManifest = async (
  bytes: ArrayBuffer,
  id: string,
  version: string,
): Promise<boolean> => {
  const { unzipSync } = await import('fflate');
  try {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (file) => file.name === 'manifest.json',
    });
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    return manifest?.id === id && manifest?.version === version;
  } catch {
    return false;
  }
};

/**
 * Downloads a listed release and returns it as a ZIP `File` for
 * `PluginService.loadPluginFromZip`, but only if its SHA-256 matches the pinned hash
 * and its manifest has the listed id and version. Redirects are followed (release
 * hosts redirect to their CDNs): the hash, not the URL, makes the bytes trustworthy.
 */
export const downloadVerifiedCommunityPlugin = async (
  id: string,
  release: CommunityPluginRelease,
  fetchFn: typeof fetch = fetch,
): Promise<File> => {
  let response: Response;
  try {
    response = await fetchFn(release.downloadUrl, { credentials: 'omit' });
  } catch (e) {
    // Typically CORS on web, or offline.
    throw new CommunityPluginDownloadError('download', `Download failed: ${e}`);
  }
  if (!response.ok) {
    throw new CommunityPluginDownloadError(
      'download',
      `Download failed: HTTP ${response.status}`,
    );
  }
  if (Number(response.headers.get('content-length')) > MAX_PLUGIN_ZIP_SIZE) {
    throw new CommunityPluginDownloadError('tooLarge', 'Download exceeds the size limit');
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (e) {
    throw new CommunityPluginDownloadError('download', `Download failed: ${e}`);
  }
  if (bytes.byteLength > MAX_PLUGIN_ZIP_SIZE) {
    throw new CommunityPluginDownloadError('tooLarge', 'Download exceeds the size limit');
  }
  const actual = toHex(await crypto.subtle.digest('SHA-256', bytes));
  if (actual !== release.sha256.toLowerCase()) {
    throw new CommunityPluginDownloadError(
      'hashMismatch',
      'Downloaded file does not match the listed checksum',
    );
  }
  if (!(await isListedManifest(bytes, id, release.version))) {
    throw new CommunityPluginDownloadError(
      'manifestMismatch',
      'Downloaded manifest does not have the listed id and version',
    );
  }
  return new File([bytes], 'plugin.zip', { type: 'application/zip' });
};
