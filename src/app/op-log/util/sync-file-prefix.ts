import { REMOTE_FILE_CONTENT_PREFIX } from '../sync-providers/provider.const';
import { InvalidFilePrefixError } from '../core/errors/sync-errors';

const PREFIX = REMOTE_FILE_CONTENT_PREFIX;
const END_SEPERATOR = '__';

export interface SyncFilePrefixParams {
  isCompress: boolean;
  isEncrypt: boolean;
  modelVersion: number;
}
export interface SyncFilePrefixParamsOutput {
  isCompressed: boolean;
  isEncrypted: boolean;
  modelVersion: number;
  cleanDataStr: string;
}

export const getSyncFilePrefix = (cfg: SyncFilePrefixParams): string => {
  const c = cfg.isCompress ? 'C' : '';
  const e = cfg.isEncrypt ? 'E' : '';
  return `${PREFIX}${c}${e}${cfg.modelVersion}${END_SEPERATOR}`;
};

export const extractSyncFileStateFromPrefix = (
  dataStr: string,
): SyncFilePrefixParamsOutput => {
  // Modified regex to match decimal numbers
  const match = dataStr.match(
    new RegExp(`^${PREFIX}(C)?(E)?(\\d+(?:\\.\\d+)?)${END_SEPERATOR}`),
  );
  if (!match) {
    throw new InvalidFilePrefixError(dataStr);
  }

  return {
    isCompressed: !!match[1],
    isEncrypted: !!match[2],
    modelVersion: parseFloat(match[3]), // Changed to parseFloat
    cleanDataStr: dataStr.slice(match[0].length),
  };
};
