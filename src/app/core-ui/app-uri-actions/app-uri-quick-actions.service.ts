import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LayoutService } from '../layout/layout.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import {
  AppUriQuickAction,
  AppUriQuickActionTarget,
} from '../../core/app-uri-actions/parse-app-uri-quick-action';
import { PENDING_CAPACITOR_QUICK_ACTION } from '../../core/app-uri-actions/pending-capacitor-quick-action';

/**
 * Composed from the work-context consts the same way ShortcutService,
 * NavigateToTaskService and MobileBottomNavComponent do it.
 *
 * Only the two always-present work contexts are offered. Every other main-nav
 * destination (Planner, Schedule, Boards, Habits) hangs off an App Features
 * flag — and the onboarding presets ship two of the three with Boards off and
 * one with Planner off too, so a static Home Screen item pointing at one would
 * be a dead entry for a large share of users. A static item cannot be hidden
 * per user; that would need dynamic shortcut items, i.e. a native plugin.
 * Documented in wiki 3.01 §4.
 */
const NAVIGATE_ROUTES: Record<AppUriQuickActionTarget, string> = {
  today: `/tag/${TODAY_TAG.id}/tasks`,
  inbox: `/project/${INBOX_PROJECT.id}/tasks`,
};

/**
 * Handles the UI-only actions on the app's custom URL scheme — `add-task`
 * (open the quick-add bar) and the `today`/`inbox` navigation actions. On iOS these are what the home screen quick actions (long-press the
 * app icon) resolve to: each `UIApplicationShortcutItem` carries one of the
 * URLs, the native side opens it, and it arrives here through the single
 * `appUrlOpen` listener in `main.ts`.
 *
 * Deliberately thinner than its sibling `AppUriTaskActionsService`: these
 * actions never write state, so there is nothing to validate and no snack to
 * show — opening the bar or landing on the page *is* the feedback.
 *
 * Actions are buffered until `isAllDataLoadedInitially$` fires, so a
 * cold-launched quick action never navigates into a not-yet-hydrated store
 * (the route guards resolve tags/projects out of it).
 */
@Injectable({ providedIn: 'root' })
export class AppUriQuickActionsService implements OnDestroy {
  private _router = inject(Router);
  private _layoutService = inject(LayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _pendingQuickAction$ = inject(PENDING_CAPACITOR_QUICK_ACTION);

  private _subs = new Subscription();

  constructor() {
    this._subs.add(
      this._pendingQuickAction$
        .pipe(
          // `concatMap` (not `mergeMap`): two actions in quick succession must
          // stay in order, or the later one's navigation could be overtaken.
          concatMap((action) =>
            this._dataInitStateService.isAllDataLoadedInitially$.pipe(map(() => action)),
          ),
        )
        .subscribe((action) => this._handleAction(action)),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  private _handleAction(action: AppUriQuickAction): void {
    if (action.type === 'add-task') {
      // Same entry point as the mobile FAB, the `addNewTask` keyboard shortcut
      // and the desktop `add-task` protocol action: the bar opens on whatever
      // context is currently active.
      this._layoutService.showAddTaskBar();
      return;
    }

    void this._router.navigateByUrl(NAVIGATE_ROUTES[action.target]);
  }
}
