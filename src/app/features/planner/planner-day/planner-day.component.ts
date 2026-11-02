import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostBinding,
  inject,
  Input,
} from '@angular/core';
import { T } from '../../../t.const';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { PlannerDay, ScheduleItem, ScheduleItemType } from '../planner.model';
import { CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
import { TaskCopy } from '../../tasks/task.model';
import { PlannerActions } from '../store/planner.actions';
import { millisecondsDiffToRemindOption } from '../../tasks/util/remind-option-to-milliseconds';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../tasks/task.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../core/date/date.service';
import { DialogScheduleTaskComponent } from '../dialog-schedule-task/dialog-schedule-task.component';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { MatIcon } from '@angular/material/icon';
import { PlannerTaskComponent } from '../planner-task/planner-task.component';
import { PlannerRepeatProjectionComponent } from '../planner-repeat-projection/planner-repeat-projection.component';
import { PlannerDeadlineTaskComponent } from '../planner-deadline-task/planner-deadline-task.component';
import { AddTaskInlineComponent } from '../add-task-inline/add-task-inline.component';
import { NgClass } from '@angular/common';
import { PlannerCalendarEventComponent } from '../planner-calendar-event/planner-calendar-event.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RoundDurationPipe } from '../../../ui/pipes/round-duration.pipe';
import { ShortTimeHtmlPipe } from '../../../ui/pipes/short-time-html.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { ShortDate2Pipe } from '../../../ui/pipes/short-date2.pipe';
import { ProgressBarComponent } from '../../../ui/progress-bar/progress-bar.component';
import { dragDelayForTouch } from '../../../util/input-intent';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { safeFormatDate } from '../../../util/safe-format-date';

@Component({
  selector: 'planner-day',
  templateUrl: './planner-day.component.html',
  styleUrl: './planner-day.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIcon,
    CdkDropList,
    PlannerTaskComponent,
    CdkDrag,
    PlannerRepeatProjectionComponent,
    PlannerDeadlineTaskComponent,
    AddTaskInlineComponent,
    NgClass,
    PlannerCalendarEventComponent,
    MsToStringPipe,
    RoundDurationPipe,
    ShortTimeHtmlPipe,
    TranslatePipe,
    ShortDate2Pipe,
    ProgressBarComponent,
  ],
})
export class PlannerDayComponent {
  protected readonly multiSelect = inject(TaskMultiSelectService);
  private _store = inject(Store);
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);
  private _layoutService = inject(LayoutService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _externalDragService = inject(ScheduleExternalDragService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() day!: PlannerDay;

  @HostBinding('attr.data-day') get dataDayAttr(): string | undefined {
    return this.day?.dayDate;
  }

  @HostBinding('attr.data-planner-selection-scope')
  get selectionScopeAttr(): string | undefined {
    return this.day?.dayDate;
  }

  protected readonly T = T;
  protected readonly SCHEDULE_ITEM_TYPE = ScheduleItemType;
  protected readonly dragDelayForTouch = dragDelayForTouch;
  // Lock Y-axis on small screens only — on wider screens the planner uses a
  // multi-column grid where cross-column dragging requires horizontal movement.
  protected readonly isXs = this._layoutService.isXs;

  // Precompute the weekday ('EEE') header label, keyed on the current locale.
  // Replaces a per-CD `| localeDate: 'EEE'` pipe. The parent tracks planner-day
  // by `day.dayDate`, so the instance (and thus `this.day.dayDate`) is stable
  // for its lifetime; only a locale change needs to recompute the label.
  protected readonly dayLabel = computed(() => {
    const isoTextLocale = this._dateTimeFormatService.isoTextLocale();
    return isoTextLocale
      ? parseDbDateStr(this.day.dayDate).toLocaleDateString(isoTextLocale, {
          weekday: 'short',
        })
      : safeFormatDate(
          this.day.dayDate,
          'EEE',
          this._dateTimeFormatService.currentLocale(),
        );
  });

  getProgressBarClass(percentage: number | undefined): string {
    if (!percentage) return 'bg-success';

    if (percentage > 95) {
      return 'bg-danger';
    } else if (percentage > 80) {
      return 'bg-warning';
    } else {
      return 'bg-success';
    }
  }

  // Register the drag so the side nav (projects, tags) and the schedule panel
  // can handle drops on them (#11210)
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

  // TODO correct type
  drop(
    targetList: 'TODO' | 'SCHEDULED',
    allItems: TaskCopy[] | ScheduleItem[],
    ev: CdkDragDrop<string, string, TaskCopy>,
  ): void {
    // the side nav or schedule panel already handled the drop; skip the reorder
    if (this._externalDragService.isCancelNextDrop()) {
      this._externalDragService.setCancelNextDrop(false);
      return;
    }

    const newDay = ev.container.data;
    const task = ev.item.data;

    if (targetList === 'SCHEDULED') {
      if (ev.previousContainer !== ev.container) {
        this.editTaskReminderOrReScheduleIfPossible(task, ev.container.data);
      }
      return;
    } else if (targetList === 'TODO') {
      if (ev.previousContainer === ev.container) {
        if (this.day.isToday) {
          this._store.dispatch(
            TaskSharedActions.moveTaskInTodayTagList({
              toTaskId: allItems[ev.currentIndex].id,
              fromTaskId: task.id,
            }),
          );
        } else {
          this._store.dispatch(
            PlannerActions.moveInList({
              targetDay: ev.container.data,
              fromIndex: ev.previousIndex,
              toIndex: ev.currentIndex,
            }),
          );
        }
      } else {
        this._store.dispatch(
          PlannerActions.transferTask({
            task: task,
            prevDay: ev.previousContainer.data,
            newDay: newDay,
            targetIndex: ev.currentIndex,
            today: this._dateService.todayStr(),
            targetTaskId: allItems[ev.currentIndex]?.id,
          }),
        );
      }
    }
  }

  editTaskReminderOrReScheduleIfPossible(task: TaskCopy, newDay?: string): void {
    if (newDay) {
      const newDate = dateStrToUtcDate(newDay);
      if (task.dueWithTime) {
        this._rescheduleTask(task, newDate);
        return;
      }
    }

    this._matDialog.open(DialogScheduleTaskComponent, {
      data: {
        task,
        targetDay: newDay,
      },
    });
  }

  private _rescheduleTask(task: TaskCopy, newDate: Date): void {
    const taskPlannedAtDate = new Date(task.dueWithTime as number);
    newDate.setHours(taskPlannedAtDate.getHours(), taskPlannedAtDate.getMinutes(), 0, 0);
    const selectedReminderCfgId = millisecondsDiffToRemindOption(
      task.dueWithTime as number,
      task.remindAt,
    );
    this._taskService.scheduleTask(task, newDate.getTime(), selectedReminderCfgId, false);
  }
}
