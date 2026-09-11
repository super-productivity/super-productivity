import { TestBed } from '@angular/core/testing';
import { DialogScheduleTaskComponent } from './dialog-schedule-task.component';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TaskService } from '../../tasks/task.service';
import { ReminderService } from '../../reminder/reminder.service';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateAdapter } from '@angular/material/core';
import { TaskCopy } from '../../tasks/task.model';
import {
  selectAllTasksWithDueTimeSorted,
  selectTaskById,
} from '../../tasks/store/task.selectors';
import { selectTimelineConfig } from '../../config/store/global-config.reducer';
import { selectTaskRepeatCfgByIdAllowUndefined } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Covers the recurrence surface added to the schedule dialog: the `canRepeat`
 * gating (including the isSelectDueOnly circular-picker guard) and `openRepeatDialog`
 * seeding from the LIVE task (regression guard against creating a duplicate cfg when
 * re-opened after a repeat was just added).
 */
describe('DialogScheduleTaskComponent — repeat button', () => {
  let matDialogSpy: jasmine.SpyObj<MatDialog>;

  const baseTask = (partial: Partial<TaskCopy> = {}): TaskCopy =>
    ({
      id: 'task-1',
      title: 'T',
      tagIds: [],
      projectId: 'DEFAULT',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      created: 1640995200000,
      subTaskIds: [],
      ...partial,
    }) as TaskCopy;

  const setup = async (
    data: Record<string, unknown>,
    opts: {
      liveTask?: TaskCopy;
      liveTask$?: Observable<TaskCopy | null>;
      repeatDialogResult?: string;
    } = {},
  ): Promise<DialogScheduleTaskComponent> => {
    const task = data['task'] as TaskCopy | undefined;
    const liveTask = opts.liveTask ?? task ?? null;
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'scheduleTask',
      'getByIdLive$',
    ]);
    taskServiceSpy.getByIdLive$.and.returnValue(opts.liveTask$ ?? of(liveTask));
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    matDialogSpy.open.and.returnValue({
      afterClosed: () => of(opts.repeatDialogResult),
    } as MatDialogRef<unknown, string | undefined>);
    spyOn(DialogScheduleTaskComponent.prototype, 'ngAfterViewInit').and.stub();

    await TestBed.configureTestingModule({
      imports: [
        DialogScheduleTaskComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({
          initialState: {},
          selectors: [
            { selector: selectAllTasksWithDueTimeSorted, value: [] },
            { selector: selectTimelineConfig, value: null },
            { selector: selectTaskById, value: liveTask },
            { selector: selectTaskRepeatCfgByIdAllowUndefined, value: undefined },
          ],
        }),
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj('ReminderService', ['getById']),
        },
        {
          provide: DateService,
          useValue: {
            isToday: () => false,
            todayStr: () => '2026-05-26',
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
        LocaleDatePipe,
      ],
    })
      .overrideComponent(DialogScheduleTaskComponent, { set: { template: '' } })
      .compileComponents();

    return TestBed.createComponent(DialogScheduleTaskComponent).componentInstance;
  };

  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
    TestBed.resetTestingModule();
  });

  describe('canRepeat gating', () => {
    it('is true for a top-level, non-issue task', async () => {
      const c = await setup({ task: baseTask() });
      expect(c.canRepeat).toBe(true);
    });

    it('is false for a subtask', async () => {
      const c = await setup({ task: baseTask({ parentId: 'parent-1' }) });
      expect(c.canRepeat).toBe(false);
    });

    it('is false for an issue task', async () => {
      const c = await setup({ task: baseTask({ issueId: 'ISSUE-1' }) });
      expect(c.canRepeat).toBe(false);
    });

    it('is false in isSelectDueOnly mode (avoids the circular repeat picker)', async () => {
      const c = await setup({ task: baseTask(), isSelectDueOnly: true });
      expect(c.canRepeat).toBe(false);
    });

    it('is false when there is no task', async () => {
      const c = await setup({ targetDay: '2026-05-26' });
      expect(c.canRepeat).toBe(false);
    });
  });

  describe('repeatCfgLabel', () => {
    it('is null when the task has no repeat cfg', async () => {
      const c = await setup({ task: baseTask() });
      expect(c.repeatCfgLabel()).toBeNull();
    });
  });

  describe('openRepeatDialog', () => {
    it('keeps confirmation for a config that appeared in live state', async () => {
      const staleSnapshot = baseTask();
      const liveTask = baseTask({ repeatCfgId: 'cfg-1' });
      const c = await setup({ task: staleSnapshot }, { liveTask });

      await c.openRepeatDialog();

      expect(matDialogSpy.open).toHaveBeenCalledTimes(1);
      const dialogArg = matDialogSpy.open.calls.mostRecent().args[1] as {
        data: {
          task: TaskCopy;
          targetDate: string;
          initialStartDate: string;
          isRemoveConfirmationRequired: boolean;
        };
      };
      expect(dialogArg.data.task).toBe(liveTask);
      expect(dialogArg.data.task.repeatCfgId).toBe('cfg-1');
      expect(dialogArg.data.targetDate).toBe(getDbDateStr(new Date(liveTask.created)));
      expect(dialogArg.data.isRemoveConfirmationRequired).toBeTrue();
    });

    it('passes the currently selected date as the initial recurrence date', async () => {
      const task = baseTask({ dueDay: '2026-05-20' });
      const c = await setup({ task });
      c.selectedDate = new Date(2026, 4, 27);

      await c.openRepeatDialog();

      const dialogArg = matDialogSpy.open.calls.mostRecent().args[1] as {
        data: { initialStartDate: string; targetDate: string };
      };
      expect(dialogArg.data.initialStartDate).toBe('2026-05-27');
      expect(dialogArg.data.targetDate).toBe('2026-05-27');
    });

    it('falls back to the task creation date when no schedule date is selected', async () => {
      const task = baseTask({ created: new Date(2024, 2, 14).getTime() });
      const c = await setup({ task });

      await c.openRepeatDialog();

      const dialogArg = matDialogSpy.open.calls.mostRecent().args[1] as {
        data: { initialStartDate: string };
      };
      expect(dialogArg.data.initialStartDate).toBe('2024-03-14');
    });

    it('suppresses confirmation only for the exact config created by this dialog', async () => {
      const liveTask$ = new BehaviorSubject<TaskCopy | null>(baseTask());
      const c = await setup(
        { task: baseTask() },
        { liveTask$, repeatDialogResult: 'cfg-created-here' },
      );

      await c.openRepeatDialog();
      liveTask$.next(baseTask({ repeatCfgId: 'cfg-created-here' }));
      await c.openRepeatDialog();

      const dialogArg = matDialogSpy.open.calls.mostRecent().args[1] as {
        data: { isRemoveConfirmationRequired: boolean };
      };
      expect(dialogArg.data.isRemoveConfirmationRequired).toBeFalse();
    });

    it('keeps remove confirmation when the task was already repeating on open', async () => {
      const repeatingTask = baseTask({ repeatCfgId: 'cfg-1' });
      const c = await setup({ task: repeatingTask }, { liveTask: repeatingTask });

      await c.openRepeatDialog();

      const dialogArg = matDialogSpy.open.calls.mostRecent().args[1] as {
        data: { isRemoveConfirmationRequired: boolean };
      };
      expect(dialogArg.data.isRemoveConfirmationRequired).toBeTrue();
    });
  });
});
