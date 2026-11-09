import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { T } from '../../../t.const';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import {
  CdkDrag,
  CdkDragPreview,
  CdkDragStart,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { PlannerTaskComponent } from '../planner-task/planner-task.component';
import { PlannerDeadlineTaskComponent } from '../planner-deadline-task/planner-deadline-task.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RoundDurationPipe } from '../../../ui/pipes/round-duration.pipe';
import { MatIcon } from '@angular/material/icon';
import { TaskCopy } from '../../tasks/task.model';
import { OVERDUE_LIST_ID } from '../planner.model';
import { TranslatePipe } from '@ngx-translate/core';
import { dragDelayForTouch } from '../../../util/input-intent';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TaskMultiDragService } from '../../tasks/task-multi-drag.service';
import { TaskGroupDragPreviewComponent } from '../../tasks/task-group-drag-preview/task-group-drag-preview.component';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';

@Component({
  selector: 'planner-day-overdue',
  templateUrl: './planner-day-overdue.component.html',
  styleUrl: './planner-day-overdue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDropList,
    PlannerTaskComponent,
    PlannerDeadlineTaskComponent,
    CdkDrag,
    CdkDragPreview,
    TaskGroupDragPreviewComponent,
    MatIcon,
    MsToStringPipe,
    RoundDurationPipe,
    TranslatePipe,
  ],
})
export class PlannerDayOverdueComponent {
  protected readonly multiSelect = inject(TaskMultiSelectService);
  protected readonly multiDrag = inject(TaskMultiDragService);
  private _layoutService = inject(LayoutService);
  private _externalDragService = inject(ScheduleExternalDragService);
  overdueTasks = input<TaskCopy[] | null>();
  overdueDeadlineTasks = input<TaskCopy[] | null>();
  totalEstimate = computed(() => {
    const tasks = this.overdueTasks();
    if (!tasks) return 0;
    return tasks.reduce((acc, task) => acc + (task.timeEstimate || 0), 0);
  });

  OVERDUE_LIST_ID = OVERDUE_LIST_ID;
  protected readonly T = T;
  protected readonly dragDelayForTouch = dragDelayForTouch;
  // Lock Y-axis on small screens only — on wider screens the planner uses a
  // multi-column grid where cross-column dragging requires horizontal movement.
  protected readonly isXs = this._layoutService.isXs;

  // A single overdue card registers no external drag (unchanged); a selected
  // group registers its drag so the side nav can move it to a project.
  onDragStarted(task: TaskCopy, ev: CdkDragStart): void {
    this.multiDrag.start(task, 'PLANNER');
    if (this.multiDrag.ids().length > 1) {
      this._externalDragService.setActiveTask(null, ev.source._dragRef);
    }
  }

  onDragEnded(): void {
    this.multiDrag.finish();
    this._externalDragService.setActiveTask(null);
  }

  // A card released outside every day returns here. Nothing reorders in this
  // list, but a side-nav group drop asked to skip the next drop: consume it, or
  // it would swallow the following planner drop.
  onDropped(): void {
    this._externalDragService.setCancelNextDrop(false);
  }

  enterPredicate(drag: CdkDrag, drop: CdkDropList): boolean {
    return false;
  }
}
