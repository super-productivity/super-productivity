import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, ReplaySubject } from 'rxjs';
import {
  ANDROID_CAPTURE_INBOX,
  ANDROID_CAPTURE_RECEIPTS_KEY,
  AndroidCaptureImportService,
} from './android-capture-import.service';
import { getCaptureImportErrorReason } from '../tasks/native-capture/native-capture-importer.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK } from '../tasks/task.model';

describe('AndroidCaptureImportService', () => {
  const id = '7DCC80FA-577A-4D99-B16E-15D4B8787B62';
  const id2 = '0F1B7C9E-3D2A-4B5C-8E6F-7A8B9C0D1E2F';
  let service: AndroidCaptureImportService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let flush: jasmine.SpyObj<OperationWriteFlushService>;
  let capture: jasmine.SpyObj<OperationCaptureService>;
  let loaded: ReplaySubject<boolean>;
  let syncWindow: BehaviorSubject<boolean>;
  let pending: string | null;
  let acknowledge: jasmine.Spy<(id: string) => boolean>;

  const setup = (withInbox = true): void => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ANDROID_CAPTURE_INBOX,
          useValue: withInbox
            ? { getPendingCaptures: () => pending, acknowledgeCapture: acknowledge }
            : null,
        },
        provideMockStore({ selectors: [{ selector: selectTaskEntities, value: {} }] }),
        { provide: TaskService, useValue: taskService },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: loaded },
        },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneStrict$: of(true) },
        },
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow$: syncWindow,
            isInSyncWindow: () => syncWindow.value,
          },
        },
        { provide: OperationWriteFlushService, useValue: flush },
        { provide: OperationCaptureService, useValue: capture },
      ],
    });
    store = TestBed.inject(MockStore);
    service = TestBed.inject(AndroidCaptureImportService);
  };

  const entries = (...list: { id: string; title: string }[]): string =>
    JSON.stringify(list.map((e, i) => ({ v: 1, ...e, createdAt: i, source: 'overlay' })));

  beforeEach(() => {
    pending = entries({ id, title: 'Buy milk #shop' });
    acknowledge = jasmine.createSpy('acknowledgeCapture').and.returnValue(true);
    taskService = jasmine.createSpyObj('TaskService', ['add']);
    flush = jasmine.createSpyObj('Flush', ['flushPendingWrites']);
    flush.flushPendingWrites.and.resolveTo();
    capture = jasmine.createSpyObj('Capture', ['hasUnrecoveredPersistFailure']);
    capture.hasUnrecoveredPersistFailure.and.returnValue(false);
    loaded = new ReplaySubject<boolean>(1);
    syncWindow = new BehaviorSubject(false);
    setup();
  });

  afterEach(() => {
    store.resetSelectors();
    localStorage.removeItem(ANDROID_CAPTURE_RECEIPTS_KEY);
  });

  it('waits for data load, creates the task with the capture id, then acknowledges', async () => {
    const imported = service.importPending();
    await Promise.resolve();
    expect(taskService.add).not.toHaveBeenCalled();
    loaded.next(true);
    expect(await imported).toBe(1);
    // Same as the in-app add bar (short syntax on), only the id is fixed.
    expect(taskService.add).toHaveBeenCalledOnceWith('Buy milk #shop', false, { id });
    expect(flush.flushPendingWrites).toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledOnceWith(id);
  });

  it('does not acknowledge until the task write has completed', async () => {
    let finish!: () => void;
    flush.flushPendingWrites.and.returnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    loaded.next(true);
    const imported = service.importPending();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(taskService.add).toHaveBeenCalledTimes(1);
    expect(acknowledge).not.toHaveBeenCalled();
    finish();
    await imported;
    expect(acknowledge).toHaveBeenCalledWith(id);
  });

  it('keeps the capture when persistence fails', async () => {
    capture.hasUnrecoveredPersistFailure.and.returnValue(true);
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('does not recreate a task that was persisted before a crash', async () => {
    store.overrideSelector(selectTaskEntities, {
      [id]: { ...DEFAULT_TASK, id, projectId: 'INBOX_PROJECT' },
    });
    store.refreshState();
    loaded.next(true);
    expect(await service.importPending()).toBe(0);
    expect(taskService.add).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith(id);
  });

  it('retries a failed acknowledgement without creating the task again', async () => {
    acknowledge.and.returnValue(false);
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    // The user may delete the task before the retry; the receipt still covers it.
    acknowledge.and.returnValue(true);
    expect(await service.importPending()).toBe(0);
    expect(taskService.add).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(ANDROID_CAPTURE_RECEIPTS_KEY)).toBe('[]');
  });

  it('waits until remote replay ends before creating a task', async () => {
    syncWindow.next(true);
    loaded.next(true);
    const imported = service.importPending();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(taskService.add).not.toHaveBeenCalled();
    syncWindow.next(false);
    await imported;
    expect(taskService.add).toHaveBeenCalledTimes(1);
  });

  it('imports several captures in order and skips malformed entries', async () => {
    pending = JSON.stringify([
      { v: 1, id, title: 'First', createdAt: 1 },
      { v: 1, id: 42, title: 'Bad id' },
      { v: 1, id: id2, title: '   ' },
      { v: 1, id: id2, title: 'Second', createdAt: 2 },
    ]);
    loaded.next(true);
    expect(await service.importPending()).toBe(2);
    expect(taskService.add.calls.allArgs().map((a) => a[0])).toEqual(['First', 'Second']);
  });

  it('fails without acknowledging when the native inbox cannot be read', async () => {
    pending = null;
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    expect(taskService.add).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('is a no-op when the native bridge lacks the capture inbox', async () => {
    TestBed.resetTestingModule();
    setup(false);
    expect(await service.importPending()).toBe(0);
  });

  it('fails with log-safe reasons for unreadable or corrupt inboxes', async () => {
    loaded.next(true);
    pending = null;
    const unreadable = await service.importPending().catch((err: unknown) => err);
    expect(getCaptureImportErrorReason(unreadable)).toBe('Could not read capture inbox');
    pending = '["Buy milk"';
    const corrupt = await service.importPending().catch((err: unknown) => err);
    expect(getCaptureImportErrorReason(corrupt)).toBe('SyntaxError');
  });
});
