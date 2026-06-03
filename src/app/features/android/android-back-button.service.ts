import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { App as CapacitorApp } from '@capacitor/app';

import { HISTORY_STATE } from '../../app.constants';
import { GlobalConfigService } from '../config/global-config.service';
import { getStartPageUrlPath } from '../config/default-start-page.util';
import { selectIsOverlayShown } from '../focus-mode/store/focus-mode.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import { hideFocusOverlay } from '../focus-mode/store/focus-mode.actions';

/**
 * Implements Android back-button behavior for top-level (bottom-nav) destinations
 * per https://developer.android.com/guide/navigation/backstack:
 * back from a top-level destination returns to the start destination, and back
 * from the start destination exits the app.
 *
 * Without this, the back button replays the SPA history stack — every tab switch
 * pushes a `window.history` entry, so back walks through every previously visited
 * tab instead of exiting (issue #7972).
 *
 * History-backed overlays (side-nav, task-detail, notes, fullscreen-markdown)
 * and non-top-level pages (context sub-pages, settings, search, …) keep their
 * existing `window.history.back()` behavior so back still closes overlays and
 * navigates up. Focus mode is store-backed and is closed directly. A plain
 * modal dialog (no history state) is dismissed directly so back closes it
 * rather than minimizing the app underneath it.
 */
@Injectable({ providedIn: 'root' })
export class AndroidBackButtonService {
  private readonly _router = inject(Router);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _store = inject(Store);
  private readonly _matDialog = inject(MatDialog);

  private readonly _isFocusOverlayShown = this._store.selectSignal(selectIsOverlayShown);
  private readonly _allProjects = this._store.selectSignal(selectAllProjects);

  handleBackButton(canGoBack = true): void {
    // 1. Focus mode is store-based rather than history-backed.
    if (this._isFocusOverlayShown()) {
      this._store.dispatch(hideFocusOverlay());
      return;
    }

    // 2. An overlay that pushed a history state is open → let its popstate
    //    listener close it.
    if (this._isHistoryOverlayOpen()) {
      this._historyBack();
      return;
    }

    // 3. A modal dialog without its own history state is open → dismiss the
    //    topmost one instead of navigating/minimizing underneath it. A dialog
    //    that opted out of dismissal (`disableClose`) swallows the back press,
    //    mirroring its escape-key behavior. History-backed dialogs (e.g.
    //    fullscreen-markdown) were already handled in step 2.
    const topDialog = this._matDialog.openDialogs.at(-1);
    if (topDialog) {
      if (!topDialog.disableClose) {
        topDialog.close();
      }
      return;
    }

    // 4. Not a top-level destination (context sub-page, settings, search, …)
    //    → navigate up via the history stack as before.
    const currentUrl = this._router.url;
    if (!this._isTopLevelDestination(currentUrl)) {
      if (canGoBack) {
        this._historyBack();
      } else {
        this._minimizeApp();
      }
      return;
    }

    // 5. A top-level destination → pop to the start destination, or exit if
    //    already there.
    const startUrl = this._getStartPageUrl();
    if (this._pathOf(currentUrl) === this._pathOf(startUrl)) {
      this._minimizeApp();
    } else {
      this._router.navigateByUrl(startUrl, { replaceUrl: true });
    }
  }

  private _isHistoryOverlayOpen(): boolean {
    const state = window.history.state;
    return !!state && Object.values(HISTORY_STATE).some((key) => state[key]);
  }

  /**
   * Primary navigation destinations (bottom-nav tabs + main feature pages).
   * Context sub-pages (worklog, metrics, …) and utility pages (settings, search,
   * scheduled-list, donate, …) are intentionally excluded so back navigates up
   * from them rather than jumping home.
   *
   * INVARIANT: this must classify every URL `getStartPageUrlPath()` can return
   * as top-level, otherwise back from the configured start destination would
   * navigate history instead of exiting. Enforced by the "start destination is
   * a top-level destination" spec — keep this list in sync when adding a start
   * page route.
   */
  private _isTopLevelDestination(url: string): boolean {
    const path = this._pathOf(url);
    return (
      /^\/(?:tag|project)\/[^/]+\/tasks$/.test(path) ||
      ['/planner', '/schedule', '/boards', '/habits'].includes(path)
    );
  }

  /**
   * Resolve the configured start destination to a URL. Delegates to the same
   * helper as DefaultStartPageGuard so the boot redirect and back navigation
   * stay in lockstep; a missing/archived/hidden project start page falls back
   * to Today.
   */
  private _getStartPageUrl(): string {
    const startPage = this._globalConfigService.misc()?.defaultStartPage;
    const startProject =
      typeof startPage === 'string'
        ? this._allProjects().find((project) => project.id === startPage)
        : undefined;
    return getStartPageUrlPath(
      startPage,
      this._globalConfigService.appFeatures(),
      startProject,
    );
  }

  private _pathOf(url: string): string {
    return url.split(/[?#]/)[0];
  }

  // Thin wrappers around side-effecting globals so they can be spied in tests
  // (spying Capacitor plugin methods directly is a no-op due to their proxy).
  private _historyBack(): void {
    window.history.back();
  }

  private _minimizeApp(): void {
    void CapacitorApp.minimizeApp();
  }
}
