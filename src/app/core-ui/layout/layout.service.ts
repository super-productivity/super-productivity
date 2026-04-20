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

const XS_BREAKPOINT = 600;
const XXXS_BREAKPOINT = 398;
const XS_MEDIA_QUERY = `(max-width: ${XS_BREAKPOINT}px)`;
const initialXsMatch =
  typeof window !== 'undefined' ? window.matchMedia(XS_MEDIA_QUERY).matches : false;

@Injectable({
  providedIn: 'root',
})
export class LayoutService {
  private static readonly _TASK_ACTION_DELAY = 50;
  private static readonly _TASK_FOCUS_RETRY_DELAY = 250;
  private static readonly _TASK_FOCUS_MAX_RETRIES = 16;

  private _store$ = inject<Store<LayoutState>>(Store);
  private _breakPointObserver = inject(BreakpointObserver);
  private _previouslyFocusedElement: HTMLElement | null = null;
  private _pendingFocusTaskId: string | null = null; // store new task id until user closes the bar
  private _pendingTaskRevealTimeout?: number;

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

    // Focus the last-created (or previously-focused) task with preventScroll
    // so keyboard navigation works without causing a scroll jump.
    // The actual scroll already happened when the task was added (see
    // scrollToNewTask).
    if (focusTaskId) {
      this._runForTaskElement(
        focusTaskId,
        (newTaskElement) => {
          newTaskElement.focus({ preventScroll: true });
          this._previouslyFocusedElement = null;
        },
        () => this._focusPreviousTaskOrFallback(),
      );
      return;
    }

    window.setTimeout(() => {
      this._focusPreviousTaskOrFallback();
    }, LayoutService._TASK_ACTION_DELAY);
  }

  scrollToNewTask(taskId: string): void {
    this._runForTaskElement(taskId, (el) => {
      this._scrollTaskElementIntoView(el);
    });
  }

  focusTaskInViewIfPossible(taskId: string): HTMLElement | null {
    const el = document.getElementById(`t-${taskId}`);
    if (!el || !this._isTaskElementReady(el)) {
      return null;
    }

    this._scrollTaskElementIntoView(el);
    el.focus({ preventScroll: true });
    return el;
  }

  focusTaskInViewWhenReady(
    taskId: string,
    onSuccess?: (el: HTMLElement) => void,
    retriesLeft: number = LayoutService._TASK_FOCUS_MAX_RETRIES,
  ): void {
    if (this._pendingTaskRevealTimeout) {
      window.clearTimeout(this._pendingTaskRevealTimeout);
      this._pendingTaskRevealTimeout = undefined;
    }

    const el = this.focusTaskInViewIfPossible(taskId);
    if (el) {
      onSuccess?.(el);
      return;
    }

    if (retriesLeft <= 0) {
      return;
    }

    this._pendingTaskRevealTimeout = window.setTimeout(() => {
      this._pendingTaskRevealTimeout = undefined;
      this.focusTaskInViewWhenReady(taskId, onSuccess, retriesLeft - 1);
    }, LayoutService._TASK_FOCUS_RETRY_DELAY);
  }

  private _runForTaskElement(
    taskId: string,
    cb: (el: HTMLElement) => void,
    onNotFound?: () => void,
  ): void {
    window.setTimeout(() => {
      const el = document.getElementById(`t-${taskId}`);
      if (el && this._isTaskElementReady(el)) {
        cb(el);
      } else {
        onNotFound?.();
      }
    }, LayoutService._TASK_ACTION_DELAY);
  }

  private _isTaskElementReady(el: HTMLElement): boolean {
    return (
      document.body.contains(el) &&
      el.getClientRects().length > 0 &&
      el.getBoundingClientRect().height > 0
    );
  }

  private _scrollTaskElementIntoView(el: HTMLElement): void {
    const scrollContainer = this._getNearestScrollableAncestor(el);
    if (!scrollContainer) {
      el.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
      });
      return;
    }

    const elementRect = el.getBoundingClientRect();
    const relativeTop = el.offsetTop - scrollContainer.offsetTop;
    const containerCenterOffset = scrollContainer.clientHeight / 2;
    const elementCenterOffset = elementRect.height / 2;
    const centeredTop = relativeTop - containerCenterOffset + elementCenterOffset;
    scrollContainer.scrollTop = Math.max(centeredTop, 0);
  }

  private _getNearestScrollableAncestor(el: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = el.parentElement;

    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        current.scrollHeight > current.clientHeight
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  private _focusPreviousTaskOrFallback(): void {
    if (
      this._previouslyFocusedElement &&
      document.body.contains(this._previouslyFocusedElement)
    ) {
      this._previouslyFocusedElement.focus({ preventScroll: true });
      this._previouslyFocusedElement = null;
      return;
    }

    // Final fallback to keep keyboard navigation working.
    const tEl = document.getElementsByTagName('task');
    if (tEl && tEl[0]) {
      (tEl[0] as HTMLElement).focus({ preventScroll: true });
    }
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
