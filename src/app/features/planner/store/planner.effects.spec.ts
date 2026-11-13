import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { DateService } from '../../../core/date/date.service';
import { SnackParams } from '../../../core/snack/snack.model';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { DEFAULT_TASK, TaskCopy } from '../../tasks/task.model';
import { PlannerService } from '../planner.service';
import { PlannerActions } from './planner.actions';
import { PlannerEffects } from './planner.effects';

describe('PlannerEffects', () => {
  let actions$: Subject<Action>;
  let snackService: jasmine.SpyObj<SnackService>;
  let dateService: DateService;

  const task: TaskCopy = { ...DEFAULT_TASK, id: 'task-1', projectId: 'project-1' };

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const plannerService = jasmine.createSpyObj<PlannerService>('PlannerService', [
      'getSnackExtraStr',
    ]);
    plannerService.getSnackExtraStr.and.resolveTo('');

    TestBed.configureTestingModule({
      providers: [
        PlannerEffects,
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: SnackService, useValue: snackService },
        { provide: PlannerService, useValue: plannerService },
        {
          provide: LocaleDatePipe,
          useValue: { transform: (day: string) => `formatted ${day}` },
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => `translated ${key}` },
        },
      ],
    });

    TestBed.inject(PlannerEffects).planForDaySnack$.subscribe();
    dateService = TestBed.inject(DateService);
  });

  afterEach(() => {
    actions$.complete();
  });

  describe('planForDaySnack$', () => {
    const snackDateFor = async (day: string): Promise<unknown> => {
      const opened = new Promise<SnackParams>((resolve) =>
        snackService.open.and.callFake((params) => resolve(params as SnackParams)),
      );
      actions$.next(PlannerActions.planTaskForDay({ task, day, isShowSnack: true }));
      return (await opened).translateParams?.date;
    };

    describe('at 02:00 on June 16 with the next day starting at 04:00', () => {
      beforeEach(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(2026, 5, 16, 2, 0));
        dateService.setStartOfNextDayDiff('04:00');
      });

      afterEach(() => {
        jasmine.clock().uninstall();
      });

      it('calls logical today (June 15) Today, though the calendar says June 16', async () => {
        expect(await snackDateFor('2026-06-15')).toBe(
          `translated ${T.G.TODAY_TAG_TITLE}`,
        );
      });

      it('shows a date for June 16, which is logical tomorrow', async () => {
        expect(await snackDateFor('2026-06-16')).toBe('formatted 2026-06-16');
      });
    });
  });
});
