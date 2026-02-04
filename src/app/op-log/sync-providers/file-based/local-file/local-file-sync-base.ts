import { SyncProviderServiceInterface } from '../../provider.interface';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { FileAdapter } from './file-adapter.interface';
import {
  FileHashCreationAPIError,
  InvalidDataSPError,
  NoRevAPIError,
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
  WebCryptoNotAvailableError,
} from '../../../core/errors/sync-errors';
import { md5HashPromise } from '../../../../util/md5-hash';
import { SyncLog } from '../../../../core/log';
import { PrivateCfgByProviderId } from '../../../core/types/sync.types';

export abstract class LocalFileSyncBase implements SyncProviderServiceInterface<SyncProviderId.LocalFile> {
  private static readonly LB = 'LocalFileSyncBase';

  readonly id = SyncProviderId.LocalFile;
  readonly isUploadForcePossible: boolean = false;
  readonly maxConcurrentRequests = 10;

  public privateCfg: SyncCredentialStore<SyncProviderId.LocalFile>;

  protected constructor(protected fileAdapter: FileAdapter) {
    this.privateCfg = new SyncCredentialStore(SyncProviderId.LocalFile);
  }

  abstract isReady(): Promise<boolean>;

  abstract setPrivateCfg(
    privateCfg: PrivateCfgByProviderId<SyncProviderId.LocalFile>,
  ): Promise<void>;

  protected abstract getFilePath(targetPath: string): Promise<string>;

  async listFiles(dirPath: string): Promise<string[]> {
    SyncLog.normal(`${LocalFileSyncBase.LB}.${this.listFiles.name}()`, { dirPath });
    if (!this.fileAdapter.listFiles) {
      throw new Error('FileAdapter does not support listFiles');
    }
    // Assume getFilePath can correctly interpret dirPath as a directory
    const fullPath = await this.getFilePath(dirPath);
    return this.fileAdapter.listFiles(fullPath);
  }

  async getFileRev(targetPath: string, localRev: string): Promise<{ rev: string }> {
    SyncLog.normal(`${LocalFileSyncBase.LB}.${this.getFileRev.name}`, {
      targetPath,
      localRev,
    });
    try {
      const r = await this.downloadFile(targetPath);
      return { rev: r.rev };
    } catch (e) {
      SyncLog.critical(`${LocalFileSyncBase.LB}.${this.getFileRev.name} error`, e);
      throw e;
    }
  }

  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    SyncLog.normal(`${LocalFileSyncBase.LB}.${this.downloadFile.name}()`, {
      targetPath,
    });

    try {
      const filePath = await this.getFilePath(targetPath);
      const dataStr = await this.fileAdapter.readFile(filePath);

      // Validate content
      if (!dataStr || dataStr === '') {
        throw new RemoteFileNotFoundAPIError({ targetPath });
      }
      if (dataStr.length <= 3) {
        throw new InvalidDataSPError(`File content too short: ${dataStr.length} chars`);
      }
      return {
        rev: await this._getLocalRev(dataStr),
        dataStr,
      };
    } catch (e) {
      // TODO move to file adapters
      // Handle common file not found errors
      if (
        e?.toString?.().includes('File not found') ||
        e?.toString?.().includes('does not exist') ||
        e?.toString?.().includes('ENOENT')
      ) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      SyncLog.critical(`${LocalFileSyncBase.LB}.${this.downloadFile.name}() error`, e);
      throw e;
    }
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite: boolean = false,
  ): Promise<{ rev: string }> {
    SyncLog.normal(`${LocalFileSyncBase.LB}.${this.uploadFile.name}()`, {
      targetPath,
      dataLength: dataStr?.length,
      revToMatch,
      isForceOverwrite,
    });

    try {
      // Check if file exists and compare revs if not force overwrite
      if (!isForceOverwrite && revToMatch) {
        try {
          const existingFile = await this.downloadFile(targetPath);
          if (existingFile.rev !== revToMatch) {
            SyncLog.critical(
              `${LocalFileSyncBase.LB}.${this.uploadFile.name}() rev mismatch`,
              existingFile.rev,
              revToMatch,
            );
            throw new UploadRevToMatchMismatchAPIError();
          }
        } catch (err) {
          // File doesn't exist yet, that's fine for upload
          if (!(err instanceof RemoteFileNotFoundAPIError)) {
            throw err;
          }
        }
      }

      const filePath = await this.getFilePath(targetPath);
      await this.fileAdapter.writeFile(filePath, dataStr);

      const newRev = await this._getLocalRev(dataStr);
      return { rev: newRev };
    } catch (e) {
      SyncLog.critical(`${LocalFileSyncBase.LB}.${this.uploadFile.name}() error`, e);
      throw e;
    }
  }

  async removeFile(targetPath: string): Promise<void> {
    SyncLog.normal(`${LocalFileSyncBase.LB}.${this.removeFile.name}`, { targetPath });
    try {
      const filePath = await this.getFilePath(targetPath);
      await this.fileAdapter.deleteFile(filePath);
    } catch (e) {
      // Ignore file not found errors when removing
      if (
        // TODO move to file adapters
        e?.toString?.().includes('File does not exist') ||
        e?.toString?.().includes('ENOENT')
      ) {
        SyncLog.normal(
          `${LocalFileSyncBase.LB}.${this.removeFile.name} - file doesn't exist`,
          {
            targetPath,
          },
        );
        return;
      }

      SyncLog.critical(`${LocalFileSyncBase.LB}.${this.removeFile.name} error`, e);
      throw e;
    }
  }

  private async _getLocalRev(dataStr: string): Promise<string> {
    if (!dataStr) {
      throw new InvalidDataSPError('Empty data string when creating rev');
    }

    try {
      const hash = await md5HashPromise(dataStr);
      if (!hash) {
        throw new NoRevAPIError();
      }
      return hash;
    } catch (e) {
      if (e instanceof WebCryptoNotAvailableError) {
        throw e;
      }
      throw new FileHashCreationAPIError(e);
    }
  }
}
