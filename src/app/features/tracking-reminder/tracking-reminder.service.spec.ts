import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { BehaviorSubject, Subject } from 'rxjs';
import { TrackingReminderService } from './tracking-reminder.service';
import { IdleService } from '../idle/idle.service';
import { TaskService } from '../tasks/task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { BannerService } from '../../core/banner/banner.service';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { DateService } from '../../core/date/date.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { NotifyService } from '../../core/notify/notify.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import {
  selectCurrentScreen,
  selectMode,
  selectTimer,
} from '../focus-mode/store/focus-mode.selectors';
import { selectIsFocusModeEnabled } from '../config/store/global-config.reducer';
import { FocusModeMode, FocusScreen, TimerState } from '../focus-mode/focus-mode.model';
import { GlobalConfigState } from '../config/global-config.model';
import {
  adjustRemainingTime,
  startFocusSession,
  tick as focusTick,
} from '../focus-mode/store/focus-mode.actions';
import {
  focusModeReducer,
  initialState as initialFocusState,
} from '../focus-mode/store/focus-mode.reducer';
import { selectTimeRemaining } from '../focus-mode/store/focus-mode.selectors';
import { DEFAULT_TASK, Task } from '../tasks/task.model';

const TRACKING_REMINDER_MIN_TIME = 5000;

const createMockTimer = (overrides: Partial<TimerState> = {}): TimerState => ({
  isRunning: false,
  startedAt: null,
  elapsed: 0,
  duration: 0,
  purpose: null,
  ...overrides,
});

const createMockCfg = (overrides: Partial<GlobalConfigState> = {}): GlobalConfigState =>
  ({
    timeTracking: {
      isTrackingReminderEnabled: true,
      isTrackingReminderShowOnMobile: true,
      trackingReminderMinTime: TRACKING_REMINDER_MIN_TIME,
      isAutoStartNextTask: false,
      isNotifyWhenTimeEstimateExceeded: false,
    },
    ...overrides,
  }) as any;

describe('TrackingReminderService', () => {
  let service: TrackingReminderService;
  let store: MockStore;
  let currentTaskId$: BehaviorSubject<string | null>;
  let isIdle$: BehaviorSubject<boolean>;
  let cfg$: BehaviorSubject<GlobalConfigState>;
  let sound$: BehaviorSubject<any>;

  beforeEach(() => {
    currentTaskId$ = new BehaviorSubject<string | null>(null);
    isIdle$ = new BehaviorSubject<boolean>(false);
    cfg$ = new BehaviorSubject<GlobalConfigState>(createMockCfg());
    sound$ = new BehaviorSubject<any>({ volume: 75 });

    TestBed.configureTestingModule({
      providers: [
        TrackingReminderService,
        provideMockStore({
          selectors: [
            { selector: selectIsFocusModeEnabled, value: false },
            { selector: selectTimer, value: createMockTimer() },
            { selector: selectMode, value: FocusModeMode.Pomodoro },
            { selector: selectCurrentScreen, value: FocusScreen.Main },
          ],
        }),
        {
          provide: IdleService,
          useValue: { isIdle$: isIdle$.asObservable() },
        },
        {
          provide: TaskService,
          useValue: { currentTaskId$: currentTaskId$.asObservable() },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg$: cfg$.asObservable(), sound$: sound$.asObservable() },
        },
        {
          provide: BannerService,
          useValue: {
            open: jasmine.createSpy('open'),
            dismiss: jasmine.createSpy('dismiss'),
          },
        },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        {
          provide: TranslateService,
          useValue: {
            instant: jasmine.createSpy('instant').and.callFake((k: string) => k),
          },
        },
        { provide: DateService, useValue: { todayStr: () => '2024-01-19' } },
        {
          provide: TakeABreakService,
          useValue: { otherNoBreakTIme$: new BehaviorSubject<number>(0) },
        },
        {
          provide: NotifyService,
          useValue: { notify: jasmine.createSpy('notify') },
        },
        {
          provide: UiHelperService,
          useValue: {
            focusAppAfterNotification: jasmine.createSpy('focusAppAfterNotification'),
          },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    service = TestBed.inject(TrackingReminderService);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('accepting untracked time (#4000)', () => {
    const untrackedTime = 5 * 60 * 1000;
    let dialogResult$: Subject<{ task?: Task | string } | undefined>;
    let taskService: jasmine.SpyObj<TaskService>;
    let dispatch: jasmine.Spy;
    let focusState = initialFocusState;

    beforeEach(() => {
      dialogResult$ = new Subject();
      const dialog = TestBed.inject(MatDialog);
      dialog.open = jasmine.createSpy('open').and.returnValue({
        afterClosed: () => dialogResult$,
      });
      taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.add = jasmine.createSpy('add').and.returnValue('new-task');
      taskService.addTimeSpentAndSync = jasmine.createSpy('addTimeSpentAndSync');
      taskService.setCurrentId = jasmine.createSpy('setCurrentId').and.callFake(() => {
        // Tracking starts/resumes the timer before the reminder adjusts it.
        focusState = focusModeReducer(
          { ...initialFocusState, mode: FocusModeMode.Pomodoro },
          startFocusSession({ duration: 25 * 60 * 1000 }),
        );
        store.overrideSelector(selectTimer, focusState.timer);
        store.refreshState();
      });
      dispatch = spyOn(store, 'dispatch');
      dispatch.and.callFake((action: Action) => {
        focusState = focusModeReducer(focusState, action);
        store.overrideSelector(selectTimer, focusState.timer);
        store.refreshState();
      });
      store.overrideSelector(selectIsFocusModeEnabled, true);
      store.refreshState();
      service._counter$ = new BehaviorSubject(untrackedTime);
      service.init();
      const banner = TestBed.inject(BannerService);
      (banner.open as jasmine.Spy).calls.mostRecent().args[0].action.fn();
    });

    it('subtracts the accepted time after a new task starts its Pomodoro', () => {
      dialogResult$.next({ task: 'New task' });

      expect(taskService.add).toHaveBeenCalledWith('New task', false, {
        timeSpent: untrackedTime,
        timeSpentOnDay: { [TestBed.inject(DateService).todayStr()]: untrackedTime },
      });
      expect(taskService.setCurrentId).toHaveBeenCalledWith('new-task');
      expect(dispatch).toHaveBeenCalledOnceWith(
        adjustRemainingTime({ amountMs: -untrackedTime }),
      );
      expect(taskService.setCurrentId).toHaveBeenCalledBefore(dispatch);
      expect(
        selectTimeRemaining.projector(
          focusState.timer.elapsed,
          focusState.timer.duration,
        ),
      ).toBe(20 * 60 * 1000);
      spyOn(Date, 'now').and.returnValue(focusState.timer.startedAt! + 1000);
      focusState = focusModeReducer(focusState, focusTick());
      expect(
        selectTimeRemaining.projector(
          focusState.timer.elapsed,
          focusState.timer.duration,
        ),
      ).toBe(1_199_000);
    });

    it('subtracts the accepted time when resuming an existing task', () => {
      const task = { ...DEFAULT_TASK, id: 'existing-task', projectId: 'project' };
      dialogResult$.next({ task });

      expect(taskService.addTimeSpentAndSync).toHaveBeenCalledWith(task, untrackedTime);
      expect(taskService.setCurrentId).toHaveBeenCalledWith(task.id);
      expect(dispatch).toHaveBeenCalledOnceWith(
        adjustRemainingTime({ amountMs: -untrackedTime }),
      );
    });

    for (const mode of [FocusModeMode.Countdown, FocusModeMode.Flowtime]) {
      it(`does not change ${mode} timers`, () => {
        store.overrideSelector(selectMode, mode);
        store.refreshState();
        dialogResult$.next({ task: 'New task' });

        expect(dispatch).not.toHaveBeenCalled();
      });
    }

    it('does not adjust a timer when focus mode is disabled', () => {
      store.overrideSelector(selectIsFocusModeEnabled, false);
      store.refreshState();
      dialogResult$.next({ task: 'New task' });

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not start a Pomodoro if automatic session start is disabled', () => {
      taskService.setCurrentId.and.stub();
      dialogResult$.next({ task: 'New task' });

      expect(dispatch).not.toHaveBeenCalled();
      expect(taskService.setCurrentId).toHaveBeenCalledWith('new-task');
    });

    it('does not adjust a paused break', () => {
      taskService.setCurrentId.and.stub();
      store.overrideSelector(
        selectTimer,
        createMockTimer({ purpose: 'break', duration: 5 * 60 * 1000 }),
      );
      store.refreshState();
      dialogResult$.next({ task: 'New task' });

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not change task or Pomodoro time when dismissed', () => {
      dialogResult$.next(undefined);

      expect(taskService.add).not.toHaveBeenCalled();
      expect(taskService.addTimeSpentAndSync).not.toHaveBeenCalled();
      expect(taskService.setCurrentId).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('never leaves negative remaining time when the whole session was untracked', () => {
      service._counter$ = new BehaviorSubject(30 * 60 * 1000);
      service._manualReset$.next();
      dialogResult$.next({ task: 'New task' });

      expect(
        selectTimeRemaining.projector(
          focusState.timer.elapsed,
          focusState.timer.duration,
        ),
      ).toBe(0);
      focusState = focusModeReducer(focusState, focusTick());
      expect(focusState.timer.isRunning).toBeFalse();
    });
  });

  it('emits when focus mode is disabled and no current task', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, false);
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 1000);
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBeGreaterThan(TRACKING_REMINDER_MIN_TIME);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is suppressed during active work session', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(
      selectTimer,
      createMockTimer({ purpose: 'work', isRunning: true }),
    );
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 2000);
    expect(values.length).toBe(0);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is suppressed during break', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(
      selectTimer,
      createMockTimer({ purpose: 'break', isRunning: true }),
    );
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 2000);
    expect(values.length).toBe(0);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is suppressed on SessionDone screen', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(selectTimer, createMockTimer({ purpose: null }));
    store.overrideSelector(selectCurrentScreen, FocusScreen.SessionDone);
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 2000);
    expect(values.length).toBe(0);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is not suppressed when focus mode enabled but idle (back to planning)', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(selectTimer, createMockTimer({ purpose: null }));
    store.overrideSelector(selectCurrentScreen, FocusScreen.Main);
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 1000);
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBeGreaterThan(TRACKING_REMINDER_MIN_TIME);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is not suppressed when work session is paused', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(
      selectTimer,
      createMockTimer({ purpose: 'work', isRunning: false }),
    );
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 1000);
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBeGreaterThan(TRACKING_REMINDER_MIN_TIME);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));

  it('is not suppressed when break is paused', fakeAsync(() => {
    store.overrideSelector(selectIsFocusModeEnabled, true);
    store.overrideSelector(
      selectTimer,
      createMockTimer({ purpose: 'break', isRunning: false }),
    );
    store.refreshState();

    const values: number[] = [];
    const sub = service.remindCounter$.subscribe((v) => values.push(v));

    tick(TRACKING_REMINDER_MIN_TIME + 1000);
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBeGreaterThan(TRACKING_REMINDER_MIN_TIME);

    sub.unsubscribe();
    discardPeriodicTasks();
  }));
});
