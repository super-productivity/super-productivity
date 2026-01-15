import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';
import { VectorClock } from '../util/vector-clock';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { Log } from '../log';

/**
 * Type representing all legacy app data stored in the 'pf' database.
 * Used when loading data for migration.
 */
export interface LegacyAppData {
  task?: unknown;
  project?: unknown;
  tag?: unknown;
  simpleCounter?: unknown;
  note?: unknown;
  taskRepeatCfg?: unknown;
  reminders?: unknown;
  planner?: unknown;
  boards?: unknown;
  menuTree?: unknown;
  issueProvider?: unknown;
  metric?: unknown;
  timeTracking?: unknown;
  globalConfig?: unknown;
  pluginUserData?: unknown;
  pluginMetadata?: unknown;
  archiveYoung?: ArchiveModel;
  archiveOld?: ArchiveModel;
}

const DB_NAME = 'pf';
const DB_VERSION = 1;
const STORE_NAME = 'main';

// Migration lock key - stored in the pf database
const MIGRATION_LOCK_KEY = '_migration_lock';
const LOCK_TIMEOUT_MS = 60000; // 1 minute lock timeout

interface MigrationLock {
  timestamp: number;
  tabId: string;
}

interface LegacyMetaModel {
  vectorClock?: VectorClock;
  lastUpdate?: number;
  lastUpdateAction?: string;
}

const DEFAULT_ARCHIVE: ArchiveModel = {
  task: { ids: [], entities: {} },
  timeTracking: initialTimeTrackingState,
  lastTimeTrackingFlush: 0,
};

/**
 * Model keys in the legacy pf database
 */
const MODEL_KEYS: (keyof LegacyAppData)[] = [
  'task',
  'project',
  'tag',
  'simpleCounter',
  'note',
  'taskRepeatCfg',
  'reminders',
  'planner',
  'boards',
  'menuTree',
  'issueProvider',
  'metric',
  'timeTracking',
  'globalConfig',
  'pluginUserData',
  'pluginMetadata',
  'archiveYoung',
  'archiveOld',
];

/**
 * Centralized service for accessing the legacy `pf` IndexedDB database.
 * Consolidates all scattered openDB('pf') calls into a single service.
 *
 * Used for:
 * - Migration of legacy data to operation log
 * - Archive access (archiveYoung, archiveOld)
 * - Legacy reminder migration
 * - Disaster recovery
 */
@Injectable({
  providedIn: 'root',
})
export class LegacyPfDbService {
  private _tabId = Math.random().toString(36).substring(2, 15);

  /**
   * Opens the legacy pf database, creating it if it doesn't exist.
   */
  private async _openDb(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  /**
   * Loads data from the legacy pf database by key.
   */
  async load<T>(key: string): Promise<T | null> {
    try {
      const db = await this._openDb();
      const result = await db.get(STORE_NAME, key);
      db.close();
      return result ?? null;
    } catch (e) {
      Log.warn('LegacyPfDbService.load failed:', e);
      return null;
    }
  }

  /**
   * Saves data to the legacy pf database.
   */
  async save(key: string, data: unknown): Promise<void> {
    try {
      const db = await this._openDb();
      await db.put(STORE_NAME, data, key);
      db.close();
    } catch (e) {
      Log.warn('LegacyPfDbService.save failed:', e);
    }
  }

  /**
   * Checks if the legacy pf database exists and has any data.
   */
  async databaseExists(): Promise<boolean> {
    try {
      const databases = await indexedDB.databases();
      return databases.some((db) => db.name === DB_NAME);
    } catch {
      // indexedDB.databases() is not supported in all browsers
      // Fall back to trying to open the database
      try {
        const db = await this._openDb();
        const keys = await db.getAllKeys(STORE_NAME);
        db.close();
        return keys.length > 0;
      } catch {
        return false;
      }
    }
  }

  /**
   * Checks if the legacy database has usable entity data worth migrating.
   * Returns true if there are tasks, projects, or global config.
   */
  async hasUsableEntityData(): Promise<boolean> {
    try {
      const db = await this._openDb();

      // Check for meaningful data in key models
      const task = await db.get(STORE_NAME, 'task');
      const project = await db.get(STORE_NAME, 'project');
      const globalConfig = await db.get(STORE_NAME, 'globalConfig');

      db.close();

      // Has usable data if any of these have content
      // Note: Use !! to coerce to boolean, since null && ... returns null, not false
      const hasTaskData = !!(task && Array.isArray(task.ids) && task.ids.length > 0);
      const hasProjectData = !!(
        project &&
        Array.isArray(project.ids) &&
        project.ids.length > 0
      );
      const hasConfigData = !!(globalConfig && typeof globalConfig === 'object');

      return hasTaskData || hasProjectData || hasConfigData;
    } catch (e) {
      Log.warn('LegacyPfDbService.hasUsableEntityData failed:', e);
      return false;
    }
  }

  /**
   * Loads all entity data from the legacy pf database.
   * Returns null for missing keys.
   */
  async loadAllEntityData(): Promise<LegacyAppData> {
    try {
      const db = await this._openDb();
      const result: LegacyAppData = {};

      for (const key of MODEL_KEYS) {
        const data = await db.get(STORE_NAME, key);
        if (data !== undefined) {
          (result as Record<string, unknown>)[key] = data;
        }
      }

      db.close();
      return result;
    } catch (e) {
      Log.err('LegacyPfDbService.loadAllEntityData failed:', e);
      throw e;
    }
  }

  /**
   * Loads the META_MODEL from the legacy database.
   * Contains vectorClock, lastUpdate, lastUpdateAction.
   */
  async loadMetaModel(): Promise<LegacyMetaModel> {
    try {
      const db = await this._openDb();
      const result = await db.get(STORE_NAME, 'META_MODEL');
      db.close();
      return result || {};
    } catch (e) {
      Log.warn('LegacyPfDbService.loadMetaModel failed:', e);
      return {};
    }
  }

  /**
   * Saves the META_MODEL to the legacy database.
   */
  async saveMetaModel(meta: LegacyMetaModel): Promise<void> {
    try {
      const db = await this._openDb();
      const existing = (await db.get(STORE_NAME, 'META_MODEL')) || {};
      await db.put(STORE_NAME, { ...existing, ...meta }, 'META_MODEL');
      db.close();
    } catch (e) {
      Log.warn('LegacyPfDbService.saveMetaModel failed:', e);
    }
  }

  /**
   * Loads the CLIENT_ID from the legacy database.
   * Note: CLIENT_ID is stored separately from META_MODEL.
   */
  async loadClientId(): Promise<string | null> {
    try {
      const db = await this._openDb();
      const result = await db.get(STORE_NAME, 'CLIENT_ID');
      db.close();
      return result ?? null;
    } catch (e) {
      Log.warn('LegacyPfDbService.loadClientId failed:', e);
      return null;
    }
  }

  /**
   * Loads the archiveYoung from the legacy database.
   */
  async loadArchiveYoung(): Promise<ArchiveModel> {
    return this._loadArchive('archiveYoung');
  }

  /**
   * Loads the archiveOld from the legacy database.
   */
  async loadArchiveOld(): Promise<ArchiveModel> {
    return this._loadArchive('archiveOld');
  }

  /**
   * Saves an archive to the legacy database.
   */
  async saveArchive(
    key: 'archiveYoung' | 'archiveOld',
    archive: ArchiveModel,
  ): Promise<void> {
    await this.save(key, archive);
  }

  /**
   * Acquires a migration lock to prevent concurrent migrations from multiple tabs.
   * Returns true if lock was acquired, false if another tab holds the lock.
   */
  async acquireMigrationLock(): Promise<boolean> {
    try {
      const db = await this._openDb();

      // Check for existing lock
      const existingLock = (await db.get(STORE_NAME, MIGRATION_LOCK_KEY)) as
        | MigrationLock
        | undefined;

      if (existingLock) {
        // Check if lock is expired
        const isExpired = Date.now() - existingLock.timestamp > LOCK_TIMEOUT_MS;
        if (!isExpired && existingLock.tabId !== this._tabId) {
          db.close();
          return false;
        }
      }

      // Acquire lock
      const lock: MigrationLock = {
        timestamp: Date.now(),
        tabId: this._tabId,
      };
      await db.put(STORE_NAME, lock, MIGRATION_LOCK_KEY);
      db.close();

      Log.log('LegacyPfDbService: Migration lock acquired');
      return true;
    } catch (e) {
      Log.warn('LegacyPfDbService.acquireMigrationLock failed:', e);
      return false;
    }
  }

  /**
   * Releases the migration lock.
   */
  async releaseMigrationLock(): Promise<void> {
    try {
      const db = await this._openDb();
      const existingLock = (await db.get(STORE_NAME, MIGRATION_LOCK_KEY)) as
        | MigrationLock
        | undefined;

      // Only release if we own the lock
      if (existingLock && existingLock.tabId === this._tabId) {
        await db.delete(STORE_NAME, MIGRATION_LOCK_KEY);
        Log.log('LegacyPfDbService: Migration lock released');
      }

      db.close();
    } catch (e) {
      Log.warn('LegacyPfDbService.releaseMigrationLock failed:', e);
    }
  }

  /**
   * Clears all data from the legacy database.
   * Used when resetting the application.
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this._openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      await tx.store.clear();
      await tx.done;
      db.close();
      Log.log('LegacyPfDbService: Database cleared');
    } catch (e) {
      Log.warn('LegacyPfDbService.clearAll failed:', e);
    }
  }

  private async _loadArchive(key: 'archiveYoung' | 'archiveOld'): Promise<ArchiveModel> {
    try {
      const db = await this._openDb();
      const archive = await db.get(STORE_NAME, key);
      db.close();
      return archive || DEFAULT_ARCHIVE;
    } catch (e) {
      Log.warn(`LegacyPfDbService._loadArchive(${key}) failed:`, e);
      return DEFAULT_ARCHIVE;
    }
  }
}
