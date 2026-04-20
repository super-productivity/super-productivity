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

  describe('getTimeWorkedForDayForTasksInArchiveYoung', () => {
    const DAY = '2023-06-13';

    it('should not crash when archived task has undefined timeSpentOnDay', async () => {
      taskArchiveServiceMock.loadYoung.and.returnValue(
        Promise.resolve({
          ids: ['task1', 'task2'],
          entities: {
            task1: {
              id: 'task1',
              timeSpentOnDay: undefined,
              parentId: null,
              tagIds: ['test-context'],
              projectId: null,
            },
            task2: {
              id: 'task2',
              timeSpentOnDay: { [DAY]: 5000 },
              parentId: null,
              tagIds: ['test-context'],
              projectId: null,
            },
          } as any,
        }),
      );

      const result = await service.getTimeWorkedForDayForTasksInArchiveYoung(DAY);
      expect(result).toBe(5000);
    });

    it('should not crash when archive entity is undefined', async () => {
      taskArchiveServiceMock.loadYoung.and.returnValue(
        Promise.resolve({
          ids: ['task1', 'task2'],
          entities: {
            task1: undefined,
            task2: {
              id: 'task2',
              timeSpentOnDay: { [DAY]: 3000 },
              parentId: null,
              tagIds: ['test-context'],
              projectId: null,
            },
          } as any,
        }),
      );

      const result = await service.getTimeWorkedForDayForTasksInArchiveYoung(DAY);
      expect(result).toBe(3000);
    });
  });
});

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

describe('WorkContextService - getDoneTodayInArchive', () => {
  let dateServiceMock: jasmine.SpyObj<DateService>;
  let taskArchiveServiceMock: jasmine.SpyObj<TaskArchiveService>;
  let service: WorkContextService;

  beforeEach(() => {
    const tagServiceMock = jasmine.createSpyObj('TagService', ['getTagById$']);
    tagServiceMock.getTagById$.and.returnValue(of(TODAY_TAG));

    const globalTrackingIntervalServiceMock = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      { todayDateStr$: of('2026-04-06') },
    );

    dateServiceMock = jasmine.createSpyObj('DateService', ['todayStr', 'isToday']);
    dateServiceMock.todayStr.and.returnValue('2026-04-06');

    const timeTrackingServiceMock = jasmine.createSpyObj('TimeTrackingService', [
      'getWorkStartEndForWorkContext$',
    ]);
    timeTrackingServiceMock.getWorkStartEndForWorkContext$.and.returnValue(of({}));

    taskArchiveServiceMock = jasmine.createSpyObj('TaskArchiveService', ['loadYoung']);

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          initialState: {
            workContext: { activeId: TODAY_TAG.id, activeType: 'TAG' },
            tag: { entities: {}, ids: [] },
            project: { entities: {}, ids: [] },
            task: { entities: {}, ids: [] },
          },
        }),
        provideMockActions(() => of()),
        { provide: Router, useValue: { events: of(), url: '/' } },
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

    // Short-circuit observables that depend on store selectors we don't set up.
    (service as any).isTodayList$ = of(true);
    (service as any).activeWorkContextTypeAndId$ = of({
      activeId: TODAY_TAG.id,
      activeType: WorkContextType.TAG,
    });
  });

  const archiveTask = (id: string, doneOn: number): any => ({
    id,
    parentId: null,
    doneOn,
    tagIds: [TODAY_TAG.id],
    projectId: null,
  });

  it('counts a task done just after midnight when startOfNextDay=1', async () => {
    // Bug #7157 scenario. startOfNextDay = 1h.
    // Now: 00:30 Apr 6 (calendar) = 23:30 Apr 5 (logical).
    // Task done at 00:15 Apr 6 (same logical day, Apr 5).
    // DateService.todayStr() => "2026-04-05"; isToday should subtract 1h and return true.
    const now = new Date(2026, 3, 6, 0, 30).getTime();
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(now));

    dateServiceMock.todayStr.and.returnValue('2026-04-05');
    dateServiceMock.isToday.and.callFake((date: number | Date) => {
      const ts = typeof date === 'number' ? date : date.getTime();
      const offsetMs = 1 * 60 * 60 * 1000;
      const d = new Date(ts - offsetMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}` === '2026-04-05';
    });

    const doneAt = new Date(2026, 3, 6, 0, 15).getTime();
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({
        ids: ['t1'],
        entities: { t1: archiveTask('t1', doneAt) },
      } as any),
    );

    const result = await service.getDoneTodayInArchive();

    expect(result).toBe(1);
    jasmine.clock().uninstall();
  });

  it('does not count a task done yesterday (different logical day)', async () => {
    dateServiceMock.isToday.and.returnValue(false);
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({
        ids: ['t1'],
        entities: {
          t1: archiveTask('t1', Date.now() - TWO_DAYS_MS),
        },
      } as any),
    );

    const result = await service.getDoneTodayInArchive();

    expect(result).toBe(0);
  });

  it('ignores tasks without doneOn', async () => {
    dateServiceMock.isToday.and.returnValue(true);
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({
        ids: ['t1'],
        entities: { t1: { ...archiveTask('t1', 0), doneOn: undefined } },
      } as any),
    );

    const result = await service.getDoneTodayInArchive();

    expect(result).toBe(0);
  });

  it('ignores sub-tasks (only counts parents)', async () => {
    dateServiceMock.isToday.and.returnValue(true);
    const doneAt = Date.now();
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({
        ids: ['parent', 'sub'],
        entities: {
          parent: archiveTask('parent', doneAt),
          sub: { ...archiveTask('sub', doneAt), parentId: 'parent' },
        },
      } as any),
    );

    const result = await service.getDoneTodayInArchive();

    expect(result).toBe(1);
  });
});
