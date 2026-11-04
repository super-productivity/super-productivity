import { TestBed } from '@angular/core/testing';
import {
  selectOwnOpsLostByServerRewind,
  ServerHeldOwnOps,
  ServerRewindReseedService,
} from './server-rewind-reseed.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  EntityType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import {
  OperationSyncCapable,
  ServerSyncOperation,
} from '../sync-providers/provider.interface';
import { OpLog } from '../../core/log';

const ME = 'client-me';
const OTHER = 'client-other';

const op = (
  id: string,
  clientId: string,
  counter: number,
  opType = OpType.Update,
): Operation =>
  ({
    id,
    clientId,
    actionType: '[Task] Update' as ActionType,
    opType,
    entityType: 'TASK' as EntityType,
    entityId: 'task-1',
    payload: {},
    vectorClock: { [clientId]: counter },
    timestamp: 1,
    schemaVersion: 1,
  }) as Operation;

const entry = (
  seq: number,
  operation: Operation,
  extra: Partial<OperationLogEntry> = {},
): OperationLogEntry => ({
  seq,
  op: operation,
  appliedAt: 1,
  source: operation.clientId === ME ? 'local' : 'remote',
  syncedAt: 1,
  ...extra,
});

const serverOp = (serverSeq: number, operation: Operation): ServerSyncOperation => ({
  serverSeq,
  op: { ...operation, isPayloadEncrypted: true, payload: 'cipher' },
  receivedAt: 1,
});

describe('selectOwnOpsLostByServerRewind', () => {
  const held = (ids: string[], ownCounterInFullState = 0): ServerHeldOwnOps => ({
    ownOpIds: new Set(ids),
    ownCounterInFullState,
  });

  it('selects own synced ops the server no longer has', () => {
    const entries = [entry(1, op('a', ME, 1)), entry(2, op('b', ME, 2))];
    expect(selectOwnOpsLostByServerRewind(entries, ME, held(['a']))).toEqual(['b']);
  });

  it('skips ops of other clients, unsynced, rejected and full-state ops', () => {
    const entries = [
      entry(1, op('remote', OTHER, 1)),
      entry(2, op('pending', ME, 2), { syncedAt: undefined }),
      entry(3, op('rejected', ME, 3), { rejectedAt: 1 }),
      entry(4, op('reducer-rejected', ME, 4), { reducerRejectedAt: 1 }),
      entry(5, op('import', ME, 5, OpType.SyncImport)),
      entry(6, op('lost', ME, 6)),
    ];
    expect(selectOwnOpsLostByServerRewind(entries, ME, held([]))).toEqual(['lost']);
  });

  it('skips own ops covered by a full-state op on the server', () => {
    // Ops folded into a snapshot upload were never uploaded on their own.
    const entries = [entry(1, op('in-snapshot', ME, 3)), entry(2, op('after', ME, 4))];
    expect(selectOwnOpsLostByServerRewind(entries, ME, held([], 3))).toEqual(['after']);
  });
});

describe('ServerRewindReseedService', () => {
  let service: ServerRewindReseedService;
  let store: jasmine.SpyObj<OperationLogStoreService>;
  let provider: jasmine.SpyObj<OperationSyncCapable>;

  beforeEach(() => {
    store = jasmine.createSpyObj('OperationLogStoreService', [
      'getLatestFullStateOpEntry',
      'getOpsAfterSeq',
      'markUnsynced',
    ]);
    store.markUnsynced.and.resolveTo();
    provider = jasmine.createSpyObj('OperationSyncCapable', ['downloadOps']);
    spyOn(OpLog, 'warn');
    TestBed.configureTestingModule({
      providers: [{ provide: OperationLogStoreService, useValue: store }],
    });
    service = TestBed.inject(ServerRewindReseedService);
  });

  it('lists the server including own ops and re-queues the missing ones', async () => {
    const importOp = op('import', OTHER, 1, OpType.SyncImport);
    importOp.vectorClock = { [OTHER]: 1, [ME]: 2 };
    provider.downloadOps.and.returnValues(
      Promise.resolve({
        ops: [serverOp(1, importOp), serverOp(2, op('kept', ME, 3))],
        hasMore: true,
        latestSeq: 3,
      }),
      Promise.resolve({
        ops: [serverOp(3, op('other', OTHER, 2))],
        hasMore: false,
        latestSeq: 3,
      }),
    );
    store.getLatestFullStateOpEntry.and.resolveTo(entry(10, importOp));
    store.getOpsAfterSeq.and.resolveTo([
      entry(11, op('kept', ME, 3)),
      entry(12, op('other', OTHER, 2)),
      entry(13, op('lost-1', ME, 4)),
      entry(14, op('lost-2', ME, 5)),
    ]);

    const count = await service.requeueOwnOpsLostByRewind(provider, ME);

    expect(provider.downloadOps.calls.allArgs()).toEqual([
      [0, undefined, 500],
      [2, undefined, 500],
    ]);
    expect(store.getOpsAfterSeq).toHaveBeenCalledWith(10);
    expect(store.markUnsynced).toHaveBeenCalledOnceWith(['lost-1', 'lost-2']);
    expect(count).toBe(2);
  });

  it('reads the whole local log when it holds no full-state op', async () => {
    provider.downloadOps.and.resolveTo({ ops: [], hasMore: false, latestSeq: 1 });
    store.getLatestFullStateOpEntry.and.resolveTo(undefined);
    store.getOpsAfterSeq.and.resolveTo([]);

    expect(await service.requeueOwnOpsLostByRewind(provider, ME)).toBe(0);
    expect(store.getOpsAfterSeq).toHaveBeenCalledWith(0);
    expect(store.markUnsynced).not.toHaveBeenCalled();
  });

  it('stops listing on a page that does not advance', async () => {
    provider.downloadOps.and.resolveTo({ ops: [], hasMore: true, latestSeq: 5 });
    store.getLatestFullStateOpEntry.and.resolveTo(undefined);
    store.getOpsAfterSeq.and.resolveTo([entry(1, op('lost', ME, 1))]);

    expect(await service.requeueOwnOpsLostByRewind(provider, ME)).toBe(1);
    expect(provider.downloadOps).toHaveBeenCalledTimes(1);
  });
});
