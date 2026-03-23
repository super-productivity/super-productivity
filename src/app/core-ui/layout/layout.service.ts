import { computed, inject, Injectable, signal } from '@angular/core';
import {
  hideAddTaskBar,
  hideIssuePanel,
  hideNonTaskSidePanelContent,
  hideTaskViewCustomizerPanel,
  showAddTaskBar,
  toggleIssuePanel,
  toggleShowNotes,
  toggleTaskViewCustomizerPanel,
  toggleScheduleDayPanel,
  hideScheduleDayPanel,
} from './store/layout.actions';
import { Observable } from 'rxjs';
import { select, Store } from '@ngrx/store';
import {
  LayoutState,
  selectIsShowAddTaskBar,
  selectIsShowIssuePanel,
  selectIsShowNotes,
  selectIsShowTaskViewCustomizerPanel,
  selectIsShowScheduleDayPanel,
} from './store/layout.reducer';
import { map } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../../features/tasks/task.service';

const XS_BREAKPOINT = 600;
const XXXS_BREAKPOINT = 398;
const XS_MEDIA_QUERY = `(max-width: ${XS_BREAKPOINT}px)`;
const initialXsMatch =
  typeof window !== 'undefined' ? window.matchMedia(XS_MEDIA_QUERY).matches : false;

@Injectable({
  providedIn: 'root',
})
export class LayoutService {
  private _store$ = inject<Store<LayoutState>>(Store);
  private _breakPointObserver = inject(BreakpointObserver);
  private _taskService = inject(TaskService);
  private _previouslyFocusedElement: HTMLElement | null = null;
  private _pendingFocusTaskId: string | null = null; // store new task id until user closes the bar

  // Signal to trigger sidebar focus
  private _focusSideNavTrigger = signal(0);
  readonly focusSideNavTrigger = this._focusSideNavTrigger.asReadonly();

  // Observable versions (needed for shepherd)
  readonly isShowAddTaskBar$: Observable<boolean> = this._store$.pipe(
    select(selectIsShowAddTaskBar),
  );
  readonly isShowIssuePanel$: Observable<boolean> = this._store$.pipe(
    select(selectIsShowIssuePanel),
  );

  readonly selectedTimeView = signal<'week' | 'month'>('week');
  readonly isWorkViewScrolled = signal<boolean>(false);
  readonly isShowAddTaskBar = toSignal(this.isShowAddTaskBar$, { initialValue: false });

  readonly isXs = toSignal(
    this._breakPointObserver
      .observe(XS_MEDIA_QUERY)
      .pipe(map((result) => result.matches)),
    { initialValue: initialXsMatch },
  );

  readonly isXxxs = toSignal(
    this._breakPointObserver
      .observe(`(max-width: ${XXXS_BREAKPOINT}px)`)
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  // Computed signal for mobile bottom nav visibility
  // Shows bottom nav on small screens (< 600px)
  readonly isShowMobileBottomNav = computed(() => {
    return this.isXs();
  });

  // private _isWorkViewUrl(url: string): boolean {
  //   return url.includes('/active/') || url.includes('/tag/') || url.includes('/project/');
  // }

  readonly isShowNotes = toSignal(this._store$.pipe(select(selectIsShowNotes)), {
    initialValue: false,
  });

  readonly isShowTaskViewCustomizerPanel = toSignal(
    this._store$.pipe(select(selectIsShowTaskViewCustomizerPanel)),
    { initialValue: false },
  );

  readonly isShowIssuePanel = toSignal(this.isShowIssuePanel$, { initialValue: false });

  readonly isShowScheduleDayPanel = toSignal(
    this._store$.pipe(select(selectIsShowScheduleDayPanel)),
    { initialValue: false },
  );

  // Signal to track if any panel is currently being resized
  readonly isPanelResizing = signal(false);

  showAddTaskBar(): void {
    // Store currently focused element if it's a task
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.id && activeElement.id.startsWith('t-')) {
      this._previouslyFocusedElement = activeElement;
    }
    this._store$.dispatch(showAddTaskBar());
  }

  setPendingFocusTaskId(taskId: string | null): void {
    // Add-task bar can emit multiple creations before user closes it; remember the last one.
    this._pendingFocusTaskId = taskId;
  }

  hideAddTaskBar(newTaskId?: string): void {
    this._store$.dispatch(hideAddTaskBar());
    const focusTaskId = newTaskId ?? this._pendingFocusTaskId ?? undefined;
    this._pendingFocusTaskId = null;
    // Wait a moment so the DOM can render the new task before we try to focus anything.
    window.setTimeout(() => {
      if (focusTaskId) {
        const newTaskElement = document.getElementById(`t-${focusTaskId}`);
        if (newTaskElement) {
          // Highest priority: focus the task that was just created (either passed explicitly
          // or remembered via setPendingFocusTaskId).
          this._taskService.focusTaskIfPossible(focusTaskId);
          this._previouslyFocusedElement = null;
          return;
        }
      }

      if (
        this._previouslyFocusedElement &&
        document.body.contains(this._previouslyFocusedElement)
      ) {
        // Fallback: restore the element that had focus before opening the add-task bar.
        this._previouslyFocusedElement.focus();
        this._previouslyFocusedElement = null;
        return;
      }

      // Final fallback to keep keyboard navigation working even if nothing else is focusable.
      this._taskService.focusFirstTaskIfVisible();
    }, 50);
  }

  toggleNotes(): void {
    this._store$.dispatch(toggleShowNotes());
  }

  hideNotes(): void {
    this._store$.dispatch(hideNonTaskSidePanelContent());
  }

  toggleAddTaskPanel(): void {
    this._store$.dispatch(toggleIssuePanel());
  }

  hideAddTaskPanel(): void {
    this._store$.dispatch(hideIssuePanel());
  }

  toggleTaskViewCustomizerPanel(): void {
    this._store$.dispatch(toggleTaskViewCustomizerPanel());
  }

  hideTaskViewCustomizerPanel(): void {
    this._store$.dispatch(hideTaskViewCustomizerPanel());
  }

  focusSideNav(): void {
    // Trigger the focus signal - components listening to this signal will handle the focus
    this._focusSideNavTrigger.update((value) => value + 1);
  }

  // Schedule Day Panel controls
  toggleScheduleDayPanel(): void {
    this._store$.dispatch(toggleScheduleDayPanel());
  }

  hideScheduleDayPanel(): void {
    this._store$.dispatch(hideScheduleDayPanel());
  }
}
