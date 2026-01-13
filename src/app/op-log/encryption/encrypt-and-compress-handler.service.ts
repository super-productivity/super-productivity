import {
  extractSyncFileStateFromPrefix,
  getSyncFilePrefix,
} from '../util/sync-file-prefix';
import { PFLog } from '../../core/log';
import { decrypt, encrypt } from './encryption';
import {
  DecryptError,
  DecryptNoPasswordError,
  JsonParseError,
} from '../core/errors/sync-errors';
import {
  compressWithGzipToString,
  decompressGzipFromString,
} from './compression-handler';
import { EncryptAndCompressCfg } from '../core/types/sync.types';

export class EncryptAndCompressHandlerService {
  private static readonly L = 'EncryptAndCompressHandlerService';

  async compressAndEncryptData<T>(
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    data: T,
    modelVersion: number,
  ): Promise<string> {
    const { isCompress, isEncrypt } = cfg;
    return this.compressAndEncrypt({
      data,
      modelVersion,
      isCompress,
      isEncrypt,
      encryptKey,
    });
  }

  async decompressAndDecryptData<T>(
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    dataStr: string,
  ): Promise<T> {
    return (
      await this.decompressAndDecrypt<T>({
        dataStr,
        encryptKey,
      })
    ).data;
  }

  async compressAndEncrypt<T>({
    data,
    modelVersion,
    isCompress,
    isEncrypt,
    encryptKey,
  }: {
    data: T;
    modelVersion: number;
    isCompress: boolean;
    isEncrypt: boolean;
    encryptKey?: string;
  }): Promise<string> {
    const prefix = getSyncFilePrefix({
      isCompress,
      isEncrypt,
      modelVersion,
    });
    PFLog.normal(
      `${EncryptAndCompressHandlerService.L}.${this.compressAndEncrypt.name}()`,
      {
        prefix,
        modelVersion,
        isCompress,
        isEncrypt,
      },
    );
    let dataStr = JSON.stringify(data);
    if (isCompress) {
      dataStr = await compressWithGzipToString(dataStr);
    }
    if (isEncrypt) {
      if (!encryptKey) {
        throw new Error('No encryption password provided');
      }

      dataStr = await encrypt(dataStr, encryptKey);
    }

    return prefix + dataStr;
  }

  async decompressAndDecrypt<T>({
    dataStr,
    encryptKey,
  }: {
    dataStr: string;
    encryptKey?: string;
  }): Promise<{
    data: T;
    modelVersion: number;
  }> {
    const { isCompressed, isEncrypted, modelVersion, cleanDataStr } =
      extractSyncFileStateFromPrefix(dataStr);
    PFLog.normal(
      `${EncryptAndCompressHandlerService.L}.${this.decompressAndDecrypt.name}()`,
      { isCompressed, isEncrypted, modelVersion },
    );
    let outStr = cleanDataStr;

    if (isEncrypted) {
      if (!encryptKey) {
        throw new DecryptNoPasswordError({
          dataStr,
          isCompressed,
          isEncrypted,
          modelVersion,
        });
      }
      try {
        outStr = await decrypt(outStr, encryptKey);
      } catch (e) {
        throw new DecryptError(e);
      }
    }

    if (isCompressed) {
      outStr = await decompressGzipFromString(outStr);
    }

    let parsedData: T;
    try {
      parsedData = JSON.parse(outStr);
    } catch (e) {
      throw new JsonParseError(e, outStr);
    }

    return {
      data: parsedData,
      modelVersion,
    };
  }
}
