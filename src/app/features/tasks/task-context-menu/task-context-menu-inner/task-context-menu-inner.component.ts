import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  Input,
  output,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { Task, TaskCopy, TaskWithSubTasks } from '../../task.model';
import { EMPTY, forkJoin, from, Observable, of, ReplaySubject, Subject } from 'rxjs';
import {
  concatMap,
  delay,
  distinctUntilChanged,
  first,
  map,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { Project } from '../../../project/project.model';
import { TaskService } from '../../task.service';
import { TaskRepeatCfgService } from '../../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { IssueService } from '../../../issue/issue.service';
import { TaskAttachmentService } from '../../task-attachment/task-attachment.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ProjectService } from '../../../project/project.service';
import { WorkContextService } from '../../../work-context/work-context.service';
import { GlobalConfigService } from '../../../config/global-config.service';
import { KeyboardConfig } from '../../../config/keyboard-config.model';
import { DialogScheduleTaskComponent } from '../../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { DialogTimeEstimateComponent } from '../../dialog-time-estimate/dialog-time-estimate.component';
import { DialogEditTaskAttachmentComponent } from '../../task-attachment/dialog-edit-attachment/dialog-edit-task-attachment.component';
import { throttle } from '../../../../util/decorators';
import { DialogConfirmComponent } from '../../../../ui/dialog-confirm/dialog-confirm.component';
import { Update } from '@ngrx/entity';
import { IS_TOUCH_PRIMARY } from 'src/app/util/is-mouse-primary';
import { T } from 'src/app/t.const';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { selectTaskByIdWithSubTaskData } from '../../store/task.selectors';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { addSubTask } from '../../../tasks/store/task.actions';
import { combineDateAndTime } from '../../../../util/combine-date-and-time';
import { DateAdapter } from '@angular/material/core';
import { ICAL_TYPE } from '../../../issue/issue.const';
import { IssueIconPipe } from '../../../issue/issue-icon/issue-icon.pipe';
import { showFocusOverlay } from '../../../focus-mode/store/focus-mode.actions';
import { toSignal } from '@angular/core/rxjs-interop';
import { TagService } from '../../../tag/tag.service';
import { DialogPromptComponent } from '../../../../ui/dialog-prompt/dialog-prompt.component';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { selectTodayTaskIds } from '../../../work-context/store/work-context.selectors';
import { isToday } from '../../../../util/is-today.util';
import { MenuTouchFixDirective } from '../menu-touch-fix.directive';
import { TaskLog } from '../../../../core/log';
import { isTouchEventInstance } from '../../../../util/is-touch-event.util';
import { TaskFocusService } from '../../task-focus.service';
import { DEFAULT_GLOBAL_CONFIG } from 'src/app/features/config/default-global-config.const';

@Component({
  selector: 'task-context-menu-inner',
  imports: [
    AsyncPipe,
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    TranslateModule,
    MatMenuTrigger,
    MatIconButton,
    MatTooltip,
    IssueIconPipe,
    MenuTouchFixDirective,
  ],
  templateUrl: './task-context-menu-inner.component.html',
  styleUrl: './task-context-menu-inner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
})
export class TaskContextMenuInnerComponent implements AfterViewInit {
  private readonly _datePipe = inject(LocaleDatePipe);
  private readonly _taskService = inject(TaskService);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _issueService = inject(IssueService);
  private readonly _attachmentService = inject(TaskAttachmentService);
  private readonly _elementRef = inject(ElementRef);
  private readonly _snackService = inject(SnackService);
  private readonly _projectService = inject(ProjectService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _store = inject(Store);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _tagService = inject(TagService);
  private readonly _translateService = inject(TranslateService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _taskFocusService = inject(TaskFocusService);

  protected readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
  protected readonly T = T;

  isAdvancedControls = input<boolean>(false);
  todayList = toSignal(this._store.select(selectTodayTaskIds), { initialValue: [] });
  isOnTodayList = computed(() => this.task && this.todayList().includes(this.task.id));
  readonly isTimeTrackingEnabled = computed(
    () => this._globalConfigService.cfg()?.appFeatures.isTimeTrackingEnabled,
  );
  readonly isFocusModeEnabled = computed(
    () => this._globalConfigService.cfg()?.appFeatures.isFocusModeEnabled,
  );

  // eslint-disable-next-line @angular-eslint/no-output-native
  close = output();

  contextMenuPosition: { x: string; y: string } = { x: '100px', y: '100px' };

  readonly contextMenuTrigger = viewChild('contextMenuTriggerEl', {
    read: MatMenuTrigger,
  });

  readonly contextMenu = viewChild('contextMenu', { read: MatMenu });

  task!: TaskWithSubTasks | Task;

  isCurrent: boolean = false;
  isBacklog: boolean = false;

  private _task$: ReplaySubject<TaskWithSubTasks | Task> = new ReplaySubject(1);
  issueUrl$: Observable<string | null> = this._task$.pipe(
    switchMap((v) => {
      return v.issueType && v.issueId && v.issueProviderId
        ? from(this._issueService.issueLink(v.issueType, v.issueId, v.issueProviderId))
        : of(null);
    }),
    take(1),
  );
  moveToProjectList$: Observable<Project[]> = this._task$.pipe(
    map((t) => t.projectId),
    distinctUntilChanged(),
    switchMap((pid) => this._projectService.getProjectsWithoutIdSorted$(pid || null)),
  );
  toggleTagList = this._tagService.tagsNoMyDayAndNoListSorted;

  // isShowMoveFromAndToBacklogBtns$: Observable<boolean> = this._task$.pipe(
  //   take(1),
  //   switchMap((task) =>
  //     task.projectId ? this._projectService.getByIdOnce$(task.projectId) : EMPTY,
  //   ),
  //   map((project) => project.isEnableBacklog),
  // );
  isShowMoveFromAndToBacklogBtns$: Observable<boolean> =
    this._workContextService.activeWorkContext$.pipe(
      take(1),
      map((ctx) => !!ctx.isEnableBacklog),
    );

  private _destroy$: Subject<boolean> = new Subject<boolean>();
  private _isTaskDeleteTriggered: boolean = false;
  private _isOpenedFromKeyboard = false;

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input('task') set taskSet(v: TaskWithSubTasks | Task) {
    this.task = v;
    this.isCurrent = this._taskService.currentTaskId() === v.id;
    this._task$.next(v);
  }

  ngAfterViewInit(): void {
    this.isBacklog = !!this._elementRef.nativeElement.closest('.backlog');

    setTimeout(() => {
      if (!this._isOpenedFromKeyboard) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    });
  }

  open(ev: MouseEvent | KeyboardEvent | TouchEvent, isOpenedFromKeyBoard = false): void {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (ev instanceof MouseEvent || isTouchEventInstance(ev)) {
      this.contextMenuPosition.x =
        ('touches' in ev ? ev.touches[0].clientX : ev.clientX) + 10 + 'px';
      this.contextMenuPosition.y =
        ('touches' in ev ? ev.touches[0].clientY : ev.clientY) - 48 + 'px';
    }

    this._isOpenedFromKeyboard = isOpenedFromKeyBoard;
    this.contextMenuTrigger()?.openMenu();
  }

  focusRelatedTaskOrNext(): void {
    // Focus the task element after context menu closes
    // Use setTimeout to ensure menu has fully closed and DOM is settled
    setTimeout(() => {
      const taskElement = document.querySelector(`#t-${this.task.id}`) as HTMLElement;
      if (taskElement) {
        taskElement.focus();
        // Ensure focusedTaskId is set even if focus event doesn't fire
        this._taskFocusService.focusedTaskId.set(this.task.id);
      }
    }, 0);
  }

  onClose(): void {
    // Don't manually set focusedTaskId to null here - let the task component's
    // focus/blur handlers manage it automatically to avoid race conditions
    this.focusRelatedTaskOrNext();
    this.close.emit();
  }

  get kb(): KeyboardConfig {
    if (IS_TOUCH_PRIMARY || !this.isAdvancedControls()) {
      return {} as any;
    }
    return (this._globalConfigService.cfg()?.keyboard as KeyboardConfig) || {};
  }

  quickAccessKeydown(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement;
    const btns = Array.from(
      t?.closest('.quick-access')?.querySelectorAll('button') || [],
    );
    //   const btns = Array.from(t?.querySelectorAll('button') || []);

    const currentIndex = btns.indexOf(t as HTMLButtonElement);

    if (ev.key === 'ArrowRight' && currentIndex < btns.length - 1) {
      (btns[currentIndex + 1] as HTMLElement).focus();
    } else if (ev.key === 'ArrowLeft' && currentIndex > 0) {
      (btns[currentIndex - 1] as HTMLElement).focus();
    }
  }

  focusFirstBtn(ev: FocusEvent): void {
    const t = ev.target as HTMLElement;
    t?.parentElement?.querySelector('button')?.focus();
  }

  goToFocusMode(): void {
    this._taskService.setCurrentId(this.task.id);
    this._taskService.setSelectedId(this.task.id);
    this._store.dispatch(showFocusOverlay());
  }

  scheduleTask(): void {
    this._matDialog
      .open(DialogScheduleTaskComponent, {
        // we focus inside dialog instead
        autoFocus: false,
        data: { task: this.task },
      })
      .afterClosed()
      // .pipe(takeUntil(this._destroy$))
      .subscribe((isPlanned) => {
        this.focusRelatedTaskOrNext();
      });
  }

  updateIssueData(): void {
    this._issueService.refreshIssueTask(this.task, true, true);
  }

  async deleteTask(): Promise<void> {
    // NOTE: prevents attempts to delete the same task multiple times
    if (this._isTaskDeleteTriggered) {
      return;
    }

    const isConfirmBeforeDelete =
      this._globalConfigService.cfg()?.tasks?.isConfirmBeforeDelete ?? true;

    if (isConfirmBeforeDelete) {
      this._matDialog
        .open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: this.task.title },
          },
        })
        .afterClosed()
        .pipe(takeUntil(this._destroy$))
        .subscribe(async (isConfirm) => {
          if (isConfirm) {
            await this._performDelete();
          }
        });
    } else {
      await this._performDelete();
    }
  }

  private async _performDelete(): Promise<void> {
    this._isTaskDeleteTriggered = true;
    const taskWithSubTasks = await this._getTaskWithSubtasks();
    this._taskService.remove(taskWithSubTasks);
  }

  startTask(): void {
    this._taskService.setCurrentId(this.task.id);
  }

  pauseTask(): void {
    this._taskService.pauseCurrent();
  }

  estimateTime(): void {
    this._matDialog
      .open(DialogTimeEstimateComponent, {
        data: { task: this.task },
        autoFocus: !IS_TOUCH_PRIMARY,
      })
      .afterClosed()
      .pipe(takeUntil(this._destroy$))
      .subscribe(() => this.focusRelatedTaskOrNext());
  }

  addAttachment(): void {
    this._matDialog
      .open(DialogEditTaskAttachmentComponent, {
        data: {},
      })
      .afterClosed()
      .pipe(takeUntil(this._destroy$))
      .subscribe((result) => {
        if (result) {
          this._attachmentService.addAttachment(this.task.id, result);
        }
        this.focusRelatedTaskOrNext();
      });
  }

  addSubTask(): void {
    this._taskService.addSubTaskTo(this.task.parentId || this.task.id);
  }

  async duplicate(): Promise<void> {
    console.log(this.task);
    const taskData = {
      isDone: false,
      projectId: this.task.projectId || undefined,
      tagIds: this.task.tagIds || [],
    };
    console.log({ taskData });
    const timeData = {
      ...(this.task.dueDay && { dueDay: this.task.dueDay }),
      ...(this.task.dueWithTime && { dueWithTime: this.task.dueWithTime }),
      ...(this.task.timeEstimate && { timeEstimate: this.task.timeEstimate }),
    };
    console.log({ timeData });
    const taskId = this._taskService.add(
      `${this.task.title} (copy)`,
      false,
      { ...taskData, ...timeData },
      false,
    );
    console.log({ taskId });
    if (this.task.subTaskIds.length) {
      const taskWithSubtasks = await this._getTaskWithSubtasks();
      console.log({ taskWithSubtasks });
      for (const subTask of taskWithSubtasks.subTasks) {
        console.log({ subTask });
        const subTaskInfo = {
          isDone: subTask.isDone,
          projectId: subTask.projectId,
        };
        const subTaskObj = this._taskService.createNewTaskWithDefaults({
          title: subTask.title,
          additional: subTaskInfo,
        });
        this._store.dispatch(
          addSubTask({
            task: subTaskObj,
            parentId: taskId,
          }),
        );
      }
    }
  }

  moveToTop(): void {
    this._taskService.moveToTop(this.task.id, this.task.parentId, false);
  }

  @throttle(200, { leading: true, trailing: false })
  toggleDoneKeyboard(): void {
    this.toggleTaskDone();
  }

  toggleTaskDone(): void {
    if (this.task.isDone) {
      this._taskService.setUnDone(this.task.id);
    } else {
      this._taskService.setDone(this.task.id);
    }
  }

  addToMyDay(): void {
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: [this.task.id],
        parentTaskMap: { [this.task.id]: this.task.parentId },
        isShowSnack: true,
      }),
    );
  }

  unschedule(): void {
    this._store.dispatch(
      TaskSharedActions.unscheduleTask({
        id: this.task.id,
      }),
    );
  }

  convertToMainTask(): void {
    this._taskService.convertToMainTask(this.task);
  }

  onTagsUpdated(tagIds: string[]): void {
    this._taskService.updateTags(this.task, tagIds);
  }

  toggleTag(tagId: string): void {
    const task = this.task;
    const tagIds = task.tagIds.includes(tagId)
      ? task.tagIds.filter((id) => id !== tagId)
      : [...task.tagIds, tagId];

    this.onTagsUpdated(tagIds);
  }

  openAddNewTag(): void {
    this._matDialog
      .open(DialogPromptComponent, {
        data: {
          placeholder: T.F.TAG.TTL.ADD_NEW_TAG,
        },
      })
      .afterClosed()
      .subscribe((val) => {
        if (val) {
          const t = this.task;
          const newTagId = this._tagService.addTag({
            title: val,
          });
          this._taskService.updateTags(t, [...t.tagIds, newTagId]);
        }
      });
  }

  // TODO move to service
  async moveTaskToProject(projectId: string): Promise<void> {
    if (projectId === this.task.projectId) {
      return;
    } else if (!this.task.repeatCfgId) {
      const taskWithSubTasks = await this._getTaskWithSubtasks();
      this._taskService.moveToProject(taskWithSubTasks, projectId);
      this.onClose();
    } else {
      const taskWithSubTasks = await this._getTaskWithSubtasks();

      forkJoin([
        this._taskRepeatCfgService
          .getTaskRepeatCfgById$(this.task.repeatCfgId)
          .pipe(first()),
        this._taskService
          .getTasksWithSubTasksByRepeatCfgId$(this.task.repeatCfgId)
          .pipe(first()),
        this._taskService.getArchiveTasksForRepeatCfgId(this.task.repeatCfgId),
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
                this._taskService.moveToProject(taskWithSubTasks, projectId);
                this.onClose();
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
        .subscribe(() => this.onClose());
    }
  }

  moveToBacklog(): void {
    if (this.task.projectId && !this.task.parentId) {
      this._projectService.moveTaskToBacklog(this.task.id, this.task.projectId);
      if (
        this.task.dueDay === getDbDateStr() ||
        (this.task.dueWithTime && isToday(this.task.dueWithTime))
      ) {
        this.unschedule();
      }
    }
  }

  moveToToday(): void {
    if (this.task.projectId && !this.task.parentId) {
      this._projectService.moveTaskToTodayList(this.task.id, this.task.projectId);
      this.addToMyDay();
    }
  }

  trackByProjectId(i: number, project: Project): string {
    return project.id;
  }

  private async _getTaskWithSubtasks(): Promise<TaskWithSubTasks> {
    return await this._store
      .select(selectTaskByIdWithSubTaskData, { id: this.task.id })
      .pipe(
        first(),
        // NOTE without the delay selectTaskByIdWithSubTaskData triggers twice for unknown reasons
        delay(50),
      )
      .toPromise();
  }

  quickAccessBtnClick(item: number): void {
    const tDate = new Date();
    tDate.setMinutes(0, 0, 0);
    switch (item) {
      case 1:
        this._schedule(tDate);
        break;
      case 2:
        const tomorrow = tDate;
        tomorrow.setDate(tomorrow.getDate() + 1);
        this._schedule(tomorrow);
        break;
      case 3:
        const nextFirstDayOfWeek = tDate;
        const dayOffset =
          (this._dateAdapter.getFirstDayOfWeek() -
            this._dateAdapter.getDayOfWeek(nextFirstDayOfWeek) +
            7) %
            7 || 7;
        nextFirstDayOfWeek.setDate(nextFirstDayOfWeek.getDate() + dayOffset);
        this._schedule(nextFirstDayOfWeek);
        break;
      // case 4:
      //   const nextMonth = tDate;
      //   nextMonth.setMonth(nextMonth.getMonth() + 1);
      //   this._schedule(nextMonth);
      //   break;
    }
  }

  private async _schedule(selectedDate: Date, isRemoveFromToday = false): Promise<void> {
    if (!selectedDate) {
      TaskLog.err('no selected date');
      return;
    }

    const newDayDate = new Date(selectedDate);
    const newDay = getDbDateStr(newDayDate);

    // If task is already scheduled for today with time and we're planning for today,
    // just add to my day (which clears the reminder) instead of rescheduling
    if (
      this.task.dueWithTime &&
      isToday(this.task.dueWithTime) &&
      newDay === getDbDateStr()
    ) {
      this.addToMyDay();
      return;
    }

    if (isRemoveFromToday) {
      this.unschedule();
    } else if (this.task.dueDay === newDay) {
      const formattedDate =
        newDay == getDbDateStr()
          ? this._translateService.instant(T.G.TODAY_TAG_TITLE)
          : (this._datePipe.transform(newDay, 'shortDate') as string);
      this._snackService.open({
        type: 'CUSTOM',
        ico: 'info',
        msg: T.F.PLANNER.S.TASK_ALREADY_PLANNED,
        translateParams: { date: formattedDate },
      });
      return;
    } else if (this.task.dueWithTime) {
      const task = this.task;
      const newDate = combineDateAndTime(newDayDate, new Date(this.task.dueWithTime));
      this._taskService.scheduleTask(
        task,
        newDate.getTime(),
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
        false,
      );
    } else {
      if (newDay === getDbDateStr()) {
        this.addToMyDay();
      } else {
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task: this.task,
            day: newDay,
            isShowSnack: true,
          }),
        );
      }
    }
  }

  unscheduleTask(): void {
    this._store.dispatch(
      TaskSharedActions.unscheduleTask({
        id: this.task.id,
      }),
    );
  }

  protected readonly ICAL_TYPE = ICAL_TYPE;
}
