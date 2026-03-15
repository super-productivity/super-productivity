import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { T } from '../../../t.const';
import { AsyncPipe } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { AddTasksForTomorrowService } from '../add-tasks-for-tomorrow.service';

@Component({
  selector: 'add-scheduled-today-or-tomorrow-btn',
  imports: [AsyncPipe, MatButton, MatIcon, TranslateModule],
  templateUrl: './add-scheduled-today-or-tomorrow-btn.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddScheduledTodayOrTomorrowBtnComponent {
  workContextService = inject(WorkContextService);
  taskService = inject(TaskService);
  addTasksForTomorrowService = inject(AddTasksForTomorrowService);

  protected readonly T = T;
}
