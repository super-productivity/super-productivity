import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChildren,
} from '@angular/core';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import { AddTaskBarComponent } from '../../tasks/add-task-bar/add-task-bar.component';
import { TaskCopy } from '../../tasks/task.model';
import { LocalDateStrPipe } from '../../../ui/pipes/local-date-str.pipe';
import { ShortPlannedAtPipe } from '../../../ui/pipes/short-planned-at.pipe';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { dragDelayForTouch } from '../../../util/input-intent';
import {
  getScheduledDateColor,
  readClockUntilDue,
} from '../../tasks/util/get-scheduled-date-color';
import type { ScheduledDateColor } from '../../tasks/util/get-scheduled-date-color';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../../core/date/date.service';
import { T } from '../../../t.const';
import { BOARD_PANEL } from './board-panel.token';

/**
 * A board panel as a column of cards (`planner-task`), for columns side by
 * side: header, add bar and the drop list. State and moves are the panel's.
 */
@Component({
  selector: 'board-panel-cards',
  standalone: true,
  imports: [
    CdkDrag,
    CdkDropList,
    PlannerTaskComponent,
    AddTaskBarComponent,
    MatIcon,
    MatIconButton,
    MatTooltip,
    TranslatePipe,
    LocalDateStrPipe,
    ShortPlannedAtPipe,
    MsToStringPipe,
  ],
  templateUrl: './board-panel-cards.component.html',
  styleUrl: './board-panel-cards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPanelCardsComponent {
  readonly panel = inject(BOARD_PANEL);
  protected readonly T = T;
  protected readonly dragDelayForTouch = dragDelayForTouch;
  private readonly _trackingInterval = inject(GlobalTrackingIntervalService);
  private readonly _dateService = inject(DateService);
  private readonly _cards = viewChildren(PlannerTaskComponent, { read: ElementRef });

  /** The cards, in order (the panel's keyboard rows). */
  cards(): HTMLElement[] {
    return this._cards().map((card) => card.nativeElement as HTMLElement);
  }

  scheduledDateColor(task: TaskCopy): ScheduledDateColor {
    if (
      task.isDone ||
      this.panel.taskService.currentTaskId() === task.id ||
      (!task.dueDay && !task.dueWithTime)
    ) {
      return '';
    }
    return getScheduledDateColor(
      task,
      this._trackingInterval.todayDateStr(),
      this._dateService.getStartOfNextDayDiffMs(),
      task.dueWithTime
        ? readClockUntilDue(
            this._trackingInterval.clockTimestamp,
            this._trackingInterval.clockMinute,
            task.dueWithTime,
          )
        : 0,
    );
  }
}
