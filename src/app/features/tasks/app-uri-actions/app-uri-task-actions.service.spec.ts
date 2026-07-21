import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject, of } from 'rxjs';
import { AppUriTaskActionsService } from './app-uri-task-actions.service';
import { PENDING_CAPACITOR_APP_URI_ACTION } from './pending-capacitor-app-uri-action';
import { selectAllTasksInActiveProjects } from '../store/task.selectors';
import { TaskService } from '../task.service';
import { ProjectService } from '../../project/project.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { T } from '../../../t.const';
import { Task } from '../task.model';
import { Project } from '../../project/project.model';
import { AppUriTaskAction } from '../util/parse-app-uri-task-action';

describe('AppUriTaskActionsService', () => {
  let service: AppUriTaskActionsService;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let pendingAction$: Subject<AppUriTaskAction>;

  const mockTasks: Task[] = [
    { id: 't1', title: 'Buy milk', isDone: false } as Task,
    { id: 't2', title: 'Buy eggs', isDone: false } as Task,
    { id: 't3', title: 'Already done milk run', isDone: true } as Task,
    { id: 't4', title: 'Standup', isDone: false } as Task,
    { id: 't5', title: 'Standup notes', isDone: false } as Task,
    {
      id: 't6',
      title: 'Subtask milk errand',
      isDone: false,
      parentId: 't1',
    } as Task,
    { id: 't7', title: 'Email Bob', isDone: false } as Task,
    { id: 't8', title: 'Call Bob', isDone: false } as Task,
  ];
  const mockProjects: Project[] = [{ id: 'proj-1', title: 'Groceries' } as Project];

  beforeEach(() => {
    // ipcAddTaskFromAppUri$/ipcCompleteTaskFromAppUri$ are EMPTY outside a
    // real Electron renderer (IS_ELECTRON checks navigator.userAgent), so
    // they contribute nothing under Karma/Jasmine — only the Capacitor
    // pending-action subject needs driving in these tests.
    taskService = jasmine.createSpyObj('TaskService', ['add', 'setDone']);
    taskService.add.and.returnValue('new-task-id');
    snackService = jasmine.createSpyObj('SnackService', ['open']);
    const projectService = { list: () => mockProjects } as unknown as ProjectService;
    const dataInitStateService = {
      isAllDataLoadedInitially$: of(true),
    } as unknown as DataInitStateService;
    pendingAction$ = new Subject<AppUriTaskAction>();

    TestBed.configureTestingModule({
      providers: [
        AppUriTaskActionsService,
        provideMockStore({
          selectors: [{ selector: selectAllTasksInActiveProjects, value: mockTasks }],
        }),
        { provide: TaskService, useValue: taskService },
        { provide: ProjectService, useValue: projectService },
        { provide: SnackService, useValue: snackService },
        { provide: DataInitStateService, useValue: dataInitStateService },
        { provide: PENDING_CAPACITOR_APP_URI_ACTION, useValue: pendingAction$ },
      ],
    });

    service = TestBed.inject(AppUriTaskActionsService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    // provideMockStore's selector override patches the real, module-level
    // selectAllTasksInActiveProjects in place. Without this reset, it leaks
    // into every other spec file in the same Karma run that imports it directly.
    TestBed.inject(MockStore).resetSelectors();
  });

  describe('add-task action', () => {
    it('creates a task with title and notes', () => {
      pendingAction$.next({
        type: 'add',
        title: 'Buy milk',
        notes: 'whole milk',
      });

      // Regression: TaskService.add was previously called twice for a single
      // fired action (task-electron.effects.ts had its own, now-removed
      // ipcAddTaskFromAppUri$ subscriber). This only guards against this
      // service double-calling internally, not against some other class
      // independently subscribing to the same shared observable again.
      expect(taskService.add).toHaveBeenCalledTimes(1);
      expect(taskService.add).toHaveBeenCalledWith('Buy milk', false, {
        notes: 'whole milk',
      });
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'SUCCESS',
          msg: T.F.TASK.S.ADDED_VIA_APP_URI,
          translateParams: { title: 'Buy milk' },
        }),
      );
    });

    it('shows an error and never adds a task for a whitespace-only title', () => {
      pendingAction$.next({ type: 'add', title: '   ' });

      expect(taskService.add).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.EMPTY_TITLE_VIA_APP_URI,
        }),
      );
    });

    it('trims surrounding whitespace from an otherwise-valid title', () => {
      pendingAction$.next({ type: 'add', title: '  Buy milk  ' });

      expect(taskService.add).toHaveBeenCalledWith('Buy milk', false, {});
    });

    it('passes through a projectId that exists', () => {
      pendingAction$.next({
        type: 'add',
        title: 'Buy milk',
        projectId: 'proj-1',
      });

      expect(taskService.add).toHaveBeenCalledWith('Buy milk', false, {
        projectId: 'proj-1',
      });
    });

    it('refuses to add (and shows an error) when the projectId does not exist', () => {
      pendingAction$.next({
        type: 'add',
        title: 'Buy milk',
        projectId: 'does-not-exist',
      });

      expect(taskService.add).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.PROJECT_NOT_FOUND_VIA_APP_URI,
          translateParams: { title: 'Buy milk' },
        }),
      );
    });
  });

  describe('complete-task action', () => {
    it('marks the single matching non-done task as done (case-insensitive, contains)', () => {
      pendingAction$.next({ type: 'complete', title: 'eggs' });

      expect(taskService.setDone).toHaveBeenCalledWith('t2');
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'SUCCESS',
          msg: T.F.TASK.S.COMPLETED_VIA_APP_URI,
          translateParams: { title: 'Buy eggs' },
        }),
      );
    });

    it('prefers an exact title match over an ambiguous substring match', () => {
      // "Standup" is an exact match; "Standup notes" also contains it as a
      // substring — the exact match must win rather than erroring out.
      pendingAction$.next({ type: 'complete', title: 'Standup' });

      expect(taskService.setDone).toHaveBeenCalledWith('t4');
    });

    it('resolves cleanly once subtask exclusion removes what would otherwise be a second candidate', () => {
      // "Buy milk" and "Subtask milk errand" would both substring-match
      // "milk" if subtasks weren't excluded; with the subtask filtered out,
      // only "Buy milk" remains. "Already done milk run" is excluded for
      // being done.
      pendingAction$.next({ type: 'complete', title: 'milk' });

      expect(taskService.setDone).toHaveBeenCalledWith('t1');
    });

    it('errors instead of guessing when multiple non-exact matches are equally plausible', () => {
      // "Email Bob" and "Call Bob" both substring-match "bob", and neither is
      // an exact title match — genuinely ambiguous, must not guess.
      pendingAction$.next({ type: 'complete', title: 'bob' });

      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.AMBIGUOUS_MATCH_VIA_APP_URI,
          translateParams: { title: 'bob' },
        }),
      );
    });

    it('excludes subtasks from matching', () => {
      pendingAction$.next({ type: 'complete', title: 'errand' });

      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
        }),
      );
    });

    it('does not match an already-done task', () => {
      pendingAction$.next({
        type: 'complete',
        title: 'Already done milk run',
      });

      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
        }),
      );
    });

    it('shows an error snack and does not throw when no task matches', () => {
      pendingAction$.next({ type: 'complete', title: 'nonexistent' });

      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
          translateParams: { title: 'nonexistent' },
        }),
      );
    });

    it('shows an error and never queries the store for a whitespace-only title', () => {
      pendingAction$.next({ type: 'complete', title: '   ' });

      expect(taskService.setDone).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.TASK.S.NOT_FOUND_VIA_APP_URI,
        }),
      );
    });
  });
});

describe('AppUriTaskActionsService buffering', () => {
  // A regression test for a real gap: `of(true)` (used in the describe block
  // above) emits synchronously, so it never actually proves the
  // `concatMap(isAllDataLoadedInitially$)` gate delays anything — deleting
  // the gate entirely still leaves those tests green. A Subject that emits
  // strictly after the action is pushed is the only way to prove the buffer
  // holds the action back until data is loaded.
  it('does not act on a pending action until isAllDataLoadedInitially$ emits', () => {
    const taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'setDone',
    ]);
    const snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const projectService = { list: () => [] } as unknown as ProjectService;
    const dataLoaded$ = new Subject<boolean>();
    const dataInitStateService = {
      isAllDataLoadedInitially$: dataLoaded$,
    } as unknown as DataInitStateService;
    const pendingAction$ = new Subject<AppUriTaskAction>();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppUriTaskActionsService,
        provideMockStore({
          selectors: [{ selector: selectAllTasksInActiveProjects, value: [] }],
        }),
        { provide: TaskService, useValue: taskService },
        { provide: ProjectService, useValue: projectService },
        { provide: SnackService, useValue: snackService },
        { provide: DataInitStateService, useValue: dataInitStateService },
        { provide: PENDING_CAPACITOR_APP_URI_ACTION, useValue: pendingAction$ },
      ],
    });
    const service = TestBed.inject(AppUriTaskActionsService);

    pendingAction$.next({ type: 'add', title: 'Buy milk' });
    expect(taskService.add).not.toHaveBeenCalled();

    dataLoaded$.next(true);
    expect(taskService.add).toHaveBeenCalledWith('Buy milk', false, {});

    service.ngOnDestroy();
    TestBed.inject(MockStore).resetSelectors();
  });
});
