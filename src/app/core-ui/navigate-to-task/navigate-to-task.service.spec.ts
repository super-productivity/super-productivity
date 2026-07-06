import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavigateToTaskService } from './navigate-to-task.service';
import { TaskService } from '../../features/tasks/task.service';
import { ProjectService } from '../../features/project/project.service';
import { SnackService } from '../../core/snack/snack.service';
import { DateService } from '../../core/date/date.service';
import { LayoutService } from '../layout/layout.service';
import { Task } from '../../features/tasks/task.model';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { of } from 'rxjs';

const TODAY_STR = '2026-07-06';

const createTask = (partial: Partial<Task>): Task =>
  ({
    id: 'task-1',
    title: 'A task',
    projectId: undefined,
    parentId: undefined,
    tagIds: [],
    dueDay: undefined,
    dueWithTime: undefined,
    timeSpentOnDay: {},
    created: Date.parse('2020-01-01'),
    ...partial,
  }) as unknown as Task;

describe('NavigateToTaskService', () => {
  let service: NavigateToTaskService;
  let taskService: jasmine.SpyObj<TaskService>;
  let router: jasmine.SpyObj<Router> & { url: string };
  let layoutService: jasmine.SpyObj<LayoutService>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', [
      'getByIdFromEverywhere',
      'getArchivedTasks',
    ]);
    const projectService = jasmine.createSpyObj('ProjectService', [], {
      list$: of([]),
    });
    const snackService = jasmine.createSpyObj('SnackService', ['open']);
    const dateService = jasmine.createSpyObj('DateService', ['isToday', 'todayStr']);
    dateService.todayStr.and.returnValue(TODAY_STR);
    dateService.isToday.and.returnValue(false);
    layoutService = jasmine.createSpyObj('LayoutService', ['focusTaskInViewWhenReady']);

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    routerSpy.navigate.and.resolveTo(true);
    routerSpy.url = '/search';
    router = routerSpy;

    TestBed.configureTestingModule({
      providers: [
        NavigateToTaskService,
        { provide: TaskService, useValue: taskService },
        { provide: ProjectService, useValue: projectService },
        { provide: SnackService, useValue: snackService },
        { provide: DateService, useValue: dateService },
        { provide: LayoutService, useValue: layoutService },
        { provide: Router, useValue: router },
      ],
    });
    service = TestBed.inject(NavigateToTaskService);
  });

  it('navigates to the Today list for an overdue task with no project and no tags (#8780)', async () => {
    // Overdue = dueDay in the past → shown only in the Today "Overdue" section.
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't1', dueDay: '2020-01-01', projectId: undefined, tagIds: [] }),
    );

    await service.navigate('t1');

    expect(router.navigate).toHaveBeenCalledWith(
      [`/tag/${TODAY_TAG.id}/tasks`],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ focusItem: 't1' }),
      }),
    );
    // Must NOT be short-circuited into the "same context" focus-only path.
    expect(layoutService.focusTaskInViewWhenReady).not.toHaveBeenCalled();
  });

  it('navigates to the project list for a project task', async () => {
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't2', projectId: 'p1', tagIds: [] }),
    );

    await service.navigate('t2');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.anything(),
    );
  });

  it('navigates to the tag list for a tagged task with no project', async () => {
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't3', projectId: undefined, tagIds: ['tag-a'] }),
    );

    await service.navigate('t3');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tag/tag-a/tasks'],
      jasmine.anything(),
    );
  });
});
