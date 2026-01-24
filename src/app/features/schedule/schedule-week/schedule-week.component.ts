/* eslint-disable @typescript-eslint/naming-convention */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ScheduleEvent } from '../schedule.model';
import { CdkDragMove, CdkDragRelease, CdkDragStart } from '@angular/cdk/drag-drop';
import { FH, SVEType } from '../schedule.const';
import { isDraggableSE } from '../map-schedule-data/is-schedule-types-type';
import { throttle } from '../../../util/decorators';
import { CreateTaskPlaceholderComponent } from '../create-task-placeholder/create-task-placeholder.component';
import { ScheduleEventComponent } from '../schedule-event/schedule-event.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../t.const';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { DRAG_DELAY_FOR_TOUCH } from '../../../app.constants';
import { MatTooltip } from '@angular/material/tooltip';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { formatMonthDay } from '../../../util/format-month-day.util';
import { ScheduleWeekDragService } from './schedule-week-drag.service';
import { calculatePlaceholderForGridMove } from './schedule-week-placeholder.util';
import { truncate } from '../../../util/truncate';

const D_HOURS = 24;

@Component({
  selector: 'schedule-week',
  imports: [
    ScheduleEventComponent,
    CreateTaskPlaceholderComponent,
    MatIcon,
    TranslatePipe,
    MatTooltip,
    LocaleDatePipe,
  ],
  templateUrl: './schedule-week.component.html',
  styleUrl: './schedule-week.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  providers: [ScheduleWeekDragService],
  host: {
    '[class.isCtrlKeyPressed]': 'isCtrlPressed()',
    '[class.isShiftKeyPressed]': 'isShiftNoScheduleMode()',
    '[class.is-dragging]': 'isDragging()',
    '[class.is-not-dragging]': '!isDragging()',
    '[class.is-resizing-event]': 'isAnyEventResizing()',
    '[class]': 'dragEventTypeClass()',
    '[attr.data-horizontal-scroll]': 'isHorizontalScrollMode() || null',
  },
})
export class ScheduleWeekComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly _service = inject(ScheduleWeekDragService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);

  isInPanel = input<boolean>(false);
  isHorizontalScrollMode = input<boolean>(false);
  events = input<ScheduleEvent[] | null>([]);
  beyondBudget = input<ScheduleEvent[][] | null>([]);
  daysToShow = input<string[]>([]);
  workStartEnd = input<{ workStartRow: number; workEndRow: number } | null>(null);
  currentTimeRow = input<number | null>(null);
  todayDateStr = input<string | undefined>(undefined);
  isCtrlPressed = signal<boolean>(false);
  isTaskDragActive = input<boolean>(false);

  // Shift mode changes drag behavior: instead of scheduling at a time,
  // tasks are planned for the day or reordered relative to other tasks.
  readonly isShiftNoScheduleMode = this._service.isShiftMode;

  FH = FH;
  IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
  DRAG_DELAY_FOR_TOUCH = DRAG_DELAY_FOR_TOUCH;
  SVEType: typeof SVEType = SVEType;
  T: typeof T = T;
  protected readonly isDraggableSE = isDraggableSE;

  rowsByNr = Array.from({ length: D_HOURS * FH }, (_, index) => index).filter(
    (_, index) => index % FH === 0,
  );

  times = computed(() => {
    const uses24Hour = this._dateTimeFormatService.is24HourFormat();
    const formatter = new Intl.DateTimeFormat(this._dateTimeFormatService.currentLocale, {
      hour: uses24Hour ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !uses24Hour,
    });

    return this.rowsByNr.map((_, hourIndex) => {
      const date = new Date(2000, 0, 1, hourIndex, 0, 0);
      return formatter.format(date);
    });
  });

  endOfDayColRowStart = signal<number>(D_HOURS * 0.5 * FH);
  totalRows: number = D_HOURS * FH;

  safeEvents = computed(() => this.events() || []);
  safeBeyondBudget = computed(() => this.beyondBudget() || []);

  newTaskPlaceholder = signal<{
    style: string;
    time: string;
    date: string;
  } | null>(null);

  isDragging = this._service.isDragging;
  isAnyEventResizing = signal(false);
  isCreateTaskActive = signal(false);
  currentDragEvent = this._service.currentDragEvent;
  dragPreviewStyle = this._service.dragPreviewStyle;
  // Show shift key info tooltip
  showShiftKeyInfo = this._service.showShiftKeyInfo;

  // Apply CSS class based on dragged event type to enable type-specific styling,
  // such as different colors or visual treatments for tasks vs split tasks.
  dragEventTypeClass = computed(() => {
    const currentEvent = this.currentDragEvent();
    return currentEvent ? currentEvent.type : '';
  });

  readonly gridContainer = viewChild.required<ElementRef>('gridContainer');

  // Drag preview properties for time indicator
  private readonly _dragPreviewContext = this._service.dragPreviewContext;
  readonly dragPreviewContext = this._service.dragPreviewContext;
  private readonly _dragOverTaskId = this._service.dragOverTaskId;

  dragPreviewLabel = computed(() => {
    // Check if we're hovering over a task for reordering (shift mode)
    const dragOverTaskId = this._dragOverTaskId();
    const currentDraggedEvent = this.currentDragEvent();

    if (dragOverTaskId && currentDraggedEvent) {
      // Find the hovered task from events to display its title
      const allEvents = this.safeEvents();
      const targetEvent = allEvents.find((ev) => {
        const task = ev.data as any;
        return task?.id === dragOverTaskId;
      });

      if (targetEvent && targetEvent.data) {
        const targetTask = targetEvent.data as any;
        const taskTitle = truncate(targetTask.title || 'task', 20);
        const insertBeforeLabel = this._translateService.instant(
          T.F.SCHEDULE.INSERT_BEFORE,
        );
        return `⤷ ${insertBeforeLabel}: ${taskTitle}`;
      }
    }

    const ctx = this._dragPreviewContext();
    if (!ctx) {
      return null;
    }
    if (ctx.kind === 'time') {
      return this._dateTimeFormatService.formatTime(ctx.timestamp);
    }
    if (ctx.kind === 'shift-column') {
      const dateLabel = this._formatDateLabel(ctx.day);
      return (
        (ctx.isEndOfDay ? '⇩' : '⇧') +
        this._translateService.instant(
          ctx.isEndOfDay ? T.F.SCHEDULE.PLAN_END_DAY : T.F.SCHEDULE.PLAN_START_DAY,
          { date: dateLabel },
        )
      );
    }
    if (ctx.kind === 'shift-task') {
      return null;
    }
    return ctx.label;
  });

  private _currentAniTimeout: number | undefined;
  private _resizeObserver?: MutationObserver;

  ngOnInit(): void {
    const workStartEnd = this.workStartEnd();
    // Position the "end of day" planning area based on work hours config,
    // or default to noon if not specified.
    this.endOfDayColRowStart.set(workStartEnd?.workStartRow || D_HOURS * 0.5 * FH);
    // Provide the live days signal so the drag service can map drops to columns.
    this._service.setDaysToShowAccessor(() => this.daysToShow() || []);
  }

  ngAfterViewInit(): void {
    // Use an accessor function to safely provide grid access without holding
    // a stale reference if the component re-renders or the grid is recreated.
    this._service.setGridContainer(() => {
      try {
        return this.gridContainer().nativeElement as HTMLElement;
      } catch {
        return null;
      }
    });
    this._setupResizeObserver();
  }

  ngOnDestroy(): void {
    window.clearTimeout(this._currentAniTimeout);
    // Clean up resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = undefined;
    }
    this.isAnyEventResizing.set(false);
    this._service.destroy();
  }

  onGridClick(ev: MouseEvent): void {
    if (this.isAnyEventResizing()) {
      return;
    }
    if (ev.target instanceof HTMLElement) {
      if (ev.target.classList.contains('col')) {
        this.isCreateTaskActive.set(true);
      }
    }
  }

  // Throttle to 30ms to reduce computational overhead during rapid mouse movements.
  @throttle(30)
  onMoveOverGrid(ev: MouseEvent): void {
    // Prevent showing the "create task" placeholder during or right after a drag
    // to avoid confusing visual feedback during the reset animation.
    if (this.isDragging()) {
      return;
    }
    if (this.isAnyEventResizing()) {
      this.newTaskPlaceholder.set(null);
      return;
    }
    if (this.isCreateTaskActive()) {
      return;
    }

    const gridRef = this.gridContainer();
    const gridElement = gridRef?.nativeElement as HTMLElement | undefined;
    if (!gridElement) {
      this.newTaskPlaceholder.set(null);
      return;
    }

    const placeholder = calculatePlaceholderForGridMove({
      event: ev,
      gridElement,
      days: this.daysToShow() || [],
      isTouchPrimary: IS_TOUCH_PRIMARY,
    });

    this.newTaskPlaceholder.set(placeholder);
  }

  // Throttle drag updates to avoid excessive re-renders and DOM queries.
  @throttle(30)
  dragMoved(ev: CdkDragMove<ScheduleEvent>): void {
    this._service.handleDragMoved(ev);
  }

  dragStarted(ev: CdkDragStart<ScheduleEvent>): void {
    this._service.handleDragStarted(ev);
  }

  dragReleased(ev: CdkDragRelease): void {
    this._service.handleDragReleased(ev);
  }

  // Listen for modifier keys globally so users can switch drag modes mid-drag.
  // Document-level because key events must work even when focus is elsewhere.
  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this._service.setShiftMode(true);
      // Update preview immediately to reflect the mode change.
      this._service.refreshPreviewForCurrentPointer();
    }
    if (event.key === 'Control' || event.ctrlKey) {
      this.isCtrlPressed.set(true);
    }
  }

  @HostListener('document:keyup', ['$event'])
  onDocumentKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this._service.setShiftMode(false);
      // Update preview immediately to reflect the mode change.
      this._service.refreshPreviewForCurrentPointer();
    }
    if (event.key === 'Control' || !event.ctrlKey) {
      this.isCtrlPressed.set(false);
    }
  }

  private _setupResizeObserver(): void {
    const gridRef = this.gridContainer();
    const gridElement = gridRef?.nativeElement as HTMLElement | undefined;
    if (!gridElement) {
      this.isAnyEventResizing.set(false);
      return;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }

    this._resizeObserver = new MutationObserver(() => {
      const resizingElements = gridElement.querySelectorAll('schedule-event.is-resizing');
      this.isAnyEventResizing.set(resizingElements.length > 0);
    });

    this._resizeObserver.observe(gridElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private _formatDateLabel(dayStr: string): string {
    if (!dayStr) {
      return '';
    }
    const date = parseDbDateStr(dayStr);
    if (Number.isNaN(date.getTime())) {
      return dayStr;
    }
    return formatMonthDay(date, this._dateTimeFormatService.currentLocale);
  }

  // Public methods for external preview control (used by schedule-day-panel)
  showExternalPreview(event: ScheduleEvent, style: string, timestamp: number): void {
    this._service.showExternalPreview(event, style, timestamp);
  }

  updateExternalPreview(style: string, timestamp: number): void {
    this._service.updateExternalPreview(style, timestamp);
  }

  hideExternalPreview(): void {
    this._service.hideExternalPreview();
  }
}
