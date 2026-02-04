import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { SyncProviderId, PRIVATE_CFG_PREFIX } from './provider.const';
import { PrivateCfgByProviderId } from '../core/types/sync.types';
import { SyncLog } from '../../core/log';

/**
 * New database configuration for sync credentials.
 * Replaces the legacy 'pf' database for OAuth tokens and provider configs.
 */
const DB_NAME = 'sup-sync';
const DB_STORE_NAME = 'credentials';
const DB_VERSION = 1;

/**
 * Legacy database configuration for migration.
 */
const LEGACY_DB_NAME = 'pf';
const LEGACY_DB_STORE_NAME = 'main';

/**
 * Schema for the sync credentials database.
 */
interface SyncCredentialsDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: unknown;
  };
}

/**
 * Callback type for configuration change notifications.
 */
export type CredentialChangeCallback<PID extends SyncProviderId> = (data: {
  providerId: PID;
  privateCfg: PrivateCfgByProviderId<PID>;
}) => void;

/**
 * Store for managing sync provider credentials.
 *
 * This service replaces the legacy PFAPI-based storage with a dedicated
 * 'sup-sync' database. It includes automatic migration from the legacy
 * 'pf' database on first access.
 *
 * ## Migration Strategy
 * On first load for each provider:
 * 1. Check if credentials exist in new 'sup-sync' database
 * 2. If not, attempt to migrate from legacy 'pf' database
 * 3. Future operations use only the new database
 *
 * ## Key Format
 * Credentials are stored with keys: `PRIVATE_CFG_PREFIX + providerId`
 * (e.g., `__sp_cred_Dropbox`)
 */
export class SyncCredentialStore<PID extends SyncProviderId> {
  private static readonly L = 'SyncCredentialStore';

  private readonly _dbKey: string;
  private _privateCfgInMemory?: PrivateCfgByProviderId<PID>;
  private _db?: IDBPDatabase<SyncCredentialsDb>;
  private _initPromise?: Promise<void>;
  private _migrationAttempted = false;
  private _onChangeCallback?: CredentialChangeCallback<PID>;

  constructor(private readonly _providerId: PID) {
    this._dbKey = PRIVATE_CFG_PREFIX + _providerId;
  }

  /**
   * Sets a callback to be notified when configuration changes.
   */
  onConfigChange(callback: CredentialChangeCallback<PID>): void {
    this._onChangeCallback = callback;
  }

  /**
   * Loads the provider's private configuration.
   * Automatically migrates from legacy database if needed.
   */
  async load(): Promise<PrivateCfgByProviderId<PID> | null> {
    SyncLog.verbose(
      `${SyncCredentialStore.L}.${this.load.name}`,
      this._providerId,
      typeof this._privateCfgInMemory,
    );

    // Return cached config if available
    if (this._privateCfgInMemory) {
      return this._privateCfgInMemory;
    }

    try {
      const db = await this._ensureDb();

      // Try to load from new database
      let loadedConfig = (await db.get(
        DB_STORE_NAME,
        this._dbKey,
      )) as PrivateCfgByProviderId<PID> | null;

      // If not found and not yet attempted migration, try legacy database
      if (!loadedConfig && !this._migrationAttempted) {
        loadedConfig = await this._migrateFromLegacyDb();
      }

      if (loadedConfig) {
        this._privateCfgInMemory = loadedConfig;
      }

      return loadedConfig ?? null;
    } catch (error) {
      SyncLog.critical(`Failed to load credentials: ${error}`);
      throw new Error(`Failed to load credentials: ${error}`);
    }
  }

  /**
   * Sets the complete provider's private configuration.
   */
  async setComplete(privateCfg: PrivateCfgByProviderId<PID>): Promise<void> {
    return this._save(privateCfg);
  }

  /**
   * Updates the provider's private configuration with partial data.
   */
  async updatePartial(updates: Partial<PrivateCfgByProviderId<PID>>): Promise<void> {
    const existing = await this.load();
    if (!existing) {
      throw new Error(
        `Cannot update credentials for ${this._providerId}: no existing config found`,
      );
    }
    return this._save({ ...existing, ...updates });
  }

  /**
   * Upserts the provider's private configuration with partial data.
   */
  async upsertPartial(updates: Partial<PrivateCfgByProviderId<PID>>): Promise<void> {
    const existing = await this.load();
    const privateCfg = existing
      ? { ...existing, ...updates }
      : (updates as PrivateCfgByProviderId<PID>);
    return this._save(privateCfg);
  }

  /**
   * Clears the provider's credentials.
   */
  async clear(): Promise<void> {
    SyncLog.normal(`${SyncCredentialStore.L}.clear()`, this._providerId);

    this._privateCfgInMemory = undefined;

    try {
      const db = await this._ensureDb();
      await db.delete(DB_STORE_NAME, this._dbKey);
    } catch (error) {
      SyncLog.critical(`Failed to clear credentials: ${error}`);
      throw new Error(`Failed to clear credentials: ${error}`);
    }
  }

  /**
   * Initializes the database connection.
   */
  private async _init(): Promise<void> {
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      this._db = await openDB<SyncCredentialsDb>(DB_NAME, DB_VERSION, {
        upgrade: (database) => {
          // Create the credentials store if it doesn't exist
          if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
            database.createObjectStore(DB_STORE_NAME);
            SyncLog.normal(
              `[${SyncCredentialStore.L}] Created ${DB_STORE_NAME} object store`,
            );
          }
        },
      });
      SyncLog.verbose(
        `[${SyncCredentialStore.L}] Database connection initialized for ${this._providerId}`,
      );
    } catch (e) {
      SyncLog.err(`[${SyncCredentialStore.L}] Failed to initialize database`, e);
      this._initPromise = undefined; // Allow retry
      throw e;
    }
  }

  private async _ensureDb(): Promise<IDBPDatabase<SyncCredentialsDb>> {
    if (!this._db) {
      await this._init();
    }
    if (!this._db) {
      throw new Error(`[${SyncCredentialStore.L}] Database not initialized`);
    }
    return this._db;
  }

  /**
   * Attempts to migrate credentials from the legacy 'pf' database.
   */
  private async _migrateFromLegacyDb(): Promise<PrivateCfgByProviderId<PID> | null> {
    this._migrationAttempted = true;

    try {
      // Open legacy database (read-only, don't create if doesn't exist)
      const legacyDb = await openDB(LEGACY_DB_NAME, 1, {
        upgrade: (database) => {
          // Create main store if it doesn't exist (needed to open the db)
          if (!database.objectStoreNames.contains(LEGACY_DB_STORE_NAME)) {
            database.createObjectStore(LEGACY_DB_STORE_NAME);
          }
        },
      });

      // Check if legacy store exists
      if (!legacyDb.objectStoreNames.contains(LEGACY_DB_STORE_NAME)) {
        legacyDb.close();
        return null;
      }

      // Try to load from legacy database
      const legacyConfig = (await legacyDb.get(
        LEGACY_DB_STORE_NAME,
        this._dbKey,
      )) as PrivateCfgByProviderId<PID>;

      legacyDb.close();

      if (legacyConfig) {
        SyncLog.normal(
          `[${SyncCredentialStore.L}] Migrating credentials for ${this._providerId} from legacy database`,
        );

        // Save to new database
        await this._save(legacyConfig);
        return legacyConfig;
      }

      return null;
    } catch (error) {
      SyncLog.warn(
        `[${SyncCredentialStore.L}] Failed to migrate from legacy database (this is ok for new installs): ${error}`,
      );
      return null;
    }
  }

  /**
   * Internal method to save configuration.
   */
  private async _save(privateCfg: PrivateCfgByProviderId<PID>): Promise<void> {
    // Log the encryptKey being saved (redacted for security - just show length)
    const cfgWithRedacted = privateCfg as { encryptKey?: string };
    const encryptKeyInfo = cfgWithRedacted?.encryptKey
      ? `[length=${cfgWithRedacted.encryptKey.length}]`
      : '[not set]';
    SyncLog.normal(
      `${SyncCredentialStore.L}._save()`,
      this._providerId,
      `encryptKey=${encryptKeyInfo}`,
      `dbKey=${this._dbKey}`,
    );

    this._privateCfgInMemory = privateCfg;

    // Notify listeners of configuration change
    if (this._onChangeCallback) {
      this._onChangeCallback({
        providerId: this._providerId,
        privateCfg,
      });
    }

    try {
      const db = await this._ensureDb();
      await db.put(DB_STORE_NAME, privateCfg, this._dbKey);
      SyncLog.normal(
        `${SyncCredentialStore.L}._save() SUCCESS`,
        this._providerId,
        `wrote to ${DB_STORE_NAME}/${this._dbKey}`,
      );
    } catch (error) {
      SyncLog.critical(`Failed to save credentials: ${error}`);
      throw new Error(`Failed to save credentials: ${error}`);
    }
  }
}
