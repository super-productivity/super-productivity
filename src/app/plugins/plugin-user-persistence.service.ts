import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  PluginUserData,
  MAX_PLUGIN_DATA_SIZE,
  MIN_PLUGIN_PERSIST_INTERVAL_MS,
} from './plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './store/plugin.actions';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { decodeFromPersist, encodeForPersist } from './util/plugin-data-codec';
import { isPluginIdMatch } from './util/plugin-persistence-key.util';
import { PluginLog } from '../core/log';

/**
 * Service for persisting plugin user data using NgRx actions.
 * Handles data that plugins store and retrieve via persistDataSynced/loadSyncedData.
 * Includes rate limiting and size validation to prevent abuse.
 *
 * The `entityId` argument is the composed storage key: it equals the bare
 * `pluginId` for legacy single-blob entries, and `pluginId:key` for keyed
 * entries (composed at the bridge transport boundary, see
 * `util/plugin-persistence-key.util.ts`). All internal Maps and dispatched
 * ops key by `entityId`, so distinct keys are independently rate-limited,
 * coalesced, and LWW-resolved.
 *
 * Data is transparently gzip-compressed at the persistence boundary (see
 * `plugin-data-codec.ts`). Plugins only see their own raw strings; the
 * compressed form lives in NgRx state, IndexedDB, the op-log, and on the
 * sync server, shrinking per-op payloads ~4–5× for typical JSON.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginUserPersistenceService {
  private _store = inject(Store);

  /**
   * Track the last *committed* persist time per entity id, for rate limiting.
   */
  private _lastPersistTime = new Map<string, number>();

  /**
   * Data that arrived inside the rate-limit window and is waiting to be
   * committed. Coalesced — only the most recent value per entity id is kept.
   * Holds *uncompressed* input (compression happens at commit time).
   */
  private _pendingData = new Map<string, string>();

  /**
   * Active flush timers for coalesced writes, keyed by entity id.
   */
  private _flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * The latest uncompressed input for an entity whose `_commit` has started
   * but whose async compression has not yet dispatched. A read in this
   * window must see the latest write (read-your-writes), so we hold the
   * raw input here until the dispatch lands.
   */
  private _committing = new Map<string, string>();

  /**
   * Per-entity commit chain. Compression is async (`CompressionStream`),
   * so two `_commit` calls in quick succession could finish out of order
   * and dispatch a stale write last. Chaining serializes
   * compress-then-dispatch per entity while leaving different entities
   * concurrent.
   */
  private _commitChain = new Map<string, Promise<void>>();

  /**
   * Per-entity generation counter. Bumped by `_cancelPending` so any
   * in-flight `_commit` whose compression started under an older
   * generation aborts before dispatching. Without this, a
   * `removePluginUserData` issued during an async compress would be
   * silently undone by the resurrecting upsert that lands afterwards.
   */
  private _commitGeneration = new Map<string, number>();

  /**
   * Persist user data for a specific entity (called by plugin via
   * persistDataSynced(data, key?), with the bridge composing pluginId+key
   * into `entityId` before reaching here).
   *
   * Rate limiting *coalesces* rather than rejects: a call that arrives inside
   * the MIN_PLUGIN_PERSIST_INTERVAL_MS window is not dropped — its data is
   * held and committed when the window opens (latest write wins). This still
   * caps the op-log/sync rate at one write per interval *per entity id*,
   * but never discards the caller's most recent data. Dropping it silently
   * lost edits — e.g. a plugin's final save on teardown landing just after a
   * periodic save.
   *
   * Returns a Promise that resolves once the data has been compressed and
   * dispatched (or queued for a future commit). The size-cap check is
   * synchronous: callers that hit the limit get a thrown Error, not a
   * rejected Promise, so the existing `try { persist(...) } catch` pattern
   * keeps working.
   *
   * Read-modify-write contract: a `loadPluginUserData` whose result is then
   * mutated and passed back via `persistPluginUserData` must not span a
   * `removePluginUserData` for the same plugin. The remove invalidates any
   * in-flight commit (via the generation counter), but a fresh `persist`
   * issued from a stale `load` result *after* the remove is a new write and
   * will resurrect the entry — the codec cannot distinguish "user wants
   * this back" from "stale read". Callers performing RMW after a delete
   * must `loadPluginUserData` again first.
   *
   * @throws Error if data exceeds MAX_PLUGIN_DATA_SIZE
   */
  persistPluginUserData(entityId: string, data: string): Promise<void> {
    // Validate data size — applies whether the write commits now or later.
    // Cap is on the uncompressed user input, so a plugin can't bypass by
    // sending pre-compressed bytes. The cap is per-entity (i.e. per
    // composite id); aggregate caps across a plugin's keys are out of
    // scope — see docs/plans/2026-05-23-stage-a-keyed-plugin-persistence.md.
    const dataSize = new Blob([data]).size;
    if (dataSize > MAX_PLUGIN_DATA_SIZE) {
      throw new Error(
        `Plugin data exceeds maximum size of ${MAX_PLUGIN_DATA_SIZE / 1024}KB. ` +
          `Current size: ${Math.round(dataSize / 1024)}KB`,
      );
    }

    // Rate limiting: check if enough time has passed since the last commit.
    const now = Date.now();
    const lastPersist = this._lastPersistTime.get(entityId) || 0;
    const timeSinceLastPersist = now - lastPersist;

    if (timeSinceLastPersist < MIN_PLUGIN_PERSIST_INTERVAL_MS) {
      // Inside the window: coalesce. Hold the latest data and flush it once
      // the window opens, so no write is discarded.
      this._pendingData.set(entityId, data);
      if (!this._flushTimers.has(entityId)) {
        const delay = MIN_PLUGIN_PERSIST_INTERVAL_MS - timeSinceLastPersist;
        this._flushTimers.set(
          entityId,
          setTimeout(() => {
            void this._flushPendingData(entityId);
          }, delay),
        );
      }
      return Promise.resolve();
    }

    return this._commit(entityId, data, now);
  }

  /**
   * Commit a coalesced write once its rate-limit window has elapsed.
   */
  private async _flushPendingData(entityId: string): Promise<void> {
    this._flushTimers.delete(entityId);
    const data = this._pendingData.get(entityId);
    if (data === undefined) {
      return;
    }
    this._pendingData.delete(entityId);
    await this._commit(entityId, data, Date.now());
  }

  /**
   * Compress and dispatch. Serialized per entity via `_commitChain` to
   * preserve write order even if compression times vary across calls.
   */
  private _commit(entityId: string, data: string, at: number): Promise<void> {
    this._lastPersistTime.set(entityId, at);
    this._committing.set(entityId, data);
    // Capture the generation at the moment we schedule. If a remove bumps
    // it before this commit's compression finishes, _encodeAndDispatch
    // bails and the upsert is suppressed — preventing post-delete
    // resurrection.
    const myGeneration = this._commitGeneration.get(entityId) ?? 0;

    const prev = this._commitChain.get(entityId) ?? Promise.resolve();
    // Swallow prior errors so the chain doesn't poison subsequent writes.
    // The original failed call has already seen and surfaced its own error.
    const next: Promise<void> = prev
      .catch(() => undefined)
      .then(() => this._encodeAndDispatch(entityId, data, myGeneration));
    this._commitChain.set(entityId, next);

    next.finally(() => {
      if (this._committing.get(entityId) === data) {
        this._committing.delete(entityId);
      }
      if (this._commitChain.get(entityId) === next) {
        this._commitChain.delete(entityId);
      }
    });

    return next;
  }

  private async _encodeAndDispatch(
    entityId: string,
    data: string,
    generation: number,
  ): Promise<void> {
    const encoded = await encodeForPersist(data);
    if ((this._commitGeneration.get(entityId) ?? 0) !== generation) {
      // A removePluginUserData / clearAllPluginUserData ran between
      // schedule and dispatch. Dropping the upsert preserves the delete.
      return;
    }
    const pluginUserData: PluginUserData = { id: entityId, data: encoded };
    this._store.dispatch(upsertPluginUserData({ pluginUserData }));
  }

  /**
   * Load user data for a specific entity (called by plugin via
   * loadSyncedData(key?), with the bridge composing pluginId+key into
   * `entityId` before reaching here).
   *
   * Returns a coalesced-but-not-yet-committed write if one is pending, so a
   * plugin's read-modify-write cycle always sees its own latest data. Same
   * applies to a commit that has started compression but not yet dispatched.
   *
   * Otherwise reads from NgRx state and decompresses transparently.
   */
  async loadPluginUserData(entityId: string): Promise<string | null> {
    const pending = this._pendingData.get(entityId);
    if (pending !== undefined) {
      return pending;
    }
    const committing = this._committing.get(entityId);
    if (committing !== undefined) {
      return committing;
    }
    const currentState = await firstValueFrom(
      this._store.select(selectPluginUserDataFeatureState),
    );
    const pluginData = currentState.find((item) => item.id === entityId);
    if (!pluginData?.data) {
      return null;
    }
    try {
      return await decodeFromPersist(pluginData.data);
    } catch (err) {
      // Don't log `err` directly — gzip/atob messages can contain partial
      // payload bytes from user content. Surface only the error class.
      PluginLog.err('PluginUserPersistenceService: failed to decode stored data', {
        entityId,
        errName: (err as Error)?.name,
      });
      return null;
    }
  }

  /**
   * Remove all user data belonging to a plugin (legacy entry + every keyed
   * entry `pluginId:*`). The pluginId is treated as a prefix here — distinct
   * from `persist`/`load`, which key on a single composite entity id.
   *
   * Mechanism (Stage A Phase 3, Option A): the service reads current state,
   * filters by `isPluginIdMatch`, and dispatches one `deletePluginUserData`
   * per match. Each dispatch produces one Delete op in the op-log; remote
   * replicas replay the full sweep. A reducer-only prefix match would emit
   * only one op (for `pluginId` alone) and leak keyed entries on remote
   * devices — see the Phase 3 plan.
   *
   * Yields the event loop after the dispatch loop — CLAUDE.md sync rule 6:
   * rapid in-loop dispatches against an `array`-pattern entity can lose
   * state without a microtask break.
   */
  async removePluginUserData(pluginId: string): Promise<void> {
    // Cancel any in-flight commits whose entity id matches the plugin.
    // These may not yet exist in NgRx state (they're mid-compress), so we
    // walk the internal Maps as well, not just the state.
    this._cancelPendingForPlugin(pluginId);

    const currentState = await firstValueFrom(
      this._store.select(selectPluginUserDataFeatureState),
    );
    const matches = currentState.filter((item) => isPluginIdMatch(item.id, pluginId));
    for (const item of matches) {
      this._store.dispatch(deletePluginUserData({ pluginId: item.id }));
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  /**
   * Drop any pending coalesced write (and its timer) for a single entity
   * id, so it cannot resurrect data that is being removed. Also bumps the
   * commit generation so an *in-flight* `_commit` (already past its
   * rate-limit check, currently awaiting compression) detects the cancel
   * and skips its dispatch — the upsert would otherwise undo this delete.
   */
  private _cancelPending(entityId: string): void {
    const timer = this._flushTimers.get(entityId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._flushTimers.delete(entityId);
    }
    this._pendingData.delete(entityId);
    this._committing.delete(entityId);
    this._commitGeneration.set(entityId, (this._commitGeneration.get(entityId) ?? 0) + 1);
  }

  /**
   * Cancel pendings for every entity id currently tracked under the given
   * plugin (legacy + any keyed entries). We have to walk the in-flight
   * Maps directly because an entity whose first persist is mid-compress
   * is not yet in NgRx state.
   */
  private _cancelPendingForPlugin(pluginId: string): void {
    const candidateIds = new Set<string>();
    for (const id of this._lastPersistTime.keys()) candidateIds.add(id);
    for (const id of this._pendingData.keys()) candidateIds.add(id);
    for (const id of this._flushTimers.keys()) candidateIds.add(id);
    for (const id of this._committing.keys()) candidateIds.add(id);
    for (const id of this._commitChain.keys()) candidateIds.add(id);
    for (const id of this._commitGeneration.keys()) candidateIds.add(id);
    for (const id of candidateIds) {
      if (isPluginIdMatch(id, pluginId)) {
        this._cancelPending(id);
      }
    }
  }

  /**
   * Clear all plugin user data (removes each one individually to create operations)
   *
   * Yields the event loop after the dispatch loop — CLAUDE.md sync rule 6:
   * rapid in-loop dispatches against an `array`-pattern entity can lose
   * state without a microtask break.
   */
  async clearAllPluginUserData(): Promise<void> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginUserDataFeatureState),
    );
    for (const item of currentState) {
      this._cancelPending(item.id);
      this._store.dispatch(deletePluginUserData({ pluginId: item.id }));
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}
