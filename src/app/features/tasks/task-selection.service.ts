import { DOCUMENT } from '@angular/common';
import { computed, effect, Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { WorkContextService } from '../work-context/work-context.service';

@Injectable({
  providedIn: 'root',
})
export class TaskSelectionService {
  private readonly _document = inject(DOCUMENT);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _activeWorkContextChange = toSignal(
    this._workContextService.onWorkContextChange$,
    {
      initialValue: null,
    },
  );

  private readonly _selectedIds = signal<string[]>([]);
  private readonly _lastSelectedId = signal<string | null>(null);
  private readonly _isSelectionMode = signal(false);

  readonly selectedIds = this._selectedIds.asReadonly();
  readonly selectedCount = computed(() => this._selectedIds().length);
  readonly hasSelection = computed(() => this.selectedCount() > 0);
  readonly isSelectionMode = this._isSelectionMode.asReadonly();
  readonly selectedIdSet = computed(() => new Set(this._selectedIds()));

  private readonly _onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.hasSelection()) {
      return;
    }
    this.clearSelection();
  };

  constructor() {
    this._document.addEventListener('keydown', this._onDocumentKeydown);

    effect(() => {
      this._activeWorkContextChange();
      this.clearSelection();
    });
  }

  isSelected(taskId: string): boolean {
    return this.selectedIdSet().has(taskId);
  }

  toggle(taskId: string): void {
    if (this.isSelected(taskId)) {
      this.deselect(taskId);
      return;
    }
    this.select(taskId);
  }

  select(taskId: string): void {
    if (this.isSelected(taskId)) {
      this._lastSelectedId.set(taskId);
      return;
    }

    this._isSelectionMode.set(true);
    this._selectedIds.update((ids) => [...ids, taskId]);
    this._lastSelectedId.set(taskId);
  }

  deselect(taskId: string): void {
    this._selectedIds.update((ids) => ids.filter((id) => id !== taskId));
    if (this._lastSelectedId() === taskId) {
      const remaining = this._selectedIds();
      this._lastSelectedId.set(remaining[remaining.length - 1] ?? null);
    }
    if (!this._selectedIds().length) {
      this._isSelectionMode.set(false);
    }
  }

  selectRange(taskId: string, allVisibleTaskIds: string[]): void {
    const lastSelectedId = this._lastSelectedId();
    if (!lastSelectedId) {
      this.select(taskId);
      return;
    }

    const startIndex = allVisibleTaskIds.indexOf(lastSelectedId);
    const endIndex = allVisibleTaskIds.indexOf(taskId);
    if (startIndex === -1 || endIndex === -1) {
      this.select(taskId);
      return;
    }

    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    const rangeIds = allVisibleTaskIds.slice(from, to + 1);
    this._isSelectionMode.set(true);
    this._selectedIds.update((ids) => Array.from(new Set([...ids, ...rangeIds])));
    this._lastSelectedId.set(taskId);
  }

  selectAll(taskIds: string[]): void {
    this._isSelectionMode.set(true);
    this._selectedIds.set([...taskIds]);
    this._lastSelectedId.set(taskIds[taskIds.length - 1] ?? null);
  }

  clearSelection(): void {
    this._selectedIds.set([]);
    this._lastSelectedId.set(null);
    this._isSelectionMode.set(false);
  }
}
