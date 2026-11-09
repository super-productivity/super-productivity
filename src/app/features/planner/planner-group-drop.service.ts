import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';
import { PlannerService } from './planner.service';
import { OVERDUE_LIST_ID, PlannerDay, ScheduleItemType } from './planner.model';
import { selectPlannerState } from './store/planner.selectors';
import { selectTaskEntities, selectUndoneOverdue } from '../tasks/store/task.selectors';
import { TaskMultiDragService } from '../tasks/task-multi-drag.service';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { DateService } from '../../core/date/date.service';
import {
  getPlannerGroupDropActions,
  PlannerGroupSource,
} from './util/get-planner-group-drop-actions';

/**
 * Drops a selected group of planner cards onto a day's unscheduled list. The
 * group snapshot, Escape cancel and sidebar project drops are shared with task
 * lists through {@link TaskMultiDragService}.
 */
@Injectable({ providedIn: 'root' })
export class PlannerGroupDropService {
  private readonly _store = inject(Store);
  private readonly _plannerService = inject(PlannerService);
  private readonly _multiDrag = inject(TaskMultiDragService);
  private readonly _selection = inject(TaskMultiSelectService);
  private readonly _dateService = inject(DateService);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);
  private readonly _plannerState = this._store.selectSignal(selectPlannerState);
  private readonly _overdue = this._store.selectSignal(selectUndoneOverdue);

  /** True while a planner drag carries a selected group. */
  isGroupDrag(): boolean {
    return this._multiDrag.ids().length > 1;
  }

  /**
   * @param orderedIds the target day's unscheduled cards after CDK moved the
   *   leader alone
   * @param currentIds the same list before the drop
   */
  drop(
    targetDay: string,
    leaderId: string,
    orderedIds: readonly string[],
    currentIds: readonly string[],
  ): void {
    if (this._multiDrag.isCancelled()) return;
    const actions = getPlannerGroupDropActions({
      ids: this._multiDrag.ids(),
      leaderId,
      orderedIds,
      currentIds,
      targetDay,
      todayStr: this._dateService.todayStr(),
      sources: this._getSources(),
      tasks: this._tasks(),
      targetDayIds: this._plannerState().days[targetDay] ?? [],
    });
    if (!actions?.length) return;
    this._selection.setBulkFeedbackSuppressed(true);
    try {
      actions.forEach((action) => this._store.dispatch(action));
    } finally {
      this._selection.setBulkFeedbackSuppressed(false);
    }
  }

  /** The column and list each card is rendered in, as the planner shows it. */
  private _getSources(): Map<string, PlannerGroupSource> {
    const sources = new Map<string, PlannerGroupSource>();
    this._overdue().forEach((task) =>
      sources.set(task.id, { day: OVERDUE_LIST_ID, isScheduled: false }),
    );
    // Replays synchronously while the planner is open; nothing resolves (and
    // the drop is refused) if it isn't.
    let days: PlannerDay[] = [];
    this._plannerService.days$.pipe(take(1)).subscribe((value) => (days = value));
    for (const day of days) {
      day.tasks.forEach((task) =>
        sources.set(task.id, { day: day.dayDate, isScheduled: false }),
      );
      day.scheduledIItems.forEach((item) => {
        if (item.type === ScheduleItemType.Task) {
          sources.set(item.task.id, { day: day.dayDate, isScheduled: true });
        }
      });
    }
    return sources;
  }
}
