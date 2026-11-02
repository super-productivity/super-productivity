import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import {
  CAPTURE_IMPORT_ERR,
  getCaptureImportErrorReason,
  NativeCaptureImporter,
  NativeCaptureSource,
} from './native-capture-importer.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { selectTaskEntities } from '../store/task.selectors';

interface Entry {
  id: string;
  ok: boolean;
}

describe('NativeCaptureImporter', () => {
  const KEY = 'sp-test-capture-receipts';
  let importer: NativeCaptureImporter;
  let store: MockStore;
  let pending: Entry[];
  let source: jasmine.SpyObj<NativeCaptureSource<Entry>>;
  const receipts = (): string[] => JSON.parse(localStorage.getItem(KEY) || '[]');

  beforeEach(() => {
    pending = [];
    source = {
      receiptsKey: KEY,
      getPending: jasmine.createSpy('getPending').and.callFake(async () => pending),
      isValid: jasmine.createSpy('isValid').and.callFake((e: Entry) => e.ok),
      createTask: jasmine.createSpy('createTask'),
      acknowledge: jasmine.createSpy('acknowledge').and.resolveTo(),
    } as jasmine.SpyObj<NativeCaptureSource<Entry>>;
    const flush = jasmine.createSpyObj('Flush', ['flushPendingWrites']);
    flush.flushPendingWrites.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ selectors: [{ selector: selectTaskEntities, value: {} }] }),
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneStrict$: of(true) },
        },
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow$: new BehaviorSubject(false),
            isInSyncWindow: () => false,
          },
        },
        { provide: OperationWriteFlushService, useValue: flush },
        {
          provide: OperationCaptureService,
          useValue: { hasUnrecoveredPersistFailure: () => false },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    importer = TestBed.inject(NativeCaptureImporter);
  });

  afterEach(() => {
    store.resetSelectors();
    localStorage.removeItem(KEY);
  });

  it('skips invalid entries without creating, receipting or acknowledging them', async () => {
    pending = [
      { id: 'bad', ok: false },
      { id: 'good', ok: true },
    ];
    expect(await importer.importPending(source)).toEqual({ created: 1, invalid: 1 });
    expect(source.createTask).toHaveBeenCalledOnceWith(pending[1]);
    expect(source.acknowledge).toHaveBeenCalledOnceWith('good');
    expect(receipts()).toEqual([]);
  });

  it('prunes receipts whose native entry is gone', async () => {
    localStorage.setItem(KEY, JSON.stringify(['gone', 'kept']));
    pending = [{ id: 'kept', ok: true }];
    source.acknowledge.and.rejectWith(new Error(CAPTURE_IMPORT_ERR.ACK));
    await expectAsync(importer.importPending(source)).toBeRejected();
    expect(receipts()).toEqual(['kept']);
    expect(source.createTask).not.toHaveBeenCalled();
  });

  it('keeps the receipt when acknowledgement fails, so a retry only acknowledges', async () => {
    pending = [{ id: 'a', ok: true }];
    source.acknowledge.and.rejectWith(new Error(CAPTURE_IMPORT_ERR.ACK));
    await expectAsync(importer.importPending(source)).toBeRejected();
    expect(receipts()).toEqual(['a']);

    source.acknowledge.and.resolveTo();
    expect(await importer.importPending(source)).toEqual({ created: 0, invalid: 0 });
    expect(source.createTask).toHaveBeenCalledTimes(1);
    expect(receipts()).toEqual([]);
  });

  describe('getCaptureImportErrorReason', () => {
    it('reports the importer own failure messages', () => {
      expect(getCaptureImportErrorReason(new Error(CAPTURE_IMPORT_ERR.READ))).toBe(
        'Could not read capture inbox',
      );
    });

    it('reports only the error name for foreign errors, never their message', () => {
      expect(getCaptureImportErrorReason(new SyntaxError('"Buy milk" is not JSON'))).toBe(
        'SyntaxError',
      );
      expect(getCaptureImportErrorReason(new Error('Buy milk'))).toBe('Error');
      expect(getCaptureImportErrorReason('Buy milk')).toBe('unknown');
    });
  });
});
