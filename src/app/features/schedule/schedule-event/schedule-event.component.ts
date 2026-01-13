import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { ScheduleEvent, ScheduleFromCalendarEvent } from '../schedule.model';
import { MatIcon } from '@angular/material/icon';
import { delay, first } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { selectProjectById } from '../../project/store/project.selectors';
import { getClockStringFromHours } from '../../../util/get-clock-string-from-hours';
import {
  SCHEDULE_TASK_MIN_DURATION_IN_MS,
  SVEType,
  T_ID_PREFIX,
} from '../schedule.const';
import { isDraggableSE } from '../map-schedule-data/is-schedule-types-type';
import { MatDialog } from '@angular/material/dialog';
import { DialogEditTaskRepeatCfgComponent } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TaskCopy } from '../../tasks/task.model';
import { selectTaskByIdWithSubTaskData } from '../../tasks/store/task.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { TaskService } from '../../tasks/task.service';
import { DialogTimeEstimateComponent } from '../../tasks/dialog-time-estimate/dialog-time-estimate.component';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { TaskContextMenuComponent } from '../../tasks/task-context-menu/task-context-menu.component';
import { IssueService } from '../../issue/issue.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { FH } from '../schedule.const';

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

@Component({
  selector: 'schedule-event',
  imports: [MatIcon, TranslateModule, TaskContextMenuComponent],
  templateUrl: './schedule-event.component.html',
  styleUrl: './schedule-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    '[id]': 'elementId()',
    '[title]': 'hoverTitle()',
    '[class]': 'cssClass()',
    '[style]': 'style()',
    '[style.--project-color]': 'projectColor()',
    '[style.height]': '_resizeHeight()',
    '(click)': 'clickHandler()',
    '(contextmenu)': 'onContextMenu($event)',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
  hostDirectives: [
    {
      directive: CdkDrag,
      inputs: ['cdkDragData', 'cdkDragDisabled', 'cdkDragStartDelay'],
      outputs: ['cdkDragStarted', 'cdkDragReleased', 'cdkDragEnded', 'cdkDragMoved'],
    },
  ],
})
export class ScheduleEventComponent {
  private _store = inject(Store);
  private _elRef = inject(ElementRef);
  private _matDialog = inject(MatDialog);
  private _issueService = inject(IssueService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _taskService = inject(TaskService);

  readonly T: typeof T = T;
  readonly isDragPreview = input<boolean>(false);
  readonly isMonthView = input<boolean>(false);
  readonly event = input.required<ScheduleEvent>();

  readonly taskContextMenu = viewChild('taskContextMenu', {
    read: TaskContextMenuComponent,
  });

  protected readonly SVEType = SVEType;
  private _isBeingSubmitted = false;

  // Computed signals for derived state
  readonly se = computed(() => this.event());
  readonly task = computed<TaskCopy | undefined>(() => {
    const evt = this.se();
    if (
      evt.type === SVEType.Task ||
      evt.type === SVEType.SplitTask ||
      evt.type === SVEType.TaskPlannedForDay ||
      evt.type === SVEType.SplitTaskPlannedForDay ||
      evt.type === SVEType.ScheduledTask
    ) {
      return evt.data as TaskCopy;
    }
    return undefined;
  });

  readonly title = computed(() => {
    const evt = this.se();
    return (
      (evt as any)?.data?.title ||
      (evt.type === SVEType.LunchBreak ? 'Lunch Break' : 'TITLE')
    );
  });

  readonly scheduledClockStr = computed(() => {
    const evt = this.se();
    const is12Hour = !this._dateTimeFormatService.is24HourFormat;
    return getClockStringFromHours(
      is12Hour && evt.startHours > 12 ? evt.startHours - 12 : evt.startHours,
    );
  });

  readonly hoverTitle = computed(() => {
    const evt = this.se();
    const is12Hour = !this._dateTimeFormatService.is24HourFormat;
    const startClockStr = getClockStringFromHours(
      is12Hour && evt.startHours > 12 ? evt.startHours - 12 : evt.startHours,
    );
    const endHours = evt.startHours + evt.timeLeftInHours;
    const endClockStr = getClockStringFromHours(
      is12Hour && endHours > 12 ? endHours - 12 : endHours,
    );
    const titleStr = this.title();
    const t = this.task();

    let result = startClockStr + ' - ' + endClockStr + '  ' + titleStr;
    if (
      t &&
      (evt.type === SVEType.Task || evt.type === SVEType.TaskPlannedForDay) &&
      t.timeEstimate === SCHEDULE_TASK_MIN_DURATION_IN_MS &&
      t.timeSpent === 0
    ) {
      result += '  !!!!! ESTIMATE FOR SCHEDULE WAS SET TO 10MIN !!!!!';
    }
    return result;
  });

  readonly isSplitStart = computed(() => {
    const evt = this.se();
    return (
      evt.type === SVEType.SplitTask ||
      evt.type === SVEType.RepeatProjectionSplit ||
      evt.type === SVEType.SplitTaskPlannedForDay
    );
  });

  readonly isSplitContinued = computed(() => {
    const evt = this.se();
    return (
      evt.type === SVEType.SplitTaskContinued ||
      evt.type === SVEType.RepeatProjectionSplitContinued
    );
  });

  readonly isSplitContinuedLast = computed(() => {
    const evt = this.se();
    return (
      evt.type === SVEType.SplitTaskContinuedLast ||
      evt.type === SVEType.RepeatProjectionSplitContinuedLast
    );
  });

  readonly cssClass = computed(() => {
    const evt = this.se();
    let addClass = '';
    if (this.isSplitContinued()) {
      addClass = 'split-continued';
    } else if (this.isSplitContinuedLast()) {
      addClass = 'split-continued-last';
    } else if (this.isSplitStart()) {
      addClass = 'split-start';
    }

    if (evt.timeLeftInHours <= 1 / 4) {
      addClass += ' very-short-event';
    }

    if (this._isResizing()) {
      addClass += ' is-resizing';
    }

    return evt.type + '  ' + addClass;
  });

  readonly style = computed(() => {
    const { overlap, style } = this.se();
    // Arbitrarily chosen value that controls width reduction of this component
    // whenever the underlying event duration overlaps with others
    const overlapReductionFactor = 0.75;
    return (
      (!this.isMonthView() && !this.isDragPreview() && overlap
        ? // eslint-disable-next-line no-mixed-operators -- conflicts with prettier formatting
          `margin-left: ${100 - 100 * Math.pow(overlapReductionFactor, overlap.offset)}%; ` +
          `width: calc(${Math.pow(overlapReductionFactor, overlap.count) * 100}% - var(--margin-right)); ` +
          // Content inside the event element can spill out when the width is limited enough
          'overflow: hidden !important; '
        : '') + style
    );
  });

  private readonly _projectId = computed(() => this.task()?.projectId || null);

  readonly projectColor = computed(() => {
    const projectId = this._projectId();
    if (!projectId) return '';
    // Use store.select and convert to immediate value
    let color = '';
    this._store
      .select(selectProjectById, { id: projectId })
      .pipe(first())
      .subscribe((project) => {
        color = project?.theme?.primary || '';
      });
    return color;
  });

  readonly elementId = computed(() => {
    const evt = this.se();
    return isDraggableSE(evt) ? T_ID_PREFIX + (evt.data as any).id : '';
  });

  readonly icoType = computed<
    | 'REPEAT'
    | 'FLOW'
    | 'SCHEDULED_TASK'
    | 'PLANNED_FOR_DAY'
    | 'CAL_PROJECTION'
    | 'SPLIT_CONTINUE'
    | 'LUNCH_BREAK'
  >(() => {
    const evt = this.se();
    switch (evt.type) {
      case SVEType.ScheduledRepeatProjection:
      case SVEType.RepeatProjection:
      case SVEType.RepeatProjectionSplit:
        return 'REPEAT';
      case SVEType.TaskPlannedForDay:
      case SVEType.SplitTaskPlannedForDay:
        return 'PLANNED_FOR_DAY';
      case SVEType.Task:
      case SVEType.SplitTask:
        return 'FLOW';
      case SVEType.CalendarEvent:
        return 'CAL_PROJECTION';
      case SVEType.ScheduledTask:
        return 'SCHEDULED_TASK';
      case SVEType.LunchBreak:
        return 'LUNCH_BREAK';
    }
    return 'SPLIT_CONTINUE';
  });

  async clickHandler(): Promise<void> {
    // Prevent opening dialog when resizing or just finished resizing
    if (this._isResizing() || this._justFinishedResizing()) {
      return;
    }

    const t = this.task();
    const evt = this.se();

    if (t) {
      // Use bottom panel on mobile, sidebar on desktop
      this._taskService.setSelectedId(t.id);
    } else if (
      evt.type === SVEType.RepeatProjection ||
      evt.type === SVEType.RepeatProjectionSplit ||
      evt.type === SVEType.ScheduledRepeatProjection
    ) {
      const repeatCfg: TaskRepeatCfg = evt.data as TaskRepeatCfg;
      this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
        data: {
          repeatCfg,
          targetDate: (evt.id.includes('_') && evt.id.split('_')[1]) || undefined,
        },
      });
    } else if (evt.type === SVEType.CalendarEvent) {
      if (this._isBeingSubmitted) {
        return;
      }
      this._isBeingSubmitted = true;

      const data = evt.data as ScheduleFromCalendarEvent;
      this._issueService.addTaskFromIssue({
        issueDataReduced: data,
        issueProviderId: data.calProviderId,
        issueProviderKey: 'ICAL',
        isForceDefaultProject: true,
      });
    }
  }

  onContextMenu(ev: MouseEvent | TouchEvent): void {
    const t = this.task();
    if (t) {
      this.openContextMenu(ev);
    }
  }

  openContextMenu(event: TouchEvent | MouseEvent): void {
    this.taskContextMenu()?.open(event);
  }

  deleteTask(): void {
    const t = this.task();
    if (!t) return;

    this._store
      .select(selectTaskByIdWithSubTaskData, { id: t.id })
      .pipe(
        first(),
        // NOTE without the delay selectTaskByIdWithSubTaskData triggers twice for unknown reasons
        delay(50),
      )
      .subscribe((task) => {
        this._store.dispatch(TaskSharedActions.deleteTask({ task }));
      });
  }

  estimateTime(): void {
    const t = this.task();
    if (!t) return;

    this._matDialog.open(DialogTimeEstimateComponent, {
      data: { task: t, isFocusEstimateOnMousePrimaryDevice: true },
      autoFocus: !IS_TOUCH_PRIMARY,
    });
  }

  markAsDone(): void {
    const t = this.task();
    if (!t) return;

    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: {
          id: t.id,
          changes: {
            isDone: true,
          },
        },
      }),
    );
  }

  markAsUnDone(): void {
    const t = this.task();
    if (!t) return;

    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: {
          id: t.id,
          changes: {
            isDone: false,
          },
        },
      }),
    );
  }

  // Resize functionality
  // --------------------
  private readonly _isResizing = signal(false);
  private readonly _justFinishedResizing = signal(false);
  readonly _resizeHeight = signal('');
  private _startY = 0;
  private _startHeight = 0;

  isResizable(): boolean {
    const t = this.task();
    const evt = this.se();
    // Allow resizing for all task types with a time estimate
    return (
      !!t &&
      (evt.type === SVEType.ScheduledTask ||
        evt.type === SVEType.Task ||
        evt.type === SVEType.SplitTaskContinuedLast ||
        evt.type === SVEType.TaskPlannedForDay ||
        evt.type === SVEType.SplitTaskPlannedForDay) &&
      t.timeEstimate > 0
    );
  }

  onResizeStart(event: MouseEvent | TouchEvent): void {
    if (!this.isResizable()) return;

    event.stopPropagation();
    event.preventDefault();

    this._isResizing.set(true);

    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    this._startY = clientY;
    this._startHeight = this._elRef.nativeElement.offsetHeight;

    // Add event listeners for mouse/touch move and end
    const moveHandler = (e: MouseEvent | TouchEvent): void => this._onResizeMove(e);
    const endHandler = (): void => this._onResizeEnd(moveHandler, endHandler);

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', endHandler);
    document.addEventListener('touchmove', moveHandler);
    document.addEventListener('touchend', endHandler);
  }

  private _onResizeMove(event: MouseEvent | TouchEvent): void {
    if (!this._isResizing()) return;

    event.preventDefault();
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const deltaY = clientY - this._startY;

    // Calculate new height based on grid row height for snap-to-grid behavior
    const gridContainer = this._elRef.nativeElement.closest(
      '.grid-container',
    ) as HTMLElement | null;
    if (gridContainer) {
      const gridHeight = gridContainer.getBoundingClientRect().height;
      const rowHeight = gridHeight / (24 * FH);
      const rowsChanged = Math.round(deltaY / rowHeight);
      const snappedDelta = rowsChanged * rowHeight;
      const newHeight = Math.max(rowHeight, this._startHeight + snappedDelta);

      // Update the element height temporarily for visual feedback
      this._resizeHeight.set(newHeight + 'px');
    } else {
      // Fallback to original behavior
      const newHeight = Math.max(20, this._startHeight + deltaY);
      this._resizeHeight.set(newHeight + 'px');
    }
  }

  private _onResizeEnd(moveHandler: any, endHandler: any): void {
    if (!this._isResizing()) return;

    this._isResizing.set(false);

    // Set cooldown flag to prevent immediate click events
    this._justFinishedResizing.set(true);
    setTimeout(() => {
      this._justFinishedResizing.set(false);
    }, 200); // 200ms cooldown

    // Remove event listeners
    document.removeEventListener('mousemove', moveHandler);
    document.removeEventListener('mouseup', endHandler);
    document.removeEventListener('touchmove', moveHandler);
    document.removeEventListener('touchend', endHandler);

    // Calculate new duration based on height change
    const currentHeight = this._elRef.nativeElement.offsetHeight;
    const heightDelta = currentHeight - this._startHeight;

    // Convert height change to time change (based on grid row height)
    // Each row represents a time slice (FH rows per hour)
    const timeChangeInMs = this._calculateTimeFromHeightDelta(heightDelta);

    const t = this.task();
    if (t && Math.abs(timeChangeInMs) > 30000) {
      // Only update if change is more than 30 seconds (to be more responsive)
      const rawEstimate = t.timeEstimate + timeChangeInMs;
      const roundedEstimate = Math.max(
        FIVE_MINUTES_IN_MS,
        Math.round(rawEstimate / FIVE_MINUTES_IN_MS) * FIVE_MINUTES_IN_MS,
      );

      if (roundedEstimate !== t.timeEstimate) {
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: t.id,
              changes: {
                timeEstimate: roundedEstimate,
              },
            },
          }),
        );
      }
    }

    // Reset element height to let CSS handle it
    this._resizeHeight.set('');
  }

  private _calculateTimeFromHeightDelta(heightDelta: number): number {
    // Get the grid container to calculate row height
    const gridContainer = this._elRef.nativeElement.closest(
      '.grid-container',
    ) as HTMLElement | null;
    if (!gridContainer) return 0;

    const gridHeight = gridContainer.getBoundingClientRect().height;
    const rowHeight = gridHeight / (24 * FH); // Total rows = 24 hours * FH rows per hour
    const rowsChanged = heightDelta / rowHeight;
    const hoursChanged = rowsChanged / FH;

    // Convert to milliseconds
    return hoursChanged * 60 * 60 * 1000;
  }
}
