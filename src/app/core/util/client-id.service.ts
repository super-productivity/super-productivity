import { Injectable } from '@angular/core';
import { IDBPDatabase, openDB } from 'idb';
import { OpLog } from '../log';
import { generateClientId, isValidClientIdFormat } from './generate-client-id';
import {
  DB_NAME as SUP_OPS_DB_NAME,
  DB_VERSION as SUP_OPS_DB_VERSION,
  SINGLETON_KEY,
  STORE_NAMES,
} from '../../op-log/persistence/db-keys.const';
import { runDbUpgrade } from '../../op-log/persistence/db-upgrade';

// Legacy 'pf' database — a read-only, one-time migration source for the
// clientId. Never written or deleted by this service. See issue #7732.
const PF_DB_NAME = 'pf';
const PF_DB_STORE_NAME = 'main';
const PF_DB_VERSION = 1;
/**
 * Key ClientIdService has always operated on in `pf`. On an op-log-era device
 * this is the live identity.
 */
const PF_CLIENT_ID_KEY = '__client_id_';
/**
 * The original PFAPI key. Read only as a fallback to seed a legacy profile
 * that never received a `__client_id_` entry.
 */
const PF_LEGACY_CLIENT_ID_KEY = 'CLIENT_ID';

/**
 * Service for managing the sync client ID — the device's stable sync identity.
 *
 * The clientId lives in the `SUP_OPS` database (`client_id` store, schema v6).
 * Storing it there lets destructive flows (clean-slate, backup-restore) rotate
 * it atomically inside runDestructiveStateReplacement's transaction, instead of
 * a hand-rolled cross-database two-phase commit (issue #7732).
 *
 * The legacy `pf` database is a read-only, one-time migration source: the first
 * read on a device whose clientId still lives only in `pf` copies it forward
 * into `SUP_OPS`. The clientId is non-regenerable (it keys the vector clock),
 * so the resolver propagates IndexedDB read errors rather than risk minting a
 * fresh id over a transient failure.
 */
@Injectable({
  providedIn: 'root',
})
export class ClientIdService {
  private _supOpsDb: IDBPDatabase | null = null;
  private _supOpsDbPromise: Promise<IDBPDatabase> | null = null;
  private _cachedClientId: string | null = null;

  /**
   * Loads the client ID. Never throws — returns null on absence OR on a
   * transient IndexedDB read failure. Callers (hydrator, sync readers) treat
   * a null clientId as a tolerable, retryable condition.
   */
  async loadClientId(): Promise<string | null> {
    if (this._cachedClientId) {
      return this._cachedClientId;
    }
    try {
      const id = await this._resolve();
      if (id) {
        this._cachedClientId = id;
      }
      return id;
    } catch {
      // Read failure — never throw, never generate. Returning null lets the
      // caller retry on a later launch without orphaning the real clientId.
      return null;
    }
  }

  /**
   * Returns the existing client ID, or generates and persists a new one if
   * none exists. The preferred entry point for callers that always need an ID.
   *
   * Propagates IndexedDB read failures: if a read throws, this throws too — it
   * does NOT generate. Generating on a transient failure would mint a brand
   * new clientId that orphans the device's real, history-bearing identity (the
   * non-regenerable loss issue #7732 exists to prevent). Generation happens
   * only after reads succeed and confirm no id exists anywhere.
   */
  async getOrGenerateClientId(): Promise<string> {
    if (this._cachedClientId) {
      return this._cachedClientId;
    }
    // PROPAGATES read failures — does not swallow, does not generate on error.
    const existing = await this._resolve();
    if (existing) {
      this._cachedClientId = existing;
      return existing;
    }
    // Reads succeeded and confirmed empty everywhere — safe to generate.
    const id = await this._putClientIdIfAbsent(generateClientId);
    this._cachedClientId = id;
    OpLog.normal('ClientIdService.getOrGenerateClientId() generated');
    return id;
  }

  /**
   * Persists an existing client ID (legacy-migration genesis seed).
   *
   * Writes UNCONDITIONALLY (not a CAS) into SUP_OPS: it carries the
   * authoritative legacy PFAPI `CLIENT_ID` value that OperationLogMigration's
   * genesis op is built from, and must win over any `__client_id_`-derived
   * migration copy so the genesis op stays consistent with its vectorClock.
   */
  async persistClientId(clientId: string): Promise<void> {
    if (!isValidClientIdFormat(clientId)) {
      // The clientId value is sensitive (it keys the vector clock) and log
      // history is user-exportable — never interpolate it into the message.
      throw new Error('Cannot persist invalid clientId');
    }
    const db = await this._getSupOpsDb();
    await db.put(STORE_NAMES.CLIENT_ID, clientId, SINGLETON_KEY);
    this._cachedClientId = clientId;
    OpLog.normal('ClientIdService.persistClientId() persisted');
  }

  /**
   * Invalidates the cached client ID so the next read re-resolves from
   * IndexedDB. A documented production method (not just a test helper):
   * runDestructiveStateReplacement calls it after rotating the clientId.
   */
  clearCache(): void {
    this._cachedClientId = null;
  }

  /**
   * Resolves "what is this device's clientId", migrating it forward from the
   * legacy `pf` database if needed.
   *
   * Read failures propagate (the caller decides whether to swallow). Only a
   * failed copy-forward is swallowed — the `pf` id is still valid and a later
   * launch retries the copy.
   */
  private async _resolve(): Promise<string | null> {
    const fromOps = await this._readSupOps(); // throws on IndexedDB read error
    if (fromOps) {
      return fromOps;
    }
    const fromPf = await this._readPf(); // throws on IndexedDB read error
    if (!fromPf) {
      // Both reads succeeded -> confirmed: no id stored anywhere.
      return null;
    }
    try {
      return await this._putClientIdIfAbsent(() => fromPf);
    } catch {
      // Copy-forward to SUP_OPS failed (quota, closed connection). The `pf` id
      // is valid — return it and let a later launch retry the copy. Worst case
      // is a redundant copy, never a lost identity.
      return fromPf;
    }
  }

  /**
   * Reads the clientId from `SUP_OPS.client_id`. An invalid format is treated
   * as absent (returns null — never throws on bad format; see issue #6197).
   * IndexedDB *errors* propagate.
   */
  private async _readSupOps(): Promise<string | null> {
    const db = await this._getSupOpsDb();
    const raw = await db.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY);
    return isValidClientIdFormat(raw) ? raw : null;
  }

  /**
   * Reads the clientId from the legacy `pf` database, read-only, per-call.
   *
   * Routed directly through `openDB` rather than LegacyPfDbService because that
   * service's load() swallows IndexedDB errors and returns null — which makes
   * "key absent" indistinguishable from "read failed". This service needs that
   * distinction: a read failure must propagate (it must never generate over a
   * transient failure).
   *
   * `__client_id_` (the live identity on op-log-era devices) wins over the
   * original PFAPI `CLIENT_ID` key. IndexedDB *errors* propagate.
   */
  private async _readPf(): Promise<string | null> {
    const db = await openDB(PF_DB_NAME, PF_DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(PF_DB_STORE_NAME)) {
          database.createObjectStore(PF_DB_STORE_NAME);
        }
      },
    });
    try {
      const live = await db.get(PF_DB_STORE_NAME, PF_CLIENT_ID_KEY);
      if (isValidClientIdFormat(live)) {
        return live;
      }
      const legacy = await db.get(PF_DB_STORE_NAME, PF_LEGACY_CLIENT_ID_KEY);
      return isValidClientIdFormat(legacy) ? legacy : null;
    } finally {
      db.close();
    }
  }

  /**
   * Establish-if-absent writer: writes `factory()` into SUP_OPS.client_id only
   * if no valid id is already there, in a single transaction.
   *
   * MULTI-TAB / ROTATION GUARD: the in-tx re-check is load-bearing. IndexedDB
   * serializes same-store transactions across same-origin connections, so an
   * id that committed first (another tab's generate, or a destructive
   * rotation) is observed by `raced` and WINS — this helper never clobbers it.
   *
   * persistClientId and runDestructiveStateReplacement are the *unconditional*
   * writers (they know the exact intended value); this is the conditional one.
   */
  private async _putClientIdIfAbsent(factory: () => string): Promise<string> {
    const db = await this._getSupOpsDb();
    const tx = db.transaction(STORE_NAMES.CLIENT_ID, 'readwrite');
    const raced = await tx.store.get(SINGLETON_KEY);
    // A valid id already there (another tab, a rotation) wins — never clobbered.
    const resolved = isValidClientIdFormat(raced) ? raced : factory();
    if (resolved !== raced) {
      await tx.store.put(resolved, SINGLETON_KEY);
    }
    await tx.done;
    return resolved;
  }

  /**
   * Opens (and caches) an independent connection to the `SUP_OPS` database.
   *
   * Independent — not delegated to OperationLogStoreService — because that
   * service injects CLIENT_ID_PROVIDER (-> this service), so delegating back
   * would form a DI cycle. Two same-origin connections to one store are safe:
   * IndexedDB serializes transactions across them. Collapsing onto a single
   * shared connection (by breaking that DI cycle) is tracked in #7735.
   *
   * Concurrent first callers share one in-flight open via `_supOpsDbPromise`
   * (mirrors OperationLogStoreService._ensureInit): without it each racing
   * caller would open — and leak — its own connection. The in-flight promise
   * is cleared on open failure so the next call retries, and in the
   * close/versionchange handlers so a stale handle is never re-handed-out.
   */
  private async _getSupOpsDb(): Promise<IDBPDatabase> {
    if (this._supOpsDb) {
      return this._supOpsDb;
    }
    if (!this._supOpsDbPromise) {
      this._supOpsDbPromise = this._openSupOpsDb().catch((e) => {
        // A failed open must be retryable — clear so the next call reopens.
        this._supOpsDbPromise = null;
        throw e;
      });
    }
    return this._supOpsDbPromise;
  }

  private async _openSupOpsDb(): Promise<IDBPDatabase> {
    const db = await openDB(SUP_OPS_DB_NAME, SUP_OPS_DB_VERSION, {
      upgrade: (database, oldVersion, _newVersion, transaction) => {
        runDbUpgrade(database, oldVersion, transaction);
      },
    });
    // Browser closed the connection — drop both handles, reopen on next access.
    db.addEventListener('close', () => {
      this._supOpsDb = null;
      this._supOpsDbPromise = null;
    });
    // Don't block a future (v7) upgrade opened by another connection/tab.
    db.addEventListener('versionchange', () => {
      db.close();
      this._supOpsDb = null;
      this._supOpsDbPromise = null;
    });
    this._supOpsDb = db;
    return db;
  }
}
