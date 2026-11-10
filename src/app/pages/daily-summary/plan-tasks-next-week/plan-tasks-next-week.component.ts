import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { DateService } from '../../../core/date/date.service';
import { PlannerDayComponent } from '../../../features/planner/planner-day/planner-day.component';
import { PlannerService } from '../../../features/planner/planner.service';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { getNextWorkWeekDays } from '../finish-week.util';
import { selectOpenWeekTasks } from './open-week-tasks.selector';

/** Finish week's Plan tab: next Monday to Friday as planner days. */
@Component({
  selector: 'plan-tasks-next-week',
  templateUrl: './plan-tasks-next-week.component.html',
  styleUrls: ['./plan-tasks-next-week.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDropListGroup, PlannerDayComponent, MatButton, MatIcon, TranslatePipe],
})
export class PlanTasksNextWeekComponent {
  private readonly _store = inject(Store);
  private readonly _dateService = inject(DateService);
  private readonly _plannerService = inject(PlannerService);

  readonly T: typeof T = T;
  private readonly _dayStrs = getNextWorkWeekDays(
    this._dateService.getLogicalTodayDate(),
  ).map((d) => this._dateService.todayStr(d));

  readonly days = toSignal(this._plannerService.getDays$(this._dayStrs), {
    initialValue: [],
  });
  readonly openTasks = this._store.selectSignal(selectOpenWeekTasks);
  /** Subtasks moving with their parent don't count as extra tasks. */
  readonly openTaskCount = computed(() => {
    const tasks = this.openTasks();
    const ids = new Set(tasks.map((t) => t.id));
    return tasks.filter((t) => !t.parentId || !ids.has(t.parentId)).length;
  });

  /** Puts all open tasks on next Monday; from there they can be dragged to other days. */
  planOpenTasksOnMonday(): void {
    const day = this._dayStrs[0];
    for (const task of this.openTasks()) {
      this._store.dispatch(PlannerActions.planTaskForDay({ day, task }));
    }
  }
}
