import { md5 } from 'hash-wasm';
import type { SyncLogger } from '@sp/sync-core';
import type { SyncCredentialStorePort } from '../../credential-store-port';
import type { FileAdapter } from '../../file-adapter';
import { errorMeta } from '../../log/error-meta';
import type { FileSyncProvider } from '../../provider.types';
import {
  FileHashCreationAPIError,
  InvalidDataSPError,
  NoRevAPIError,
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../errors';
import { PROVIDER_ID_LOCAL_FILE, type LocalFileSyncPrivateCfg } from './local-file.model';

export interface LocalFileSyncBaseDeps {
  logger: SyncLogger;
  fileAdapter: FileAdapter;
  credentialStore: SyncCredentialStorePort<
    typeof PROVIDER_ID_LOCAL_FILE,
    LocalFileSyncPrivateCfg
  >;
}

export abstract class LocalFileSyncBase implements FileSyncProvider<
  typeof PROVIDER_ID_LOCAL_FILE,
  LocalFileSyncPrivateCfg
> {
  private static readonly LB = 'LocalFileSyncBase';

  readonly id = PROVIDER_ID_LOCAL_FILE;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;

  public privateCfg: SyncCredentialStorePort<
    typeof PROVIDER_ID_LOCAL_FILE,
    LocalFileSyncPrivateCfg
  >;

  protected readonly fileAdapter: FileAdapter;
  protected readonly logger: SyncLogger;

  protected constructor(deps: LocalFileSyncBaseDeps) {
    this.fileAdapter = deps.fileAdapter;
    this.logger = deps.logger;
    this.privateCfg = deps.credentialStore;
  }

  abstract isReady(): Promise<boolean>;

  async setPrivateCfg(privateCfg: LocalFileSyncPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  protected abstract getFilePath(targetPath: string): Promise<string>;

  async listFiles(dirPath: string): Promise<string[]> {
    this.logger.normal(`${LocalFileSyncBase.LB}.${this.listFiles.name}()`);
    if (!this.fileAdapter.listFiles) {
      throw new Error('FileAdapter does not support listFiles');
    }
    const fullPath = await this.getFilePath(dirPath);
    return this.fileAdapter.listFiles(fullPath);
  }

  async getFileRev(
    targetPath: string,
    _localRev: string | null,
  ): Promise<{ rev: string }> {
    this.logger.normal(`${LocalFileSyncBase.LB}.${this.getFileRev.name}`, {
      targetPath,
    });
    try {
      const r = await this.downloadFile(targetPath);
      return { rev: r.rev };
    } catch (e) {
      this.logger.critical(
        `${LocalFileSyncBase.LB}.${this.getFileRev.name} error`,
        errorMeta(e, { targetPath }),
      );
      throw e;
    }
  }

  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    this.logger.normal(`${LocalFileSyncBase.LB}.${this.downloadFile.name}()`, {
      targetPath,
    });

    try {
      const filePath = await this.getFilePath(targetPath);
      const dataStr = await this.fileAdapter.readFile(filePath);

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
      if (this._isDownloadFileNotFoundError(e)) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      this.logger.critical(
        `${LocalFileSyncBase.LB}.${this.downloadFile.name}() error`,
        errorMeta(e, { targetPath }),
      );
      throw e;
    }
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite = false,
  ): Promise<{ rev: string }> {
    this.logger.normal(`${LocalFileSyncBase.LB}.${this.uploadFile.name}()`, {
      targetPath,
      dataLength: dataStr?.length,
      hasRevToMatch: !!revToMatch,
      isForceOverwrite,
    });

    try {
      if (!isForceOverwrite && revToMatch) {
        try {
          const existingFile = await this.downloadFile(targetPath);
          if (existingFile.rev !== revToMatch) {
            this.logger.critical(
              `${LocalFileSyncBase.LB}.${this.uploadFile.name}() rev mismatch`,
              { targetPath },
            );
            throw new UploadRevToMatchMismatchAPIError();
          }
        } catch (err) {
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
      this.logger.critical(
        `${LocalFileSyncBase.LB}.${this.uploadFile.name}() error`,
        errorMeta(e, { targetPath }),
      );
      throw e;
    }
  }

  async removeFile(targetPath: string): Promise<void> {
    this.logger.normal(`${LocalFileSyncBase.LB}.${this.removeFile.name}`, {
      targetPath,
    });
    try {
      const filePath = await this.getFilePath(targetPath);
      await this.fileAdapter.deleteFile(filePath);
    } catch (e) {
      if (this._isRemoveFileNotFoundError(e)) {
        this.logger.normal(
          `${LocalFileSyncBase.LB}.${this.removeFile.name} - file does not exist`,
          { targetPath },
        );
        return;
      }

      this.logger.critical(
        `${LocalFileSyncBase.LB}.${this.removeFile.name} error`,
        errorMeta(e, { targetPath }),
      );
      throw e;
    }
  }

  private async _getLocalRev(dataStr: string): Promise<string> {
    if (!dataStr) {
      throw new InvalidDataSPError('Empty data string when creating rev');
    }

    let hash: string;
    try {
      hash = await md5(dataStr);
    } catch (e) {
      throw new FileHashCreationAPIError(e);
    }

    if (!hash) {
      throw new NoRevAPIError();
    }
    return hash;
  }

  private _isDownloadFileNotFoundError(error: unknown): boolean {
    const message = String(error);
    return (
      message.includes('File not found') ||
      message.includes('does not exist') ||
      message.includes('ENOENT')
    );
  }

  private _isRemoveFileNotFoundError(error: unknown): boolean {
    const message = String(error);
    return message.includes('File does not exist') || message.includes('ENOENT');
  }
}
