import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, ReplaySubject } from 'rxjs';
import {
  ANDROID_CAPTURE_INBOX,
  ANDROID_CAPTURE_RECEIPTS_KEY,
  ANDROID_SHARE_RECEIPTS_KEY,
  AndroidCaptureImportService,
} from './android-capture-import.service';
import { signal } from '@angular/core';
import { GlobalConfigService } from '../config/global-config.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../project/project.const';
import { getCaptureImportErrorReason } from '../tasks/native-capture/native-capture-importer.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK } from '../tasks/task.model';
import { WorkContextType } from '../work-context/work-context.model';
import { TODAY_TAG } from '../tag/tag.const';

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
  /** Undefined: an APK without share capture. */
  let shares: string | null | undefined;

  const setup = (withInbox = true): void => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ANDROID_CAPTURE_INBOX,
          useValue: withInbox
            ? {
                getPendingCaptures: () => pending,
                ...(shares === undefined ? {} : { getPendingShares: () => shares }),
                acknowledgeCapture: acknowledge,
              }
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
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal({
              timeTracking: { defaultEstimate: 900_000 },
              reminder: { defaultTaskRemindOption: 'AtStart' },
            }),
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    service = TestBed.inject(AndroidCaptureImportService);
  };

  const addedTasks = (): ReturnType<typeof TaskSharedActions.addTask>[] =>
    (store.dispatch as jasmine.Spy).calls
      .allArgs()
      .map((args) => args[0] as ReturnType<typeof TaskSharedActions.addTask>)
      .filter((action) => action.type === TaskSharedActions.addTask.type);

  const entries = (...list: { id: string; title: string }[]): string =>
    JSON.stringify(list.map((e, i) => ({ v: 1, ...e, createdAt: i, source: 'overlay' })));

  beforeEach(() => {
    pending = entries({ id, title: 'Buy milk #shop' });
    acknowledge = jasmine.createSpy('acknowledgeCapture').and.returnValue(true);
    taskService = jasmine.createSpyObj('TaskService', ['createNewTaskWithDefaults']);
    taskService.createNewTaskWithDefaults.and.callFake(({ title, id: taskId }) => ({
      ...DEFAULT_TASK,
      id: taskId as string,
      title: title as string,
      projectId: INBOX_PROJECT.id,
    }));
    flush = jasmine.createSpyObj('Flush', ['flushPendingWrites']);
    flush.flushPendingWrites.and.resolveTo();
    capture = jasmine.createSpyObj('Capture', ['hasUnrecoveredPersistFailure']);
    capture.hasUnrecoveredPersistFailure.and.returnValue(false);
    loaded = new ReplaySubject<boolean>(1);
    syncWindow = new BehaviorSubject(false);
    shares = undefined;
    setup();
  });

  afterEach(() => {
    store.resetSelectors();
    localStorage.removeItem(ANDROID_CAPTURE_RECEIPTS_KEY);
    localStorage.removeItem(ANDROID_SHARE_RECEIPTS_KEY);
  });

  it('waits for data load, creates the task with the capture id, then acknowledges', async () => {
    const imported = service.importPending();
    await Promise.resolve();
    expect(addedTasks()).toEqual([]);
    loaded.next(true);
    expect(await imported).toBe(1);
    // As if typed into Today's add bar (short syntax on), only the id is
    // fixed: the import runs on whatever screen the app resumes on.
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith({
      title: 'Buy milk #shop',
      id,
      workContextType: WorkContextType.TAG,
      workContextId: TODAY_TAG.id,
    });
    expect(addedTasks().length).toBe(1);
    const action = addedTasks()[0];
    expect(action.task.id).toBe(id);
    expect(action.task.title).toBe('Buy milk #shop');
    expect(action.workContextId).toBe(TODAY_TAG.id);
    expect(action.workContextType).toBe(WorkContextType.TAG);
    expect(action.isIgnoreShortSyntax).toBeUndefined();
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
    expect(addedTasks().length).toBe(1);
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
    expect(addedTasks()).toEqual([]);
    expect(acknowledge).toHaveBeenCalledWith(id);
  });

  it('retries a failed acknowledgement without creating the task again', async () => {
    acknowledge.and.returnValue(false);
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    // The user may delete the task before the retry; the receipt still covers it.
    acknowledge.and.returnValue(true);
    expect(await service.importPending()).toBe(0);
    expect(addedTasks().length).toBe(1);
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
    expect(addedTasks()).toEqual([]);
    syncWindow.next(false);
    await imported;
    expect(addedTasks().length).toBe(1);
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
    expect(addedTasks().map((a) => a.task.title)).toEqual(['First', 'Second']);
  });

  it('fails without acknowledging when the native inbox cannot be read', async () => {
    pending = null;
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    expect(addedTasks()).toEqual([]);
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

  describe('shares', () => {
    const shareId = 'b7a1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const share = (fields: Record<string, unknown>): Record<string, unknown> => ({
      v: 1,
      id: shareId,
      source: 'share',
      createdAt: 7,
      client: 'Android share',
      ...fields,
    });
    const reset = (list: Record<string, unknown>[]): void => {
      pending = '[]';
      shares = JSON.stringify(list);
      TestBed.resetTestingModule();
      setup();
      loaded.next(true);
    };
    const addedTask = (): ReturnType<typeof TaskSharedActions.addTask> =>
      (store.dispatch as jasmine.Spy).calls.mostRecent().args[0] as ReturnType<
        typeof TaskSharedActions.addTask
      >;

    it('adds a shared link as one literal Inbox task carrying its LINK attachment', async () => {
      reset([
        share({
          title: 'Read #later +work',
          notes: 'https://example.com/a',
          link: 'https://example.com/a',
        }),
      ]);
      expect(await service.importPending()).toBe(1);
      expect(store.dispatch).toHaveBeenCalledTimes(1);
      const action = addedTask();
      expect(action.type).toBe(TaskSharedActions.addTask.type);
      expect(action.isIgnoreShortSyntax).toBeTrue();
      expect(action.workContextId).toBe(INBOX_PROJECT.id);
      expect(action.task.id).toBe(shareId);
      expect(action.task.title).toBe('Read #later +work');
      expect(action.task.projectId).toBe(INBOX_PROJECT.id);
      expect(action.task.timeEstimate).toBe(900_000);
      // The URL only stood in notes for apps that predate `link`.
      expect(action.task.notes).toBe('');
      expect(action.task.attachments).toEqual([
        jasmine.objectContaining({
          type: 'LINK',
          path: 'https://example.com/a',
          title: 'Read #later +work',
          icon: 'link',
        }),
      ]);
      expect(acknowledge).toHaveBeenCalledOnceWith(shareId);
    });

    it('keeps shared text as notes, beyond the server limit', async () => {
      const text = 'x'.repeat(20_000);
      reset([share({ title: 'Note', notes: text })]);
      await service.importPending();
      expect(addedTask().task.notes).toBe(text);
      expect(addedTask().task.attachments).toEqual([]);
    });

    it('drops a link that is not http(s), keeping the text', async () => {
      reset([
        share({
          title: 'Bad',
          notes: 'javascript:alert(1)',
          link: 'javascript:alert(1)',
        }),
      ]);
      await service.importPending();
      expect(addedTask().task.attachments).toEqual([]);
      expect(addedTask().task.notes).toBe('javascript:alert(1)');
    });

    it('leaves an invalid share in the inbox', async () => {
      reset([share({ title: '   ' })]);
      expect(await service.importPending()).toBe(0);
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('imports title captures and shares in one run', async () => {
      reset([share({ title: 'Shared', notes: 'Shared' })]);
      pending = entries({ id, title: 'Typed' });
      expect(await service.importPending()).toBe(2);
      expect(addedTasks().map((a) => [a.task.title, !!a.isIgnoreShortSyntax])).toEqual([
        ['Typed', false],
        ['Shared', true],
      ]);
      expect(acknowledge.calls.allArgs()).toEqual([[id], [shareId]]);
    });

    it('fails without acknowledging when the shares cannot be read', async () => {
      reset([]);
      shares = null;
      await expectAsync(service.importPending()).toBeRejected();
      expect(acknowledge).not.toHaveBeenCalled();
    });
  });
});
