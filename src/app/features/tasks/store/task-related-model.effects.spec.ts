import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { TaskRelatedModelEffects } from './task-related-model.effects';
import { GlobalConfigService } from '../../config/global-config.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { DEFAULT_TASK, Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { DateService } from '../../../core/date/date.service';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';

describe('TaskRelatedModelEffects', () => {
  let effects: TaskRelatedModelEffects;
  let actions$: Subject<Action>;
  let store: MockStore;
  let dateService: jasmine.SpyObj<DateService>;

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  beforeEach(() => {
    actions$ = new Subject<Action>();

    const hydrationStateServiceSpy = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
    ]);
    hydrationStateServiceSpy.isApplyingRemoteOps.and.returnValue(false);
    const dateServiceSpy = jasmine.createSpyObj<DateService>('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateServiceSpy.todayStr.and.returnValue(getDbDateStr());
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        TaskRelatedModelEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectTodayTaskIds, value: [] }],
        }),
        { provide: DateService, useValue: dateServiceSpy },
        {
          provide: GlobalConfigService,
          useValue: {
            tasks$: of({ isAutoAddWorkedOnToToday: true }),
          },
        },
        { provide: HydrationStateService, useValue: hydrationStateServiceSpy },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(TaskRelatedModelEffects);
    store = TestBed.inject(MockStore);
    dateService = TestBed.inject(DateService) as jasmine.SpyObj<DateService>;
  });

  afterEach(() => {
    store.resetSelectors();
    actions$.complete();
  });

  describe('autoAddTodayTagOnTracking', () => {
    const dispatchAddTimeSpent = (task: Task): void => {
      actions$.next(
        TimeTrackingActions.addTimeSpent({
          task,
          date: dateService.todayStr(),
          duration: 1000,
          isFromTrackingReminder: false,
        }),
      );
    };

    it('should dispatch planTasksForToday when tracking an unscheduled task', (done) => {
      const task = createTask('task-1', {
        dueDay: undefined,
        dueWithTime: undefined,
      });

      effects.autoAddTodayTagOnTracking.subscribe({
        next: (action) => {
          expect(action).toEqual(
            jasmine.objectContaining({
              taskIds: ['task-1'],
              today: dateService.todayStr(),
              startOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
            }),
          );
          done();
        },
        error: done.fail,
      });

      dispatchAddTimeSpent(task);
    });

    it('should NOT dispatch planTasksForToday when tracked task has an existing dueDay', fakeAsync(() => {
      const task = createTask('task-1', {
        dueDay: '2026-05-16',
        dueWithTime: undefined,
      });
      let emitted = false;
      const subscription = effects.autoAddTodayTagOnTracking.subscribe(() => {
        emitted = true;
      });

      dispatchAddTimeSpent(task);
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch planTasksForToday when tracked task has dueWithTime', fakeAsync(() => {
      const task = createTask('task-1', {
        dueDay: undefined,
        dueWithTime: Date.now(),
      });
      let emitted = false;
      const subscription = effects.autoAddTodayTagOnTracking.subscribe(() => {
        emitted = true;
      });

      dispatchAddTimeSpent(task);
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    describe('autoAddTodayTagOnTracking - perf/membership', () => {
      const countTodaySelectCalls = (
        selectSpy: jasmine.Spy<MockStore['select']>,
      ): number =>
        selectSpy.calls.all().filter((c) => c.args[0] === selectTodayTaskIds).length;

      it('should NOT read the Today selector per tick for a task already scheduled (dueDay)', () => {
        // Default selectTodayTaskIds override is [].
        const task = createTask('task-1', {
          dueDay: '2026-05-16',
          dueWithTime: undefined,
        });
        const emissions: Action[] = [];
        const selectSpy = spyOn(store, 'select').and.callThrough();
        const subscription = effects.autoAddTodayTagOnTracking.subscribe((action) =>
          emissions.push(action),
        );

        for (let i = 0; i < 10; i++) {
          dispatchAddTimeSpent(task);
        }

        expect(emissions.length).toBe(0);
        expect(countTodaySelectCalls(selectSpy)).toBe(0);
        subscription.unsubscribe();
      });

      it('should dispatch exactly once across 10 ticks for the same unscheduled task and read the Today selector only once', () => {
        // Default selectTodayTaskIds override is [].
        const task = createTask('task-1', {
          dueDay: undefined,
          dueWithTime: undefined,
        });
        const emissions: Action[] = [];
        const selectSpy = spyOn(store, 'select').and.callThrough();
        const subscription = effects.autoAddTodayTagOnTracking.subscribe((action) =>
          emissions.push(action),
        );

        for (let i = 0; i < 10; i++) {
          dispatchAddTimeSpent(task);
        }

        expect(emissions.length).toBe(1);
        expect(emissions[0]).toEqual(
          jasmine.objectContaining({
            taskIds: ['task-1'],
          }),
        );
        expect(countTodaySelectCalls(selectSpy)).toBe(1);
        subscription.unsubscribe();
      });

      it('should NOT dispatch when the parent is already in Today', () => {
        store.overrideSelector(selectTodayTaskIds, ['parent-1']);
        store.refreshState();
        const task = createTask('task-1', {
          dueDay: undefined,
          dueWithTime: undefined,
          parentId: 'parent-1',
        });
        const emissions: Action[] = [];
        const subscription = effects.autoAddTodayTagOnTracking.subscribe((action) =>
          emissions.push(action),
        );

        dispatchAddTimeSpent(task);

        expect(emissions.length).toBe(0);
        subscription.unsubscribe();
      });

      it('should NOT dispatch when the task itself is already in Today', () => {
        store.overrideSelector(selectTodayTaskIds, ['task-1']);
        store.refreshState();
        const task = createTask('task-1', {
          dueDay: undefined,
          dueWithTime: undefined,
        });
        const emissions: Action[] = [];
        const subscription = effects.autoAddTodayTagOnTracking.subscribe((action) =>
          emissions.push(action),
        );

        dispatchAddTimeSpent(task);

        expect(emissions.length).toBe(0);
        subscription.unsubscribe();
      });

      it('should NOT dispatch while hydration/remote ops are being applied', () => {
        (
          TestBed.inject(HydrationStateService).isApplyingRemoteOps as jasmine.Spy<
            () => boolean
          >
        ).and.returnValue(true);
        const task = createTask('task-1', {
          dueDay: undefined,
          dueWithTime: undefined,
        });
        const emissions: Action[] = [];
        const subscription = effects.autoAddTodayTagOnTracking.subscribe((action) =>
          emissions.push(action),
        );

        dispatchAddTimeSpent(task);

        expect(emissions.length).toBe(0);
        subscription.unsubscribe();
      });
    });
  });
});
