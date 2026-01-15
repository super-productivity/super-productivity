import { inject, Injectable, Injector, signal } from '@angular/core';
import { DEFAULT_PROFILE_ID, ProfileMetadata, UserProfile } from './user-profile.model';
import { UserProfileStorageService } from './user-profile-storage.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { Log } from '../../core/log';
import { nanoid } from 'nanoid';
import { SnackService } from '../../core/snack/snack.service';
import { Store } from '@ngrx/store';
import { updateGlobalConfigSection } from '../config/store/global-config.actions';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import type { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';

/**
 * Core service for user profile management
 * Handles profile CRUD operations and switching
 */
@Injectable({
  providedIn: 'root',
})
export class UserProfileService {
  private readonly _storageService = inject(UserProfileStorageService);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _backupService = inject(BackupService);
  private readonly _opLogStore = inject(OperationLogStoreService);
  private readonly _snackService = inject(SnackService);
  private readonly _injector = inject(Injector);
  private readonly _store = inject(Store);

  // Lazy-loaded to avoid circular dependency:
  // UserProfileService → SyncWrapperService → DataInitService → UserProfileService
  private _syncWrapperServiceCache: SyncWrapperService | null = null;
  private get _syncWrapperService(): SyncWrapperService {
    if (!this._syncWrapperServiceCache) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SyncWrapperService: SWS } = require('../../imex/sync/sync-wrapper.service');
      this._syncWrapperServiceCache = this._injector.get(SWS);
    }
    return this._syncWrapperServiceCache!;
  }

  readonly isInitialized = signal(false);

  // Current profile metadata
  private readonly _metadata = signal<ProfileMetadata | null>(null);
  readonly metadata = this._metadata.asReadonly();

  // Currently active profile
  readonly activeProfile = signal<UserProfile | null>(null);

  // All available profiles
  readonly profiles = signal<UserProfile[]>([]);

  /**
   * Initialize the profile system
   * Called during app startup (only if feature is enabled)
   */
  async initialize(): Promise<void> {
    Log.log('UserProfileService: Initializing profile system');

    try {
      // Load existing profile metadata
      let metadata = await this._storageService.loadProfileMetadata();

      // Migration happens when user first switches profiles or explicitly enables feature
      if (!metadata) {
        Log.log(
          'UserProfileService: No profile metadata found, creating default (no migration)',
        );
        metadata = this._storageService.createDefaultProfileMetadata();
        await this._storageService.saveProfileMetadata(metadata);
      }
      // Profile data is only loaded when switching between profiles.
      // On normal startup, the app loads from its regular database.
      // The profile storage is just a backup copy for switching, leveraging existing import/export functions.

      // Set metadata and update signals
      this._metadata.set(metadata);
      this.profiles.set(metadata.profiles);

      // Set active profile
      const activeProfile = metadata.profiles.find(
        (p) => p.id === metadata.activeProfileId,
      );
      if (activeProfile) {
        this.activeProfile.set(activeProfile);
        Log.log(
          `UserProfileService: Active profile set to "${activeProfile.name}" (${activeProfile.id})`,
        );
      } else {
        Log.warn(
          'UserProfileService: Active profile not found in metadata, using first profile',
        );
        this.activeProfile.set(metadata.profiles[0]);
      }

      this.isInitialized.set(true);
    } catch (error) {
      Log.err('UserProfileService: Failed to initialize', error);
      // create a default profile and continue
      const defaultMetadata = this._storageService.createDefaultProfileMetadata();
      this._metadata.set(defaultMetadata);
      this.profiles.set(defaultMetadata.profiles);
      this.activeProfile.set(defaultMetadata.profiles[0]);
      this.isInitialized.set(true);
    }
  }

  /**
   * Create a new profile
   */
  async createProfile(name: string): Promise<UserProfile> {
    const metadata = this._metadata();
    if (!metadata) {
      throw new Error('Profile system not initialized');
    }

    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new Error('Profile name cannot be empty');
    }

    if (metadata.profiles.some((p) => p.name === trimmedName)) {
      throw new Error('A profile with this name already exists');
    }

    const newProfile: UserProfile = {
      id: nanoid(),
      name: trimmedName,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    // Add to metadata
    const updatedProfiles = [...metadata.profiles, newProfile];
    const updatedMetadata: ProfileMetadata = {
      ...metadata,
      profiles: updatedProfiles,
    };

    // Save metadata
    await this._storageService.saveProfileMetadata(updatedMetadata);

    // Create empty profile data (will be populated on first switch)
    // Update signals
    this._metadata.set(updatedMetadata);
    this.profiles.set(updatedProfiles);

    Log.log(`UserProfileService: Created new profile "${name}" (${newProfile.id})`);
    this._snackService.open({
      type: 'SUCCESS',
      msg: `Profile "${name}" created successfully`,
    });

    return newProfile;
  }

  /**
   * Rename an existing profile
   */
  async renameProfile(profileId: string, newName: string): Promise<void> {
    const metadata = this._metadata();
    if (!metadata) {
      throw new Error('Profile system not initialized');
    }

    const trimmedName = newName?.trim();
    if (!trimmedName) {
      throw new Error('Profile name cannot be empty');
    }

    // Check for duplicate names (excluding current profile)
    if (metadata.profiles.some((p) => p.id !== profileId && p.name === trimmedName)) {
      throw new Error('A profile with this name already exists');
    }

    // Find and update profile
    const updatedProfiles = metadata.profiles.map((p) =>
      p.id === profileId ? { ...p, name: trimmedName } : p,
    );

    const updatedMetadata: ProfileMetadata = {
      ...metadata,
      profiles: updatedProfiles,
    };

    // Save metadata
    await this._storageService.saveProfileMetadata(updatedMetadata);

    // Update signals
    this._metadata.set(updatedMetadata);
    this.profiles.set(updatedProfiles);

    // Update active profile if it's the one being renamed
    if (this.activeProfile()?.id === profileId) {
      const updated = updatedProfiles.find((p) => p.id === profileId);
      if (updated) {
        this.activeProfile.set(updated);
      }
    }

    Log.log(`UserProfileService: Renamed profile ${profileId} to "${newName}"`);
    this._snackService.open({
      type: 'SUCCESS',
      msg: `Profile renamed to "${newName}"`,
    });
  }

  /**
   * Delete a profile
   */
  async deleteProfile(profileId: string): Promise<void> {
    const metadata = this._metadata();
    if (!metadata) {
      throw new Error('Profile system not initialized');
    }

    // Prevent deleting the last profile
    if (metadata.profiles.length === 1) {
      throw new Error('Cannot delete the last profile');
    }

    // Prevent deleting the active profile
    if (metadata.activeProfileId === profileId) {
      throw new Error(
        'Cannot delete the active profile. Switch to another profile first.',
      );
    }

    // Remove profile from metadata
    const updatedProfiles = metadata.profiles.filter((p) => p.id !== profileId);
    const updatedMetadata: ProfileMetadata = {
      ...metadata,
      profiles: updatedProfiles,
    };

    // Delete profile data
    await this._storageService.deleteProfileData(profileId);

    // Save updated metadata
    await this._storageService.saveProfileMetadata(updatedMetadata);

    // Update signals
    this._metadata.set(updatedMetadata);
    this.profiles.set(updatedProfiles);

    Log.log(`UserProfileService: Deleted profile ${profileId}`);
    this._snackService.open({
      type: 'SUCCESS',
      msg: 'Profile deleted successfully',
    });
  }

  /**
   * Switch to a different profile
   * This will:
   * 1. Trigger sync for current profile
   * 2. Save current profile data
   * 3. Load target profile data
   * 4. Reload the application
   */
  async switchProfile(targetProfileId: string): Promise<void> {
    const metadata = this._metadata();
    if (!metadata) {
      throw new Error('Profile system not initialized');
    }

    const currentProfile = this.activeProfile();
    if (!currentProfile) {
      throw new Error('No active profile');
    }

    // Check if trying to switch to same profile
    if (currentProfile.id === targetProfileId) {
      Log.log('UserProfileService: Already on target profile, no switch needed');
      return;
    }

    const targetProfile = metadata.profiles.find((p) => p.id === targetProfileId);
    if (!targetProfile) {
      throw new Error('Target profile not found');
    }

    Log.log(
      `UserProfileService: Switching from "${currentProfile.name}" to "${targetProfile.name}"`,
    );

    try {
      // Step 1: Trigger sync for current profile
      Log.log('UserProfileService: Triggering sync before profile switch');
      try {
        const syncProvider = this._providerManager.getActiveProvider();
        if (syncProvider) {
          await this._syncWrapperService.sync();
          Log.log('UserProfileService: Sync completed successfully');
        } else {
          Log.log('UserProfileService: No active sync provider, skipping sync');
        }
      } catch (syncError) {
        Log.warn(
          'UserProfileService: Sync failed, continuing with profile switch',
          syncError,
        );
        // Continue with profile switch even if sync fails
      }

      // Step 2: Save current profile data
      Log.log('UserProfileService: Saving current profile data');
      const currentData = await this._backupService.loadCompleteBackup(true);
      Log.log('UserProfileService: Current profile data structure:', {
        hasData: !!currentData,
        hasDataData: !!currentData?.data,
        hasGlobalConfig: !!currentData?.data?.globalConfig,
        taskCount: Object.keys(currentData?.data?.task || {}).length,
        projectCount: Object.keys(currentData?.data?.project || {}).length,
        crossModelVersion: currentData?.crossModelVersion,
      });
      await this._storageService.saveProfileData(currentProfile.id, currentData);

      // Step 3: Load target profile data
      Log.log('UserProfileService: Loading target profile data');
      const targetData = await this._storageService.loadProfileData(targetProfileId);
      Log.log('UserProfileService: Target profile data structure:', {
        hasData: !!targetData,
        hasDataData: !!targetData?.data,
        hasGlobalConfig: !!targetData?.data?.globalConfig,
        taskCount: Object.keys(targetData?.data?.task || {}).length,
        projectCount: Object.keys(targetData?.data?.project || {}).length,
        crossModelVersion: targetData?.crossModelVersion,
      });

      // Step 4: Update metadata with new active profile
      const updatedMetadata: ProfileMetadata = {
        ...metadata,
        activeProfileId: targetProfileId,
        profiles: metadata.profiles.map((p) =>
          p.id === targetProfileId ? { ...p, lastUsedAt: Date.now() } : p,
        ),
      };
      await this._storageService.saveProfileMetadata(updatedMetadata);

      // Step 5: Update signals BEFORE importing/clearing data
      // This ensures metadata is consistent if something fails
      this._metadata.set(updatedMetadata);
      this.profiles.set(updatedMetadata.profiles);
      this.activeProfile.set(targetProfile);

      // Step 6: Show success message BEFORE import (import will reload)
      this._snackService.open({
        type: 'SUCCESS',
        msg: `Switching to profile "${targetProfile.name}"...`,
      });

      // Step 7: Handle target profile data
      if (targetData) {
        // Profile has existing data - import it
        // importCompleteBackup will reload the window automatically
        Log.log('UserProfileService: Importing target profile data (will reload app)');
        await this._backupService.importCompleteBackup(
          targetData,
          false, // isSkipLegacyWarnings
          false, // isSkipReload - let it reload automatically
        );
        // App will reload here, no code after this will execute
      } else {
        // Profile is empty (newly created) - clear the database and set up with profiles enabled
        Log.log(
          'UserProfileService: Target profile has no data, clearing database for fresh start',
        );
        // Clear all operations to start fresh
        await this._opLogStore.clearAllOperations();

        // IMPORTANT: Enable user profiles in the new profile's config
        // Otherwise the user won't see the profile button to switch back
        // We dispatch to NgRx to update the config
        Log.log('UserProfileService: Enabling user profiles in new profile config');
        const defaultConfig = DEFAULT_GLOBAL_CONFIG;
        this._store.dispatch(
          updateGlobalConfigSection({
            sectionKey: 'appFeatures',
            sectionCfg: {
              ...defaultConfig.appFeatures,
              isEnableUserProfiles: true,
            } as any, // Type cast needed for section-specific config
          }),
        );

        Log.log(
          'UserProfileService: Database cleared and profiles enabled, reloading app',
        );

        // Reload manually for empty profile case
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    } catch (error) {
      Log.err('UserProfileService: Failed to switch profile', error);
      this._snackService.open({
        type: 'ERROR',
        msg: 'Failed to switch profile. Please try again.',
      });
      throw error;
    }
  }

  /**
   * Export a profile as JSON file
   */
  async exportProfile(profileId: string): Promise<void> {
    const profile = this.profiles().find((p) => p.id === profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    // Load profile data
    const data = await this._storageService.loadProfileData(profileId);
    if (!data) {
      throw new Error('Profile data not found');
    }

    // Download as JSON
    const { download } = await import('../../util/download');
    const filename = `profile-${profile.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    const result = await download(filename, JSON.stringify(data));

    if (!result.wasCanceled) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: `Profile "${profile.name}" exported successfully`,
      });
    }
  }

  /**
   * Migrate existing user data to default profile
   * Called when no profile metadata exists but user has data
   */
  private async _migrateExistingDataToDefaultProfile(): Promise<ProfileMetadata> {
    Log.log('UserProfileService: Migrating existing data to default profile');

    // Create default metadata
    const metadata = this._storageService.createDefaultProfileMetadata();

    // Check if there's existing user data in the database
    try {
      const existingData = await this._backupService.loadCompleteBackup(true);

      // Only save if there's actual data (check if any model has data)
      const hasData = existingData && Object.keys(existingData.data || {}).length > 0;

      if (hasData) {
        Log.log('UserProfileService: Found existing data, saving to default profile');
        await this._storageService.saveProfileData(DEFAULT_PROFILE_ID, existingData);
      } else {
        Log.log(
          'UserProfileService: No existing data found, creating empty default profile',
        );
      }
    } catch (error) {
      Log.warn(
        'UserProfileService: Could not load existing data during migration',
        error,
      );
      // Continue with empty default profile
    }

    // Save metadata
    await this._storageService.saveProfileMetadata(metadata);

    return metadata;
  }

  /**
   * migrate data only when user explicitly enables the feature
   * This is called from GlobalConfigEffects when isEnableUserProfiles changes to true
   */
  async migrateOnFirstEnable(): Promise<void> {
    Log.log('UserProfileService: Migrating data on first enable');

    try {
      // Check if we already have profile metadata
      const existingMetadata = await this._storageService.loadProfileMetadata();

      if (existingMetadata) {
        // Already migrated, just initialize
        Log.log('UserProfileService: Metadata already exists, skipping migration');
        await this.initialize();
        return;
      }

      // Perform migration
      const metadata = await this._migrateExistingDataToDefaultProfile();

      // Update signals
      this._metadata.set(metadata);
      this.profiles.set(metadata.profiles);
      this.activeProfile.set(metadata.profiles[0]);
      this.isInitialized.set(true);

      Log.log('UserProfileService: Migration completed successfully');
    } catch (error) {
      Log.err('UserProfileService: Failed to migrate on first enable', error);
      throw error;
    }
  }

  /**
   * Check if there are multiple profiles (more than just the default)
   */
  hasMultipleProfiles(): boolean {
    const profiles = this.profiles();
    return profiles.length > 1;
  }

  /**
   * Get information about profile storage for user guidance
   */
  getProfileStorageInfo(): { location: string; profiles: UserProfile[] } {
    const profiles = this.profiles();
    const activeProfile = this.activeProfile();

    return {
      location: 'Profile data is stored in the application data folder',
      profiles: profiles.filter((p) => p.id !== activeProfile?.id),
    };
  }
}
