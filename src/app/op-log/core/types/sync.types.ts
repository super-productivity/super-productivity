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

  validate?: <R>(data: R | T) => IValidation<R | T>;
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

// Local file sync config that works for both platforms
export interface LocalFileSyncPrivateCfg extends SyncProviderPrivateCfgBase {
  // Electron specific
  syncFolderPath?: string;
  // Android SAF specific
  safFolderUri?: string;
}

// Note: DropboxPrivateCfg, WebdavPrivateCfg, SuperSyncPrivateCfg are defined
// in their respective provider files and extend SyncProviderPrivateCfgBase.
// They are imported lazily via type imports where needed.

// ============================================================================
// Provider-Specific Config Type Mapping
// ============================================================================

// Forward declarations for provider-specific types
// These are imported from their respective modules where used
import type { DropboxPrivateCfg } from '../../sync-providers/file-based/dropbox/dropbox';
import type { WebdavPrivateCfg } from '../../sync-providers/file-based/webdav/webdav.model';
import type { SuperSyncPrivateCfg } from '../../sync-providers/super-sync/super-sync.model';

export type SyncProviderPrivateCfg =
  | DropboxPrivateCfg
  | WebdavPrivateCfg
  | SuperSyncPrivateCfg
  | LocalFileSyncPrivateCfg;

export type PrivateCfgByProviderId<T extends SyncProviderId> =
  T extends SyncProviderId.LocalFile
    ? LocalFileSyncPrivateCfg
    : T extends SyncProviderId.WebDAV
      ? WebdavPrivateCfg
      : T extends SyncProviderId.Dropbox
        ? DropboxPrivateCfg
        : T extends SyncProviderId.SuperSync
          ? SuperSyncPrivateCfg
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
