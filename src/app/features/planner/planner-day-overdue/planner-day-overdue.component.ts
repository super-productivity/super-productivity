import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { T } from '../../../t.const';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { PlannerTaskComponent } from '../planner-task/planner-task.component';
import { PlannerDeadlineTaskComponent } from '../planner-deadline-task/planner-deadline-task.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RoundDurationPipe } from '../../../ui/pipes/round-duration.pipe';
import { MatIcon } from '@angular/material/icon';
import { TaskCopy } from '../../tasks/task.model';
import { OVERDUE_LIST_ID } from '../planner.model';
import { TranslatePipe } from '@ngx-translate/core';
import { isTouchActive } from '../../../util/input-intent';
import { DRAG_DELAY_FOR_TOUCH } from '../../../app.constants';
import { LayoutService } from '../../../core-ui/layout/layout.service';

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
    MatIcon,
    MsToStringPipe,
    RoundDurationPipe,
    TranslatePipe,
  ],
})
export class PlannerDayOverdueComponent {
  private _layoutService = inject(LayoutService);
  overdueTasks = input<TaskCopy[] | null>();
  overdueDeadlineTasks = input<TaskCopy[] | null>();
  totalEstimate = computed(() => {
    const tasks = this.overdueTasks();
    if (!tasks) return 0;
    return tasks.reduce((acc, task) => acc + (task.timeEstimate || 0), 0);
  });

  OVERDUE_LIST_ID = OVERDUE_LIST_ID;
  protected readonly T = T;
  protected readonly isTouchActive = isTouchActive;
  protected readonly DRAG_DELAY_FOR_TOUCH = DRAG_DELAY_FOR_TOUCH;
  // Lock Y-axis on small screens only — on wider screens the planner uses a
  // multi-column grid where cross-column dragging requires horizontal movement.
  protected readonly isXs = this._layoutService.isXs;

  enterPredicate(drag: CdkDrag, drop: CdkDropList): boolean {
    return false;
  }
}
