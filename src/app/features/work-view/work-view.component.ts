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
import { TaskService } from '../tasks/task.service';
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
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { T } from '../../t.const';
import { workViewProjectChangeAnimation } from '../../ui/animations/work-view-project-change.ani';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatMiniFabButton } from '@angular/material/button';
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
import { GlobalConfigService } from '../config/global-config.service';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TODAY_TAG } from '../tag/tag.const';
import { LS } from '../../core/persistence/storage-keys.const';
import { FinishDayBtnComponent } from './finish-day-btn/finish-day-btn.component';
import { ScheduledDateGroupPipe } from '../../ui/pipes/scheduled-date-group.pipe';
import {
  selectTaskRepeatCfgsByProjectId,
  selectTaskRepeatCfgsByTagId,
} from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { RepeatCfgPreviewComponent } from '../task-repeat-cfg/repeat-cfg-preview/repeat-cfg-preview.component';
import { recordSearchNavDebug } from '../../util/search-nav-debug';

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
    CdkScrollable,
    MatTooltip,
    MatIcon,
    MatMiniFabButton,
    MatButton,
    TaskListComponent,
    SplitComponent,
    BacklogComponent,
    AsyncPipe,
    MsToStringPipe,
    TranslatePipe,
    CollapsibleComponent,
    CommonModule,
    FinishDayBtnComponent,
    ScheduledDateGroupPipe,
    RepeatCfgPreviewComponent,
  ],
})
export class WorkViewComponent implements OnInit, OnDestroy {
  private static readonly _FOCUS_ITEM_RETRY_DELAY = 250;
  private static readonly _FOCUS_ITEM_MAX_RETRIES = 20;

  taskService = inject(TaskService);
  takeABreakService = inject(TakeABreakService);
  layoutService = inject(LayoutService);
  customizerService = inject(TaskViewCustomizerService);
  workContextService = inject(WorkContextService);
  private _activatedRoute = inject(ActivatedRoute);
  private _projectService = inject(ProjectService);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _snackService = inject(SnackService);
  private _globalConfigService = inject(GlobalConfigService);

  isFinishDayEnabled = computed(
    () => this._globalConfigService.appFeatures().isFinishDayEnabled,
  );

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
  isRepeatCfgsHidden = signal(!!localStorage.getItem(LS.REPEAT_CFGS_HIDDEN));

  repeatCfgsForContext = toSignal(
    this.workContextService.activeWorkContextTypeAndId$.pipe(
      switchMap(({ activeType, activeId }) =>
        activeType === 'PROJECT'
          ? this._store.select(selectTaskRepeatCfgsByProjectId, {
              projectId: activeId,
            })
          : this._store.select(selectTaskRepeatCfgsByTagId, { tagId: activeId }),
      ),
    ),
    { initialValue: [] as TaskRepeatCfg[] },
  );

  isShowRepeatCfgsPanel = computed(
    () =>
      !this.customizerService.isCustomized() && this.repeatCfgsForContext().length > 0,
  );

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
        // Defer scroll reactions to the next frame so layoutService.isWorkViewScrolled
        // toggles happen in sync with the browser repaint.
        fromEvent(el, 'scroll').pipe(observeOn(animationFrameScheduler)),
      ),
    );

  private _subs: Subscription = new Subscription();
  private _pendingFocusItemTaskId: string | null = null;
  private _pendingFocusItemTimeout?: number;
  private _splitTopElement?: HTMLElement;
  private _switchListAnimationTimeout?: number;

  // TODO: Skipped for migration because:
  //  Accessor queries cannot be migrated as they are too complex.
  @ViewChild('splitTopEl', { read: ElementRef }) set splitTopElRef(ref: ElementRef) {
    if (ref) {
      this._splitTopElement = ref.nativeElement;
      recordSearchNavDebug('workView:splitTopElReady', {
        selectedTaskId: this.selectedTaskId(),
        clientHeight: ref.nativeElement.clientHeight,
        scrollHeight: ref.nativeElement.scrollHeight,
      });
      this.splitTopEl$.next(ref.nativeElement);
      if (this._pendingFocusItemTaskId) {
        this._focusItemInWorkViewWhenReady(this._pendingFocusItemTaskId);
      }
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

    effect(() => {
      const isHidden = this.isRepeatCfgsHidden();
      if (isHidden) {
        localStorage.setItem(LS.REPEAT_CFGS_HIDDEN, 'true');
      } else {
        localStorage.removeItem(LS.REPEAT_CFGS_HIDDEN);
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
        if (params?.focusItem) {
          recordSearchNavDebug('workView:focusQueryParam', {
            focusItem: params.focusItem,
            selectedTaskId: this.selectedTaskId(),
            splitInputPos: this.splitInputPos,
          });
          this._pendingFocusItemTaskId = params.focusItem;
          this._focusItemInWorkViewWhenReady(params.focusItem);
        } else {
          this._pendingFocusItemTaskId = null;
        }
        // NOTE: otherwise this is not triggered right away
        this._cd.detectChanges();
      }),
    );
  }

  ngOnDestroy(): void {
    if (this._pendingFocusItemTimeout) {
      window.clearTimeout(this._pendingFocusItemTimeout);
    }
    if (this._switchListAnimationTimeout) {
      window.clearTimeout(this._switchListAnimationTimeout);
    }
    this._subs.unsubscribe();
    this.layoutService.isWorkViewScrolled.set(false);
  }

  resetBreakTimer(): void {
    this.takeABreakService.resetTimer();
  }

  async moveDoneToArchive(): Promise<void> {
    const doneTasks = this.doneTasks();

    if (!doneTasks || doneTasks.length === 0) {
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

  private _initScrollTracking(): void {
    this._subs.add(
      this.upperContainerScroll$.subscribe(({ target }) => {
        if ((target as HTMLElement).scrollTop !== 0) {
          this.layoutService.isWorkViewScrolled.set(true);
        } else {
          this.layoutService.isWorkViewScrolled.set(false);
        }
      }),
    );
  }

  private _focusItemInWorkViewWhenReady(
    taskId: string,
    retriesLeft: number = WorkViewComponent._FOCUS_ITEM_MAX_RETRIES,
  ): void {
    if (this._pendingFocusItemTimeout) {
      window.clearTimeout(this._pendingFocusItemTimeout);
      this._pendingFocusItemTimeout = undefined;
    }

    const container = this._splitTopElement;
    const directMatch = container?.querySelector(`#t-${taskId}`) as HTMLElement | null;
    const selectedMatch =
      this.selectedTaskId() === taskId
        ? ((container?.querySelector('task.isSelected') as HTMLElement | null) ?? null)
        : null;
    const matchedElement = directMatch ?? selectedMatch;
    const el =
      matchedElement && this._isTaskElementReady(matchedElement) ? matchedElement : null;
    recordSearchNavDebug('workView:focusAttempt', {
      taskId,
      retriesLeft,
      selectedTaskId: this.selectedTaskId(),
      hasContainer: !!container,
      hasDirectMatch: !!directMatch,
      hasSelectedMatch: !!selectedMatch,
      matchedElementHeight: matchedElement?.getBoundingClientRect().height ?? null,
      containerScrollTop: container?.scrollTop ?? null,
      containerClientHeight: container?.clientHeight ?? null,
      containerScrollHeight: container?.scrollHeight ?? null,
    });
    if (container && el) {
      const relativeTop = this._getRelativeTopWithinContainer(el, container);
      const containerCenterOffset = container.clientHeight / 2;
      const elementCenterOffset = el.offsetHeight / 2;
      const centeredTop = relativeTop - containerCenterOffset + elementCenterOffset;
      container.scrollTop = Math.max(centeredTop, 0);
      el.focus({ preventScroll: true });
      recordSearchNavDebug('workView:focusSuccess', {
        taskId,
        selectedTaskId: this.selectedTaskId(),
        matchedElementId: el.id,
        relativeTop,
        elementOffsetHeight: el.offsetHeight,
        centeredTop,
        appliedScrollTop: container.scrollTop,
      });
      window.setTimeout(() => {
        recordSearchNavDebug('workView:focusPostTick', {
          taskId,
          selectedTaskId: this.selectedTaskId(),
          matchedElementId: el.id,
          containerScrollTop: container.scrollTop,
          containerClientHeight: container.clientHeight,
          containerScrollHeight: container.scrollHeight,
        });
      }, 0);
      this._pendingFocusItemTaskId = null;
      return;
    }

    if (retriesLeft <= 0) {
      return;
    }

    this._pendingFocusItemTimeout = window.setTimeout(() => {
      this._pendingFocusItemTimeout = undefined;
      this._focusItemInWorkViewWhenReady(taskId, retriesLeft - 1);
    }, WorkViewComponent._FOCUS_ITEM_RETRY_DELAY);
  }

  private _getRelativeTopWithinContainer(
    el: HTMLElement,
    container: HTMLElement,
  ): number {
    let relativeTop = 0;
    let current: HTMLElement | null = el;

    while (current && current !== container) {
      relativeTop += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }

    return relativeTop;
  }

  private _isTaskElementReady(el: HTMLElement): boolean {
    return (
      document.body.contains(el) &&
      el.getClientRects().length > 0 &&
      el.getBoundingClientRect().height > 0
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
