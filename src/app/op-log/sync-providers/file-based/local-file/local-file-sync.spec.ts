import { LocalFileSyncBase } from './local-file-sync-base';
import { FileAdapter } from './file-adapter.interface';
import { SyncProviderId } from '../../provider.const';
import {
  InvalidDataSPError,
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../core/errors/sync-errors';
import { PrivateCfgByProviderId } from '../../../core/types/sync.types';

/**
 * Test implementation of LocalFileSyncBase for unit testing
 */
class TestableLocalFileSync extends LocalFileSyncBase {
  private _isReady = true;
  private _basePath = '/test/sync';

  constructor(fileAdapter: FileAdapter) {
    super(fileAdapter);
  }

  async isReady(): Promise<boolean> {
    return this._isReady;
  }

  setReadyState(isReady: boolean): void {
    this._isReady = isReady;
  }

  async setPrivateCfg(
    privateCfg: PrivateCfgByProviderId<SyncProviderId.LocalFile>,
  ): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  protected async getFilePath(targetPath: string): Promise<string> {
    // Simple path normalization for testing
    const normalizedTarget = targetPath.startsWith('/')
      ? targetPath.slice(1)
      : targetPath;
    return `${this._basePath}/${normalizedTarget}`;
  }

  setBasePath(path: string): void {
    this._basePath = path;
  }
}

/**
 * Mock FileAdapter that stores files in memory
 */
class MockFileAdapter implements FileAdapter {
  private _files = new Map<string, string>();
  private _shouldFail = false;
  private _failError: Error | null = null;

  async readFile(path: string): Promise<string> {
    if (this._shouldFail && this._failError) {
      throw this._failError;
    }
    const content = this._files.get(path);
    if (content === undefined) {
      throw new Error('ENOENT: no such file or directory');
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this._shouldFail && this._failError) {
      throw this._failError;
    }
    this._files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    if (this._shouldFail && this._failError) {
      throw this._failError;
    }
    if (!this._files.has(path)) {
      throw new Error('ENOENT: File does not exist');
    }
    this._files.delete(path);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    for (const path of this._files.keys()) {
      if (path.startsWith(dirPath)) {
        files.push(path);
      }
    }
    return files;
  }

  // Test helpers
  setFile(path: string, content: string): void {
    this._files.set(path, content);
  }

  getFile(path: string): string | undefined {
    return this._files.get(path);
  }

  hasFile(path: string): boolean {
    return this._files.has(path);
  }

  clear(): void {
    this._files.clear();
  }

  setFailure(error: Error | null): void {
    this._shouldFail = error !== null;
    this._failError = error;
  }
}

describe('LocalFileSyncBase', () => {
  let fileAdapter: MockFileAdapter;
  let localFileSync: TestableLocalFileSync;

  beforeEach(() => {
    fileAdapter = new MockFileAdapter();
    localFileSync = new TestableLocalFileSync(fileAdapter);
  });

  describe('Basic Operations', () => {
    it('should download file and return content with MD5 hash rev', async () => {
      const testContent = 'test file content for sync';
      fileAdapter.setFile('/test/sync/sync-data.json', testContent);

      const result = await localFileSync.downloadFile('sync-data.json');

      expect(result.dataStr).toBe(testContent);
      expect(result.rev).toBeTruthy();
      // MD5 hash should be 32 chars hex
      expect(result.rev.length).toBe(32);
      expect(/^[a-f0-9]+$/.test(result.rev)).toBe(true);
    });

    it('should upload file and return MD5 hash rev', async () => {
      const testContent = 'new file content to upload';

      const result = await localFileSync.uploadFile('sync-data.json', testContent, null);

      expect(result.rev).toBeTruthy();
      expect(result.rev.length).toBe(32);

      // Verify file was written
      expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe(testContent);
    });

    it('should return consistent rev for same content', async () => {
      const testContent = 'consistent content for rev';
      fileAdapter.setFile('/test/sync/file1.json', testContent);
      fileAdapter.setFile('/test/sync/file2.json', testContent);

      const result1 = await localFileSync.downloadFile('file1.json');
      const result2 = await localFileSync.downloadFile('file2.json');

      // Same content = same MD5 hash
      expect(result1.rev).toBe(result2.rev);
    });

    it('should remove file successfully', async () => {
      fileAdapter.setFile('/test/sync/to-delete.json', 'content');

      await localFileSync.removeFile('to-delete.json');

      expect(fileAdapter.hasFile('/test/sync/to-delete.json')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw RemoteFileNotFoundAPIError for missing file', async () => {
      await expectAsync(
        localFileSync.downloadFile('nonexistent.json'),
      ).toBeRejectedWithError(RemoteFileNotFoundAPIError);
    });

    it('should throw RemoteFileNotFoundAPIError for empty file', async () => {
      fileAdapter.setFile('/test/sync/empty.json', '');

      await expectAsync(localFileSync.downloadFile('empty.json')).toBeRejectedWithError(
        RemoteFileNotFoundAPIError,
      );
    });

    it('should throw InvalidDataSPError for file content too short', async () => {
      fileAdapter.setFile('/test/sync/short.json', 'ab'); // 2 chars < 3

      await expectAsync(localFileSync.downloadFile('short.json')).toBeRejectedWithError(
        InvalidDataSPError,
      );
    });

    it('should ignore ENOENT errors when removing nonexistent file', async () => {
      // Should not throw
      await expectAsync(localFileSync.removeFile('nonexistent.json')).toBeResolved();
    });
  });

  describe('Revision Matching', () => {
    it('should succeed when revToMatch matches current file', async () => {
      const initialContent = 'initial content';
      fileAdapter.setFile('/test/sync/sync-data.json', initialContent);

      // Get the rev of the current file
      const current = await localFileSync.downloadFile('sync-data.json');

      // Upload with matching rev
      const newContent = 'updated content';
      const result = await localFileSync.uploadFile(
        'sync-data.json',
        newContent,
        current.rev,
      );

      expect(result.rev).toBeTruthy();
      expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe(newContent);
    });

    it('should throw UploadRevToMatchMismatchAPIError when rev does not match', async () => {
      const initialContent = 'initial content';
      fileAdapter.setFile('/test/sync/sync-data.json', initialContent);

      const newContent = 'updated content';

      await expectAsync(
        localFileSync.uploadFile('sync-data.json', newContent, 'wrong-rev'),
      ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);

      // File should not be modified
      expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe(initialContent);
    });

    it('should allow upload without revToMatch (null)', async () => {
      const newContent = 'content without rev check';

      const result = await localFileSync.uploadFile('new-file.json', newContent, null);

      expect(result.rev).toBeTruthy();
      expect(fileAdapter.getFile('/test/sync/new-file.json')).toBe(newContent);
    });

    it('should allow upload with force overwrite regardless of rev', async () => {
      const initialContent = 'initial content';
      fileAdapter.setFile('/test/sync/sync-data.json', initialContent);

      const newContent = 'force overwritten content';

      // Force overwrite with wrong rev should succeed
      const result = await localFileSync.uploadFile(
        'sync-data.json',
        newContent,
        'wrong-rev',
        true, // isForceOverwrite
      );

      expect(result.rev).toBeTruthy();
      expect(fileAdapter.getFile('/test/sync/sync-data.json')).toBe(newContent);
    });

    it('should handle file not existing when revToMatch is provided', async () => {
      // File doesn't exist, but revToMatch is provided
      // This is fine for upload (creates new file)
      const newContent = 'new file with rev';

      const result = await localFileSync.uploadFile(
        'nonexistent.json',
        newContent,
        'some-rev',
      );

      expect(result.rev).toBeTruthy();
      expect(fileAdapter.getFile('/test/sync/nonexistent.json')).toBe(newContent);
    });
  });

  describe('Path Normalization', () => {
    it('should handle paths with leading slash', async () => {
      const content = 'test content';
      fileAdapter.setFile('/test/sync/file.json', content);

      // With leading slash
      const result = await localFileSync.downloadFile('/file.json');
      expect(result.dataStr).toBe(content);
    });

    it('should handle paths without leading slash', async () => {
      const content = 'test content';
      fileAdapter.setFile('/test/sync/file.json', content);

      // Without leading slash
      const result = await localFileSync.downloadFile('file.json');
      expect(result.dataStr).toBe(content);
    });

    it('should handle nested paths', async () => {
      const content = 'nested content';
      fileAdapter.setFile('/test/sync/subdir/file.json', content);

      const result = await localFileSync.downloadFile('subdir/file.json');
      expect(result.dataStr).toBe(content);
    });
  });

  describe('isReady', () => {
    it('should return true when ready', async () => {
      localFileSync.setReadyState(true);
      expect(await localFileSync.isReady()).toBe(true);
    });

    it('should return false when not ready', async () => {
      localFileSync.setReadyState(false);
      expect(await localFileSync.isReady()).toBe(false);
    });
  });

  describe('getFileRev', () => {
    it('should return rev from file content', async () => {
      const content = 'content for rev check';
      fileAdapter.setFile('/test/sync/file.json', content);

      const { rev } = await localFileSync.getFileRev('file.json', 'any-local-rev');

      // Should match the rev from downloading
      const downloaded = await localFileSync.downloadFile('file.json');
      expect(rev).toBe(downloaded.rev);
    });

    it('should throw RemoteFileNotFoundAPIError for missing file', async () => {
      await expectAsync(
        localFileSync.getFileRev('missing.json', 'any-rev'),
      ).toBeRejectedWithError(RemoteFileNotFoundAPIError);
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      fileAdapter.setFile('/test/sync/file1.json', 'content1');
      fileAdapter.setFile('/test/sync/file2.json', 'content2');
      fileAdapter.setFile('/test/sync/subdir/file3.json', 'content3');

      const files = await localFileSync.listFiles('/');

      expect(files.length).toBe(3);
      expect(files).toContain('/test/sync/file1.json');
      expect(files).toContain('/test/sync/file2.json');
    });
  });
});
