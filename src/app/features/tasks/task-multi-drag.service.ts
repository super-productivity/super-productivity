import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskBulkActionService } from './task-bulk-action.service';
import {
  selectOverdueTasksWithSubTasks,
  selectTaskEntities,
} from './store/task.selectors';
import { selectAllSections } from '../section/store/section.selectors';
import { SectionService } from '../section/section.service';
import { WorkContextService } from '../work-context/work-context.service';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import { getAnchorFromDragDrop } from '../work-context/store/work-context-meta.helper';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DateService } from '../../core/date/date.service';
import { TODAY_TAG } from '../tag/tag.const';
import { Task } from './task.model';

/**
 * Where a group drag started. A planner group may carry subtasks (they are
 * planned on days of their own) and never drives the task-list visuals.
 */
export type TaskGroupDragOrigin = 'LIST' | 'PLANNER';

/** A transient snapshot: drop callbacks must not depend on rows surviving a move. */
@Injectable({ providedIn: 'root' })
export class TaskMultiDragService {
  private readonly _store = inject(Store);
  private readonly _selection = inject(TaskMultiSelectService);
  private readonly _bulk = inject(TaskBulkActionService);
  private readonly _sectionService = inject(SectionService);
  private readonly _context = inject(WorkContextService);
  private readonly _dateService = inject(DateService);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);
  private readonly _sections = this._store.selectSignal(selectAllSections);
  private readonly _overdue = this._store.selectSignal(selectOverdueTasksWithSubTasks);
  // Read only by Today drops; canDrop runs on every pointer move.
  private readonly _overdueIds = computed(
    () => new Set(this._overdue().map((task) => task.id)),
  );
  private readonly _ids = signal<readonly string[]>([]);
  private readonly _origin = signal<TaskGroupDragOrigin>('LIST');
  private readonly _cancelled = signal(false);
  /**
   * The open context's undone list (its UNDONE rows and sections), watched only
   * while a list group drag runs. Done, Later Today and backlog rows are not in
   * it, so a selection holding one of them is refused rather than half-moved.
   */
  private readonly _undoneIds = signal<ReadonlySet<string>>(new Set());
  private _undoneSub?: Subscription;
  private _stopListening?: () => void;
  readonly isCancelled = this._cancelled.asReadonly();
  readonly ids = this._ids.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }
  readonly draggedIds = computed(() => new Set(this.ids()));
  readonly selectedIds = this._selection.selectedIds;
  readonly previewTasks = computed(() => {
    const ids = this.ids().length ? this.ids() : [...this.selectedIds()];
    const entities = this._tasks();
    return ids.flatMap((id) => {
      const task = entities[id];
      return task && !task.parentId ? [task] : [];
    });
  });
  /** Planner cards include planned subtasks, so their preview does too. */
  readonly plannerPreviewTasks = computed(() => {
    const ids = this.ids().length ? this.ids() : [...this.selectedIds()];
    const entities = this._tasks();
    return ids.flatMap((id) => {
      const task = entities[id];
      return task ? [task] : [];
    });
  });
  readonly selectionSize = computed(
    () =>
      [...this.selectedIds()].filter((id) => {
        const task = this._tasks()[id];
        return task && !task.parentId;
      }).length,
  );
  readonly isListGroupDrag = computed(
    () =>
      this._origin() === 'LIST' &&
      this.ids().length > 1 &&
      !!this._context.activeWorkContextId,
  );

  start(task: Task, origin: TaskGroupDragOrigin = 'LIST'): void {
    this.clear();
    const isPlanner = origin === 'PLANNER';
    if (
      (!isPlanner && task.parentId) ||
      !this._selection.has(task.id) ||
      this._selection.isTouchSelectionMode()
    )
      return;
    const entities = this._tasks();
    const ids = this._selection
      .selectedIdsInDomOrder()
      .filter((id) => entities[id] && (isPlanner || !entities[id]!.parentId));
    if (ids.length > 1) {
      this._origin.set(origin);
      this._ids.set(ids);
      if (!isPlanner) {
        // Replays synchronously (shared main list, store and minute tick).
        this._undoneSub = this._context.undoneTasks$.subscribe((tasks) =>
          this._undoneIds.set(new Set(tasks.map((t) => t.id))),
        );
      }
      const cancel = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this._cancelled.set(true);
      };
      window.addEventListener('keydown', cancel);
      this._stopListening = () => window.removeEventListener('keydown', cancel);
    }
  }

  finish(): void {
    // CDK emits ended before dropped; keep the snapshot through both callbacks.
    const ids = this.ids();
    queueMicrotask(() => {
      if (this.ids() === ids) this.clear();
    });
  }

  clear(): void {
    this._stopListening?.();
    this._stopListening = undefined;
    this._undoneSub?.unsubscribe();
    this._undoneSub = undefined;
    this._undoneIds.set(new Set());
    this._cancelled.set(false);
    this._origin.set('LIST');
    this._ids.set([]);
  }

  /**
   * Group drops target the open context's undone list and its sections: a
   * project's root list, a tag's (Today's) main list. Overdue tasks may join a
   * Today drop; they are planned for today as they land.
   */
  canDrop(listId: string, modelId: string, groupTagId?: string | null): boolean {
    if (this.isCancelled() || this._origin() !== 'LIST') return false;
    const contextId = this._context.activeWorkContextId;
    const contextType = this._context.activeWorkContextType;
    if (listId !== 'PARENT' || groupTagId !== undefined || !contextId || !contextType)
      return false;
    const undone = this._undoneIds();
    const overdue: ReadonlySet<string> =
      contextId === TODAY_TAG.id ? this._overdueIds() : new Set<string>();
    if (
      !this.ids().length ||
      this.ids().some((id) => {
        const task = this._tasks()[id];
        return (
          !task || task.parentId || task.isDone || (!undone.has(id) && !overdue.has(id))
        );
      })
    )
      return false;
    return (
      modelId === 'UNDONE' ||
      this._sections().some(
        (section) =>
          section.id === modelId &&
          section.contextType === contextType &&
          section.contextId === contextId,
      )
    );
  }

  isPlacementUnchanged(leaderId: string, orderedIds: string[]): boolean {
    const ids = [...this.ids()];
    if (ids.length < 2) return false;
    const selected = new Set(ids);
    const afterTaskId = this._getGroupAnchor(leaderId, orderedIds, selected);
    const remaining = orderedIds.filter((id) => !selected.has(id));
    const anchorIndex = afterTaskId === null ? -1 : remaining.indexOf(afterTaskId);
    if (afterTaskId !== null && anchorIndex < 0) return false;
    const intended = [...remaining];
    intended.splice(anchorIndex + 1, 0, ...ids);
    return (
      intended.length === orderedIds.length &&
      intended.every((id, index) => id === orderedIds[index])
    );
  }

  async drop(modelId: string, leaderId: string, orderedIds: string[]): Promise<void> {
    if (!this.canDrop('PARENT', modelId)) return;
    const contextId = this._context.activeWorkContextId!;
    const contextType = this._context.activeWorkContextType!;
    const ids = [...this.ids()];
    const selected = new Set(ids);
    // CDK moves one placeholder; remove the other selected rows from its anchor.
    let afterTaskId = this._getGroupAnchor(leaderId, orderedIds, selected);
    const sections = this._sections().filter(
      (section) => section.contextId === contextId && section.contextType === contextType,
    );
    const sourceByTask = new Map(
      sections.flatMap((section) =>
        section.taskIds.map((id) => [id, section.id] as const),
      ),
    );
    const undone = this._undoneIds();
    // Only Today shows an overdue list (canDrop admits none elsewhere).
    const overdueIds = ids.filter((id) => !undone.has(id));
    this._selection.setBulkFeedbackSuppressed(true);
    try {
      if (overdueIds.length) {
        // The same bulk plan the "add all overdue" button dispatches; then each
        // task is placed like any other member below.
        this._store.dispatch(
          TaskSharedActions.planTasksForToday({
            taskIds: overdueIds,
            today: this._dateService.todayStr(),
            startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
          }),
        );
      }
      for (const id of ids) {
        const source = sourceByTask.get(id) ?? null;
        if (modelId !== 'UNDONE') {
          this._sectionService.addTaskToSection(modelId, id, afterTaskId, source);
        } else if (source) {
          this._sectionService.removeTaskFromSection(
            source,
            id,
            contextId,
            contextType,
            afterTaskId,
          );
        } else {
          this._store.dispatch(
            moveTaskInTodayList({
              taskId: id,
              afterTaskId,
              src: overdueIds.includes(id) ? 'OVERDUE' : 'UNDONE',
              target: 'UNDONE',
              workContextId: contextId,
              workContextType: contextType,
            }),
          );
        }
        afterTaskId = id;
      }
      // Existing bulk workflow: each placement is a normal replay-atomic action.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      this._selection.setBulkFeedbackSuppressed(false);
    }
  }

  moveToProject(projectId: string, ids: readonly string[]): Promise<void> {
    return this._bulk.moveToProject(projectId, ids);
  }

  private _getGroupAnchor(
    leaderId: string,
    orderedIds: string[],
    selected: ReadonlySet<string>,
  ): string | null {
    const afterLeader = getAnchorFromDragDrop(leaderId, orderedIds);
    let anchorIndex = afterLeader === null ? -1 : orderedIds.indexOf(afterLeader);
    while (anchorIndex >= 0 && selected.has(orderedIds[anchorIndex])) anchorIndex--;
    return anchorIndex < 0 ? null : orderedIds[anchorIndex];
  }
}
