import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DateAdapter } from '@angular/material/core';
import { Store } from '@ngrx/store';
import { DateService } from '../../core/date/date.service';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../root-store/app-state/app-state.selectors';
import { selectUnarchivedProjects } from '../project/store/project.selectors';
import { selectAllTagIds } from '../tag/store/tag.reducer';
import { createTaskCriteriaCtx } from '../tasks/task-criteria/task-criteria';
import { TaskCriteriaCtx } from '../tasks/task-criteria/task-criteria.model';
import { TaskCopy } from '../tasks/task.model';
import { Project } from '../project/project.model';

/**
 * The context view rules are matched in (logical day, week start, backlog),
 * shared by every view column and the view editor's live count, so both count
 * the same tasks. Views keep `isDayBeforeTime` unset (the filter menu has its
 * own context).
 */
@Injectable({ providedIn: 'root' })
export class ViewCriteriaContextService {
  private readonly _store = inject(Store);
  private readonly _dateService = inject(DateService);
  private readonly _dateAdapter = inject(DateAdapter);

  // Store selectors, not DateService: both change at day rollover and when the
  // start-of-day setting changes, which re-filters the views.
  private readonly _todayStr = this._store.selectSignal(selectTodayStr);
  private readonly _startOfNextDayDiffMs = this._store.selectSignal(
    selectStartOfNextDayDiffMs,
  );

  // Unarchived projects, hidden ones and the Inbox included, so backlog rules
  // work for every task.
  readonly projects = toSignal(this._store.select(selectUnarchivedProjects), {
    initialValue: [] as Project[],
  });
  readonly projectById = computed(
    () => new Map(this.projects().map((project) => [project.id, project])),
  );
  private readonly _backlogTaskIds = computed(() => {
    const ids = new Set<string>();
    for (const project of this.projects()) {
      if (Array.isArray(project?.backlogTaskIds)) {
        project.backlogTaskIds.forEach((id) => ids.add(id));
      }
    }
    return ids;
  });

  // The ids of the tags that exist. A view's rules can name a tag that doesn't
  // (the default views' tags before they are created): no change may write
  // such an id into a task. Not part of `ctx`, so creating or deleting a tag
  // doesn't re-match every column.
  private readonly _tagIds = this._store.selectSignal(selectAllTagIds);
  readonly tagIdSet = computed<ReadonlySet<string>>(
    () => new Set(this._tagIds() as string[]),
  );

  readonly ctx = computed<TaskCriteriaCtx>(() =>
    createTaskCriteriaCtx({
      todayStr: this._todayStr() || this._dateService.todayStr(),
      startOfNextDayDiffMs: this._startOfNextDayDiffMs() ?? 0,
      // Reads the localization config signal, so a changed week start applies.
      firstDayOfWeek: this._dateAdapter.getFirstDayOfWeek(),
      // Read when a task is matched, so a computed matching tasks also
      // re-runs when a backlog changes.
      isInBacklog: (task) => this.isInBacklog(task),
      isBacklogEnabled: (projectId) =>
        !!this.projectById().get(projectId)?.isEnableBacklog,
    }),
  );

  /** A subtask is in the backlog when its parent is. */
  isInBacklog(task: Readonly<TaskCopy>): boolean {
    return this._backlogTaskIds().has(task.parentId || task.id);
  }
}
