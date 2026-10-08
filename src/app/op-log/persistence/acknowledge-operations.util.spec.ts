import { ActionType, Operation, OpType } from '../core/operation.types';
import {
  acknowledgeOperations,
  isRebasedTimeDeltaReceipt,
} from './acknowledge-operations.util';
import { OpLogTx } from './op-log-db-adapter';
import { decodeStoredEntry, StoredOperationLogEntry } from './operation-log-store-rows';
import { encodeOperation } from './compact/operation-codec.service';

const original: Operation = {
  id: 'delta',
  clientId: 'client',
  entityType: 'TASK',
  entityId: 'task',
  actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
  opType: OpType.Update,
  timestamp: 1,
  schemaVersion: 1,
  vectorClock: { client: 1 },
  payload: { taskId: 'task', date: '2026-10-03', duration: 3000 },
};
const rebased: Operation = { ...original, vectorClock: { client: 3, remote: 2 } };

describe('time delta upload receipt', () => {
  it('accepts only the same authored operation with an earlier clock', () => {
    expect(isRebasedTimeDeltaReceipt(rebased, original)).toBeTrue();
    expect(isRebasedTimeDeltaReceipt(rebased, { ...original, entityIds: [] })).toBeTrue();
    expect(
      isRebasedTimeDeltaReceipt(rebased, { ...original, entityIds: ['task'] }),
    ).toBeTrue();
    for (const change of [
      { id: 'different' },
      { clientId: 'foreign' },
      { entityId: 'other' },
      { entityIds: ['task', 'other'] },
      { timestamp: 2 },
      { schemaVersion: 2 },
      { payload: { taskId: 'task', date: '2026-10-03', duration: 4000 } },
      { vectorClock: { client: 4 } },
      { vectorClock: rebased.vectorClock },
      { actionType: ActionType.TASK_SHARED_UPDATE },
    ]) {
      expect(isRebasedTimeDeltaReceipt(rebased, { ...original, ...change })).toBeFalse();
    }
  });

  it('restores the original clock and acknowledges without changing replay sequence', async () => {
    const entry: StoredOperationLogEntry = {
      seq: 7,
      source: 'local',
      op: encodeOperation(rebased),
      appliedAt: 1,
    };
    const tx = jasmine.createSpyObj<OpLogTx>('tx', ['get', 'put']);
    tx.get.and.resolveTo(entry);
    tx.put.and.resolveTo();
    await acknowledgeOperations(tx, [7], new Map([[original.id, original]]));
    const stored = tx.put.calls.mostRecent().args[1] as StoredOperationLogEntry;
    expect(decodeStoredEntry(stored).op).toEqual(original);
    expect(stored.seq).toBe(7);
    expect(stored.syncedAt).toBeDefined();
    expect(tx.put.calls.mostRecent().args[0]).toBe('ops');
  });

  it('does not acknowledge an operation changed while the receipt was downloaded', async () => {
    const entry: StoredOperationLogEntry = {
      seq: 7,
      source: 'local',
      op: encodeOperation({ ...rebased, payload: { duration: 4000 } }),
      appliedAt: 1,
    };
    const tx = jasmine.createSpyObj<OpLogTx>('tx', ['get', 'put']);
    tx.get.and.resolveTo(entry);
    await expectAsync(
      acknowledgeOperations(tx, [7], new Map([[original.id, original]])),
    ).toBeRejected();
    expect(tx.put).not.toHaveBeenCalled();
  });
  it('treats a repeated receipt acknowledgement as a no-op', async () => {
    const entry: StoredOperationLogEntry = {
      seq: 7,
      source: 'local',
      op: encodeOperation(rebased),
      appliedAt: 1,
    };
    const tx = jasmine.createSpyObj<OpLogTx>('tx', ['get', 'put']);
    tx.get.and.resolveTo(entry);
    tx.put.and.resolveTo();
    const receipts = new Map([[original.id, original]]);
    await acknowledgeOperations(tx, [7], receipts);
    const syncedAt = entry.syncedAt;
    tx.put.calls.reset();
    await acknowledgeOperations(tx, [7], receipts);
    expect(tx.put).not.toHaveBeenCalled();
    expect(entry.syncedAt).toBe(syncedAt);
  });

  it('rejects changed content even when an acknowledged clock matches the receipt', async () => {
    const entry: StoredOperationLogEntry = {
      seq: 7,
      source: 'local',
      op: encodeOperation({ ...original, payload: { duration: 4000 } }),
      appliedAt: 1,
      syncedAt: 42,
    };
    const tx = jasmine.createSpyObj<OpLogTx>('tx', ['get', 'put']);
    tx.get.and.resolveTo(entry);
    await expectAsync(
      acknowledgeOperations(tx, [7], new Map([[original.id, original]])),
    ).toBeRejected();
    expect(tx.put).not.toHaveBeenCalled();
    expect(entry.syncedAt).toBe(42);
  });
});
