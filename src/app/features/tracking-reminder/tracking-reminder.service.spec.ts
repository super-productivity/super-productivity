import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
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
  selectTimer,
} from '../focus-mode/store/focus-mode.selectors';
import { selectIsFocusModeEnabled } from '../config/store/global-config.reducer';
import { FocusScreen, TimerState } from '../focus-mode/focus-mode.model';
import { GlobalConfigState } from '../config/global-config.model';

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
});
