import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAllTasksWithSubTasksInActiveProjects } from '../tasks/store/task.selectors';
import { map } from 'rxjs/operators';
import { WorkViewComponent } from '../work-view/work-view.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { sortDoneTasksByDoneDate } from '../work-context/work-context.util';
import { FILTER_OPTION_TYPE } from '../task-view-customizer/types';

const ALL_TASKS_CONTEXT_KEY = 'ALL_TASKS';

@Component({
  selector: 'all-tasks-page',
  templateUrl: './all-tasks-page.component.html',
  styleUrl: './all-tasks-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [WorkViewComponent],
})
export class AllTasksPageComponent {
  private _store = inject(Store);
  private _customizerService = inject(TaskViewCustomizerService);
  private _destroyRef = inject(DestroyRef);

  constructor() {
    this._customizerService.setContextKeyOverride(ALL_TASKS_CONTEXT_KEY);
    this._destroyRef.onDestroy(() => {
      this._customizerService.setContextKeyOverride(null);
    });
  }

  // Tasks across active projects (archived ones excluded), parents carrying
  // their nested subTasks — the shape <work-view> needs. The flat
  // selectAllTasksInActiveProjects would drop the child rows and the
  // per-subtask estimate.
  undoneTasks = toSignal(
    this._store
      .select(selectAllTasksWithSubTasksInActiveProjects)
      .pipe(map((tasks) => tasks.filter((t) => !t.isDone))),
    { initialValue: [] },
  );

  // Completed tasks, newest first, narrowed by the same project filter as the
  // undone list. Without this the page could say "two projects selected" while
  // Done kept listing every project's finished work. Sorting stays here; only
  // the project selection is applied, since the Done list has no sort/group
  // menu of its own.
  private _allDoneTasks = toSignal(
    this._store
      .select(selectAllTasksWithSubTasksInActiveProjects)
      .pipe(map((tasks) => sortDoneTasksByDoneDate(tasks.filter((t) => t.isDone)))),
    { initialValue: [] },
  );

  doneTasks = computed(() => {
    const filter = this._customizerService.selectedFilter();
    const projectIds =
      filter.type === FILTER_OPTION_TYPE.project ? filter.projectIds : undefined;
    if (!projectIds || projectIds.length === 0) {
      return this._allDoneTasks();
    }
    return this._allDoneTasks().filter(
      (task) => !!task.projectId && projectIds.includes(task.projectId),
    );
  });
}
