import { computed, Injectable, signal } from '@angular/core';

export type MultiSelectDirection = 'up' | 'down';

/** The containers a selection can be scoped to: one board panel, one Planner day, one task list. */
const SELECTION_SCOPE_SELECTOR =
  '[data-board-selection-scope], [data-planner-selection-scope], .task-list-inner';

/**
 * Transient multi-selection of task rows ("select several tasks, edit them
 * once"). Deliberately named *multi-select* so it can never be confused with
 * `TaskState.selectedTaskId`, which is the task whose detail panel is open.
 *
 * - UI-only: not in NgRx state, never persisted, never synced. Pure state with
 *   no injected dependencies; the app-shell bar component wires the clearing
 *   on route and work-context change (TaskMultiSelectBarComponent).
 * - Only ever holds ids of tasks currently rendered as a participating row; rows
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
  /**
   * Where the next Shift+click / Shift+Arrow range starts, plus the row it was
   * set from. Purely a cursor: it is dropped the moment its row is deselected,
   * and is always null while nothing is selected.
   */
  private readonly _anchor = signal<{ id: string; row: HTMLElement | null } | null>(null);
  /**
   * The list the current selection lives in, remembered so `selectionScope()`
   * still answers once focus has moved into the bulk menu or a dialog.
   *
   * This belongs to the SELECTION, not to the anchor: it outlives the anchor
   * being deselected and is dropped only when the selection itself goes. The
   * two used to share a lifetime, which is what made "drop the anchor"
   * ambiguous about whether the scope went with it — and a scope that wrongly
   * survives, or wrongly dies, silently sends post-action keyboard focus to
   * the wrong panel or nowhere at all.
   */
  private _selectionScopeEl: HTMLElement | null = null;
  private readonly _menuOpenRequest = signal<{ x: number; y: number } | null>(null);
  private readonly _bulkFeedbackSuppressionDepth = signal(0);
  private readonly _isTouchSelectionMode = signal(false);
  private readonly _pendingRemovals = new Set<string>();
  /**
   * Hosts of destroyed `<task>` components. The list's leave animation keeps
   * a destroyed host in the DOM for a moment, so "is there a row?" must never
   * count these (they cannot be focused or acted on).
   */
  private readonly _destroyedHosts = new WeakSet<Element>();

  readonly selectedIds = this._selectedIds.asReadonly();
  readonly anchorId = computed(() => this._anchor()?.id ?? null);
  readonly count = computed(() => this._selectedIds().size);
  readonly isActive = computed(() => this._selectedIds().size > 0);
  /** Set when a selected row asks for the bulk menu (right-click / Q). */
  readonly menuOpenRequest = this._menuOpenRequest.asReadonly();
  /**
   * True while at least one bulk action dispatches its per-task loop. Per-task
   * snackbars and the done sound check this so one summary replaces N
   * notifications.
   * Lives here (not on the bulk action service) so effects only depend on
   * this small service.
   */
  readonly isBulkFeedbackSuppressed = computed(
    () => this._bulkFeedbackSuppressionDepth() > 0,
  );
  /**
   * Explicit selection mode for touch, where there is no modifier key: rows
   * show a selection ring, a tap toggles, swipe / drag / title edit are
   * suspended. Entered from the task context menu with one task selected.
   * Transient like an Android contextual action bar: it ends with the last
   * deselection, a completed bulk action, the bar's ✕, Android back or Esc.
   * Never on with an empty selection.
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

  /** Retain the originating list while focus is in the bulk menu or a dialog. */
  selectionScope(): HTMLElement | null {
    return (
      this._focusedRow()?.el.closest<HTMLElement>(SELECTION_SCOPE_SELECTOR) ??
      this._selectionScopeEl
    );
  }

  /** Preserve the range anchor when its selected group moves to another panel. */
  reanchorAfterMove(movedIds: readonly string[], rows: readonly HTMLElement[]): void {
    const anchorId = this.anchorId();
    if (!anchorId || !this.has(anchorId) || !movedIds.includes(anchorId)) return;
    const anchorRow = rows.find(
      (row) =>
        row.dataset.taskId === anchorId &&
        row.isConnected &&
        !this._destroyedHosts.has(row),
    );
    if (anchorRow) this._setAnchor(anchorId, anchorRow);
  }

  /** Ctrl/Cmd+click and `X`: toggle one task, which becomes the anchor. */
  toggle(id: string): void {
    const next = new Set(this._selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this._setSelectedIds(next);
    if (next.has(id)) {
      this._setAnchor(id, this._rowForNewAnchor(id));
    } else if (this.anchorId() === id) {
      // A deselected row must not stay the anchor of the next Shift+click.
      // (An emptied selection already went through _setSelectedIds' full clear.)
      this._dropAnchor();
    }
  }

  /**
   * Shift+click: select everything between the anchor and `targetId` in the
   * anchor's list, replacing the selection. Without an anchor, or when the
   * target sits in a different list, the target becomes the new anchor.
   */
  selectRange(targetId: string, isAdditive = false, targetRow?: HTMLElement): void {
    const anchorId = this.anchorId();
    const range = anchorId
      ? this._rangeInAnchorList(anchorId, targetId, targetRow)
      : null;
    if (!range) {
      // No range to build (no anchor, or the target is in another list), so the
      // target just becomes the new anchor — but an additive Shift+Ctrl+click
      // still means "add", so what is already selected must survive.
      const next = isAdditive ? new Set(this._selectedIds()) : new Set<string>();
      next.add(targetId);
      this._selectedIds.set(next);
      this._setAnchor(targetId, targetRow ?? this._rowForNewAnchor(targetId));
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
    if (!this.anchorId() || !this._selectedIds().size) {
      this._selectedIds.set(new Set([focusedId]));
      this._setAnchor(focusedId, focusedEl);
    }
    const siblings = this._listRowsFor(focusedEl);
    const index = siblings.indexOf(focusedEl);
    const nextEl = siblings[direction === 'down' ? index + 1 : index - 1];
    const nextId = nextEl?.getAttribute('data-task-id');
    if (!nextEl || !nextId) {
      return null;
    }
    this.selectRange(nextId, false, nextEl);
    nextEl.focus();
    return nextEl;
  }

  enterTouchSelectionMode(initialId: string): void {
    if (!this._selectedIds().has(initialId)) {
      this.toggle(initialId);
    }
    this._isTouchSelectionMode.set(true);
  }

  /**
   * Reference-counted, not a plain flag: two bulk actions can overlap (a bulk
   * action yields a macrotask before it ends, and a held shortcut key fires
   * again in that window). With a boolean, whichever finished first
   * un-suppressed while the other was still dispatching, so its remaining
   * per-task snackbars and the done sound escaped. Calls must be balanced;
   * the depth floors at 0 so a stray release cannot make it negative.
   */
  setBulkFeedbackSuppressed(isSuppressed: boolean): void {
    this._bulkFeedbackSuppressionDepth.update((depth) =>
      isSuppressed ? depth + 1 : Math.max(0, depth - 1),
    );
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
    this._setAnchor(focusedId, focusedEl);
  }

  /**
   * Called by a `<task>` row on destroy. A row is destroyed when it moves to
   * another list (done → done list), when a detail-panel copy goes away, or on
   * a re-render — none of which end the selection. So the id is dropped on the
   * next macrotask only if no *other* rendered row carries it: the destroyed
   * host itself stays in the DOM while the list's leave animation runs, so it
   * must not count as rendered.
   */
  removeWhenUnrendered(id: string, destroyedEl: HTMLElement): void {
    this._destroyedHosts.add(destroyedEl);
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

  /** The live main-list row for a task id (destroyed hosts and detail-panel copies excluded). */
  findLiveRowEl(id: string): HTMLElement | null {
    return this._findRowEl(id);
  }

  /** True for a row host whose component is already destroyed (animating out). */
  isDestroyedHost(el: Element): boolean {
    return this._destroyedHosts.has(el);
  }

  /** Drops one id immediately. */
  remove(id: string): void {
    if (!this._selectedIds().has(id)) {
      return;
    }
    const next = new Set(this._selectedIds());
    next.delete(id);
    this._setSelectedIds(next);
    if (this.anchorId() === id) {
      this._dropAnchor();
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
      this._setSelectedIds(next);
    }
    const anchorId = this.anchorId();
    if (anchorId && !next.has(anchorId)) {
      this._dropAnchor();
    }
  }

  /** Empties the selection and leaves touch selection mode. */
  clear(): void {
    this._clearSelectionState();
    if (this._selectedIds().size) {
      this._selectedIds.set(new Set());
    }
    this._menuOpenRequest.set(null);
    this._isTouchSelectionMode.set(false);
  }

  /** Every shrinking write goes through here so an empty set also ends touch mode. */
  private _setSelectedIds(next: Set<string>): void {
    this._selectedIds.set(next);
    if (!next.size) {
      this._clearSelectionState();
      this._isTouchSelectionMode.set(false);
    }
  }

  /**
   * Point the anchor at a row, and move the selection's scope to that row's
   * list. The only way to set an anchor, so the scope can never drift from the
   * list the user is actually working in.
   */
  private _setAnchor(id: string, row: HTMLElement | null): void {
    this._anchor.set({ id, row });
    this._selectionScopeEl = row?.closest<HTMLElement>(SELECTION_SCOPE_SELECTOR) ?? null;
  }

  /**
   * Drop the range cursor while the selection lives on. The scope deliberately
   * survives — it is the selection's, not the anchor's — but it is re-checked,
   * because deselecting the anchor can leave the remaining selection entirely
   * in another list.
   */
  private _dropAnchor(): void {
    this._anchor.set(null);
    this._repointScopeAtRemainingSelection();
  }

  /**
   * A selection can span panels: only `selectRange` is list-scoped, so
   * Ctrl+clicking rows in two panels selects across both. Leaving the scope on
   * a panel that holds none of the survivors actively loses focus — the
   * post-action search scopes itself there, finds nothing selected and gives
   * up, where re-pointing lands it on the right panel.
   *
   * Resolved at this moment rather than lazily in `selectionScope()` because
   * the selection is unambiguous here; later, one task rendered in two panels
   * at once makes "which panel holds it" unanswerable.
   */
  private _repointScopeAtRemainingSelection(): void {
    const scope = this._selectionScopeEl;
    const selected = this._selectedIds();
    if (!scope || !selected.size) {
      return;
    }
    const isSelectedRow = (el: HTMLElement): boolean => {
      const id = el.getAttribute('data-task-id');
      return !!id && selected.has(id) && !this._destroyedHosts.has(el);
    };
    const rendered = this._getAllTaskEls();
    if (rendered.some((el) => scope.contains(el) && isSelectedRow(el))) {
      return;
    }
    const elsewhere = rendered.find(isSelectedRow);
    // Nothing selected is rendered anywhere (cards mid-move or mid-animation):
    // the old scope is the only memory there is, so leave it.
    if (elsewhere) {
      this._selectionScopeEl = elsewhere.closest<HTMLElement>(SELECTION_SCOPE_SELECTOR);
    }
  }

  /** The selection is gone, so both the cursor into it and its list go too. */
  private _clearSelectionState(): void {
    this._anchor.set(null);
    this._selectionScopeEl = null;
  }

  requestMenuOpen(pos: { x: number; y: number }): void {
    this._menuOpenRequest.set(pos);
  }

  consumeMenuOpenRequest(): void {
    this._menuOpenRequest.set(null);
  }

  private _rangeInAnchorList(
    anchorId: string,
    targetId: string,
    targetRow?: HTMLElement,
  ): string[] | null {
    const anchorRow = this._anchor()?.row;
    const anchorEl =
      anchorRow?.isConnected && !this._destroyedHosts.has(anchorRow)
        ? anchorRow
        : this._getAllTaskEls().find(
            (el) =>
              el.dataset.taskId === anchorId &&
              (!this._selectionScopeEl || this._selectionScopeEl.contains(el)),
          );
    if (!anchorEl) {
      return null;
    }
    const rows = this._listRowsFor(anchorEl);
    // Identical task IDs can be rendered in different board panels. The clicked
    // copy determines the range, not the first matching task elsewhere on screen.
    const target = this._focusedRow();
    const targetEl = targetRow ?? (target?.id === targetId ? target.el : null);
    if (targetEl && !rows.includes(targetEl)) return null;
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
    const el = document.activeElement?.closest(
      'task, planner-task[data-task-selectable="true"]',
    ) as HTMLElement | null;
    const id = el?.getAttribute('data-task-id');
    if (!el || !id || this._destroyedHosts.has(el) || el.closest('task-detail-panel')) {
      return null;
    }
    return { el, id };
  }

  /** Participating rows in the selection scope containing `el`. */
  private _listRowsFor(el: HTMLElement): HTMLElement[] {
    const plannerScope = el.closest<HTMLElement>(
      '[data-planner-selection-scope], [data-board-selection-scope]',
    );
    if (plannerScope) {
      return Array.from(
        plannerScope.querySelectorAll<HTMLElement>(
          'planner-task[data-task-selectable="true"]',
        ),
      ).filter((row) => !this._destroyedHosts.has(row));
    }
    const list = el.parentElement?.closest('.task-list-inner');
    if (!list) {
      return [el];
    }
    return Array.from(list.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.tagName.toLowerCase() === 'task' &&
        // A row animating out is still a child here. Sweeping it into a range
        // or Ctrl+A leaves an id that nothing prunes afterwards, because
        // removeWhenUnrendered already ran while it was unselected.
        !this._destroyedHosts.has(child),
    );
  }

  private _rowForNewAnchor(id: string): HTMLElement | null {
    const focused = this._focusedRow();
    return focused?.id === id ? focused.el : this._findRowEl(id);
  }

  private _findRowEl(id: string): HTMLElement | null {
    return (
      this._getAllTaskEls().find((el) => el.getAttribute('data-task-id') === id) ?? null
    );
  }

  private _getAllTaskEls(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'task, planner-task[data-task-selectable="true"]',
      ),
    ).filter((el) => !this._destroyedHosts.has(el) && !el.closest('task-detail-panel'));
  }
}
