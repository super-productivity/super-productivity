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
import { Router } from '@angular/router';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { ConflictJournalService } from './conflict-journal.service';
import { computeWinCounts } from './sync-conflict-review.util';
import { T } from '../../t.const';

/** Route path of the Sync Conflicts review page. */
export const SYNC_CONFLICTS_ROUTE = '/sync-conflicts';

const CR = T.F.SYNC.CONFLICT_REVIEW;

@Injectable({ providedIn: 'root' })
export class SyncConflictBannerService {
  private readonly _bannerService = inject(BannerService);
  // Optional so the many sync specs that construct the resolver services (which
  // now depend on this) don't all have to provide a Router.
  private readonly _router = inject(Router, { optional: true });
  private readonly _journal = inject(ConflictJournalService);

  /** Navigate to the review page (shared by the banner action and elsewhere). */
  navigateToReview(): void {
    void this._router?.navigate([SYNC_CONFLICTS_ROUTE]);
  }

  /**
   * Opens the summary banner iff there are unreviewed conflicts. No-ops (and
   * dismisses any stale banner) when the unreviewed count is zero, so routine
   * self-healing syncs stay silent.
   */
  async maybeShowSummaryBanner(): Promise<void> {
    const unreviewed = await this._journal.list('unreviewed');
    const { total, remoteWins, localWins } = computeWinCounts(unreviewed);

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
