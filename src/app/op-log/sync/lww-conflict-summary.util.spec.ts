import {
  findLwwContentConflicts,
  findPatchContentConflicts,
} from './lww-conflict-summary.util';
import { OpType, type LwwResolvedConflict } from '@sp/sync-core';
import type { ActionType, EntityConflict, Operation } from '../core/operation.types';

const payloadKeyFor = (entityType: string): string => entityType.toLowerCase();

let nextOpId = 0;
const op = (overrides: Partial<Operation> = {}): Operation => ({
  id: `op-${++nextOpId}`,
  actionType: '[Task] Update' as ActionType,
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

/**
 * The shape the capture layer ACTUALLY emits: every op is wrapped as
 * `{ actionPayload, entityChanges }`, and for task edits `entityChanges` is
 * empty (only time-tracking populates it). A classifier that reads only
 * `entityChanges` would silently miss every real content edit — these ops
 * guard that regression.
 */
const wrappedUpdate = (
  changes: Record<string, unknown>,
  overrides: Partial<Operation> = {},
): Operation =>
  op({
    opType: OpType.Update,
    payload: {
      actionPayload: { task: { id: overrides.entityId ?? 'task-1', changes } },
      entityChanges: [],
    },
    ...overrides,
  });

const resolution = (
  winner: 'local' | 'remote',
  localOps: Operation[],
  remoteOps: Operation[],
  overrides: Partial<EntityConflict> = {},
): LwwResolvedConflict<Operation, EntityConflict> => ({
  winner,
  conflict: {
    entityType: 'TASK',
    entityId: 'task-1',
    localOps,
    remoteOps,
    suggestedResolution: 'manual',
    ...overrides,
  },
});

describe('findLwwContentConflicts', () => {
  for (const winner of ['local', 'remote'] as const) {
    it(`ignores identical task content when the ${winner} side wins`, () => {
      const content = (): Record<string, unknown> => ({
        title: 'Daily review',
        notes: 'Review the inbox',
        subTaskIds: ['a', 'b'],
      });

      expect(
        findLwwContentConflicts(
          [resolution(winner, [wrappedUpdate(content())], [wrappedUpdate(content())])],
          payloadKeyFor,
        ),
      ).toEqual([]);
    });
  }

  it('only reports differences in the final content written on each side', () => {
    expect(
      findLwwContentConflicts(
        [
          resolution(
            'remote',
            [
              wrappedUpdate({ title: 'Draft' }),
              wrappedUpdate({ title: 'Review', notes: '', subTaskIds: ['a', 'b'] }),
            ],
            [
              wrappedUpdate({ title: 'Old', notes: 'Keep these notes' }),
              wrappedUpdate({ title: 'Review', subTaskIds: ['b', 'a'] }),
            ],
          ),
        ],
        payloadKeyFor,
      ),
    ).toEqual([{ entityId: 'task-1', discardedFields: ['notes', 'subTaskIds'] }]);
  });

  it('uses the retained update for sibling conflict rows on the same task', () => {
    const local = wrappedUpdate({ title: 'Daily review' });
    const create = op({ opType: OpType.Create });
    const remote = wrappedUpdate({ title: 'Daily review' });

    expect(
      findLwwContentConflicts(
        [
          resolution('remote', [local], [create]),
          resolution('remote', [local], [remote]),
        ],
        payloadKeyFor,
      ),
    ).toEqual([]);
  });

  it('keeps the warning when a retained snapshot can overwrite an equal field', () => {
    const snapshot = op({
      actionType: '[TASK] LWW Update' as ActionType,
      payload: {
        actionPayload: { id: 'task-1', title: 'Replacement' },
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
    });

    expect(
      findLwwContentConflicts(
        [
          resolution(
            'remote',
            [wrappedUpdate({ title: 'Review' })],
            [wrappedUpdate({ title: 'Review' }), snapshot],
          ),
        ],
        payloadKeyFor,
      ),
    ).toEqual([
      { entityId: 'task-1', discardedFields: ['title'], discardedTitle: 'Review' },
    ]);
  });

  it('flags a discarded title edit carried in a wrapped (production-shape) payload', () => {
    // Remote wins -> local op discarded; production wraps the change under
    // actionPayload with entityChanges: [].
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ title: 'My local title' })],
          [wrappedUpdate({ notes: 'x' })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([
      {
        entityId: 'task-1',
        discardedFields: ['title'],
        discardedTitle: 'My local title',
      },
    ]);
  });

  it('classifies a discarded scheduling edit as routine (no content conflict)', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ dueDay: '2026-07-02' })],
          [wrappedUpdate({ dueDay: null })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([]);
  });

  it('inspects the remote (losing) side when local wins', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'local',
          [wrappedUpdate({ dueDay: null })],
          [wrappedUpdate({ notes: 'lost note' })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([{ entityId: 'task-1', discardedFields: ['notes'] }]);
  });

  it('treats subtask-structure changes as content', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ subTaskIds: ['a', 'b'] })],
          [wrappedUpdate({ isDone: true })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result.map((c) => c.discardedFields)).toEqual([['subTaskIds']]);
  });

  it('does not flag attachment edits (dedicated action shape, no task.changes)', () => {
    // Attachments are edited via [TaskAttachment] actions whose payload is
    // { taskId, taskAttachment } — there is no task.changes, so extractUpdateChanges
    // finds nothing. Guards against re-adding 'attachments' to the content list.
    const attachmentOp = op({
      opType: OpType.Update,
      payload: {
        actionPayload: {
          taskId: 'task-1',
          taskAttachment: { id: 'att-1', type: 'LINK' },
        },
        entityChanges: [],
      },
    });
    const result = findLwwContentConflicts(
      [resolution('remote', [attachmentOp], [wrappedUpdate({ dueDay: null })])],
      payloadKeyFor,
    );

    expect(result).toEqual([]);
  });

  it('does not flag discarded CREATE / DELETE / MOVE ops (only field-level UPDATE loss)', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [
            op({
              opType: OpType.Delete,
              payload: { actionPayload: { task: { id: 'task-1' } }, entityChanges: [] },
            }),
          ],
          [wrappedUpdate({ dueDay: null })],
        ),
        resolution(
          'remote',
          [
            op({
              opType: OpType.Move,
              payload: {
                actionPayload: { task: { title: 'archived' } },
                entityChanges: [],
              },
            }),
          ],
          [wrappedUpdate({ dueDay: null })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([]);
  });

  it('skips non-TASK entity types', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [
            op({
              entityType: 'TAG',
              payload: {
                actionPayload: { tag: { id: 'tag-1', changes: { title: 'x' } } },
                entityChanges: [],
              },
            }),
          ],
          [op({ entityType: 'TAG' })],
          { entityType: 'TAG', entityId: 'tag-1' },
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([]);
  });

  it('de-duplicates by task when one task has multiple concurrent conflicts', () => {
    // Same task edited (title) locally, two concurrent remote ops -> two
    // resolutions for task-1. Should collapse to one named entry.
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ title: 'local' })],
          [wrappedUpdate({ notes: 'r1' })],
        ),
        resolution(
          'remote',
          [wrappedUpdate({ title: 'local' })],
          [wrappedUpdate({ dueDay: null })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([
      { entityId: 'task-1', discardedFields: ['title'], discardedTitle: 'local' },
    ]);
  });

  it('merges distinct discarded content fields for the same task', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ title: 'local' })],
          [wrappedUpdate({ notes: 'r1' })],
        ),
        resolution(
          'remote',
          [wrappedUpdate({ notes: 'local notes' })],
          [wrappedUpdate({ dueDay: null })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([
      {
        entityId: 'task-1',
        discardedFields: ['title', 'notes'],
        discardedTitle: 'local',
      },
    ]);
  });

  it('omits discardedTitle when the discarded edit did not touch the title', () => {
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ notes: 'lost note' })],
          [wrappedUpdate({ dueDay: null })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([{ entityId: 'task-1', discardedFields: ['notes'] }]);
    expect('discardedTitle' in result[0]).toBe(false);
  });

  it('ignores empty/whitespace discarded titles, keeping the real one', () => {
    // A concurrent discarded title-clear must not blank out a genuine discarded
    // rename in the same batch.
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ title: '   ' })],
          [wrappedUpdate({ dueDay: null })],
        ),
        resolution(
          'remote',
          [wrappedUpdate({ title: 'real discarded title' })],
          [wrappedUpdate({ notes: 'x' })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([
      {
        entityId: 'task-1',
        discardedFields: ['title'],
        discardedTitle: 'real discarded title',
      },
    ]);
  });

  it('surfaces the LAST discarded title (final rename), not the first', () => {
    // User renamed the task twice offline (A -> B), both discarded on a remote
    // win. The final value B is what they will look for.
    const result = findLwwContentConflicts(
      [
        resolution(
          'remote',
          [wrappedUpdate({ title: 'rename A' })],
          [wrappedUpdate({ dueDay: null })],
        ),
        resolution(
          'remote',
          [wrappedUpdate({ title: 'rename B' })],
          [wrappedUpdate({ notes: 'x' })],
        ),
      ],
      payloadKeyFor,
    );

    expect(result).toEqual([
      { entityId: 'task-1', discardedFields: ['title'], discardedTitle: 'rename B' },
    ]);
  });
});

describe('findPatchContentConflicts', () => {
  const patch = (
    winner: 'local' | 'remote',
    localOps: Operation[],
    remoteOps: Operation[],
  ): LwwResolvedConflict<Operation, EntityConflict> => ({
    winner,
    conflict: {
      entityType: 'TASK',
      entityId: 'task-1',
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    },
  });

  it('reports a content field only where the winner wrote it too', () => {
    const result = findPatchContentConflicts(
      [
        patch(
          'remote',
          [wrappedUpdate({ title: 'Mine', notes: 'my notes' })],
          [wrappedUpdate({ title: 'Theirs' })],
        ),
      ],
      payloadKeyFor,
    );
    expect(result).toEqual([
      { entityId: 'task-1', discardedFields: ['title'], discardedTitle: 'Mine' },
    ]);
  });

  it('ignores identical writes to the same field', () => {
    expect(
      findPatchContentConflicts(
        [
          patch(
            'remote',
            [wrappedUpdate({ title: 'Review', notes: 'Only changed locally' })],
            [wrappedUpdate({ title: 'Review' })],
          ),
        ],
        payloadKeyFor,
      ),
    ).toEqual([]);
  });

  it('reports nothing when the patch kept every content edit', () => {
    expect(
      findPatchContentConflicts(
        [
          patch(
            'local',
            [wrappedUpdate({ title: 'Mine' })],
            [wrappedUpdate({ notes: 'their notes' })],
          ),
        ],
        payloadKeyFor,
      ),
    ).toEqual([]);
  });
});
