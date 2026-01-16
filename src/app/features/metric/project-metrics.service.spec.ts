/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { ProjectMetricsService } from './project-metrics.service';
import { TaskService } from '../tasks/task.service';
import { ProjectService } from '../project/project.service';
import { WorklogService } from '../worklog/worklog.service';
import { WorkContextService } from '../work-context/work-context.service';
import { BehaviorSubject, of } from 'rxjs';
import { WorkContextType } from '../work-context/work-context.model';
import { createTask } from '../tasks/task.test-helper';
import { Worklog } from '../worklog/worklog.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';

describe('ProjectMetricsService', () => {
  let service: ProjectMetricsService;
  let taskService: jasmine.SpyObj<TaskService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let worklogService: jasmine.SpyObj<WorklogService>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let workContextService: jasmine.SpyObj<WorkContextService>;
  let activeWorkContextTypeAndId$: BehaviorSubject<{
    activeType: WorkContextType | null;
    activeId: string | null;
  }>;
  let worklog$: BehaviorSubject<Worklog>;
  let totalTimeSpent$: BehaviorSubject<number>;

  const TEST_PROJECT_ID = 'test-project-id';
  const TEST_TAG_ID = 'test-tag-id';

  const createWorklog = (timeSpent: number): Worklog => {
    return {
      2025: {
        timeSpent,
        daysWorked: 1,
        monthWorked: 1,
        ent: {
          1: {
            timeSpent,
            daysWorked: 1,
            weeks: [],
            ent: {
              15: {
                timeSpent,
                logEntries: [],
                dateStr: '2025-01-15',
                dayStr: '2025-01-15',
                workStart: Date.now(),
                workEnd: Date.now(),
              },
            },
          },
        },
      },
    };
  };

  beforeEach(() => {
    activeWorkContextTypeAndId$ = new BehaviorSubject<{
      activeType: WorkContextType | null;
      activeId: string | null;
    }>({
      activeType: null,
      activeId: null,
    });

    worklog$ = new BehaviorSubject<Worklog>(createWorklog(10000));
    totalTimeSpent$ = new BehaviorSubject<number>(10000);

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getAllTasksForProject']);
    const projectServiceSpy = jasmine.createSpyObj('ProjectService', [
      'getBreakNrForProject$',
      'getBreakTimeForProject$',
    ]);
    const worklogServiceSpy = jasmine.createSpyObj('WorklogService', [], {
      worklog$: worklog$.asObservable(),
      totalTimeSpent$: totalTimeSpent$.asObservable(),
    });
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContextTypeAndId$: activeWorkContextTypeAndId$.asObservable(),
    });

    // Default return values
    taskServiceSpy.getAllTasksForProject.and.returnValue(
      Promise.resolve([createTask({ id: '1' })]),
    );
    projectServiceSpy.getBreakNrForProject$.and.returnValue(of({}));
    projectServiceSpy.getBreakTimeForProject$.and.returnValue(of({}));

    TestBed.configureTestingModule({
      providers: [
        ProjectMetricsService,
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: WorklogService, useValue: worklogServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
      ],
    });

    service = TestBed.inject(ProjectMetricsService);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    worklogService = TestBed.inject(WorklogService) as jasmine.SpyObj<WorklogService>;
    workContextService = TestBed.inject(
      WorkContextService,
    ) as jasmine.SpyObj<WorkContextService>;
  });

  describe('Signal creation', () => {
    it('should create simpleMetrics signal', () => {
      expect(service.simpleMetrics).toBeDefined();
    });

    it('should return undefined initially (before context set)', () => {
      expect(service.simpleMetrics()).toBeUndefined();
    });
  });

  describe('Context switching', () => {
    it('should emit metrics when PROJECT context is active', fakeAsync(() => {
      const tasks = [createTask({ id: '1', isDone: true })];
      const breakNr: BreakNr = { '2025-01-15': 2 };
      const breakTime: BreakTime = { '2025-01-15': 600000 };

      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(tasks));
      projectService.getBreakNrForProject$.and.returnValue(of(breakNr));
      projectService.getBreakTimeForProject$.and.returnValue(of(breakTime));

      // Set PROJECT context
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      // Wait for delay(100) + async tasks
      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.nrOfAllTasks).toBe(1);
      expect(metrics?.nrOfCompletedTasks).toBe(1);
      expect(metrics?.breakNr).toBe(2);
      expect(metrics?.breakTime).toBe(600000);
    }));

    it('should return EMPTY when TAG context is active', fakeAsync(() => {
      // Set TAG context
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.TAG,
        activeId: TEST_TAG_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeUndefined();
    }));

    it('should return EMPTY when no context is active', fakeAsync(() => {
      // Set no context
      activeWorkContextTypeAndId$.next({
        activeType: null,
        activeId: null,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeUndefined();
    }));

    it('should update metrics when switching between projects', fakeAsync(() => {
      const project1Tasks = [createTask({ id: '1' }), createTask({ id: '2' })];
      const project2Tasks = [
        createTask({ id: '3' }),
        createTask({ id: '4' }),
        createTask({ id: '5' }),
      ];

      // Set first project
      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(project1Tasks));
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: 'project-1',
      });

      tick(200);
      flush();

      let metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(2);

      // Switch to second project
      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(project2Tasks));
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: 'project-2',
      });

      tick(200);
      flush();

      metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(3);
    }));
  });

  describe('Data combination', () => {
    it('should combine data from all sources (tasks, breaks, worklog)', fakeAsync(() => {
      const tasks = [
        createTask({ id: '1', isDone: true }),
        createTask({ id: '2', isDone: false }),
      ];
      const breakNr: BreakNr = { '2025-01-15': 3 };
      const breakTime: BreakTime = { '2025-01-15': 900000 };
      const worklog = createWorklog(15000);
      const totalTimeSpent = 15000;

      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(tasks));
      projectService.getBreakNrForProject$.and.returnValue(of(breakNr));
      projectService.getBreakTimeForProject$.and.returnValue(of(breakTime));
      worklog$.next(worklog);
      totalTimeSpent$.next(totalTimeSpent);

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.nrOfAllTasks).toBe(2);
      expect(metrics?.nrOfCompletedTasks).toBe(1);
      expect(metrics?.breakNr).toBe(3);
      expect(metrics?.breakTime).toBe(900000);
      expect(metrics?.timeSpent).toBe(15000);
      expect(metrics?.daysWorked).toBe(1);
    }));

    it('should pass correct parameters to mapSimpleMetrics', fakeAsync(() => {
      const tasks = [createTask()];
      const breakNr: BreakNr = { '2025-01-15': 1 };
      const breakTime: BreakTime = { '2025-01-15': 300000 };

      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(tasks));
      projectService.getBreakNrForProject$.and.returnValue(of(breakNr));
      projectService.getBreakTimeForProject$.and.returnValue(of(breakTime));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      // Verify getAllTasksForProject was called with correct projectId
      expect(taskService.getAllTasksForProject).toHaveBeenCalledWith(TEST_PROJECT_ID);

      // Verify getBreakNrForProject$ was called with correct projectId
      expect(projectService.getBreakNrForProject$).toHaveBeenCalledWith(TEST_PROJECT_ID);

      // Verify getBreakTimeForProject$ was called with correct projectId
      expect(projectService.getBreakTimeForProject$).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
      );
    }));

    it('should use project-specific break data', fakeAsync(() => {
      const breakNr: BreakNr = {
        '2025-01-14': 1,
        '2025-01-15': 2,
        '2025-01-16': 3,
      };
      const breakTime: BreakTime = {
        '2025-01-14': 300000,
        '2025-01-15': 600000,
        '2025-01-16': 900000,
      };

      projectService.getBreakNrForProject$.and.returnValue(of(breakNr));
      projectService.getBreakTimeForProject$.and.returnValue(of(breakTime));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(6); // Sum of all break numbers
      expect(metrics?.breakTime).toBe(1800000); // Sum of all break times
    }));

    it('should use project-specific tasks via getAllTasksForProject()', fakeAsync(() => {
      const projectTasks = [
        createTask({ id: '1', projectId: TEST_PROJECT_ID }),
        createTask({ id: '2', projectId: TEST_PROJECT_ID }),
        createTask({ id: '3', projectId: TEST_PROJECT_ID }),
      ];

      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(projectTasks));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      expect(taskService.getAllTasksForProject).toHaveBeenCalledWith(TEST_PROJECT_ID);

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(3);
    }));
  });

  describe('Timing and lifecycle', () => {
    it('should apply 100ms delay before processing', fakeAsync(() => {
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      // Before delay completes
      tick(50);
      expect(service.simpleMetrics()).toBeUndefined();

      // After delay completes
      tick(150);
      flush();
      expect(service.simpleMetrics()).toBeDefined();
    }));

    it('should use take(1) to prevent redraws', fakeAsync(() => {
      const tasks = [createTask()];
      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(tasks));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const firstMetrics = service.simpleMetrics();
      expect(firstMetrics).toBeDefined();

      // Update worklog - should NOT trigger new metrics calculation
      worklog$.next(createWorklog(99999));
      tick(200);
      flush();

      const secondMetrics = service.simpleMetrics();
      // Metrics should still be the same (take(1) prevents re-emission)
      expect(secondMetrics).toBe(firstMetrics);
    }));
  });

  describe('Edge cases', () => {
    it('should handle project with no tasks', fakeAsync(() => {
      taskService.getAllTasksForProject.and.returnValue(Promise.resolve([]));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.nrOfAllTasks).toBe(0);
      expect(metrics?.nrOfCompletedTasks).toBe(0);
      expect(metrics?.nrOfMainTasks).toBe(0);
    }));

    it('should handle project with no breaks', fakeAsync(() => {
      projectService.getBreakNrForProject$.and.returnValue(of({}));
      projectService.getBreakTimeForProject$.and.returnValue(of({}));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(0);
      expect(metrics?.breakTime).toBe(0);
    }));

    it('should handle project with no worklog', fakeAsync(() => {
      worklog$.next({});
      totalTimeSpent$.next(0);

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.timeSpent).toBe(0);
      expect(metrics?.daysWorked).toBe(0);
    }));

    it('should handle switching from PROJECT to TAG context', fakeAsync(() => {
      // Start with PROJECT
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      expect(service.simpleMetrics()).toBeDefined();

      // Switch to TAG
      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.TAG,
        activeId: TEST_TAG_ID,
      });

      tick(200);
      flush();

      // Should no longer have metrics (EMPTY for TAG)
      expect(service.simpleMetrics()).toBeDefined(); // Still has old value due to take(1)
    }));

    it('should handle getAllTasksForProject returning empty array', fakeAsync(() => {
      taskService.getAllTasksForProject.and.returnValue(Promise.resolve([]));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.nrOfAllTasks).toBe(0);
    }));

    it('should handle tasks with complex parent-child relationships', fakeAsync(() => {
      const tasks = [
        createTask({ id: '1', subTaskIds: ['2', '3'] }),
        createTask({ id: '2', parentId: '1' }),
        createTask({ id: '3', parentId: '1' }),
      ];

      taskService.getAllTasksForProject.and.returnValue(Promise.resolve(tasks));

      activeWorkContextTypeAndId$.next({
        activeType: WorkContextType.PROJECT,
        activeId: TEST_PROJECT_ID,
      });

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(3);
      expect(metrics?.nrOfMainTasks).toBe(1); // Task 1 only
      expect(metrics?.nrOfSubTasks).toBe(2); // Tasks 2 and 3
      expect(metrics?.nrOfParentTasks).toBe(1); // Task 1 has subtasks
    }));
  });
});
