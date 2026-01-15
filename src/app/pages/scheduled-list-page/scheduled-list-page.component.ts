import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { T } from '../../t.const';
import { MatDialog } from '@angular/material/dialog';
import { TaskCopy } from '../../features/tasks/task.model';
import { standardListAnimation } from '../../ui/animations/standard-list.ani';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { Tag } from '../../features/tag/tag.model';
import { Store } from '@ngrx/store';
import { getTaskRepeatInfoText } from '../../features/tasks/task-detail-panel/get-task-repeat-info-text.util';
import { TaskRepeatCfg } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogEditTaskRepeatCfgComponent } from '../../features/task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfgService } from '../../features/task-repeat-cfg/task-repeat-cfg.service';
import { DialogScheduleTaskComponent } from '../../features/planner/dialog-schedule-task/dialog-schedule-task.component';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { MatCard, MatCardContent } from '@angular/material/card';
import { TaskTitleComponent } from '../../ui/task-title/task-title.component';
import { MatRipple } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { FullPageSpinnerComponent } from '../../ui/full-page-spinner/full-page-spinner.component';
import { AsyncPipe } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { HumanizeTimestampPipe } from '../../ui/pipes/humanize-timestamp.pipe';
import { TagListComponent } from '../../features/tag/tag-list/tag-list.component';
import { PlannerTaskComponent } from '../../features/planner/planner-task/planner-task.component';
import {
  selectAllTasksWithDueTimeSorted,
  selectAllUndoneTasksWithDueDay,
} from '../../features/tasks/store/task.selectors';
import { selectTaskRepeatCfgsSortedByTitleAndProject } from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { getNextRepeatOccurrence } from '../../features/task-repeat-cfg/store/get-next-repeat-occurrence.util';
import { getEffectiveLastTaskCreationDay } from '../../features/task-repeat-cfg/store/get-effective-last-task-creation-day.util';
import { ShortTimePipe } from '../../ui/pipes/short-time.pipe';
import { MatTooltip } from '@angular/material/tooltip';
import { formatMonthDay } from '../../util/format-month-day.util';

@Component({
  selector: 'scheduled-list-page',
  templateUrl: './scheduled-list-page.component.html',
  styleUrls: ['./scheduled-list-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation],
  imports: [
    MatCard,
    MatCardContent,
    TaskTitleComponent,
    MatRipple,
    MatIcon,
    FullPageSpinnerComponent,
    AsyncPipe,
    LocaleDatePipe,
    HumanizeTimestampPipe,
    TranslatePipe,
    TagListComponent,
    PlannerTaskComponent,
    ShortTimePipe,
    MatTooltip,
  ],
})
export class ScheduledListPageComponent {
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _dateTimeFormatService = inject(DateTimeFormatService);

  T: typeof T = T;
  TODAY_TAG: Tag = TODAY_TAG;
  taskRepeatCfgs$ = this._store.select(selectTaskRepeatCfgsSortedByTitleAndProject);
  tasksPlannedForDays$ = this._store.select(selectAllUndoneTasksWithDueDay);
  tasksPlannedWithTime$ = this._store.select(selectAllTasksWithDueTimeSorted);

  editReminder(task: TaskCopy, ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this._matDialog.open(DialogScheduleTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  editTaskRepeatCfg(repeatCfg: TaskRepeatCfg): void {
    this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
      restoreFocus: false,
      data: {
        repeatCfg,
      },
    });
  }

  updateRepeatableTitleIfChanged(
    isChanged: boolean,
    newTitle: string,
    repeatCfg: TaskRepeatCfg,
  ): void {
    if (isChanged && newTitle !== repeatCfg.title) {
      this._taskRepeatCfgService.updateTaskRepeatCfg(
        repeatCfg.id,
        {
          title: newTitle,
        },
        true,
      );
    }
  }

  getRepeatInfoText(repeatCfg: TaskRepeatCfg): string {
    const [key, params] = getTaskRepeatInfoText(
      repeatCfg,
      this._dateTimeFormatService.currentLocale,
      this._dateTimeFormatService,
    );
    return this._translateService.instant(key, params);
  }

  getNextOccurrence(repeatCfg: TaskRepeatCfg): number | null {
    return getNextRepeatOccurrence(repeatCfg, new Date())?.getTime() || null;
  }

  getTooltipText(repeatCfg: TaskRepeatCfg): string {
    const locale = this._dateTimeFormatService.currentLocale;
    const nextDate = this.getNextOccurrence(repeatCfg);
    const nextFormatted = nextDate ? formatMonthDay(new Date(nextDate), locale) : '';
    const effectiveLastDay = getEffectiveLastTaskCreationDay(repeatCfg);
    const lastFormatted = effectiveLastDay
      ? formatMonthDay(new Date(effectiveLastDay), locale)
      : '';

    const next = this._translateService.instant(T.SCHEDULE.NEXT);
    const last = this._translateService.instant(T.SCHEDULE.LAST);

    return `${next} ${nextFormatted}, ${last} ${lastFormatted}`;
  }
}
