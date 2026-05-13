import { IValidation } from 'typia';
import type { SyncFilePrefixInvalidPrefixDetails } from '@sp/sync-core';
import { toSyncLogError } from '@sp/sync-core';
import {
  AdditionalLogErrorBase as PackageAdditionalLogErrorBase,
  extractErrorMessage as packageExtractErrorMessage,
} from '@sp/sync-providers/errors';
import { FILE_BASED_SYNC_CONSTANTS } from '../../sync-providers/file-based/file-based-sync.types';
import { OP_LOG_SYNC_LOGGER } from '../sync-logger.adapter';

// Re-export provider-shared error classes from @sp/sync-providers.
// Single class definition per error is critical for `instanceof` checks
// across the codebase. See docs/plans/2026-05-12-pr5-dropbox-slice.md
// action item A5 and sync-errors.identity.spec.ts.
export {
  AuthFailSPError,
  EmptyRemoteBodySPError,
  FileHashCreationAPIError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NetworkUnavailableSPError,
  NoRevAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '@sp/sync-providers/errors';

export const extractErrorMessage = packageExtractErrorMessage;

const getValidationErrors = (
  validationResult?: IValidation<unknown>,
): IValidation.IError[] | undefined => {
  if (
    validationResult &&
    typeof validationResult === 'object' &&
    'errors' in validationResult &&
    Array.isArray(validationResult.errors)
  ) {
    return validationResult.errors as IValidation.IError[];
  }
  return undefined;
};

const getValidationErrorPathSummary = (
  validationResult?: IValidation<unknown>,
): string | undefined => {
  const errors = getValidationErrors(validationResult);
  if (!errors) return undefined;

  const pathSummary = errors
    .slice(0, 3)
    .map((error) => error.path)
    .filter(Boolean)
    .join(', ');
  return pathSummary || undefined;
};

// AdditionalLogErrorBase is provided by @sp/sync-providers (without the
// previous constructor-time logging side effect). The remaining app-only
// errors below extend it; they MUST log at the catch site via
// OP_LOG_SYNC_LOGGER rather than relying on the constructor.
type AdditionalLogErrorBase<T = unknown[]> = PackageAdditionalLogErrorBase<T>;
// Local alias so existing `extends AdditionalLogErrorBase` syntax keeps
// working unchanged below.
const AdditionalLogErrorBase = PackageAdditionalLogErrorBase;

export class ImpossibleError extends Error {
  override name = ' ImpossibleError';
}

// --------------APP-SIDE-ONLY API ERRORS--------------

export class NoEtagAPIError extends AdditionalLogErrorBase {
  override name = ' NoEtagAPIError';
}

export class FileExistsAPIError extends Error {
  override name = ' FileExistsAPIError';
}

// --------------OTHER SYNC ERRORS--------------
export class NoSyncProviderSetError extends Error {
  override name = 'NoSyncProviderSetError';
}

/**
 * Thrown when file-based sync detects local unsynced changes that would be
 * lost if remote snapshot is applied. Caught by SyncWrapperService to show
 * conflict resolution dialog.
 */
export class LocalDataConflictError extends Error {
  override name = 'LocalDataConflictError';

  constructor(
    public readonly unsyncedCount: number,
    public readonly remoteSnapshotState: Record<string, unknown>,
    public readonly remoteVectorClock?: Record<string, number>,
  ) {
    super(`Local data conflict: ${unsyncedCount} unsynced changes would be lost`);
  }
}

export class SyncAlreadyInProgressError extends Error {
  override name = 'SyncAlreadyInProgressError';

  constructor() {
    super('Sync already in progress');
  }
}

export class LockAcquisitionTimeoutError extends Error {
  override name = 'LockAcquisitionTimeoutError';

  constructor(
    public readonly lockName: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Timed out waiting ${timeoutMs}ms to acquire lock "${lockName}". ` +
        `A previous lock holder may have crashed or stalled.`,
    );
  }
}

export class RevMismatchForModelError extends AdditionalLogErrorBase<string> {
  override name = 'RevMismatchForModelError';
}

export class UnknownSyncStateError extends Error {
  override name = 'UnknownSyncStateError';
}

export class SyncInvalidTimeValuesError extends AdditionalLogErrorBase {
  override name = 'SyncInvalidTimeValuesError';
}

export class RevMapModelMismatchErrorOnDownload extends AdditionalLogErrorBase {
  override name = 'RevMapModelMismatchErrorOnDownload';
}

export class RevMapModelMismatchErrorOnUpload extends AdditionalLogErrorBase {
  override name = 'RevMapModelMismatchErrorOnUpload';
}

export class NoRemoteModelFile extends AdditionalLogErrorBase<string> {
  override name = 'NoRemoteModelFile';
}

export class NoRemoteMetaFile extends Error {
  override name = 'NoRemoteMetaFile';
}

// --------------LOCKFILE ERRORS--------------
export class LockPresentError extends Error {
  override name = 'LockPresentError';
}

export class LockFromLocalClientPresentError extends Error {
  override name = 'LockFromLocalClientPresentError';
}

// -----ENCRYPTION & COMPRESSION----
export class DecryptNoPasswordError extends AdditionalLogErrorBase {
  override name = 'DecryptNoPasswordError';
}

export class DecryptError extends AdditionalLogErrorBase {
  override name = 'DecryptError';
}

export class CompressError extends AdditionalLogErrorBase {
  override name = 'CompressError';
}

export class DecompressError extends AdditionalLogErrorBase {
  override name = 'DecompressError';

  constructor(...additional: unknown[]) {
    super(...additional);
    this.message = buildDecompressErrorMessage(this.message);
  }
}

/**
 * Translates opaque browser DecompressionStream errors (e.g. WHATWG's
 * "compressed Input was truncated") into actionable recovery guidance.
 * Truncation of the remote sync file is unrecoverable from the client — the
 * user must delete the corrupt file on the remote before sync can recover.
 *
 * NOTE: rawMessage here has already passed through extractErrorMessage, which
 * rewrites zlib Z_* codes to "compression error: <code>" (spaces, not
 * underscores), so this heuristic matches the post-normalization form.
 */
const buildDecompressErrorMessage = (rawMessage: string): string => {
  const lower = rawMessage.toLowerCase();
  const looksTruncated =
    lower.includes('truncat') ||
    lower.includes('unexpected end') ||
    lower.includes('buf error');
  if (looksTruncated) {
    return (
      `Remote sync file appears corrupted (compressed data is truncated). ` +
      `To recover, delete the ${FILE_BASED_SYNC_CONSTANTS.SYNC_FILE} file on ` +
      `your sync server, then trigger a sync from the device with your latest data.`
    );
  }
  return `Failed to decompress sync data: ${rawMessage}`;
};

export class JsonParseError extends Error {
  override name = 'JsonParseError';
  position?: number;
  dataSample?: string;

  constructor(originalError: unknown, dataStr?: string) {
    // Extract position from SyntaxError message (e.g., "...at position 80999")
    const positionMatch =
      originalError instanceof Error
        ? originalError.message.match(/position\s+(\d+)/i)
        : null;
    const position = positionMatch ? parseInt(positionMatch[1], 10) : undefined;

    // Create human-readable message
    const positionInfo = position !== undefined ? ` at position ${position}` : '';
    const message = `Failed to parse JSON data${positionInfo}. The sync data may be corrupted or incomplete.`;

    super(message);
    this.position = position;

    // Extract a sample of the data around the error position for debugging
    if (dataStr && position !== undefined) {
      const start = Math.max(0, position - 50);
      const end = Math.min(dataStr.length, position + 50);
      this.dataSample = `...${dataStr.substring(start, end)}...`;
    }

    OP_LOG_SYNC_LOGGER.err('JsonParseError', toSyncLogError(originalError), {
      position: this.position,
      dataLength: dataStr?.length,
      hasDataSample: this.dataSample !== undefined,
    });
  }
}

// --------------MODEL AND DB ERRORS--------------
export class ClientIdNotFoundError extends Error {
  override name = 'ClientIdNotFoundError';
}

export class DBNotInitializedError extends Error {
  override name = 'DBNotInitializedError';
}

export class InvalidMetaError extends AdditionalLogErrorBase {
  override name = 'InvalidMetaError';
}

export class MetaNotReadyError extends AdditionalLogErrorBase {
  override name = 'MetaNotReadyError';
}

export class InvalidRevMapError extends AdditionalLogErrorBase {
  override name = 'InvalidRevMapError';
}

export class ModelIdWithoutCtrlError extends AdditionalLogErrorBase {
  override name = 'ModelIdWithoutCtrlError';
}

export class ModelMigrationError extends AdditionalLogErrorBase {
  override name = 'ModelMigrationError';
}

export class CanNotMigrateMajorDownError extends AdditionalLogErrorBase {
  override name = 'CanNotMigrateMajorDownError';
}

export class ModelRepairError extends AdditionalLogErrorBase {
  override name = 'ModelRepairError';
}

export class InvalidModelCfgError extends AdditionalLogErrorBase {
  override name = 'InvalidModelCfgError';
}

export class InvalidSyncProviderError extends Error {
  override name = 'InvalidSyncProviderError';
}

export class ModelValidationError extends Error {
  override name = 'ModelValidationError';
  additionalLog?: string;

  constructor(params: {
    id: string;
    data: unknown;
    validationResult?: IValidation<unknown>;
    e?: unknown;
  }) {
    super('ModelValidationError');
    OP_LOG_SYNC_LOGGER.log('ModelValidationError', {
      id: params.id,
      hasValidationResult: params.validationResult !== undefined,
      validationErrorCount: getValidationErrors(params.validationResult)?.length,
      validationPathSummary: getValidationErrorPathSummary(params.validationResult),
      hasAdditionalError: params.e !== undefined,
      additionalErrorName:
        params.e !== undefined ? toSyncLogError(params.e).name : undefined,
    });

    if (params.validationResult) {
      try {
        const errors = getValidationErrors(params.validationResult);
        if (errors) {
          const str = JSON.stringify(errors);
          this.additionalLog = `Model: ${params.id}, Errors: ${str.substring(0, 400)}`;
        }
      } catch (e) {
        OP_LOG_SYNC_LOGGER.err(
          'Error stringifying validation errors',
          toSyncLogError(e),
          { id: params.id },
        );
      }
    }
  }
}

export class DataValidationFailedError extends Error {
  override name = 'DataValidationFailedError';
  additionalLog?: string;

  constructor(validationResult: IValidation<unknown>) {
    const errorSummary = DataValidationFailedError._buildErrorSummary(validationResult);
    super(errorSummary);
    OP_LOG_SYNC_LOGGER.log('DataValidationFailedError', {
      validationErrorCount: getValidationErrors(validationResult)?.length,
      validationPathSummary: getValidationErrorPathSummary(validationResult),
    });

    try {
      const errors = getValidationErrors(validationResult);
      if (errors) {
        const str = JSON.stringify(errors);
        this.additionalLog = str.substring(0, 400);
      }
    } catch (e) {
      OP_LOG_SYNC_LOGGER.err('Failed to stringify validation errors', toSyncLogError(e));
    }
  }

  private static _buildErrorSummary(validationResult: IValidation<unknown>): string {
    try {
      const errors = getValidationErrors(validationResult);
      if (errors) {
        const paths = errors
          .slice(0, 3)
          .map((e) => e.path)
          .join(', ');
        const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
        return `Validation failed at: ${paths}${suffix}`;
      }
    } catch {
      // Fall through to default message
    }
    return 'Data validation failed';
  }
}

export class ModelVersionToImportNewerThanLocalError extends AdditionalLogErrorBase {
  override name = 'ModelVersionToImportNewerThanLoca';
}

// --------------OTHER--------------

export class InvalidFilePrefixError extends AdditionalLogErrorBase {
  override name = 'InvalidFilePrefixError';

  constructor(details: SyncFilePrefixInvalidPrefixDetails) {
    super({
      message: `Invalid sync file prefix. Expected prefix "${details.expectedPrefix}".`,
      expectedPrefix: details.expectedPrefix,
      endSeparator: details.endSeparator,
      inputLength: details.inputLength,
    });
  }
}

export class DataRepairNotPossibleError extends AdditionalLogErrorBase {
  override name = 'DataRepairNotPossibleError';
}

export class NoRepairFunctionProvidedError extends Error {
  override name = 'NoRepairFunctionProvidedError';
}

export class NoValidateFunctionProvidedError extends Error {
  override name = 'NoValidateFunctionProvidedError';
}

export class BackupImportFailedError extends AdditionalLogErrorBase {
  override name = 'BackupImportFailedError';
}

export class WebCryptoNotAvailableError extends Error {
  override name = 'WebCryptoNotAvailableError';
}

/**
 * Thrown when IndexedDB storage quota is exceeded during operation log write.
 * Callers should handle by running compaction or prompting user to clear data.
 */
export class StorageQuotaExceededError extends Error {
  override name = 'StorageQuotaExceededError';

  constructor() {
    super('Operation log storage quota exceeded');
  }
}

/**
 * Thrown when sync data is incompatible with the expected format version.
 * This can occur when the remote file was written by a different (older or newer)
 * version of the app. Force-uploading is unsafe in this case because the remote
 * may be in a newer format.
 */
export class SyncDataCorruptedError extends Error {
  override name = 'SyncDataCorruptedError';

  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(`Sync data incompatible at ${filePath}: ${message}`);
  }
}

/**
 * Thrown when the remote sync provider has legacy pfapi files (__meta_) but no
 * sync-data.json. This means a v16.x client is still writing to the same provider
 * using the old per-file format. Cross-version sync is not supported — both devices
 * must run the same app version for sync to work.
 */
export class LegacySyncFormatDetectedError extends Error {
  override name = 'LegacySyncFormatDetectedError';

  constructor() {
    super(
      'Sync format mismatch: the remote storage was last written by an older app version ' +
        '(v16.x or earlier) that uses a different sync format. Please update all your ' +
        'devices to the same app version so they use the same sync format.',
    );
  }
}
