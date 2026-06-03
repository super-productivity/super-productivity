import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_TASK, Task } from '../task.model';
import { DialogDeadlineComponent } from './dialog-deadline.component';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigService } from '../../config/global-config.service';

/**
 * Pinning + repro tests for DialogDeadlineComponent.submit().
 *
 * The third test reproduces issue #7490 — submit() throws "Invalid clock string"
 * whenever `selectedTime` is non-empty but fails `isValidSplitTime` (e.g. an
 * `HH:MM:SS` value pasted into the time input, or a partial value committed
 * before validation). The dialog has no defensive guard around
 * getDateTimeFromClockString, so the error escapes to the global handler.
 */
describe('DialogDeadlineComponent.submit() input validation', () => {
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
    return TestBed.createComponent(DialogDeadlineComponent).componentInstance;
  };

  beforeEach(async () => {
    matDialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    // ngAfterViewInit reads viewChild.required(MatCalendar). With the template
    // stubbed there is no calendar — skip the hook and test submit() in isolation.
    spyOn(DialogDeadlineComponent.prototype, 'ngAfterViewInit').and.stub();

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
      // what we provide) isn't instantiated. These tests only exercise
      // submit() and never render the calendar.
      .overrideComponent(DialogDeadlineComponent, { set: { template: '' } })
      .compileComponents();
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
