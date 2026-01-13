import { Injectable } from '@angular/core';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  ProfileMetadata,
  UserProfile,
} from './user-profile.model';
import { Log } from '../../core/log';
import { CompleteBackup } from '../../op-log/sync-exports';

/**
 * Service for managing profile storage
 * uses unified localStorage for all platforms (Electron, Android, Web)
 * Simplifies code and removes Electron IPC complexity
 */
@Injectable({
  providedIn: 'root',
})
export class UserProfileStorageService {
  /**
   * Load profile metadata from storage
   */
  async loadProfileMetadata(): Promise<ProfileMetadata | null> {
    try {
      return await this._loadProfileMetadataWeb();
    } catch (error) {
      Log.err('UserProfileStorageService: Failed to load profile metadata', error);
      return null;
    }
  }

  /**
   * Save profile metadata to storage
   */
  async saveProfileMetadata(metadata: ProfileMetadata): Promise<void> {
    try {
      await this._saveProfileMetadataWeb(metadata);
    } catch (error) {
      Log.err('UserProfileStorageService: Failed to save profile metadata', error);
      throw error;
    }
  }

  /**
   * Load profile data (complete backup) for a specific profile
   */
  async loadProfileData(profileId: string): Promise<CompleteBackup<any> | null> {
    try {
      return await this._loadProfileDataWeb(profileId);
    } catch (error) {
      Log.err(
        `UserProfileStorageService: Failed to load profile data for ${profileId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Save profile data (complete backup) for a specific profile
   */
  async saveProfileData(profileId: string, data: CompleteBackup<any>): Promise<void> {
    try {
      await this._saveProfileDataWeb(profileId, data);
    } catch (error) {
      Log.err(
        `UserProfileStorageService: Failed to save profile data for ${profileId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Delete profile data from storage
   */
  async deleteProfileData(profileId: string): Promise<void> {
    try {
      await this._deleteProfileDataWeb(profileId);
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

  private async _loadProfileMetadataWeb(): Promise<ProfileMetadata | null> {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const key = `sp_profile_meta`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  private async _saveProfileMetadataWeb(metadata: ProfileMetadata): Promise<void> {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const key = `sp_profile_meta`;
    localStorage.setItem(key, JSON.stringify(metadata));
  }

  private async _loadProfileDataWeb(
    profileId: string,
  ): Promise<CompleteBackup<any> | null> {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const key = `sp_profile_data_${profileId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  private async _saveProfileDataWeb(
    profileId: string,
    data: CompleteBackup<any>,
  ): Promise<void> {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const key = `sp_profile_data_${profileId}`;
    localStorage.setItem(key, JSON.stringify(data));
  }

  private async _deleteProfileDataWeb(profileId: string): Promise<void> {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const key = `sp_profile_data_${profileId}`;
    localStorage.removeItem(key);
  }
}
