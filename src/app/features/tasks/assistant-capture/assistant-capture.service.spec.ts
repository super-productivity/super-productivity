import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AssistantCaptureService } from './assistant-capture.service';
import { TaskService } from '../task.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { INBOX_PROJECT } from '../../project/project.const';
import { Task } from '../task.model';

describe('AssistantCaptureService', () => {
  let service: AssistantCaptureService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;
  let hydrationState: jasmine.SpyObj<HydrationStateService>;
  let operationCapture: jasmine.SpyObj<OperationCaptureService>;
  let writeFlush: jasmine.SpyObj<OperationWriteFlushService>;

  const task = { id: 'new-task', title: 'Buy milk #shop' } as Task;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
    ]);
    taskService.createNewTaskWithDefaults.and.returnValue(task);
    hydrationState = jasmine.createSpyObj<HydrationStateService>(
      'HydrationStateService',
      ['isApplyingRemoteOps'],
    );
    hydrationState.isApplyingRemoteOps.and.returnValue(false);
    operationCapture = jasmine.createSpyObj<OperationCaptureService>(
      'OperationCaptureService',
      ['hasUnrecoveredPersistFailure'],
    );
    operationCapture.hasUnrecoveredPersistFailure.and.returnValue(false);
    writeFlush = jasmine.createSpyObj<OperationWriteFlushService>(
      'OperationWriteFlushService',
      ['flushPendingWrites'],
    );
    writeFlush.flushPendingWrites.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        AssistantCaptureService,
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        { provide: HydrationStateService, useValue: hydrationState },
        { provide: OperationCaptureService, useValue: operationCapture },
        { provide: OperationWriteFlushService, useValue: writeFlush },
      ],
    });
    service = TestBed.inject(AssistantCaptureService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  it('adds one task pinned to the Inbox, without short syntax, and reports it', async () => {
    const result = await service.capture({ title: 'Buy milk #shop', notes: 'n' });

    expect(result).toEqual({ status: 'created', id: 'new-task' });
    // The active view must not contribute anything: an explicit Inbox project
    // context means no tag from a tag view and no Today date.
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith({
      title: 'Buy milk #shop',
      additional: { notes: 'n' },
      workContextType: WorkContextType.PROJECT,
      workContextId: INBOX_PROJECT.id,
    });
    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      TaskSharedActions.addTask({
        task,
        workContextId: INBOX_PROJECT.id,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
        isIgnoreShortSyntax: true,
      }),
    );
    expect(writeFlush.flushPendingWrites).toHaveBeenCalled();
  });

  it('refuses while remote ops are applied, before dispatching anything', async () => {
    hydrationState.isApplyingRemoteOps.and.returnValue(true);
    expect(await service.capture({ title: 'x' })).toEqual({ status: 'APP_BUSY' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('refuses when earlier writes already failed to persist', async () => {
    operationCapture.hasUnrecoveredPersistFailure.and.returnValue(true);
    expect(await service.capture({ title: 'x' })).toEqual({ status: 'PERSIST_DEGRADED' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not claim success when a persist failure appears during the flush', async () => {
    operationCapture.hasUnrecoveredPersistFailure.and.returnValues(false, true);
    expect(await service.capture({ title: 'x' })).toEqual({
      status: 'OUTCOME_UNKNOWN',
      id: 'new-task',
    });
  });

  it('does not claim success when the flush times out', async () => {
    writeFlush.flushPendingWrites.and.rejectWith(new Error('timeout'));
    expect(await service.capture({ title: 'x' })).toEqual({
      status: 'OUTCOME_UNKNOWN',
      id: 'new-task',
    });
  });
});
