import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_TASK, Task, TaskReminderOptionId } from '../task.model';
import { DialogDeadlineComponent } from './dialog-deadline.component';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigService } from '../../config/global-config.service';

/**
 * Cover reminder initialization, logical-day shortcuts and submission validation.
 * The calendar template is omitted so these tests exercise the dialog's state
 * and dispatched values without depending on Material rendering.
 */
describe('DialogDeadlineComponent', () => {
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let matDialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogDeadlineComponent>>;

  type SetDeadlineProps = {
    taskId: string;
    deadlineDay?: string;
    deadlineWithTime?: number;
    deadlineRemindAt?: number;
    autoPlanToday?: string;
    autoPlanStartOfNextDayDiffMs?: number;
  };

  const buildTask = (id = 'task-1'): Task =>
    ({ ...DEFAULT_TASK, id, title: 'Test', dueDay: '2026-05-06' }) as Task;

  const setDeadlineCalls = (): SetDeadlineProps[] =>
    dispatchSpy.calls
      .allArgs()
      .map(([action]) => action as SetDeadlineProps & { type: string })
      .filter((a) => a.type === TaskSharedActions.setDeadline.type);

  const createComponent = (task: Task = buildTask()): DialogDeadlineComponent => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { task } });
    // Inject the store after the override is in place — TestBed locks
    // overrides on the first inject/createComponent call.
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    const fixture = TestBed.createComponent(DialogDeadlineComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  const createSelectOnlyComponent = (): DialogDeadlineComponent => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, {
      useValue: {
        isSelectDeadlineOnly: true,
        targetDeadlineRemindOption: TaskReminderOptionId.DoNotRemind,
      },
    });
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    const fixture = TestBed.createComponent(DialogDeadlineComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    matDialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    await TestBed.configureTestingModule({
      imports: [DialogDeadlineComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore({ initialState: {} }),
        { provide: MatDialogRef, useValue: matDialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { task: buildTask() } },
        {
          provide: DateService,
          useValue: {
            isToday: () => false,
            todayStr: () => '2026-05-06',
            getStartOfNextDayDiffMs: () => 0,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => undefined, cfg: () => undefined },
        },
        {
          provide: DateAdapter,
          useValue: { getFirstDayOfWeek: () => 1, getDayOfWeek: () => 1 },
        },
        TranslateService,
        TranslateStore,
      ],
    })
      // Stub the template so MatCalendar (and its DateAdapter wiring beyond
      // what we provide) isn't instantiated. Initialization and submission
      // still run, without rendering the calendar.
      .overrideComponent(DialogDeadlineComponent, { set: { template: '' } })
      .compileComponents();
  });

  [
    { label: 'absent', hasDeadline: true, hasReminder: false },
    { label: 'enabled', hasDeadline: true, hasReminder: true },
    { label: 'new deadline default', hasDeadline: false, hasReminder: false },
  ].forEach(({ label, hasDeadline, hasReminder }) => {
    it(`preserves the ${label} reminder choice when saving a new deadline time`, () => {
      const deadline = new Date(2030, 5, 16, 15).getTime();
      const component = createComponent({
        ...buildTask(),
        deadlineWithTime: hasDeadline ? deadline : undefined,
        deadlineRemindAt: hasReminder ? deadline : undefined,
      });
      const expectedOption =
        hasDeadline && !hasReminder
          ? TaskReminderOptionId.DoNotRemind
          : TaskReminderOptionId.AtStart;
      expect(component.selectedReminderCfgId).toBe(expectedOption);

      component.selectedDate = new Date(deadline);
      component.selectedTime = '16:00';
      component.submit();

      const [action] = setDeadlineCalls();
      expect(setDeadlineCalls().length).toBe(1);
      expect(action.deadlineWithTime).toBe(new Date(2030, 5, 16, 16).getTime());
      expect(action.deadlineRemindAt).toBe(
        expectedOption === TaskReminderOptionId.DoNotRemind
          ? undefined
          : action.deadlineWithTime,
      );
    });
  });

  [
    { now: new Date(2030, 5, 17, 2), quick: 'today', day: '2030-06-16' },
    { now: new Date(2030, 5, 17, 2), quick: 'tomorrow', day: '2030-06-17' },
    // Berlin's spring-forward and fall-back dates. Calendar-day advancement
    // must still produce the right date when the elapsed day is not 24 hours.
    { now: new Date(2030, 2, 31, 2), quick: 'tomorrow', day: '2030-03-31' },
    { now: new Date(2030, 9, 27, 2), quick: 'tomorrow', day: '2030-10-27' },
  ].forEach(({ now, quick, day }) => {
    it(`saves logical ${quick} as ${day} before the 04:00 day start`, () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(now);
      try {
        const dateService = new DateService();
        dateService.setStartOfNextDayDiff('04:00');
        TestBed.overrideProvider(DateService, { useValue: dateService });
        const component = createComponent();

        component.onQuickAccessClick(quick as 'today' | 'tomorrow');

        const [action] = setDeadlineCalls();
        expect(setDeadlineCalls().length).toBe(1);
        expect(action.deadlineDay).toBe(day);
        expect(action.deadlineWithTime).toBeUndefined();
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  it('dispatches setDeadline with deadlineWithTime for a valid HH:MM time', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 6);
    component.selectedTime = '14:30';

    component.submit();

    const calls = setDeadlineCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].deadlineWithTime).toBeDefined();
    expect(calls[0].deadlineDay).toBeUndefined();
    expect(calls[0].autoPlanToday).toBe('2026-05-06');
    expect(matDialogRefSpy.close).toHaveBeenCalled();
  });

  it('dispatches setDeadline with deadlineDay when no time is provided', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 6);
    component.selectedTime = null;

    component.submit();

    const calls = setDeadlineCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].deadlineDay).toBe('2026-05-06');
    expect(calls[0].deadlineWithTime).toBeUndefined();
    expect(calls[0].autoPlanToday).toBe('2026-05-06');
  });

  // Mirrors the non-select-only parameterized test below — same garbage
  // inputs must round-trip to `time: null` instead of throwing or persisting
  // a malformed string back to the caller.
  ['abc', '13:60', '25:00'].forEach((badTime) => {
    it(`returns null time for malformed select-only deadline time "${badTime}"`, () => {
      const component = createSelectOnlyComponent();
      component.selectedDate = new Date(2026, 4, 6);
      component.selectedTime = badTime;

      expect(() => component.submit()).not.toThrow();

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(matDialogRefSpy.close).toHaveBeenCalledWith({
        date: component.selectedDate,
        time: null,
        remindOption: TaskReminderOptionId.DoNotRemind,
      });
    });
  });

  // Proves issue #7490. submit() must not throw on a malformed selectedTime and
  // must fall back to a date-only deadline for genuinely invalid values.
  // Note: '1:' is intentionally NOT in this list — isValidSplitTime parses it
  // as 1:00 (split[1] is '', +'' === 0), so it never throws. That's arguably a
  // separate UX issue but not the crash this test pins.
  // '13:30:00' is also NOT here — a stray seconds component is recoverable and
  // must persist (see the test below); only true garbage drops the time.
  ['abc', '13:60', '25:00'].forEach((badTime) => {
    it(`does NOT throw and falls back to deadlineDay for malformed selectedTime "${badTime}"`, () => {
      const component = createComponent();
      component.selectedDate = new Date(2026, 4, 6);
      component.selectedTime = badTime;

      expect(() => component.submit()).not.toThrow();

      const calls = setDeadlineCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].deadlineDay).toBe('2026-05-06');
      expect(calls[0].deadlineWithTime).toBeUndefined();
    });
  });

  // Repro for #7802 — a user-set time was silently dropped instead of saved.
  // A stray seconds component (e.g. `13:30:00` pasted into the time input) must
  // be normalized to `13:30` and persisted as deadlineWithTime, not discarded.
  it('persists a normalized deadlineWithTime for a "13:30:00" selectedTime', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 6);
    component.selectedTime = '13:30:00';

    expect(() => component.submit()).not.toThrow();

    const calls = setDeadlineCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].deadlineDay).toBeUndefined();
    expect(calls[0].deadlineWithTime).toBeDefined();
    const d = new Date(calls[0].deadlineWithTime as number);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(30);
  });

  it('does nothing (no dispatch) when no date is selected', () => {
    const component = createComponent();
    component.selectedDate = null;
    component.selectedTime = '14:30';

    component.submit();

    expect(setDeadlineCalls().length).toBe(0);
    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
  });
});
