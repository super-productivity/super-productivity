/**
 * SPAP-16 — Whole-dataset conflict merge service.
 *
 * Orchestrates the data-safety-critical parts of the "REVIEW DIFFERENCES" flow:
 *
 *  1. `computeDiff()` — reads the LOCAL complete state via the SAME snapshot path
 *     force-upload uses, and diffs it against the downloaded remote snapshot.
 *  2. `applyMerge()` — builds the merged complete state from the user's picks,
 *     applies it LOCALLY via the same full-state apply path `forceDownloadRemoteState`
 *     uses (`SyncHydrationService.hydrateFromRemoteSync`), journals every NON-DEFAULT
 *     pick as a `manual-merge` entry, then FORCE-UPLOADS it via the
 *     `forceUploadLocalState` path so the remote receives the merged result.
 *
 * Atomicity: apply-then-upload. The local apply is committed first; if the upload
 * fails it is NOT rolled back — the merged state is already local and normal sync
 * retry re-uploads it. Journaling is best-effort and never throws back into the flow.
 */

import { inject, Injectable } from '@angular/core';
import { OpLog } from '../../core/log';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { uuidv7 } from '../../util/uuid-v7';
import {
  computeWholeDatasetDiff,
  DifferingEntity,
  OnlySideEntity,
  WholeDatasetDiff,
} from './whole-dataset-diff.util';
import {
  buildMergedState,
  isDifferingPickNonDefault,
  isOnlyLocalPickNonDefault,
  isOnlyRemotePickNonDefault,
  MergePicks,
  pickKey,
} from './whole-dataset-merge.util';
import { ConflictJournalEntry, ConflictJournalFieldDiff } from './conflict-journal.model';
import { VectorClockService } from './vector-clock.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import {
  compareVectorClocks,
  VectorClock,
  VectorClockComparison,
} from '../../core/util/vector-clock';

/**
 * Thrown when local reviewable state mutated (a task edit, a time-tracking flush)
 * between when the review diff was computed and when Apply Merge runs. The picks
 * were made against a now-stale base; applying them would hydrate that stale
 * snapshot as a clean-slate SYNC_IMPORT and silently drop the concurrent ops.
 * Abort instead — the user re-resolves against fresh state. (SPAP-45)
 */
export class StaleReviewError extends Error {
  constructor() {
    super('Local data changed during review; the merge base is stale.');
    this.name = 'StaleReviewError';
  }
}

@Injectable({ providedIn: 'root' })
export class WholeDatasetMergeService {
  private stateSnapshotService = inject(StateSnapshotService);
  private syncHydrationService = inject(SyncHydrationService);
  private coordinator = inject(SyncImportConflictCoordinatorService);
  private journal = inject(ConflictJournalService);
  private clientIdService = inject(ClientIdService);
  private vectorClockService = inject(VectorClockService);
  private operationWriteFlushService = inject(OperationWriteFlushService);
  private taskTimeSyncService = inject(TaskTimeSyncService);

  /**
   * Reads the current LOCAL complete state (entity models + archives) and diffs
   * it against the downloaded remote snapshot state.
   */
  async computeDiff(remoteSnapshotState: Record<string, unknown> | undefined): Promise<{
    diff: WholeDatasetDiff;
    localState: Record<string, unknown>;
    baselineVectorClock: VectorClock;
  }> {
    // Drain batched tracked-time (accumulated timer ticks are not yet ops) so it
    // is part of this baseline rather than surfacing as a phantom change later.
    this.taskTimeSyncService.flush();
    // Capture the local snapshot AND its baseline clock atomically under one
    // operation-log cutoff (flushThenRunExclusive drains pending writes, then holds
    // the lock while confirming none landed). This makes the picks and the
    // staleness baseline correspond to the SAME durable state, so applyMerge can
    // tell a genuine concurrent edit apart from a write that was merely draining
    // when the review opened — without the capture race that made the two sources
    // inconsistent. (SPAP-45)
    return this.operationWriteFlushService.flushThenRunExclusive(async () => {
      const localState =
        (await this.stateSnapshotService.getStateSnapshotAsync()) as unknown as Record<
          string,
          unknown
        >;
      const diff = computeWholeDatasetDiff(localState, remoteSnapshotState);
      const baselineVectorClock = await this.vectorClockService.getCurrentVectorClock();
      return { diff, localState, baselineVectorClock };
    });
  }

  /**
   * Builds the merged state from the picks, applies it locally, then force-uploads.
   * Returns the merged state that was applied (also useful for assertions/tests).
   */
  async applyMerge(
    syncProvider: OperationSyncCapable,
    localState: Record<string, unknown>,
    diff: WholeDatasetDiff,
    picks: MergePicks,
    remoteVectorClock: Record<string, number> | undefined,
    // Required (not optional): the staleness gate below is a data-loss guard and
    // must be unbypassable at this chokepoint. When the parameter was optional a
    // caller that omitted it silently skipped the whole gate — i.e. exactly the
    // pre-fix vulnerable behavior — with no signal. Making it required moves that
    // failure from a silent runtime no-op to a compile error.
    baselineVectorClock: VectorClock,
  ): Promise<Record<string, unknown>> {
    // SPAP-45 staleness gate. The review modal can stay open for minutes; a local
    // edit (or batched tracked time) in that window advances the local clock. The
    // picks were made against the snapshot taken at computeDiff, so applying them
    // would hydrate that now-stale snapshot as a clean-slate SYNC_IMPORT and
    // silently drop the concurrent ops. Drain tracked time, then re-read the clock
    // under the SAME operation-log cutoff computeDiff used (flushThenRunExclusive)
    // and compare against the baseline. If it advanced, abort BEFORE building or
    // hydrating — never touch local state or the remote.
    //
    // Known residual: this cutoff still precedes the separate hydrate lock scope,
    // so an op landing between here and the hydrate's own deferred-action window is
    // not yet covered. Closing that fully needs the check and hydrate to share one
    // cutoff and is tracked as a follow-up.
    this.taskTimeSyncService.flush();
    await this.operationWriteFlushService.flushThenRunExclusive(async () => {
      const currentClock = await this.vectorClockService.getCurrentVectorClock();
      if (
        compareVectorClocks(currentClock, baselineVectorClock) !==
        VectorClockComparison.EQUAL
      ) {
        OpLog.warn(
          'WholeDatasetMergeService: local state changed during review — aborting stale merge.',
        );
        throw new StaleReviewError();
      }
    });

    const mergedState = buildMergedState(localState, diff, picks);

    OpLog.warn(
      'WholeDatasetMergeService: Applying manual merge locally (SYNC_IMPORT) then force-uploading.',
    );

    // 1. Apply locally via the same full-state apply path forceDownloadRemoteState uses.
    //    createSyncImportOp=true → clean-slate semantics (like USE_LOCAL): the merged
    //    state becomes authoritative locally.
    await this.syncHydrationService.hydrateFromRemoteSync(
      mergedState,
      remoteVectorClock,
      true,
      'FORCE_UPLOAD',
    );

    // 2. Journal every NON-DEFAULT pick (best-effort; never throws back into the
    //    flow). AFTER the local apply (journal-after-persist) but BEFORE the
    //    upload: an upload failure is retried by normal sync and never re-enters
    //    this flow, so journaling after it would lose the entries.
    await this._journalNonDefaultPicks(diff, picks);

    // 3. Force-upload the now-merged local state so remote receives the merge.
    await this.coordinator.forceUploadLocalState(syncProvider);

    OpLog.normal('WholeDatasetMergeService: Manual merge applied and uploaded.');

    return mergedState;
  }

  private async _journalNonDefaultPicks(
    diff: WholeDatasetDiff,
    picks: MergePicks,
  ): Promise<void> {
    try {
      const localClientId = (await this.clientIdService.loadClientId()) ?? '';
      const now = Date.now();

      for (const e of diff.differing) {
        const pick = picks.differing[pickKey(e.modelKey, e.entityId)];
        if (!pick || !isDifferingPickNonDefault(e, pick)) {
          continue;
        }
        await this.journal.record(this._differingEntry(e, pick, localClientId, now));
      }

      for (const e of diff.onlyLocal) {
        const pick = picks.onlyLocal[pickKey(e.modelKey, e.entityId)] ?? 'keep';
        if (!isOnlyLocalPickNonDefault(pick)) {
          continue;
        }
        // DISCARD: the local-only entity was dropped → remote/none won.
        await this.journal.record(this._onlySideEntry(e, 'remote', localClientId, now));
      }

      for (const e of diff.onlyRemote) {
        const pick = picks.onlyRemote[pickKey(e.modelKey, e.entityId)] ?? 'add';
        if (!isOnlyRemotePickNonDefault(pick)) {
          continue;
        }
        // SKIP: the remote-only entity was not added → local/none won.
        await this.journal.record(this._onlySideEntry(e, 'local', localClientId, now));
      }
    } catch (err) {
      OpLog.err(
        'WholeDatasetMergeService: failed to journal manual-merge picks (ignored)',
        err,
      );
    }
  }

  private _differingEntry(
    e: DifferingEntity,
    pick: 'local' | 'remote',
    localClientId: string,
    now: number,
  ): ConflictJournalEntry {
    const fieldDiffs: ConflictJournalFieldDiff[] = e.fieldDiffs.map((d) => ({
      field: d.field,
      localVal: d.localVal,
      remoteVal: d.remoteVal,
      pickedSide: pick,
    }));
    return {
      id: uuidv7(),
      entityType: e.entityType,
      entityId: e.entityId,
      entityTitle: e.title,
      resolvedAt: now,
      winner: pick,
      reason: 'manual-merge',
      fieldDiffs,
      localClientId,
      remoteClientId: '',
      localTs: e.localModified,
      remoteTs: e.remoteModified,
      status: 'kept',
    };
  }

  private _onlySideEntry(
    e: OnlySideEntity,
    winner: 'local' | 'remote',
    localClientId: string,
    now: number,
  ): ConflictJournalEntry {
    return {
      id: uuidv7(),
      entityType: e.entityType,
      entityId: e.entityId,
      entityTitle: e.title,
      resolvedAt: now,
      winner,
      reason: 'manual-merge',
      fieldDiffs: [],
      localClientId,
      remoteClientId: '',
      localTs: winner === 'local' ? e.modified : 0,
      remoteTs: winner === 'remote' ? e.modified : 0,
      status: 'kept',
    };
  }
}
