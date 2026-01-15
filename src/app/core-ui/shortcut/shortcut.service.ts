import { computed, inject, Injectable } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { IS_ELECTRON } from '../../app.constants';
import { checkKeyCombo } from '../../util/check-key-combo';
import { isInputElement } from '../../util/dom-element';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ActivatedRoute, Router } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogAddNoteComponent } from '../../features/note/dialog-add-note/dialog-add-note.component';
import { DialogCreateProjectComponent } from '../../features/project/dialogs/create-project/dialog-create-project.component';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { Store } from '@ngrx/store';
import { showFocusOverlay } from '../../features/focus-mode/store/focus-mode.actions';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { first, mapTo, switchMap } from 'rxjs/operators';
import { fromEvent, merge, Observable, of } from 'rxjs';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { TaskShortcutService } from '../../features/tasks/task-shortcut.service';

// NOTE: Relying on Angular CDK overlay CSS class names keeps shortcut suppression simple.
// If CDK changes these class names we only need to adjust the helpers below.
const CDK_OVERLAY_CONTAINER_CLASS = 'cdk-overlay-container';
const CDK_OVERLAY_PANE_CLASS = 'cdk-overlay-pane';

@Injectable({
  providedIn: 'root',
})
export class ShortcutService {
  private _configService = inject(GlobalConfigService);
  private _router = inject(Router);
  private _layoutService = inject(LayoutService);
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _activatedRoute = inject(ActivatedRoute);
  private _uiHelperService = inject(UiHelperService);
  private _syncWrapperService = inject(SyncWrapperService);
  private _store = inject(Store);
  private _pluginBridgeService = inject(PluginBridgeService);
  private _taskShortcutService = inject(TaskShortcutService);
  private _overlayContainer = inject(OverlayContainer);

  isCtrlPressed$: Observable<boolean> = fromEvent(document, 'keydown').pipe(
    switchMap((ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.ctrlKey) {
        return merge(of(true), fromEvent(document, 'keyup').pipe(mapTo(false)));
      }
      return of(false);
    }),
  );
  backlogPos?: number;
  readonly isFocusModeEnabled = computed(
    () => this._configService.cfg()?.appFeatures.isFocusModeEnabled,
  );

  constructor() {
    this._activatedRoute.queryParams.subscribe((params) => {
      if (params && params.backlogPos) {
        this.backlogPos = +params.backlogPos;
      }
    });

    // GLOBAL SHORTCUTS
    if (IS_ELECTRON) {
      window.ea.on(IPC.TASK_TOGGLE_START, () => {
        this._taskService.toggleStartTask();
      });
      window.ea.on(IPC.SHOW_ADD_TASK_BAR, () => {
        this._layoutService.showAddTaskBar();
      });
      window.ea.on(IPC.ADD_NOTE, () => {
        if (this._matDialog.openDialogs.length === 0) {
          this._matDialog.open(DialogAddNoteComponent, {
            minWidth: '100vw',
            height: '100vh',
            restoreFocus: true,
            autoFocus: 'textarea',
          });
        }
      });
    }
  }

  async handleKeyDown(ev: KeyboardEvent): Promise<void> {
    const cfg = this._configService.cfg();
    if (!cfg) {
      throw new Error();
    }

    const keys = cfg.keyboard;
    const el = ev.target as HTMLElement;
    const hasBlockingOverlay =
      this._matDialog.openDialogs.length > 0 || this._hasOpenCdkOverlay();

    // Skip handling if no special keys are used and inside input elements or overlays.
    // Overlay detection intentionally keys off CDK CSS class names for now (see constants above).
    if (
      !ev.metaKey &&
      (isInputElement(el) || hasBlockingOverlay || this._isEventFromOverlay(ev))
    ) {
      return;
    }

    if (
      checkKeyCombo(ev, keys.toggleBacklog) &&
      this._workContextService.activeWorkContextType === WorkContextType.PROJECT
    ) {
      let backlogPos = 0;
      switch (this.backlogPos) {
        case 50:
          backlogPos = 0;
          break;
        case 0:
          backlogPos = 100;
          break;
        default:
          backlogPos = 50;
      }
      this._router.navigate(['/active/tasks'], {
        queryParams: { backlogPos },
      });
    } else if (checkKeyCombo(ev, keys.goToFocusMode) && this.isFocusModeEnabled()) {
      this._store.dispatch(showFocusOverlay());
    } else if (checkKeyCombo(ev, keys.goToWorkView)) {
      this._router.navigate(['/active/tasks']).then(() => {
        window.setTimeout(() => {
          this._taskService.focusFirstTaskIfVisible();
        });
      });
    } else if (checkKeyCombo(ev, keys.goToTimeline)) {
      this._router.navigate(['/timeline']);
    } else if (checkKeyCombo(ev, keys.goToSettings)) {
      this._router.navigate(['/config']);
    } else if (checkKeyCombo(ev, keys.goToScheduledView)) {
      this._router.navigate(['/schedule']);

      // } else if (checkKeyCombo(ev, keys.goToDailyAgenda)) {
      //   this._router.navigate(['/daily-agenda']);
      //
      // } else if (checkKeyCombo(ev, keys.goToFocusMode)) {
      //   this._router.navigate(['/focus-view']);
    } else if (checkKeyCombo(ev, keys.showSearchBar)) {
      this._router.navigate(['/search']);
      ev.preventDefault();
    } else if (checkKeyCombo(ev, keys.focusSideNav)) {
      this._focusSideNav();
      ev.preventDefault();
    } else if (checkKeyCombo(ev, keys.addNewTask)) {
      this._layoutService.showAddTaskBar();
      ev.preventDefault();
    } else if (checkKeyCombo(ev, keys.addNewProject)) {
      if (this._matDialog.openDialogs.length === 0) {
        this._matDialog.open(DialogCreateProjectComponent, { restoreFocus: true });
        ev.preventDefault();
      }
    } else if (checkKeyCombo(ev, keys.addNewNote)) {
      if (this._matDialog.openDialogs.length === 0) {
        this._matDialog.open(DialogAddNoteComponent, {
          minWidth: '100vw',
          height: '100vh',
          restoreFocus: true,
          autoFocus: 'textarea',
        });
        ev.preventDefault();
      }
    } else if (checkKeyCombo(ev, keys.openProjectNotes)) {
      ev.preventDefault();
      this._layoutService.toggleNotes();
    } else if (checkKeyCombo(ev, keys.toggleTaskViewCustomizerPanel)) {
      ev.preventDefault();
      this._layoutService.toggleTaskViewCustomizerPanel();
    } else if (checkKeyCombo(ev, keys.toggleIssuePanel)) {
      ev.preventDefault();
      this._layoutService.toggleAddTaskPanel();
    } else if (checkKeyCombo(ev, keys.triggerSync)) {
      ev.preventDefault();
      if (await this._syncWrapperService.isEnabledAndReady$.pipe(first()).toPromise()) {
        this._syncWrapperService.sync();
      }
    } else if (
      checkKeyCombo(ev, 'Ctrl+Shift+*') &&
      document.activeElement &&
      document.activeElement.getAttribute('routerlink') === '/procrastination'
    ) {
      throw new Error('Intentional Error Fun (dont worry)');
    }

    // special hidden dev tools combo to use them for production
    if (IS_ELECTRON) {
      if (checkKeyCombo(ev, 'Ctrl+Shift+J')) {
        window.ea.openDevTools();
      } else if (checkKeyCombo(ev, keys.zoomIn)) {
        this._uiHelperService.zoomBy(0.05);
      } else if (checkKeyCombo(ev, keys.zoomOut)) {
        this._uiHelperService.zoomBy(-0.05);
      } else if (checkKeyCombo(ev, keys.zoomDefault)) {
        this._uiHelperService.zoomTo(1);
      }
    }

    // Handle task-specific shortcuts
    if (this._taskShortcutService.handleTaskShortcuts(ev)) {
      return;
    }

    // Check plugin shortcuts (exec last)
    const pluginShortcuts = this._pluginBridgeService.shortcuts();
    for (const shortcut of pluginShortcuts) {
      const shortcutKey = `plugin_${shortcut.pluginId}:${shortcut.id}`;
      const shortcutKeyCombo = (keys as any)[shortcutKey];
      if (shortcutKeyCombo && checkKeyCombo(ev, shortcutKeyCombo)) {
        ev.preventDefault();
        this._pluginBridgeService.executeShortcut(`${shortcut.pluginId}:${shortcut.id}`);
        return;
      }
    }
  }

  private _focusSideNav(): void {
    this._layoutService.focusSideNav();
  }

  private _hasOpenCdkOverlay(): boolean {
    const containerEl = this._overlayContainer.getContainerElement();
    // NOTE: All CDK class name knowledge is encapsulated here to ease future updates.
    return Array.from(containerEl.children).some((child) => {
      return (
        child.classList.contains(CDK_OVERLAY_PANE_CLASS) && child.childElementCount > 0
      );
    });
  }

  private _isEventFromOverlay(ev: KeyboardEvent): boolean {
    const path = (typeof ev.composedPath === 'function' && ev.composedPath()) || [];
    for (const node of path) {
      if (
        node instanceof HTMLElement &&
        node.classList.contains(CDK_OVERLAY_PANE_CLASS)
      ) {
        return true;
      }
    }
    const target = ev.target as HTMLElement | null;
    return !!target?.closest(`.${CDK_OVERLAY_CONTAINER_CLASS}`);
  }
}
