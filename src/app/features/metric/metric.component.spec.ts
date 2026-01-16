import { TestBed } from '@angular/core/testing';
import { MetricComponent } from './metric.component';
import { MetricService } from './metric.service';
import { ProjectMetricsService } from './project-metrics.service';
import { AllTasksMetricsService } from './all-tasks-metrics.service';
import { WorkContextService } from '../work-context/work-context.service';
import { BehaviorSubject, of } from 'rxjs';
import { WorkContext, WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';
import { SimpleMetrics } from './metric.model';
import { signal } from '@angular/core';
import { T } from '../../t.const';

describe('MetricComponent', () => {
  let component: MetricComponent;
  let metricService: jasmine.SpyObj<MetricService>;
  let projectMetricsService: jasmine.SpyObj<ProjectMetricsService>;
  let allTasksMetricsService: jasmine.SpyObj<AllTasksMetricsService>;
  let workContextService: jasmine.SpyObj<WorkContextService>;
  let activeWorkContext$: BehaviorSubject<WorkContext | null>;

  const createMockWorkContext = (
    id: string,
    type: WorkContextType,
    title: string = 'Test Context',
  ): WorkContext => ({
    id,
    type,
    title,
    icon: null,
    theme: {} as any,
    advancedCfg: { worklogExportSettings: {} as any },
    routerLink: `/${type.toLowerCase()}/${id}`,
    isEnableBacklog: false,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
  });

  const createMockMetrics = (overrides: Partial<SimpleMetrics> = {}): SimpleMetrics => ({
    start: '2025-01-01',
    end: '2025-01-16',
    timeSpent: 10000,
    breakTime: 600000,
    breakNr: 2,
    timeEstimate: 5000,
    nrOfCompletedTasks: 5,
    nrOfAllTasks: 10,
    nrOfSubTasks: 3,
    nrOfMainTasks: 7,
    nrOfParentTasks: 2,
    daysWorked: 5,
    avgTasksPerDay: 2,
    avgTimeSpentOnDay: 2000,
    avgTimeSpentOnTask: 1428,
    avgTimeSpentOnTaskIncludingSubTasks: 1250,
    avgBreakNr: 0.4,
    avgBreakTime: 120000,
    ...overrides,
  });

  let projectMetricsSignal: ReturnType<typeof signal<SimpleMetrics | undefined>>;
  let allTasksMetricsSignal: ReturnType<typeof signal<SimpleMetrics | undefined>>;

  beforeEach(() => {
    activeWorkContext$ = new BehaviorSubject<WorkContext | null>(null);

    // Create writable signals that can be updated
    projectMetricsSignal = signal<SimpleMetrics | undefined>(undefined);
    allTasksMetricsSignal = signal<SimpleMetrics | undefined>(undefined);

    const metricServiceSpy = jasmine.createSpyObj('MetricService', [
      'getSimpleClickCounterMetrics$',
      'getSimpleCounterStopwatchMetrics$',
      'getFocusSessionMetrics$',
      'getProductivityBreakdown$',
      'hasData',
    ]);
    const projectMetricsServiceSpy = jasmine.createSpyObj('ProjectMetricsService', [], {
      simpleMetrics: projectMetricsSignal.asReadonly(),
    });
    const allTasksMetricsServiceSpy = jasmine.createSpyObj('AllTasksMetricsService', [], {
      simpleMetrics: allTasksMetricsSignal.asReadonly(),
    });
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContext$: activeWorkContext$.asObservable(),
    });

    // Default return values for MetricService
    metricServiceSpy.getSimpleClickCounterMetrics$.and.returnValue(of(null));
    metricServiceSpy.getSimpleCounterStopwatchMetrics$.and.returnValue(of(null));
    metricServiceSpy.getFocusSessionMetrics$.and.returnValue(of(null));
    metricServiceSpy.getProductivityBreakdown$.and.returnValue(of([]));
    metricServiceSpy.hasData.and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [MetricComponent],
      providers: [
        { provide: MetricService, useValue: metricServiceSpy },
        { provide: ProjectMetricsService, useValue: projectMetricsServiceSpy },
        { provide: AllTasksMetricsService, useValue: allTasksMetricsServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
      ],
    }).overrideComponent(MetricComponent, {
      set: {
        imports: [],
        template: '<div></div>',
      },
    });

    const fixture = TestBed.createComponent(MetricComponent);
    component = fixture.componentInstance;

    metricService = TestBed.inject(MetricService) as jasmine.SpyObj<MetricService>;
    projectMetricsService = TestBed.inject(
      ProjectMetricsService,
    ) as jasmine.SpyObj<ProjectMetricsService>;
    allTasksMetricsService = TestBed.inject(
      AllTasksMetricsService,
    ) as jasmine.SpyObj<AllTasksMetricsService>;
    workContextService = TestBed.inject(
      WorkContextService,
    ) as jasmine.SpyObj<WorkContextService>;
  });

  describe('Component creation', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should inject all required services', () => {
      expect(component.metricService).toBe(metricService);
      expect(component.projectMetricsService).toBe(projectMetricsService);
      expect(component.allTasksMetricsService).toBe(allTasksMetricsService);
      expect(component.workContextService).toBe(workContextService);
    });
  });

  describe('_isShowingAllTasks computed', () => {
    it('should return true when context is TODAY_TAG', () => {
      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );

      expect(component['_isShowingAllTasks']()).toBe(true);
    });

    it('should return false when context is a regular project', () => {
      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );

      expect(component['_isShowingAllTasks']()).toBe(false);
    });

    it('should return false when context is a regular tag', () => {
      activeWorkContext$.next(
        createMockWorkContext('tag-1', WorkContextType.TAG, 'Tag 1'),
      );

      expect(component['_isShowingAllTasks']()).toBe(false);
    });

    it('should return false when context is null', () => {
      activeWorkContext$.next(null);

      expect(component['_isShowingAllTasks']()).toBe(false);
    });
  });

  describe('metricsTitle computed', () => {
    it('should return PM.ALL_TASKS_TITLE when viewing TODAY_TAG', () => {
      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );

      expect(component.metricsTitle()).toBe(T.PM.ALL_TASKS_TITLE);
    });

    it('should return T.PM.TITLE when viewing a regular project', () => {
      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );

      expect(component.metricsTitle()).toBe(T.PM.TITLE);
    });

    it('should return T.PM.TITLE when viewing a regular tag', () => {
      activeWorkContext$.next(
        createMockWorkContext('tag-1', WorkContextType.TAG, 'Tag 1'),
      );

      expect(component.metricsTitle()).toBe(T.PM.TITLE);
    });

    it('should return T.PM.TITLE when context is null', () => {
      activeWorkContext$.next(null);

      expect(component.metricsTitle()).toBe(T.PM.TITLE);
    });
  });

  describe('simpleMetrics computed', () => {
    it('should use AllTasksMetricsService when viewing TODAY_TAG', () => {
      const allTasksMetrics = createMockMetrics({ nrOfAllTasks: 100 });
      const projectMetrics = createMockMetrics({ nrOfAllTasks: 10 });

      // Set up both services with different metrics
      allTasksMetricsSignal.set(allTasksMetrics);
      projectMetricsSignal.set(projectMetrics);

      // Set context to TODAY_TAG
      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );

      // Should return AllTasksMetrics
      const result = component.simpleMetrics();
      expect(result).toBe(allTasksMetrics);
      expect(result?.nrOfAllTasks).toBe(100);
    });

    it('should use ProjectMetricsService when viewing a regular project', () => {
      const allTasksMetrics = createMockMetrics({ nrOfAllTasks: 100 });
      const projectMetrics = createMockMetrics({ nrOfAllTasks: 10 });

      // Set up both services with different metrics
      allTasksMetricsSignal.set(allTasksMetrics);
      projectMetricsSignal.set(projectMetrics);

      // Set context to a regular project
      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );

      // Should return ProjectMetrics
      const result = component.simpleMetrics();
      expect(result).toBe(projectMetrics);
      expect(result?.nrOfAllTasks).toBe(10);
    });

    it('should use ProjectMetricsService when viewing a regular tag', () => {
      const allTasksMetrics = createMockMetrics({ nrOfAllTasks: 100 });
      const projectMetrics = createMockMetrics({ nrOfAllTasks: 10 });

      allTasksMetricsSignal.set(allTasksMetrics);
      projectMetricsSignal.set(projectMetrics);

      activeWorkContext$.next(
        createMockWorkContext('tag-1', WorkContextType.TAG, 'Tag 1'),
      );

      const result = component.simpleMetrics();
      expect(result).toBe(projectMetrics);
      expect(result?.nrOfAllTasks).toBe(10);
    });

    it('should return undefined when both services return undefined', () => {
      (allTasksMetricsService as any).simpleMetrics = signal(undefined);
      (projectMetricsService as any).simpleMetrics = signal(undefined);

      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );

      expect(component.simpleMetrics()).toBeUndefined();
    });
  });

  describe('Context switching behavior', () => {
    it('should switch from ProjectMetrics to AllTasksMetrics when changing context', () => {
      const projectMetrics = createMockMetrics({ nrOfAllTasks: 10 });
      const allTasksMetrics = createMockMetrics({ nrOfAllTasks: 100 });

      projectMetricsSignal.set(projectMetrics);
      allTasksMetricsSignal.set(allTasksMetrics);

      // Start with a project
      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );
      expect(component.simpleMetrics()?.nrOfAllTasks).toBe(10);
      expect(component.metricsTitle()).toBe(T.PM.TITLE);

      // Switch to TODAY_TAG
      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );
      expect(component.simpleMetrics()?.nrOfAllTasks).toBe(100);
      expect(component.metricsTitle()).toBe(T.PM.ALL_TASKS_TITLE);
    });

    it('should switch from AllTasksMetrics to ProjectMetrics when changing context', () => {
      const projectMetrics = createMockMetrics({ nrOfAllTasks: 10 });
      const allTasksMetrics = createMockMetrics({ nrOfAllTasks: 100 });

      projectMetricsSignal.set(projectMetrics);
      allTasksMetricsSignal.set(allTasksMetrics);

      // Start with TODAY_TAG
      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );
      expect(component.simpleMetrics()?.nrOfAllTasks).toBe(100);
      expect(component.metricsTitle()).toBe(T.PM.ALL_TASKS_TITLE);

      // Switch to a project
      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Project 1'),
      );
      expect(component.simpleMetrics()?.nrOfAllTasks).toBe(10);
      expect(component.metricsTitle()).toBe(T.PM.TITLE);
    });
  });

  describe('sharePayload computed', () => {
    it('should format metrics for sharing when metrics are available', () => {
      const mockMetrics = createMockMetrics();
      projectMetricsSignal.set(mockMetrics);

      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Test Project'),
      );

      const payload = component.sharePayload();

      expect(payload).toBeDefined();
      expect(payload.text).toContain('Test Project');
    });

    it('should return promotion payload when metrics are undefined', () => {
      projectMetricsSignal.set(undefined);
      allTasksMetricsSignal.set(undefined);

      activeWorkContext$.next(
        createMockWorkContext('project-1', WorkContextType.PROJECT, 'Test Project'),
      );

      const payload = component.sharePayload();

      expect(payload).toBeDefined();
      // ShareFormatter.formatPromotion() returns a specific payload
    });

    it('should use AllTasksMetrics for share payload when viewing TODAY_TAG', () => {
      const allTasksMetrics = createMockMetrics({
        nrOfAllTasks: 100,
        nrOfCompletedTasks: 50,
      });
      allTasksMetricsSignal.set(allTasksMetrics);

      activeWorkContext$.next(
        createMockWorkContext(TODAY_TAG.id, WorkContextType.TAG, 'Today'),
      );

      const payload = component.sharePayload();

      expect(payload).toBeDefined();
      expect(payload.text).toContain('50'); // completed tasks
    });
  });
});
