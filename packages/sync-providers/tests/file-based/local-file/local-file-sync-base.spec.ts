import { afterEach, describe, expect, it, vi } from 'vitest';
import { md5 } from 'hash-wasm';
import { NOOP_SYNC_LOGGER } from '@sp/sync-core';
import {
  InvalidDataSPError,
  NoRevAPIError,
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../src/errors';
import {
  LocalFileSyncBase,
  type LocalFileSyncBaseDeps,
  type LocalFileSyncPrivateCfg,
  PROVIDER_ID_LOCAL_FILE,
} from '../../../src/local-file';
import type { FileAdapter } from '../../../src/file-based';
import type { SyncCredentialStorePort } from '../../../src/credential-store';
import { createStatefulCredentialStore } from '../../helpers/credential-store';

vi.mock('hash-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hash-wasm')>();
  return {
    ...actual,
    md5: vi.fn(actual.md5),
  };
});

class TestableLocalFileSync extends LocalFileSyncBase {
  private _isReady = true;
  private _basePath = '/test/sync';

  constructor(fileAdapter: FileAdapter) {
    super({
      logger: NOOP_SYNC_LOGGER,
      fileAdapter,
      credentialStore: fakeStore(null),
    });
  }

  async isReady(): Promise<boolean> {
    return this._isReady;
  }

  setReadyState(isReady: boolean): void {
    this._isReady = isReady;
  }

  protected async getFilePath(targetPath: string): Promise<string> {
    const normalizedTarget = targetPath.startsWith('/')
      ? targetPath.slice(1)
      : targetPath;
    return `${this._basePath}/${normalizedTarget}`;
  }
}

class MockFileAdapter implements FileAdapter {
  private _files = new Map<string, string>();
  private _failError: Error | null = null;

  async readFile(path: string): Promise<string> {
    if (this._failError) {
      throw this._failError;
    }
    const content = this._files.get(path);
    if (content === undefined) {
      throw new Error('ENOENT: no such file or directory');
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this._failError) {
      throw this._failError;
    }
    this._files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    if (this._failError) {
      throw this._failError;
    }
    if (!this._files.has(path)) {
      throw new Error('ENOENT: File does not exist');
    }
    this._files.delete(path);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    return [...this._files.keys()].filter((path) => path.startsWith(dirPath));
  }

  setFile(path: string, content: string): void {
    this._files.set(path, content);
  }

  getFile(path: string): string | undefined {
    return this._files.get(path);
  }

  hasFile(path: string): boolean {
    return this._files.has(path);
  }

  setFailure(error: Error | null): void {
    this._failError = error;
  }
}

const fakeStore = (
  initial: LocalFileSyncPrivateCfg | null,
): SyncCredentialStorePort<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg> =>
  createStatefulCredentialStore<typeof PROVIDER_ID_LOCAL_FILE, LocalFileSyncPrivateCfg>(
    initial,
    { spy: false },
  );

describe('LocalFileSyncBase', () => {
  afterEach(() => {
    vi.mocked(md5).mockClear();
  });

  it('downloads file content and returns hash-wasm md5 rev', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    const testContent = 'test file content for sync';
    fileAdapter.setFile('/test/sync/sync-data.json', testContent);

    const result = await provider.downloadFile('sync-data.json');

    expect(result.dataStr).toBe(testContent);
    expect(result.rev).toBe(await md5(testContent));
  });

  it('uploads file and returns a stable md5 rev', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    const testContent = 'new file content to upload';

    const result = await provider.uploadFile('sync-data.json', testContent, null);

    expect(result.rev).toBe(await md5(testContent));
    expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe(testContent);
  });

  it('throws RemoteFileNotFoundAPIError for missing or empty files', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    fileAdapter.setFile('/test/sync/empty.json', '');

    await expect(provider.downloadFile('nonexistent.json')).rejects.toBeInstanceOf(
      RemoteFileNotFoundAPIError,
    );
    await expect(provider.downloadFile('empty.json')).rejects.toBeInstanceOf(
      RemoteFileNotFoundAPIError,
    );
  });

  it('throws InvalidDataSPError for file content that is too short', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    fileAdapter.setFile('/test/sync/short.json', 'ab');

    await expect(provider.downloadFile('short.json')).rejects.toBeInstanceOf(
      InvalidDataSPError,
    );
  });

  it('enforces revToMatch unless force overwrite is requested', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    fileAdapter.setFile('/test/sync/sync-data.json', 'initial content');

    await expect(
      provider.uploadFile('sync-data.json', 'updated content', 'wrong-rev'),
    ).rejects.toBeInstanceOf(UploadRevToMatchMismatchAPIError);

    expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe('initial content');

    await expect(
      provider.uploadFile('sync-data.json', 'force content', 'wrong-rev', true),
    ).resolves.toEqual({ rev: await md5('force content') });
    expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe('force content');
  });

  it('preserves NoRevAPIError identity if hashing returns an empty rev', async () => {
    vi.mocked(md5).mockResolvedValueOnce('');
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);

    await expect(
      provider.uploadFile('sync-data.json', 'content', null),
    ).rejects.toBeInstanceOf(NoRevAPIError);
  });

  it('ignores missing-file errors when removing', async () => {
    const provider = new TestableLocalFileSync(new MockFileAdapter());

    await expect(provider.removeFile('nonexistent.json')).resolves.toBeUndefined();
  });

  it('lists files through the injected file adapter', async () => {
    const fileAdapter = new MockFileAdapter();
    const provider = new TestableLocalFileSync(fileAdapter);
    fileAdapter.setFile('/test/sync/file1.json', 'content1');
    fileAdapter.setFile('/test/sync/file2.json', 'content2');
    fileAdapter.setFile('/test/sync/subdir/file3.json', 'content3');

    const files = await provider.listFiles('/');

    expect(files).toContain('/test/sync/file1.json');
    expect(files).toContain('/test/sync/file2.json');
    expect(files).toContain('/test/sync/subdir/file3.json');
  });

  it('accepts dependency shape used by shims', () => {
    const deps: LocalFileSyncBaseDeps = {
      logger: NOOP_SYNC_LOGGER,
      fileAdapter: new MockFileAdapter(),
      credentialStore: fakeStore(null),
    };
    expect(deps.credentialStore).toBeTruthy();
  });
});
