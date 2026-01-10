import { AsyncPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  OnDestroy,
  OnInit,
  Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';

import { combineLatest, from, merge, Observable, Subject } from 'rxjs';
import {
  delay,
  filter,
  first,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  withLatestFrom,
} from 'rxjs/operators';
import { DateService } from 'src/app/core/date/date.service';

import { EntityState } from '@ngrx/entity';
import { Action } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';

import { IS_ELECTRON } from '../../app.constants';
import { ConfettiService } from '../../core/confetti/confetti.service';
import { Log } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { BeforeFinishDayService } from '../../features/before-finish-day/before-finish-day.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { EvaluationSheetComponent } from '../../features/metric/evaluation-sheet/evaluation-sheet.component';
import { getSimpleCounterStreakDuration } from '../../features/simple-counter/get-simple-counter-streak-duration';
import { SimpleCounterService } from '../../features/simple-counter/simple-counter.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { TaskSummaryTablesComponent } from '../../features/tasks/task-summary-tables/task-summary-tables.component';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { TasksByTagComponent } from '../../features/tasks/tasks-by-tag/tasks-by-tag.component';
import { TaskArchiveService } from '../../features/time-tracking/task-archive.service';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { WorklogWeekComponent } from '../../features/worklog/worklog-week/worklog-week.component';
import { WorklogService } from '../../features/worklog/worklog.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { T } from '../../t.const';
import { expandAnimation } from '../../ui/animations/expand.ani';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { MsToClockStringPipe } from '../../ui/duration/ms-to-clock-string.pipe';
import { InlineInputComponent } from '../../ui/inline-input/inline-input.component';
import { InlineMarkdownComponent } from '../../ui/inline-markdown/inline-markdown.component';
import { MomentFormatPipe } from '../../ui/pipes/moment-format.pipe';
import { isToday, isYesterday } from '../../util/is-today.util';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { shareReplayUntil } from '../../util/share-replay-until';
import { unToggleCheckboxesInMarkdownTxt } from '../../util/untoggle-checkboxes-in-markdown-txt';
import { PlanTasksTomorrowComponent } from './plan-tasks-tomorrow/plan-tasks-tomorrow.component';
import {
  SimpleCounterSummaryItem,
  SimpleCounterSummaryItemComponent,
} from './simple-counter-summary-item/simple-counter-summary-item.component';
import { MetricService } from '../../features/metric/metric.service';

const MAGIC_YESTERDAY_MARGIN = 4 * 60 * 60 * 1000;

@Component({
  selector: 'daily-summary',
  templateUrl: './daily-summary.component.html',
  styleUrls: ['./daily-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatAnchor,
    MatIcon,
    InlineInputComponent,
    MatTabGroup,
    MatTab,
    MatProgressSpinner,
    PlanTasksTomorrowComponent,
    MatButton,
    MatTooltip,
    AsyncPipe,
    MomentFormatPipe,
    MsToClockStringPipe,
    TranslatePipe,
    TaskSummaryTablesComponent,
    TasksByTagComponent,
    EvaluationSheetComponent,
    WorklogWeekComponent,
    InlineMarkdownComponent,
    MatIconButton,
    SimpleCounterSummaryItemComponent,
  ],
  animations: [expandAnimation],
})
export class DailySummaryComponent implements OnInit, OnDestroy, AfterViewInit {
  readonly configService = inject(GlobalConfigService);
  private readonly _confettiService = inject(ConfettiService);
  readonly workContextService = inject(WorkContextService);
  private readonly _taskService = inject(TaskService);
  private readonly _router = inject(Router);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _worklogService = inject(WorklogService);
  private readonly _activatedRoute = inject(ActivatedRoute);
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _beforeFinishDayService = inject(BeforeFinishDayService);
  private readonly _simpleCounterService = inject(SimpleCounterService);
  private readonly _dateService = inject(DateService);
  private readonly _metricService = inject(MetricService);

  T: typeof T = T;
  _onDestroy$ = new Subject<void>();

  readonly isIncludeYesterday: boolean;
  selectedTabIndex: number = 0;
  isForToday: boolean = true;

  // TODO remove one?
  dayStr: string = this._dateService.todayStr();

  dayStr$: Observable<string> = this._activatedRoute.paramMap.pipe(
    startWith({
      params: { dayStr: this._dateService.todayStr() },
    }),
    map((s) => {
      if (s && 'params' in s && s.params.dayStr) {
        return s.params.dayStr;
      } else {
        return this._dateService.todayStr();
      }
    }),
    shareReplayUntil(this._onDestroy$, 1),
  );

  cfg$ = this.configService.cfg$;

  private _enabledSimpleCounters = toSignal(
    this._simpleCounterService.enabledSimpleCounters$,
    { initialValue: [] },
  );

  simpleCounterSummaryItems: Signal<SimpleCounterSummaryItem[]> = computed(() => {
    return this._enabledSimpleCounters().map((sc) => ({
      ...sc,
      streakDuration: getSimpleCounterStreakDuration(sc),
    }));
  });

  tasksWorkedOnOrDoneOrRepeatableFlat$: Observable<Task[]> = this.dayStr$.pipe(
    switchMap((dayStr) => this._getDailySummaryTasksFlat$(dayStr)),
    shareReplay(1),
  );

  hasTasksForToday$: Observable<boolean> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    map((tasks) => tasks && !!tasks.length),
  );

  focusSessionSummary$ = this.dayStr$.pipe(
    switchMap((dayStr) => this._metricService.getMetricForDay$(dayStr)),
    map((metric) => {
      const focusSessions = metric.focusSessions ?? [];
      const total = focusSessions.reduce((acc, val) => acc + val, 0);
      return {
        count: focusSessions.length,
        total,
      };
    }),
  );

  focusSessionCount$ = this.focusSessionSummary$.pipe(map((summary) => summary.count));

  focusSessionDuration$ = this.focusSessionSummary$.pipe(map((summary) => summary.total));

  nrOfDoneTasks$: Observable<number> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    map((tasks) => tasks && tasks.filter((task) => !!task.isDone).length),
  );

  totalNrOfTasks$: Observable<number> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    map((tasks) => tasks && tasks.length),
  );

  estimatedOnTasksWorkedOn$: Observable<number> =
    this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
      withLatestFrom(this.dayStr$),
      map(
        ([tasks, dayStr]: [Task[], string]): number =>
          tasks?.length &&
          tasks.reduce((acc, task) => {
            if (
              task.subTaskIds.length ||
              (!task.timeSpentOnDay && !(task.timeSpentOnDay[dayStr] > 0))
            ) {
              return acc;
            }
            const remainingEstimate =
              task.timeEstimate + task.timeSpentOnDay[dayStr] - task.timeSpent;
            return remainingEstimate > 0 ? acc + remainingEstimate : acc;
          }, 0),
      ),
    );

  timeWorked$: Observable<number> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    withLatestFrom(this.dayStr$),
    map(
      ([tasks, dayStr]: [Task[], string]): number =>
        tasks?.length &&
        tasks.reduce((acc, task) => {
          if (task.subTaskIds.length) {
            return acc;
          }
          return (
            acc +
            (task.timeSpentOnDay && +task.timeSpentOnDay[dayStr]
              ? +task.timeSpentOnDay[dayStr]
              : 0)
          );
        }, 0),
    ),
  );

  started$: Observable<number | undefined> = this.dayStr$.pipe(
    switchMap((dayStr) => this.workContextService.getWorkStart$(dayStr)),
  );
  end$: Observable<number | undefined> = this.dayStr$.pipe(
    switchMap((dayStr) => this.workContextService.getWorkEnd$(dayStr)),
  );

  breakTime$: Observable<number | undefined> = this.dayStr$.pipe(
    switchMap((dayStr) => this.workContextService.getBreakTime$(dayStr)),
  );
  breakNr$: Observable<number | undefined> = this.dayStr$.pipe(
    switchMap((dayStr) => this.workContextService.getBreakNr$(dayStr)),
  );

  isBreakTrackingSupport$: Observable<boolean> = this.configService.idle$.pipe(
    map((cfg) => cfg && cfg.isEnableIdleTimeTracking),
  );

  actionsToExecuteBeforeFinishDay: Action[] = [{ type: 'FINISH_DAY' }];

  cfg = toSignal(this.cfg$);
  dailySummaryNoteTxt = linkedSignal(() => this.cfg()?.dailySummaryNote?.txt);

  private _startCelebrationTimeout?: number;
  private _celebrationIntervalId?: number;

  constructor() {
    this._taskService.setSelectedId(null);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    this.isIncludeYesterday = Date.now() - todayStart.getTime() <= MAGIC_YESTERDAY_MARGIN;

    const cfg = this.configService.cfg();
    if (
      cfg?.dailySummaryNote?.txt &&
      cfg?.dailySummaryNote?.lastUpdateDayStr !== this._dateService.todayStr()
    ) {
      this.dailySummaryNoteTxt.set(
        unToggleCheckboxesInMarkdownTxt(cfg.dailySummaryNote.txt),
      );
    }
  }

  ngOnInit(): void {
    // we need to wait, otherwise data would get overwritten
    this._taskService.currentTaskId$
      .pipe(
        takeUntil(this._onDestroy$),
        filter((id) => !!id),
        take(1),
      )
      .subscribe(() => {
        this._taskService.setCurrentId(null);
      });

    this._activatedRoute.paramMap
      .pipe(takeUntil(this._onDestroy$))
      .subscribe((params) => {
        const dayStr = params.get('dayStr');
        if (dayStr) {
          this.isForToday = false;
          this.dayStr = dayStr;
        }
      });
  }

  ngAfterViewInit(): void {
    if (
      this.configService.misc()?.isDisableAnimations ||
      this.configService.misc()?.isDisableCelebration
    ) {
      return;
    }

    this._startCelebrationTimeout = window.setTimeout(
      () => {
        this._celebrate();
      },
      IS_TOUCH_ONLY ? 1500 : 500,
    );
  }

  ngOnDestroy(): void {
    this._onDestroy$.next();
    this._onDestroy$.complete();
    // should not happen, but just in case
    window.clearTimeout(this._startCelebrationTimeout);
    window.clearInterval(this._celebrationIntervalId);
  }

  async finishDay(): Promise<void> {
    await this._beforeFinishDayService.executeActions();
    if (IS_ELECTRON && this.isForToday) {
      const isConfirm = await this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            okTxt: T.PDS.D_CONFIRM_APP_CLOSE.OK,
            cancelTxt: T.PDS.D_CONFIRM_APP_CLOSE.CANCEL,
            message: T.PDS.D_CONFIRM_APP_CLOSE.MSG,
          },
        })
        .afterClosed()
        .pipe(first())
        .toPromise();

      // dialog was just clicked away
      if (isConfirm === undefined) {
        return;
      } else if (isConfirm === true) {
        await this._moveDoneToArchive();
        this._finishDayForGood(() => {
          window.ea.shutdownNow();
        });
      } else if (isConfirm === false) {
        await this._moveDoneToArchive();
        this._finishDayForGood(() => {
          this._router.navigate(['/active/tasks']);
        });
      }
    } else {
      await this._moveDoneToArchive();
      this._finishDayForGood(() => {
        this._router.navigate(['/active/tasks']);
      });
    }
  }

  updateWorkStart(ev: string): void {
    const startTime = new Date(`${this.dayStr} ${ev}`).getTime();
    if (startTime && !isNaN(startTime)) {
      this.workContextService.updateWorkStartForActiveContext(this.dayStr, startTime);
    }
  }

  updateWorkEnd(ev: string): void {
    const endTime = new Date(`${this.dayStr} ${ev}`).getTime();
    if (endTime && !isNaN(endTime)) {
      this.workContextService.updateWorkEndForActiveContext(this.dayStr, endTime);
    }
  }

  updateBreakNr(value: string): void {
    const nr = parseInt(value);
    if (!isNaN(nr)) {
      this.workContextService.updateBreakNrForActiveContext(this.dayStr, nr);

      if (nr === 0) {
        this.workContextService.updateBreakTimeForActiveContext(this.dayStr, 0);
      }
    }
  }

  updateBreakTime(time: number): void {
    if (!isNaN(time)) {
      this.workContextService.updateBreakTimeForActiveContext(this.dayStr, time);

      if (time === 0) {
        this.workContextService.updateBreakNrForActiveContext(this.dayStr, 0);
      } else {
        // if break time was set to a non-zero value ensure that nr is > 0
        this.breakNr$
          .pipe(first())
          .toPromise()
          .then((nr) => {
            const currentNr = nr || 0;
            if (currentNr === 0) {
              this.workContextService.updateBreakNrForActiveContext(this.dayStr, 1);
            }
          });
      }
    }
  }

  onTabIndexChange(i: number): void {
    this.selectedTabIndex = i;
  }

  updateDailySummaryTxt(txt?: string, isForceShow = false): void {
    this.configService.updateSection(
      'dailySummaryNote',
      {
        txt: (!txt || txt.length === 0) && !isForceShow ? undefined : txt,
        lastUpdateDayStr: this._dateService.todayStr(),
      },
      true,
    );
  }

  private async _moveDoneToArchive(): Promise<void> {
    const doneTasks = await this.workContextService.doneTasks$.pipe(take(1)).toPromise();
    Log.log('[DailySummary] Moving done tasks to archive:', {
      count: doneTasks.length,
      taskIds: doneTasks.map((t) => t.id),
      tasks: doneTasks,
    });

    if (doneTasks.length === 0) {
      Log.log('[DailySummary] No done tasks to archive');
      return;
    }

    // Count parent tasks only (not subtasks)
    const parentTaskCount = doneTasks.filter((task) => !task.parentId).length;

    // Actually wait for the archive operation to complete
    await this._taskService.moveToArchive(doneTasks);
    Log.log('[DailySummary] Archive operation completed');

    // Show snackbar notification
    this._snackService.open({
      msg:
        parentTaskCount > 1 ? T.PDS.ARCHIVED_TASKS.PLURAL : T.PDS.ARCHIVED_TASKS.SINGULAR,
      translateParams: { count: parentTaskCount },
      type: 'SUCCESS',
      ico: 'archive',
    });
  }

  private async _finishDayForGood(cb?: () => void): Promise<void> {
    const cfg = this.configService.cfg();
    const syncCfg = cfg?.sync;
    if (syncCfg?.isEnabled) {
      await this._syncWrapperService.sync();
    }
    if (cb) {
      cb();
    }
  }

  private _getDailySummaryTasksFlat$(dayStr: string): Observable<Task[]> {
    // TODO make more performant!!
    const _isWorkedOnDoneOrDueToday = (() => {
      if (this.isIncludeYesterday) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = this._dateService.todayStr(yesterday);

        return (t: Task) =>
          (t.timeSpentOnDay &&
            t.timeSpentOnDay[dayStr] &&
            t.timeSpentOnDay[dayStr] > 0) ||
          (t.timeSpentOnDay &&
            t.timeSpentOnDay[yesterdayStr] &&
            t.timeSpentOnDay[yesterdayStr] > 0) ||
          (t.dueDay && t.dueDay === dayStr) ||
          (t.isDone && t.doneOn && (isToday(t.doneOn) || isYesterday(t.doneOn)));
      } else {
        return (t: Task) =>
          (t.timeSpentOnDay &&
            t.timeSpentOnDay[dayStr] &&
            t.timeSpentOnDay[dayStr] > 0) ||
          (t.dueDay && t.dueDay === dayStr) ||
          (t.isDone && t.doneOn && isToday(t.doneOn));
      }
    })();

    const _mapEntities = ([taskState, { activeType, activeId }]: [
      EntityState<Task>,
      {
        activeId: string;
        activeType: WorkContextType;
      },
    ]): TaskWithSubTasks[] => {
      const ids = (taskState && (taskState.ids as string[])) || [];
      const tasksI = ids.map((id) => taskState.entities[id]);

      let filteredTasks;
      if (activeId === TODAY_TAG.id) {
        filteredTasks = tasksI as Task[];
      } else if (activeType === WorkContextType.PROJECT) {
        filteredTasks = tasksI.filter(
          (task) => (task as Task).projectId === activeId,
        ) as Task[];
      } else {
        filteredTasks = tasksI.filter((task) =>
          !!(task as Task).parentId
            ? (
                taskState.entities[(task as Task).parentId as string] as Task
              ).tagIds.includes(activeId)
            : (task as Task).tagIds.includes(activeId),
        ) as Task[];
      }
      // return filteredTasks;
      // to order sub tasks after their parents
      return filteredTasks
        .filter((task) => !task.parentId)
        .map((task) =>
          task.subTaskIds.length
            ? {
                ...task,
                subTasks: task.subTaskIds
                  .map((tid) => taskState.entities[tid])
                  .filter((t) => t),
              }
            : task,
        ) as TaskWithSubTasks[];
    };

    const _mapFilterToFlatToday = (tasks: TaskWithSubTasks[]): TaskWithSubTasks[] => {
      let flatTasks: TaskWithSubTasks[] = [];
      tasks.forEach((pt: TaskWithSubTasks) => {
        if (pt.subTasks && pt.subTasks.length) {
          const subTasks = pt.subTasks.filter((st) => _isWorkedOnDoneOrDueToday(st));
          if (subTasks.length) {
            flatTasks.push(pt);
            flatTasks = flatTasks.concat(subTasks as TaskWithSubTasks[]);
          }
        } else if (_isWorkedOnDoneOrDueToday(pt)) {
          flatTasks.push(pt);
        }
      });
      return flatTasks;
    };

    const _mapFilterToFlatOrRepeatToday = (
      tasks: TaskWithSubTasks[],
    ): TaskWithSubTasks[] => {
      let flatTasks: TaskWithSubTasks[] = [];
      tasks.forEach((pt: TaskWithSubTasks) => {
        if (pt.subTasks && pt.subTasks.length) {
          const subTasks: TaskWithSubTasks[] = pt.subTasks
            .filter((st) => _isWorkedOnDoneOrDueToday(st))
            .map((t) => ({ ...t, subTasks: [] }));
          if (subTasks.length) {
            flatTasks.push(pt);
            flatTasks = flatTasks.concat(subTasks);
          }
        } else if (_isWorkedOnDoneOrDueToday(pt) || pt.repeatCfgId) {
          flatTasks.push(pt);
        }
      });
      return flatTasks;
    };

    const archiveTasks: Observable<TaskWithSubTasks[]> = merge(
      from(this._taskArchiveService.load()),
      this._worklogService.archiveUpdateManualTrigger$.pipe(
        // hacky wait for save
        delay(70),
        switchMap(() => this._taskArchiveService.load()),
      ),
    ).pipe(
      withLatestFrom(this.workContextService.activeWorkContextTypeAndId$),
      map(_mapEntities),
      map(_mapFilterToFlatToday),
    );

    const todayTasks: Observable<TaskWithSubTasks[]> =
      this._taskService.taskFeatureState$.pipe(
        withLatestFrom(this.workContextService.activeWorkContextTypeAndId$),
        map(_mapEntities),
        map(_mapFilterToFlatOrRepeatToday),
      );

    return combineLatest([todayTasks, archiveTasks]).pipe(
      map(([t1, t2]) => t1.concat(t2)),
    );
  }

  private _celebrate(): void {
    const duration = 4 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 20, spread: 720, ticks: 600, zIndex: 0 };

    const randomInRange = (min: number, max: number): number =>
      // eslint-disable-next-line no-mixed-operators
      Math.random() * (max - min) + min;

    this._celebrationIntervalId = window.setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return window.clearInterval(this._celebrationIntervalId);
      }

      const particleCount = 50 * (timeLeft / duration);
      // since particles fall down, start a bit higher than random
      this._confettiService.createConfetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      });
      this._confettiService.createConfetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      });
    }, 250);
  }
}
