import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, ReplaySubject } from 'rxjs';
import { IOS_SHARE, IosSharePlugin, IosShareService } from './ios-share.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { selectTaskEntities } from '../store/task.selectors';
import { DEFAULT_TASK } from '../task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { iosInterface } from '../../ios/ios-interface';

describe('IosShareService', () => {
  let plugin: jasmine.SpyObj<IosSharePlugin>;
  let flush: jasmine.SpyObj<OperationWriteFlushService>;
  let capture: jasmine.SpyObj<OperationCaptureService>;
  let service: IosShareService;
  let store: MockStore;
  let loaded: ReplaySubject<boolean>;
  let syncWindow: BehaviorSubject<boolean>;
  const id = '7DCC80FA-577A-4D99-B16E-15D4B8787B62';

  beforeEach(() => {
    plugin = jasmine.createSpyObj('IosShare', ['getPending', 'acknowledge']);
    plugin.getPending.and.resolveTo({
      shares: [{ id, title: 'Article +work #tag', text: 'https://example.com/?a=1&b=2' }],
    });
    plugin.acknowledge.and.resolveTo();
    flush = jasmine.createSpyObj('Flush', ['flushPendingWrites']);
    flush.flushPendingWrites.and.resolveTo();
    capture = jasmine.createSpyObj('Capture', ['hasUnrecoveredPersistFailure']);
    capture.hasUnrecoveredPersistFailure.and.returnValue(false);
    loaded = new ReplaySubject<boolean>(1);
    syncWindow = new BehaviorSubject(false);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneStrict$: of(true) },
        },
        provideMockStore({ selectors: [{ selector: selectTaskEntities, value: {} }] }),
        { provide: IOS_SHARE, useValue: plugin },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: loaded },
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
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    service = TestBed.inject(IosShareService);
  });

  afterEach(() => {
    store.resetSelectors();
    localStorage.removeItem('sp-ios-share-receipts');
  });

  it('waits for hydration, then creates one literal Inbox task preserving the URL', async () => {
    const imported = service.importPending();
    await Promise.resolve();
    expect(store.dispatch).not.toHaveBeenCalled();
    loaded.next(true);
    await imported;
    const action = (store.dispatch as jasmine.Spy).calls.mostRecent().args[0];
    expect(action.task.created).toEqual(jasmine.any(Number));
    expect(store.dispatch).toHaveBeenCalledOnceWith(
      TaskSharedActions.addTask({
        task: {
          ...DEFAULT_TASK,
          id,
          title: 'Article +work #tag',
          notes: 'https://example.com/?a=1&b=2',
          projectId: 'INBOX_PROJECT',
          created: action.task.created,
        },
        workContextId: 'INBOX_PROJECT',
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: true,
        isIgnoreShortSyntax: true,
      }),
    );
    expect(plugin.acknowledge).toHaveBeenCalledOnceWith({ id });
  });

  it('retains the native share until the task write completes', async () => {
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
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(plugin.acknowledge).not.toHaveBeenCalled();
    finish();
    await imported;
    expect(plugin.acknowledge).toHaveBeenCalled();
  });

  it('retains the share when persistence fails even if the flush resolves', async () => {
    capture.hasUnrecoveredPersistFailure.and.returnValue(true);
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    expect(plugin.acknowledge).not.toHaveBeenCalled();
  });

  it('does not recreate a task after a crash between persistence and acknowledgement', async () => {
    store.overrideSelector(selectTaskEntities, {
      [id]: { ...DEFAULT_TASK, id, projectId: 'INBOX_PROJECT' },
    });
    store.refreshState();
    loaded.next(true);
    await service.importPending();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(plugin.acknowledge).toHaveBeenCalledWith({ id });
  });

  it('retries acknowledgement without recreating an already deleted or archived task', async () => {
    plugin.acknowledge.and.rejectWith(new Error('Native write failed'));
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    plugin.acknowledge.and.resolveTo();
    await service.importPending();
    expect(store.dispatch).toHaveBeenCalledTimes(1);
  });

  it('waits until remote replay ends before creating a task', async () => {
    syncWindow.next(true);
    loaded.next(true);
    const imported = service.importPending();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(store.dispatch).not.toHaveBeenCalled();
    syncWindow.next(false);
    await imported;
    expect(store.dispatch).toHaveBeenCalledTimes(1);
  });

  it('uses a text title fallback while preserving the complete multiline note', async () => {
    const text = 'Read this #later\nMore context';
    plugin.getPending.and.resolveTo({ shares: [{ id, title: '', text }] });
    loaded.next(true);
    await service.importPending();
    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        task: jasmine.objectContaining({ title: 'Read this #later', notes: text }),
        isIgnoreShortSyntax: true,
      }),
    );
  });

  it('keeps oversized shares instead of silently truncating notes', async () => {
    plugin.getPending.and.resolveTo({
      shares: [{ id, title: '', text: 'a'.repeat(100_001) }],
    });
    loaded.next(true);
    await expectAsync(service.importPending()).toBeRejected();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(plugin.acknowledge).not.toHaveBeenCalled();
  });

  it('serializes cold start and native resume events', async () => {
    let finish!: () => void;
    plugin.getPending.and.returnValue(
      new Promise((resolve) => {
        finish = () => resolve({ shares: [] });
      }),
    );
    loaded.next(true);
    service.start();
    iosInterface.onResume$.next();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(plugin.getPending).toHaveBeenCalledTimes(1);
    plugin.getPending.and.resolveTo({ shares: [] });
    finish();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    expect(plugin.getPending).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
    iosInterface.onResume$.next();
    expect(plugin.getPending).toHaveBeenCalledTimes(2);
  });
});
