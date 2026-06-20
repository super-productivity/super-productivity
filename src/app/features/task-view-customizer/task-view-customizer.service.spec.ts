import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TaskViewCustomizerService } from './task-view-customizer.service';
import { Project } from '../project/project.model';
import { Tag } from '../tag/tag.model';
import { TaskWithSubTasks } from '../tasks/task.model';
import { provideMockStore } from '@ngrx/store/testing';
import { selectAllProjects } from '../project/store/project.selectors';
import { getTomorrow } from '../../util/get-tomorrow';
import { getDbDateStr } from '../../util/get-db-date-str';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { selectAllTasksWithSubTasks } from '../tasks/store/task.selectors';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { MenuTreeService } from '../menu-tree/menu-tree.service';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
  GROUP_OPTION_TYPE,
  GroupOption,
  SORT_OPTION_TYPE,
  SORT_ORDER,
  SortOption,
} from './types';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_FIRST_DAY_OF_WEEK, DEFAULT_LOCALE } from 'src/app/core/locale.constants';
import { LS } from '../../core/persistence/storage-keys.const';
import { LanguageService } from 'src/app/core/language/language.service';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

describe('TaskViewCustomizerService', () => {
  let service: TaskViewCustomizerService;
  let mockWorkContextService: {
    activeWorkContextId: string | null;
    activeWorkContextType: WorkContextType | null;
    activeWorkContextTypeAndId$: Observable<{
      activeId: string;
      activeType: WorkContextType;
    }>;
    isActiveWorkContextProject$: Observable<boolean>;
    mainListTasks$: Observable<TaskWithSubTasks[]>;
    undoneTasks$: Observable<TaskWithSubTasks[]>;
  };
  let projectUpdateSpy: jasmine.Spy;
  let tagUpdateSpy: jasmine.Spy;
  // Stand-in for the sidebar (menu-tree) order. Defaults to identity so tags keep
  // their _allTags order; individual tests override it to assert a custom order.
  let menuTreeFlattenFn: (tags: Tag[]) => Tag[];
  const mockLanguageService = { detect: () => DEFAULT_LOCALE };

  const todayStr = getDbDateStr(new Date());
  const tomorrowStr = getDbDateStr(getTomorrow());

  const mockProjects: Project[] = [
    { id: 'Project A', title: 'Project A' } as Project,
    { id: 'Project B', title: 'Project B' } as Project,
  ];
  const mockTags: Tag[] = [
    { id: 'Tag A', title: 'Tag A' } as Tag,
    { id: 'Tag B', title: 'Tag B' } as Tag,
  ];
  const mockTasks: TaskWithSubTasks[] = [
    {
      id: 'Alpha(Tag A)',
      title: 'Alpha',
      tagIds: ['Tag A'],
      projectId: 'Project A',
      dueDay: tomorrowStr,
      timeEstimate: 60000,
      timeSpentOnDay: { [tomorrowStr]: 60000 },
      created: 1,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 60000,
      isDone: false,
      attachments: [],
    },
    {
      id: 'Beta(Tag B)',
      title: 'Beta',
      tagIds: ['Tag B'],
      projectId: 'Project B',
      dueDay: todayStr,
      timeEstimate: 120000,
      timeSpentOnDay: { [todayStr]: 120000 },
      created: 2,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 120000,
      isDone: false,
      attachments: [],
    },
    {
      id: 'Third Task(Tag A, Tag B)',
      title: 'Third Task',
      tagIds: ['Tag A', 'Tag B'],
      projectId: '',
      dueDay: todayStr,
      timeEstimate: 120000,
      timeSpentOnDay: { [todayStr]: 120000 },
      created: 3,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 120000,
      isDone: false,
      attachments: [],
    },
    {
      id: 'Zebra(-)',
      title: 'Zebra',
      tagIds: [],
      projectId: 'Project A',
      dueDay: todayStr,
      timeEstimate: 0,
      timeSpentOnDay: { [todayStr]: 0 },
      created: 4,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 0,
      isDone: false,
      attachments: [],
    },
  ];

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    menuTreeFlattenFn = (tags) => tags;

    mockWorkContextService = {
      activeWorkContextId: null,
      activeWorkContextType: null,
      activeWorkContextTypeAndId$: of({
        activeId: 'TODAY',
        activeType: WorkContextType.TAG,
      }),
      isActiveWorkContextProject$: of(false),
      mainListTasks$: of<TaskWithSubTasks[]>([]),
      undoneTasks$: of<TaskWithSubTasks[]>([]),
    };
    projectUpdateSpy = jasmine.createSpy('update');
    tagUpdateSpy = jasmine.createSpy('updateTag');
    const dateAdapter = jasmine.createSpyObj<DateAdapter<Date>>('DateAdapter', [], {
      getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: LanguageService,
          useValue: mockLanguageService,
        },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k },
        },
        TaskViewCustomizerService,
        { provide: DateAdapter, useValue: dateAdapter },
        { provide: WorkContextService, useValue: mockWorkContextService },
        { provide: ProjectService, useValue: { update: projectUpdateSpy } },
        {
          provide: TagService,
          useValue: { updateTag: tagUpdateSpy, tagsInTreeOrder: signal(mockTags) },
        },
        {
          provide: MenuTreeService,
          useValue: { buildTagListInTreeOrder: (tags: Tag[]) => menuTreeFlattenFn(tags) },
        },
        provideMockStore({
          selectors: [{ selector: selectAllProjects, value: mockProjects }],
        }),
      ],
    });
    service = TestBed.inject(TaskViewCustomizerService);
    (service as any)._allProjects = mockProjects;
    (service as any)._allTags = mockTags;
  });

  it('should filter by tag name', () => {
    const filtered = service['applyFilter'](mockTasks, FILTER_OPTION_TYPE.tag, 'Tag A');
    expect(filtered.length).toBe(2);
    expect(filtered[0].id).toBe('Alpha(Tag A)');
    expect(filtered[1].id).toBe('Third Task(Tag A, Tag B)');
  });

  it('should return an empty task list when filtering by a tag that doesnt exist', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.tag,
      'Tag Three',
    );
    expect(filtered.length).toBe(0);
  });

  it('should not filter when filtering with an empty tag input', () => {
    const filtered = service['applyFilter'](mockTasks, FILTER_OPTION_TYPE.tag, '');
    expect(filtered.length).toBe(4);
  });

  it('should filter by NOT_SPECIFIED tag (no tags)', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.tag,
      FILTER_COMMON.NOT_SPECIFIED,
    );
    expect(filtered.length).toBe(1);
  });

  it('should filter by project name', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.project,
      'Project B',
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('Beta(Tag B)');
  });

  it('should filter by schedule date', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.scheduledDate,
      FILTER_SCHEDULE.tomorrow,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('Alpha(Tag A)');
  });

  it('should filter by NOT_SPECIFIED schedule date (no schedule date)', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.scheduledDate,
      FILTER_COMMON.NOT_SPECIFIED,
    );
    expect(filtered.length).toBe(0);
  });

  it('should filter by NOT_SPECIFIED timeSpent (no timeSpent)', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.timeSpent,
      FILTER_COMMON.NOT_SPECIFIED,
    );
    expect(filtered.length).toBe(1);
  });

  it('should filter by NOT_SPECIFIED estimatedTime (no estimatedTime)', () => {
    const filtered = service['applyFilter'](
      mockTasks,
      FILTER_OPTION_TYPE.estimatedTime,
      FILTER_COMMON.NOT_SPECIFIED,
    );
    expect(filtered.length).toBe(1);
  });

  it('should sort by name', () => {
    const sorted = {
      asc: service['applySort'](mockTasks, SORT_OPTION_TYPE.name),
      desc: service['applySort'](mockTasks, SORT_OPTION_TYPE.name, SORT_ORDER.DESC),
    };

    expect(sorted.asc[0].title).toBe('Alpha');
    expect(sorted.asc[1].title).toBe('Beta');
    expect(sorted.desc[0].title).toBe('Zebra');
    expect(sorted.desc[1].title).toBe('Third Task');
  });

  it('should sort numeric prefixes in title correctly', () => {
    const numericTasks: TaskWithSubTasks[] = [
      {
        id: 't1',
        title: '1 task',
        tagIds: [],
        projectId: 'Project A',
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 't2',
        title: '10 task',
        tagIds: [],
        projectId: 'Project A',
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 't3',
        title: '11 task',
        tagIds: [],
        projectId: 'Project A',
        created: 3,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 't4',
        title: '2 task',
        tagIds: [],
        projectId: 'Project A',
        created: 4,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 't5',
        title: '3 task',
        tagIds: [],
        projectId: 'Project A',
        created: 5,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
    ];

    const sorted = service['applySort'](numericTasks, SORT_OPTION_TYPE.name);

    expect(sorted.map((t) => t.title)).toEqual([
      '1 task',
      '2 task',
      '3 task',
      '10 task',
      '11 task',
    ]);
  });

  it('should sort by primary-tag sidebar order, keeping manual order within a tag', () => {
    (service as unknown as { _allTags: Tag[] })._allTags = [
      { id: 'Tag B', title: 'Tag B' } as Tag,
      { id: 'Tag A', title: 'Tag A' } as Tag,
    ];
    const extra: TaskWithSubTasks[] = [
      {
        id: 'Aardvark(-)',
        title: 'Aardvark',
        tagIds: [],
        projectId: 'Project A',
        created: 4,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
    ];
    // Input order is deliberately anti-alphabetical within each tag group
    // (Third Task before Beta in Tag B; Zebra before Aardvark when untagged) so
    // the assertions fail under the old by-title tie-break, not just by luck.
    const arr: TaskWithSubTasks[] = [
      mockTasks[0], // Alpha (Tag A)
      mockTasks[2], // Third Task (Tag A, Tag B) -> primary Tag B
      mockTasks[1], // Beta (Tag B)
      mockTasks[3], // Zebra (untagged)
      ...extra, // Aardvark (untagged)
    ];

    const sorted = {
      asc: service['applySort'](arr, SORT_OPTION_TYPE.tag, SORT_ORDER.ASC),
      desc: service['applySort'](arr, SORT_OPTION_TYPE.tag, SORT_ORDER.DESC),
    };

    // Tag groups follow sidebar order ([Tag B, Tag A]) and flip with the
    // direction, but within a group the input (manual) order is preserved -
    // it does NOT re-sort by task title, so DESC is not a plain reverse.
    const resultAsc = [
      'Third Task(Tag A, Tag B)',
      'Beta(Tag B)',
      'Alpha(Tag A)',
      'Zebra(-)',
      'Aardvark(-)',
    ];
    const resultDesc = [
      'Zebra(-)',
      'Aardvark(-)',
      'Alpha(Tag A)',
      'Third Task(Tag A, Tag B)',
      'Beta(Tag B)',
    ];

    expect(sorted.asc.map((t) => t.id)).toEqual(resultAsc);
    expect(sorted.desc.map((t) => t.id)).toEqual(resultDesc);
  });

  it('should sort tasks with unknown tag ids after known tree-ordered tags', () => {
    (service as unknown as { _allTags: Tag[] })._allTags = [
      { id: 'Tag B', title: 'Tag B' } as Tag,
      { id: 'Tag A', title: 'Tag A' } as Tag,
    ];
    const tasks: TaskWithSubTasks[] = [
      {
        id: 'unknown-tag',
        title: 'Unknown tag task',
        tagIds: ['missing-tag'],
        projectId: 'Project A',
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 'known-a',
        title: 'Known A task',
        tagIds: ['Tag A'],
        projectId: 'Project A',
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 'known-b',
        title: 'Known B task',
        tagIds: ['Tag B'],
        projectId: 'Project A',
        created: 3,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 'no-tag',
        title: 'No tag task',
        tagIds: [],
        projectId: 'Project A',
        created: 4,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
    ];

    const sorted = service['applySort'](tasks, SORT_OPTION_TYPE.tag, SORT_ORDER.ASC);

    expect(sorted.map((t) => t.id)).toEqual([
      'known-b',
      'known-a',
      'unknown-tag',
      'no-tag',
    ]);
  });

  it('should keep manual order for tasks with the same primary tag', () => {
    const samePrimary: TaskWithSubTasks[] = [
      {
        id: 'tA',
        title: 'Zed',
        tagIds: ['Tag A'],
        projectId: 'Project A',
        created: 10,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
      {
        id: 'tB',
        title: 'Alpha2',
        tagIds: ['Tag A'],
        projectId: 'Project A',
        created: 11,
        subTasks: [],
        subTaskIds: [],
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      },
    ];
    const asc = service['applySort'](samePrimary, SORT_OPTION_TYPE.tag, SORT_ORDER.ASC);
    const desc = service['applySort'](samePrimary, SORT_OPTION_TYPE.tag, SORT_ORDER.DESC);

    // Input order is preserved (tA="Zed" before tB="Alpha2") rather than re-sorted
    // by title, and the direction does not re-order within a tag: ASC === DESC.
    // (Under the old by-title tie-break these would differ: ASC=[tB,tA], DESC=[tA,tB].)
    expect(asc.map((t) => t.id)).toEqual(['tA', 'tB']);
    expect(desc.map((t) => t.id)).toEqual(['tA', 'tB']);
  });

  it('should group by tag', () => {
    (service as unknown as { _allTags: Tag[] })._allTags = [
      { id: 'Tag B', title: 'Tag B' } as Tag,
      { id: 'Tag A', title: 'Tag A' } as Tag,
    ];
    const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.tag);
    expect(Object.keys(grouped)).toEqual(['Tag B', 'Tag A', 'No tag']);
    expect(grouped['Tag A'][0].id).toBe('Alpha(Tag A)');
    expect(grouped['Tag B'][0].id).toBe('Beta(Tag B)');
  });

  it('should group by project', () => {
    const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.project);
    expect(Object.keys(grouped)).toContain('Project A');
    expect(Object.keys(grouped)).toContain('Project B');
    expect(grouped['Project A'][0].id).toBe('Alpha(Tag A)');
    expect(grouped['Project B'][0].id).toBe('Beta(Tag B)');
  });

  it('should group by tag with a task in two groups', () => {
    const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.tag);
    expect(Object.keys(grouped)).toContain('Tag A');
    expect(Object.keys(grouped)).toContain('Tag B');
    expect(grouped['Tag A'][0].id).toBe('Alpha(Tag A)');
    expect(grouped['Tag A'][1].id).toBe('Third Task(Tag A, Tag B)');
    expect(grouped['Tag B'][0].id).toBe('Beta(Tag B)');
    expect(grouped['Tag B'][1].id).toBe('Third Task(Tag A, Tag B)');
  });

  it('should merge distinct tags that share a title into a single group', () => {
    // Two different tag entities can carry the same title; their tasks must all
    // land in the single title-keyed bucket instead of one tag overwriting the
    // other (regression: the second tag used to clobber the first's tasks).
    (service as unknown as { _allTags: Tag[] })._allTags = [
      { id: 'work-1', title: 'Work' } as Tag,
      { id: 'work-2', title: 'Work' } as Tag,
    ];
    const tasks = [
      { ...mockTasks[0], id: 'task-work-1', tagIds: ['work-1'] },
      { ...mockTasks[0], id: 'task-work-2', tagIds: ['work-2'] },
    ] as TaskWithSubTasks[];

    const grouped = service['applyGrouping'](tasks, GROUP_OPTION_TYPE.tag);

    expect(Object.keys(grouped)).toEqual(['Work']);
    expect(grouped['Work'].map((t) => t.id)).toEqual(['task-work-1', 'task-work-2']);
  });

  it('should group by scheduledDate using dueDay', () => {
    const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.scheduledDate);
    expect(Object.keys(grouped)).toContain(todayStr);
    expect(Object.keys(grouped)).toContain(tomorrowStr);
    expect(grouped[tomorrowStr].length).toBe(1);
    expect(grouped[todayStr].length).toBe(3);
  });

  it('should group by scheduledDate using dueWithTime when dueDay is not set', () => {
    const tomorrowTimestamp = getTomorrow().getTime();
    const taskWithTime: TaskWithSubTasks = {
      id: 'task-with-time',
      title: 'Task with time',
      tagIds: [],
      projectId: 'Project A',
      dueWithTime: tomorrowTimestamp,
      timeEstimate: 0,
      timeSpentOnDay: {},
      created: 5,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 0,
      isDone: false,
      attachments: [],
    };

    const tasksWithTimeTask = [...mockTasks, taskWithTime];
    const grouped = service['applyGrouping'](
      tasksWithTimeTask,
      GROUP_OPTION_TYPE.scheduledDate,
    );

    expect(Object.keys(grouped)).toContain(tomorrowStr);
    expect(grouped[tomorrowStr].length).toBe(2);
    expect(grouped[tomorrowStr].some((t) => t.id === 'task-with-time')).toBe(true);
  });

  it('should group tasks with no schedule into "No date" group', () => {
    const taskWithoutSchedule: TaskWithSubTasks = {
      id: 'task-no-date',
      title: 'Task without date',
      tagIds: [],
      projectId: 'Project A',
      timeEstimate: 0,
      timeSpentOnDay: {},
      created: 6,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 0,
      isDone: false,
      attachments: [],
    };

    const grouped = service['applyGrouping'](
      [taskWithoutSchedule],
      GROUP_OPTION_TYPE.scheduledDate,
    );
    expect(Object.keys(grouped)).toContain('No date');
    expect(grouped['No date'].length).toBe(1);
    expect(grouped['No date'][0].id).toBe('task-no-date');
  });

  describe('tag order matches the sidebar (issue #8400)', () => {
    beforeEach(() => {
      // Sidebar order that is intentionally NOT alphabetical: Tag B before Tag A.
      menuTreeFlattenFn = () => [mockTags[1], mockTags[0]];
    });

    it('should sort by tag following the sidebar order, not alphabetically', () => {
      const sorted = service['applySort'](
        mockTasks,
        SORT_OPTION_TYPE.tag,
        SORT_ORDER.ASC,
      );
      // Tag B leads the sidebar, so its task comes first; the multi-tag task is
      // placed by its highest-priority (lowest-index) tag, which is Tag B.
      expect(sorted.map((t) => t.id)).toEqual([
        'Beta(Tag B)',
        'Third Task(Tag A, Tag B)',
        'Alpha(Tag A)',
        'Zebra(-)',
      ]);
    });

    it('should order tag group headers by sidebar order with untagged last', () => {
      service.selectedGroup.set({ type: GROUP_OPTION_TYPE.tag } as GroupOption);
      const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.tag);

      expect(service.getOrderedGroupKeys(grouped)).toEqual(['Tag B', 'Tag A', 'No tag']);
    });

    it('should keep non-tag group headers in ascending order', () => {
      service.selectedGroup.set({ type: GROUP_OPTION_TYPE.project } as GroupOption);
      const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.project);

      expect(service.getOrderedGroupKeys(grouped)).toEqual([
        'No project',
        'Project A',
        'Project B',
      ]);
    });
  });

  // === DEADLINE FILTER ===

  it('should filter by deadline today using deadlineDay', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-tomorrow',
        title: 'Due tomorrow',
        tagIds: [],
        projectId: '',
        deadlineDay: tomorrowStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const filtered = service['applyFilter'](
      deadlineTasks,
      FILTER_OPTION_TYPE.deadline,
      FILTER_SCHEDULE.today,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('dl-today');
  });

  it('should filter by deadline using deadlineWithTime when deadlineDay is not set', () => {
    const todayTimestamp = new Date().getTime();
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-with-time',
        title: 'Due today with time',
        tagIds: [],
        projectId: '',
        deadlineWithTime: todayTimestamp,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const filtered = service['applyFilter'](
      deadlineTasks,
      FILTER_OPTION_TYPE.deadline,
      FILTER_SCHEDULE.today,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('dl-with-time');
  });

  it('should filter by NOT_SPECIFIED deadline (no deadline)', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-set',
        title: 'Has deadline',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-none',
        title: 'No deadline',
        tagIds: [],
        projectId: '',
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const filtered = service['applyFilter'](
      deadlineTasks,
      FILTER_OPTION_TYPE.deadline,
      FILTER_COMMON.NOT_SPECIFIED,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('dl-none');
  });

  it('should filter by deadline tomorrow', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-tomorrow',
        title: 'Due tomorrow',
        tagIds: [],
        projectId: '',
        deadlineDay: tomorrowStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const filtered = service['applyFilter'](
      deadlineTasks,
      FILTER_OPTION_TYPE.deadline,
      FILTER_SCHEDULE.tomorrow,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('dl-tomorrow');
  });

  // === DEADLINE SORT ===

  it('should sort by deadline ASC', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-tomorrow',
        title: 'Due tomorrow',
        tagIds: [],
        projectId: '',
        deadlineDay: tomorrowStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const sorted = service['applySort'](
      deadlineTasks,
      SORT_OPTION_TYPE.deadline,
      SORT_ORDER.ASC,
    );
    expect(sorted[0].id).toBe('dl-today');
    expect(sorted[1].id).toBe('dl-tomorrow');
  });

  it('should sort by deadline DESC', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-tomorrow',
        title: 'Due tomorrow',
        tagIds: [],
        projectId: '',
        deadlineDay: tomorrowStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const sorted = service['applySort'](
      deadlineTasks,
      SORT_OPTION_TYPE.deadline,
      SORT_ORDER.DESC,
    );
    expect(sorted[0].id).toBe('dl-tomorrow');
    expect(sorted[1].id).toBe('dl-today');
  });

  it('should sort tasks without deadline to the end when sorting by deadline', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-none',
        title: 'No deadline',
        tagIds: [],
        projectId: '',
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const sorted = service['applySort'](
      deadlineTasks,
      SORT_OPTION_TYPE.deadline,
      SORT_ORDER.ASC,
    );
    expect(sorted[0].id).toBe('dl-today');
    expect(sorted[1].id).toBe('dl-none');
  });

  // === DEADLINE GROUPING ===

  it('should group by deadline using deadlineDay', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-today',
        title: 'Due today',
        tagIds: [],
        projectId: '',
        deadlineDay: todayStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
      {
        id: 'dl-tomorrow',
        title: 'Due tomorrow',
        tagIds: [],
        projectId: '',
        deadlineDay: tomorrowStr,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 2,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const grouped = service['applyGrouping'](deadlineTasks, GROUP_OPTION_TYPE.deadline);
    expect(Object.keys(grouped)).toContain(todayStr);
    expect(Object.keys(grouped)).toContain(tomorrowStr);
    expect(grouped[todayStr].length).toBe(1);
    expect(grouped[tomorrowStr].length).toBe(1);
  });

  it('should group by deadline using deadlineWithTime when deadlineDay is not set', () => {
    const tomorrowTimestamp = getTomorrow().getTime();
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-with-time',
        title: 'Due tomorrow with time',
        tagIds: [],
        projectId: '',
        deadlineWithTime: tomorrowTimestamp,
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const grouped = service['applyGrouping'](deadlineTasks, GROUP_OPTION_TYPE.deadline);
    expect(Object.keys(grouped)).toContain(tomorrowStr);
    expect(grouped[tomorrowStr].length).toBe(1);
  });

  it('should group tasks without deadline into translated fallback group', () => {
    const deadlineTasks: TaskWithSubTasks[] = [
      {
        id: 'dl-none',
        title: 'No deadline task',
        tagIds: [],
        projectId: '',
        timeEstimate: 0,
        timeSpentOnDay: {},
        created: 1,
        subTasks: [],
        subTaskIds: [],
        timeSpent: 0,
        isDone: false,
        attachments: [],
      },
    ];

    const grouped = service['applyGrouping'](deadlineTasks, GROUP_OPTION_TYPE.deadline);
    // The mock TranslateService returns the key as-is
    expect(Object.keys(grouped)).toContain('F.TASK_VIEW.CUSTOMIZER.GROUP_DEADLINE_NONE');
    expect(grouped['F.TASK_VIEW.CUSTOMIZER.GROUP_DEADLINE_NONE'].length).toBe(1);
  });

  it('should reset all customizer values to default', () => {
    service.selectedSort.set({ type: SORT_OPTION_TYPE.name } as SortOption);
    service.selectedGroup.set({ type: GROUP_OPTION_TYPE.tag } as GroupOption);
    service.selectedFilter.set({
      type: FILTER_OPTION_TYPE.project,
      preset: 'something',
    } as FilterOption);

    service.resetAll();

    expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
    expect(service.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
    expect(service.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
  });

  describe('saveSort', () => {
    const createTask = (
      id: string,
      title: string,
      projectId: string | null = 'project-sort',
    ): TaskWithSubTasks =>
      ({
        id,
        title,
        projectId: projectId ?? undefined,
        tagIds: [],
        subTasks: [],
        subTaskIds: [],
        created: 0,
        timeEstimate: 0,
        timeSpent: 0,
        timeSpentOnDay: {},
        isDone: false,
        attachments: [],
      }) as TaskWithSubTasks;

    beforeEach(() => {
      projectUpdateSpy.calls.reset();
      tagUpdateSpy.calls.reset();
      service.resetAll();
    });

    it('should save the sorted order for a project context as default', async () => {
      const taskA = createTask('a', 'Alpha');
      const taskB = createTask('b', 'Bravo');

      mockWorkContextService.activeWorkContextId = 'project-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.PROJECT;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);

      service.setSort({
        type: SORT_OPTION_TYPE.name,
        order: SORT_ORDER.ASC,
      } as SortOption);

      const expectedFilter = {
        type: FILTER_OPTION_TYPE.tag,
        preset: 'Tag A',
      } as FilterOption;
      service.setFilter(expectedFilter);

      const expectedGroup = { type: GROUP_OPTION_TYPE.project } as GroupOption;
      service.setGroup(expectedGroup);

      await service.saveSort();

      expect(projectUpdateSpy).toHaveBeenCalledTimes(1);
      expect(projectUpdateSpy).toHaveBeenCalledWith('project-sort', {
        taskIds: ['a', 'b'],
      });
      expect(tagUpdateSpy).not.toHaveBeenCalled();

      // Sort should set to default after saving, as the order is now persisted in the project
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);

      // Filter and group should NOT be reset
      expect(service.selectedFilter()).toEqual(expectedFilter);
      expect(service.selectedGroup()).toEqual(expectedGroup);
    });

    it('should save the sorted order for a tag context as default', async () => {
      const taskA = createTask('a', 'Alpha', null);
      const taskB = createTask('b', 'Bravo', null);

      mockWorkContextService.activeWorkContextId = 'tag-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.TAG;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);

      service.setSort({ type: SORT_OPTION_TYPE.name } as SortOption);

      await service.saveSort();

      expect(tagUpdateSpy).toHaveBeenCalledTimes(1);
      expect(tagUpdateSpy).toHaveBeenCalledWith('tag-sort', {
        taskIds: ['a', 'b'],
      });
      expect(projectUpdateSpy).not.toHaveBeenCalled();
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
    });

    it('should skip saving when no tasks available', async () => {
      mockWorkContextService.activeWorkContextId = 'project-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.PROJECT;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([]);

      service.setSort({ type: SORT_OPTION_TYPE.name } as SortOption);

      await service.saveSort();

      expect(projectUpdateSpy).not.toHaveBeenCalled();
      expect(tagUpdateSpy).not.toHaveBeenCalled();
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
    });
  });

  describe('per-context localStorage persistence (issue #7262)', () => {
    const savedSort: SortOption = {
      type: SORT_OPTION_TYPE.name,
      order: SORT_ORDER.ASC,
      label: 'Name',
    };
    const savedGroup: GroupOption = { type: GROUP_OPTION_TYPE.tag, label: 'Tag' };
    const savedFilter: FilterOption = {
      type: FILTER_OPTION_TYPE.tag,
      preset: 'Tag A',
      label: 'Tag',
    };
    const restoredSavedFilter: FilterOption = {
      ...savedFilter,
      label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_TAG,
    };

    const buildService = (
      ctx$: Observable<{ activeId: string; activeType: WorkContextType }>,
    ): TaskViewCustomizerService => {
      TestBed.resetTestingModule();
      const dateAdapter = jasmine.createSpyObj<DateAdapter<Date>>('DateAdapter', [], {
        getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
      });
      TestBed.configureTestingModule({
        providers: [
          TaskViewCustomizerService,
          { provide: LanguageService, useValue: mockLanguageService },
          { provide: TranslateService, useValue: { instant: (k: string) => k } },
          { provide: DateAdapter, useValue: dateAdapter },
          {
            provide: WorkContextService,
            useValue: {
              activeWorkContextId: null,
              activeWorkContextType: null,
              activeWorkContextTypeAndId$: ctx$,
              isActiveWorkContextProject$: ctx$.pipe(
                map(({ activeType }) => activeType === WorkContextType.PROJECT),
              ),
              mainListTasks$: of<TaskWithSubTasks[]>([]),
              undoneTasks$: of<TaskWithSubTasks[]>([]),
            },
          },
          { provide: ProjectService, useValue: { update: projectUpdateSpy } },
          {
            provide: TagService,
            useValue: { updateTag: tagUpdateSpy, tagsInTreeOrder: signal(mockTags) },
          },
          {
            provide: MenuTreeService,
            useValue: { buildTagListInTreeOrder: (tags: Tag[]) => tags },
          },
          provideMockStore({
            selectors: [{ selector: selectAllProjects, value: mockProjects }],
          }),
        ],
      });
      return TestBed.inject(TaskViewCustomizerService);
    };

    it('should initialize with default values when localStorage is empty', () => {
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
      expect(service.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
      expect(service.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
    });

    it('should restore state for the active context from localStorage on init', () => {
      const todayKey = `${WorkContextType.TAG}:TODAY`;
      localStorage.setItem(
        LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT,
        JSON.stringify({
          [todayKey]: {
            sort: savedSort,
            group: savedGroup,
            filter: savedFilter,
          },
        }),
      );

      const newService = buildService(
        of({ activeId: 'TODAY', activeType: WorkContextType.TAG }),
      );

      expect(newService.selectedSort()).toEqual(savedSort);
      expect(newService.selectedGroup()).toEqual(savedGroup);
      expect(newService.selectedFilter()).toEqual(restoredSavedFilter);
    });

    it('should load defaults for a context with no saved state', () => {
      const projectAKey = `${WorkContextType.PROJECT}:Project A`;
      localStorage.setItem(
        LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT,
        JSON.stringify({
          [projectAKey]: {
            sort: savedSort,
            group: savedGroup,
            filter: savedFilter,
          },
        }),
      );

      const newService = buildService(
        of({ activeId: 'TODAY', activeType: WorkContextType.TAG }),
      );

      expect(newService.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
      expect(newService.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
      expect(newService.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
    });

    it('should persist per-context state when options change', (done) => {
      service.setFilter(savedFilter);

      setTimeout(() => {
        const stored = localStorage.getItem(LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT);
        expect(stored).toBeTruthy();
        const parsed = JSON.parse(stored!);
        expect(parsed[`${WorkContextType.TAG}:TODAY`].filter).toEqual(savedFilter);
        done();
      }, 50);
    });

    it('should load/save separately per context on switch and restore on return', (done) => {
      const ctx$ = new BehaviorSubject<{
        activeId: string;
        activeType: WorkContextType;
      }>({ activeId: 'TODAY', activeType: WorkContextType.TAG });
      const newService = buildService(ctx$.asObservable());

      newService.setFilter(savedFilter);

      setTimeout(() => {
        // Switch to Project A — should load defaults (no saved state)
        ctx$.next({ activeId: 'Project A', activeType: WorkContextType.PROJECT });
        expect(newService.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);

        // Return to TODAY — saved filter should be restored
        ctx$.next({ activeId: 'TODAY', activeType: WorkContextType.TAG });
        expect(newService.selectedFilter()).toEqual(restoredSavedFilter);
        done();
      }, 50);
    });

    it('should fallback to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem(LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT, 'invalid json{');

      const newService = buildService(
        of({ activeId: 'TODAY', activeType: WorkContextType.TAG }),
      );

      expect(newService.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
      expect(newService.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
      expect(newService.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
    });
  });

  describe('customizeUndoneTasks respects current work context (issue #7279)', () => {
    const projectATask: TaskWithSubTasks = {
      id: 'project-a-task',
      title: 'Project A Task',
      tagIds: ['Tag A'],
      projectId: 'Project A',
      timeEstimate: 0,
      timeSpentOnDay: {},
      created: 1,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 0,
      isDone: false,
      attachments: [],
    } as TaskWithSubTasks;

    const projectBTask: TaskWithSubTasks = {
      id: 'project-b-task',
      title: 'Project B Task',
      tagIds: ['Tag B'],
      projectId: 'Project B',
      timeEstimate: 0,
      timeSpentOnDay: {},
      created: 2,
      subTasks: [],
      subTaskIds: [],
      timeSpent: 0,
      isDone: false,
      attachments: [],
    } as TaskWithSubTasks;

    const allProjects: Project[] = [
      { id: 'Project A', title: 'Project A', backlogTaskIds: [] } as unknown as Project,
      { id: 'Project B', title: 'Project B', backlogTaskIds: [] } as unknown as Project,
    ];

    let testService: TaskViewCustomizerService;

    beforeEach(() => {
      localStorage.clear();

      TestBed.resetTestingModule();
      const dateAdapter = jasmine.createSpyObj<DateAdapter<Date>>('DateAdapter', [], {
        getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
      });

      mockWorkContextService = {
        activeWorkContextId: 'Project A',
        activeWorkContextType: WorkContextType.PROJECT,
        activeWorkContextTypeAndId$: of({
          activeId: 'Project A',
          activeType: WorkContextType.PROJECT,
        }),
        isActiveWorkContextProject$: of(true),
        mainListTasks$: of<TaskWithSubTasks[]>([projectATask]),
        undoneTasks$: of<TaskWithSubTasks[]>([projectATask]),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskViewCustomizerService,
          {
            provide: LanguageService,
            useValue: mockLanguageService,
          },
          {
            provide: TranslateService,
            useValue: { instant: (k: string) => k },
          },
          { provide: DateAdapter, useValue: dateAdapter },
          { provide: WorkContextService, useValue: mockWorkContextService },
          { provide: ProjectService, useValue: { update: projectUpdateSpy } },
          {
            provide: TagService,
            useValue: { updateTag: tagUpdateSpy, tagsInTreeOrder: signal(mockTags) },
          },
          {
            provide: MenuTreeService,
            useValue: { buildTagListInTreeOrder: (tags: Tag[]) => tags },
          },
          provideMockStore({
            selectors: [
              { selector: selectAllProjects, value: allProjects },
              {
                selector: selectAllTasksWithSubTasks,
                value: [projectATask, projectBTask],
              },
            ],
          }),
        ],
      });
      testService = TestBed.inject(TaskViewCustomizerService);
      (testService as any)._allProjects = allProjects;
      (testService as any)._allTags = mockTags;
    });

    it('should only group tasks from the current project when group by tag is selected', (done) => {
      // User is in Project A — undoneTasks$ only has Project A's task
      const contextUndoneTasks$ = of<TaskWithSubTasks[]>([projectATask]);

      testService.setGroup({ type: GROUP_OPTION_TYPE.tag, label: 'Tag' });

      const result$ = TestBed.runInInjectionContext(() =>
        testService.customizeUndoneTasks(contextUndoneTasks$),
      );

      requestAnimationFrame(() => {
        result$.subscribe((result) => {
          expect(result.grouped).toBeDefined();
          // Project B's task must NOT leak into the view
          expect(result.list.map((t) => t.id)).toEqual(['project-a-task']);
          expect(Object.keys(result.grouped!)).toEqual(['Tag A']);
          expect(result.grouped!['Tag A']?.length).toBe(1);
          expect(result.grouped!['Tag A']?.[0].id).toBe('project-a-task');
          done();
        });
      });
    });

    it('should only group tasks from the current project when group by project is selected', (done) => {
      // Edge case: even though the panel hides this option in a project context,
      // the service must still scope to the current context if it's set.
      const contextUndoneTasks$ = of<TaskWithSubTasks[]>([projectATask]);

      testService.setGroup({ type: GROUP_OPTION_TYPE.project, label: 'Project' });

      const result$ = TestBed.runInInjectionContext(() =>
        testService.customizeUndoneTasks(contextUndoneTasks$),
      );

      requestAnimationFrame(() => {
        result$.subscribe((result) => {
          expect(result.grouped).toBeDefined();
          const groupKeys = Object.keys(result.grouped!);
          expect(groupKeys).toEqual(['Project A']);
          expect(groupKeys).not.toContain('Project B');
          done();
        });
      });
    });
  });

  describe('collapsedGroupIds', () => {
    it('should toggle group expansion', () => {
      service.toggleGroupExpansion('group1');
      expect(service.collapsedGroupIds()).toContain('group1');
      service.toggleGroupExpansion('group1');
      expect(service.collapsedGroupIds()).not.toContain('group1');
    });

    it('should persist collapsedGroupIds to localStorage', (done) => {
      service.toggleGroupExpansion('group2');

      // The effect is async, so we wait a bit
      setTimeout(() => {
        const stored = JSON.parse(
          localStorage.getItem(LS.TASK_VIEW_CUSTOMIZER_BY_CONTEXT) || '{}',
        );
        expect(stored['TAG:TODAY'].collapsedGroupIds).toContain('group2');
        done();
      }, 50);
    });
  });
});
