import { CapacitorHttp } from '@capacitor/core';
import {
  PROVIDER_ID_SUPER_SYNC,
  SuperSyncProvider as PackageSuperSyncProvider,
  type SuperSyncDeps,
} from '@sp/sync-providers/super-sync';
import type { NativeHttpResponse } from '@sp/sync-providers/http';
import { OP_LOG_SYNC_LOGGER } from '../../core/sync-logger.adapter';
import { SyncCredentialStore } from '../credential-store.service';
import { APP_PROVIDER_PLATFORM_INFO } from '../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../platform/app-web-fetch';
import { SyncProviderId } from '../provider.const';
import {
  validateDeleteAllDataResponse,
  validateOpDownloadResponse,
  validateOpUploadResponse,
  validateRestorePointsResponse,
  validateRestoreSnapshotResponse,
  validateSnapshotUploadResponse,
} from './response-validators';

// Type-level bridge — fails to compile if the enum's runtime value drifts
// away from the package's string literal, or if either side is renamed.
type AssertSuperSyncId = SyncProviderId.SuperSync extends typeof PROVIDER_ID_SUPER_SYNC
  ? true
  : never;
const _idCheck: AssertSuperSyncId = true;
void _idCheck;

export type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
/**
 * App-side factory wiring concrete adapters into the package's SuperSync
 * provider. Returns the package class directly — no shim subclass.
 *
 * Takes no arguments: SuperSync has no `basePath` concept (operation-
 * based sync, not file-based).
 */
export const createSuperSyncProvider = (): PackageSuperSyncProvider => {
  const localStoragePort: SuperSyncDeps['storage'] = {
    getLastServerSeq: (key) => {
      const v = localStorage.getItem(key);
      if (v == null || v === '') return null;
      // `parseInt` returns NaN for non-numeric strings (e.g. a future
      // regression that writes ""). Bridge to `null` so the package's
      // `stored ?? 0` fallback fires correctly.
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    },
    setLastServerSeq: (key, value) => localStorage.setItem(key, String(value)),
    removeLastServerSeq: (key) => localStorage.removeItem(key),
  };

  const responseValidators: SuperSyncDeps['responseValidators'] = {
    validateOpUpload: validateOpUploadResponse,
    validateOpDownload: validateOpDownloadResponse,
    validateSnapshotUpload: validateSnapshotUploadResponse,
    validateRestorePoints: validateRestorePointsResponse,
    validateRestoreSnapshot: validateRestoreSnapshotResponse,
    validateDeleteAllData: validateDeleteAllDataResponse,
  };

  const deps: SuperSyncDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.SuperSync,
    ) as SuperSyncDeps['credentialStore'],
    nativeHttpExecutor: (httpCfg) =>
      CapacitorHttp.request(httpCfg) as unknown as Promise<NativeHttpResponse>,
    storage: localStoragePort,
    responseValidators,
  };
  return new PackageSuperSyncProvider(deps);
};
