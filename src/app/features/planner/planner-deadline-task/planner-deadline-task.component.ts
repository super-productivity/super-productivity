import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TaskCopy } from '../../tasks/task.model';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';

@Component({
  selector: 'planner-deadline-task',
  templateUrl: './planner-deadline-task.component.html',
  styleUrl: './planner-deadline-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe],
})
export class PlannerDeadlineTaskComponent {
  private _matDialog = inject(MatDialog);

  task = input.required<TaskCopy>();

  editDeadline(): void {
    this._matDialog.open(DialogDeadlineComponent, {
      autoFocus: false,
      restoreFocus: true,
      data: { task: this.task() },
    });
  }
}
