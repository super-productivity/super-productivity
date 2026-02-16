import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlannerComponent } from './planner.component';
import { PlannerService } from './planner.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { signal } from '@angular/core';
import { PlannerDay } from './planner.model';

describe('PlannerComponent', () => {
  let fixture: ComponentFixture<PlannerComponent>;
  let component: PlannerComponent;
  let mockPlannerService: jasmine.SpyObj<PlannerService>;
  let mockDateService: jasmine.SpyObj<DateService>;
  let mockLayoutService: { isXs: ReturnType<typeof signal<boolean>> };
  let days$: BehaviorSubject<PlannerDay[]>;

  const makePlannerDay = (dayDate: string, taskCount: number): PlannerDay => ({
    dayDate,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${dayDate}-${i}`,
    })) as any,
    timeEstimate: 0,
    timeLimit: 0,
    itemsTotal: taskCount,
    noStartTimeRepeatProjections: [],
    allDayEvents: [],
    scheduledIItems: [],
  });

  beforeEach(async () => {
    days$ = new BehaviorSubject<PlannerDay[]>([]);

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
        provideMockStore({
          selectors: [
            {
              selector: selectTaskFeatureState,
              value: { ids: ['task-1', 'task-2'], entities: {} },
            },
          ],
        }),
      ],
    })
      .overrideComponent(PlannerComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

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
  });
});
