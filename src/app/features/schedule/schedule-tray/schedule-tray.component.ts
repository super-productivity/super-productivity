import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CdkDrag,
  CdkDragMove,
  CdkDragRelease,
  CdkDragStart,
} from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { ScheduleDayTray, ScheduleEvent } from '../schedule.model';
import { ScheduleWeekDragService } from '../schedule-week/schedule-week-drag.service';
import { toTrayCell } from './schedule-tray.util';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { checkKeyCombo } from '../../../util/check-key-combo';
import { dragDelayForTouch, isTouchActive } from '../../../util/input-intent';
import { throttle } from '../../../util/decorators';

const MAX_CHIPS = 3;
const MAX_CHIPS_XS = 2;

/**
 * Tray mode's row between the day header and the time grid: per day, the tasks
 * planned for it without a time and how they compare to the time that is left.
 */
@Component({
  selector: 'schedule-tray',
  imports: [CdkDrag, MatIcon, TranslatePipe],
  templateUrl: './schedule-tray.component.html',
  styleUrl: './schedule-tray.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.is-horizontal-scroll]': 'isHorizontalScroll()',
  },
})
export class ScheduleTrayComponent {
  private readonly _dragService = inject(ScheduleWeekDragService);
  private readonly _taskService = inject(TaskService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _layoutService = inject(LayoutService);

  days = input.required<string[]>();
  trays = input.required<Record<string, ScheduleDayTray>>();
  isHorizontalScroll = input<boolean>(false);
  openDay = output<string>();

  // shortcut: the expanded tray has no height cap, since a scrolling cell would
  // clip a chip while it is dragged — cap it once chips drag as a detached preview
  isExpanded = signal(false);

  // a phone's scrolling week has columns too narrow for chips: count and
  // free/over only, the tasks are one tap away
  isCompact = computed(() => this.isHorizontalScroll() && this._layoutService.isXs());

  cells = computed(() => {
    const maxChips = this.isExpanded()
      ? Infinity
      : this._layoutService.isXs()
        ? MAX_CHIPS_XS
        : MAX_CHIPS;
    const trays = this.trays();
    return this.days().map((day) => toTrayCell(day, trays[day], maxChips));
  });
  hasItems = computed(() => this.cells().some((cell) => cell.count > 0));

  readonly dragOverDay = this._dragService.dragOverTrayDay;
  // While the grid shows where the task would land, that preview is the task.
  shownInGridId = computed(() => {
    const ev = this._dragService.currentDragEvent();
    return ev?.isInTray && this._dragService.dragPreviewStyle() ? ev.id : null;
  });

  T: typeof T = T;
  protected readonly isTouchActive = isTouchActive;
  protected readonly dragDelayForTouch = dragDelayForTouch;

  openTask(task: TaskCopy): void {
    this._taskService.setSelectedId(task.id);
  }

  openScheduleDialog(task: TaskCopy, day: string): void {
    this._matDialog.open(DialogScheduleTaskComponent, {
      autoFocus: false,
      data: { task, targetDay: day },
    });
  }

  onChipKeydown(ev: KeyboardEvent, task: TaskCopy, day: string): void {
    const keys = this._globalConfigService.cfg()?.keyboard;
    if (keys && checkKeyCombo(ev, keys.taskSchedule)) {
      ev.preventDefault();
      ev.stopPropagation();
      this.openScheduleDialog(task, day);
    }
  }

  dragStarted(ev: CdkDragStart<ScheduleEvent>): void {
    this._dragService.handleDragStarted(ev);
  }

  // same throttle as the grid's events
  @throttle(30)
  dragMoved(ev: CdkDragMove<ScheduleEvent>): void {
    this._dragService.handleDragMoved(ev);
  }

  dragReleased(ev: CdkDragRelease): void {
    this._dragService.handleDragReleased(ev);
  }
}
