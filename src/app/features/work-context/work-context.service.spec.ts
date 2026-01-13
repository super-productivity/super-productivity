import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { WorkContextService } from './work-context.service';
import { TaskWithSubTasks } from '../tasks/task.model';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { TagService } from '../tag/tag.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { TODAY_TAG } from '../tag/tag.const';
import { WorkContextType } from './work-context.model';

describe('WorkContextService - undoneTasks$ filtering', () => {
  let tagServiceMock: jasmine.SpyObj<TagService>;
  let globalTrackingIntervalServiceMock: jasmine.SpyObj<GlobalTrackingIntervalService>;
  let dateServiceMock: jasmine.SpyObj<DateService>;
  let timeTrackingServiceMock: jasmine.SpyObj<TimeTrackingService>;
  let taskArchiveServiceMock: jasmine.SpyObj<TaskArchiveService>;
  let service: WorkContextService;

  const createMockTask = (overrides: Partial<TaskWithSubTasks>): TaskWithSubTasks =>
    ({
      id: 'MOCK_TASK_ID',
      title: 'Mock Task',
      isDone: false,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      subTasks: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      reminderId: null,
      dueWithTime: undefined,
      dueDay: null,
      hasPlannedTime: false,
      repeatCfgId: null,
      notes: '',
      issueId: null,
      issueType: null,
      issueWasUpdated: null,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      projectId: null,
      _showSubTasksMode: 0,
      _currentTab: 0,
      _isTaskPlaceHolder: false,
      ...overrides,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    // Mock current time to be 10 AM for consistent testing
    jasmine.clock().install();
    const currentTime = new Date();
    currentTime.setHours(10, 0, 0, 0);
    jasmine.clock().mockDate(currentTime);

    // Create service mocks
    tagServiceMock = jasmine.createSpyObj('TagService', ['getTagById$']);
    globalTrackingIntervalServiceMock = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      {
        todayDateStr$: of('2023-06-13'),
      },
    );
    dateServiceMock = jasmine.createSpyObj('DateService', ['todayStr']);
    timeTrackingServiceMock = jasmine.createSpyObj('TimeTrackingService', [
      'getWorkStartEndForWorkContext$',
    ]);
    taskArchiveServiceMock = jasmine.createSpyObj('TaskArchiveService', ['loadYoung']);

    // Configure mock return values
    tagServiceMock.getTagById$.and.returnValue(of(TODAY_TAG));
    dateServiceMock.todayStr.and.returnValue('2023-06-13');
    timeTrackingServiceMock.getWorkStartEndForWorkContext$.and.returnValue(of({}));
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          initialState: {
            workContext: {
              activeId: 'test-context',
              activeType: 'TAG',
            },
            tag: {
              entities: {
                testContext: {
                  id: 'test-context',
                  title: 'Test Context',
                  taskIds: [],
                  created: Date.now(),
                  advancedCfg: {},
                  theme: {},
                },
              },
              ids: ['test-context'],
            },
            project: { entities: {}, ids: [] },
            task: { entities: {}, ids: [] },
          },
        }),
        provideMockActions(() => of()),
        {
          provide: Router,
          useValue: {
            events: of(),
            url: '/',
          },
        },
        { provide: TagService, useValue: tagServiceMock },
        {
          provide: GlobalTrackingIntervalService,
          useValue: globalTrackingIntervalServiceMock,
        },
        { provide: DateService, useValue: dateServiceMock },
        { provide: TimeTrackingService, useValue: timeTrackingServiceMock },
        { provide: TaskArchiveService, useValue: taskArchiveServiceMock },
        WorkContextService,
      ],
    });

    service = TestBed.inject(WorkContextService);
    service.activeWorkContextId = TODAY_TAG.id;
    service.activeWorkContextType = WorkContextType.TAG;
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  // Test the filtering logic directly instead of testing the full observable chain
  describe('filtering logic', () => {
    const filterTasks = (tasks: TaskWithSubTasks[]): TaskWithSubTasks[] => {
      return (
        (service as any)
          ._filterFutureScheduledTasksForToday(tasks)
          // The observable filters out done tasks afterwards
          .filter((task: TaskWithSubTasks) => task && !task.isDone)
      );
    };

    it('should filter out tasks scheduled for later today', () => {
      const todayAt = (hours: number, minutes: number = 0): number => {
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date.getTime();
      };

      const mockTasks: TaskWithSubTasks[] = [
        // Task scheduled for later today (should be filtered out)
        createMockTask({
          id: 'LATER_TODAY',
          title: 'Meeting at 2 PM',
          dueWithTime: todayAt(14, 0),
        }),
        // Task scheduled for earlier today (should be included)
        createMockTask({
          id: 'EARLIER_TODAY',
          title: 'Morning standup',
          dueWithTime: todayAt(8, 0),
        }),
        // Task without scheduled time (should be included)
        createMockTask({
          id: 'UNSCHEDULED',
          title: 'Unscheduled task',
          dueWithTime: undefined,
        }),
        // Done task (should be filtered out)
        createMockTask({
          id: 'DONE_TASK',
          title: 'Completed task',
          isDone: true,
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(2);
      expect(filteredTasks.find((t) => t.id === 'LATER_TODAY')).toBeUndefined();
      expect(filteredTasks.find((t) => t.id === 'EARLIER_TODAY')).toBeDefined();
      expect(filteredTasks.find((t) => t.id === 'UNSCHEDULED')).toBeDefined();
      expect(filteredTasks.find((t) => t.id === 'DONE_TASK')).toBeUndefined();
    });

    it('should NOT filter out tasks scheduled for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);
      // Assuming 2023-06-14 is tomorrow relative to 2023-06-13
      const tomorrowStr = '2023-06-14';

      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'TOMORROW_TASK',
          title: 'Tomorrow meeting',
          dueWithTime: tomorrow.getTime(),
          dueDay: tomorrowStr,
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(1);
    });

    it('should NOT filter out tasks scheduled for future date via dueDay only', () => {
      const futureDateStr = '2023-06-15';

      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'FUTURE_TASK',
          title: 'Future task',
          dueDay: futureDateStr,
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(1);
    });

    it('should not filter out future tasks when active context is not Today', () => {
      service.activeWorkContextId = 'not-today';
      service.activeWorkContextType = WorkContextType.TAG;

      const futureDateStr = '2023-06-15';

      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'FUTURE_TASK',
          title: 'Future task',
          dueDay: futureDateStr,
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(1);
      expect(filteredTasks[0].id).toBe('FUTURE_TASK');
    });

    it('should handle edge case of task scheduled exactly at current time', () => {
      const now = Date.now();

      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'CURRENT_TIME_TASK',
          title: 'Task at current time',
          dueWithTime: now,
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      // Task scheduled at exactly current time should be filtered out
      expect(filteredTasks.length).toBe(0);
      expect(filteredTasks.find((t) => t.id === 'CURRENT_TIME_TASK')).toBeUndefined();
    });

    it('should include parent tasks with subtasks when parent is not scheduled for later', () => {
      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'PARENT_TASK',
          title: 'Parent task',
          dueWithTime: undefined,
          subTasks: [
            createMockTask({
              id: 'SUB_1',
              title: 'Subtask 1',
              parentId: 'PARENT_TASK',
            }),
          ],
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(1);
      expect(filteredTasks[0].id).toBe('PARENT_TASK');
      expect(filteredTasks[0].subTasks.length).toBe(1);
    });

    it('should filter out parent tasks with subtasks when parent is scheduled for later', () => {
      const todayAt = (hours: number): number => {
        const date = new Date();
        date.setHours(hours, 0, 0, 0);
        return date.getTime();
      };

      const mockTasks: TaskWithSubTasks[] = [
        createMockTask({
          id: 'PARENT_LATER',
          title: 'Parent task for later',
          dueWithTime: todayAt(15),
          subTasks: [
            createMockTask({
              id: 'SUB_1',
              title: 'Subtask 1',
              parentId: 'PARENT_LATER',
            }),
          ],
        }),
      ];

      const filteredTasks = filterTasks(mockTasks);

      expect(filteredTasks.length).toBe(0);
    });
  });
});
