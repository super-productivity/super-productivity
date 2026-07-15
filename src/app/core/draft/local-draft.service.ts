import { inject, Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Log } from '../log';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { UserProfileStorageService } from '../../features/user-profile/user-profile-storage.service';
import { DEFAULT_PROFILE_ID } from '../../features/user-profile/user-profile.model';
import { isConnectionClosingError } from '../../op-log/persistence/op-log-errors.const';

export type LocalDraftEntityType = 'NOTE';

export interface LocalDraft {
  key: string;
  entityType: LocalDraftEntityType;
  entityId: string;
  profileId: string;
  content: string;
  /**
   * The persisted entity content at the time the edit session started. Lets
   * callers detect whether the entity changed (e.g. through sync) since the
   * draft was created.
   */
  baseContent: string;
  updatedAt: number;
}

/**
 * Distinguishes a failed draft read from "no draft exists" so callers can
 * avoid destructive actions (overwrite/clear) on a draft they could not read.
 */
export const DRAFT_LOAD_ERROR = Symbol('DRAFT_LOAD_ERROR');

const DB_NAME = 'sp-local-drafts';
const DB_STORE_NAME = 'drafts';
const DB_VERSION = 1;

interface DraftsDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: LocalDraft;
  };
}

/**
 * Device-local, profile-aware draft storage for crash-safe editing (e.g. the
 * fullscreen note editor). Drafts live in their own tiny IndexedDB, are keyed
 * by profile + entity type + entity id and are never synced. All methods fail
 * gracefully — a broken IndexedDB must never break editing itself.
 */
@Injectable({ providedIn: 'root' })
export class LocalDraftService {
  private readonly _userProfileService = inject(UserProfileService);
  private readonly _userProfileStorageService = inject(UserProfileStorageService);
  private _db: IDBPDatabase<DraftsDb> | undefined;
  private _initPromise: Promise<IDBPDatabase<DraftsDb>> | undefined;
  private _persistedProfileIdPromise: Promise<string> | undefined;

  async saveDraft({
    entityType,
    entityId,
    content,
    baseContent,
  }: {
    entityType: LocalDraftEntityType;
    entityId: string;
    content: string;
    baseContent: string;
  }): Promise<void> {
    try {
      const profileId = await this._activeProfileId();
      await this._withRetryOnClose((db) =>
        db.put(DB_STORE_NAME, {
          key: this._key(profileId, entityType, entityId),
          entityType,
          entityId,
          profileId,
          content,
          baseContent,
          updatedAt: Date.now(),
        }),
      );
    } catch (e) {
      Log.err('LocalDraftService: Failed to save draft', e);
    }
  }

  async loadDraft(
    entityType: LocalDraftEntityType,
    entityId: string,
  ): Promise<LocalDraft | undefined | typeof DRAFT_LOAD_ERROR> {
    try {
      const profileId = await this._activeProfileId();
      return await this._withRetryOnClose((db) =>
        db.get(DB_STORE_NAME, this._key(profileId, entityType, entityId)),
      );
    } catch (e) {
      Log.err('LocalDraftService: Failed to load draft', e);
      return DRAFT_LOAD_ERROR;
    }
  }

  async clearDraft(entityType: LocalDraftEntityType, entityId: string): Promise<void> {
    try {
      const profileId = await this._activeProfileId();
      await this._withRetryOnClose((db) =>
        db.delete(DB_STORE_NAME, this._key(profileId, entityType, entityId)),
      );
    } catch (e) {
      Log.err('LocalDraftService: Failed to clear draft', e);
    }
  }

  /**
   * Deletes every draft belonging to a profile. Called from the profile-deletion
   * lifecycle (UserProfileService.deleteProfile) so a deleted profile does not
   * leave its (never-synced) draft contents behind. Drafts of other profiles are
   * untouched — keys are `${profileId}:${entityType}:${entityId}` and the profile
   * id cannot contain a `:` separator, so the prefix match is unambiguous.
   */
  async deleteDraftsForProfile(profileId: string): Promise<void> {
    try {
      await this._withRetryOnClose(async (db) => {
        const prefix = `${profileId}:`;
        const keys = await db.getAllKeys(DB_STORE_NAME);
        await Promise.all(
          keys
            .filter((key) => key.startsWith(prefix))
            .map((key) => db.delete(DB_STORE_NAME, key)),
        );
      });
    } catch (e) {
      Log.err('LocalDraftService: Failed to delete drafts for profile', e);
    }
  }

  private async _activeProfileId(): Promise<string> {
    const active = this._userProfileService.activeProfile()?.id;
    if (active) {
      return active;
    }
    // The profile feature can be disabled, in which case UserProfileService is
    // never initialized and its in-memory signal stays null — but the last
    // active profile id is still persisted (localStorage). Fall back to it so
    // drafts stay keyed to the profile whose data is actually loaded, instead
    // of a wrong DEFAULT_PROFILE_ID. The persisted id is stable for the session
    // (switching profiles reloads the app), so it is read at most once.
    if (!this._persistedProfileIdPromise) {
      this._persistedProfileIdPromise = this._userProfileStorageService
        .loadProfileMetadata()
        .then((meta) => meta?.activeProfileId || DEFAULT_PROFILE_ID)
        .catch(() => DEFAULT_PROFILE_ID);
    }
    return this._persistedProfileIdPromise;
  }

  /**
   * Runs a draft DB operation, recovering once from an iOS/WebKit "connection
   * is closing" error (#6643): the OS can silently close the IndexedDB
   * connection when the app backgrounds, leaving the cached handle stale so
   * every later op fails for the rest of the session. Mirrors
   * ArchiveStoreService._withRetryOnClose — invalidate the cached handle and
   * retry once against a fresh connection.
   */
  private async _withRetryOnClose<T>(
    fn: (db: IDBPDatabase<DraftsDb>) => Promise<T>,
  ): Promise<T> {
    const db = await this._ensureDb();
    try {
      return await fn(db);
    } catch (e) {
      if (isConnectionClosingError(e)) {
        Log.warn('LocalDraftService: Connection closing error detected, re-opening', e);
        this._db = undefined;
        this._initPromise = undefined;
        return await fn(await this._ensureDb());
      }
      throw e;
    }
  }

  private _key(
    profileId: string,
    entityType: LocalDraftEntityType,
    entityId: string,
  ): string {
    return `${profileId}:${entityType}:${entityId}`;
  }

  private async _ensureDb(): Promise<IDBPDatabase<DraftsDb>> {
    if (this._db) {
      return this._db;
    }
    if (!this._initPromise) {
      this._initPromise = openDB<DraftsDb>(DB_NAME, DB_VERSION, {
        upgrade: (database) => {
          if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
            database.createObjectStore(DB_STORE_NAME, { keyPath: 'key' });
          }
        },
        // The browser can terminate the connection at any time (e.g. storage
        // pressure); reset so the next operation re-opens it.
        terminated: () => {
          this._db = undefined;
          this._initPromise = undefined;
        },
      }).then(
        (opened) => {
          // A newer tab is upgrading this DB (future schema bump). Close now so
          // this connection does not block the upgrade; the next op reopens
          // transparently via _ensureDb(). (The `close`/`terminated` case above
          // already resets the cached handle.)
          opened.addEventListener('versionchange', () => {
            opened.close();
            this._db = undefined;
            this._initPromise = undefined;
          });
          this._db = opened;
          return opened;
        },
        (e) => {
          // Don't cache the failure — the next operation should retry. Failures
          // stay console-only by design: a snackbar for every debounced draft
          // write would be noisier than the (device-local) draft loss.
          this._initPromise = undefined;
          throw e;
        },
      );
    }
    return this._initPromise;
  }
}
