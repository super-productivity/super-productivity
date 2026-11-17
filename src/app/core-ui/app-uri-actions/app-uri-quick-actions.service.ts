import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, Subscription, merge } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ipcAppUriQuickAction$, ipcOpenTaskFromAppUri$ } from '../../core/ipc-events';
import { LayoutService } from '../layout/layout.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import {
  AppUriQuickAction,
  AppUriQuickActionTarget,
} from '../../core/app-uri-actions/parse-app-uri-quick-action';
import { PENDING_CAPACITOR_QUICK_ACTION } from '../../core/app-uri-actions/pending-capacitor-quick-action';
import { NavigateToTaskService } from '../navigate-to-task/navigate-to-task.service';
import { selectTaskEntities } from '../../features/tasks/store/task.selectors';
import { setSelectedTask } from '../../features/tasks/store/task.actions';
import { TaskDetailTargetPanel } from '../../features/tasks/task.model';

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
 * The Android launcher shortcuts are static for the same reason.
 * Documented in wiki 3.01 §4.
 */
const NAVIGATE_ROUTES: Record<AppUriQuickActionTarget, string> = {
  today: `/tag/${TODAY_TAG.id}/tasks`,
  inbox: `/project/${INBOX_PROJECT.id}/tasks`,
};

/**
 * Task ids from desktop `superproductivity://open-task?id=` links, forwarded by
 * the Electron protocol handler. A token (not a direct import) so tests can
 * provide a fresh stream, like PENDING_CAPACITOR_QUICK_ACTION.
 */
export const OPEN_TASK_FROM_APP_URI = new InjectionToken<Observable<string>>(
  'OPEN_TASK_FROM_APP_URI',
  { providedIn: 'root', factory: () => ipcOpenTaskFromAppUri$ },
);

interface OpenTaskAction {
  type: 'open-task';
  taskId: string;
}

/**
 * Handles the UI-only actions on the app's custom URL scheme — `add-task`
 * (open the quick-add bar), the `today`/`inbox` navigation actions and, on
 * desktop, `open-task?id=` (jump to a task and open its detail panel). On iOS
 * and Android these are what the launcher shortcuts (long-press the app icon)
 * resolve to: each iOS `UIApplicationShortcutItem` and Android
 * `res/xml/shortcuts.xml` entry carries one of the URLs, the native side opens
 * it, and it arrives here through the single `appUrlOpen` listener in `main.ts`.
 * On desktop the macOS dock menu and the Windows jump list open the same URLs;
 * the Electron protocol handler forwards `today`/`inbox` over IPC and keeps
 * handling `add-task` itself (`IPC.SHOW_ADD_TASK_BAR`). `open-task` links come
 * from the task context menu's "Copy task link"; the handler forwards just the
 * id (`IPC.OPEN_TASK_FROM_APP_URI`).
 *
 * Deliberately thinner than its sibling `AppUriTaskActionsService`: these
 * actions never edit tasks, so there is nothing to validate and no success
 * snack — opening the bar or landing on the page *is* the feedback. The one
 * snack is `open-task`'s "could not find the task" error.
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
  private _openTaskFromAppUri$ = inject(OPEN_TASK_FROM_APP_URI);
  private _navigateToTaskService = inject(NavigateToTaskService);
  private _store = inject(Store);
  private _taskEntities = this._store.selectSignal(selectTaskEntities);

  private _subs = new Subscription();

  constructor() {
    this._subs.add(
      merge(
        ipcAppUriQuickAction$,
        this._pendingQuickAction$,
        this._openTaskFromAppUri$.pipe(
          map((taskId): OpenTaskAction => ({ type: 'open-task', taskId })),
        ),
      )
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

  private _handleAction(action: AppUriQuickAction | OpenTaskAction): void {
    if (action.type === 'add-task') {
      // Same entry point as the mobile FAB, the `addNewTask` keyboard shortcut
      // and the desktop `add-task` protocol action: the bar opens on whatever
      // context is currently active.
      this._layoutService.showAddTaskBar();
      return;
    }

    if (action.type === 'open-task') {
      void this._openTask(action.taskId);
      return;
    }

    void this._router.navigateByUrl(NAVIGATE_ROUTES[action.target]);
  }

  /**
   * Reuses the global-search jump (`NavigateToTaskService`): it resolves the
   * task's context (Today / project / tag, or the worklog for an archived task),
   * reveals the row and shows the "could not focus" snack for an unknown id.
   *
   * The detail panel is opened only afterwards, because every navigation start
   * and context switch clears the selection (LayoutEffects /
   * WorkContextEffects). An archived task has no live entity for the panel to
   * show, so it only gets the worklog jump.
   */
  private async _openTask(taskId: string): Promise<void> {
    // Entity dictionaries inherit from Object.prototype — require the stored
    // entity to identify itself, so `id=constructor` is not taken as live.
    const isLive = this._taskEntities()[taskId]?.id === taskId;
    const isNavigated = await this._navigateToTaskService.navigate(taskId, !isLive);
    if (!isNavigated || !isLive) {
      return;
    }
    this._store.dispatch(
      setSelectedTask({
        id: taskId,
        taskDetailTargetPanel: TaskDetailTargetPanel.Default,
        // Opening a link must always show the panel, never toggle an already
        // selected task closed.
        isSkipToggle: true,
      }),
    );
  }
}
