import { describe, expect, it } from 'vitest';
import {
  SUPER_SYNC_MAX_ENTITY_IDS_PER_OP,
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsQuerySchema,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsRequestSchema,
  SuperSyncUploadSnapshotRequestSchema,
} from '../src/supersync-http-contract';

const createValidOperation = (clientId: string = 'client_1') => ({
  id: 'op-1',
  clientId,
  actionType: '[Task] Add task',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Test' },
  vectorClock: { [clientId]: 1 },
  timestamp: 1234567890,
  schemaVersion: 1,
});

describe('SuperSync HTTP contract schemas', () => {
  it('validates ops upload requests with the shared server limit', () => {
    const parsed = SuperSyncUploadOpsRequestSchema.parse({
      ops: [createValidOperation()],
      clientId: 'client_1',
      lastKnownServerSeq: 12,
      requestId: 'request-1',
      isCleanSlate: false,
    });

    expect(parsed.ops.length).toBe(1);
    expect(SUPER_SYNC_MAX_OPS_PER_UPLOAD).toBe(100);
  });

  it('preserves server request behavior by stripping unknown upload fields', () => {
    const parsed = SuperSyncUploadOpsRequestSchema.parse({
      ops: [{ ...createValidOperation(), extraOpField: true }],
      clientId: 'client_1',
      extraRequestField: true,
    });

    expect('extraRequestField' in parsed).toBe(false);
    expect('extraOpField' in parsed.ops[0]).toBe(false);
  });

  it('passes oversized entityIds through for per-operation validation', () => {
    const operation = {
      ...createValidOperation(),
      entityIds: Array.from(
        { length: SUPER_SYNC_MAX_ENTITY_IDS_PER_OP + 1 },
        (_, i) => `task-${i}`,
      ),
    };

    const parsed = SuperSyncUploadOpsRequestSchema.parse({
      ops: [operation],
      clientId: 'client_1',
    });

    expect(parsed.ops[0].entityIds).toHaveLength(SUPER_SYNC_MAX_ENTITY_IDS_PER_OP + 1);
    expect(() => SuperSyncOperationSchema.parse(operation)).toThrow();
  });

  it('rejects invalid client IDs in upload requests', () => {
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [createValidOperation('invalid client')],
        clientId: 'invalid client',
      }),
    ).toThrow();
  });

  it.each([0, 1.5, -1, 101])(
    'passes operation schema version %s through the upload transport schema',
    (schemaVersion) => {
      const parsed = SuperSyncUploadOpsRequestSchema.parse({
        ops: [{ ...createValidOperation(), schemaVersion }],
        clientId: 'client_1',
      });

      expect(parsed.ops[0].schemaVersion).toBe(schemaVersion);
      expect(() =>
        SuperSyncOperationSchema.parse({
          ...createValidOperation(),
          schemaVersion,
        }),
      ).toThrow();
    },
  );

  it.each([
    ['empty operation ID', { id: '' }],
    ['overlong operation ID', { id: 'x'.repeat(256) }],
    ['mismatched operation client ID', { clientId: 'other client' }],
    ['unknown operation type', { opType: 'UNKNOWN' }],
    ['unknown entity type', { entityType: 'UNKNOWN' }],
    ['overlong entity ID', { entityId: 'x'.repeat(256) }],
    ['invalid vector-clock entry', { vectorClock: { client_1: 'invalid' } }],
  ])('passes semantic %s through for per-operation validation', (_label, override) => {
    const operation = { ...createValidOperation(), ...override };
    const parsed = SuperSyncUploadOpsRequestSchema.parse({
      ops: [operation],
      clientId: 'client_1',
    });

    expect(parsed.ops).toHaveLength(1);
  });

  it.each([
    ['non-string operation ID', { id: 123 }],
    ['empty action type', { actionType: '' }],
    ['non-string operation type', { opType: 123 }],
    ['non-string entity type', { entityType: 123 }],
    ['non-string entity ID', { entityId: 123 }],
    ['non-string entityIds member', { entityIds: ['task-1', 123] }],
    ['non-object vector clock', { vectorClock: [] }],
    ['non-numeric timestamp', { timestamp: '123' }],
    ['non-numeric schema version', { schemaVersion: '1' }],
    ['non-boolean encryption flag', { isPayloadEncrypted: 'true' }],
    ['unknown import reason', { syncImportReason: 'UNKNOWN' }],
  ])('keeps the upload transport constraint for %s', (_label, override) => {
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [{ ...createValidOperation(), ...override }],
        clientId: 'client_1',
      }),
    ).toThrow();
  });

  it('rejects semantically invalid identifiers beyond the absolute transport cap', () => {
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [{ ...createValidOperation(), id: 'x'.repeat(4097) }],
        clientId: 'client_1',
      }),
    ).toThrow();
  });

  it.each([0, 1.5, -1, 101])(
    'rejects malformed snapshot schema version %s',
    (schemaVersion) => {
      expect(() =>
        SuperSyncUploadSnapshotRequestSchema.parse({
          state: {},
          clientId: 'client_1',
          reason: 'recovery',
          vectorClock: { client_1: 1 },
          schemaVersion,
        }),
      ).toThrow();
    },
  );

  it('coerces download query numbers like the route-level schema', () => {
    const parsed = SuperSyncDownloadOpsQuerySchema.parse({
      sinceSeq: '5',
      limit: '50',
      excludeClient: 'client-1',
    });

    expect(parsed).toEqual({
      sinceSeq: 5,
      limit: 50,
      excludeClient: 'client-1',
    });
  });

  it('validates snapshot upload requests', () => {
    const parsed = SuperSyncUploadSnapshotRequestSchema.parse({
      state: { tasks: {} },
      clientId: 'client_1',
      reason: 'recovery',
      vectorClock: { client_1: 2 },
      schemaVersion: 1,
      isPayloadEncrypted: true,
      syncImportReason: 'BACKUP_RESTORE',
      opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
      isCleanSlate: true,
      snapshotOpType: 'BACKUP_IMPORT',
      requestId: 'snapshot-v1-request',
    });

    expect(parsed.snapshotOpType).toBe('BACKUP_IMPORT');
    expect(parsed.requestId).toBe('snapshot-v1-request');
  });

  it('accepts legacy repair snapshots and preserves a causal base when present', () => {
    const repairRequest = {
      state: { tasks: {} },
      clientId: 'client_1',
      reason: 'recovery' as const,
      vectorClock: { client_1: 2 },
      schemaVersion: 1,
      opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
      snapshotOpType: 'REPAIR' as const,
    };

    expect(SuperSyncUploadSnapshotRequestSchema.parse(repairRequest)).toEqual(
      repairRequest,
    );

    const parsed = SuperSyncUploadSnapshotRequestSchema.parse({
      ...repairRequest,
      repairBaseServerSeq: 42,
    });
    expect(parsed.repairBaseServerSeq).toBe(42);
  });

  it('preserves causal repair metadata on downloaded operations', () => {
    const parsed = SuperSyncOperationSchema.parse({
      ...createValidOperation(),
      opType: 'REPAIR',
      repairBaseServerSeq: 42,
    });

    expect(parsed.repairBaseServerSeq).toBe(42);
  });

  it('preserves causal repair capability negotiation on downloads', () => {
    const parsed = SuperSyncDownloadOpsResponseSchema.parse({
      ops: [],
      hasMore: false,
      latestSeq: 0,
      capabilities: { causalRepairSnapshots: true },
    });

    expect(parsed.capabilities?.causalRepairSnapshots).toBe(true);
  });

  it('requires an operation ID for destructive clean-slate snapshots', () => {
    expect(() =>
      SuperSyncUploadSnapshotRequestSchema.parse({
        state: {},
        clientId: 'client_1',
        reason: 'recovery',
        vectorClock: { client_1: 1 },
        schemaVersion: 1,
        isCleanSlate: true,
      }),
    ).toThrow();
  });

  it('rejects requestIds containing characters outside the safe-log charset', () => {
    // Control character — would be unsafe to embed in server log lines.
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [createValidOperation()],
        clientId: 'client_1',
        requestId: 'has\nnewline-injected',
      }),
    ).toThrow();

    // Space is not part of the allowed charset.
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [createValidOperation()],
        clientId: 'client_1',
        requestId: 'has space',
      }),
    ).toThrow();

    // Longer than 64 chars — exceeds the documented bound.
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [createValidOperation()],
        clientId: 'client_1',
        requestId: 'x'.repeat(65),
      }),
    ).toThrow();
  });
});
