import { inject, Injectable } from '@angular/core';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  ProfileMetadata,
  UserProfile,
} from './user-profile.model';
import { Log } from '../../core/log';
import { CompleteBackup } from '../../op-log/sync-exports';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';

const PROFILE_META_KEY = 'sp_profile_meta';
const PROFILE_DATA_PREFIX = 'sp_profile_data_';

/**
 * Service for managing profile storage.
 * Metadata (small JSON) stays in localStorage for fast synchronous startup access.
 * Profile data (large CompleteBackup blobs) is stored in IndexedDB to avoid
 * localStorage's 5-10 MB quota limit.
 */
@Injectable({
  providedIn: 'root',
})
export class UserProfileStorageService {
  private readonly _opLogStore = inject(OperationLogStoreService);
  private _migrationPromise: Promise<void> | null = null;

  /**
   * Load profile metadata from localStorage
   */
  async loadProfileMetadata(): Promise<ProfileMetadata | null> {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      const data = localStorage.getItem(PROFILE_META_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      Log.err('UserProfileStorageService: Failed to load profile metadata', error);
      return null;
    }
  }

  /**
   * Save profile metadata to localStorage
   */
  async saveProfileMetadata(metadata: ProfileMetadata): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(PROFILE_META_KEY, JSON.stringify(metadata));
    } catch (error) {
      Log.err('UserProfileStorageService: Failed to save profile metadata', error);
      throw error;
    }
  }

  /**
   * Load profile data (complete backup) for a specific profile from IndexedDB.
   * On first call, migrates any existing localStorage profile data to IndexedDB.
   */
  async loadProfileData(profileId: string): Promise<CompleteBackup<any> | null> {
    try {
      await this._migrateFromLocalStorageIfNeeded();
      return await this._opLogStore.loadProfileData(profileId);
    } catch (error) {
      Log.err(
        `UserProfileStorageService: Failed to load profile data for ${profileId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Save profile data (complete backup) for a specific profile to IndexedDB
   */
  async saveProfileData(profileId: string, data: CompleteBackup<any>): Promise<void> {
    try {
      await this._migrateFromLocalStorageIfNeeded();
      await this._opLogStore.saveProfileData(profileId, data);
    } catch (error) {
      Log.err(
        `UserProfileStorageService: Failed to save profile data for ${profileId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Delete profile data from IndexedDB
   */
  async deleteProfileData(profileId: string): Promise<void> {
    try {
      await this._migrateFromLocalStorageIfNeeded();
      await this._opLogStore.deleteProfileData(profileId);
    } catch (error) {
      Log.err(
        `UserProfileStorageService: Failed to delete profile data for ${profileId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create initial profile metadata with default profile
   */
  createDefaultProfileMetadata(): ProfileMetadata {
    const defaultProfile: UserProfile = {
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    return {
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: [defaultProfile],
      version: 1,
    };
  }

  /**
   * One-time migration: moves profile data from localStorage to IndexedDB,
   * then removes the localStorage entries.
   */
  private _migrateFromLocalStorageIfNeeded(): Promise<void> {
    if (typeof localStorage === 'undefined') {
      return Promise.resolve();
    }
    if (!this._migrationPromise) {
      this._migrationPromise = this._doMigration();
    }
    return this._migrationPromise;
  }

  private async _doMigration(): Promise<void> {
    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PROFILE_DATA_PREFIX)) {
        keysToMigrate.push(key);
      }
    }

    if (keysToMigrate.length === 0) {
      return;
    }

    Log.log(
      `UserProfileStorageService: Migrating ${keysToMigrate.length} profile(s) from localStorage to IndexedDB`,
    );

    for (const key of keysToMigrate) {
      const profileId = key.substring(PROFILE_DATA_PREFIX.length);
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const data: CompleteBackup<any> = JSON.parse(raw);
          await this._opLogStore.saveProfileData(profileId, data);
          localStorage.removeItem(key);
          Log.log(
            `UserProfileStorageService: Migrated profile "${profileId}" to IndexedDB`,
          );
        }
      } catch (error) {
        Log.err(
          `UserProfileStorageService: Failed to migrate profile "${profileId}"`,
          error,
        );
      }
    }
  }
}
