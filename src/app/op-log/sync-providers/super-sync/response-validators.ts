import {
  OpUploadResponse,
  OpDownloadResponse,
  SnapshotUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
} from '../provider.interface';
import { InvalidDataSPError } from '../../core/errors/sync-errors';

/**
 * Validates that a value is an object (not null, array, or primitive).
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates that a value is an array.
 */
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Validates OpUploadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateOpUploadResponse = (data: unknown): OpUploadResponse => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('OpUploadResponse must be an object');
  }

  if (!isArray(data.results)) {
    throw new InvalidDataSPError('OpUploadResponse.results must be an array');
  }

  if (typeof data.latestSeq !== 'number') {
    throw new InvalidDataSPError('OpUploadResponse.latestSeq must be a number');
  }

  // Optional fields: newOps (array), hasMorePiggyback (boolean)
  if (data.newOps !== undefined && !isArray(data.newOps)) {
    throw new InvalidDataSPError('OpUploadResponse.newOps must be an array if present');
  }

  if (data.hasMorePiggyback !== undefined && typeof data.hasMorePiggyback !== 'boolean') {
    throw new InvalidDataSPError(
      'OpUploadResponse.hasMorePiggyback must be a boolean if present',
    );
  }

  return data as unknown as OpUploadResponse;
};

/**
 * Validates OpDownloadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateOpDownloadResponse = (data: unknown): OpDownloadResponse => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('OpDownloadResponse must be an object');
  }

  if (!isArray(data.ops)) {
    throw new InvalidDataSPError('OpDownloadResponse.ops must be an array');
  }

  if (typeof data.hasMore !== 'boolean') {
    throw new InvalidDataSPError('OpDownloadResponse.hasMore must be a boolean');
  }

  if (typeof data.latestSeq !== 'number') {
    throw new InvalidDataSPError('OpDownloadResponse.latestSeq must be a number');
  }

  // Optional fields: gapDetected, snapshotVectorClock, serverTime, snapshotState
  if (data.gapDetected !== undefined && typeof data.gapDetected !== 'boolean') {
    throw new InvalidDataSPError(
      'OpDownloadResponse.gapDetected must be a boolean if present',
    );
  }

  if (data.snapshotVectorClock !== undefined && !isObject(data.snapshotVectorClock)) {
    throw new InvalidDataSPError(
      'OpDownloadResponse.snapshotVectorClock must be an object if present',
    );
  }

  if (data.serverTime !== undefined && typeof data.serverTime !== 'number') {
    throw new InvalidDataSPError(
      'OpDownloadResponse.serverTime must be a number if present',
    );
  }

  return data as unknown as OpDownloadResponse;
};

/**
 * Validates SnapshotUploadResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateSnapshotUploadResponse = (data: unknown): SnapshotUploadResponse => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('SnapshotUploadResponse must be an object');
  }

  if (typeof data.accepted !== 'boolean') {
    throw new InvalidDataSPError('SnapshotUploadResponse.accepted must be a boolean');
  }

  // Optional fields: serverSeq (number), error (string)
  if (data.serverSeq !== undefined && typeof data.serverSeq !== 'number') {
    throw new InvalidDataSPError(
      'SnapshotUploadResponse.serverSeq must be a number if present',
    );
  }

  if (data.error !== undefined && typeof data.error !== 'string') {
    throw new InvalidDataSPError(
      'SnapshotUploadResponse.error must be a string if present',
    );
  }

  return data as unknown as SnapshotUploadResponse;
};

/**
 * Validates RestorePointsResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateRestorePointsResponse = (data: unknown): RestorePointsResponse => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('RestorePointsResponse must be an object');
  }

  if (!isArray(data.restorePoints)) {
    throw new InvalidDataSPError('RestorePointsResponse.restorePoints must be an array');
  }

  return data as unknown as RestorePointsResponse;
};

/**
 * Validates RestoreSnapshotResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateRestoreSnapshotResponse = (
  data: unknown,
): RestoreSnapshotResponse => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('RestoreSnapshotResponse must be an object');
  }

  // serverSeq and generatedAt are required, state can be any value (including null)
  if (typeof data.serverSeq !== 'number') {
    throw new InvalidDataSPError('RestoreSnapshotResponse.serverSeq must be a number');
  }

  if (typeof data.generatedAt !== 'number') {
    throw new InvalidDataSPError('RestoreSnapshotResponse.generatedAt must be a number');
  }

  return data as unknown as RestoreSnapshotResponse;
};

/**
 * Validates DeleteAllDataResponse from server.
 * Throws InvalidDataSPError if the response structure is invalid.
 */
export const validateDeleteAllDataResponse = (data: unknown): { success: boolean } => {
  if (!isObject(data)) {
    throw new InvalidDataSPError('DeleteAllDataResponse must be an object');
  }

  if (typeof data.success !== 'boolean') {
    throw new InvalidDataSPError('DeleteAllDataResponse.success must be a boolean');
  }

  return data as unknown as { success: boolean };
};
