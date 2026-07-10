import { assertDecryptedOpMetadataIntegrity } from './verify-decrypted-op-integrity';
import { SyncOperation } from '../sync-providers/provider.interface';
import { OperationIntegrityError } from '../core/errors/sync-errors';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { SINGLETON_ENTITY_ID } from '../core/entity-registry';

describe('assertDecryptedOpMetadataIntegrity', () => {
  const LWW_TASK = toLwwUpdateActionType('TASK');

  const createOp = (over: Partial<SyncOperation>): SyncOperation => ({
    id: 'op-1',
    clientId: 'clientA',
    actionType: LWW_TASK,
    opType: 'UPDATE',
    entityType: 'TASK',
    entityId: 'task-123',
    payload: null,
    vectorClock: { clientA: 1 },
    timestamp: 1,
    schemaVersion: 1,
    ...over,
  });

  describe('rejects tampering (fail closed)', () => {
    it('throws when a LWW-update entityId does not match the authenticated payload.id', () => {
      // Attacker retagged op.entityId from the real target (task-123) to task-999.
      const op = createOp({ entityId: 'task-999' });
      const authenticatedPayload = { id: 'task-123', changes: { title: 'x' } };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('detects tampering for a multi-entity-wrapped LWW payload (actionPayload.id)', () => {
      const op = createOp({ entityId: 'task-999' });
      // Multi-entity payload shape: the real id lives under actionPayload.
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', changes: { title: 'x' } },
        entityChanges: [{ entityType: 'TASK', entityId: 'task-123', opType: 'UPDATE' }],
      };

      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('fails closed when an in-scope LWW payload carries no string id', () => {
      // convertOpToAction would coerce id = op.entityId (the tampered value)
      // when payload.id is absent, so a missing id must be rejected too, not
      // skipped. (Codex/correctness finding on the interim fix.)
      const op = createOp({ entityId: 'task-999' });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { changes: { title: 'x' } }),
      ).toThrowError(OperationIntegrityError);
    });

    it('fails closed for a non-object payload on an in-scope LWW op', () => {
      const op = createOp({ entityId: 'task-123' });
      expect(() => assertDecryptedOpMetadataIntegrity(op, null)).toThrowError(
        OperationIntegrityError,
      );
      expect(() => assertDecryptedOpMetadataIntegrity(op, 'a string')).toThrowError(
        OperationIntegrityError,
      );
    });
  });

  describe('accepts legitimate ops (no false positives)', () => {
    it('passes when payload.id matches op.entityId', () => {
      const op = createOp({ entityId: 'task-123' });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123', changes: {} }),
      ).not.toThrow();
    });

    it('ignores non-LWW action types (e.g. plain updates)', () => {
      const op = createOp({ actionType: 'UPDATE_TASK', entityId: 'task-999' });
      // Even a mismatch is out of scope: convertOpToAction won't LWW-coerce it.
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123' }),
      ).not.toThrow();
    });

    it('ignores singleton entities (no payload.id to compare)', () => {
      const op = createOp({ entityId: SINGLETON_ENTITY_ID });
      expect(() => assertDecryptedOpMetadataIntegrity(op, { foo: 'bar' })).not.toThrow();
    });

    it('does not throw when entityId is missing (out of scope)', () => {
      const op = createOp({ entityId: undefined });
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, { id: 'task-123' }),
      ).not.toThrow();
    });
  });
});
