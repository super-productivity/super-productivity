import { TestBed } from '@angular/core/testing';
import { TaskViewCustomizerService } from './task-view-customizer.service';
import { Project } from '../project/project.model';
import { Tag } from '../tag/tag.model';
import { TaskWithSubTasks } from '../tasks/task.model';
import { provideMockStore } from '@ngrx/store/testing';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTags } from '../tag/store/tag.reducer';
import { getTomorrow } from '../../util/get-tomorrow';
import { getDbDateStr } from '../../util/get-db-date-str';
import { Observable, of } from 'rxjs';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
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
import { DEFAULT_FIRST_DAY_OF_WEEK } from 'src/app/core/locale.constants';

describe('TaskViewCustomizerService', () => {
  let service: TaskViewCustomizerService;
  let mockWorkContextService: {
    activeWorkContextId: string | null;
    activeWorkContextType: WorkContextType | null;
    mainListTasks$: Observable<TaskWithSubTasks[]>;
    undoneTasks$: Observable<TaskWithSubTasks[]>;
  };
  let projectUpdateSpy: jasmine.Spy;
  let tagUpdateSpy: jasmine.Spy;

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
    } as TaskWithSubTasks,
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
    } as TaskWithSubTasks,
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
    } as TaskWithSubTasks,
  ];

  beforeEach(() => {
    mockWorkContextService = {
      activeWorkContextId: null,
      activeWorkContextType: null,
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
        TaskViewCustomizerService,
        { provide: DateAdapter, useValue: dateAdapter },
        { provide: WorkContextService, useValue: mockWorkContextService },
        { provide: ProjectService, useValue: { update: projectUpdateSpy } },
        { provide: TagService, useValue: { updateTag: tagUpdateSpy } },
        provideMockStore({
          selectors: [
            { selector: selectAllProjects, value: mockProjects },
            { selector: selectAllTags, value: mockTags },
          ],
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

  it('should sort by tag (primary alphabetical tag title), with untagged last', () => {
    const extra = [
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
      } as TaskWithSubTasks,
    ];
    const arr: TaskWithSubTasks[] = [...mockTasks, ...extra];

    const sorted = {
      asc: service['applySort'](arr, SORT_OPTION_TYPE.tag, SORT_ORDER.ASC),
      desc: service['applySort'](arr, SORT_OPTION_TYPE.tag, SORT_ORDER.DESC),
    };

    const resultAsc = [
      'Alpha(Tag A)',
      'Third Task(Tag A, Tag B)',
      'Beta(Tag B)',
      'Aardvark(-)',
      'Zebra(-)',
    ];

    expect(sorted.asc.map((t) => t.id)).toEqual(resultAsc);
    expect(sorted.desc.map((t) => t.id)).toEqual(resultAsc.reverse());
  });

  it('should sort by title for tasks with the same primary tag', () => {
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
      } as TaskWithSubTasks,
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
      } as TaskWithSubTasks,
    ];
    const sorted = service['applySort'](samePrimary, SORT_OPTION_TYPE.tag);

    expect(sorted.map((t) => t.id)).toEqual(['tB', 'tA']);
  });

  it('should group by tag', () => {
    const grouped = service['applyGrouping'](mockTasks, GROUP_OPTION_TYPE.tag);
    expect(Object.keys(grouped)).toContain('Tag A');
    expect(Object.keys(grouped)).toContain('Tag B');
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
    } as TaskWithSubTasks;

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
    } as TaskWithSubTasks;

    const grouped = service['applyGrouping'](
      [taskWithoutSchedule],
      GROUP_OPTION_TYPE.scheduledDate,
    );
    expect(Object.keys(grouped)).toContain('No date');
    expect(grouped['No date'].length).toBe(1);
    expect(grouped['No date'][0].id).toBe('task-no-date');
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

  describe('sortPermanent', () => {
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

    it('should persist the sorted order for a project context and reset customizer state', async () => {
      const taskA = createTask('a', 'Alpha');
      const taskB = createTask('b', 'Bravo');
      mockWorkContextService.activeWorkContextId = 'project-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.PROJECT;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);

      service.setSort({ type: SORT_OPTION_TYPE.name } as SortOption);
      service.setFilter({
        type: FILTER_OPTION_TYPE.tag,
        preset: 'Tag A',
      } as FilterOption);
      service.setGroup({ type: GROUP_OPTION_TYPE.project } as GroupOption);

      await service.sortPermanent({ type: SORT_OPTION_TYPE.name } as SortOption);

      expect(projectUpdateSpy).toHaveBeenCalledTimes(1);
      expect(projectUpdateSpy).toHaveBeenCalledWith('project-sort', {
        taskIds: ['a', 'b'],
      });
      expect(tagUpdateSpy).not.toHaveBeenCalled();
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
      expect(service.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
      expect(service.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
    });

    it('should persist the sorted order for a tag context', async () => {
      const taskA = createTask('a', 'Alpha', null);
      const taskB = createTask('b', 'Bravo', null);
      mockWorkContextService.activeWorkContextId = 'tag-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.TAG;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([taskB, taskA]);

      await service.sortPermanent({ type: SORT_OPTION_TYPE.name } as SortOption);

      expect(tagUpdateSpy).toHaveBeenCalledTimes(1);
      expect(tagUpdateSpy).toHaveBeenCalledWith('tag-sort', {
        taskIds: ['a', 'b'],
      });
      expect(projectUpdateSpy).not.toHaveBeenCalled();
    });

    it('should skip persistence when default sorting is requested but still reset', async () => {
      mockWorkContextService.activeWorkContextId = 'project-sort';
      mockWorkContextService.activeWorkContextType = WorkContextType.PROJECT;
      mockWorkContextService.mainListTasks$ = of<TaskWithSubTasks[]>([]);
      mockWorkContextService.undoneTasks$ = of<TaskWithSubTasks[]>([]);

      service.setSort({ type: SORT_OPTION_TYPE.name } as SortOption);

      await service.sortPermanent(null);

      expect(projectUpdateSpy).not.toHaveBeenCalled();
      expect(tagUpdateSpy).not.toHaveBeenCalled();
      expect(service.selectedSort()).toEqual(DEFAULT_OPTIONS.sort);
      expect(service.selectedGroup()).toEqual(DEFAULT_OPTIONS.group);
      expect(service.selectedFilter()).toEqual(DEFAULT_OPTIONS.filter);
    });
  });
});
