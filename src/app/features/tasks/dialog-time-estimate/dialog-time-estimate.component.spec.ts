import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { DEFAULT_TASK, Task } from '../task.model';
import { TaskService } from '../task.service';
import { selectTaskEntities } from '../store/task.selectors';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DateService } from '../../../core/date/date.service';
import { DialogTimeEstimateComponent } from './dialog-time-estimate.component';

const OTHER_DAY = '2026-10-01';
const EARLIER_DAY = '2026-09-30';

describe('DialogTimeEstimateComponent closing (#10823)', () => {
  let backdropClick$: Subject<MouseEvent>;
  let keydown$: Subject<KeyboardEvent>;
  let dialogRef: { disableClose: boolean; close: jasmine.Spy } & Record<string, unknown>;
  let taskService: jasmine.SpyObj<TaskService>;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'task-1',
    title: 'Test',
    projectId: 'p1',
    timeEstimate: 60000,
    timeSpentOnDay: { [OTHER_DAY]: 1000 },
  } as Task;

  const createComponent = (): DialogTimeEstimateComponent =>
    TestBed.createComponent(DialogTimeEstimateComponent).componentInstance;

  // Tracking adds to today in the store while the dialog is open.
  const trackWhileOpen = (todayStr: string): void => {
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectTaskEntities, {
      [task.id]: { ...task, timeSpentOnDay: { [OTHER_DAY]: 1000, [todayStr]: 9000 } },
    });
    store.refreshState();
  };

  beforeEach(async () => {
    backdropClick$ = new Subject();
    keydown$ = new Subject();
    dialogRef = {
      disableClose: false,
      close: jasmine.createSpy('close'),
      backdropClick: () => backdropClick$,
      keydownEvents: () => keydown$,
    };
    taskService = jasmine.createSpyObj('TaskService', ['update']);

    await TestBed.configureTestingModule({
      imports: [DialogTimeEstimateComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { task } },
        { provide: MatDialog, useValue: {} },
        { provide: TaskService, useValue: taskService },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en' } },
        provideMockStore({
          selectors: [{ selector: selectTaskEntities, value: { [task.id]: task } }],
        }),
      ],
    })
      .overrideTemplate(DialogTimeEstimateComponent, '')
      .compileComponents();
  });

  it('saves a changed estimate when tapping outside', () => {
    const cmp = createComponent();
    cmp.taskCopy.timeEstimate = 120000;

    backdropClick$.next(new MouseEvent('click'));

    // Unedited time spent is left out, so time tracked meanwhile is kept.
    expect(taskService.update).toHaveBeenCalledOnceWith('task-1', {
      timeEstimate: 120000,
    });
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('saves changed time spent when tapping outside', () => {
    const cmp = createComponent();
    trackWhileOpen(cmp.todayStr);
    cmp.timeSpentOnDayCopy[cmp.todayStr] = 5000;

    backdropClick$.next(new MouseEvent('click'));

    // An edited day wins over time tracked meanwhile.
    expect(taskService.update).toHaveBeenCalledOnceWith('task-1', {
      timeEstimate: 60000,
      timeSpentOnDay: { [OTHER_DAY]: 1000, [cmp.todayStr]: 5000 },
    });
  });

  it('keeps time tracked while open when other days are edited', () => {
    const cmp = createComponent();
    trackWhileOpen(cmp.todayStr);

    cmp.deleteValue(OTHER_DAY);
    cmp.timeSpentOnDayCopy[EARLIER_DAY] = 2000;
    cmp.submit();

    const timeSpentOnDay = { [cmp.todayStr]: 9000, [EARLIER_DAY]: 2000 };
    expect(taskService.update).toHaveBeenCalledOnceWith('task-1', {
      timeEstimate: 60000,
      timeSpentOnDay,
    });
    expect(dialogRef.close).toHaveBeenCalledOnceWith({
      timeEstimate: 60000,
      timeSpentOnDay,
    });
  });

  it('closes without an update when tapping outside unchanged', () => {
    const cmp = createComponent();
    // A zero for today equals no entry, so it is not a change.
    cmp.timeSpentOnDayCopy[cmp.todayStr] = 0;

    backdropClick$.next(new MouseEvent('click'));

    expect(taskService.update).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('discards changes on Escape', () => {
    const cmp = createComponent();
    cmp.taskCopy.timeEstimate = 120000;

    keydown$.next(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(taskService.update).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('takes over closing from the default dialog handling', () => {
    createComponent();

    expect(dialogRef.disableClose).toBeTrue();
  });

  describe('before a 04:00 day start', () => {
    // 02:00 on 2026-10-02 still belongs to the logical day 2026-10-01.
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 9, 2, 2));
      TestBed.inject(DateService).setStartOfNextDayDiff('04:00');
    });

    afterEach(() => jasmine.clock().uninstall());

    it('shows the time tracked on the logical day as today', () => {
      const cmp = createComponent();

      expect(cmp.todayStr).toBe(OTHER_DAY);
      expect(cmp.timeSpentOnDayCopy[cmp.todayStr]).toBe(1000);
    });
  });
});
