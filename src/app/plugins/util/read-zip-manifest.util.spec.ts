import { strToU8, zipSync } from 'fflate';
import { readZipManifest } from './read-zip-manifest.util';

describe('readZipManifest', () => {
  it('reads manifest.json from a plugin ZIP', async () => {
    const zip = zipSync({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'manifest.json': strToU8(JSON.stringify({ id: 'x' })),
    });
    expect(await readZipManifest(new Blob([zip]))).toEqual(
      jasmine.objectContaining({ id: 'x' }),
    );
  });

  it('resolves null for a file that is not a ZIP', async () => {
    expect(await readZipManifest(new Blob(['not a zip']))).toBeNull();
  });

  it('resolves null when the file cannot be read', async () => {
    const unreadable = {
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    } as unknown as Blob;
    expect(await readZipManifest(unreadable)).toBeNull();
  });
});
