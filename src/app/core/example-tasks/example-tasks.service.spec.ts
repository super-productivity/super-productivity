import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { ExampleTasksService } from './example-tasks.service';
import { TaskService } from '../../features/tasks/task.service';
import { selectAllTasks } from '../../features/tasks/store/task.selectors';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LS } from '../persistence/storage-keys.const';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { Task } from '../../features/tasks/task.model';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';

describe('ExampleTasksService', () => {
  let store: MockStore;
  let syncReady$: Subject<boolean>;
  let taskService: jasmine.SpyObj<TaskService>;
  let translateService: jasmine.SpyObj<TranslateService>;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    localStorage.removeItem(LS.EXAMPLE_TASKS_CREATED);

    syncReady$ = new Subject();
    taskService = jasmine.createSpyObj('TaskService', ['createNewTaskWithDefaults']);
    translateService = jasmine.createSpyObj('TranslateService', ['instant', 'get']);

    translateService.instant.and.callFake((key: string) => `translated:${key}`);
    translateService.get.and.callFake((keys: string[]) => {
      const result: Record<string, string> = {};
      for (const key of keys) {
        result[key] = `translated:${key}`;
      }
      return of(result);
    });

    let taskIdCounter = 0;
    taskService.createNewTaskWithDefaults.and.callFake(
      () =>
        ({
          id: `mock-id-${taskIdCounter++}`,
          title: 'mock',
        }) as any,
    );

    TestBed.configureTestingModule({
      providers: [
        ExampleTasksService,
        provideMockStore(),
        {
          provide: SyncTriggerService,
          useValue: {
            afterInitialSyncDoneAndDataLoadedInitially$: syncReady$,
          },
        },
        { provide: TaskService, useValue: taskService },
        { provide: TranslateService, useValue: translateService },
      ],
    });

    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    localStorage.removeItem(LS.EXAMPLE_TASKS_CREATED);
    store.resetSelectors();
  });

  it('should create example tasks when task list is empty on first run', () => {
    store.overrideSelector(selectAllTasks, [] as Task[]);
    TestBed.inject(ExampleTasksService);

    syncReady$.next(true);

    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledTimes(4);
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: jasmine.stringContaining('translated:'),
        additional: jasmine.objectContaining({
          notes: jasmine.stringContaining('translated:'),
        }),
        workContextType: WorkContextType.PROJECT,
        workContextId: INBOX_PROJECT.id,
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledTimes(4);
    for (const call of dispatchSpy.calls.all()) {
      const action = call.args[0];
      expect(action.type).toBe(TaskSharedActions.addTask.type);
      expect(action.workContextId).toBe(INBOX_PROJECT.id);
      expect(action.workContextType).toBe(WorkContextType.PROJECT);
      expect(action.isAddToBacklog).toBe(false);
      expect(action.isAddToBottom).toBe(true);
    }
    expect(localStorage.getItem(LS.EXAMPLE_TASKS_CREATED)).toBe('true');
  });

  it('should NOT create example tasks when tasks already exist', () => {
    store.overrideSelector(selectAllTasks, [
      { id: 'existing', title: 'Existing' } as Task,
    ]);
    TestBed.inject(ExampleTasksService);

    syncReady$.next(true);

    expect(taskService.createNewTaskWithDefaults).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(LS.EXAMPLE_TASKS_CREATED)).toBeNull();
  });

  it('should NOT create example tasks when localStorage flag is already set', () => {
    localStorage.setItem(LS.EXAMPLE_TASKS_CREATED, 'true');
    store.overrideSelector(selectAllTasks, [] as Task[]);
    TestBed.inject(ExampleTasksService);

    syncReady$.next(true);

    expect(taskService.createNewTaskWithDefaults).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('should NOT create example tasks when translations return raw keys', () => {
    store.overrideSelector(selectAllTasks, [] as Task[]);
    translateService.get.and.callFake((keys: string[]) => {
      const result: Record<string, string> = {};
      for (const key of keys) {
        result[key] = key;
      }
      return of(result);
    });
    TestBed.inject(ExampleTasksService);

    syncReady$.next(true);

    expect(taskService.createNewTaskWithDefaults).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(LS.EXAMPLE_TASKS_CREATED)).toBeNull();
  });
});
