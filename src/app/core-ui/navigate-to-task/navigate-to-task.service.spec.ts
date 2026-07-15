import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { NavigateToTaskService } from './navigate-to-task.service';
import { TaskService } from '../../features/tasks/task.service';
import { ProjectService } from '../../features/project/project.service';
import { SnackService } from '../../core/snack/snack.service';
import { DateService } from '../../core/date/date.service';
import { LayoutService } from '../layout/layout.service';
import { Task } from '../../features/tasks/task.model';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
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
  let store: jasmine.SpyObj<Store>;

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
    store = jasmine.createSpyObj('Store', ['dispatch']);

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    routerSpy.navigate.and.resolveTo(true);
    routerSpy.url = '/search';
    router = routerSpy;

    TestBed.configureTestingModule({
      providers: [
        NavigateToTaskService,
        { provide: Store, useValue: store },
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

  it('self-heals an orphan task (no project, no tags, not due today) into the Inbox and navigates there (#8780)', async () => {
    // Overdue = dueDay in the past → the task is in no list's ordering array, so
    // it renders in no view. It must be re-homed into the Inbox to be reachable.
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't1', dueDay: '2020-01-01', projectId: undefined, tagIds: [] }),
    );

    await service.navigate('t1');

    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: TaskSharedActions.moveToOtherProject.type,
        targetProjectId: INBOX_PROJECT.id,
      }),
    );
    expect(router.navigate).toHaveBeenCalledWith(
      [`/project/${INBOX_PROJECT.id}/tasks`],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ focusItem: 't1' }),
      }),
    );
    // Must NOT be short-circuited into the "same context" focus-only path.
    expect(layoutService.focusTaskInViewWhenReady).not.toHaveBeenCalled();
  });

  it('navigates to the project list for a project task without re-homing it', async () => {
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't2', projectId: 'p1', tagIds: [] }),
    );

    await service.navigate('t2');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.anything(),
    );
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('navigates to the tag list for a tagged task with no project without re-homing it', async () => {
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't3', projectId: undefined, tagIds: ['tag-a'] }),
    );

    await service.navigate('t3');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tag/tag-a/tasks'],
      jasmine.anything(),
    );
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('navigates to the Today list for a task due today (no re-home needed)', async () => {
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't4', projectId: undefined, tagIds: [], dueDay: TODAY_STR }),
    );

    await service.navigate('t4');

    expect(router.navigate).toHaveBeenCalledWith(
      [`/tag/${TODAY_TAG.id}/tasks`],
      jasmine.anything(),
    );
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('surfaces an error snack instead of silently failing when a same-context task cannot be focused', async () => {
    const snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    // Already on the task's context so navigate() takes the same-context branch.
    router.url = `/project/p1/tasks`;
    taskService.getByIdFromEverywhere.and.resolveTo(
      createTask({ id: 't5', projectId: 'p1', tagIds: [] }),
    );
    // Simulate focus never succeeding → onFailure invoked.
    layoutService.focusTaskInViewWhenReady.and.callFake(
      (_taskId, _onSuccess, onFailure) => onFailure?.(),
    );

    await service.navigate('t5');

    expect(router.navigate).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'ERROR' }),
    );
  });
});
