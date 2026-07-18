import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { resolveContextTheme, WorkContextService } from './work-context.service';
import { SYSTEM_ENTITY_THEMES } from './work-context-default-theme.util';
import {
  DEFAULT_TAG_COLOR,
  isBackgroundImageSet,
  WORK_CONTEXT_DEFAULT_THEME,
} from './work-context.const';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { TaskWithSubTasks } from '../tasks/task.model';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { TagService } from '../tag/tag.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DEFAULT_TAG, IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../tag/tag.const';
import { WorkContext, WorkContextThemeCfg, WorkContextType } from './work-context.model';
import {
  selectActiveContextId,
  selectActiveWorkContext,
} from './store/work-context.selectors';
import { allDataWasLoaded } from '../../root-store/meta/all-data-was-loaded.actions';

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

  describe('breakTimeToday$', () => {
    it('exposes recorded break time for the current day', (done) => {
      const today = '2023-06-13';
      service.activeWorkContextTTData$ = of({
        [today]: { bt: 10 * 60 * 1000 },
      });

      service.breakTimeToday$.subscribe((breakTime) => {
        expect(breakTime).toBe(10 * 60 * 1000);
        done();
      });
    });

    it('defaults to zero when no break time is recorded', (done) => {
      service.activeWorkContextTTData$ = of({});

      service.breakTimeToday$.subscribe((breakTime) => {
        expect(breakTime).toBe(0);
        done();
      });
    });
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

describe('WorkContextService - activeWorkContext$ distinctUntilChanged', () => {
  let timeTrackingServiceMock: jasmine.SpyObj<TimeTrackingService>;
  let store: MockStore;
  let service: WorkContextService;

  const ctx1 = (): WorkContext =>
    ({
      id: TODAY_TAG.id,
      type: WorkContextType.TAG,
      title: 'x',
      icon: null,
      routerLink: 'tag/TODAY',
      theme: {},
      advancedCfg: {},
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
    }) as unknown as WorkContext;

  const CTX1 = ctx1();

  beforeEach(() => {
    const tagServiceMock = jasmine.createSpyObj('TagService', ['getTagById$']);
    tagServiceMock.getTagById$.and.returnValue(of(TODAY_TAG));

    const globalTrackingIntervalServiceMock = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      { todayDateStr$: of('2026-04-06') },
    );

    const dateServiceMock = jasmine.createSpyObj('DateService', ['todayStr']);
    dateServiceMock.todayStr.and.returnValue('2026-04-06');

    timeTrackingServiceMock = jasmine.createSpyObj('TimeTrackingService', [
      'getWorkStartEndForWorkContext$',
    ]);
    timeTrackingServiceMock.getWorkStartEndForWorkContext$.and.returnValue(of({}));

    const taskArchiveServiceMock = jasmine.createSpyObj('TaskArchiveService', [
      'loadYoung',
    ]);
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );

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
        // activeWorkContext$ is gated behind _afterDataLoadedOnce$, which only
        // fires after the allDataWasLoaded action.
        provideMockActions(() => of(allDataWasLoaded())),
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

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectActiveWorkContext, CTX1);
    store.refreshState();

    service = TestBed.inject(WorkContextService);
  });

  it('collapses per-tick no-op re-emissions but still emits real changes', () => {
    const collected: WorkContext[] = [];
    const sub = service.activeWorkContext$.subscribe((v) => collected.push(v));
    // Subscribe to TTData$ so we can prove it does NOT re-subscribe on no-ops.
    const ttSub = service.activeWorkContextTTData$.subscribe();

    expect(collected.length).toBe(1);
    expect(timeTrackingServiceMock.getWorkStartEndForWorkContext$.calls.count()).toBe(1);

    // No-op: content-identical but new object reference (fresh taskIds array),
    // exactly what the selector produces every tracking tick.
    store.overrideSelector(selectActiveWorkContext, {
      ...CTX1,
      taskIds: [...CTX1.taskIds],
    } as WorkContext);
    store.refreshState();

    expect(collected.length).toBe(1);
    expect(timeTrackingServiceMock.getWorkStartEndForWorkContext$.calls.count()).toBe(1);

    // Genuine change: different taskIds content -> must emit + re-subscribe TT.
    store.overrideSelector(selectActiveWorkContext, {
      ...CTX1,
      taskIds: ['NEW'],
    } as WorkContext);
    store.refreshState();

    expect(collected.length).toBe(2);
    expect(timeTrackingServiceMock.getWorkStartEndForWorkContext$.calls.count()).toBe(2);

    ttSub.unsubscribe();
    sub.unsubscribe();
  });
});

// #8843: `task.component.ts` read `workContextService.isTodayList` (a plain
// mutable boolean) inside a `computed()`, so the computed had no signal producer
// and never invalidated. `isTodayListSignal` is a `toSignal(isTodayList$)` mirror
// that must reactively track the active work context.
describe('WorkContextService - isTodayListSignal reactivity', () => {
  let store: MockStore;
  let service: WorkContextService;

  beforeEach(() => {
    const tagServiceMock = jasmine.createSpyObj('TagService', ['getTagById$']);
    tagServiceMock.getTagById$.and.returnValue(of(TODAY_TAG));

    const globalTrackingIntervalServiceMock = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      { todayDateStr$: of('2026-04-06') },
    );

    const dateServiceMock = jasmine.createSpyObj('DateService', ['todayStr']);
    dateServiceMock.todayStr.and.returnValue('2026-04-06');

    const timeTrackingServiceMock = jasmine.createSpyObj('TimeTrackingService', [
      'getWorkStartEndForWorkContext$',
    ]);
    timeTrackingServiceMock.getWorkStartEndForWorkContext$.and.returnValue(of({}));

    const taskArchiveServiceMock = jasmine.createSpyObj('TaskArchiveService', [
      'loadYoung',
    ]);
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );

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
        // activeWorkContextId$ is gated behind the allDataWasLoaded action.
        provideMockActions(() => of(allDataWasLoaded())),
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

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectActiveContextId, TODAY_TAG.id);
    store.refreshState();

    service = TestBed.inject(WorkContextService);
  });

  it('is true on the Today list and flips to false when the context changes', () => {
    expect(service.isTodayListSignal()).toBe(true);

    store.overrideSelector(selectActiveContextId, 'some-other-context');
    store.refreshState();

    expect(service.isTodayListSignal()).toBe(false);
  });
});

// The #9139 fix lives in `resolveContextTheme`, but `currentTheme$` is the only
// thing in production that CALLS it — every crashing consumer (resolveBackground,
// _setColorTheme) reads this stream, not the function. Without this block the
// whole fix could be reverted at the `map()` and the suite stayed green: the
// unit tests below pass a themeless context in by hand, so they never observe
// the wiring. Tests the seam, deliberately, not the logic.
describe('WorkContextService - currentTheme$ wiring (#9139)', () => {
  let store: MockStore;
  let service: WorkContextService;

  // TODAY, with no `theme` at all — the exact entity and shape from the report,
  // and the active context at startup.
  const themelessToday = (): WorkContext => {
    const ctx = {
      id: TODAY_TAG.id,
      type: WorkContextType.TAG,
      title: 'Today',
      icon: null,
      routerLink: `tag/${TODAY_TAG.id}`,
      advancedCfg: {},
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
    } as unknown as WorkContext;
    // Assert the premise rather than trusting it: if `theme` were somehow
    // present the test would pass for the wrong reason.
    expect('theme' in ctx).toBe(false);
    return ctx;
  };

  beforeEach(() => {
    const tagServiceMock = jasmine.createSpyObj('TagService', ['getTagById$']);
    tagServiceMock.getTagById$.and.returnValue(of(TODAY_TAG));

    const globalTrackingIntervalServiceMock = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      { todayDateStr$: of('2026-04-06') },
    );

    const dateServiceMock = jasmine.createSpyObj('DateService', ['todayStr']);
    dateServiceMock.todayStr.and.returnValue('2026-04-06');

    const timeTrackingServiceMock = jasmine.createSpyObj('TimeTrackingService', [
      'getWorkStartEndForWorkContext$',
    ]);
    timeTrackingServiceMock.getWorkStartEndForWorkContext$.and.returnValue(of({}));

    const taskArchiveServiceMock = jasmine.createSpyObj('TaskArchiveService', [
      'loadYoung',
    ]);
    taskArchiveServiceMock.loadYoung.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );

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
        // activeWorkContext$ is gated behind _afterDataLoadedOnce$, which only
        // fires after the allDataWasLoaded action.
        provideMockActions(() => of(allDataWasLoaded())),
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

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectActiveWorkContext, themelessToday());
    store.refreshState();

    service = TestBed.inject(WorkContextService);
  });

  it('emits a real theme for a themeless active context instead of undefined', () => {
    const emitted: (WorkContextThemeCfg | undefined)[] = [];
    const sub = service.currentTheme$.subscribe((v) => emitted.push(v));

    expect(emitted.length).toBe(1);
    // The crash itself: consumers deref `.backgroundImageDark` / `.isAutoContrast`
    // on whatever this emits, so `undefined` here IS the bug.
    expect(emitted[0]).toBeDefined();
    // TODAY's OWN theme, not the generic tag default — proves the stream routes
    // through the id-aware fallback and not merely some non-null object.
    expect(emitted[0]).toEqual(TODAY_TAG.theme);
    expect(emitted[0]!.primary).not.toBe(DEFAULT_TAG.theme.primary);

    sub.unsubscribe();
  });
});

describe('resolveContextTheme()', () => {
  // NOTE: a plain USER tag id by default. System entities (TODAY, INBOX, …)
  // resolve to their own themes, so a system id here would silently stop these
  // cases from exercising the generic default.
  const buildCtx = (over: Record<string, unknown> = {}): WorkContext =>
    ({
      id: 'user-tag-1',
      title: 'User tag',
      type: WorkContextType.TAG,
      routerLink: 'tag/user-tag-1',
      taskIds: [],
      noteIds: [],
      color: null,
      theme: { ...WORK_CONTEXT_DEFAULT_THEME, primary: '#123456' },
      ...over,
    }) as unknown as WorkContext;

  describe('regression #9139: work context persisted with no theme', () => {
    // A tag/project entity stored without `theme` propagated `undefined` into
    // resolveBackground() and _setColorTheme(), crashing on every launch.
    // The crashing consumers were resolveBackground() (reads backgroundImage*)
    // and _setColorTheme() (reads isAutoContrast); both need a real object.
    it('returns the default tag theme instead of undefined', () => {
      const ctx = buildCtx();
      delete (ctx as unknown as Record<string, unknown>).theme;

      expect(resolveContextTheme(ctx)).toEqual(DEFAULT_TAG.theme);
      // A COPY, never the module constant itself — a consumer mutating what it
      // was handed would otherwise corrupt DEFAULT_TAG app-wide. Nothing
      // freezes these constants, so this is the only thing enforcing it.
      // (Safe for the stream: currentTheme$ dedups with isShallowEqual, which
      // compares key-by-key and does not short-circuit on reference.)
      expect(resolveContextTheme(ctx)).not.toBe(DEFAULT_TAG.theme);
    });

    it('returns the PROJECT default for a theme-less project', () => {
      // Must match what auto-fix-typia-errors would later persist, else a
      // theme-less project renders tag-purple then flips to project-teal.
      const ctx = buildCtx({ type: WorkContextType.PROJECT });
      delete (ctx as unknown as Record<string, unknown>).theme;

      expect(resolveContextTheme(ctx)).toEqual(DEFAULT_PROJECT.theme);
      expect(resolveContextTheme(ctx)).not.toBe(DEFAULT_PROJECT.theme);
    });

    it('handles an explicit null theme, not just a missing one', () => {
      const ctx = buildCtx({ theme: null });

      expect(resolveContextTheme(ctx)).toEqual(DEFAULT_TAG.theme);
    });

    // Regression: the read side was only type-aware while the on-disk heal was
    // id-aware, so a theme-less TODAY — the active context at startup —
    // rendered purple/tinted indefinitely (hydration validates but never
    // repairs) and then flipped once a sync repair landed. Both sides now
    // resolve through getDefaultWorkContextTheme.
    //
    // The loop below is driven from SYSTEM_ENTITY_THEMES itself so that a row
    // ADDED to the Map is automatically covered. The cost is that it is blind in
    // the other direction: deleting a row deletes its tests too, so they VANISH
    // (silently, 32 -> 28) rather than fail. This assertion is the other half —
    // it pins the roster so a removal is loud. Both halves are needed; neither
    // catches what the other does.
    it('covers exactly the known system entities', () => {
      expect([...SYSTEM_ENTITY_THEMES.keys()].sort()).toEqual(
        [TODAY_TAG.id, URGENT_TAG.id, IMPORTANT_TAG.id, INBOX_PROJECT.id].sort(),
      );
    });

    [...SYSTEM_ENTITY_THEMES.entries()].forEach(([entityId, theme]) => {
      const isTag = entityId !== INBOX_PROJECT.id;

      it(`gives ${entityId} its own theme, not the generic default`, () => {
        const ctx = buildCtx({
          id: entityId,
          type: isTag ? WorkContextType.TAG : WorkContextType.PROJECT,
        });
        delete (ctx as unknown as Record<string, unknown>).theme;

        expect(resolveContextTheme(ctx)).toEqual(theme);
        // System themes are module constants too — same aliasing hazard.
        expect(resolveContextTheme(ctx)).not.toBe(theme);
      });

      it(`${entityId} has a theme that renders differently from the generic default`, () => {
        const generic = isTag ? DEFAULT_TAG.theme : DEFAULT_PROJECT.theme;
        // OBSERVABLE difference, not raw field inequality: the background-image
        // fields reach the UI only through isBackgroundImageSet, so '' and null
        // are the same thing. Comparing raw values would call IN_PROGRESS_TAG
        // ('' vs null, nothing else) "different" and let an inert row back in.
        const observable = (t: WorkContextThemeCfg): Record<string, unknown> => ({
          ...t,
          backgroundImageDark: isBackgroundImageSet(t.backgroundImageDark),
          backgroundImageLight: isBackgroundImageSet(t.backgroundImageLight),
        });
        const a = observable(generic);
        const b = observable(theme);

        // If this fails the row is inert and should be DELETED, not kept —
        // IN_PROGRESS_TAG was removed for exactly this reason.
        expect(Object.keys({ ...a, ...b }).some((k) => a[k] !== b[k])).toBe(true);
      });
    });

    it('yields a COMPLETE theme when the tag-color fallback applies', () => {
      const ctx = buildCtx({ color: '#abcdef' });
      delete (ctx as unknown as Record<string, unknown>).theme;

      const res = resolveContextTheme(ctx);

      // Spreading an undefined theme would have produced just `{ primary }`.
      expect(res.primary).toBe('#abcdef');
      expect(res.accent).toBe(WORK_CONTEXT_DEFAULT_THEME.accent);
      expect(res.huePrimary).toBe(WORK_CONTEXT_DEFAULT_THEME.huePrimary);
    });
  });

  describe('existing behaviour is preserved', () => {
    it('keeps an explicit primary override over tag.color', () => {
      const res = resolveContextTheme(
        buildCtx({
          theme: { ...WORK_CONTEXT_DEFAULT_THEME, primary: '#explicit' },
          color: '#tagcolor',
        }),
      );
      expect(res.primary).toBe('#explicit');
    });

    it('falls back to tag.color when primary is still the auto-default', () => {
      const res = resolveContextTheme(
        buildCtx({
          theme: { ...WORK_CONTEXT_DEFAULT_THEME, primary: DEFAULT_TAG_COLOR },
          color: '#tagcolor',
        }),
      );
      expect(res.primary).toBe('#tagcolor');
    });

    it('does not apply the tag-color fallback for projects', () => {
      const res = resolveContextTheme(
        buildCtx({
          type: WorkContextType.PROJECT,
          theme: { ...WORK_CONTEXT_DEFAULT_THEME, primary: DEFAULT_TAG_COLOR },
          color: '#tagcolor',
        }),
      );
      expect(res.primary).toBe(DEFAULT_TAG_COLOR);
    });
  });
});
