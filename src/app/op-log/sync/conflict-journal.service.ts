/**
 * SPAP-13 — Conflict Journal service.
 *
 * Owns a NEW, standalone IndexedDB database (`SUP_CONFLICT_JOURNAL`) that is
 * completely separate from the op-log `SUP_OPS` DB, so journaling can never
 * touch op-log schema/versioning or risk its data.
 *
 * OBSERVE-ONLY: `record()` is called from the LWW resolution hook purely to log
 * what happened; it NEVER throws back into resolution (any DB failure is logged
 * and swallowed) and never influences which op was picked.
 *
 * The never-throw contract covers EVERY public method, not just `record()`:
 * `list()` is awaited (via the summary banner) inside
 * `autoResolveConflictsLWW`'s notification step — i.e. AFTER ops were applied —
 * so a journal read failure must degrade to "no entries", never fail the sync.
 * Reads fall back to empty results, status writes are swallowed; only the
 * badge/review surface degrades.
 *
 * Journal entries are DEVICE-LOCAL and are NEVER uploaded to the sync server.
 */

import { Injectable, signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { OpLog } from '../../core/log';
import {
  CONFLICT_JOURNAL_DB_NAME,
  CONFLICT_JOURNAL_DB_VERSION,
  CONFLICT_JOURNAL_INDEX_RESOLVED_AT,
  CONFLICT_JOURNAL_INDEX_STATUS,
  CONFLICT_JOURNAL_STORE,
  ConflictJournalEntry,
  ConflictJournalStatus,
  ConflictJournalView,
  JOURNAL_MAX_ENTRIES,
  JOURNAL_PRUNE_SLACK,
  JOURNAL_RETENTION_DAYS,
} from './conflict-journal.model';

interface ConflictJournalDB extends DBSchema {
  [CONFLICT_JOURNAL_STORE]: {
    key: string;
    value: ConflictJournalEntry;
    indexes: {
      [CONFLICT_JOURNAL_INDEX_STATUS]: ConflictJournalStatus;
      [CONFLICT_JOURNAL_INDEX_RESOLVED_AT]: number;
    };
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class ConflictJournalService {
  private _db?: IDBPDatabase<ConflictJournalDB>;
  private _initPromise?: Promise<IDBPDatabase<ConflictJournalDB>>;

  private readonly _unreviewedCount = signal(0);
  /** Number of entries still awaiting review (status === 'unreviewed'). */
  readonly unreviewedCount = this._unreviewedCount.asReadonly();

  private readonly _revision = signal(0);
  /**
   * Monotonic counter bumped on EVERY journal mutation (record / status change /
   * prune / clearAll), regardless of whether `unreviewedCount` changed. Consumers
   * that must react to composition changes at an equal total (e.g. one remote-win
   * reviewed while one local-win is recorded) key off this instead of the count.
   */
  readonly revision = this._revision.asReadonly();

  private _openDb(): Promise<IDBPDatabase<ConflictJournalDB>> {
    return openDB<ConflictJournalDB>(
      CONFLICT_JOURNAL_DB_NAME,
      CONFLICT_JOURNAL_DB_VERSION,
      {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains(CONFLICT_JOURNAL_STORE)) {
            const store = db.createObjectStore(CONFLICT_JOURNAL_STORE, {
              keyPath: 'id',
            });
            store.createIndex(CONFLICT_JOURNAL_INDEX_STATUS, 'status');
            store.createIndex(CONFLICT_JOURNAL_INDEX_RESOLVED_AT, 'resolvedAt');
          }
        },
        // Abnormal closure (browser force-closes the connection, e.g. storage
        // pressure): without this the memoized `_db` handle stays dead and every
        // later call fails for the rest of the session. Dropping the handles
        // lets the next call reopen.
        terminated: () => this._resetDbHandles(),
      },
    );
  }

  private _resetDbHandles(): void {
    this._db = undefined;
    this._initPromise = undefined;
  }

  private async _ensureDb(): Promise<IDBPDatabase<ConflictJournalDB>> {
    if (this._db) {
      return this._db;
    }
    if (!this._initPromise) {
      this._initPromise = this._openDb().then(
        (db) => {
          this._db = db;
          return db;
        },
        (err) => {
          // Don't poison the service: a transient open failure must not leave a
          // permanently-rejected `_initPromise` cached (every later call would
          // then reject). Clear it so the next `_ensureDb` retries the open.
          this._initPromise = undefined;
          throw err;
        },
      );
    }
    return this._initPromise;
  }

  /**
   * Records one conflict-journal entry. OBSERVE-ONLY contract: on ANY failure it
   * logs and returns normally — it must never throw back into LWW resolution.
   */
  async record(entry: ConflictJournalEntry): Promise<void> {
    try {
      const db = await this._ensureDb();
      await db.put(CONFLICT_JOURNAL_STORE, entry);
      // SPAP-36: retention was only enforced at app start, so a long-lived
      // session could grow the store unboundedly. count() is cheap; the O(n)
      // prune runs only when the store exceeds the soft cap, i.e. amortized
      // once every JOURNAL_PRUNE_SLACK records.
      const count = await db.count(CONFLICT_JOURNAL_STORE);
      if (count > JOURNAL_MAX_ENTRIES + JOURNAL_PRUNE_SLACK) {
        await this._prune(db, Date.now());
      }
      await this._refreshUnreviewedCount(db);
    } catch (err) {
      OpLog.err('ConflictJournalService: failed to record entry (ignored)', err);
    }
  }

  /**
   * Lists entries newest-first.
   * - `unreviewed`: only entries still awaiting review.
   * - `history`: everything.
   *
   * Never throws: the banner path awaits this inside conflict resolution's
   * notification step, so a transient DB failure degrades to an empty list
   * (badge/banner miss a beat) instead of failing an otherwise-completed sync.
   */
  async list(view: ConflictJournalView): Promise<ConflictJournalEntry[]> {
    try {
      const db = await this._ensureDb();
      const ascending = await db.getAllFromIndex(
        CONFLICT_JOURNAL_STORE,
        CONFLICT_JOURNAL_INDEX_RESOLVED_AT,
      );
      const newestFirst = ascending.reverse();
      if (view === 'unreviewed') {
        return newestFirst.filter((entry) => entry.status === 'unreviewed');
      }
      return newestFirst;
    } catch (err) {
      OpLog.err('ConflictJournalService: list failed (returning empty)', err);
      return [];
    }
  }

  /** Never throws — a failed lookup reads as "no such entry". */
  async getEntry(id: string): Promise<ConflictJournalEntry | undefined> {
    try {
      const db = await this._ensureDb();
      return await db.get(CONFLICT_JOURNAL_STORE, id);
    } catch (err) {
      OpLog.err('ConflictJournalService: getEntry failed (ignored)', err);
      return undefined;
    }
  }

  /** User confirmed the auto-resolution. */
  async markKept(id: string): Promise<void> {
    await this._setStatus(id, 'kept');
  }

  /** User wants the discarded side instead (application is a later subtask). */
  async markFlipped(id: string): Promise<void> {
    await this._setStatus(id, 'flipped');
  }

  /**
   * Never throws (same contract as `record()`): a failed status write leaves
   * the entry unreviewed — the user can simply Keep/Flip it again — which beats
   * an unhandled rejection in the review page's action handlers.
   */
  private async _setStatus(id: string, status: ConflictJournalStatus): Promise<void> {
    try {
      const db = await this._ensureDb();
      const entry = await db.get(CONFLICT_JOURNAL_STORE, id);
      if (!entry) {
        return;
      }
      await db.put(CONFLICT_JOURNAL_STORE, { ...entry, status });
      await this._refreshUnreviewedCount(db);
    } catch (err) {
      OpLog.err(`ConflictJournalService: failed to mark entry ${status} (ignored)`, err);
    }
  }

  /**
   * Prunes on app-start to whichever bound binds first: entries older than
   * {@link JOURNAL_RETENTION_DAYS} days, OR everything beyond the newest
   * {@link JOURNAL_MAX_ENTRIES}. kept/flipped entries prune exactly like any
   * other. Returns the number of entries deleted.
   */
  async pruneOnStart(now: number = Date.now()): Promise<number> {
    // Observe-only, like record(): pruneOnStart is the sole app-start seeder of
    // the badge count (its _refreshUnreviewedCount), and its main.ts caller
    // relies on it swallowing its own errors. A transient IndexedDB failure must
    // return 0, not reject — and _ensureDb already resets its poisoned promise.
    try {
      const db = await this._ensureDb();
      const deleted = await this._prune(db, now);
      await this._refreshUnreviewedCount(db);
      return deleted;
    } catch (err) {
      OpLog.err('ConflictJournalService: pruneOnStart failed (ignored)', err);
      return 0;
    }
  }

  /**
   * Prune core shared by `pruneOnStart` and `record()`'s opportunistic prune:
   * age bound first, then the count bound on the survivors. Returns the number
   * of entries deleted. Callers own error handling and the count refresh.
   */
  private async _prune(
    db: IDBPDatabase<ConflictJournalDB>,
    now: number,
  ): Promise<number> {
    // Ascending by resolvedAt (oldest first).
    const ascending = await db.getAllFromIndex(
      CONFLICT_JOURNAL_STORE,
      CONFLICT_JOURNAL_INDEX_RESOLVED_AT,
    );

    const retentionWindowMs = JOURNAL_RETENTION_DAYS * DAY_MS;
    const cutoff = now - retentionWindowMs;
    const idsToDelete = new Set<string>();

    for (const entry of ascending) {
      if (entry.resolvedAt < cutoff) {
        idsToDelete.add(entry.id);
      }
    }

    // Count bound applies to the survivors of the age prune; drop the oldest
    // overflow so only the newest JOURNAL_MAX_ENTRIES remain.
    const survivors = ascending.filter((entry) => !idsToDelete.has(entry.id));
    const overflow = survivors.length - JOURNAL_MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      idsToDelete.add(survivors[i].id);
    }

    if (idsToDelete.size > 0) {
      const tx = db.transaction(CONFLICT_JOURNAL_STORE, 'readwrite');
      // Await the delete requests AND tx.done together. If the transaction aborts
      // while requests are still pending, both the delete aggregate and tx.done
      // reject; awaiting them separately (delete first, then tx.done) leaves
      // tx.done's rejection without a handler once the delete aggregate rejects,
      // so it escapes as a global unhandled rejection. Putting tx.done inside the
      // same Promise.all attaches a handler to it, so no rejection escapes.
      const deletes = Array.from(idsToDelete, (id) => tx.store.delete(id));
      await Promise.all([...deletes, tx.done]);
    }

    return idsToDelete.size;
  }

  /**
   * Deletes EVERY journal entry. Called on user-profile transitions: profiles
   * are "complete, isolated instances", and the journal is a device-local
   * side-store the profile switch's backup/import cycle does not otherwise
   * touch — without this, the next profile would see the previous profile's
   * entity titles/values and could Flip against the wrong dataset.
   *
   * Same swallow-errors contract as `record()`: the caller (profile switch)
   * must not fail after the dataset has already been replaced.
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this._ensureDb();
      await db.clear(CONFLICT_JOURNAL_STORE);
      await this._refreshUnreviewedCount(db);
    } catch (err) {
      OpLog.err('ConflictJournalService: clearAll failed (ignored)', err);
    }
  }

  private async _refreshUnreviewedCount(
    db: IDBPDatabase<ConflictJournalDB>,
  ): Promise<void> {
    // Advance `revision` FIRST, so a committed mutation always notifies consumers
    // even if the count query below throws (callers swallow that error). The
    // banner keys off `revision` and re-reads the journal itself, so it still
    // reflects the committed change; `unreviewedCount` catches up once the query
    // succeeds. Fires on every mutation even when the count is unchanged.
    this._revision.update((r) => r + 1);
    const count = await db.countFromIndex(
      CONFLICT_JOURNAL_STORE,
      CONFLICT_JOURNAL_INDEX_STATUS,
      IDBKeyRange.only('unreviewed'),
    );
    this._unreviewedCount.set(count);
  }
}
