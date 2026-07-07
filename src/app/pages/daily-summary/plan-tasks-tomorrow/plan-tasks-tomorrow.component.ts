import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { TaskService } from '../../../features/tasks/task.service';
import { T } from 'src/app/t.const';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import { AsyncPipe } from '@angular/common';
import { PlannerDayComponent } from '../../../features/planner/planner-day/planner-day.component';
import { PlannerService } from '../../../features/planner/planner.service';
import { AddTaskBarComponent } from '../../../features/tasks/add-task-bar/add-task-bar.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { selectUndoneTodayTaskIds } from '../../../features/work-context/store/work-context.selectors';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { first } from 'rxjs/operators';
import { selectTasksWithSubTasksByIdsFactory } from '../../../features/tasks/store/task.selectors';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'plan-tasks-tomorrow',
  templateUrl: './plan-tasks-tomorrow.component.html',
  styleUrls: ['./plan-tasks-tomorrow.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [
    AsyncPipe,
    PlannerDayComponent,
    AddTaskBarComponent,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class PlanTasksTomorrowComponent {
  workContextService = inject(WorkContextService);
  taskService = inject(TaskService);
  _store = inject(Store);
  plannerService = inject(PlannerService);
  leftOverTodayIds$ = this._store.select(selectUndoneTodayTaskIds);

  T: typeof T = T;

  async planAllTodayTomorrow(): Promise<void> {
    const todayStr = getDbDateStr();
    const tomorrow = await this.plannerService.tomorrow$.pipe(first()).toPromise();
    const ids = await this.leftOverTodayIds$.pipe(first()).toPromise();
    const tasks = await this._store
      .select(selectTasksWithSubTasksByIdsFactory(ids ?? []))
      .pipe(first())
      .toPromise();
    tasks.forEach((task) => {
      this._store.dispatch(
        PlannerActions.planTaskForDay({ day: tomorrow!.dayDate, task }),
      );
      if (task.subTasks) {
        task.subTasks.forEach((subTask) => {
          if (subTask.dueDay && subTask.dueDay === todayStr) {
            this._store.dispatch(
              PlannerActions.planTaskForDay({ day: tomorrow!.dayDate, task: subTask }),
            );
          }
        });
      }
    });
  }
}
