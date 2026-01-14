import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { HideSubTasksMode, TaskDetailTargetPanel, TaskWithSubTasks } from '../task.model';
import { IssueService } from '../../issue/issue.service';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { of } from 'rxjs';
import {
  catchError,
  delay,
  distinctUntilChanged,
  map,
  shareReplay,
  skip,
  switchMap,
} from 'rxjs/operators';
import { T } from '../../../t.const';
import { TaskService } from '../task.service';
import {
  expandAnimation,
  expandFadeInOnlyAnimation,
} from '../../../ui/animations/expand.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { swirlAnimation } from '../../../ui/animations/swirl-in-out.ani';
import { DialogTimeEstimateComponent } from '../dialog-time-estimate/dialog-time-estimate.component';
import { MatDialog } from '@angular/material/dialog';
import { isTouchOnly } from '../../../util/is-touch-only';
import { DialogEditTaskRepeatCfgComponent } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { DialogEditTaskAttachmentComponent } from '../task-attachment/dialog-edit-attachment/dialog-edit-task-attachment.component';
import { TaskDetailItemComponent } from './task-additional-info-item/task-detail-item.component';
import { IssueData, IssueProviderJira } from '../../issue/issue.model';
import { ICAL_TYPE, JIRA_TYPE } from '../../issue/issue.const';
import { HISTORY_STATE, IS_ELECTRON } from '../../../app.constants';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { devError } from '../../../util/dev-error';
import { IS_MOBILE } from '../../../util/is-mobile';
import { GlobalConfigService } from '../../config/global-config.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { getTaskRepeatInfoText } from './get-task-repeat-info-text.util';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { Store } from '@ngrx/store';
import { selectIssueProviderById } from '../../issue/store/issue-provider.selectors';
import { TaskTitleComponent } from '../../../ui/task-title/task-title.component';
import { MatIcon } from '@angular/material/icon';
import { TaskListComponent } from '../task-list/task-list.component';
import { MatButton } from '@angular/material/button';
import { ProgressBarComponent } from '../../../ui/progress-bar/progress-bar.component';
import { IssueHeaderComponent } from '../../issue/issue-header/issue-header.component';
import { MatProgressBar } from '@angular/material/progress-bar';
import { IssueContentComponent } from '../../issue/issue-content/issue-content.component';
import { InlineMarkdownComponent } from '../../../ui/inline-markdown/inline-markdown.component';
import { TaskAttachmentListComponent } from '../task-attachment/task-attachment-list/task-attachment-list.component';
import { TagEditComponent } from '../../tag/tag-edit/tag-edit.component';
import { DialogSelectDateTimeComponent } from '../dialog-select-date-time/dialog-select-date-time.component';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { isMarkdownChecklist } from '../../markdown-checklist/is-markdown-checklist';
import { Log } from '../../../core/log';
import { isInputElement } from '../../../util/dom-element';
import { checkKeyCombo } from '../../../util/check-key-combo';

@Component({
  selector: 'task-detail-panel',
  templateUrl: './task-detail-panel.component.html',
  styleUrls: ['./task-detail-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation, expandFadeInOnlyAnimation, fadeAnimation, swirlAnimation],
  imports: [
    TaskTitleComponent,
    TaskDetailItemComponent,
    MatIcon,
    TaskListComponent,
    MatButton,
    ProgressBarComponent,
    IssueHeaderComponent,
    MatProgressBar,
    IssueContentComponent,
    InlineMarkdownComponent,
    TaskAttachmentListComponent,
    TagEditComponent,
    LocaleDatePipe,
    MsToStringPipe,
    TranslatePipe,
    IssueIconPipe,
  ],
})
export class TaskDetailPanelComponent implements OnInit, AfterViewInit, OnDestroy {
  // Services
  attachmentService = inject(TaskAttachmentService);
  taskService = inject(TaskService);
  layoutService = inject(LayoutService);

  private _globalConfigService = inject(GlobalConfigService);
  private _issueService = inject(IssueService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _destroyRef = inject(DestroyRef);
  private _dateTimeFormatService = inject(DateTimeFormatService);

  // Inputs
  task = input.required<TaskWithSubTasks>();
  isOver = input<boolean>(false);
  isDialogMode = input<boolean>(false);

  // View children
  itemEls = viewChildren(TaskDetailItemComponent);
  attachmentPanelElRef = viewChild<TaskDetailItemComponent>('attachmentPanelElRef');

  // Constants
  IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;
  ShowSubTasksMode = HideSubTasksMode;
  T = T;
  ICAL_TYPE = ICAL_TYPE;

  // Panel state signals grouped together
  panelState = {
    selectedItemIndex: signal(0),
    isFocusNotes: signal(false),
    isDragOver: signal(false),
    isExpandedAttachmentPanel: signal(!IS_MOBILE),
  };

  // Observable conversions
  private _task$ = toObservable(this.task);

  @HostListener('keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    // Skip handling inside input elements
    const target = ev.target as HTMLElement;
    if (isInputElement(target)) return;

    const cfg = this._globalConfigService.cfg();
    if (!cfg) throw new Error('No config service available');

    const keys = cfg.keyboard;
    if (checkKeyCombo(ev, keys.taskToggleDetailPanelOpen)) this.collapseParent();
  }

  // Parent task data
  parentTaskData = toSignal(
    this._task$.pipe(
      map((task) => task.parentId),
      distinctUntilChanged(),
      switchMap((parentId) =>
        parentId ? this.taskService.getByIdWithSubTaskData$(parentId) : of(null),
      ),
    ),
    { initialValue: null },
  );

  // Repeat config label
  private _repeatCfg$ = this._task$.pipe(
    map((task) => task.repeatCfgId),
    distinctUntilChanged(),
    switchMap((repeatCfgId) =>
      repeatCfgId
        ? this._taskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$(repeatCfgId)
        : of(null),
    ),
  );

  repeatCfgLabel = toSignal(
    this._repeatCfg$.pipe(
      map((repeatCfg) => {
        if (!repeatCfg) {
          return null;
        }
        const [key, params] = getTaskRepeatInfoText(
          repeatCfg,
          this._dateTimeFormatService.currentLocale,
          this._dateTimeFormatService,
        );
        return this._translateService.instant(key, params);
      }),
    ),
    { initialValue: null },
  );

  // Issue data reactive loading (replacing async effect)
  private _issueData$ = this._task$.pipe(
    takeUntilDestroyed(this._destroyRef),
    // Only react to changes in issue-related properties
    map((task) => ({
      issueId: task.issueId,
      issueType: task.issueType,
      issueProviderId: task.issueProviderId,
    })),
    distinctUntilChanged((prev, curr) => prev.issueId === curr.issueId),
    switchMap(({ issueId, issueType, issueProviderId }) => {
      if (!issueId || !issueType || !issueProviderId) {
        return of(null);
      }

      if (issueType === ICAL_TYPE) {
        return of(null);
      }

      return this._issueService.getById$(issueType, issueId, issueProviderId).pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => of(null)),
      );
    }),
    shareReplay(1),
  );

  issueData = toSignal(this._issueData$, {
    initialValue: null as IssueData | null,
  });

  isIssueDataLoadedForCurrentType = computed(() => {
    const data = this.issueData();
    return data !== null;
  });

  // Issue attachments
  issueAttachments = computed(() => {
    const data = this.issueData();
    const task = this.task();
    if (data && task.issueType) {
      return this._issueService.getMappedAttachments(task.issueType, data);
    }
    return [];
  });

  // Default task notes computed signal
  defaultTaskNotes = computed(() => {
    const misc = this._globalConfigService.misc();
    return misc?.taskNotesTpl || '';
  });

  // Local attachments computed signal
  localAttachments = computed(() => {
    return this.task().attachments || [];
  });

  // Panel expansion computed signals
  isExpandedIssuePanel = computed(() => {
    return !IS_MOBILE && !!this.issueData();
  });

  isExpandedNotesPanel = computed(() => {
    const task = this.task();
    return IS_MOBILE
      ? this.isMarkdownChecklist()
      : !!task.notes || (!task.issueId && !task.attachments?.length);
  });

  // Task-based computed signals
  isMarkdownChecklist = computed(() => {
    const notes = this.task().notes;
    return isMarkdownChecklist(notes || '');
  });

  isPlannedForTodayDay = computed(() => {
    const task = this.task();
    return !!task.dueDay && task.dueDay === getDbDateStr();
  });

  progress = computed(() => {
    const task = this.task();
    return (task && task.timeEstimate && (task.timeSpent / task.timeEstimate) * 100) || 0;
  });

  isOverdue = computed(() => {
    const t = this.task();
    return !!(
      !t.isDone &&
      ((t.dueWithTime && t.dueWithTime < Date.now()) ||
        (t.dueDay && t.dueDay !== getDbDateStr() && t.dueDay < getDbDateStr()))
    );
  });

  // Template helper computed signals
  isShowSubTasksPanel = computed(() => {
    const task = this.task();
    return task && !task.parentId;
  });

  isSubTaskPanelExpandedInitially = computed(() => {
    return this.isDialogMode();
  });

  showTimeEstimate = computed(() => !this.task().subTasks?.length);

  hasAttachments = computed(() => {
    return this.issueAttachments().length > 0 || this.localAttachments().length > 0;
  });

  totalAttachments = computed(() => {
    return this.issueAttachments().length + this.localAttachments().length;
  });

  showScheduleIcon = computed(() => {
    const task = this.task();
    if (task.dueDay) return 'today';
    if (task.dueWithTime && !task.reminderId) return 'schedule';
    return 'alarm';
  });

  scheduleLabelKey = computed(() => {
    const task = this.task();
    return task.dueWithTime || task.dueDay
      ? this.T.F.TASK.ADDITIONAL_INFO.DUE
      : this.T.F.TASK.ADDITIONAL_INFO.SCHEDULE_TASK;
  });

  // EFFECTS
  // -------
  private _jiraImageHeaders = IS_ELECTRON
    ? this._task$
        .pipe(
          map((task) => ({
            issueType: task.issueType,
            issueProviderId: task.issueProviderId,
          })),
          distinctUntilChanged(
            (prev, curr) =>
              prev.issueType === curr.issueType &&
              prev.issueProviderId === curr.issueProviderId,
          ),
          map(({ issueType, issueProviderId }) =>
            issueType === JIRA_TYPE && issueProviderId ? issueProviderId : null,
          ),
          distinctUntilChanged(),
          switchMap((issueProviderId) =>
            issueProviderId
              ? this._store.select(
                  selectIssueProviderById<IssueProviderJira>(issueProviderId, 'JIRA'),
                )
              : of(null),
          ),
          takeUntilDestroyed(this._destroyRef),
        )
        .subscribe((jiraCfg) => {
          if (jiraCfg?.isEnabled) {
            window.ea.jiraSetupImgHeaders({ jiraCfg });
          }
        })
    : null;

  private _focusOnTaskIdChange = this._task$
    .pipe(
      map((task) => task.id),
      distinctUntilChanged(),
      skip(1), // Skip initial emission
      takeUntilDestroyed(this._destroyRef),
    )
    .subscribe(() => this._focusFirst());
  // -------

  private _focusTimeout?: number;
  private _dragEnterTarget?: HTMLElement;

  @HostListener('dragenter', ['$event']) onDragEnter(ev: DragEvent): void {
    this._dragEnterTarget = ev.target as HTMLElement;
    ev.preventDefault();
    ev.stopPropagation();
    this.panelState.isDragOver.set(true);
  }

  @HostListener('dragleave', ['$event']) onDragLeave(ev: DragEvent): void {
    if (this._dragEnterTarget === (ev.target as HTMLElement)) {
      ev.preventDefault();
      ev.stopPropagation();
      this.panelState.isDragOver.set(false);
    }
  }

  @HostListener('drop', ['$event']) onDrop(ev: DragEvent): void {
    this.attachmentService.createFromDrop(ev, this.task().id);
    ev.stopPropagation();
    this.panelState.isDragOver.set(false);
  }

  @HostListener('window:popstate') onBack(): void {
    this.collapseParent();
  }

  ngOnInit(): void {
    window.history.pushState({ [HISTORY_STATE.TASK_DETAIL_PANEL]: true }, '');
  }

  ngAfterViewInit(): void {
    this.taskService.taskDetailPanelTargetPanel$
      .pipe(takeUntilDestroyed(this._destroyRef), delay(50))
      .subscribe((v) => {
        if (this.taskService.selectedTaskId()) {
          if (v === TaskDetailTargetPanel.Attachments) {
            const attachmentPanelElRef = this.attachmentPanelElRef();
            if (!attachmentPanelElRef) {
              devError('this.attachmentPanelElRef not ready');
              this._focusFirst();
            } else {
              this.focusItem(attachmentPanelElRef);
            }
          } else {
            this._focusFirst();
          }
        }
      });
    Log.verbose('Task Detail Panel', this.task());
  }

  ngOnDestroy(): void {
    if (window.history.state?.[HISTORY_STATE.TASK_DETAIL_PANEL]) {
      window.history.back();
    }
    window.clearTimeout(this._focusTimeout);
  }

  changeTaskNotes($event: string): void {
    const defaultNotes = this.defaultTaskNotes();
    if (!defaultNotes || !$event || $event.trim() !== defaultNotes.trim()) {
      this.taskService.update(this.task().id, { notes: $event });
    }
  }

  estimateTime(): void {
    this._matDialog.open(DialogTimeEstimateComponent, {
      data: { task: this.task() },
      autoFocus: !isTouchOnly(),
    });
  }

  scheduleTask(): void {
    this._matDialog.open(DialogScheduleTaskComponent, {
      autoFocus: false,
      restoreFocus: true,
      data: { task: this.task() },
    });
  }

  editTaskRepeatCfg(): void {
    this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
      restoreFocus: true,
      data: {
        task: this.task(),
        targetDate: this.task().dueDay || getDbDateStr(new Date(this.task().created)),
      },
    });
  }

  addAttachment(): void {
    this._matDialog
      .open(DialogEditTaskAttachmentComponent, {
        data: {},
      })
      .afterClosed()
      .subscribe((result) => {
        if (result) {
          this.attachmentService.addAttachment(this.task().id, {
            ...result,
          });
        }
      });
  }

  addSubTask(): void {
    const task = this.task();
    this.taskService.addSubTaskTo(task.parentId || task.id);
  }

  collapseParent(): void {
    if (!this.isDialogMode()) {
      this.taskService.setSelectedId(null);
      // NOTE: we delay for a frame to avoid problems with the global task keyboard shortcut handler
      window.setTimeout(() => {
        this.taskService.focusTaskIfPossible(this.task().id);
      });
    }
  }

  editCompleted(): void {
    const dialogRef = this._matDialog.open(DialogSelectDateTimeComponent, {
      data: {
        dateTime: this.task().doneOn,
      },
    });

    dialogRef.afterClosed().subscribe((doneOn) => {
      if (typeof doneOn === 'number') {
        this.taskService.update(this.task().id, { doneOn });
      }
    });
  }

  editCreated(): void {
    const dialogRef = this._matDialog.open(DialogSelectDateTimeComponent, {
      data: {
        dateTime: this.task().created,
      },
    });

    dialogRef.afterClosed().subscribe((created) => {
      if (typeof created === 'number') {
        this.taskService.update(this.task().id, { created });
      }
    });
  }

  onItemKeyPress(ev: KeyboardEvent): void {
    const itemEls = this.itemEls();
    if (!itemEls) {
      throw new Error();
    }

    const currentIndex = this.panelState.selectedItemIndex();
    if (ev.key === 'ArrowUp' && currentIndex > 0) {
      this.panelState.selectedItemIndex.set(currentIndex - 1);
      itemEls[currentIndex - 1].focusEl();
    } else if (ev.key === 'ArrowDown' && itemEls.length > currentIndex + 1) {
      this.panelState.selectedItemIndex.set(currentIndex + 1);
      itemEls[currentIndex + 1].focusEl();
    }
  }

  focusItem(cmpInstance: TaskDetailItemComponent, timeoutDuration: number = 150): void {
    window.clearTimeout(this._focusTimeout);
    this._focusTimeout = window.setTimeout(() => {
      const itemEls = this.itemEls();
      if (!itemEls) {
        throw new Error();
      }

      const i = itemEls.findIndex((el) => el === cmpInstance);
      if (i === -1) {
        this.focusItem(cmpInstance);
      } else {
        this.panelState.selectedItemIndex.set(i);
        cmpInstance.elementRef.nativeElement.focus();
      }
    }, timeoutDuration);
  }

  updateTaskTitleIfChanged(isChanged: boolean, newTitle: string): void {
    if (isChanged) {
      this.taskService.update(this.task().id, { title: newTitle });
    }
  }

  private _focusFirst(): void {
    this._focusTimeout = window.setTimeout(() => {
      const itemEls = this.itemEls();
      if (!itemEls) {
        throw new Error('No items found');
      }
      if (itemEls.length && itemEls[0]) {
        this.focusItem(itemEls[0], 0);
      }
    }, 150);
  }
}
