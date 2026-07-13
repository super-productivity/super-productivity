import { inject, Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Log } from '../log';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { DEFAULT_PROFILE_ID } from '../../features/user-profile/user-profile.model';

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
  private _db: IDBPDatabase<DraftsDb> | undefined;
  private _initPromise: Promise<IDBPDatabase<DraftsDb>> | undefined;

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
      const profileId = this._activeProfileId();
      const db = await this._ensureDb();
      await db.put(DB_STORE_NAME, {
        key: this._key(profileId, entityType, entityId),
        entityType,
        entityId,
        profileId,
        content,
        baseContent,
        updatedAt: Date.now(),
      });
    } catch (e) {
      Log.err('LocalDraftService: Failed to save draft', e);
    }
  }

  async loadDraft(
    entityType: LocalDraftEntityType,
    entityId: string,
  ): Promise<LocalDraft | undefined | typeof DRAFT_LOAD_ERROR> {
    try {
      const db = await this._ensureDb();
      return await db.get(
        DB_STORE_NAME,
        this._key(this._activeProfileId(), entityType, entityId),
      );
    } catch (e) {
      Log.err('LocalDraftService: Failed to load draft', e);
      return DRAFT_LOAD_ERROR;
    }
  }

  async clearDraft(entityType: LocalDraftEntityType, entityId: string): Promise<void> {
    try {
      const db = await this._ensureDb();
      await db.delete(
        DB_STORE_NAME,
        this._key(this._activeProfileId(), entityType, entityId),
      );
    } catch (e) {
      Log.err('LocalDraftService: Failed to clear draft', e);
    }
  }

  private _activeProfileId(): string {
    return this._userProfileService.activeProfile()?.id || DEFAULT_PROFILE_ID;
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
