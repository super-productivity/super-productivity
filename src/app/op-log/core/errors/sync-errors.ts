import { IValidation } from 'typia';
import { OpLog } from '../../../core/log';

/**
 * Extracts a meaningful error message from various error shapes.
 * Handles Error objects with nested cause, zlib error codes, and plain strings.
 * This is important because some browser APIs (like DecompressionStream) throw
 * errors with empty messages but contain the real error in the 'cause' property.
 */
export const extractErrorMessage = (err: unknown): string | null => {
  if (typeof err === 'string' && err.length > 0) {
    return err;
  }

  if (err instanceof Error) {
    // Check for nested cause first (e.g., DecompressionStream errors)
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }

    // Check for error code (e.g., zlib errors like Z_DATA_ERROR)
    const code = (err as Error & { code?: string }).code;
    if (typeof code === 'string' && code.length > 0) {
      // Make zlib error codes more readable
      if (code.startsWith('Z_')) {
        return `Compression error: ${code.replace('Z_', '').replace(/_/g, ' ').toLowerCase()}`;
      }
      return code;
    }

    // Use the error's own message if available
    if (err.message && err.message.length > 0) {
      return err.message;
    }
  }

  // For objects with message property
  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    const msg = (err as { message: string }).message;
    if (msg.length > 0) {
      return msg;
    }
  }

  return null;
};

/**
 * Sanitizes data for logging by redacting sensitive information.
 * Removes tokens, passwords, secrets, and authorization headers.
 */
const sanitizeForLogging = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  return data
    .replace(
      /("(access_?token|refresh_?token|password|secret|authorization)":\s*")[^"]+"/gi,
      '$1[REDACTED]"',
    )
    .replace(/(Bearer\s+)[^\s"]+/gi, '$1[REDACTED]')
    .substring(0, 1000);
};

class AdditionalLogErrorBase<T = unknown[]> extends Error {
  additionalLog: T;

  constructor(...additional: unknown[]) {
    // Extract meaningful message from first argument, fall back to class name
    const extractedMessage = extractErrorMessage(additional[0]);
    // Use hardcoded class name pattern to avoid minification issues
    super(extractedMessage ?? 'Unknown error');

    if (additional.length > 0) {
      OpLog.log(this.name, ...additional);
      try {
        // Sanitize before logging to avoid exposing tokens in logs
        const sanitized = additional.map(sanitizeForLogging);
        OpLog.log('additional error log: ' + JSON.stringify(sanitized));
      } catch (e) {
        OpLog.log('additional error log not stringified: ', additional, e);
      }
    }
    this.additionalLog = additional as T;
  }
}

export class ImpossibleError extends Error {
  override name = ' ImpossibleError';
}

// --------------API ERRORS--------------
export class NoRevAPIError extends AdditionalLogErrorBase {
  override name = ' NoRevAPIError';
}

export class TooManyRequestsAPIError extends AdditionalLogErrorBase {
  override name = ' TooManyRequestsAPIError';
}

export class NoEtagAPIError extends AdditionalLogErrorBase {
  override name = ' NoEtagAPIError';
}

export class FileExistsAPIError extends Error {
  override name = ' FileExistsAPIError';
}

export class RemoteFileNotFoundAPIError extends AdditionalLogErrorBase {
  override name = ' RemoteFileNotFoundAPIError';
}

export class MissingRefreshTokenAPIError extends Error {
  override name = ' MissingRefreshTokenAPIError';
}

export class FileHashCreationAPIError extends AdditionalLogErrorBase {
  override name = ' FileHashCreationAPIError';
}

export class UploadRevToMatchMismatchAPIError extends AdditionalLogErrorBase {
  override name = ' UploadRevToMatchMismatchAP';
}

// export class CannotCreateFolderAPIError extends AdditionalLogErrorBase {
//   override name = 'CannotCreateFolderAPIError';
// }

export class HttpNotOkAPIError extends AdditionalLogErrorBase {
  override name = ' HttpNotOkAPIError';
  response: Response;
  body?: string;

  constructor(response: Response, body?: string) {
    super(response, body);
    this.response = response;
    this.body = body;
    const statusText = response.statusText || 'Unknown Status';

    // Parse body to extract meaningful error information
    let errorDetail = '';
    if (body) {
      const safeBody =
        typeof body === 'string'
          ? body
          : body !== undefined
            ? (() => {
                try {
                  return JSON.stringify(body);
                } catch (e) {
                  return String(body);
                }
              })()
            : '';

      // Try to extract meaningful error from XML/HTML responses
      errorDetail = this._extractErrorFromBody(safeBody);
    }

    const bodyText = errorDetail ? ` - ${errorDetail}` : '';
    this.message = `HTTP ${response.status} ${statusText}${bodyText}`;
  }

  private _extractErrorFromBody(body: string): string {
    if (!body) return '';

    // Limit body length for error messages
    const maxBodyLength = 300;

    // Try to extract error from Nextcloud/WebDAV XML responses
    // Look for <s:message> or <d:error> tags
    const nextcloudMessageMatch = body.match(/<s:message[^>]*>(.*?)<\/s:message>/i);
    if (nextcloudMessageMatch && nextcloudMessageMatch[1]) {
      return nextcloudMessageMatch[1].trim().substring(0, maxBodyLength);
    }

    const webdavErrorMatch = body.match(/<d:error[^>]*>(.*?)<\/d:error>/i);
    if (webdavErrorMatch && webdavErrorMatch[1]) {
      return webdavErrorMatch[1].trim().substring(0, maxBodyLength);
    }

    // Look for HTML title tags (often contain error descriptions)
    const titleMatch = body.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      // Avoid generic titles
      if (title && !title.match(/^(error|404|403|500)$/i)) {
        return title.substring(0, maxBodyLength);
      }
    }

    // Try to extract JSON error
    try {
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error) {
          return String(parsed.error).substring(0, maxBodyLength);
        }
        if (parsed.message) {
          return String(parsed.message).substring(0, maxBodyLength);
        }
      }
    } catch (e) {
      // Not JSON, continue
    }

    // Strip script and style tags with their content
    // Apply repeatedly to handle nested/crafted inputs like <scri<script>pt>
    let cleanBody = body;
    let previousBody: string;
    do {
      previousBody = cleanBody;
      cleanBody = cleanBody
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gim, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gim, '')
        .replace(/<script\b/gim, '')
        .replace(/<style\b/gim, '');
    } while (cleanBody !== previousBody);

    // Strip HTML tags for plain text
    const withoutTags = cleanBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Return the first meaningful chunk of text
    return withoutTags.substring(0, maxBodyLength);
  }
}

// NOTE: we can't know for sure without complicating things
export class PotentialCorsError extends AdditionalLogErrorBase {
  override name = 'PotentialCorsError';
  url: string;

  constructor(url: string, ...args: unknown[]) {
    super(
      `Cross-Origin Request Blocked: The request to ${url} was blocked by CORS policy`,
      ...args,
    );
    this.url = url;
  }
}

// --------------SYNC PROVIDER ERRORS--------------

export class MissingCredentialsSPError extends Error {
  override name = 'MissingCredentialsSPError';
}

export class AuthFailSPError extends AdditionalLogErrorBase {
  override name = 'AuthFailSPError';
}

export class InvalidDataSPError extends AdditionalLogErrorBase {
  override name = 'InvalidDataSPError';
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

export class RemoteFileChangedUnexpectedly extends AdditionalLogErrorBase {
  override name = 'RemoteFileChangedUnexpectedly';
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
}

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

    OpLog.err('JsonParseError:', {
      message: this.message,
      position: this.position,
      dataSample: this.dataSample,
      originalError,
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
    OpLog.log(`ModelValidationError for model ${params.id}:`, params);

    if (params.validationResult) {
      OpLog.log('validation result: ', params.validationResult);

      try {
        if ('errors' in params.validationResult) {
          const str = JSON.stringify(params.validationResult.errors);
          OpLog.log('validation errors: ' + str);
          this.additionalLog = `Model: ${params.id}, Errors: ${str.substring(0, 400)}`;
        }
      } catch (e) {
        OpLog.err('Error stringifying validation errors:', e);
      }
    }

    if (params.e) {
      OpLog.log('Additional error:', params.e);
    }
  }
}

export class DataValidationFailedError extends Error {
  override name = 'DataValidationFailedError';
  additionalLog?: string;

  constructor(validationResult: IValidation<unknown>) {
    const errorSummary = DataValidationFailedError._buildErrorSummary(validationResult);
    super(errorSummary);
    OpLog.log('validation result: ', validationResult);

    try {
      if ('errors' in validationResult) {
        const str = JSON.stringify(validationResult.errors);
        OpLog.log('validation errors_: ' + str);
        this.additionalLog = str.substring(0, 400);
      }
      OpLog.log('validation result_: ' + JSON.stringify(validationResult));
    } catch (e) {
      OpLog.err('Failed to stringify validation errors:', e);
    }
  }

  private static _buildErrorSummary(validationResult: IValidation<unknown>): string {
    try {
      if ('errors' in validationResult && Array.isArray(validationResult.errors)) {
        const errors = validationResult.errors as IValidation.IError[];
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
