import { Injectable } from '@angular/core';
import { OpLog } from '../../core/log';

/**
 * Tracks the highest op-log seq whose effect is known to be applied to THIS
 * tab's live NgRx state (#9438).
 *
 * The shared OPS store is written by every tab of the same origin, but live
 * tabs do not exchange operation payloads: an op appended by a concurrent tab
 * is counted by `getLastSeq()` while its effect is absent from this tab's
 * state. Persisting that global max as a snapshot's `lastAppliedOpSeq` makes
 * the next boot's tail replay (`getOpsAfterSeq`) silently skip the op. The
 * writers that derive a state cache from live state (snapshot save,
 * compaction) therefore consult this tracker before trusting `getLastSeq()`.
 *
 * ## Semantics
 *
 * - `establishFrontier(seq)` — the live state now reflects exactly the ops up
 *   to `seq`. Called when hydration finishes a replay and when the store
 *   atomically installs a new state-cache baseline. Clears any divergence.
 *   `seq === 0` (empty ops store) resets to unestablished instead: ops wipes
 *   preserve the auto-increment generator on BOTH backends, so the next
 *   append's seq is unknowable and anchoring at 0 would fabricate a gap →
 *   sticky false divergence (reachable via USE_REMOTE force-download and the
 *   boot after an interrupted rebuild).
 * - `observeOwnWrite(seq)` — this tab appended an op whose reducer effect is
 *   in its state (capture persists after the reducer ran; remote applies hold
 *   the op-log lock across append+apply, so saves cannot observe the gap).
 *   Advances the frontier only contiguously: a skipped seq proves another
 *   tab's op interleaved below our own write, which a scalar frontier cannot
 *   represent — that sets a sticky divergence instead. The sticky flag is
 *   required because after such an interleave the tab's own next append makes
 *   the scalar values equal again (foreign seq 5, own append returns 6 →
 *   frontier 6 == global max 6) while state still lacks seq 5.
 * - `isSaveSafeAt(globalLastSeq)` — true when a state-derived cache write may
 *   anchor at `globalLastSeq`. While no frontier is established this returns
 *   true: hydration establishes before any save path runs in production, and
 *   defaulting open keeps the pre-#9438 behavior on any path that never
 *   establishes.
 *
 * ## Wiring invariant (asymmetric failure modes)
 *
 * Every `OperationLogStoreService` method that adds rows to the OPS store
 * MUST report the committed seqs to this tracker. The two possible wiring
 * gaps fail very differently: a missed `establishFrontier` merely leaves the
 * tracker default-open ("no new protection"); a missed `observeOwnWrite`
 * makes the next observed own write look like a foreign gap → sticky
 * divergence → snapshot saves AND compaction silently disabled for the rest
 * of the session, on ALL platforms including single-instance Electron. Keep
 * that in mind when the divergence warning fires on a platform where no
 * concurrent tab can exist — it then indicates a wiring gap, not multi-tab.
 *
 * Divergence only clears on the next `establishFrontier` (re-hydration or a
 * baseline install), matching the skip-on-risk shape of the #8751/#7892
 * guards: skipping a save costs at most a slower next boot; the op-log stays
 * the source of truth. Single-instance platforms can never see a genuine
 * foreign gap, so with complete wiring the guard is inert there.
 */
@Injectable({ providedIn: 'root' })
export class TabSeqFrontierService {
  private _frontier: number | null = null;
  private _hasForeignWrites = false;

  establishFrontier(seq: number): void {
    if (seq === 0) {
      // Empty ops store: wipes keep the seq generator, so the next append's
      // seq is unknowable — see the class doc. Default-open until a real
      // baseline exists.
      this.resetToUnestablished();
      return;
    }
    this._frontier = seq;
    this._hasForeignWrites = false;
  }

  observeOwnWrite(seq: number): void {
    if (this._frontier === null || seq <= this._frontier) {
      return;
    }
    if (seq !== this._frontier + 1 && !this._hasForeignWrites) {
      this._hasForeignWrites = true;
      OpLog.warn(
        'TabSeqFrontierService: own append skipped past the applied frontier — ' +
          'a concurrent tab is writing (or, on single-instance platforms, an ' +
          'append path is missing its observe call); state-derived cache ' +
          'writes are disabled until the next hydration (#9438)',
        { frontier: this._frontier, observedSeq: seq },
      );
    }
    // Keep advancing even when diverged so the log above stays meaningful;
    // the sticky flag alone decides save safety from here on.
    this._frontier = seq;
  }

  /** After an ops wipe the baseline is unknown — fall back to default-open. */
  resetToUnestablished(): void {
    this._frontier = null;
    this._hasForeignWrites = false;
  }

  isSaveSafeAt(globalLastSeq: number): boolean {
    if (this._frontier === null) {
      return true;
    }
    return !this._hasForeignWrites && globalLastSeq === this._frontier;
  }

  /**
   * Sticky-divergence probe for cheap pre-lock fast-paths (mirrors the #8751
   * fast-path shape): once true, every save attempt would skip anyway, so
   * callers can bail before paying the flush + cross-tab lock + state
   * capture. The scalar `isSaveSafeAt` check cannot be hoisted the same way —
   * it needs the in-lock `getLastSeq()`.
   */
  hasKnownForeignWrites(): boolean {
    return this._hasForeignWrites;
  }

  /** Current frontier for diagnostics only; null while unestablished. */
  get frontierSeq(): number | null {
    return this._frontier;
  }
}
