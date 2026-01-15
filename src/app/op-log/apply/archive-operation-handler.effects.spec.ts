import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { ReplaySubject } from 'rxjs';
import { ArchiveOperationHandlerEffects } from './archive-operation-handler.effects';
import {
  ArchiveOperationHandler,
  isArchiveAffectingAction,
} from './archive-operation-handler.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { flushYoungToOld } from '../../features/archive/store/archive.actions';
import { deleteTag } from '../../features/tag/store/tag.actions';
import { Action } from '@ngrx/store';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { SnackService } from '../../core/snack/snack.service';
import { WorklogService } from '../../features/worklog/worklog.service';

describe('ArchiveOperationHandlerEffects', () => {
  let effects: ArchiveOperationHandlerEffects;
  let actions$: ReplaySubject<Action>;
  let mockArchiveOperationHandler: jasmine.SpyObj<ArchiveOperationHandler>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockWorklogService: jasmine.SpyObj<WorklogService>;

  const createMockTask = (id: string): Task =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds: [],
    }) as unknown as Task;

  const createMockTaskWithSubTasks = (id: string): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds: [],
      subTasks: [],
    }) as unknown as TaskWithSubTasks;

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    mockArchiveOperationHandler = jasmine.createSpyObj('ArchiveOperationHandler', [
      'handleOperation',
    ]);
    mockArchiveOperationHandler.handleOperation.and.returnValue(Promise.resolve());
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockWorklogService = jasmine.createSpyObj('WorklogService', ['refreshWorklog']);

    TestBed.configureTestingModule({
      providers: [
        ArchiveOperationHandlerEffects,
        provideMockActions(() => actions$),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: ArchiveOperationHandler, useValue: mockArchiveOperationHandler },
        { provide: SnackService, useValue: mockSnackService },
        { provide: WorklogService, useValue: mockWorklogService },
      ],
    });

    effects = TestBed.inject(ArchiveOperationHandlerEffects);
  });

  describe('handleArchiveOperations$', () => {
    it('should call handleOperation for moveToArchive action', (done) => {
      const tasks = [createMockTaskWithSubTasks('task-1')];
      const action = TaskSharedActions.moveToArchive({ tasks });

      effects.handleArchiveOperations$.subscribe(() => {
        expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledWith(action);
        done();
      });

      actions$.next(action);
    });

    it('should call handleOperation for restoreTask action', (done) => {
      const task = createMockTask('task-1');
      const action = TaskSharedActions.restoreTask({ task, subTasks: [] });

      effects.handleArchiveOperations$.subscribe(() => {
        expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledWith(action);
        done();
      });

      actions$.next(action);
    });

    it('should call handleOperation for flushYoungToOld action', (done) => {
      const action = flushYoungToOld({ timestamp: Date.now() });

      effects.handleArchiveOperations$.subscribe(() => {
        expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledWith(action);
        done();
      });

      actions$.next(action);
    });

    it('should call handleOperation for deleteProject action', (done) => {
      const action = TaskSharedActions.deleteProject({
        projectId: 'proj-1',
        noteIds: [],
        allTaskIds: [],
      });

      effects.handleArchiveOperations$.subscribe(() => {
        expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledWith(action);
        done();
      });

      actions$.next(action);
    });

    it('should call handleOperation for deleteTag action', (done) => {
      const action = deleteTag({ id: 'tag-1' });

      effects.handleArchiveOperations$.subscribe(() => {
        expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledWith(action);
        done();
      });

      actions$.next(action);
    });

    it('should NOT call handleOperation for non-archive-affecting actions', (done) => {
      const task = createMockTask('task-1');
      // Use addTask which is NOT archive-affecting (updateTask is now archive-affecting)
      const action = TaskSharedActions.addTask({
        task,
        workContextId: 'ctx-1',
        workContextType: WorkContextType.TAG,
        isAddToBacklog: false,
        isAddToBottom: false,
      });

      // Subscribe to effect
      const subscription = effects.handleArchiveOperations$.subscribe();

      // Emit non-archive action
      actions$.next(action);

      // Give some time for async processing
      setTimeout(() => {
        expect(mockArchiveOperationHandler.handleOperation).not.toHaveBeenCalled();
        subscription.unsubscribe();
        done();
      }, 50);
    });

    it('should NOT call handleOperation for addTask action', (done) => {
      const task = createMockTask('task-1');
      const action = TaskSharedActions.addTask({
        task,
        workContextId: 'ctx-1',
        workContextType: WorkContextType.TAG,
        isAddToBacklog: false,
        isAddToBottom: false,
      });

      const subscription = effects.handleArchiveOperations$.subscribe();
      actions$.next(action);

      setTimeout(() => {
        expect(mockArchiveOperationHandler.handleOperation).not.toHaveBeenCalled();
        subscription.unsubscribe();
        done();
      }, 50);
    });

    it('should catch and log errors without breaking the effect stream', (done) => {
      // Mock window.alert and window.confirm to prevent devError from throwing
      const originalAlert = window.alert;
      const originalConfirm = window.confirm;
      window.alert = jasmine.createSpy('alert');
      window.confirm = jasmine.createSpy('confirm').and.returnValue(false);

      // First call rejects, second call resolves
      let callCount = 0;
      mockArchiveOperationHandler.handleOperation.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Handler failed'));
        }
        return Promise.resolve();
      });

      const tasks = [createMockTaskWithSubTasks('task-1')];
      const action1 = TaskSharedActions.moveToArchive({ tasks });
      const action2 = TaskSharedActions.moveToArchive({ tasks });

      let emitCount = 0;
      effects.handleArchiveOperations$.subscribe({
        next: () => {
          emitCount++;
          if (emitCount === 2) {
            // Effect should continue processing even after error
            expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(2);
            // Restore window functions
            window.alert = originalAlert;
            window.confirm = originalConfirm;
            done();
          }
        },
        error: () => {
          window.alert = originalAlert;
          window.confirm = originalConfirm;
          fail('Effect stream should not error');
        },
      });

      actions$.next(action1);
      // Send second action after first is processed
      setTimeout(() => {
        actions$.next(action2);
      }, 100);
    });

    it('should process actions sequentially using concatMap', (done) => {
      const callOrder: string[] = [];

      mockArchiveOperationHandler.handleOperation.and.callFake(async (action: any) => {
        const delay = action.tasks?.[0]?.id === 'task-1' ? 100 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        callOrder.push(action.tasks?.[0]?.id || 'unknown');
      });

      const action1 = TaskSharedActions.moveToArchive({
        tasks: [createMockTaskWithSubTasks('task-1')],
      });
      const action2 = TaskSharedActions.moveToArchive({
        tasks: [createMockTaskWithSubTasks('task-2')],
      });

      let completionCount = 0;
      effects.handleArchiveOperations$.subscribe(() => {
        completionCount++;
        if (completionCount === 2) {
          // Even though task-1 takes longer, it should complete first due to concatMap
          expect(callOrder).toEqual(['task-1', 'task-2']);
          done();
        }
      });

      actions$.next(action1);
      actions$.next(action2);
    });
  });

  describe('integration with isArchiveAffectingAction', () => {
    it('should use isArchiveAffectingAction to filter actions', () => {
      // Verify the filtering function is correctly identifying archive-affecting actions
      const archiveActions = [
        TaskSharedActions.moveToArchive({ tasks: [] }),
        TaskSharedActions.restoreTask({ task: createMockTask('t1'), subTasks: [] }),
        TaskSharedActions.updateTask({ task: { id: 't1', changes: { title: 'test' } } }),
        flushYoungToOld({ timestamp: Date.now() }),
        TaskSharedActions.deleteProject({
          projectId: 'p1',
          noteIds: [],
          allTaskIds: [],
        }),
        deleteTag({ id: 'tag-1' }),
      ];

      const nonArchiveActions = [
        TaskSharedActions.addTask({
          task: createMockTask('t1'),
          workContextId: 'ctx-1',
          workContextType: WorkContextType.TAG,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
        // Note: updateTask is now archive-affecting (for syncing archived task updates)
      ];

      archiveActions.forEach((action) => {
        expect(isArchiveAffectingAction(action)).toBe(
          true,
          `Expected ${action.type} to be archive-affecting`,
        );
      });

      nonArchiveActions.forEach((action) => {
        expect(isArchiveAffectingAction(action)).toBe(
          false,
          `Expected ${action.type} to NOT be archive-affecting`,
        );
      });
    });
  });
});
