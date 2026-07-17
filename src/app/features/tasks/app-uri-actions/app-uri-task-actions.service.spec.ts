import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Subject, of } from 'rxjs';
import { AppUriTaskActionsService } from './app-uri-task-actions.service';
import { PENDING_CAPACITOR_APP_URI_ACTION } from './pending-capacitor-app-uri-action';
import { selectAllTasks } from '../store/task.selectors';
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
          selectors: [{ selector: selectAllTasks, value: mockTasks }],
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
  });

  describe('add-task action', () => {
    it('creates a task with title and notes', () => {
      pendingAction$.next({
        type: 'add',
        title: 'Buy milk',
        notes: 'whole milk',
      });

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

    it('drops an unknown projectId instead of passing a dangling reference', () => {
      pendingAction$.next({
        type: 'add',
        title: 'Buy milk',
        projectId: 'does-not-exist',
      });

      expect(taskService.add).toHaveBeenCalledWith('Buy milk', false, {});
    });
  });

  describe('complete-task action', () => {
    it('marks the first matching non-done task as done (case-insensitive, contains)', () => {
      pendingAction$.next({ type: 'complete', title: 'milk' });

      expect(taskService.setDone).toHaveBeenCalledWith('t1');
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'SUCCESS',
          msg: T.F.TASK.S.COMPLETED_VIA_APP_URI,
          translateParams: { title: 'Buy milk' },
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
  });
});
