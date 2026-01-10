import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  Renderer2,
  signal,
  viewChild,
} from '@angular/core';
import { TaskService } from '../task.service';
import { EMPTY, forkJoin, of, Subscription } from 'rxjs';
import {
  HideSubTasksMode,
  TaskCopy,
  TaskDetailTargetPanel,
  TaskWithSubTasks,
} from '../task.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogTimeEstimateComponent } from '../dialog-time-estimate/dialog-time-estimate.component';
import {
  expandAnimation,
  expandInOnlyAnimation,
} from '../../../ui/animations/expand.ani';
import { GlobalConfigService } from '../../config/global-config.service';
import { concatMap, first, switchMap, tap } from 'rxjs/operators';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { PanDirective, PanEvent } from '../../../ui/swipe-gesture/pan.directive';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { DialogEditTaskAttachmentComponent } from '../task-attachment/dialog-edit-attachment/dialog-edit-task-attachment.component';
import { swirlAnimation } from '../../../ui/animations/swirl-in-out.ani';
import { DialogEditTaskRepeatCfgComponent } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { ProjectService } from '../../project/project.service';
import { Project } from '../../project/project.model';
import { T } from '../../../t.const';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { WorkContextService } from '../../work-context/work-context.service';
import { throttle } from '../../../util/decorators';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { Update } from '@ngrx/entity';
import { isToday } from '../../../util/is-today.util';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { KeyboardConfig } from '../../config/keyboard-config.model';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { TaskContextMenuComponent } from '../task-context-menu/task-context-menu.component';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ICAL_TYPE } from '../../issue/issue.const';
import { TaskTitleComponent } from '../../../ui/task-title/task-title.component';
import { MatIcon } from '@angular/material/icon';
import { LongPressIOSDirective } from '../../../ui/longpress/longpress-ios.directive';
import { MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { TaskHoverControlsComponent } from './task-hover-controls/task-hover-controls.component';
import { ProgressBarComponent } from '../../../ui/progress-bar/progress-bar.component';
import { TaskListComponent } from '../task-list/task-list.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { ShortPlannedAtPipe } from '../../../ui/pipes/short-planned-at.pipe';
import { LocalDateStrPipe } from '../../../ui/pipes/local-date-str.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { SubTaskTotalTimeSpentPipe } from '../pipes/sub-task-total-time-spent.pipe';
import { TagListComponent } from '../../tag/tag-list/tag-list.component';
import { ShortDate2Pipe } from '../../../ui/pipes/short-date2.pipe';
import { TagToggleMenuListComponent } from '../../tag/tag-toggle-menu-list/tag-toggle-menu-list.component';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { environment } from '../../../../environments/environment';
import { TODAY_TAG } from '../../tag/tag.const';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TaskLog } from '../../../core/log';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TaskFocusService } from '../task-focus.service';

@Component({
  selector: 'task',
  templateUrl: './task.component.html',
  styleUrls: ['./task.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation, fadeAnimation, swirlAnimation, expandInOnlyAnimation],
  /* eslint-disable @typescript-eslint/naming-convention*/
  host: {
    '[id]': 'taskIdWithPrefix()',
    '[tabindex]': '1',
    '[class.isDone]': 'task().isDone',
    '[class.isCurrent]': 'isCurrent()',
    '[class.isSelected]': 'isSelected()',
    '[class.hasNoSubTasks]': 'task().subTaskIds.length === 0',
  },
  imports: [
    MatIcon,
    MatMenuTrigger,
    LongPressIOSDirective,
    MatIconButton,
    TaskTitleComponent,
    TaskHoverControlsComponent,
    ProgressBarComponent,
    MatMiniFabButton,
    forwardRef(() => TaskListComponent),
    TaskContextMenuComponent,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MsToStringPipe,
    ShortDate2Pipe,
    LocalDateStrPipe,
    TranslatePipe,
    IssueIconPipe,
    SubTaskTotalTimeSpentPipe,
    TagListComponent,
    ShortPlannedAtPipe,
    TagToggleMenuListComponent,
    PanDirective,
  ],
})
export class TaskComponent implements OnDestroy, AfterViewInit {
  private readonly _taskService = inject(TaskService);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _configService = inject(GlobalConfigService);
  private readonly _attachmentService = inject(TaskAttachmentService);
  private readonly _elementRef = inject(ElementRef);
  private readonly _renderer = inject(Renderer2);
  private readonly _store = inject(Store);
  private readonly _projectService = inject(ProjectService);
  private readonly _taskFocusService = inject(TaskFocusService);

  readonly workContextService = inject(WorkContextService);
  readonly layoutService = inject(LayoutService);
  readonly globalTrackingIntervalService = inject(GlobalTrackingIntervalService);

  task = input.required<TaskWithSubTasks>();
  isBacklog = input<boolean>(false);
  isInSubTaskList = input<boolean>(false);

  // Use shared signals from services to avoid creating 600+ subscriptions on initial render
  isCurrent = computed(() => this._taskService.currentTaskId() === this.task().id);
  isSelected = computed(() => this._taskService.selectedTaskId() === this.task().id);
  isTaskOnTodayList = computed(() =>
    this._taskService.todayList().includes(this.task().id),
  );
  isTodayListActive = computed(() => this.workContextService.isTodayList);
  taskIdWithPrefix = computed(() => 't-' + this.task().id);
  isRepeatTaskCreatedToday = computed(
    () => !!(this.task().repeatCfgId && isToday(this.task().created)),
  );
  isOverdue = computed(() => {
    const t = this.task();
    return (
      !t.isDone &&
      ((t.dueWithTime && t.dueWithTime < Date.now()) ||
        // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
        // which is lexicographically sortable. This avoids timezone conversion issues that occur
        // when creating Date objects from date strings.
        (t.dueDay && t.dueDay !== getDbDateStr() && t.dueDay < getDbDateStr()))
    );
  });
  isScheduledToday = computed(() => {
    const t = this.task();
    return (
      (t.dueWithTime && isToday(t.dueWithTime)) ||
      (t.dueDay && t.dueDay === this.globalTrackingIntervalService.todayDateStr())
    );
  });

  isShowDueDayBtn = computed(() => {
    return (
      this.task().dueDay &&
      (!this.isTodayListActive() ||
        this.isOverdue() ||
        this.task().dueDay !== this.globalTrackingIntervalService.todayDateStr())
    );
  });

  progress = computed<number>(() => {
    const t = this.task();
    return (t.timeEstimate && (t.timeSpent / t.timeEstimate) * 100) || 0;
  });

  isShowRemoveFromToday = computed(() => {
    return (
      !this.isTodayListActive() &&
      !this.task().isDone &&
      this.task().dueDay === this.globalTrackingIntervalService.todayDateStr()
    );
  });

  isShowAddToToday = computed(() => {
    const task = this.task();
    const todayStr = this.globalTrackingIntervalService.todayDateStr();
    return this.isTodayListActive()
      ? (task.dueWithTime && !isToday(task.dueWithTime)) ||
          (task.dueDay && task.dueDay !== todayStr)
      : !this.isShowRemoveFromToday() &&
          task.dueDay !== todayStr &&
          (!task.dueWithTime || !isToday(task.dueWithTime));
  });

  isPanHelperVisible = signal(false);

  T: typeof T = T;
  IS_TOUCH_PRIMARY: boolean = IS_TOUCH_PRIMARY;
  isDragOver: boolean = false;
  isLockPanLeft: boolean = false;
  isLockPanRight: boolean = false;
  isPreventPointerEventsWhilePanning: boolean = false;
  isActionTriggered: boolean = false;
  ShowSubTasksMode: typeof HideSubTasksMode = HideSubTasksMode;
  isFirstLineHover: boolean = false;
  _nextFocusTaskEl?: HTMLElement;

  readonly taskTitleEditEl = viewChild<TaskTitleComponent>('taskTitleEditEl');
  readonly blockLeftElRef = viewChild<ElementRef>('blockLeftEl');
  readonly blockRightElRef = viewChild<ElementRef>('blockRightEl');
  readonly innerWrapperElRef = viewChild<ElementRef>('innerWrapperEl');
  readonly projectMenuTrigger = viewChild('projectMenuTriggerEl', {
    read: MatMenuTrigger,
  });
  readonly tagToggleMenuList = viewChild('tagToggleMenuList', {
    read: TagToggleMenuListComponent,
  });
  readonly taskContextMenu = viewChild('taskContextMenu', {
    read: TaskContextMenuComponent,
  });

  private _task$ = toObservable(this.task);

  // Lazy-loaded project list - only fetched when project menu opens
  moveToProjectList = signal<Project[] | undefined>(undefined);
  private _loadedProjectListForProjectId: string | null | undefined;
  private _moveToProjectListSub?: Subscription;

  parentTask = toSignal(
    this._task$.pipe(
      switchMap((task) =>
        task.parentId ? this._taskService.getByIdLive$(task.parentId) : of(null),
      ),
    ),
  );
  parentTitle = computed(() => this.parentTask()?.title ?? null);

  private _dragEnterTarget?: HTMLElement;
  private _currentPanTimeout?: number;
  private _doubleClickTimeout?: number;
  private _isTaskDeleteTriggered = false;
  private _panHelperVisibilityTimeout?: number;
  private readonly _snapBackHideDelayMs = 200;
  isContextMenuLoaded = signal(false);

  // methods come last

  @HostListener('focus') onFocus(): void {
    this._taskFocusService.focusedTaskId.set(this.task().id);
    this._taskFocusService.lastFocusedTaskComponent.set(this);
  }

  @HostListener('blur') onBlur(): void {
    this._taskFocusService.focusedTaskId.set(null);
  }

  @HostListener('dragenter', ['$event']) onDragEnter(ev: DragEvent): void {
    this._dragEnterTarget = ev.target as HTMLElement;
    ev.preventDefault();
    ev.stopPropagation();
    this.isDragOver = true;
  }

  @HostListener('dragleave', ['$event']) onDragLeave(ev: DragEvent): void {
    if (this._dragEnterTarget === (ev.target as HTMLElement)) {
      ev.preventDefault();
      ev.stopPropagation();
      this.isDragOver = false;
    }
  }

  @HostListener('drop', ['$event']) onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.focusSelf();
    this._attachmentService.createFromDrop(ev, this.task().id, true);
    ev.stopPropagation();
    this.isDragOver = false;
  }

  // NOTE: this prevents dragging on mobile for no touch area
  onTouchStart(ev: TouchEvent): void {
    if (!ev.target || !(ev.target as HTMLElement).classList?.contains('drag-handle')) {
      ev.stopPropagation();
    }
  }

  ngAfterViewInit(): void {
    // TODO remove
    if (!environment.production) {
      if (this.task().tagIds.includes(TODAY_TAG.id)) {
        throw new Error('Task should not have today tag');
      }
    }

    // hacky but relatively performant
    const t = this.task();
    if (t.parentId && !t.title.length && Date.now() - 200 < t.created) {
      setTimeout(() => {
        // when there are multiple instances with the same task we should focus the last one, since it is the one in the
        // task side panel
        const otherTaskEl = document.querySelectorAll('#t-' + t.id);
        if (
          otherTaskEl?.length <= 1 ||
          Array.from(otherTaskEl).findIndex(
            (item) => item === this._elementRef.nativeElement,
          ) ===
            otherTaskEl.length - 1
        ) {
          this.focusTitleForEdit();
        }
      });
    }
  }

  ngOnDestroy(): void {
    window.clearTimeout(this._currentPanTimeout);
    window.clearTimeout(this._doubleClickTimeout);
    this._moveToProjectListSub?.unsubscribe();
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
  }

  scheduleTask(): void {
    this._storeNextFocusEl();
    this._matDialog
      .open(DialogScheduleTaskComponent, {
        // we focus inside dialog instead
        autoFocus: false,
        data: { task: this.task() },
      })
      .afterClosed()
      .subscribe((isPlanned) => {
        this.focusSelfOrNextIfNotPossible();
      });
  }

  editTaskRepeatCfg(): void {
    this._matDialog
      .open(DialogEditTaskRepeatCfgComponent, {
        data: {
          task: this.task(),
          targetDate: this.task().dueDay || getDbDateStr(new Date(this.task().created)),
        },
      })
      .afterClosed()
      .subscribe(() => this.focusSelf());
  }

  deleteTask(isClick: boolean = false): void {
    // NOTE: prevents attempts to delete the same task multiple times
    if (this._isTaskDeleteTriggered) {
      return;
    }

    const isConfirmBeforeTaskDelete =
      this._configService.cfg()?.misc?.isConfirmBeforeTaskDelete ?? true;

    if (isConfirmBeforeTaskDelete) {
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: this.task().title },
          },
        })
        .afterClosed()
        .subscribe((isConfirm) => {
          if (isConfirm) {
            this._performDelete(isClick);
          }
        });
    } else {
      this._performDelete(isClick);
    }
  }

  private _performDelete(isClick: boolean): void {
    // NOTE: in case we want the focus behaviour on click we could use:
    // this.focusSelf();
    if (!isClick) {
      this.focusNext(true);
    }

    this._isTaskDeleteTriggered = true;
    this._taskService.remove(this.task());
  }

  startTask(): void {
    this._taskService.setCurrentId(this.task().id);
    this.focusSelf();
  }

  pauseTask(): void {
    this._taskService.pauseCurrent();
  }

  togglePlayPause(): void {
    if (this.isCurrent()) {
      this.pauseTask();
    } else {
      this.startTask();
    }
  }

  moveTaskUp(): void {
    const t = this.task();
    this._taskService.moveUp(t.id, t.parentId, this.isBacklog());
    // timeout required to let changes take place
    setTimeout(() => this.focusSelf());
    setTimeout(() => this.focusSelf(), 10);
  }

  moveTaskDown(): void {
    const t = this.task();
    this._taskService.moveDown(t.id, t.parentId, this.isBacklog());
    setTimeout(() => this.focusSelf());
    setTimeout(() => this.focusSelf(), 10);
  }

  moveTaskToTop(): void {
    const t = this.task();
    this._taskService.moveToTop(t.id, t.parentId, this.isBacklog());
    setTimeout(() => this.focusSelf());
    setTimeout(() => this.focusSelf(), 10);
  }

  moveTaskToBottom(): void {
    const t = this.task();
    this._taskService.moveToBottom(t.id, t.parentId, this.isBacklog());
    setTimeout(() => this.focusSelf());
    setTimeout(() => this.focusSelf(), 10);
  }

  handleArrowLeft(): void {
    const t = this.task();
    const hasSubTasks = t.subTasks && t.subTasks.length > 0;

    if (this.isSelected()) {
      this.hideDetailPanel();
    } else if (hasSubTasks && t._hideSubTasksMode !== HideSubTasksMode.HideAll) {
      this._taskService.toggleSubTaskMode(t.id, true, false);
    } else {
      this.focusPrevious();
    }
  }

  handleArrowRight(): void {
    const t = this.task();
    const hasSubTasks = t.subTasks && t.subTasks.length > 0;

    if (hasSubTasks && t._hideSubTasksMode !== undefined) {
      this._taskService.toggleSubTaskMode(t.id, false, false);
    } else if (!this.isSelected()) {
      this.showDetailPanel();
    } else {
      this.focusNext();
    }
  }

  moveToBacklogWithFocus(): void {
    const t = this.task();
    if (t.projectId && !t.parentId) {
      this.focusPrevious(true);
      this.moveToBacklog();
    }
  }

  moveToTodayWithFocus(): void {
    const t = this.task();
    if (t.projectId) {
      this.focusNext(true, true);
      this.moveToToday();
    }
  }

  openProjectMenu(): void {
    const t = this.task();
    if (!t.parentId) {
      // Lazy load project list when menu opens
      this._loadProjectListIfNeeded();
      const projectMenuTrigger = this.projectMenuTrigger();
      if (projectMenuTrigger) {
        projectMenuTrigger.openMenu();
      }
    }
  }

  _loadProjectListIfNeeded(): void {
    // Only load if not already loaded
    const currentProjectId = this.task().projectId || null;
    const isLoadedForCurrentProject =
      this._loadedProjectListForProjectId === currentProjectId &&
      this._moveToProjectListSub &&
      !this._moveToProjectListSub.closed;

    if (isLoadedForCurrentProject) {
      return;
    }

    this._moveToProjectListSub?.unsubscribe();
    this._loadedProjectListForProjectId = currentProjectId;

    this._moveToProjectListSub = this._projectService
      .getProjectsWithoutId$(currentProjectId)
      .subscribe((projects) => {
        this.moveToProjectList.set(projects);
      });
  }

  updateTaskTitleIfChanged({
    newVal,
    wasChanged,
    blurEvent,
  }: {
    newVal: string;
    wasChanged: boolean;
    blurEvent?: FocusEvent;
  }): void {
    if (wasChanged) {
      this._taskService.update(this.task().id, { title: newVal });
    }

    // Only focus self if no input/textarea is receiving focus next
    // This prevents stealing focus from any user input that was just clicked for editing
    const nextFocusTarget = blurEvent?.relatedTarget as HTMLElement | null;
    const isNextTargetInput =
      nextFocusTarget &&
      (nextFocusTarget.tagName.toLowerCase() === 'input' ||
        nextFocusTarget.tagName.toLowerCase() === 'textarea' ||
        nextFocusTarget.closest('task') !== null);

    if (!isNextTargetInput) {
      this.focusSelf();
    }
  }

  estimateTime(): void {
    this._matDialog
      .open(DialogTimeEstimateComponent, {
        data: { task: this.task() },
        autoFocus: !IS_TOUCH_PRIMARY,
      })
      .afterClosed()
      .subscribe(() => this.focusSelf());
  }

  addAttachment(): void {
    this._matDialog
      .open(DialogEditTaskAttachmentComponent, {
        data: {},
      })
      .afterClosed()
      .subscribe((result) => {
        if (result) {
          this._attachmentService.addAttachment(this.task().id, result);
        }
        this.focusSelf();
      });
  }

  addSubTask(): void {
    this._taskService.addSubTaskTo(this.task().parentId || this.task().id);
  }

  @throttle(200, { leading: true, trailing: false })
  toggleDoneKeyboard(): void {
    this.toggleTaskDone();
  }

  toggleTaskDone(): void {
    this.focusNext(true, true);

    if (this.task().isDone) {
      this._taskService.setUnDone(this.task().id);
    } else {
      this._taskService.setDone(this.task().id);
    }
  }

  showDetailPanel(): void {
    this._taskService.setSelectedId(this.task().id);
    this.focusSelf();
  }

  hideDetailPanel(): void {
    this._taskService.setSelectedId(this.task().id);
    this.focusSelf();
  }

  private _wasClickedInDoubleClickRange = false;

  toggleShowDetailPanel(ev?: MouseEvent): void {
    const isInTaskDetailPanel =
      this._elementRef.nativeElement.closest('task-detail-panel');
    if (isInTaskDetailPanel && !this._wasClickedInDoubleClickRange) {
      this._wasClickedInDoubleClickRange = true;
      window.clearTimeout(this._doubleClickTimeout);
      this._doubleClickTimeout = window.setTimeout(() => {
        this._wasClickedInDoubleClickRange = false;
      }, 400);
      return;
    }

    if (this.isSelected()) {
      this._taskService.setSelectedId(null);
    } else {
      this._taskService.setSelectedId(this.task().id);
    }
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  toggleShowAttachments(): void {
    this._taskService.setSelectedId(this.task().id, TaskDetailTargetPanel.Attachments);
    this.focusSelf();
  }

  toggleSubTaskMode(): void {
    this._taskService.toggleSubTaskMode(this.task().id, true, true);
    this.focusSelf();
  }

  isTagMenuVisible = signal(false);

  async editTags(): Promise<void> {
    this.isTagMenuVisible.set(true);
    setTimeout(() => {
      this.tagToggleMenuList()?.openMenu();
    });

    // this._matDialog
    //   .open(DialogEditTagsForTaskComponent, {
    //     data: {
    //       task: this.task(),
    //     },
    //   })
    //   .afterClosed()
    //   .subscribe(() => this.focusSelf());
  }

  toggleTag(tagId: string): void {
    const task = this.task();
    const tagIds = task.tagIds.includes(tagId)
      ? task.tagIds.filter((id) => id !== tagId)
      : [...task.tagIds, tagId];

    this.onTagsUpdated(tagIds);
  }

  addToMyDay(): void {
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({ taskIds: [this.task().id] }),
    );
  }

  unschedule(): void {
    this._store.dispatch(
      TaskSharedActions.unscheduleTask({
        id: this.task().id,
        reminderId: this.task().reminderId,
      }),
    );
  }

  titleBarClick(event: MouseEvent): void {
    const targetEl = event.target as HTMLElement;
    if (targetEl.closest('task-title')) {
      return;
    }
    if (IS_TOUCH_PRIMARY && this.task().title.length) {
      this.toggleShowDetailPanel(event);
    } else {
      this.focusSelf();
    }
  }

  focusPrevious(isFocusReverseIfNotPossible: boolean = false): void {
    if (IS_TOUCH_PRIMARY) {
      return;
    }

    const taskEls = Array.from(document.querySelectorAll('task'));
    const activeEl =
      document.activeElement?.tagName.toLowerCase() === 'task'
        ? document.activeElement
        : document.activeElement?.closest('task');
    const currentIndex = taskEls.findIndex((el) => el === activeEl);
    const prevEl = taskEls[currentIndex - 1] as HTMLElement;

    if (prevEl) {
      prevEl.focus();
      // hacky but works
      setTimeout(() => {
        if (document.activeElement !== prevEl) {
          prevEl.focus();
        }
      });
    } else if (isFocusReverseIfNotPossible) {
      this.focusNext();
    }
  }

  focusNext(
    isFocusReverseIfNotPossible: boolean = false,
    isTaskMovedInList = false,
  ): void {
    if (IS_TOUCH_PRIMARY) {
      return;
    }

    const nextEl = this._getNextFocusEl(isTaskMovedInList);
    this._nextFocusTaskEl = undefined;

    if (nextEl) {
      nextEl.focus();
      // hacky but works
      setTimeout(() => {
        if (document.activeElement !== nextEl) {
          nextEl.focus();
        }
      });
    } else if (isFocusReverseIfNotPossible) {
      this.focusPrevious();
    }
  }

  focusSelf(): void {
    if (IS_TOUCH_PRIMARY) {
      return;
    }
    this._focusSelfElement();
  }

  focusSelfOrNextIfNotPossible(): void {
    if (IS_TOUCH_PRIMARY) {
      return;
    }

    this.focusSelf();
    // we don't clear the timeout since this should be executed if task is gone
    window.setTimeout(() => {
      if (
        !document.activeElement ||
        document.activeElement.tagName.toLowerCase() !== 'task'
      ) {
        this.focusNext(true);
      }
    }, 200);
  }

  private _focusSelfElement(): void {
    this._elementRef.nativeElement.focus();
  }

  focusTitleForEdit(): void {
    const taskTitleEditEl = this.taskTitleEditEl();
    if (!taskTitleEditEl) {
      TaskLog.log(taskTitleEditEl);
      throw new Error('No el');
    }
    taskTitleEditEl.focusInput();
  }

  openContextMenu(event: TouchEvent | MouseEvent): void {
    this.taskTitleEditEl()?.cancelEditing();
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }

    if (!this.isContextMenuLoaded()) {
      this.isContextMenuLoaded.set(true);
      setTimeout(() => {
        this.taskContextMenu()?.open(event);
      });
      return;
    }

    this.taskContextMenu()?.open(event);
  }

  onTagsUpdated(tagIds: string[]): void {
    this._taskService.updateTags(this.task(), tagIds);
  }

  onPanStart(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY) {
      return;
    }
    const taskTitleEditEl = this.taskTitleEditEl();
    if (!taskTitleEditEl) {
      throw new Error('No el');
    }

    this._resetAfterPan();
    const targetEl: HTMLElement = ev.target as HTMLElement;
    if (
      (targetEl.className.indexOf && targetEl.className.indexOf('drag-handle') > -1) ||
      Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ||
      taskTitleEditEl.isEditing() ||
      ev.isFinal
    ) {
      this._hidePanHelper();
      return;
    }
    this._showPanHelper();
    this.isPreventPointerEventsWhilePanning = true;
  }

  onPanEnd(): void {
    if (!IS_TOUCH_PRIMARY || (!this.isLockPanLeft && !this.isLockPanRight)) {
      return;
    }
    const blockLeftElRef = this.blockLeftElRef();
    const blockRightElRef = this.blockRightElRef();
    const hideDelay = this._snapBackHideDelayMs;

    this.isPreventPointerEventsWhilePanning = false;
    if (blockLeftElRef) {
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transition');
    }
    if (blockRightElRef) {
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
    }

    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
    }

    if (this.isActionTriggered) {
      if (this.isLockPanLeft) {
        if (blockRightElRef) {
          this._renderer.setStyle(
            blockRightElRef.nativeElement,
            'transform',
            `scaleX(1)`,
          );
        }
        this._currentPanTimeout = window.setTimeout(() => {
          if (this.task().repeatCfgId) {
            this.editTaskRepeatCfg();
          } else {
            this.scheduleTask();
          }

          this._resetAfterPan(hideDelay);
        }, 100);
      } else if (this.isLockPanRight) {
        if (blockLeftElRef) {
          this._renderer.setStyle(blockLeftElRef.nativeElement, 'transform', `scaleX(1)`);
        }
        this._currentPanTimeout = window.setTimeout(() => {
          this.toggleTaskDone();
          this._resetAfterPan(hideDelay);
        }, 100);
      }
    } else {
      this._resetAfterPan(hideDelay);
    }
  }

  onPanLeft(ev: PanEvent): void {
    this._handlePan(ev);
  }

  onPanRight(ev: PanEvent): void {
    this._handlePan(ev);
  }

  // TODO extract so service
  moveTaskToProject(projectId: string): void {
    const t = this.task();
    if (projectId === t.projectId) {
      return;
    } else if (!t.repeatCfgId) {
      this._taskService.moveToProject(t, projectId);
    } else {
      forkJoin([
        this._taskRepeatCfgService.getTaskRepeatCfgById$(t.repeatCfgId).pipe(first()),
        this._taskService.getTasksWithSubTasksByRepeatCfgId$(t.repeatCfgId).pipe(first()),
        this._taskService.getArchiveTasksForRepeatCfgId(t.repeatCfgId),
        this._projectService.getByIdOnce$(projectId),
      ])
        .pipe(
          concatMap(
            ([
              reminderCfg,
              nonArchiveInstancesWithSubTasks,
              archiveInstances,
              targetProject,
            ]) => {
              TaskLog.log({
                reminderCfg,
                nonArchiveInstancesWithSubTasks,
                archiveInstances,
              });

              // if there is only a single instance (probably just created) than directly update the task repeat cfg
              if (
                nonArchiveInstancesWithSubTasks.length === 1 &&
                archiveInstances.length === 0
              ) {
                this._taskRepeatCfgService.updateTaskRepeatCfg(reminderCfg.id, {
                  projectId,
                });
                this._taskService.moveToProject(this.task(), projectId);
                return EMPTY;
              }

              return this._matDialog
                .open(DialogConfirmComponent, {
                  data: {
                    okTxt: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.OK,
                    message: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.MSG,
                    translateParams: {
                      projectName: targetProject.title,
                      tasksNr:
                        nonArchiveInstancesWithSubTasks.length + archiveInstances.length,
                    },
                  },
                })
                .afterClosed()
                .pipe(
                  tap((isConfirm) => {
                    if (isConfirm) {
                      this._taskRepeatCfgService.updateTaskRepeatCfg(reminderCfg.id, {
                        projectId,
                      });
                      nonArchiveInstancesWithSubTasks.forEach((nonArchiveTask) => {
                        this._taskService.moveToProject(nonArchiveTask, projectId);
                      });

                      const archiveUpdates: Update<TaskCopy>[] = [];
                      archiveInstances.forEach((archiveTask) => {
                        archiveUpdates.push({
                          id: archiveTask.id,
                          changes: { projectId },
                        });
                        if (archiveTask.subTaskIds.length) {
                          archiveTask.subTaskIds.forEach((subId) => {
                            archiveUpdates.push({
                              id: subId,
                              changes: { projectId },
                            });
                          });
                        }
                      });
                      this._taskService.updateArchiveTasks(archiveUpdates);
                    }
                  }),
                );
            },
          ),
        )
        .subscribe(() => this.focusSelf());
    }
  }

  moveToBacklog(): void {
    const t = this.task();
    if (t.projectId && !t.parentId) {
      this._projectService.moveTaskToBacklog(t.id, t.projectId);
      if (this.isTaskOnTodayList()) {
        this.unschedule();
      }
    }
  }

  moveToToday(): void {
    const t = this.task();
    if (t.projectId) {
      this._projectService.moveTaskToTodayList(t.id, t.projectId);
      this.addToMyDay();
    }
  }

  trackByProjectId(i: number, project: Project): string {
    return project.id;
  }

  private _storeNextFocusEl(): void {
    this._nextFocusTaskEl = this._getNextFocusEl();
  }

  private _getNextFocusEl(isTaskMovedInList = false): HTMLElement | undefined {
    if (this._nextFocusTaskEl) {
      return this._nextFocusTaskEl;
    }

    const taskEls = Array.from(document.querySelectorAll('task'));
    const activeEl =
      document.activeElement?.tagName.toLowerCase() === 'task'
        ? document.activeElement
        : document.activeElement?.closest('task');
    const currentIndex = taskEls.findIndex((el) => el === activeEl);
    const nextEl = isTaskMovedInList
      ? (() => {
          // if a parent task is moved in list, as it is for when toggling done,
          // we don't want to focus the next sub-task, but the next main task instead
          if (this.task().subTaskIds.length) {
            return taskEls.find((el, i) => {
              return i > currentIndex && el.parentElement?.closest('task');
            }) as HTMLElement | undefined;
          }
          return taskEls[currentIndex + 1] as HTMLElement;
        })()
      : (taskEls[currentIndex + 1] as HTMLElement);
    return nextEl;
  }

  private _handlePan(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY || ev.eventType === 8) {
      return;
    }
    const innerWrapperElRef = this.innerWrapperElRef();
    const blockLeftElRef = this.blockLeftElRef();
    const blockRightElRef = this.blockRightElRef();
    if (!innerWrapperElRef || !blockLeftElRef || !blockRightElRef) {
      return;
    }

    // Dynamically determine direction based on current pan position
    const isPanningRight = ev.deltaX > 0;
    const isPanningLeft = ev.deltaX < 0;

    // Update lock state dynamically
    this.isLockPanRight = isPanningRight;
    this.isLockPanLeft = isPanningLeft;

    // Select the appropriate block element based on current direction
    const targetRef = isPanningRight ? blockLeftElRef : blockRightElRef;

    const MAGIC_FACTOR = 2;
    this.isPreventPointerEventsWhilePanning = true;

    // Reset both blocks first
    this._renderer.setStyle(blockLeftElRef.nativeElement, 'width', '0');
    this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
    this._renderer.removeClass(blockLeftElRef.nativeElement, 'isActive');
    this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');

    if (targetRef && ev.deltaX !== 0) {
      let scale =
        (Math.abs(ev.deltaX) / this._elementRef.nativeElement.offsetWidth) * MAGIC_FACTOR;
      scale = Math.min(1, Math.max(0, scale));

      if (scale > 0.5) {
        this.isActionTriggered = true;
        this._renderer.addClass(targetRef.nativeElement, 'isActive');
      } else {
        this.isActionTriggered = false;
      }

      const moveBy = Math.abs(ev.deltaX);
      this._renderer.setStyle(targetRef.nativeElement, 'width', `${moveBy}px`);
      this._renderer.setStyle(targetRef.nativeElement, 'transition', `none`);
      this._renderer.setStyle(
        innerWrapperElRef.nativeElement,
        'transform',
        `translateX(${ev.deltaX}px)`,
      );
    }
  }

  private _showPanHelper(): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
      this._panHelperVisibilityTimeout = undefined;
    }
    this.isPanHelperVisible.set(true);
  }

  private _hidePanHelper(delayMs: number = 0): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
    if (delayMs > 0) {
      this._panHelperVisibilityTimeout = window.setTimeout(() => {
        this.isPanHelperVisible.set(false);
        this._panHelperVisibilityTimeout = undefined;
      }, delayMs);
    } else {
      this.isPanHelperVisible.set(false);
      this._panHelperVisibilityTimeout = undefined;
    }
  }

  private _resetAfterPan(hideDelay: number = 0): void {
    const blockLeftElRef = this.blockLeftElRef();
    const blockRightElRef = this.blockRightElRef();
    const innerWrapperElRef = this.innerWrapperElRef();
    this.isPreventPointerEventsWhilePanning = false;
    this.isActionTriggered = false;
    this.isLockPanLeft = false;
    this.isLockPanRight = false;
    if (blockLeftElRef) {
      this._renderer.removeClass(blockLeftElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockLeftElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transform');
    }
    if (blockRightElRef) {
      this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transform');
    }
    if (innerWrapperElRef) {
      this._renderer.setStyle(innerWrapperElRef.nativeElement, 'transform', ``);
    }
    this._hidePanHelper(hideDelay);
  }

  get kb(): KeyboardConfig {
    if (IS_TOUCH_PRIMARY) {
      return {} as KeyboardConfig;
    }
    return (this._configService.cfg()?.keyboard as KeyboardConfig) || {};
  }

  protected readonly ICAL_TYPE = ICAL_TYPE;
}
