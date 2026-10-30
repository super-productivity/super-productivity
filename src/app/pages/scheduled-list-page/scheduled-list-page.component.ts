import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { T } from '../../t.const';
import { MatDialog } from '@angular/material/dialog';
import { standardListAnimation } from '../../ui/animations/standard-list.ani';
import { Store } from '@ngrx/store';
import { getTaskRepeatInfoText } from '../../features/tasks/task-detail-panel/get-task-repeat-info-text.util';
import { TaskRepeatCfg } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogEditTaskRepeatCfgComponent } from '../../features/task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfgService } from '../../features/task-repeat-cfg/task-repeat-cfg.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { MatCard, MatCardContent } from '@angular/material/card';
import { TaskTitleComponent } from '../../ui/task-title/task-title.component';
import { MatRipple } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { FullPageSpinnerComponent } from '../../ui/full-page-spinner/full-page-spinner.component';
import { AsyncPipe } from '@angular/common';
import { TagListComponent } from '../../features/tag/tag-list/tag-list.component';
import { selectTaskRepeatCfgsSortedByTitleAndProject } from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { getNextCreatedOccurrence } from '../../features/task-repeat-cfg/store/get-next-created-occurrence.util';
import { getEffectiveLastTaskCreationDay } from '../../features/task-repeat-cfg/store/get-effective-last-task-creation-day.util';
import { MatTooltip } from '@angular/material/tooltip';
import { getRepeatCfgTooltipText } from './get-repeat-cfg-tooltip-text.util';

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
    TranslatePipe,
    TagListComponent,
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
  taskRepeatCfgs$ = this._store.select(selectTaskRepeatCfgsSortedByTitleAndProject);

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
      this._dateTimeFormatService.currentLocale(),
      this._dateTimeFormatService,
      this._translateService,
    );
    return this._translateService.instant(key, params);
  }

  getNextOccurrence(repeatCfg: TaskRepeatCfg): number | null {
    return getNextCreatedOccurrence(repeatCfg, new Date())?.getTime() || null;
  }

  getTooltipText(repeatCfg: TaskRepeatCfg): string {
    return getRepeatCfgTooltipText(
      this.getNextOccurrence(repeatCfg),
      getEffectiveLastTaskCreationDay(repeatCfg),
      this._dateTimeFormatService.currentLocale(),
      this._translateService.instant(T.SCHEDULE.NEXT),
      this._translateService.instant(T.SCHEDULE.LAST),
    );
  }
}
