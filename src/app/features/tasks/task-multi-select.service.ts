import { computed, Injectable, signal } from '@angular/core';

export type MultiSelectDirection = 'up' | 'down';

/**
 * Transient multi-selection of task rows ("select several tasks, edit them
 * once"). Deliberately named *multi-select* so it can never be confused with
 * `TaskState.selectedTaskId`, which is the task whose detail panel is open.
 *
 * - UI-only: not in NgRx state, never persisted, never synced. Pure state with
 *   no injected dependencies; the app-shell bar component wires the clearing
 *   on route and work-context change (TaskMultiSelectBarComponent).
 * - Only ever holds ids of tasks currently rendered as a `<task>` row; rows
 *   prune themselves on destroy.
 * - Ranges and keyboard extension are scoped to the anchor's list, i.e. the
 *   direct `<task>` children of its `.task-list-inner`, so expanded subtasks
 *   of other parents are never swept in.
 */
@Injectable({
  providedIn: 'root',
})
export class TaskMultiSelectService {
  private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());
  private readonly _anchorId = signal<string | null>(null);
  private readonly _menuOpenRequest = signal<{ x: number; y: number } | null>(null);
  private readonly _isBulkFeedbackSuppressed = signal(false);
  private readonly _isTouchSelectionMode = signal(false);
  private readonly _pendingRemovals = new Set<string>();

  readonly selectedIds = this._selectedIds.asReadonly();
  readonly anchorId = this._anchorId.asReadonly();
  readonly count = computed(() => this._selectedIds().size);
  readonly isActive = computed(() => this._selectedIds().size > 0);
  /** Set when a selected row asks for the bulk menu (right-click / Q). */
  readonly menuOpenRequest = this._menuOpenRequest.asReadonly();
  /**
   * True while a bulk action dispatches its per-task loop. Per-task snackbars
   * and the done sound check this so one summary replaces N notifications.
   * Lives here (not on the bulk action service) so effects only depend on
   * this small service.
   */
  readonly isBulkFeedbackSuppressed = this._isBulkFeedbackSuppressed.asReadonly();
  /**
   * Explicit selection mode for touch, where there is no modifier key: rows
   * show a selection ring, a tap toggles, swipe / drag / title edit are
   * suspended. Entered from the task context menu; left via the bar's ✕,
   * Android back or Esc. Deselecting the last task keeps the mode.
   */
  readonly isTouchSelectionMode = this._isTouchSelectionMode.asReadonly();
  /**
   * Something is selected or touch selection mode is on: the bar shows, Esc /
   * Android back clear, and the app shell carries `.is-multi-selecting`.
   */
  readonly isSelecting = computed(
    () => this._selectedIds().size > 0 || this._isTouchSelectionMode(),
  );

  has(id: string): boolean {
    return this._selectedIds().has(id);
  }

  selectedIdsInDomOrder(): string[] {
    const selected = this._selectedIds();
    if (!selected.size) {
      return [];
    }
    const ordered: string[] = [];
    const seen = new Set<string>();
    this._getAllTaskEls().forEach((el) => {
      const id = el.getAttribute('data-task-id');
      if (id && selected.has(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    });
    // Ids without a rendered row are appended so nothing silently vanishes.
    selected.forEach((id) => {
      if (!seen.has(id)) {
        ordered.push(id);
      }
    });
    return ordered;
  }

  /**
   * Id of the focused main-list row, or null when focus is elsewhere or on a
   * detail-panel copy. The single source for "which row do selection keys act
   * on" so the shortcut layer and this service can never disagree.
   */
  focusedRowId(): string | null {
    return this._focusedRow()?.id ?? null;
  }

  /** Ctrl/Cmd+click and `X`: toggle one task, which becomes the anchor. */
  toggle(id: string): void {
    const next = new Set(this._selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this._selectedIds.set(next);
    this._anchorId.set(next.has(id) ? id : this._anchorId());
    if (!next.size) {
      this._anchorId.set(null);
    }
  }

  /**
   * Shift+click: select everything between the anchor and `targetId` in the
   * anchor's list, replacing the selection. Without an anchor, or when the
   * target sits in a different list, the target becomes the new anchor.
   */
  selectRange(targetId: string, isAdditive = false): void {
    const anchorId = this._anchorId();
    const range = anchorId ? this._rangeInAnchorList(anchorId, targetId) : null;
    if (!range) {
      this._selectedIds.set(new Set([targetId]));
      this._anchorId.set(targetId);
      return;
    }
    const next = isAdditive ? new Set(this._selectedIds()) : new Set<string>();
    range.forEach((id) => next.add(id));
    this._selectedIds.set(next);
  }

  /**
   * Shift+Arrow: move focus to the neighbouring row in the same list and
   * extend (or shrink) the selection from the anchor to it.
   * Returns the element that received focus, or null when at the list edge.
   */
  extendFromFocused(direction: MultiSelectDirection): HTMLElement | null {
    const focused = this._focusedRow();
    if (!focused) {
      return null;
    }
    const { el: focusedEl, id: focusedId } = focused;
    if (!this._anchorId() || !this._selectedIds().size) {
      this._selectedIds.set(new Set([focusedId]));
      this._anchorId.set(focusedId);
    }
    const siblings = this._listRowsFor(focusedEl);
    const index = siblings.indexOf(focusedEl);
    const nextEl = siblings[direction === 'down' ? index + 1 : index - 1];
    const nextId = nextEl?.getAttribute('data-task-id');
    if (!nextEl || !nextId) {
      return null;
    }
    this.selectRange(nextId);
    nextEl.focus();
    return nextEl;
  }

  enterTouchSelectionMode(initialId?: string): void {
    this._isTouchSelectionMode.set(true);
    if (initialId && !this._selectedIds().has(initialId)) {
      this.toggle(initialId);
    }
  }

  setBulkFeedbackSuppressed(isSuppressed: boolean): void {
    this._isBulkFeedbackSuppressed.set(isSuppressed);
  }

  /** Ctrl/Cmd+A: select every row of the focused row's list; it becomes the anchor. */
  selectAllInListOfFocused(): void {
    const focused = this._focusedRow();
    if (!focused) {
      return;
    }
    const { el: focusedEl, id: focusedId } = focused;
    const ids = this._listRowsFor(focusedEl)
      .map((el) => el.getAttribute('data-task-id'))
      .filter((id): id is string => !!id);
    this._selectedIds.set(new Set(ids));
    this._anchorId.set(focusedId);
  }

  /**
   * Called by a `<task>` row on destroy. A row is destroyed when it moves to
   * another list (done → done list), when a detail-panel copy goes away, or on
   * a re-render — none of which end the selection. So the id is dropped on the
   * next macrotask only if no rendered row carries it any more.
   */
  removeWhenUnrendered(id: string): void {
    if (!this._selectedIds().has(id) || this._pendingRemovals.has(id)) {
      return;
    }
    this._pendingRemovals.add(id);
    setTimeout(() => {
      this._pendingRemovals.delete(id);
      if (!this._findRowEl(id)) {
        this.remove(id);
      }
    });
  }

  /** Drops one id immediately. */
  remove(id: string): void {
    if (!this._selectedIds().has(id)) {
      return;
    }
    const next = new Set(this._selectedIds());
    next.delete(id);
    this._selectedIds.set(next);
    if (this._anchorId() === id) {
      this._anchorId.set(null);
    }
  }

  /** Drop every id that is not in `existingIds` (e.g. after a bulk action). */
  prune(existingIds: ReadonlySet<string>): void {
    const current = this._selectedIds();
    const next = new Set<string>();
    current.forEach((id) => {
      if (existingIds.has(id)) {
        next.add(id);
      }
    });
    if (next.size !== current.size) {
      this._selectedIds.set(next);
    }
    const anchorId = this._anchorId();
    if (anchorId && !next.has(anchorId)) {
      this._anchorId.set(null);
    }
  }

  /** Empties the selection and leaves touch selection mode. */
  clear(): void {
    if (this._selectedIds().size) {
      this._selectedIds.set(new Set());
    }
    this._anchorId.set(null);
    this._menuOpenRequest.set(null);
    this._isTouchSelectionMode.set(false);
  }

  requestMenuOpen(pos: { x: number; y: number }): void {
    this._menuOpenRequest.set(pos);
  }

  consumeMenuOpenRequest(): void {
    this._menuOpenRequest.set(null);
  }

  private _rangeInAnchorList(anchorId: string, targetId: string): string[] | null {
    const anchorEl = this._findRowEl(anchorId);
    if (!anchorEl) {
      return null;
    }
    const rows = this._listRowsFor(anchorEl);
    const anchorIndex = rows.indexOf(anchorEl);
    const targetIndex = rows.findIndex(
      (el) => el.getAttribute('data-task-id') === targetId,
    );
    if (anchorIndex === -1 || targetIndex === -1) {
      return null;
    }
    const [from, to] =
      anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    return rows
      .slice(from, to + 1)
      .map((el) => el.getAttribute('data-task-id'))
      .filter((id): id is string => !!id);
  }

  /** The focused main-list row (detail-panel copies are never selectable). */
  private _focusedRow(): { el: HTMLElement; id: string } | null {
    const el = document.activeElement?.closest('task') as HTMLElement | null;
    const id = el?.getAttribute('data-task-id');
    if (!el || !id || el.closest('task-detail-panel')) {
      return null;
    }
    return { el, id };
  }

  /** Direct `<task>` children of the list that contains `el`. */
  private _listRowsFor(el: HTMLElement): HTMLElement[] {
    const list = el.parentElement?.closest('.task-list-inner');
    if (!list) {
      return [el];
    }
    return Array.from(list.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName.toLowerCase() === 'task',
    );
  }

  /** The rendered row for a task id, ignoring copies inside the detail panel. */
  private _findRowEl(id: string): HTMLElement | null {
    return (
      this._getAllTaskEls().find((el) => el.getAttribute('data-task-id') === id) ?? null
    );
  }

  private _getAllTaskEls(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('task')).filter(
      (el) => !el.closest('task-detail-panel'),
    );
  }
}
