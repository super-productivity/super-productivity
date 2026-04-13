import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Task } from '../task.model';
import { TaskService } from '../task.service';
import { T } from '../../../t.const';
import { DateService } from 'src/app/core/date/date.service';
import { DialogViewArchivedTaskComponent } from '../dialog-view-archived-task/dialog-view-archived-task.component';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
} from '@angular/material/table';
import { MatIcon } from '@angular/material/icon';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MatIconButton } from '@angular/material/button';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'task-summary-table',
  templateUrl: './task-summary-table.component.html',
  styleUrls: ['./task-summary-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatIcon,
    InlineInputComponent,
    MatIconButton,
    MatHeaderRow,
    MatRow,
    MsToClockStringPipe,
    TranslatePipe,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
  ],
})
export class TaskSummaryTableComponent {
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);
  private _matDialog = inject(MatDialog);

  readonly flatTasks = input<Task[]>([]);
  readonly day = input<string>(this._dateService.todayStr());
  readonly updated = output<void>();

  T: typeof T = T;

  updateTimeSpentTodayForTask(task: Task, newVal: number | string): void {
    this._taskService.updateEverywhere(task.id, {
      timeSpentOnDay: {
        ...task.timeSpentOnDay,
        [this.day()]: +newVal,
      },
    });
    this.updated.emit();
  }

  updateTaskTitle(task: Task, newVal: string): void {
    this._taskService.updateEverywhere(task.id, {
      title: newVal,
    });
    this.updated.emit();
  }

  viewTaskDetails(task: Task): void {
    this._matDialog.open(DialogViewArchivedTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  toggleTaskDone(task: Task): void {
    this._taskService.updateEverywhere(task.id, {
      isDone: !task.isDone,
    });
    // task.isDone
    //   ? this._taskService.setUnDone(task.id)
    //   : this._taskService.setDone(task.id);
    this.updated.emit();
  }
}
