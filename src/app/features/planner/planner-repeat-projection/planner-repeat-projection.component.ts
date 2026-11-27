import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogEditTaskRepeatCfgComponent } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { T } from 'src/app/t.const';
import { DateService } from '../../../core/date/date.service';
import { isRepeatPreviewSeparable } from '../../task-repeat-cfg/is-repeat-preview-separable.util';
import { TranslatePipe } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';

@Component({
  selector: 'planner-repeat-projection',
  templateUrl: './planner-repeat-projection.component.html',
  styleUrl: './planner-repeat-projection.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MsToStringPipe, TranslatePipe, TagListComponent],
})
export class PlannerRepeatProjectionComponent {
  private _matDialog = inject(MatDialog);
  private _dateService = inject(DateService);

  repeatCfg = input.required<TaskRepeatCfg>();
  overWriteTimeEstimate = input(0);
  dayDate = input<string | undefined>();

  // A preview can't be dragged, so its hover text points to the way out
  // where the dialog offers one.
  isSeparable = computed(() =>
    isRepeatPreviewSeparable(
      this.repeatCfg(),
      this.dayDate(),
      this._dateService.todayStr(),
    ),
  );

  T = T;

  editTaskRepeatCfg(): void {
    this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
      restoreFocus: false,
      data: {
        repeatCfg: this.repeatCfg(),
        targetDate: this.dayDate(),
      },
    });
  }
}
