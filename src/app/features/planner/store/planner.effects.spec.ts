import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { PlannerEffects } from './planner.effects';
import { PlannerActions } from './planner.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { SnackService } from '../../../core/snack/snack.service';
import { PlannerService } from '../planner.service';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { DateService } from '../../../core/date/date.service';
import { DEFAULT_TASK, TaskCopy } from '../../tasks/task.model';
import { T } from '../../../t.const';

describe('PlannerEffects', () => {
  const LOGICAL_TODAY = '2026-01-04';
  let actions$: Subject<Action>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackService = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [
        PlannerEffects,
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: SnackService, useValue: snackService },
        {
          provide: PlannerService,
          useValue: { getSnackExtraStr: () => Promise.resolve('') },
        },
        { provide: LocaleDatePipe, useValue: { transform: (v: string) => v } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: DateService, useValue: { todayStr: () => LOGICAL_TODAY } },
      ],
    });
    TestBed.inject(PlannerEffects).planForDaySnack$.subscribe();
  });

  it('labels a task planned for the logical today as today', fakeAsync(() => {
    actions$.next(
      PlannerActions.planTaskForDay({
        task: { ...DEFAULT_TASK, id: 't1' } as TaskCopy,
        day: LOGICAL_TODAY,
        isShowSnack: true,
      }),
    );
    flushMicrotasks();

    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        translateParams: jasmine.objectContaining({ date: T.G.TODAY_TAG_TITLE }),
      }),
    );
  }));
});
