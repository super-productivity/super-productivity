import { inject, Injectable } from '@angular/core';
import { select, Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, interval, Observable, of, timer } from 'rxjs';
import {
  WorkContext,
  WorkContextAdvancedCfg,
  WorkContextAdvancedCfgKey,
  WorkContextState,
  WorkContextThemeCfg,
  WorkContextType,
} from './work-context.model';
import { setActiveWorkContext } from './store/work-context.actions';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import {
  concatMap,
  delayWhen,
  distinctUntilChanged,
  filter,
  first,
  map,
  mapTo,
  shareReplay,
  startWith,
  switchMap,
  take,
  withLatestFrom,
} from 'rxjs/operators';
import { TODAY_TAG } from '../tag/tag.const';
import { TagService } from '../tag/tag.service';
import { ArchiveTask, Task, TaskWithSubTasks } from '../tasks/task.model';
import { hasTasksToWorkOn, mapEstimateRemainingFromTasks } from './work-context.util';
import {
  flattenTasks,
  selectAllTasks,
  selectAllTasksWithSubTasks,
  selectTasksWithSubTasksByIds,
} from '../tasks/store/task.selectors';
import { ofType } from '@ngrx/effects';
import { WorklogExportSettings } from '../worklog/worklog.model';
import { updateProjectAdvancedCfg } from '../project/store/project.actions';
import { updateAdvancedConfigForTag } from '../tag/store/tag.actions';
import { allDataWasLoaded } from '../../root-store/meta/all-data-was-loaded.actions';
import {
  selectActiveContextId,
  selectActiveContextTypeAndId,
  selectActiveWorkContext,
  selectDoneBacklogTaskIdsForActiveContext,
  selectDoneTaskIdsForActiveContext,
  selectStartableTasksForActiveContext,
  selectTrackableTasksForActiveContext,
} from './store/work-context.selectors';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { Note } from '../note/note.model';
import { selectNotesById } from '../note/store/note.reducer';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { distinctUntilChangedSimpleArray } from '../../util/distinct-until-changed-simple-array';
import { isShallowEqual } from '../../util/is-shallow-equal';
import { distinctUntilChangedObject } from '../../util/distinct-until-changed-object';
import { DateService } from 'src/app/core/date/date.service';
import { getTimeSpentForDay } from './get-time-spent-for-day.util';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { updateWorkContextData } from '../time-tracking/store/time-tracking.actions';
import { TaskArchiveService } from '../archive/task-archive.service';
import { INBOX_PROJECT } from '../project/project.const';
import { selectProjectById } from '../project/store/project.selectors';
import { getDbDateStr } from '../../util/get-db-date-str';
import { Log } from '../../core/log';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

@Injectable({
  providedIn: 'root',
})
export class WorkContextService {
  private _store$ = inject<Store<WorkContextState>>(Store);
  private _actions$ = inject(LOCAL_ACTIONS);
  private _tagService = inject(TagService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateService = inject(DateService);
  private _router = inject(Router);
  private _translateService = inject(TranslateService);
  private _timeTrackingService = inject(TimeTrackingService);
  private _taskArchiveService = inject(TaskArchiveService);
  private _pendingNavigationUrl: string | null = null;
  private readonly _navigationMeasureName = 'work-view-route';
  private readonly _navigationStartMark = 'work-view-route:start';
  private readonly _navigationEndMark = 'work-view-route:end';

  // here because to avoid circular dependencies
  // should be treated as private
  _isAllDataLoaded$: Observable<boolean> = this._actions$.pipe(
    ofType(allDataWasLoaded),
    mapTo(true),
    startWith(false),
    shareReplay(1),
  );

  // should be treated as private
  _afterDataLoaded$: Observable<unknown> = this._isAllDataLoaded$.pipe(
    filter((v) => v),
    shareReplay(1),
  );

  _afterDataLoadedOnce$: Observable<unknown> = this._afterDataLoaded$.pipe(first());

  // CONTEXT LEVEL
  // -------------
  activeWorkContextId$: Observable<string | null> = this._isAllDataLoaded$.pipe(
    switchMap(() => this._store$),
    select(selectActiveContextId),
    distinctUntilChanged(),
    shareReplay(1),
  );
  // activeWorkContextType$: Observable<WorkContextType> = this._store$.pipe(select(selectActiveContextType));

  activeWorkContextTypeAndId$: Observable<{
    activeId: string;
    activeType: WorkContextType;
  }> = this._isAllDataLoaded$.pipe(
    switchMap(() => this._store$.select(selectActiveContextTypeAndId)),
    // NOTE: checking for id should be enough
    distinctUntilChanged((a, b): boolean => a.activeId === b.activeId),
    shareReplay(1),
  );
  isActiveWorkContextProject$: Observable<boolean> =
    this.activeWorkContextTypeAndId$.pipe(
      map(({ activeType }) => activeType === WorkContextType.PROJECT),
      shareReplay(1),
    );

  activeWorkContextIdIfProject$: Observable<string> =
    this.activeWorkContextTypeAndId$.pipe(
      map(({ activeType, activeId }) => {
        if (activeType !== WorkContextType.PROJECT) {
          throw Error('Not in project context');
        }
        return activeId;
      }),
    );

  // for convenience...
  activeWorkContextId?: string;
  activeWorkContextType?: WorkContextType;

  activeWorkContext$: Observable<WorkContext> = this._afterDataLoadedOnce$.pipe(
    switchMap(() => this._store$.select(selectActiveWorkContext)),
    shareReplay(1),
  );

  activeWorkContextTTData$ = this.activeWorkContext$.pipe(
    switchMap((ac) => this._timeTrackingService.getWorkStartEndForWorkContext$(ac)),
    shareReplay(1),
  );

  activeWorkContextTitle$: Observable<string> = this.activeWorkContext$.pipe(
    switchMap((activeContext) => {
      if (activeContext.id === TODAY_TAG.id && activeContext.title === TODAY_TAG.title) {
        return this._translateService.stream(T.G.TODAY_TAG_TITLE);
      }
      if (
        activeContext.id === INBOX_PROJECT.id &&
        activeContext.title === INBOX_PROJECT.title
      ) {
        return this._translateService.stream(T.G.INBOX_PROJECT_TITLE);
      }

      return of(activeContext.title);
    }),
  );

  mainWorkContext$: Observable<WorkContext> = this._isAllDataLoaded$.pipe(
    concatMap(() => this._tagService.getTagById$(TODAY_TAG.id)),
    map(
      (mainWorkContext) =>
        ({
          ...mainWorkContext,
          type: WorkContextType.TAG,
          routerLink: `tag/${mainWorkContext.id}`,
          // TODO get pinned noteIds
          noteIds: [],
        }) as WorkContext,
    ),
    switchMap((mainWorkContext) =>
      mainWorkContext.id === TODAY_TAG.id && mainWorkContext.title === TODAY_TAG.title
        ? this._translateService.stream(T.G.TODAY_TAG_TITLE).pipe(
            distinctUntilChanged(),
            map((translation) => ({
              ...mainWorkContext,
              title: translation,
            })),
          )
        : of(mainWorkContext),
    ),
  );

  inboxWorkContext$: Observable<WorkContext> = this._isAllDataLoaded$.pipe(
    concatMap(() => this._store$.select(selectProjectById, { id: INBOX_PROJECT.id })),
    map(
      (inboxWorkContext) =>
        ({
          ...inboxWorkContext,
          type: WorkContextType.TAG,
          routerLink: `tag/${inboxWorkContext.id}`,
          // TODO get pinned noteIds
          noteIds: [],
        }) as WorkContext,
    ),
    switchMap((inboxWorkContext) =>
      inboxWorkContext.id === INBOX_PROJECT.id &&
      inboxWorkContext.title === INBOX_PROJECT.title
        ? this._translateService.stream(T.G.INBOX_PROJECT_TITLE).pipe(
            distinctUntilChanged(),
            map((translation) => ({
              ...inboxWorkContext,
              title: translation,
            })),
          )
        : of(inboxWorkContext),
    ),
  );

  currentTheme$: Observable<WorkContextThemeCfg> = this.activeWorkContext$.pipe(
    map((awc) => awc.theme),
    distinctUntilChanged<WorkContextThemeCfg>(isShallowEqual),
  );

  advancedCfg$: Observable<WorkContextAdvancedCfg> = this.activeWorkContext$.pipe(
    map((awc) => awc.advancedCfg),
    distinctUntilChanged(distinctUntilChangedObject),
  );

  onWorkContextChange$: Observable<any> = this._actions$.pipe(
    ofType(setActiveWorkContext),
  );
  isContextChanging$: Observable<boolean> = this.onWorkContextChange$.pipe(
    switchMap(() => timer(50).pipe(mapTo(false), startWith(true))),
    startWith(false),
  );
  isContextChangingWithDelay$: Observable<boolean> = this.isContextChanging$.pipe(
    delayWhen((val) => (val ? of(undefined) : interval(60))),
  );

  // NOTES LEVEL
  // -----------
  notes$: Observable<Note[]> = this.activeWorkContext$.pipe(
    map((ac) => ac.noteIds),
    distinctUntilChanged(distinctUntilChangedSimpleArray),
    switchMap((taskIds) => this._getNotesByIds$(taskIds)),
    shareReplay(1),
  );

  // TASK LEVEL
  // ----------
  mainListTaskIds$: Observable<string[]> = this.activeWorkContext$.pipe(
    map((ac) => ac.taskIds),
    distinctUntilChanged(distinctUntilChangedSimpleArray),
    shareReplay(1),
  );

  backlogTaskIds$: Observable<string[]> = this.activeWorkContext$.pipe(
    map((ac) => ac.backlogTaskIds || []),
    distinctUntilChanged(distinctUntilChangedSimpleArray),
    shareReplay(1),
  );

  mainListTasks$: Observable<TaskWithSubTasks[]> = this.mainListTaskIds$.pipe(
    // tap((taskIds: string[]) => Log.log('[WorkContext] Today task IDs:', taskIds)),
    switchMap((taskIds: string[]) => this._getTasksByIds$(taskIds)),
    // TODO find out why this is triggered so often
    // tap((tasks: TaskWithSubTasks[]) =>
    //   Log.log('[WorkContext] Today tasks loaded:', tasks.length, 'tasks'),
    // ),
    // map(to => to.filter(t => !!t)),
    shareReplay(1),
  );

  // Filter project tasks to show only those scheduled for today
  // TODAY_TAG is a virtual tag - membership is determined by task.dueDay, not task.tagIds
  // See: docs/ai/today-tag-architecture.md
  mainListTasksInProject$: Observable<TaskWithSubTasks[]> = this.mainListTasks$.pipe(
    map((tasks) => {
      const todayStr = getDbDateStr();
      return tasks
        .filter(
          (task) =>
            !!task &&
            (task.dueDay === todayStr ||
              task.subTasks?.some((subTask) => subTask.dueDay === todayStr)),
        )
        .map((task) => ({
          ...task,
          subTasks: task.subTasks.filter((subTask) => subTask.dueDay === todayStr),
        }));
    }),
  );

  doneTaskIds$: Observable<string[]> = this._store$.select(
    selectDoneTaskIdsForActiveContext,
  );
  doneBacklogTaskIds$: Observable<string[] | undefined> = this._store$.select(
    selectDoneBacklogTaskIdsForActiveContext,
  );

  backlogTasks$: Observable<TaskWithSubTasks[]> = this.backlogTaskIds$.pipe(
    switchMap((ids) => this._getTasksByIds$(ids)),
  );

  allTasksForCurrentContext$: Observable<TaskWithSubTasks[]> = combineLatest([
    this.mainListTasks$,
    this.backlogTasks$,
  ]).pipe(map(([today, backlog]) => [...today, ...backlog]));

  startableTasksForActiveContext$: Observable<Task[]> = this._store$.pipe(
    select(selectStartableTasksForActiveContext),
    shareReplay(1),
  );
  startableTasksForActiveContext = toSignal(this.startableTasksForActiveContext$, {
    initialValue: [],
  });

  trackableTasksForActiveContext$: Observable<Task[]> = this._store$.pipe(
    select(selectTrackableTasksForActiveContext),
  );

  workingToday$: Observable<any> = this._globalTrackingIntervalService.todayDateStr$.pipe(
    switchMap((worklogStrDate) => this.getTimeWorkedForDay$(worklogStrDate)),
  );

  workingTodayArchived$: Observable<number> =
    this._globalTrackingIntervalService.todayDateStr$.pipe(
      switchMap((worklogStrDate) =>
        this.getTimeWorkedForDayForTasksInArchiveYoung(worklogStrDate),
      ),
    );

  doneTodayArchived$: Observable<number> =
    this._globalTrackingIntervalService.todayDateStr$.pipe(
      switchMap((worklogStrDate) => this.getDoneTodayInArchive(worklogStrDate)),
    );

  isTodayList: boolean = false;
  isTodayList$: Observable<boolean> = this.activeWorkContextId$.pipe(
    map((id) => id === TODAY_TAG.id),
    shareReplay(1),
  );

  isHasTasksToWorkOn$: Observable<boolean> = combineLatest([
    this.mainListTasks$,
    this.isTodayList$,
  ]).pipe(
    map(([tasks, isToday]) =>
      isToday ? this._filterFutureScheduledTasksForToday(tasks) : tasks,
    ),
    map(hasTasksToWorkOn),
    distinctUntilChanged(),
  );

  estimateRemainingToday$: Observable<number> = this.mainListTasks$.pipe(
    map(mapEstimateRemainingFromTasks),
    distinctUntilChanged(),
  );

  todayRemainingInProject$: Observable<number> = this.mainListTasksInProject$.pipe(
    map(mapEstimateRemainingFromTasks),
    distinctUntilChanged(),
  );

  // allNonArchiveTasks$: Observable<TaskWithSubTasks[]> = combineLatest([
  //   this.todaysTasks$,
  //   this.backlogTasks$
  // ]).pipe(
  //   map(([today, backlog]) => ([
  //     ...today,
  //     ...backlog
  //   ]))
  // );

  flatDoneTodayNr$: Observable<number> = this.mainListTasks$.pipe(
    map((tasks) => flattenTasks(tasks)),
    map((tasks) => {
      const done = tasks.filter((task) => task.isDone);
      return done.length;
    }),
    distinctUntilChanged(), // Only emit when count actually changes
  );

  undoneTasks$: Observable<TaskWithSubTasks[]> = combineLatest([
    this.mainListTasks$,
    this.isTodayList$,
  ]).pipe(
    map(([tasks, isTodayList]) =>
      (isTodayList ? this._filterFutureScheduledTasksForToday(tasks) : tasks).filter(
        (task) => task && !task.isDone,
      ),
    ),
  );

  doneTasks$: Observable<TaskWithSubTasks[]> = this.isTodayList$.pipe(
    switchMap((isToday) =>
      isToday ? this._store$.select(selectAllTasksWithSubTasks) : this.mainListTasks$,
    ),
    map((tasks) => tasks.filter((task) => task && task.isDone)),
  );

  constructor() {
    this.isTodayList$.subscribe((v) => (this.isTodayList = v));

    this.activeWorkContextTypeAndId$.subscribe((v) => {
      this.activeWorkContextId = v.activeId;
      this.activeWorkContextType = v.activeType;
    });

    this._router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe((event) => this._markNavigationStart(event.url));

    // we need all data to be loaded before we dispatch a setActiveContext action
    this._router.events
      .pipe(
        // NOTE: when we use any other router event than NavigationEnd, the changes triggered
        // by the active context may occur before the current page component is unloaded
        filter((event) => event instanceof NavigationEnd),
        withLatestFrom(this._isAllDataLoaded$),
        concatMap(([next, isAllDataLoaded]) =>
          isAllDataLoaded
            ? of(next as NavigationEnd)
            : this._isAllDataLoaded$.pipe(
                filter((isLoaded) => isLoaded),
                take(1),
                mapTo(next as NavigationEnd),
              ),
        ),
      )
      .subscribe(({ urlAfterRedirects }: NavigationEnd) => {
        this._markNavigationEnd(urlAfterRedirects);

        const split = urlAfterRedirects.split('/');
        const id = split[2];

        // prevent issue when setActiveContext is called directly
        if (this.activeWorkContextId === id) {
          return;
        }

        if (urlAfterRedirects.match(/tag\/.+/)) {
          this._setActiveContext(id, WorkContextType.TAG);
        } else if (urlAfterRedirects.match(/project\/.+/)) {
          this._setActiveContext(id, WorkContextType.PROJECT);
        } else if (urlAfterRedirects.match(/timeline/)) {
          this._setActiveContext(TODAY_TAG.id, WorkContextType.TAG);
        }
      });
  }

  // TODO could be done better
  getTimeWorkedForDay$(day: string = this._dateService.todayStr()): Observable<number> {
    return this.isTodayList$.pipe(
      switchMap((isToday) =>
        isToday
          ? this.getTimeWorkedForDayForAllNonArchiveTasks$(day)
          : this.getTimeWorkedForDayTodaysTasks$(day),
      ),
    );
  }

  async getDoneTodayInArchive(
    day: string = this._dateService.todayStr(),
  ): Promise<number> {
    const isToday = await this.isTodayList$.pipe(first()).toPromise();
    const { activeId, activeType } = await this.activeWorkContextTypeAndId$
      .pipe(first())
      .toPromise();
    // young should be enough for this
    const taskArchiveState = await this._taskArchiveService.loadYoung();

    const { ids, entities } = taskArchiveState;
    const tasksDoneToday: ArchiveTask[] = ids
      .map((id) => entities[id])
      .filter(
        (t) => !!t && !t.parentId && t.doneOn && getDbDateStr(t.doneOn) === day,
      ) as ArchiveTask[];

    let tasksToConsider: ArchiveTask[] = [];
    if (isToday) {
      tasksToConsider = tasksDoneToday;
    } else {
      if (activeType === WorkContextType.PROJECT) {
        tasksToConsider = tasksDoneToday.filter((t) => t.projectId === activeId);
      } else {
        tasksToConsider = tasksDoneToday.filter((t) => t.tagIds.includes(activeId));
      }
    }

    return tasksToConsider.length;
  }

  async getTimeWorkedForDayForTasksInArchiveYoung(
    day: string = this._dateService.todayStr(),
  ): Promise<number> {
    const isToday = await this.isTodayList$.pipe(first()).toPromise();
    const { activeId, activeType } = await this.activeWorkContextTypeAndId$
      .pipe(first())
      .toPromise();
    // young should be enough for this
    const taskArchiveState = await this._taskArchiveService.loadYoung();

    const { ids, entities } = taskArchiveState;
    const tasksWorkedOnToday: ArchiveTask[] = ids
      .map((id) => entities[id])
      .filter((t) => t?.timeSpentOnDay[day]) as ArchiveTask[];

    let tasksToConsider: ArchiveTask[] = [];
    if (isToday) {
      tasksToConsider = tasksWorkedOnToday;
    } else {
      if (activeType === WorkContextType.PROJECT) {
        tasksToConsider = tasksWorkedOnToday.filter((t) => t.projectId === activeId);
      } else {
        tasksToConsider = tasksWorkedOnToday.filter((t) => t.tagIds.includes(activeId));
      }
    }

    return getTimeSpentForDay(
      // avoid double counting parent and sub tasks
      tasksToConsider.filter((task) => !task.parentId),
      day,
    );
  }

  getTimeWorkedForDayForAllNonArchiveTasks$(day: string): Observable<number> {
    return this._store$.pipe(select(selectAllTasks)).pipe(
      map((tasks) =>
        getTimeSpentForDay(
          // Guard against undefined tasks during sync, avoid double counting parent/sub tasks
          tasks.filter((task) => task && !task.parentId),
          day,
        ),
      ),
      distinctUntilChanged(),
    );
  }

  getTimeWorkedForDayTodaysTasks$(day: string): Observable<number> {
    return this.mainListTasks$.pipe(
      map((tasks) => getTimeSpentForDay(tasks, day)),
      distinctUntilChanged(),
    );
  }

  // TODO merge this stuff
  getWorkStart$(
    day: string = this._dateService.todayStr(),
  ): Observable<number | undefined> {
    return this.activeWorkContextTTData$.pipe(map((byDateMap) => byDateMap[day]?.s));
  }

  getWorkEnd$(
    day: string = this._dateService.todayStr(),
  ): Observable<number | undefined> {
    return this.activeWorkContextTTData$.pipe(map((byDateMap) => byDateMap[day]?.e));
  }

  getBreakTime$(
    day: string = this._dateService.todayStr(),
  ): Observable<number | undefined> {
    return this.activeWorkContextTTData$.pipe(map((byDateMap) => byDateMap[day]?.bt));
  }

  getBreakNr$(
    day: string = this._dateService.todayStr(),
  ): Observable<number | undefined> {
    return this.activeWorkContextTTData$.pipe(map((byDateMap) => byDateMap[day]?.b));
  }

  async load(): Promise<void> {
    // NOTE: currently route has prevalence over everything else and as there is not state apart from
    // activeContextId, and activeContextType, we don't need to load it
    // const state = await this._pfapiService.context.loadState() || initialContextState;
    // this._store$.dispatch(loadWorkContextState({state}));
  }

  updateWorklogExportSettingsForCurrentContext(data: WorklogExportSettings): void {
    this._updateAdvancedCfgForCurrentContext('worklogExportSettings', {
      ...data,
    });
  }

  updateWorkStartForActiveContext(date: string, newVal: number): void {
    if (!this.activeWorkContextId || !this.activeWorkContextType) {
      throw new Error('Invalid active work context');
    }
    this._store$.dispatch(
      updateWorkContextData({
        ctx: { id: this.activeWorkContextId, type: this.activeWorkContextType },
        date,
        updates: { s: newVal },
      }),
    );
  }

  updateWorkEndForActiveContext(date: string, newVal: number): void {
    if (!this.activeWorkContextId || !this.activeWorkContextType) {
      throw new Error('Invalid active work context');
    }
    this._store$.dispatch(
      updateWorkContextData({
        ctx: { id: this.activeWorkContextId, type: this.activeWorkContextType },
        date,
        updates: { e: newVal },
      }),
    );
  }

  async addToBreakTimeForActiveContext(
    date: string = this._dateService.todayStr(),
    valToAdd: number,
  ): Promise<void> {
    if (!this.activeWorkContextId || !this.activeWorkContextType) {
      throw new Error('Invalid active work context');
    }
    const currentBreakTime = (await this.getBreakTime$().pipe(first()).toPromise()) || 0;
    const currentBreakNr = (await this.getBreakNr$().pipe(first()).toPromise()) || 0;

    this._store$.dispatch(
      updateWorkContextData({
        ctx: { id: this.activeWorkContextId, type: this.activeWorkContextType },
        date,
        updates: { b: currentBreakNr + 1, bt: currentBreakTime + valToAdd },
      }),
    );
  }

  async updateBreakNrForActiveContext(
    date: string = this._dateService.todayStr(),
    nrBreaks: number,
  ): Promise<void> {
    if (!this.activeWorkContextId || !this.activeWorkContextType) {
      throw new Error('Invalid active work context');
    }

    this._store$.dispatch(
      updateWorkContextData({
        ctx: { id: this.activeWorkContextId, type: this.activeWorkContextType },
        date,
        updates: { b: nrBreaks },
      }),
    );
  }

  async updateBreakTimeForActiveContext(
    date: string = this._dateService.todayStr(),
    breakTime: number,
  ): Promise<void> {
    if (!this.activeWorkContextId || !this.activeWorkContextType) {
      throw new Error('Invalid active work context');
    }

    this._store$.dispatch(
      updateWorkContextData({
        ctx: { id: this.activeWorkContextId, type: this.activeWorkContextType },
        date,
        updates: { bt: breakTime },
      }),
    );
  }

  private _updateAdvancedCfgForCurrentContext(
    sectionKey: WorkContextAdvancedCfgKey,
    data: unknown,
  ): void {
    if (this.activeWorkContextType === WorkContextType.PROJECT) {
      this._store$.dispatch(
        updateProjectAdvancedCfg({
          projectId: this.activeWorkContextId as string,
          sectionKey,
          data,
        }),
      );
    } else if (this.activeWorkContextType === WorkContextType.TAG) {
      this._store$.dispatch(
        updateAdvancedConfigForTag({
          tagId: this.activeWorkContextId as string,
          sectionKey,
          data,
        }),
      );
    }
  }

  // we don't want a circular dependency that's why we do it here...
  private _getTasksByIds$(ids: string[]): Observable<TaskWithSubTasks[]> {
    if (!Array.isArray(ids)) {
      Log.log({ ids });
      throw new Error('Invalid param provided for getByIds$ :(');
    }
    return this._store$.select(selectTasksWithSubTasksByIds, { ids });
  }

  private _filterFutureScheduledTasksForToday(
    tasks: TaskWithSubTasks[],
  ): TaskWithSubTasks[] {
    if (!tasks) {
      return [];
    }
    if (this.activeWorkContextId !== TODAY_TAG.id) {
      return tasks;
    }

    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTimestamp = todayEnd.getTime();

    return tasks.filter((task) => {
      if (!task) {
        return false;
      }
      if (
        task.dueWithTime &&
        task.dueWithTime >= now &&
        task.dueWithTime <= todayEndTimestamp
      ) {
        return false;
      }
      return true;
    });
  }

  // we don't want a circular dependency that's why we do it here...
  private _getNotesByIds$(ids: string[]): Observable<Note[]> {
    if (!Array.isArray(ids)) {
      Log.log({ ids });
      throw new Error('Invalid param provided for getByIds$ :(');
    }
    return this._store$.select(selectNotesById, { ids });
  }

  // NOTE: NEVER call this from some place other than the route change stuff
  private _setActiveContext(activeId: string, activeType: WorkContextType): void {
    this._store$.dispatch(setActiveWorkContext({ activeId, activeType }));
  }

  private _markNavigationStart(url: string): void {
    if (!this._isPerformanceApiAvailable() || !this._shouldTrackNavigation(url)) {
      return;
    }

    this._pendingNavigationUrl = url;
    performance.mark(this._navigationStartMark);
  }

  private _markNavigationEnd(url: string): void {
    if (
      !this._isPerformanceApiAvailable() ||
      !this._pendingNavigationUrl ||
      !this._shouldTrackNavigation(url)
    ) {
      return;
    }

    performance.mark(this._navigationEndMark);
    try {
      performance.measure(
        this._navigationMeasureName,
        this._navigationStartMark,
        this._navigationEndMark,
      );
    } catch {
      // ignore measure errors (e.g. start mark missing)
    } finally {
      this._clearNavigationMarks();
      this._pendingNavigationUrl = null;
    }
  }

  private _clearNavigationMarks(): void {
    if (!this._isPerformanceApiAvailable()) {
      return;
    }
    try {
      performance.clearMarks(this._navigationStartMark);
      performance.clearMarks(this._navigationEndMark);
      performance.clearMeasures(this._navigationMeasureName);
    } catch {
      // ignore cleanup errors
    }
  }

  private _shouldTrackNavigation(url: string): boolean {
    return /(tag|project)\/.+\/tasks/.test(url);
  }

  private _isPerformanceApiAvailable(): boolean {
    return (
      typeof performance !== 'undefined' &&
      typeof performance.mark === 'function' &&
      typeof performance.measure === 'function' &&
      typeof performance.clearMarks === 'function' &&
      typeof performance.clearMeasures === 'function'
    );
  }
}
