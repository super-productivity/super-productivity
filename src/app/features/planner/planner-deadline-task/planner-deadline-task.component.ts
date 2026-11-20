import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';

@Component({
  selector: 'planner-deadline-task',
  templateUrl: './planner-deadline-task.component.html',
  styleUrl: './planner-deadline-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe],
})
export class PlannerDeadlineTaskComponent {
  private _taskService = inject(TaskService);

  task = input.required<TaskCopy>();

  // Same as planner-task: open the task (detail panel, or bottom panel on
  // mobile); the deadline is edited from there.
  openTask(): void {
    this._taskService.setSelectedId(this.task().id);
  }
}
