import { Injectable } from '@angular/core';
import { openDB } from 'idb';
import { hasMeaningfulStateData } from '../../op-log/validation/has-meaningful-state-data.util';
import { Log } from '../log';

/**
 * The IndexedDB database of Super Productivity v12 and older. v13–v16 copied it
 * into `pf` on first start; that migration was removed in v17.0.0 (04728267e),
 * so a profile that jumps from v12 or older straight to v17+ boots empty while
 * its data is still here (#7345).
 *
 * Transitional: the group it helps (v12-or-older profiles that never opened
 * v17+) only shrinks. Remove this service and its startup hook after 2027-10.
 */
const DB_NAME = 'SUP';
const STORE_NAME = 'SUP_STORE';
const LAST_SYNC_MODEL_CHANGE_KEY = 'LOCAL_LAST_SYNC_MODEL_CHANGE';
/** The v13–v16 migration wrote this in place of the timestamp once it had copied the data. */
const MIGRATED_MARKER = 42;

/** The model keys v11/v12 stored, each under its own key in `SUP_STORE`. */
const MODEL_KEYS = [
  'globalConfig',
  'reminders',
  'planner',
  'boards',
  'project',
  'issueProvider',
  'tag',
  'simpleCounter',
  'note',
  'metric',
  'improvement',
  'obstruction',
  'task',
  'taskArchive',
  'taskRepeatCfg',
] as const;

const EMPTY_ENTITY_STATE = { ids: [], entities: {} };

@Injectable({
  providedIn: 'root',
})
export class LegacySupDbService {
  /**
   * The data of a v12-or-older profile that was never migrated, shaped like a
   * pre-v14 backup so the regular import path (`migrateLegacyBackup`) can take
   * it; null if there is none. Never creates the database and never writes.
   */
  async loadUnmigratedData(): Promise<Record<string, unknown> | null> {
    if (!(await this._databaseExists())) {
      return null;
    }
    // No version: opens the existing database as it is, no upgrade.
    const db = await openDB(DB_NAME);
    try {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        return null;
      }
      const lastSyncModelChange = await db.get(STORE_NAME, LAST_SYNC_MODEL_CHANGE_KEY);
      if (Number(lastSyncModelChange) === MIGRATED_MARKER) {
        return null;
      }
      // v12 loaded a missing record as its default; mirror that for the slices
      // the import requires, and keep `taskArchive` as the legacy-shape marker.
      const data: Record<string, unknown> = {
        task: EMPTY_ENTITY_STATE,
        project: EMPTY_ENTITY_STATE,
        taskArchive: EMPTY_ENTITY_STATE,
      };
      for (const key of MODEL_KEYS) {
        const value = await db.get(STORE_NAME, key);
        if (value !== undefined && value !== null) {
          data[key] = value;
        }
      }
      const hasArchivedTasks = hasMeaningfulStateData({ task: data.taskArchive });
      return hasMeaningfulStateData(data) || hasArchivedTasks ? data : null;
    } finally {
      db.close();
    }
  }

  private async _databaseExists(): Promise<boolean> {
    try {
      const databases = await indexedDB.databases();
      return databases.some((db) => db.name === DB_NAME);
    } catch (e) {
      // Without databases() we cannot check without creating it; skip.
      Log.warn('LegacySupDbService: indexedDB.databases() unavailable', e);
      return false;
    }
  }
}
