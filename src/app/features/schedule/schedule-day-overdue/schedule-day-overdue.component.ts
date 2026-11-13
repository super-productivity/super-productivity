import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import { CdkDrag, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { dragDelayForTouch } from '../../../util/input-intent';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { ScheduleExternalDragService } from '../schedule-week/schedule-external-drag.service';

/**
 * Tasks left over from previous days, as a collapsed list in the schedule day
 * panel. Its cards are a drag source only: the panel places a dragged card at
 * a time, like a card dragged in from a task list or the Planner.
 */
@Component({
  selector: 'schedule-day-overdue',
  templateUrl: './schedule-day-overdue.component.html',
  styleUrl: './schedule-day-overdue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CollapsibleComponent,
    CdkDropList,
    CdkDrag,
    PlannerTaskComponent,
    TranslatePipe,
  ],
})
export class ScheduleDayOverdueComponent {
  private _taskService = inject(TaskService);
  private _externalDragService = inject(ScheduleExternalDragService);

  readonly tasks = input.required<TaskCopy[]>();
  readonly isExpanded = model(false);

  protected readonly T = T;
  protected readonly dragDelayForTouch = dragDelayForTouch;

  // The list only hands cards out; nothing can be dropped into or sorted in it.
  protected readonly rejectDrop = (): boolean => false;

  onDragStarted(task: TaskCopy, ev: CdkDragStart): void {
    this._taskService
      .getByIdWithSubTaskData$(task.id)
      .subscribe((taskWithSubTasks) =>
        this._externalDragService.setActiveTask(
          taskWithSubTasks ?? null,
          ev.source._dragRef,
        ),
      );
  }

  onDragEnded(): void {
    this._externalDragService.setActiveTask(null);
  }

  // The panel flags a drop it handled so that the source list skips its own
  // reorder. This list has none, but the flag must not outlive the drag: the
  // next drop in a task list would be skipped instead.
  onDropped(): void {
    this._externalDragService.setCancelNextDrop(false);
  }
}
