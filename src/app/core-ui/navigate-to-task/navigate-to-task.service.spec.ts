import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavigateToTaskService } from './navigate-to-task.service';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import { DateService } from '../../core/date/date.service';
import { LayoutService } from '../layout/layout.service';
import { HideSubTasksMode, Task } from '../../features/tasks/task.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { Project } from '../../features/project/project.model';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

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
  let store: MockStore;

  const createProject = (
    id: string,
    taskIds: string[] = [],
    backlogTaskIds: string[] = [],
  ): Project => ({
    ...INBOX_PROJECT,
    id,
    title: `Project ${id}`,
    taskIds,
    backlogTaskIds,
  });

  // The service reads project/task membership straight from the store, so the
  // store IS the fixture — there is no second mock to keep in sync.
  const setStoreState = (
    tasks: Task[],
    projects: Project[],
    currentTaskId: string | null = null,
  ): void => {
    store.setState({
      [TASK_FEATURE_NAME]: {
        ids: tasks.map(({ id }) => id),
        entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
        currentTaskId,
        selectedTaskId: null,
        taskDetailTargetPanel: null,
        isDataLoaded: true,
      },
      [PROJECT_FEATURE_NAME]: {
        ids: projects.map(({ id }) => id),
        entities: Object.fromEntries(projects.map((project) => [project.id, project])),
      },
    });
    store.refreshState();
  };

  const setNavigatedTask = (task: Task, projects: Project[] = [INBOX_PROJECT]): void => {
    setStoreState([task], projects);
    taskService.getByIdFromEverywhere.and.resolveTo(task);
  };

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', [
      'getByIdFromEverywhere',
      'getArchivedTasks',
      'update',
      'showSubTasks',
    ]);
    const snackService = jasmine.createSpyObj('SnackService', ['open']);
    const dateService = jasmine.createSpyObj('DateService', ['isToday', 'todayStr']);
    dateService.todayStr.and.returnValue(TODAY_STR);
    dateService.isToday.and.returnValue(false);
    layoutService = jasmine.createSpyObj('LayoutService', [
      'focusTaskInViewWhenReady',
      'highlightTaskBriefly',
    ]);

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    routerSpy.navigate.and.resolveTo(true);
    routerSpy.url = '/search';
    router = routerSpy;

    TestBed.configureTestingModule({
      providers: [
        NavigateToTaskService,
        provideMockStore({
          initialState: {
            [TASK_FEATURE_NAME]: {
              ids: [],
              entities: {},
              currentTaskId: null,
              selectedTaskId: null,
              taskDetailTargetPanel: null,
              isDataLoaded: true,
            },
            [PROJECT_FEATURE_NAME]: {
              ids: [INBOX_PROJECT.id],
              entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
            },
          },
        }),
        { provide: TaskService, useValue: taskService },
        { provide: SnackService, useValue: snackService },
        { provide: DateService, useValue: dateService },
        { provide: LayoutService, useValue: layoutService },
        { provide: Router, useValue: router },
      ],
    });
    service = TestBed.inject(NavigateToTaskService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch').and.callThrough();
  });

  const expectNoStateChange = (): void => {
    expect(taskService.update).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    // showSubTasks emits a synced updateTaskUi op, so navigating must not call
    // it unless the target is genuinely hidden by its parent. (#8780)
    expect(taskService.showSubTasks).not.toHaveBeenCalled();
  };

  it('self-heals an orphan task (no project, no tags, not due today) into the Inbox and navigates there (#8780)', async () => {
    // Empty-string projectId is the real-world case: it survives hydration
    // (passes typia validation, unlike `undefined`). With no tags and no due
    // date, the task's id is in no project's or tag's `taskIds` array and it is
    // not overdue/due-today, so it renders in no reachable list. It must be
    // re-homed into the Inbox to become focusable.
    const task = createTask({ id: 't1', projectId: '', tagIds: [] });
    setNavigatedTask(task);

    await service.navigate('t1');

    expect(taskService.update).toHaveBeenCalledWith('t1', {
      projectId: INBOX_PROJECT.id,
    });
    expect(router.navigate).toHaveBeenCalledWith(
      [`/project/${INBOX_PROJECT.id}/tasks`],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ focusItem: 't1' }),
      }),
    );
    // Must NOT be short-circuited into the "same context" focus-only path.
    expect(layoutService.focusTaskInViewWhenReady).not.toHaveBeenCalled();
  });

  it('navigates to the project list for a listed project task without touching state', async () => {
    const task = createTask({ id: 't2', projectId: 'p1', tagIds: [] });
    setNavigatedTask(task, [createProject('p1', ['t2'])]);

    await service.navigate('t2');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.anything(),
    );
    expectNoStateChange();
  });

  it('navigates to the tag list for a tagged task with no project WITHOUT re-homing it', async () => {
    // Tag membership is task.tagIds (tag.taskIds only stores ordering), so this
    // task already renders at /tag/tag-a/tasks. Navigating to it must not write.
    const task = createTask({ id: 't3', projectId: undefined, tagIds: ['tag-a'] });
    setNavigatedTask(task);

    await service.navigate('t3');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tag/tag-a/tasks'],
      jasmine.anything(),
    );
    expectNoStateChange();
  });

  it('navigates to the Today list for a due-today task with no project WITHOUT re-homing it', async () => {
    // Today membership is dueDay/dueWithTime, so this task already renders there.
    const task = createTask({
      id: 't4',
      projectId: undefined,
      tagIds: [],
      dueDay: TODAY_STR,
    });
    setNavigatedTask(task);

    await service.navigate('t4');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tag/TODAY/tasks'],
      jasmine.anything(),
    );
    expectNoStateChange();
  });

  it('leaves a due-today task alone even when it is missing from its project lists', async () => {
    // Reachable via Today regardless of the broken project membership, so a
    // read-only navigation must not trigger a synced write to repair it.
    const task = createTask({
      id: 'due-today-unlisted',
      projectId: 'p1',
      tagIds: [],
      dueDay: TODAY_STR,
    });
    setNavigatedTask(task, [createProject('p1', [])]);

    await service.navigate('due-today-unlisted');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tag/TODAY/tasks'],
      jasmine.anything(),
    );
    expectNoStateChange();
  });

  it('surfaces an error snack instead of silently failing when a same-context task cannot be focused', async () => {
    const snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    // Already on the task's context so navigate() takes the same-context branch.
    router.url = `/project/p1/tasks`;
    const task = createTask({ id: 't5', projectId: 'p1', tagIds: [] });
    setNavigatedTask(task, [createProject('p1', ['t5'])]);
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

  it('heals an orphan and focuses it in place when already on the Inbox (same-context)', async () => {
    // Already on the Inbox, so navigate() takes the same-context branch — but the
    // heal must still fire first so the task is added to the Inbox list.
    router.url = `/project/${INBOX_PROJECT.id}/tasks`;
    const task = createTask({ id: 't6', projectId: '', tagIds: [] });
    setNavigatedTask(task);

    await service.navigate('t6');

    expect(taskService.update).toHaveBeenCalledWith('t6', {
      projectId: INBOX_PROJECT.id,
    });
    expect(router.navigate).not.toHaveBeenCalled();
    expect(layoutService.focusTaskInViewWhenReady).toHaveBeenCalled();
  });

  it('repairs a task missing from its project list before navigating (#8780)', async () => {
    const task = createTask({
      id: 'unlisted-inbox-task',
      projectId: INBOX_PROJECT.id,
      tagIds: [],
      subTaskIds: ['child'],
    });
    const child = createTask({
      id: 'child',
      projectId: INBOX_PROJECT.id,
      parentId: task.id,
    });
    setStoreState([task, child], [createProject(INBOX_PROJECT.id)]);
    taskService.getByIdFromEverywhere.and.resolveTo(task);

    await service.navigate('unlisted-inbox-task');

    // projectMoveSubTaskIds is deliberately OMITTED, not `[]`: omitting keeps
    // meta.entityIds unset (still a single-entity op) and leaves the synced move
    // footprint undefined so replaying clients derive the task family from their
    // own state. `[]` would mint a one-element "relocate the root alone"
    // footprint and strand `child` in the old project.
    const repairAction = TaskSharedActions.updateTask({
      task: {
        id: task.id,
        changes: { projectId: INBOX_PROJECT.id },
      },
    });
    expect(store.dispatch).toHaveBeenCalledWith(repairAction);
    expect(repairAction.meta.entityIds).toBeUndefined();
    expect(taskService.update).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      [`/project/${INBOX_PROJECT.id}/tasks`],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ focusItem: 'unlisted-inbox-task' }),
      }),
    );
  });

  it('does not repair a task that is listed in its project backlog', async () => {
    const task = createTask({ id: 'backlogged', projectId: 'p1', tagIds: [] });
    setNavigatedTask(task, [createProject('p1', [], ['backlogged'])]);

    await service.navigate('backlogged');

    expectNoStateChange();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ isInBacklog: true }),
      }),
    );
  });

  it('does not repair an archive-only task that is absent from the live store', async () => {
    // Archived tasks are legitimately absent from project lists; the resolver
    // reads the LIVE entity, so it must not mistake that for a broken shape.
    const archived = createTask({ id: 'archived-task', projectId: 'p1', tagIds: [] });
    setStoreState([], [createProject('p1', [])]);
    taskService.getByIdFromEverywhere.and.resolveTo(archived);

    await service.navigate('archived-task');

    expectNoStateChange();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.anything(),
    );
  });

  it('repairs a dangling project reference into the Inbox before navigating (#8780)', async () => {
    const task = createTask({
      id: 'dangling-task',
      projectId: 'deleted-project',
      tagIds: [],
    });
    setNavigatedTask(task);

    await service.navigate('dangling-task');

    expect(taskService.update).toHaveBeenCalledWith('dangling-task', {
      projectId: INBOX_PROJECT.id,
    });
    expect(router.navigate).toHaveBeenCalledWith(
      [`/project/${INBOX_PROJECT.id}/tasks`],
      jasmine.anything(),
    );
  });

  // Asserts the param only. It does NOT prove the task ends up focused: the
  // backlog renders outside `#splitTopEl`, which both reveal loops require, so a
  // backlog row is shown but never scrolled to. Pre-existing gap, see the note in
  // `_focusTaskElement`. (#8780)
  it('sends isInBacklog when navigating to a subtask whose parent is in the backlog', async () => {
    const parent = createTask({
      id: 'backlog-parent',
      projectId: 'p1',
      subTaskIds: ['backlog-child'],
    });
    const child = createTask({
      id: 'backlog-child',
      parentId: parent.id,
      projectId: parent.projectId,
    });
    setStoreState([parent, child], [createProject('p1', [], [parent.id])]);
    taskService.getByIdFromEverywhere.and.callFake((id: string) =>
      Promise.resolve(id === child.id ? child : parent),
    );

    await service.navigate(child.id);

    expectNoStateChange();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/project/p1/tasks'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({
          focusItem: child.id,
          isInBacklog: true,
        }),
      }),
    );
  });

  it('does NOT repair an orphaned subtask whose parent cannot be loaded', async () => {
    // The subtask itself resolves; its parent lookup returns undefined, so the
    // context task stays the subtask. It routes to the Inbox but must NOT be
    // repaired as a top-level task (which would corrupt the parent/child link).
    const sub = createTask({
      id: 'sub-1',
      parentId: 'missing-parent',
      projectId: '',
      tagIds: [],
    });
    setStoreState([sub], [INBOX_PROJECT]);
    taskService.getByIdFromEverywhere.and.callFake((id: string) =>
      Promise.resolve(id === 'sub-1' ? sub : (undefined as unknown as Task)),
    );

    await service.navigate('sub-1');

    expectNoStateChange();
    expect(router.navigate).toHaveBeenCalledWith(
      [`/project/${INBOX_PROJECT.id}/tasks`],
      jasmine.anything(),
    );
  });

  /**
   * The attention highlight is scoped to navigations the user asked for, i.e.
   * global search. Every other caller of `navigate()` — the tracked-task pill,
   * the "go to task" snack actions, issue creation and the calendar banner —
   * must keep the plain focus behavior. (#5476)
   */
  describe('search intent (#5476)', () => {
    it('carries isFromSearch into the route-change query params when set', async () => {
      const task = createTask({ id: 's1', projectId: 'p1', tagIds: [] });
      setNavigatedTask(task, [createProject('p1', ['s1'])]);

      await service.navigate('s1', false, { isFromSearch: true });

      expect(router.navigate).toHaveBeenCalledWith(
        ['/project/p1/tasks'],
        jasmine.objectContaining({
          queryParams: jasmine.objectContaining({ focusItem: 's1', isFromSearch: true }),
        }),
      );
    });

    it('omits isFromSearch for every other caller', async () => {
      const task = createTask({ id: 's2', projectId: 'p1', tagIds: [] });
      setNavigatedTask(task, [createProject('p1', ['s2'])]);

      await service.navigate('s2');

      const queryParams = (
        router.navigate.calls.mostRecent().args[1] as {
          queryParams: Record<string, unknown>;
        }
      ).queryParams;
      expect(queryParams.focusItem).toBe('s2');
      expect('isFromSearch' in queryParams).toBeFalse();
    });

    it('highlights the revealed row on a same-context search jump', async () => {
      router.url = '/project/p1/tasks';
      const task = createTask({ id: 's3', projectId: 'p1', tagIds: [] });
      setNavigatedTask(task, [createProject('p1', ['s3'])]);
      const el = document.createElement('div');
      layoutService.focusTaskInViewWhenReady.and.callFake((_taskId, onSuccess) =>
        onSuccess?.(el),
      );

      await service.navigate('s3', false, { isFromSearch: true });

      expect(layoutService.highlightTaskBriefly).toHaveBeenCalledOnceWith(el);
    });

    it('does not highlight a same-context jump from any other caller', async () => {
      router.url = '/project/p1/tasks';
      const task = createTask({ id: 's4', projectId: 'p1', tagIds: [] });
      setNavigatedTask(task, [createProject('p1', ['s4'])]);
      const el = document.createElement('div');
      layoutService.focusTaskInViewWhenReady.and.callFake((_taskId, onSuccess) =>
        onSuccess?.(el),
      );

      await service.navigate('s4');

      expect(layoutService.focusTaskInViewWhenReady).toHaveBeenCalled();
      expect(layoutService.highlightTaskBriefly).not.toHaveBeenCalled();
    });
  });

  describe('collapsed parent (#8780)', () => {
    /**
     * A collapsed parent renders no row for its subtasks, so without expanding
     * it the reveal step polls for an element that can never appear and gives up
     * silently — the failure in the reporter's 2026-08-11 trace.
     */
    const setUpSubTask = (
      parentChanges: Partial<Task>,
      childChanges: Partial<Task> = {},
      currentTaskId: string | null = null,
    ): Task => {
      const parent = createTask({
        id: 'parent-1',
        projectId: 'p1',
        subTaskIds: ['child-1'],
        ...parentChanges,
      });
      const child = createTask({
        id: 'child-1',
        parentId: parent.id,
        projectId: parent.projectId,
        ...childChanges,
      });
      setStoreState([parent, child], [createProject('p1', [parent.id])], currentTaskId);
      taskService.getByIdFromEverywhere.and.callFake((id: string) =>
        Promise.resolve(id === child.id ? child : parent),
      );
      return child;
    };

    it('expands a parent hiding ALL subtasks before navigating', async () => {
      const child = setUpSubTask({ _hideSubTasksMode: HideSubTasksMode.HideAll });

      await service.navigate(child.id);

      expect(taskService.showSubTasks).toHaveBeenCalledOnceWith('parent-1');
      expect(router.navigate).toHaveBeenCalledWith(
        ['/project/p1/tasks'],
        jasmine.objectContaining({
          queryParams: jasmine.objectContaining({ focusItem: child.id }),
        }),
      );
    });

    it('expands a parent hiding DONE subtasks when the target is done', async () => {
      const child = setUpSubTask(
        { _hideSubTasksMode: HideSubTasksMode.HideDone },
        { isDone: true },
      );

      await service.navigate(child.id);

      expect(taskService.showSubTasks).toHaveBeenCalledOnceWith('parent-1');
    });

    it('leaves a HideDone parent alone when the target is not done', async () => {
      // The row already renders, so expanding would emit a synced op for nothing.
      const child = setUpSubTask(
        { _hideSubTasksMode: HideSubTasksMode.HideDone },
        { isDone: false },
      );

      await service.navigate(child.id);

      expect(taskService.showSubTasks).not.toHaveBeenCalled();
    });

    it('leaves a HideAll parent alone when the target is the TRACKED task', async () => {
      // filterDoneTasks exempts the tracked task from HideAll, so its row is
      // already on screen. The tracked-task pill navigates to exactly this task,
      // so without the guard every pill click would emit a synced op and destroy
      // the user's collapse state on every device.
      const child = setUpSubTask(
        { _hideSubTasksMode: HideSubTasksMode.HideAll },
        {},
        'child-1',
      );

      await service.navigate(child.id);

      expect(taskService.showSubTasks).not.toHaveBeenCalled();
    });

    it('still expands for a NON-tracked sibling under a HideAll parent', async () => {
      const child = setUpSubTask(
        { _hideSubTasksMode: HideSubTasksMode.HideAll },
        {},
        'some-other-task',
      );

      await service.navigate(child.id);

      expect(taskService.showSubTasks).toHaveBeenCalledOnceWith('parent-1');
    });

    it('expands for an out-of-enum hide mode, which the template still hides', async () => {
      // The template binds `isHideAll="!!t._hideSubTasksMode"`, so ANY truthy
      // value hides the subtask. A strict `=== HideAll` check would miss legacy
      // or corrupt values and leave the reveal failing exactly as it did before.
      const child = setUpSubTask({
        _hideSubTasksMode: 99 as unknown as HideSubTasksMode,
      });

      await service.navigate(child.id);

      expect(taskService.showSubTasks).toHaveBeenCalledWith('parent-1');
    });

    it('expands in the same-context branch too, where no route change happens', async () => {
      // The expansion runs before the same-context check, so it must apply on
      // the branch that only polls the DOM instead of routing.
      router.url = '/project/p1/tasks';
      const child = setUpSubTask({ _hideSubTasksMode: HideSubTasksMode.HideAll });

      await service.navigate(child.id);

      expect(router.navigate).not.toHaveBeenCalled();
      expect(taskService.showSubTasks).toHaveBeenCalledWith('parent-1');
      expect(layoutService.focusTaskInViewWhenReady).toHaveBeenCalled();
    });

    it('leaves an already expanded parent alone', async () => {
      const child = setUpSubTask({ _hideSubTasksMode: undefined });

      await service.navigate(child.id);

      expectNoStateChange();
    });

    it('does not touch live task UI state when navigating into the archive', async () => {
      const child = setUpSubTask({ _hideSubTasksMode: HideSubTasksMode.HideAll });
      taskService.getArchivedTasks.and.resolveTo([]);

      await service.navigate(child.id, true);

      expect(taskService.showSubTasks).not.toHaveBeenCalled();
    });
  });
});
