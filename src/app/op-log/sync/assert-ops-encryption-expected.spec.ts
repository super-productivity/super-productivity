import { assertOpsEncryptedWhenExpected } from './assert-ops-encryption-expected';
import { SyncOperation } from '../sync-providers/provider.interface';
import { OperationIntegrityError } from '../core/errors/sync-errors';

describe('assertOpsEncryptedWhenExpected', () => {
  const op = (over: Partial<SyncOperation>): SyncOperation => ({
    id: 'op-1',
    clientId: 'clientA',
    actionType: '[TASK] LWW Update',
    opType: 'UPDATE',
    entityType: 'TASK',
    entityId: 'task-1',
    payload: 'ciphertext',
    vectorClock: { clientA: 1 },
    timestamp: 1,
    schemaVersion: 1,
    isPayloadEncrypted: true,
    ...over,
  });

  it('rejects a plaintext op when encryption is expected (fail closed)', () => {
    const ops = [op({ id: 'a' }), op({ id: 'b', isPayloadEncrypted: false })];
    expect(() => assertOpsEncryptedWhenExpected(ops, true)).toThrowError(
      OperationIntegrityError,
    );
  });

  it('rejects an op whose isPayloadEncrypted is undefined when encryption is expected', () => {
    const ops = [op({ id: 'a', isPayloadEncrypted: undefined })];
    expect(() => assertOpsEncryptedWhenExpected(ops, true)).toThrowError(
      OperationIntegrityError,
    );
  });

  it('accepts an all-encrypted batch when encryption is expected', () => {
    const ops = [op({ id: 'a' }), op({ id: 'b' })];
    expect(() => assertOpsEncryptedWhenExpected(ops, true)).not.toThrow();
  });

  it('does not enforce when encryption is not expected (plaintext allowed)', () => {
    const ops = [op({ id: 'a', isPayloadEncrypted: false })];
    expect(() => assertOpsEncryptedWhenExpected(ops, false)).not.toThrow();
  });

  it('accepts an empty batch', () => {
    expect(() => assertOpsEncryptedWhenExpected([], true)).not.toThrow();
  });
});
