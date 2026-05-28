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

export interface SyncFilePrefixHelpers {
  getSyncFilePrefix(cfg: SyncFilePrefixParams): string;
  extractSyncFileStateFromPrefix(dataStr: string): SyncFilePrefixParamsOutput;
}

export interface SyncFilePrefixConfig {
  prefix: string;
  endSeparator?: string;
  createInvalidPrefixError?: (details: SyncFilePrefixInvalidPrefixDetails) => Error;
}

export interface SyncFilePrefixInvalidPrefixDetails {
  expectedPrefix: string;
  endSeparator: string;
  inputLength: number;
}

export class SyncFilePrefixError extends Error {
  override name = 'SyncFilePrefixError';

  constructor(details: SyncFilePrefixInvalidPrefixDetails) {
    super(`Invalid sync file prefix. Expected prefix "${details.expectedPrefix}".`);
  }
}

export class SyncFilePrefixVersionError extends Error {
  override name = 'SyncFilePrefixVersionError';

  constructor(modelVersion: number | string) {
    const formattedModelVersion = String(modelVersion);
    const safeModelVersion =
      formattedModelVersion.length > 40
        ? `${formattedModelVersion.slice(0, 40)}...`
        : formattedModelVersion;
    super(`Invalid sync file model version: ${safeModelVersion}`);
  }
}

const DEFAULT_END_SEPARATOR = '__';
const MODEL_VERSION_PATTERN = /^\d+(?:\.\d+)?$/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatModelVersion = (modelVersion: number): string => {
  const formatted = String(modelVersion);
  if (
    !Number.isFinite(modelVersion) ||
    modelVersion < 0 ||
    !MODEL_VERSION_PATTERN.test(formatted)
  ) {
    throw new SyncFilePrefixVersionError(modelVersion);
  }
  return formatted;
};

const parseModelVersion = (rawModelVersion: string): number => {
  const modelVersion = parseFloat(rawModelVersion);
  if (!Number.isFinite(modelVersion)) {
    throw new SyncFilePrefixVersionError(rawModelVersion);
  }
  return modelVersion;
};

export const createSyncFilePrefixHelpers = ({
  prefix,
  endSeparator = DEFAULT_END_SEPARATOR,
  createInvalidPrefixError,
}: SyncFilePrefixConfig): SyncFilePrefixHelpers => {
  const prefixPattern = escapeRegExp(prefix);
  const separatorPattern = escapeRegExp(endSeparator);
  const prefixRegex = new RegExp(
    `^${prefixPattern}(C)?(E)?(\\d+(?:\\.\\d+)?)${separatorPattern}`,
  );

  return {
    getSyncFilePrefix: (cfg: SyncFilePrefixParams): string => {
      const c = cfg.isCompress ? 'C' : '';
      const e = cfg.isEncrypt ? 'E' : '';
      return `${prefix}${c}${e}${formatModelVersion(cfg.modelVersion)}${endSeparator}`;
    },

    extractSyncFileStateFromPrefix: (dataStr: string): SyncFilePrefixParamsOutput => {
      const match = dataStr.match(prefixRegex);
      if (!match) {
        const details: SyncFilePrefixInvalidPrefixDetails = {
          expectedPrefix: prefix,
          endSeparator,
          inputLength: dataStr.length,
        };
        throw createInvalidPrefixError?.(details) ?? new SyncFilePrefixError(details);
      }

      return {
        isCompressed: !!match[1],
        isEncrypted: !!match[2],
        modelVersion: parseModelVersion(match[3]),
        cleanDataStr: dataStr.slice(match[0].length),
      };
    },
  };
};
