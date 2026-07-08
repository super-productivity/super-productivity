import { IValidation } from 'typia';
import { SyncProviderId, ConflictReason } from '../../sync-providers/provider.const';
import { VectorClock } from '../../../core/util/vector-clock';

// ============================================================================
// Core Types
// ============================================================================

export type ValidationResult<T> = IValidation<T>;

export interface EncryptAndCompressCfg {
  isEncrypt: boolean;
  isCompress: boolean;
}

// ============================================================================
// Model Configuration Types
// ============================================================================

type JSONPrimitive = string | number | boolean | null;
type Serializable = JSONPrimitive | SerializableObject | SerializableArray;

interface SerializableObject {
  [key: string]: Serializable | undefined;
}

type SerializableArray = Array<Serializable>;

export type ModelBase = SerializableObject | SerializableArray | unknown;

export interface ModelCfg<T extends ModelBase> {
  isLocalOnly?: boolean;
  isAlwaysReApplyOldMigrations?: boolean;
  debounceDbWrite?: number;
  isMainFileModel?: boolean;

  /**
   * When true, ModelCtrl.load() will cache the result from IndexedDB
   * in memory for subsequent reads. Useful for frequently-read models.
   * Default: false (current behavior - no caching on load).
   */
  cacheOnLoad?: boolean;

  repair?: (data: any) => T; // any is intentional: repair handles malformed data

  defaultData?: T;
}

export type ModelCfgs = {
  [modelId: string]: ModelCfg<ModelBase>;
};

type ExtractModelCfgType<T extends ModelCfg<ModelBase>> =
  T extends ModelCfg<infer U> ? U : never;

export type AllModelData<T extends ModelCfgs> = {
  [K in keyof T]: ExtractModelCfgType<T[K]>;
};

export type AllSyncModels<T extends ModelCfgs> = {
  [K in keyof T]: ExtractModelCfgType<T[K]>;
};

// ============================================================================
// Sync Provider Private Config Types
// ============================================================================

export interface SyncProviderPrivateCfgBase {
  encryptKey?: string;
}

// Note: DropboxPrivateCfg, WebdavPrivateCfg, SuperSyncPrivateCfg are defined
// in their respective provider files and extend SyncProviderPrivateCfgBase.
// They are imported lazily via type imports where needed.

// ============================================================================
// Provider-Specific Config Type Mapping
// ============================================================================

import type { DropboxPrivateCfg } from '@sp/sync-providers/dropbox';
import type { LocalFileSyncPrivateCfg as PackageLocalFileSyncPrivateCfg } from '@sp/sync-providers/local-file';
import type { NextcloudPrivateCfg, WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import type { OneDrivePrivateCfg } from '@sp/sync-providers/onedrive';

export type LocalFileSyncPrivateCfg = PackageLocalFileSyncPrivateCfg;

export type SyncProviderPrivateCfg =
  | DropboxPrivateCfg
  | OneDrivePrivateCfg
  | WebdavPrivateCfg
  | SuperSyncPrivateCfg
  | LocalFileSyncPrivateCfg
  | NextcloudPrivateCfg;

export type PrivateCfgByProviderId<T extends SyncProviderId> =
  T extends SyncProviderId.LocalFile
    ? LocalFileSyncPrivateCfg
    : T extends SyncProviderId.WebDAV
      ? WebdavPrivateCfg
      : T extends SyncProviderId.Dropbox
        ? DropboxPrivateCfg
        : T extends SyncProviderId.OneDrive
          ? OneDrivePrivateCfg
          : T extends SyncProviderId.SuperSync
            ? SuperSyncPrivateCfg
            : T extends SyncProviderId.Nextcloud
              ? NextcloudPrivateCfg
              : never;

// ============================================================================
// Current Provider Config (for observable emissions)
// ============================================================================

export interface CurrentProviderPrivateCfg {
  providerId: SyncProviderId;
  privateCfg: SyncProviderPrivateCfg | null;
}

// ============================================================================
// Conflict Types
// ============================================================================

export interface RevMap {
  [modelOrFileGroupId: string]: string;
}

interface MetaFileBase {
  lastUpdate: number;
  lastUpdateAction?: string;
  revMap: RevMap;
  crossModelVersion: number;
  lastSyncedAction?: string;
  vectorClock?: VectorClock;
  lastSyncedVectorClock?: VectorClock | null;
}

interface MainModelData {
  [modelId: string]: ModelBase;
}

interface RemoteMeta extends MetaFileBase {
  mainModelData: MainModelData;
  isFullData?: boolean;
}

interface LocalMeta extends MetaFileBase {
  lastSyncedUpdate: number | null;
  metaRev: string | null;
}

export interface ConflictData {
  reason: ConflictReason;
  remote: RemoteMeta;
  local: LocalMeta;
  /**
   * Exact number of unsynced local ops known at conflict time (from
   * LocalDataConflictError.unsyncedCount). The conflict dialog prefers it over
   * the vector-clock delta as the local change count: compaction can fold
   * still-unsynced ops into the last-synced baseline clock, so the delta can
   * under-count real pending local changes, while this is precisely what
   * USE_REMOTE would discard.
   */
  localUnsyncedOpsCount?: number;
  additional?: unknown;
}

// ============================================================================
// Backup Types
// ============================================================================

export interface CompleteBackup<T extends ModelCfgs> {
  timestamp: number;
  lastUpdate: number;
  crossModelVersion: number;
  data: AllModelData<T>;
}
