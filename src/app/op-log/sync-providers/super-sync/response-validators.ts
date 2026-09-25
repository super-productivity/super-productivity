import {
  SuperSyncDeleteAllDataResponseSchema,
  SuperSyncDevicesResponseSchema,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncReplaceTokenResponseSchema,
  SuperSyncRestorePointsResponseSchema,
  SuperSyncRestoreSnapshotResponseSchema,
  SuperSyncSnapshotUploadResponseSchema,
  SuperSyncUploadOpsResponseSchema,
} from '@sp/shared-schema';
import type {
  SuperSyncDeviceListResponse,
  SuperSyncReplaceTokenResult,
} from '@sp/sync-providers/super-sync';
import {
  OpUploadResponse,
  SuperSyncOpDownloadResponse,
  SnapshotUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
} from '../provider.interface';
import { InvalidDataSPError } from '../../core/errors/sync-errors';

type ValidationIssue = {
  path: readonly PropertyKey[];
  message: string;
};

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: ValidationIssue[] } };

type SafeParseSchema<T> = {
  safeParse: (data: unknown) => SafeParseResult<T>;
};

type ParsedSuperSyncOpDownloadResponse = Omit<
  SuperSyncOpDownloadResponse,
  'snapshotState'
> & {
  snapshotState?: unknown;
};

const formatIssuePath = (path: readonly PropertyKey[]): string =>
  path.length > 0 ? `.${path.map((segment) => String(segment)).join('.')}` : '';

const parseResponse = <T>(
  schema: SafeParseSchema<T>,
  data: unknown,
  responseName: string,
): T => {
  const parseResult = schema.safeParse(data);

  if (parseResult.success) {
    return parseResult.data;
  }

  const details = parseResult.error.issues
    .map((issue) => `${responseName}${formatIssuePath(issue.path)}: ${issue.message}`)
    .join('; ');

  throw new InvalidDataSPError(details || `${responseName} is invalid`);
};

/**
 * Validates OpUploadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateOpUploadResponse = (data: unknown): OpUploadResponse =>
  parseResponse(
    SuperSyncUploadOpsResponseSchema,
    data,
    'OpUploadResponse',
  ) as unknown as OpUploadResponse;

/**
 * Validates OpDownloadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateOpDownloadResponse = (
  data: unknown,
): SuperSyncOpDownloadResponse => {
  const response = parseResponse(
    SuperSyncDownloadOpsResponseSchema,
    data,
    'OpDownloadResponse',
  ) as unknown as ParsedSuperSyncOpDownloadResponse;

  if ('snapshotState' in response) {
    const responseWithoutSnapshotState = { ...response };
    delete responseWithoutSnapshotState.snapshotState;
    return responseWithoutSnapshotState as SuperSyncOpDownloadResponse;
  }

  return response as SuperSyncOpDownloadResponse;
};

/**
 * Validates SnapshotUploadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateSnapshotUploadResponse = (data: unknown): SnapshotUploadResponse =>
  parseResponse(
    SuperSyncSnapshotUploadResponseSchema,
    data,
    'SnapshotUploadResponse',
  ) as SnapshotUploadResponse;

/**
 * Validates RestorePointsResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 *
 * `type` is a loose string on the wire (#8764): a restore point of a kind this
 * client does not know is kept — the dialog renders unknown types with a
 * generic icon/label and restoring works by serverSeq — so a newer client's
 * snapshot never hides the list, and never fails it.
 */
export const validateRestorePointsResponse = (data: unknown): RestorePointsResponse =>
  parseResponse(
    SuperSyncRestorePointsResponseSchema,
    data,
    'RestorePointsResponse',
  ) as RestorePointsResponse;

/**
 * Validates RestoreSnapshotResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateRestoreSnapshotResponse = (data: unknown): RestoreSnapshotResponse =>
  parseResponse(
    SuperSyncRestoreSnapshotResponseSchema,
    data,
    'RestoreSnapshotResponse',
  ) as RestoreSnapshotResponse;

/**
 * Validates DevicesResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateDevicesResponse = (data: unknown): SuperSyncDeviceListResponse =>
  parseResponse(
    SuperSyncDevicesResponseSchema,
    data,
    'DevicesResponse',
  ) as SuperSyncDeviceListResponse;

/**
 * Validates DeleteAllDataResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateDeleteAllDataResponse = (data: unknown): { success: boolean } =>
  parseResponse(SuperSyncDeleteAllDataResponseSchema, data, 'DeleteAllDataResponse');

/**
 * Validates ReplaceTokenResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateReplaceTokenResponse = (
  data: unknown,
): SuperSyncReplaceTokenResult =>
  parseResponse(
    SuperSyncReplaceTokenResponseSchema,
    data,
    'ReplaceTokenResponse',
  ) as SuperSyncReplaceTokenResult;
