import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { TaskDetailTargetPanel, TaskWithSubTasks } from '../tasks/task.model';
import { filter, map, startWith } from 'rxjs/operators';
import { TaskService } from '../tasks/task.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { slideInFromTopAni } from '../../ui/animations/slide-in-from-top.ani';
import { slideInFromRightAni } from '../../ui/animations/slide-in-from-right.ani';
import { taskDetailPanelTaskChangeAnimation } from '../tasks/task-detail-panel/task-detail-panel.ani';
import { IssuePanelComponent } from '../issue-panel/issue-panel.component';
import { NotesComponent } from '../note/notes/notes.component';
import { TaskDetailPanelComponent } from '../tasks/task-detail-panel/task-detail-panel.component';
import { PluginService } from '../../plugins/plugin.service';
import { PluginPanelContainerComponent } from '../../plugins/ui/plugin-panel-container/plugin-panel-container.component';
import { ScheduleDayPanelComponent } from '../schedule/schedule-day-panel/schedule-day-panel.component';
import { Store } from '@ngrx/store';
import {
  INITIAL_LAYOUT_STATE,
  selectActivePluginId,
  selectIsShowPluginPanel,
  selectLayoutFeatureState,
} from '../../core-ui/layout/store/layout.reducer';
import { hidePluginPanel } from '../../core-ui/layout/store/layout.actions';
import { Log } from '../../core/log';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { isTouchActive } from '../../util/input-intent';
import { PanelContentService, PanelContentType } from '../panels/panel-content.service';

// Keep in sync with CSS var --transition-duration-m
const CLOSE_ANIMATION_MS = 225;

// Narrow the panel type to a reusable alias for clarity
export type RightPanelContentPanelType = PanelContentType;

@Component({
  selector: 'right-panel-content',
  templateUrl: './right-panel-content.component.html',
  styleUrls: ['./right-panel-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    taskDetailPanelTaskChangeAnimation,
    slideInFromTopAni,
    slideInFromRightAni,
  ],
  imports: [
    IssuePanelComponent,
    NotesComponent,
    TaskDetailPanelComponent,
    PluginPanelContainerComponent,
    ScheduleDayPanelComponent,
  ],
})
export class RightPanelContentComponent implements OnDestroy {
  taskService = inject(TaskService);
  layoutService = inject(LayoutService);
  pluginService = inject(PluginService);
  store = inject(Store);
  private _router = inject(Router);
  private _panelContentService = inject(PanelContentService);

  // Convert observables to signals
  private readonly _selectedTask = toSignal(this.taskService.selectedTask$, {
    initialValue: null,
  });

  private readonly _taskDetailPanelTargetPanel = toSignal(
    this.taskService.taskDetailPanelTargetPanel$,
    { initialValue: null },
  );

  private readonly _layoutFeatureState = toSignal(
    this.store.select(selectLayoutFeatureState),
    {
      initialValue: INITIAL_LAYOUT_STATE,
    },
  );

  private readonly _isShowPluginPanel = toSignal(
    this.store.select(selectIsShowPluginPanel),
    { initialValue: false },
  );

  private readonly _activePluginId = toSignal(this.store.select(selectActivePluginId), {
    initialValue: null,
  });

  // to still display its data when panel is closing
  private _selectedTaskDelayedSignal = signal<TaskWithSubTasks | null>(null);

  // Delayed signals for panel type and plugin id to keep content visible during close animation
  private _delayedPanelType = signal<RightPanelContentPanelType | null>(null);
  private _delayedActivePluginId = signal<string | null>(null);

  // Effect to handle delayed task clearing
  private _selectedTaskDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private _panelTypeDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private _selectedTaskDelayEffect = effect(() => {
    const task = this._selectedTask();

    // Clear any existing timer
    if (this._selectedTaskDelayTimer) {
      clearTimeout(this._selectedTaskDelayTimer);
      this._selectedTaskDelayTimer = null;
    }

    if (task) {
      this._selectedTaskDelayedSignal.set(task);
    } else {
      // Delay clearing the task to allow animations
      this._selectedTaskDelayTimer = setTimeout(() => {
        this._selectedTaskDelayedSignal.set(null);
      }, 200);
    }
  });

  readonly selectedTaskWithDelayForNone = computed(() =>
    this._selectedTaskDelayedSignal(),
  );

  // Effect to handle delayed panel type clearing
  private _panelTypeDelayEffect = effect(() => {
    this._updatePanelTypeWithDelay();
  });

  // Computed signal for panel content using delayed panel type exclusively
  readonly panelContent = computed<RightPanelContentPanelType | undefined>(
    () => this._delayedPanelType() ?? undefined,
  );

  // Computed signal that includes plugin ID for component recreation
  readonly pluginPanelKeys = computed<string[]>(() => {
    const delayedType = this._delayedPanelType();
    const activePluginId = this._delayedActivePluginId() || this._activePluginId();
    return delayedType === 'PLUGIN' && activePluginId ? [`plugin-${activePluginId}`] : [];
  });

  // Signal to track current route
  private readonly _currentRoute = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this._router.url),
    ),
    { initialValue: this._router.url },
  );

  // Computed signal for panel open state
  readonly isOpen = computed<boolean>(() => {
    const selectedTask = this._selectedTask();
    const targetPanel = this._taskDetailPanelTargetPanel();
    const layoutState = this._layoutFeatureState();
    const currentRoute = this._currentRoute();

    if (!layoutState) {
      return false;
    }

    const {
      isShowNotes,
      isShowIssuePanel: isShowAddTaskPanel,
      isShowTaskViewCustomizerPanel,
      isShowPluginPanel,
      isShowScheduleDayPanel,
    } = layoutState;

    const isWorkView = this._isWorkViewUrl(currentRoute);

    // For non-work-view routes, only allow panels that are explicitly opened
    // This prevents panels from persisting when navigating from work-view to non-work-view
    if (!isWorkView) {
      // You might want to allow certain panels on non-work-view routes
      // For now, let's allow all panels but they'll be in "over" mode
    }

    return (
      !!(
        selectedTask ||
        isShowNotes ||
        isShowAddTaskPanel ||
        isShowTaskViewCustomizerPanel ||
        isShowPluginPanel ||
        isShowScheduleDayPanel
      ) && targetPanel !== TaskDetailTargetPanel.DONT_OPEN_PANEL
    );
  });

  // NOTE: prevents the inner animation from happening file panel is expanding
  readonly isDisableTaskPanelAni = signal(true);

  // Track previous isOpen state to avoid infinite loops
  private _previousIsOpen = signal<boolean | null>(null);

  // Effect to handle panel close
  private _isOpenEffect = effect(() => {
    const isOpen = this.isOpen();
    const previousIsOpen = this._previousIsOpen();

    // Only trigger onClose when transitioning from open to closed
    if (previousIsOpen === true && isOpen === false) {
      // Use setTimeout to avoid triggering state changes during effect execution
      setTimeout(() => this.onClose(), 0);
    }

    this._previousIsOpen.set(isOpen);
  });

  // Effect to handle animation state with delay
  private _animationTimer: ReturnType<typeof setTimeout> | null = null;
  private _animationEffect = effect(() => {
    const isOpen = this.isOpen();

    // Clear any existing timer
    if (this._animationTimer) {
      clearTimeout(this._animationTimer);
      this._animationTimer = null;
    }

    // Delay is needed for timing
    this._animationTimer = setTimeout(() => {
      this.isDisableTaskPanelAni.set(!isOpen);
    }, 500);
  });

  // Signal to track previous route for navigation handling
  private _previousRoute = signal<{ url: string; isWorkView: boolean } | null>(null);

  // Effect for navigation handling
  private _navigationEffect = effect(() => {
    const currentRoute = this._currentRoute();
    const isCurrentWorkView = this._isWorkViewUrl(currentRoute);

    untracked(() => {
      const prev = this._previousRoute();

      if (prev) {
        // Only close panel when navigating FROM work-view TO non-work-view
        // Never close when navigating between work-views or to a work-view
        const shouldClose = prev.isWorkView && !isCurrentWorkView;

        // Debug logging
        if (shouldClose) {
          Log.log('RightPanel: Closing panel on navigation', {
            from: prev.url,
            to: currentRoute,
            fromIsWorkView: prev.isWorkView,
            toIsWorkView: isCurrentWorkView,
          });
          // Close all panels immediately when navigating away from work views
          // to prevent the overlay mode from briefly showing
          this.close();
        }
      }

      // Update previous route
      this._previousRoute.set({ url: currentRoute, isWorkView: isCurrentWorkView });
    });
  });

  ngOnDestroy(): void {
    // Clean up timers to prevent memory leaks
    if (this._selectedTaskDelayTimer) {
      clearTimeout(this._selectedTaskDelayTimer);
      this._selectedTaskDelayTimer = null;
    }
    if (this._panelTypeDelayTimer) {
      clearTimeout(this._panelTypeDelayTimer);
      this._panelTypeDelayTimer = null;
    }
    if (this._animationTimer) {
      clearTimeout(this._animationTimer);
      this._animationTimer = null;
    }
  }

  private _isWorkViewUrl(url: string): boolean {
    return url.includes('/active/') || url.includes('/tag/') || url.includes('/project/');
  }

  close(): void {
    this.taskService.setSelectedId(null);
    this.layoutService.hideNotes();
    this.layoutService.hideAddTaskPanel();
    this.layoutService.hideTaskViewCustomizerPanel();
    this.layoutService.hideScheduleDayPanel();
    this.store.dispatch(hidePluginPanel());
    this.onClose();
  }

  onClose(): void {
    // Only restore focus on non-touch devices to prevent scroll position loss
    if (!isTouchActive()) {
      this.taskService.focusLastFocusedTask();
    }
  }

  private _updatePanelTypeWithDelay(): void {
    const currentPanelType = this._panelContentService.getCurrentPanelType();
    this._clearPanelTypeTimer();

    if (currentPanelType) {
      this._setPanelTypeImmediately(currentPanelType);
    } else {
      this._scheduleDelayedPanelTypeClearing();
    }
  }

  // panel type resolution moved to PanelContentService

  private _clearPanelTypeTimer(): void {
    if (this._panelTypeDelayTimer) {
      clearTimeout(this._panelTypeDelayTimer);
      this._panelTypeDelayTimer = null;
    }
  }

  private _setPanelTypeImmediately(panelType: RightPanelContentPanelType): void {
    this._delayedPanelType.set(panelType);

    // Keep plugin id up to date while plugin panel is active
    if (panelType === 'PLUGIN') {
      const pid = this._activePluginId();
      if (pid) {
        this._delayedActivePluginId.set(pid);
      }
    }
  }

  private _scheduleDelayedPanelTypeClearing(): void {
    const currentDelayedType = this._delayedPanelType();
    if (currentDelayedType) {
      // Delay clearing the panel type (and plugin id) to allow close animation to play with content visible
      this._panelTypeDelayTimer = setTimeout(() => {
        this._delayedPanelType.set(null);
        this._delayedActivePluginId.set(null);
      }, CLOSE_ANIMATION_MS);
    }
  }
}
