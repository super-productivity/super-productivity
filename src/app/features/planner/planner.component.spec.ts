import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlannerComponent } from './planner.component';
import { PlannerService } from './planner.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { selectPlannerDayMap } from './store/planner.selectors';
import { signal } from '@angular/core';
import { PlannerDay } from './planner.model';
import { TaskState } from '../tasks/task.model';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { PlannerActions } from './store/planner.actions';

describe('PlannerComponent', () => {
  let fixture: ComponentFixture<PlannerComponent>;
  let component: PlannerComponent;
  let mockPlannerService: jasmine.SpyObj<PlannerService>;
  let mockDateService: jasmine.SpyObj<DateService>;
  let mockLayoutService: { isXs: ReturnType<typeof signal<boolean>> };
  let days$: BehaviorSubject<PlannerDay[]>;
  let todayDateStr$: BehaviorSubject<string>;
  const taskIds = ['task-1', 'task-2'];

  const makePlannerDay = (dayDate: string, taskCount: number): PlannerDay => ({
    dayDate,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${dayDate}-${i}`,
    })) as any,
    timeEstimate: 0,
    timeLimit: 0,
    itemsTotal: taskCount,
    deadlineTasks: [],
    noStartTimeRepeatProjections: [],
    allDayEvents: [],
    scheduledIItems: [],
  });

  beforeEach(async () => {
    days$ = new BehaviorSubject<PlannerDay[]>([]);
    todayDateStr$ = new BehaviorSubject<string>('2026-02-16');

    mockPlannerService = jasmine.createSpyObj('PlannerService', [
      'loadMoreDays',
      'resetScrollState',
      'ensureDayLoaded',
    ]);
    mockPlannerService.days$ = days$;
    mockPlannerService.isLoadingMore$ = new BehaviorSubject<boolean>(false);

    mockDateService = jasmine.createSpyObj('DateService', ['todayStr']);
    mockDateService.todayStr.and.returnValue('2026-02-16');

    mockLayoutService = {
      isXs: signal(false),
    };

    await TestBed.configureTestingModule({
      imports: [PlannerComponent],
      providers: [
        { provide: PlannerService, useValue: mockPlannerService },
        { provide: DateService, useValue: mockDateService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: GlobalTrackingIntervalService, useValue: { todayDateStr$ } },
        provideMockStore({
          selectors: [
            {
              selector: selectTaskFeatureState,
              value: { ids: taskIds, entities: {} },
            },
            {
              selector: selectPlannerDayMap,
              value: {},
            },
          ],
        }),
      ],
    })
      .overrideComponent(PlannerComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

    spyOn(TestBed.inject(MockStore), 'dispatch').and.callThrough();
    fixture = TestBed.createComponent(PlannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('planner cleanup dispatch', () => {
    const cleanupCalls = (): number =>
      (TestBed.inject(MockStore).dispatch as jasmine.Spy).calls
        .allArgs()
        .filter(
          ([a]) => a.type === PlannerActions.cleanupOldAndUndefinedPlannerTasks.type,
        ).length;

    it('dispatches once on init', () => {
      expect(cleanupCalls()).toBe(1);
    });

    // A tracked task replaces its entity every second; the ids array keeps its
    // reference, so the cleanup must not re-run on every tick.
    it('does not re-dispatch when only task entities change', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectTaskFeatureState, {
        ids: taskIds,
        entities: { task1: { id: 'task1' } },
      } as unknown as TaskState);
      store.refreshState();

      expect(cleanupCalls()).toBe(1);
    });

    it('re-dispatches when task ids change', () => {
      const store = TestBed.inject(MockStore);
      store.overrideSelector(selectTaskFeatureState, {
        ids: ['task-1'],
        entities: {},
      } as unknown as TaskState);
      store.refreshState();

      expect(cleanupCalls()).toBe(2);
    });

    it('re-dispatches when the logical day changes', () => {
      todayDateStr$.next('2026-02-17');

      expect(cleanupCalls()).toBe(2);
    });
  });

  describe('daysWithTasks', () => {
    it('should return a Set of day dates where tasks.length > 0', () => {
      days$.next([
        makePlannerDay('2026-02-16', 2),
        makePlannerDay('2026-02-17', 0),
        makePlannerDay('2026-02-18', 1),
      ]);
      fixture.detectChanges();

      const result = component.daysWithTasks();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has('2026-02-16')).toBeTrue();
      expect(result.has('2026-02-18')).toBeTrue();
      expect(result.has('2026-02-17')).toBeFalse();
    });

    it('should return the same Set reference when day dates have not changed', () => {
      days$.next([makePlannerDay('2026-02-16', 2), makePlannerDay('2026-02-17', 0)]);
      fixture.detectChanges();

      const firstResult = component.daysWithTasks();

      // Emit new days with same structure (same day dates with tasks)
      days$.next([makePlannerDay('2026-02-16', 5), makePlannerDay('2026-02-17', 0)]);
      fixture.detectChanges();

      const secondResult = component.daysWithTasks();

      expect(secondResult).toBe(firstResult);
    });

    it('should return a new Set reference when day dates change', () => {
      days$.next([makePlannerDay('2026-02-16', 2), makePlannerDay('2026-02-17', 0)]);
      fixture.detectChanges();

      const firstResult = component.daysWithTasks();

      // Now the second day also has tasks
      days$.next([makePlannerDay('2026-02-16', 2), makePlannerDay('2026-02-17', 3)]);
      fixture.detectChanges();

      const secondResult = component.daysWithTasks();

      expect(secondResult).not.toBe(firstResult);
      expect(secondResult.size).toBe(2);
      expect(secondResult.has('2026-02-17')).toBeTrue();
    });

    it('should return an empty Set when no days have tasks', () => {
      days$.next([makePlannerDay('2026-02-16', 0), makePlannerDay('2026-02-17', 0)]);
      fixture.detectChanges();

      const result = component.daysWithTasks();

      expect(result.size).toBe(0);
    });

    it('should return an empty Set when days array is empty', () => {
      days$.next([]);
      fixture.detectChanges();

      const result = component.daysWithTasks();

      expect(result.size).toBe(0);
    });

    it('should include persisted task dates outside the loaded render window', () => {
      const outOfWindowDay = '2026-02-26';
      days$.next([
        makePlannerDay('2026-02-16', 0),
        makePlannerDay('2026-02-17', 0),
        makePlannerDay('2026-02-18', 0),
        makePlannerDay('2026-02-19', 0),
        makePlannerDay('2026-02-20', 0),
      ]);
      TestBed.inject(MockStore).overrideSelector(selectPlannerDayMap, {
        [outOfWindowDay]: makePlannerDay(outOfWindowDay, 1).tasks,
      });
      TestBed.inject(MockStore).refreshState();
      fixture.detectChanges();

      expect(component.daysWithTasks().has(outOfWindowDay)).toBeTrue();
    });
  });
});
