import { describe, expect, it } from 'vitest';
import {
  SUPER_SYNC_MAX_ENTITY_IDS_PER_OP,
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SuperSyncDownloadOpsQuerySchema,
  SuperSyncDownloadOpsResponseSchema,
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

  it('caps entityIds per operation', () => {
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [
          {
            ...createValidOperation(),
            entityIds: Array.from(
              { length: SUPER_SYNC_MAX_ENTITY_IDS_PER_OP + 1 },
              (_, i) => `task-${i}`,
            ),
          },
        ],
        clientId: 'client_1',
      }),
    ).toThrow();
  });

  it('rejects invalid client IDs in upload requests', () => {
    expect(() =>
      SuperSyncUploadOpsRequestSchema.parse({
        ops: [createValidOperation('invalid client')],
        clientId: 'invalid client',
      }),
    ).toThrow();
  });

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

  it('validates download responses with latestSnapshotSeq and preserves future fields', () => {
    const parsed = SuperSyncDownloadOpsResponseSchema.parse({
      ops: [],
      hasMore: false,
      latestSeq: 20,
      latestSnapshotSeq: 10,
      snapshotVectorClock: { client_1: 10 },
      serverTime: 1234567890,
      futureServerField: 'kept',
    });

    expect(parsed.latestSnapshotSeq).toBe(10);
    expect((parsed as { futureServerField?: string }).futureServerField).toBe('kept');
  });
});
