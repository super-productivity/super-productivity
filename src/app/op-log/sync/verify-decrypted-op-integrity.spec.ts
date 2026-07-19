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

  describe('rejects project-move footprint tampering (fail closed)', () => {
    it('throws when op.entityIds injects a victim id absent from the authenticated footprint', () => {
      // Valid encrypted move of task-123 (+ subtask sub-1). A compromised server
      // appended victim-task to the plaintext envelope so the LWW project-repair
      // reducer would drag it out of its project too. GHSA-8pxh-mgc7-gp3g.
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'victim-task'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
        changes: { projectId: 'project-2' },
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws for the multi-entity-wrapped move payload too', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'victim-task'],
      });
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', projectMoveSubTaskIds: [] },
        entityChanges: [],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });

    it('throws when a non-string id is injected into op.entityIds', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 42 as unknown as string],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).toThrowError(OperationIntegrityError);
    });
  });

  describe('accepts legitimate project moves (no false positives)', () => {
    it('passes when op.entityIds exactly equals {entityId} ∪ projectMoveSubTaskIds (flat)', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'sub-2'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1', 'sub-2'],
        changes: { projectId: 'project-2' },
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('passes for the multi-entity-wrapped move payload', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1'],
      });
      const authenticatedPayload = {
        actionPayload: { id: 'task-123', projectMoveSubTaskIds: ['sub-1'] },
        entityChanges: [],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('ignores ordering differences (set, not sequence, equality)', () => {
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['sub-1', 'task-123'],
      });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('does not validate entityIds when the payload carries no authenticated footprint (synthetic LWW op)', () => {
      // Synthetic conflict-resolution ops carry entityIds in the envelope only;
      // there is no projectMoveSubTaskIds to bind against, so they must pass
      // untouched (validating them would reject valid ops and break sync).
      const op = createOp({
        entityId: 'task-123',
        entityIds: ['task-123', 'sub-1', 'anything'],
      });
      const authenticatedPayload = { id: 'task-123', changes: {} };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });

    it('does not validate footprint when op.entityIds is absent', () => {
      const op = createOp({ entityId: 'task-123', entityIds: undefined });
      const authenticatedPayload = {
        id: 'task-123',
        projectMoveSubTaskIds: ['sub-1'],
      };
      expect(() =>
        assertDecryptedOpMetadataIntegrity(op, authenticatedPayload),
      ).not.toThrow();
    });
  });
});
