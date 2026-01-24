import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  afterNextRender,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatMenu, MatMenuTrigger, MatMenuItem, MatMenuModule } from '@angular/material/menu';

import { TaskService } from '../tasks/task.service';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { DialogPromptComponent } from '../../ui/dialog-prompt/dialog-prompt.component';
import { expandAnimation, expandFadeAnimation } from '../../ui/animations/expand.ani';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { ActivatedRoute } from '@angular/router';
import {
  animationFrameScheduler,
  from,
  fromEvent,
  Observable,
  ReplaySubject,
  Subscription,
  timer,
  zip,
} from 'rxjs';
import { TaskWithSubTasks } from '../tasks/task.model';
import { delay, filter, map, observeOn, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { PlanningModeService } from '../planning-mode/planning-mode.service';
import { T } from '../../t.const';
import { workViewProjectChangeAnimation } from '../../ui/animations/work-view-project-change.ani';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { SectionService } from '../section/section.service';
import { Section } from '../section/section.model';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatMiniFabButton } from '@angular/material/button';
import { AddTaskBarComponent } from '../tasks/add-task-bar/add-task-bar.component';
import { AddScheduledTodayOrTomorrowBtnComponent } from '../add-tasks-for-tomorrow/add-scheduled-for-tomorrow/add-scheduled-today-or-tomorrow-btn.component';
import { TaskListComponent } from '../tasks/task-list/task-list.component';
import { SplitComponent } from './split/split.component';
import { BacklogComponent } from './backlog/backlog.component';
import { AsyncPipe, CommonModule } from '@angular/common';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import {
  selectLaterTodayTasksWithSubTasks,
  selectOverdueTasksWithSubTasks,
} from '../tasks/store/task.selectors';
import { CollapsibleComponent } from '../../ui/collapsible/collapsible.component';
import { SnackService } from '../../core/snack/snack.service';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TODAY_TAG } from '../tag/tag.const';
import { LS } from '../../core/persistence/storage-keys.const';
import { FinishDayBtnComponent } from './finish-day-btn/finish-day-btn.component';
import { ScheduledDateGroupPipe } from '../../ui/pipes/scheduled-date-group.pipe';

@Component({
  selector: 'work-view',
  templateUrl: './work-view.component.html',
  styleUrls: ['./work-view.component.scss'],
  animations: [
    expandFadeAnimation,
    expandAnimation,
    fadeAnimation,
    workViewProjectChangeAnimation,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkScrollable,
    MatTooltip,
    MatIcon,
    MatMiniFabButton,
    MatButton,
    AddTaskBarComponent,
    AddScheduledTodayOrTomorrowBtnComponent,
    TaskListComponent,
    SplitComponent,
    BacklogComponent,
    AsyncPipe,
    MsToStringPipe,
    TranslatePipe,
    CollapsibleComponent,
    CommonModule,
    MatMenuModule,
    FinishDayBtnComponent,
    ScheduledDateGroupPipe,
  ],
})

export class WorkViewComponent implements OnInit, OnDestroy {
  taskService = inject(TaskService);
  takeABreakService = inject(TakeABreakService);
  planningModeService = inject(PlanningModeService);
  layoutService = inject(LayoutService);
  sectionService = inject(SectionService);
  customizerService = inject(TaskViewCustomizerService);
  workContextService = inject(WorkContextService);
  private _activatedRoute = inject(ActivatedRoute);
  private _projectService = inject(ProjectService);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);

  // TODO refactor all to signals
  overdueTasks = toSignal(this._store.select(selectOverdueTasksWithSubTasks), {
    initialValue: [],
  });
  laterTodayTasks = toSignal(this._store.select(selectLaterTodayTasksWithSubTasks), {
    initialValue: [],
  });
  undoneTasks = input.required<TaskWithSubTasks[]>();
  customizedUndoneTasks = toSignal(
    this.customizerService.customizeUndoneTasks(this.workContextService.undoneTasks$),
    { initialValue: { list: [] } },
  );
  doneTasks = input.required<TaskWithSubTasks[]>();
  backlogTasks = input.required<TaskWithSubTasks[]>();
  isShowBacklog = input<boolean>(false);

  hasDoneTasks = computed(() => this.doneTasks().length > 0);

  isPlanningMode = this.planningModeService.isPlanningMode;
  todayRemainingInProject = toSignal(this.workContextService.todayRemainingInProject$, {
    initialValue: 0,
  });
  estimateRemainingToday = toSignal(this.workContextService.estimateRemainingToday$, {
    initialValue: 0,
  });
  workingToday = toSignal(this.workContextService.workingToday$, { initialValue: 0 });
  selectedTaskId = this.taskService.selectedTaskId;
  isOnTodayList = toSignal(this.workContextService.isTodayList$, { initialValue: false });
  isDoneHidden = signal(!!localStorage.getItem(LS.DONE_TASKS_HIDDEN));
  isLaterTodayHidden = signal(!!localStorage.getItem(LS.LATER_TODAY_TASKS_HIDDEN));
  isOverdueHidden = signal(!!localStorage.getItem(LS.OVERDUE_TASKS_HIDDEN));

  // Section Logic
  sections = toSignal(
    this.workContextService.activeWorkContextId$.pipe(
      switchMap((id) => (id ? this.sectionService.getSectionsByProjectId$(id) : of([]))),
    ),
    { initialValue: [] },
  );

  undoneTasksBySection = computed(() => {
    const tasks = this.undoneTasks();
    const sections = this.sections();

    const dict: Record<string, TaskWithSubTasks[]> = {};
    const noSection: TaskWithSubTasks[] = [];

    tasks.forEach((task) => {
      if (task.sectionId && sections.find((s) => s.id === task.sectionId)) {
        if (!dict[task.sectionId]) dict[task.sectionId] = [];
        dict[task.sectionId].push(task);
      } else {
        noSection.push(task);
      }
    });

    return { dict, noSection };
  });


  isShowOverduePanel = computed(
    () => this.isOnTodayList() && this.overdueTasks().length > 0,
  );

  isShowTimeWorkedWithoutBreak: boolean = true;
  splitInputPos: number = 100;
  T: typeof T = T;

  // NOTE: not perfect but good enough for now
  isTriggerBacklogIconAni$: Observable<boolean> =
    this._projectService.onMoveToBacklog$.pipe(
      switchMap(() => zip(from([true, false]), timer(1, 200))),
      map((v) => v[0]),
    );
  splitTopEl$: ReplaySubject<HTMLElement> = new ReplaySubject(1);

  // TODO make this work for tag page without backlog
  upperContainerScroll$: Observable<Event> =
    this.workContextService.isContextChanging$.pipe(
      filter((isChanging) => !isChanging),
      delay(50),
      switchMap(() => this.splitTopEl$),
      switchMap((el) =>
        // Defer scroll reactions to the next frame so layoutService.isScrolled
        // toggles happen in sync with the browser repaint.
        fromEvent(el, 'scroll').pipe(observeOn(animationFrameScheduler)),
      ),
    );

  private _subs: Subscription = new Subscription();
  private _switchListAnimationTimeout?: number;

  // TODO: Skipped for migration because:
  //  Accessor queries cannot be migrated as they are too complex.
  @ViewChild('splitTopEl', { read: ElementRef }) set splitTopElRef(ref: ElementRef) {
    if (ref) {
      this.splitTopEl$.next(ref.nativeElement);
    }
  }

  constructor() {
    // Setup effect to track task changes
    effect(() => {
      const currentSelectedId = this.selectedTaskId();
      if (!currentSelectedId) return;

      if (this._hasTaskInList(this.undoneTasks(), currentSelectedId)) return;
      if (this._hasTaskInList(this.doneTasks(), currentSelectedId)) return;
      if (this._hasTaskInList(this.laterTodayTasks(), currentSelectedId)) return;

      if (
        this.workContextService.activeWorkContextId === TODAY_TAG.id &&
        this._hasTaskInList(this.overdueTasks(), currentSelectedId)
      )
        return;

      // Check if task is in backlog
      if (this._hasTaskInList(this.backlogTasks(), currentSelectedId)) return;

      // if task really is gone
      this.taskService.setSelectedId(null);
    });

    effect(() => {
      const isExpanded = this.isDoneHidden();
      if (isExpanded) {
        localStorage.setItem(LS.DONE_TASKS_HIDDEN, 'true');
      } else {
        localStorage.removeItem(LS.DONE_TASKS_HIDDEN);
      }
    });

    effect(() => {
      const isExpanded = this.isLaterTodayHidden();
      if (isExpanded) {
        localStorage.setItem(LS.LATER_TODAY_TASKS_HIDDEN, 'true');
      } else {
        localStorage.removeItem(LS.LATER_TODAY_TASKS_HIDDEN);
      }
    });

    effect(() => {
      const isExpanded = this.isOverdueHidden();
      if (isExpanded) {
        localStorage.setItem(LS.OVERDUE_TASKS_HIDDEN, 'true');
      } else {
        localStorage.removeItem(LS.OVERDUE_TASKS_HIDDEN);
      }
    });

    afterNextRender(() => this._initScrollTracking());
  }

  ngOnInit(): void {
    // preload
    // TODO check
    // this._subs.add(this.workContextService.backlogTasks$.subscribe());

    this._subs.add(
      this._activatedRoute.queryParams.subscribe((params) => {
        if (params && params.backlogPos) {
          this.splitInputPos = +params.backlogPos;
        } else if (params.isInBacklog === 'true') {
          this.splitInputPos = 50;
        }
        // NOTE: otherwise this is not triggered right away
        this._cd.detectChanges();
      }),
    );
  }

  ngOnDestroy(): void {
    if (this._switchListAnimationTimeout) {
      window.clearTimeout(this._switchListAnimationTimeout);
    }
    this._subs.unsubscribe();
    this.layoutService.isScrolled.set(false);
  }

  planMore(): void {
    this.planningModeService.enterPlanningMode();
  }

  addSection(): void {
    this._matDialog
      .open(DialogPromptComponent, {
        data: {
          placeholder: T.WW.ADD_SECTION_TITLE,
        },
      })
      .afterClosed()
      .subscribe((title: string | undefined) => {
        if (title) {
          this.sectionService.addSection(title, this.workContextService.activeWorkContextId);
        }
      });
  }

  deleteSection(id: string): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        data: {
          message: T.CONFIRM.DELETE_SECTION_CASCADE,
        },
      })
      .afterClosed()
      .subscribe((isConfirm: boolean) => {
        if (isConfirm) {
          this.sectionService.deleteSection(id);
        }
      });
  }

  editSection(id: string, title: string): void {
    this._matDialog
      .open(DialogPromptComponent, {
        data: {
          placeholder: T.WW.ADD_SECTION_TITLE,
          val: title,
        },
      })
      .afterClosed()
      .subscribe((newTitle: string | undefined) => {
        if (newTitle) {
          this.sectionService.updateSection(id, { title: newTitle });
        }
      });
  }


  startWork(): void {
    this.planningModeService.leavePlanningMode();
  }

  resetBreakTimer(): void {
    this.takeABreakService.resetTimer();
  }

  async moveDoneToArchive(): Promise<void> {
    const doneTasks = this.doneTasks();

    // Add detailed logging for debugging
    console.log('[WorkView] moveDoneToArchive called with:', {
      doneTasks,
      type: typeof doneTasks,
      isArray: Array.isArray(doneTasks),
      length: doneTasks?.length,
      projectId: this.workContextService.activeWorkContextId,
      contextType: this.workContextService.activeWorkContextType,
    });

    if (!doneTasks || !Array.isArray(doneTasks)) {
      console.error('[WorkView] doneTasks is not an array:', doneTasks);
      return;
    }

    if (doneTasks.length === 0) {
      return;
    }

    await this.taskService.moveToArchive(doneTasks);
    this._snackService.open({
      msg: T.F.TASK.S.MOVED_TO_ARCHIVE,
      type: 'SUCCESS',
      ico: 'done_all',
      translateParams: {
        nr: doneTasks.length,
      },
    });
  }

  addAllOverdueToMyDay(): void {
    const overdueTasks = this.overdueTasks();
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: overdueTasks.map((t) => t.id),
      }),
    );
  }

  dropSection(event: CdkDragDrop<Section[]>): void {
    const sections = this.sections();
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    // We can't mutate the array directly as it is from a signal/store
    // So we copy it, move the item, and then extract the IDs
    const newSections = [...sections];
    moveItemInArray(newSections, event.previousIndex, event.currentIndex);

    // Update the section order in the store
    this.sectionService.updateSectionOrder(newSections.map((s) => s.id));
  }

  private _initScrollTracking(): void {
    this._subs.add(
      this.upperContainerScroll$.subscribe(({
        target
      }) => {
        if ((target as HTMLElement).scrollTop !== 0) {
          this.layoutService.isScrolled.set(true);
        } else {
          this.layoutService.isScrolled.set(false);
        }
      }),
    );
  }

  private _hasTaskInList(
    taskList: TaskWithSubTasks[] | null | undefined,
    taskId: string,
  ): boolean {
    if (!taskList || !taskList.length) {
      return false;
    }

    for (const task of taskList) {
      if (!task) {
        continue;
      }

      if (task.id === taskId) {
        return true;
      }

      const subTasks = task.subTasks;
      if (Array.isArray(subTasks) && subTasks.length) {
        for (const subTask of subTasks) {
          if (subTask && subTask.id === taskId) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
