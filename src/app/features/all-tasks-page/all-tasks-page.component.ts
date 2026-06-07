import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAllTasksWithSubTasks } from '../tasks/store/task.selectors';
import { map } from 'rxjs/operators';
import { WorkViewComponent } from '../work-view/work-view.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskWithSubTasks } from '../tasks/task.model';
import { lsGetJSON } from '../../util/ls-util';
import { LS } from '../../core/persistence/storage-keys.const';
import { AllTasksOrderService } from './all-tasks-order.service';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';

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
  private _orderService = inject(AllTasksOrderService);
  private _customizerService = inject(TaskViewCustomizerService);
  private _destroyRef = inject(DestroyRef);

  constructor() {
    this._customizerService.setContextKeyOverride(ALL_TASKS_CONTEXT_KEY);
    this._destroyRef.onDestroy(() => {
      this._customizerService.setContextKeyOverride(null);
    });
  }

  private _rawUndoneTasks = toSignal(
    this._store
      .select(selectAllTasksWithSubTasks)
      .pipe(map((tasks) => tasks.filter((t) => !t.isDone && !t.parentId))),
    { initialValue: [] },
  );

  private _rawDoneTasks = toSignal(
    this._store
      .select(selectAllTasksWithSubTasks)
      .pipe(map((tasks) => tasks.filter((t) => t.isDone && !t.parentId))),
    { initialValue: [] },
  );

  undoneTasks = computed(() => {
    this._orderService.orderVersion();
    const storedIds = lsGetJSON<string[]>(LS.ALL_TASKS_TASK_IDS_UNDONE, []);
    return this._sortByOrderKey(this._rawUndoneTasks(), storedIds);
  });

  doneTasks = computed(() => {
    this._orderService.orderVersion();
    const storedIds = lsGetJSON<string[]>(LS.ALL_TASKS_TASK_IDS_DONE, []);
    return this._sortByOrderKey(this._rawDoneTasks(), storedIds);
  });

  private _sortByOrderKey(
    tasks: TaskWithSubTasks[],
    storedIds: string[],
  ): TaskWithSubTasks[] {
    if (!storedIds.length) return tasks;
    const idIndex = new Map(storedIds.map((id, idx) => [id, idx]));
    return [...tasks].sort((a, b) => {
      const ai = idIndex.get(a.id);
      const bi = idIndex.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
  }
}
