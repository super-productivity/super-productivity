import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { DEFAULT_TASK, Task } from '../task.model';
import { TaskService } from '../task.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DialogTimeEstimateComponent } from './dialog-time-estimate.component';

const OTHER_DAY = '2026-10-01';

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
      ],
    })
      .overrideTemplate(DialogTimeEstimateComponent, '')
      .compileComponents();
  });

  it('saves a changed estimate when tapping outside', () => {
    const cmp = createComponent();
    cmp.taskCopy.timeEstimate = 120000;

    backdropClick$.next(new MouseEvent('click'));

    expect(taskService.update).toHaveBeenCalledWith('task-1', {
      timeEstimate: 120000,
      timeSpentOnDay: { [OTHER_DAY]: 1000 },
    });
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('saves changed time spent when tapping outside', () => {
    const cmp = createComponent();
    cmp.timeSpentOnDayCopy[cmp.todayStr] = 5000;

    backdropClick$.next(new MouseEvent('click'));

    expect(taskService.update).toHaveBeenCalledTimes(1);
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
});
