import { describe, expect, it } from 'vitest';
import { summarizeLwwResolutions } from '../src/lww-conflict-summary';
import { OpType } from '../src/operation.types';
import type { EntityConflict, Operation } from '../src/operation.types';
import type { LwwResolvedConflict } from '../src/conflict-resolution';

const payloadKeyFor = (entityType: string): string => entityType.toLowerCase();

const createOp = (overrides: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  actionType: '[Task] Update',
  opType: OpType.Update,
  entityType: 'TASK',
  entityId: 'task-1',
  payload: {},
  clientId: 'client-1',
  vectorClock: { client1: 1 },
  timestamp: 1_000,
  schemaVersion: 1,
  ...overrides,
});

const updateOp = (
  changes: Record<string, unknown>,
  overrides: Partial<Operation> = {},
): Operation =>
  createOp({
    opType: OpType.Update,
    payload: { task: { id: 'task-1', changes } },
    ...overrides,
  });

const resolution = (
  winner: 'local' | 'remote',
  localOps: Operation[],
  remoteOps: Operation[],
  conflictOverrides: Partial<EntityConflict> = {},
): LwwResolvedConflict => ({
  winner,
  conflict: {
    entityType: 'TASK',
    entityId: 'task-1',
    localOps,
    remoteOps,
    suggestedResolution: 'manual',
    ...conflictOverrides,
  },
});

describe('summarizeLwwResolutions', () => {
  it('classifies a discarded scheduling edit as routine (not content)', () => {
    // remote wins -> local op is discarded; it only touched dueDay
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [updateOp({ dueDay: '2026-07-02' })],
          [updateOp({ dueDay: null })],
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(1);
    expect(summary.contentConflicts).toEqual([]);
  });

  it('flags a discarded title edit as a content conflict', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [updateOp({ title: 'My local title' })],
          [updateOp({ notes: 'x' })],
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(0);
    expect(summary.contentConflicts).toEqual([
      { entityType: 'TASK', entityId: 'task-1', discardedFields: ['title'] },
    ]);
  });

  it('inspects the remote (losing) side when local wins', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'local',
          [updateOp({ dueDay: null })],
          [updateOp({ notes: 'lost note' })],
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(0);
    expect(summary.contentConflicts).toEqual([
      { entityType: 'TASK', entityId: 'task-1', discardedFields: ['notes'] },
    ]);
  });

  it('treats subtask-structure and attachment changes as content', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [updateOp({ subTaskIds: ['a', 'b'] })],
          [updateOp({ isDone: true })],
        ),
        resolution(
          'remote',
          [updateOp({ attachments: [{ id: 'att-1' }] }, { entityId: 'task-2' })],
          [updateOp({ dueDay: null }, { entityId: 'task-2' })],
          { entityId: 'task-2' },
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(0);
    expect(summary.contentConflicts.map((c) => c.discardedFields)).toEqual([
      ['subTaskIds'],
      ['attachments'],
    ]);
  });

  it('does not flag discarded CREATE / DELETE / MOVE ops (only field-level UPDATE loss)', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [createOp({ opType: OpType.Delete, payload: { task: { id: 'task-1' } } })],
          [updateOp({ dueDay: null })],
        ),
        resolution(
          'remote',
          [createOp({ opType: OpType.Move, payload: { task: { title: 'archived' } } })],
          [updateOp({ dueDay: null })],
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(2);
    expect(summary.contentConflicts).toEqual([]);
  });

  it('ignores content-shaped fields on entity types without a content-field list', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [
            createOp({
              entityType: 'TAG',
              payload: { tag: { id: 'tag-1', changes: { title: 'x' } } },
            }),
          ],
          [createOp({ entityType: 'TAG' })],
          { entityType: 'TAG' },
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(1);
    expect(summary.contentConflicts).toEqual([]);
  });

  it('detects content changes inside a multi-entity payload', () => {
    const multiEntityLocalOp = createOp({
      opType: OpType.Update,
      payload: {
        actionPayload: { task: { id: 'task-1' } },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { title: 'edited' },
          },
          {
            entityType: 'PROJECT',
            entityId: 'proj-1',
            opType: OpType.Update,
            changes: { taskIds: [] },
          },
        ],
      },
    });

    const summary = summarizeLwwResolutions(
      [resolution('remote', [multiEntityLocalOp], [updateOp({ dueDay: null })])],
      { payloadKeyFor },
    );

    expect(summary.contentConflicts).toEqual([
      { entityType: 'TASK', entityId: 'task-1', discardedFields: ['title'] },
    ]);
  });

  it('splits a mixed batch into routine + content', () => {
    const summary = summarizeLwwResolutions(
      [
        resolution(
          'remote',
          [updateOp({ dueDay: null })],
          [updateOp({ dueDay: '2026-07-02' })],
        ),
        resolution(
          'remote',
          [updateOp({ title: 'lost' }, { entityId: 'task-9' })],
          [updateOp({ isDone: true }, { entityId: 'task-9' })],
          { entityId: 'task-9' },
        ),
      ],
      { payloadKeyFor },
    );

    expect(summary.routineCount).toBe(1);
    expect(summary.contentConflicts).toHaveLength(1);
    expect(summary.contentConflicts[0].entityId).toBe('task-9');
  });
});
