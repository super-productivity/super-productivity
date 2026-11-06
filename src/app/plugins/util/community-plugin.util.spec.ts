import {
  CommunityPlugin,
  CommunityPluginDownloadError,
  CommunityPluginRelease,
  compareVersions,
  downloadVerifiedCommunityPlugin,
  getCommunityPluginStatus,
} from './community-plugin.util';
import { MAX_PLUGIN_ZIP_SIZE } from '../plugin.const';
import { strToU8, zipSync } from 'fflate';

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('1.9.2', '1.10.0')).toBe(-1);
  });

  it('treats missing parts as zero and ignores a "v" prefix and suffixes', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v2.0.0', '2.0.0-beta.1')).toBe(0);
  });

  it('returns null for non-numeric versions', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
  });
});

describe('getCommunityPluginStatus', () => {
  const plugin: CommunityPlugin = {
    name: 'X',
    shortDescription: '',
    url: 'https://example.com',
    author: 'a',
    id: 'x',
    release: { version: '1.2.0', downloadUrl: 'https://example.com/x.zip', sha256: '' },
  };

  it('is notInstalled without an installed version', () => {
    expect(getCommunityPluginStatus(plugin, undefined)).toBe('notInstalled');
  });

  it('offers an update only when the listed release is newer', () => {
    expect(getCommunityPluginStatus(plugin, '1.1.9')).toBe('updateAvailable');
    expect(getCommunityPluginStatus(plugin, '1.2.0')).toBe('installed');
    expect(getCommunityPluginStatus(plugin, '1.3.0')).toBe('installed');
  });

  it('never claims an update it cannot compare or has no release for', () => {
    expect(getCommunityPluginStatus(plugin, 'dev')).toBe('installed');
    expect(getCommunityPluginStatus({ ...plugin, release: undefined }, '0.1.0')).toBe(
      'installed',
    );
  });
});

describe('downloadVerifiedCommunityPlugin', () => {
  const zip = (manifest: object): Uint8Array<ArrayBuffer> =>
    // eslint-disable-next-line @typescript-eslint/naming-convention
    new Uint8Array(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }));
  const bytes = zip({ id: 'x', version: '1.0.0' });
  let release: CommunityPluginRelease;

  const respondWith =
    (body: BodyInit | null, init?: ResponseInit): typeof fetch =>
    () =>
      Promise.resolve(new Response(body, init));

  const expectFailure = async (
    promise: Promise<unknown>,
    reason: CommunityPluginDownloadError['reason'],
  ): Promise<void> => {
    try {
      await promise;
      fail('expected a CommunityPluginDownloadError');
    } catch (e) {
      expect(e).toEqual(jasmine.any(CommunityPluginDownloadError));
      expect((e as CommunityPluginDownloadError).reason).toBe(reason);
    }
  };

  beforeEach(async () => {
    release = {
      version: '1.0.0',
      downloadUrl: 'https://example.com/x.zip',
      sha256: await sha256Hex(bytes),
    };
  });

  it('returns the ZIP when the hash matches, comparing case-insensitively', async () => {
    const file = await downloadVerifiedCommunityPlugin(
      'x',
      { ...release, sha256: release.sha256.toUpperCase() },
      respondWith(bytes),
    );

    expect(file.name).toBe('plugin.zip');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('downloads without credentials', async () => {
    const fetchSpy = jasmine
      .createSpy('fetch')
      .and.callFake(() => Promise.resolve(new Response(bytes)));

    await downloadVerifiedCommunityPlugin('x', release, fetchSpy);

    expect(fetchSpy).toHaveBeenCalledWith(release.downloadUrl, { credentials: 'omit' });
  });

  it('rejects a file whose hash does not match', async () => {
    await expectFailure(
      downloadVerifiedCommunityPlugin(
        'x',
        release,
        respondWith(new TextEncoder().encode('swapped')),
      ),
      'hashMismatch',
    );
  });

  it('rejects a network error, e.g. a CORS block', async () => {
    await expectFailure(
      downloadVerifiedCommunityPlugin('x', release, () =>
        Promise.reject(new TypeError('Failed to fetch')),
      ),
      'download',
    );
  });

  it('classifies a download interrupted after headers as a download error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.error(new TypeError('Connection reset during download'));
      },
    });

    await expectFailure(
      downloadVerifiedCommunityPlugin('x', release, respondWith(body)),
      'download',
    );
  });

  it('rejects an HTTP error', async () => {
    await expectFailure(
      downloadVerifiedCommunityPlugin('x', release, respondWith(null, { status: 404 })),
      'download',
    );
  });

  it('rejects a ZIP whose manifest is not the listed plugin or version', async () => {
    for (const manifest of [
      { id: 'other', version: '1.0.0' },
      { id: 'x', version: '0.9.0' },
    ]) {
      const other = zip(manifest);
      await expectFailure(
        downloadVerifiedCommunityPlugin(
          'x',
          { ...release, sha256: await sha256Hex(other) },
          respondWith(other),
        ),
        'manifestMismatch',
      );
    }
  });

  it('rejects a matching-hash file that is not a ZIP with a manifest', async () => {
    const notZip = new TextEncoder().encode('not a zip');
    await expectFailure(
      downloadVerifiedCommunityPlugin(
        'x',
        { ...release, sha256: await sha256Hex(notZip) },
        respondWith(notZip),
      ),
      'manifestMismatch',
    );
  });

  it('rejects a too-large content-length', async () => {
    await expectFailure(
      downloadVerifiedCommunityPlugin(
        'x',
        release,
        respondWith(bytes, {
          headers: new Headers([['content-length', String(MAX_PLUGIN_ZIP_SIZE + 1)]]),
        }),
      ),
      'tooLarge',
    );
  });

  it('rejects an oversized body without a content-length', async () => {
    await expectFailure(
      downloadVerifiedCommunityPlugin(
        'x',
        release,
        respondWith(new Uint8Array(MAX_PLUGIN_ZIP_SIZE + 1)),
      ),
      'tooLarge',
    );
  });
});
