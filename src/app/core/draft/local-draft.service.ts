import { Injectable } from '@angular/core';
import { Log } from '../log';
import { LS_LOCAL_DRAFT_PREFIX } from '../persistence/storage-keys.const';

/**
 * Single source of truth for the entity types drafts are keyed by. The legacy
 * profile migration below tells an already-migrated key from a legacy one by
 * its first segment, so the union must stay derived from this list — a second
 * type declared only in the union would have its new-format drafts read as
 * legacy and deleted.
 */
export const LOCAL_DRAFT_ENTITY_TYPES = ['NOTE'] as const;

export type LocalDraftEntityType = (typeof LOCAL_DRAFT_ENTITY_TYPES)[number];

export interface LocalDraft {
  content: string;
  /**
   * The persisted entity content at the time the edit session started. Lets
   * callers detect whether the entity changed (e.g. through sync) since the
   * draft was created.
   */
  baseContent: string;
  updatedAt: number;
}

/** What an existing draft means for the entity it belongs to. */
export type DraftOpenAction = 'IGNORE' | 'RESTORE' | 'PROMPT';

/**
 * Decides what to do with an existing draft when its entity is opened.
 */
export const getDraftOpenAction = (
  draft: LocalDraft,
  entityContent: string,
): DraftOpenAction => {
  // The entity already holds the draft text: there is nothing left to recover.
  if (draft.content === entityContent) {
    return 'IGNORE';
  }
  // The entity is exactly where this edit session started: the edit never
  // landed. Crash recovery.
  if (draft.baseContent === entityContent) {
    return 'RESTORE';
  }
  // Unsaved text, and the entity changed underneath it (e.g. through sync).
  // Only the user can say which one wins.
  return 'PROMPT';
};

const DRAFT_RETENTION_DAYS = 14;
export const DRAFT_RETENTION_MS = DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Drafts whose content + baseContent exceed this are not checkpointed.
 * localStorage's quota (~5 MB) is shared with UI state, so one huge note must
 * not be able to fill it and break those writes. A note this large goes without
 * crash-safety; editing itself is unaffected.
 */
export const DRAFT_MAX_CONTENT_LENGTH = 500_000;

const LEGACY_PROFILE_ENABLED_KEY = 'sp_user_profiles_enabled';
const LEGACY_PROFILE_META_KEY = 'sp_profile_meta';
const LEGACY_PROFILE_DATA_PREFIX = 'sp_profile_data_';
const LEGACY_DEFAULT_PROFILE_ID = 'default';

const isStoredDraft = (v: unknown): v is LocalDraft =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as LocalDraft).content === 'string' &&
  typeof (v as LocalDraft).baseContent === 'string' &&
  typeof (v as LocalDraft).updatedAt === 'number';

/**
 * Device-local draft storage for crash-safe editing (e.g. the fullscreen note
 * editor). Drafts live in localStorage, keyed by entity type + entity id, and
 * are never synced or included in backups.
 *
 * localStorage is deliberate: it is synchronous, so writes, reads and deletes
 * happen in program order with nothing in flight — no stale connection, no
 * hung request, no delete racing a debounced write. The entire lifecycle
 * reduces to "write while editing, remove in the handler that consumed the
 * draft". All methods fail gracefully; broken storage must never break editing.
 */
@Injectable({ providedIn: 'root' })
export class LocalDraftService {
  saveDraft({
    entityType,
    entityId,
    content,
    baseContent,
  }: {
    entityType: LocalDraftEntityType;
    entityId: string;
    content: string;
    baseContent: string;
  }): void {
    try {
      const key = this._key(entityType, entityId);
      if (content.length + baseContent.length > DRAFT_MAX_CONTENT_LENGTH) {
        // Also drop a smaller draft stored earlier in the session: once
        // checkpointing stops, keeping it would offer long-outdated text on
        // the next open.
        localStorage.removeItem(key);
        return;
      }
      const draft: LocalDraft = { content, baseContent, updatedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(draft));
    } catch (e) {
      // Quota exceeded is the realistic failure. A draft is best-effort, so
      // editing goes on without crash-safety rather than surfacing an error.
      Log.err('LocalDraftService: Failed to save draft', e);
    }
  }

  loadDraft(entityType: LocalDraftEntityType, entityId: string): LocalDraft | undefined {
    try {
      const raw = localStorage.getItem(this._key(entityType, entityId));
      if (!raw) {
        return undefined;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Deliberately logged WITHOUT the error: V8 SyntaxErrors quote the
        // raw input, which is user content and must never reach the
        // exportable log. The startup sweep removes such entries; the next
        // checkpoint overwrites them.
        Log.err('LocalDraftService: Draft unparseable');
        return undefined;
      }
      return isStoredDraft(parsed) ? parsed : undefined;
    } catch (e) {
      // Unreadable storage: nothing can be offered back.
      Log.err('LocalDraftService: Failed to load draft', e);
      return undefined;
    }
  }

  clearDraft(entityType: LocalDraftEntityType, entityId: string): void {
    try {
      localStorage.removeItem(this._key(entityType, entityId));
    } catch (e) {
      Log.err('LocalDraftService: Failed to clear draft', e);
    }
  }

  /** Deletes all drafts after the complete dataset is replaced. */
  deleteAllDrafts(): void {
    try {
      this._draftKeys().forEach((key) => localStorage.removeItem(key));
    } catch (e) {
      Log.err('LocalDraftService: Failed to delete drafts', e);
    }
  }

  /**
   * Removes drafts past the retention window (and unparseable leftovers) on
   * app start, wired via APP_INITIALIZER in main.ts. Drafts are normally
   * removed by the handler that consumed them; only crash leftovers whose note
   * is never reopened reach this sweep, so age is the only policy needed.
   */
  pruneOnStart(now: number = Date.now()): void {
    try {
      this._migrateLegacyUserProfileDrafts();
      const cutoff = now - DRAFT_RETENTION_MS;
      for (const key of this._draftKeys()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(localStorage.getItem(key) ?? '');
        } catch (e) {
          parsed = undefined;
        }
        if (!isStoredDraft(parsed) || parsed.updatedAt < cutoff) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      Log.err('LocalDraftService: Failed to prune stale drafts', e);
    }
  }

  private _key(entityType: LocalDraftEntityType, entityId: string): string {
    return `${LS_LOCAL_DRAFT_PREFIX}${entityType}:${entityId}`;
  }

  private _draftKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_LOCAL_DRAFT_PREFIX)) {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * Keeps drafts for the dataset that was active when User Profiles was
   * removed, then deletes the feature's device-local metadata and snapshots.
   */
  private _migrateLegacyUserProfileDrafts(): void {
    let activeProfileId = LEGACY_DEFAULT_PROFILE_ID;
    const rawMetadata = localStorage.getItem(LEGACY_PROFILE_META_KEY);
    if (rawMetadata) {
      try {
        const metadata: unknown = JSON.parse(rawMetadata);
        if (
          typeof metadata === 'object' &&
          metadata !== null &&
          typeof (metadata as { activeProfileId?: unknown }).activeProfileId === 'string'
        ) {
          activeProfileId = (metadata as { activeProfileId: string }).activeProfileId;
        }
      } catch {
        // Invalid legacy metadata cannot identify a non-default active profile.
      }
    }

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PROFILE_DATA_PREFIX)) {
        localStorage.removeItem(key);
      }
    }

    const activeDraftPrefix = `${LS_LOCAL_DRAFT_PREFIX}${activeProfileId}:`;
    let didMigrateActiveDrafts = true;
    for (const legacyKey of this._draftKeys()) {
      if (
        LOCAL_DRAFT_ENTITY_TYPES.some((entityType) =>
          legacyKey.startsWith(`${LS_LOCAL_DRAFT_PREFIX}${entityType}:`),
        )
      ) {
        continue;
      }

      if (legacyKey.startsWith(activeDraftPrefix)) {
        const draft = localStorage.getItem(legacyKey);
        const newKey = `${LS_LOCAL_DRAFT_PREFIX}${legacyKey.slice(activeDraftPrefix.length)}`;
        if (draft !== null && localStorage.getItem(newKey) === null) {
          try {
            localStorage.setItem(newKey, draft);
          } catch (e) {
            didMigrateActiveDrafts = false;
            Log.err('LocalDraftService: Failed to migrate legacy draft', e);
            continue;
          }
        }
      }

      localStorage.removeItem(legacyKey);
    }

    localStorage.removeItem(LEGACY_PROFILE_ENABLED_KEY);
    if (didMigrateActiveDrafts) {
      localStorage.removeItem(LEGACY_PROFILE_META_KEY);
    }
  }
}
