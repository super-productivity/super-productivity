/**
 * SPAP-15 — Summary banner for auto-resolved sync conflicts.
 *
 * Replaces the bare `LWW_CONFLICTS_AUTO_RESOLVED` snacks. After a sync it reads
 * the journal's UNREVIEWED entries and, if any exist, shows one dismissible
 * banner: "N sync conflicts auto-resolved (X remote, Y local won)" with a REVIEW
 * action that opens the review page. DISMISS (the banner's built-in button) only
 * hides the banner — the persistent sync-icon badge keeps surfacing the count.
 */

import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { auditTime, skip } from 'rxjs';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { ConflictJournalService } from './conflict-journal.service';
import { computeWinCounts, ConflictWinCounts } from './sync-conflict-review.util';
import { T } from '../../t.const';

/** Route path of the Sync Conflicts review page. */
export const SYNC_CONFLICTS_ROUTE = '/sync-conflicts';

/**
 * Coalesce window for the live banner refresh. A burst of journal mutations
 * (e.g. Keep All over the whole journal) collapses into one trailing refresh
 * instead of one full journal scan per entry.
 */
const BANNER_REFRESH_COALESCE_MS = 100;

const CR = T.F.SYNC.CONFLICT_REVIEW;

@Injectable({ providedIn: 'root' })
export class SyncConflictBannerService {
  private readonly _bannerService = inject(BannerService);
  // Optional so the many sync specs that construct the resolver services (which
  // now depend on this) don't all have to provide a Router.
  private readonly _router = inject(Router, { optional: true });
  private readonly _journal = inject(ConflictJournalService);

  // Monotonic guard shared by every async banner update (open + live refresh):
  // each attempt claims a sequence before its journal read and bails if a newer
  // attempt has started, so a slow read can never overwrite a fresher decision.
  private _bannerSeq = 0;

  constructor() {
    // SPAP-35 / #8946: the banner captures its counts when it opens; the
    // sync-icon badge updates live but an OPEN banner would go stale while the
    // user reviews entries on the page. Refresh (or dismiss at zero) an
    // already-open banner on every journal MUTATION — keyed on the `revision`
    // signal, NOT the numeric unreviewed count, so an equal-total composition
    // change (one remote-win reviewed while one local-win is recorded, total
    // unchanged) still refreshes the "X remote, Y local" breakdown. `auditTime`
    // coalesces a burst of mutations (e.g. Keep All over the whole journal) into
    // one trailing refresh, so a bulk review can't fire one full journal scan per
    // entry. Only refreshes while the banner is still shown, so reviewing never
    // resurrects a dismissed banner.
    toObservable(this._journal.revision)
      .pipe(skip(1), auditTime(BANNER_REFRESH_COALESCE_MS), takeUntilDestroyed())
      .subscribe(() => void this._refreshOpenBanner());
  }

  /** Navigate to the review page (shared by the banner action and elsewhere). */
  navigateToReview(): void {
    void this._router?.navigate([SYNC_CONFLICTS_ROUTE]);
  }

  /**
   * Opens the summary banner iff there are unreviewed conflicts. No-ops (and
   * dismisses any stale banner) when the unreviewed count is zero, so routine
   * self-healing syncs stay silent. Called after a sync resolves conflicts.
   */
  async maybeShowSummaryBanner(): Promise<void> {
    const seq = ++this._bannerSeq;
    const unreviewed = await this._journal.list('unreviewed');
    if (seq !== this._bannerSeq) return; // superseded by a newer banner update
    const wins = computeWinCounts(unreviewed);
    // Ignore a phantom zero: list() returns [] on a transient DB error. If the
    // authoritative count still reports >0, don't dismiss/skip a valid banner
    // (same guard the live-refresh path applies).
    if (wins.total === 0 && this._journal.unreviewedCount() > 0) return;
    this._renderSummaryBanner(wins);
  }

  /**
   * SPAP-35 live-refresh path: keep an ALREADY-OPEN banner in sync with the
   * current unreviewed count, or dismiss it at zero. Unlike the opener it must
   * never OPEN a banner the user isn't already looking at, and it has to survive
   * the async journal read racing with either a dismiss or a newer refresh:
   *   - re-check `isShown()` AFTER the await, so a banner dismissed mid-read is
   *     not resurrected (the pre-await check alone is a check-then-act TOCTOU);
   *   - re-check the sequence, so a slow older read can't clobber newer counts;
   *   - ignore a phantom zero: `list()` returns `[]` on a transient DB error, so
   *     a zero read while the authoritative count signal still reports >0 must
   *     not dismiss a valid banner.
   */
  private async _refreshOpenBanner(): Promise<void> {
    if (!this._bannerService.isShown(BannerId.SyncConflictsAutoResolved)) return;
    const seq = ++this._bannerSeq;
    const unreviewed = await this._journal.list('unreviewed');
    if (seq !== this._bannerSeq) return; // a newer refresh/open superseded us
    if (!this._bannerService.isShown(BannerId.SyncConflictsAutoResolved)) return; // dismissed mid-read
    const wins = computeWinCounts(unreviewed);
    if (wins.total === 0 && this._journal.unreviewedCount() > 0) return; // phantom zero
    this._renderSummaryBanner(wins);
  }

  /** Applies a resolved count to the banner: dismiss at zero, else (re)open. */
  private _renderSummaryBanner({
    total,
    remoteWins,
    localWins,
  }: ConflictWinCounts): void {
    if (total === 0) {
      this._bannerService.dismiss(BannerId.SyncConflictsAutoResolved);
      return;
    }

    this._bannerService.open({
      id: BannerId.SyncConflictsAutoResolved,
      ico: 'sync_problem',
      msg: CR.BANNER_MSG,
      translateParams: { count: total, remoteWins, localWins },
      action: {
        label: CR.BANNER_REVIEW,
        fn: () => this.navigateToReview(),
      },
    });
  }
}
