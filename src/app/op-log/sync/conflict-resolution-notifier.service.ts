import { inject, Injectable } from '@angular/core';
import {
  findLwwContentConflicts,
  findPatchContentConflicts,
  type LwwContentConflict,
} from './lww-conflict-summary.util';
import { EntityType } from '../core/operation.types';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { escapeHtml } from '../../util/escape-html';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { LWWResolution, MergedResolution } from './conflict-resolution.util';

/**
 * Tells the user about a conflict resolution outcome (snack or content-conflict banner).
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictResolutionNotifierService {
  private bannerService = inject(BannerService);
  // Optional: production always has it (TranslateModule.forRoot); optional keeps
  // the many specs that construct this service from needing to provide it.
  private translateService = inject(TranslateService, { optional: true });
  private entityState = inject(ConflictEntityStateService);

  /**
   * Surfaces the outcome of auto-resolution to the user (#8694).
   *
   * Routine self-healing (rescheduling, repeat/archive/done churn) keeps the
   * existing quiet transient snack. When a resolution discarded a real user
   * content edit (title/notes/subtasks), a dismissible banner names the affected
   * task(s) so the user knows data may differ and can double-check.
   *
   * Purely a read of the already-decided resolutions — it never influences which
   * ops were applied or rejected.
   */
  async _notifyResolutionOutcome(
    resolutions: LWWResolution[],
    patches: MergedResolution[],
  ): Promise<void> {
    const payloadKeyFor = (entityType: string): string =>
      this.entityState._resolvePayloadKey(entityType as EntityType);
    const contentConflicts = [
      ...findLwwContentConflicts(resolutions, payloadKeyFor),
      ...findPatchContentConflicts(patches, payloadKeyFor),
    ];

    if (contentConflicts.length === 0) {
      return;
    }

    await this._showContentConflictBanner(contentConflicts);
  }

  /**
   * Shows a dismissible banner naming the tasks whose edits diverged and were
   * auto-resolved by keeping the most recent version. The only button is a
   * confirming "OK" instead of the built-in dismiss: the shared `G.DISMISS`
   * label reads as "reject" in some locales (e.g. ru "Отклонить"), suggesting
   * the click undoes the resolution (#10481). Clicking only closes the banner;
   * the resolved data stays as is.
   *
   * Titles are user content escaped before display: the banner renders via
   * `[innerHTML]` and titles come from synced remote data, so Angular's own
   * sanitizer is the primary XSS control and this escaping is defense-in-depth
   * plus correct literal rendering (a `<b>`-looking title shows as text). Titles
   * MUST NOT be logged — the log history is exportable (sync rule #9).
   */
  private async _showContentConflictBanner(
    contentConflicts: LwwContentConflict[],
  ): Promise<void> {
    const MAX_NAMED = 3;
    const labels = await Promise.all(
      contentConflicts
        .slice(0, MAX_NAMED)
        .map((conflict) => this._buildContentConflictLabel(conflict)),
    );
    const named = labels.join(', ');
    const taskList = contentConflicts.length > MAX_NAMED ? `${named} …` : named;

    this.bannerService.open({
      id: BannerId.SyncConflictContentResolved,
      ico: 'sync_problem',
      msg: T.F.SYNC.B.CONTENT_CONFLICT_RESOLVED,
      translateParams: { taskList },
      isHideDismissBtn: true,
      action: {
        label: T.G.OK,
        // The banner component dismisses before calling fn; nothing else to do.
        fn: () => {},
      },
    });
  }

  /**
   * Builds the display label for one conflicted task inside the banner's task
   * list. Normally just the (escaped, quoted) current title. When the discarded
   * edit changed the title, the current title is the *kept* value — useless for
   * double-checking on its own — so we also name the discarded title: `"kept"
   * (discarded: "dropped")`. Both values are escaped (rendered via `[innerHTML]`,
   * see `_showContentConflictBanner`).
   */
  private async _buildContentConflictLabel(
    conflict: LwwContentConflict,
  ): Promise<string> {
    const keptTitle = await this._getContentConflictTitle(conflict.entityId);
    const kept = `"${escapeHtml(keptTitle)}"`;
    const discardedTitle = conflict.discardedTitle?.trim();
    // Skip the annotation when nothing meaningful to add: no title was
    // discarded, or the discarded title equals the current one. The equality
    // case covers two situations, both correctly silenced: (a) both devices set
    // the same title; (b) a title edit lost to a concurrent *other-field* remote
    // win — the winner didn't touch the title, so the current state still shows
    // the (now-rejected) local title, which equals the discarded value. In both
    // an annotation would read `"X" (discarded: "X")` — pure noise, no divergence
    // to point at — so we render just the current title. (For the common
    // title-vs-title case the current title IS the winning value and differs
    // from the discarded one, so the annotation shows.)
    if (!discardedTitle || discardedTitle === keptTitle.trim()) {
      return kept;
    }
    const discarded = `"${escapeHtml(discardedTitle)}"`;
    return (
      this.translateService?.instant(T.F.SYNC.B.CONTENT_CONFLICT_TITLE_CHANGE, {
        kept,
        discarded,
      }) ?? `${kept} (discarded: ${discarded})`
    );
  }

  private async _getContentConflictTitle(entityId: string): Promise<string> {
    const entity = await this.entityState.getCurrentEntityState(
      'TASK' as EntityType,
      entityId,
    );
    const title = (entity as { title?: string } | undefined)?.title;
    // Guard against a corrupt/non-string title from remote state before .trim().
    if (typeof title === 'string' && title.trim().length) {
      return title;
    }
    return (
      this.translateService?.instant(T.F.SYNC.B.CONTENT_CONFLICT_UNTITLED) ??
      'Untitled task'
    );
  }
}
