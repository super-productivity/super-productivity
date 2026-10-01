import {
  hasOpaqueChanges,
  isAdditiveTimeOp,
  isCommutingTimeDeltaCrossing,
  isDisjointMergeEligible,
  mergeChangedFields,
  synthesizeMergedChanges,
  touchesCrossEntityTaskFields,
} from './conflict-disjoint-merge.util';
import { ActionType, EntityType, OpType, Operation } from '../core/operation.types';

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  actionType: '[Task] Update' as ActionType,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  payload: { task: { id: 'task-1' } },
  clientId: 'A',
  vectorClock: { A: 1 },
  timestamp: 1000,
  schemaVersion: 1,
  ...over,
});

/** Production-shaped convertToSubTask op: non-adapter payload, empty entityChanges. */
const convertToSubTaskOp = (over: Partial<Operation> = {}): Operation =>
  op({
    actionType: '[Task] Convert to sub task' as ActionType,
    payload: {
      actionPayload: {
        taskId: 'task-1',
        targetParentId: 'parent-1',
        afterTaskId: null,
      },
      entityChanges: [],
    },
    ...over,
  });

const DAY = '2026-09-12';

/**
 * Production-shaped syncTimeSpent op as a DIRECT write captures it: the
 * entityChanges carry the delta's arguments, none of which is a task field.
 */
const syncTimeSpentOp = (over: Partial<Operation> = {}): Operation =>
  op({
    actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
    payload: {
      actionPayload: { taskId: 'task-1', date: DAY, duration: 60000 },
      entityChanges: [
        {
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
          changes: { taskId: 'task-1', date: DAY, duration: 60000 },
        },
      ],
    },
    ...over,
  });

/** The same op as a DEFERRED write captures it: `entityChanges: []`. */
const deferredSyncTimeSpentOp = (over: Partial<Operation> = {}): Operation =>
  syncTimeSpentOp({
    payload: {
      actionPayload: { taskId: 'task-1', date: DAY, duration: 60000 },
      entityChanges: [],
    },
    ...over,
  });

/** Production-shaped removeTimeSpent op: no entityChanges are captured for it. */
const removeTimeSpentOp = (over: Partial<Operation> = {}): Operation =>
  op({
    actionType: ActionType.TASK_REMOVE_TIME_SPENT,
    payload: {
      actionPayload: { id: 'task-1', date: DAY, duration: 60000 },
      entityChanges: [],
    },
    ...over,
  });

describe('conflict-disjoint-merge.util', () => {
  describe('mergeChangedFields (non-adapter payloads)', () => {
    it('falls back to capture-time entityChanges when the action payload is not adapter-shaped', () => {
      const timeSyncOp = op({
        actionType: '[TimeTracking] Sync time spent' as ActionType,
        payload: {
          actionPayload: { taskId: 'task-1', date: '2026-07-10', duration: 100 },
          entityChanges: [
            {
              entityType: 'TASK' as EntityType,
              entityId: 'task-1',
              opType: OpType.Update,
              changes: { taskId: 'task-1', date: '2026-07-10', duration: 100 },
            },
          ],
        },
      });
      expect(mergeChangedFields([timeSyncOp], 'task', 'task-1')).toEqual({
        taskId: 'task-1',
        date: '2026-07-10',
        duration: 100,
      });
    });

    it('does not borrow a direct-format bulk payload from its primary entity', () => {
      const bulkOp = op({
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        payload: { task: { id: 'task-1', changes: { notes: 'Task 1 notes' } } },
      });

      expect(mergeChangedFields([bulkOp], 'task', 'task-2')).toEqual({});
      expect(hasOpaqueChanges([bulkOp], 'task', 'task-2')).toBe(true);
    });

    it('requires an adapter payload to positively identify its target entity', () => {
      const missingIdOp = op({
        payload: { task: { changes: { notes: 'Unscoped notes' } } },
      });

      expect(mergeChangedFields([missingIdOp], 'task', 'task-1')).toEqual({});
      expect(hasOpaqueChanges([missingIdOp], 'task', 'task-1')).toBe(true);
    });

    it('treats non-update target entityChanges as opaque', () => {
      const bulkOp = op({
        payload: {
          actionPayload: { taskId: 'task-1' },
          entityChanges: [
            {
              entityType: 'TASK' as EntityType,
              entityId: 'task-1',
              opType: OpType.Delete,
              changes: { title: 'Must not become an update' },
            },
          ],
        },
      });

      expect(mergeChangedFields([bulkOp], 'task', 'task-1')).toEqual({});
      expect(hasOpaqueChanges([bulkOp], 'task', 'task-1')).toBe(true);
    });

    it('treats array and identity-bearing target entityChanges as opaque', () => {
      const invalidChanges = [
        ['not', 'a', 'field-map'],
        { id: 'task-2', title: 'Must not retarget the update' },
      ];

      for (const changes of invalidChanges) {
        const bulkOp = op({
          payload: {
            actionPayload: { taskId: 'task-1' },
            entityChanges: [
              {
                entityType: 'TASK' as EntityType,
                entityId: 'task-1',
                opType: OpType.Update,
                changes,
              },
            ],
          },
        });

        expect(mergeChangedFields([bulkOp], 'task', 'task-1')).toEqual({});
        expect(hasOpaqueChanges([bulkOp], 'task', 'task-1')).toBe(true);
      }
    });

    it('treats a bulk op without a target-specific delta as opaque', () => {
      const bulkOp = op({
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        payload: {
          actionPayload: { taskId: 'task-1' },
          entityChanges: [
            {
              entityType: 'TASK' as EntityType,
              entityId: 'task-1',
              opType: OpType.Update,
              changes: { title: 'Task 1' },
            },
          ],
        },
      });

      expect(hasOpaqueChanges([bulkOp], 'task', 'task-2')).toBe(true);
    });
  });

  describe('hasOpaqueChanges', () => {
    it('is true for a non-adapter payload with no entityChanges (convertToSubTask)', () => {
      expect(hasOpaqueChanges([convertToSubTaskOp()], 'task', 'task-1')).toBe(true);
    });

    it('is false for adapter-shaped updates and for DELETE ops', () => {
      expect(
        hasOpaqueChanges(
          [op({ payload: { task: { id: 'task-1', title: 'T' } } })],
          'task',
          'task-1',
        ),
      ).toBe(false);
      expect(
        hasOpaqueChanges(
          [op({ opType: OpType.Delete, payload: { task: { id: 'task-1' } } })],
          'task',
          'task-1',
        ),
      ).toBe(false);
    });
  });

  describe('isDisjointMergeEligible (opaque ops)', () => {
    it('refuses the merge when one side also has an opaque op, even if extracted fields are disjoint', () => {
      // local: adapter title edit + opaque structural move; remote: notes edit.
      // Extracted fields (title vs notes) are disjoint, but merging would
      // silently drop the structural move and the two clients would diverge.
      const eligible = isDisjointMergeEligible({
        localOps: [
          op({ payload: { task: { id: 'task-1', title: 'Local' } } }),
          convertToSubTaskOp(),
        ],
        remoteOps: [
          op({ payload: { task: { id: 'task-1', notes: 'Remote' } }, clientId: 'B' }),
        ],
        payloadKey: 'task',
        entityId: 'task-1',
      });
      expect(eligible).toBe(false);
    });

    it('refuses inconsistent scalar-plus-array entity metadata', () => {
      const mixedMetadataOp = op({
        entityId: 'task-1',
        entityIds: ['task-2'],
        clientId: 'B',
        payload: {
          actionPayload: {
            task: { id: 'task-1', changes: { notes: 'Task 1 notes' } },
          },
          entityChanges: [
            {
              entityType: 'TASK' as EntityType,
              entityId: 'task-2',
              opType: OpType.Update,
              changes: { notes: 'Task 2 notes' },
            },
          ],
        },
      });

      expect(
        isDisjointMergeEligible({
          localOps: [
            op({
              entityId: 'task-2',
              payload: { task: { id: 'task-2', changes: { title: 'Local' } } },
            }),
          ],
          remoteOps: [mixedMetadataOp],
          payloadKey: 'task',
          entityId: 'task-2',
        }),
      ).toBe(false);
    });
  });

  describe('isDisjointMergeEligible (additive time ops)', () => {
    const titleEdit = op({
      payload: { task: { id: 'task-1', title: 'Remote' } },
      clientId: 'B',
    });

    it('treats a syncTimeSpent delta as disjoint from an edit of other fields', () => {
      // The delta is counted as touching timeSpent/timeSpentOnDay (from its
      // action type), not its { taskId, date, duration } arguments; a title
      // edit commutes with it.
      expect(
        isDisjointMergeEligible({
          localOps: [syncTimeSpentOp()],
          remoteOps: [titleEdit],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(true);
    });

    it('classifies the empty deferred-write form of the delta the same way', () => {
      // Deferred writes carry entityChanges: []. Read as-is that is opaque; the
      // action-type mapping makes both wire forms of the same intent commute
      // with a non-time edit alike.
      expect(
        isDisjointMergeEligible({
          localOps: [deferredSyncTimeSpentOp()],
          remoteOps: [titleEdit],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(true);
    });

    it('treats a syncTimeSpent delta as overlapping an absolute timeSpentOnDay write', () => {
      expect(
        isDisjointMergeEligible({
          localOps: [
            op({ payload: { task: { id: 'task-1', timeSpentOnDay: { [DAY]: 1 } } } }),
          ],
          remoteOps: [syncTimeSpentOp({ clientId: 'B' })],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
    });

    it('treats a syncTimeSpent delta as overlapping an absolute timeSpent write', () => {
      expect(
        isDisjointMergeEligible({
          localOps: [deferredSyncTimeSpentOp()],
          remoteOps: [
            op({ payload: { task: { id: 'task-1', timeSpent: 5 } }, clientId: 'B' }),
          ],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
    });

    it('treats two syncTimeSpent deltas as commuting even when one side also renamed (#10214)', () => {
      expect(
        isDisjointMergeEligible({
          localOps: [syncTimeSpentOp(), titleEdit],
          remoteOps: [deferredSyncTimeSpentOp({ clientId: 'B' })],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(true);
    });

    it('still treats a delta as overlapping an absolute write on a side that also has a delta (#10214)', () => {
      expect(
        isDisjointMergeEligible({
          localOps: [
            syncTimeSpentOp(),
            op({ payload: { task: { id: 'task-1', timeSpentOnDay: { [DAY]: 1 } } } }),
          ],
          remoteOps: [syncTimeSpentOp({ clientId: 'B' })],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
    });

    it('keeps a removeTimeSpent delta ineligible (opaque, whole-entity LWW)', () => {
      expect(
        isDisjointMergeEligible({
          localOps: [removeTimeSpentOp()],
          remoteOps: [titleEdit],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
    });

    it('does not surface the mapped time fields through mergeChangedFields', () => {
      // The mapping is for the disjointness test only. A merge or a
      // reconciliation op built from mergeChangedFields must never see the
      // delta's values under task-field names.
      expect(mergeChangedFields([syncTimeSpentOp()], 'task', 'task-1')).toEqual({
        taskId: 'task-1',
        date: DAY,
        duration: 60000,
      });
      expect(mergeChangedFields([deferredSyncTimeSpentOp()], 'task', 'task-1')).toEqual(
        {},
      );
    });
  });

  describe('isAdditiveTimeOp', () => {
    it('is true for both persistent time deltas and false for a plain update', () => {
      expect(isAdditiveTimeOp(syncTimeSpentOp())).toBe(true);
      expect(isAdditiveTimeOp(deferredSyncTimeSpentOp())).toBe(true);
      expect(isAdditiveTimeOp(removeTimeSpentOp())).toBe(true);
      expect(isAdditiveTimeOp(op())).toBe(false);
    });
  });

  // #10421, #10408: a resolution row is opaque, but a time-only side commutes
  // with one that writes no time. Only the row's keys are read.
  describe('isCommutingTimeDeltaCrossing (resolution rows)', () => {
    const row = (
      actionPayload: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ): Operation =>
      op({
        id: 'row',
        actionType: '[TASK] LWW Update' as ActionType,
        clientId: 'B',
        payload: { actionPayload, entityChanges: [], lwwUpdateMode: 'patch', ...extra },
      });
    const commutes = (localOps: Operation[], remoteOps: Operation[]): boolean =>
      isCommutingTimeDeltaCrossing({
        localOps,
        remoteOps,
        payloadKey: 'task',
        entityId: 'task-1',
      });

    it('is true for time deltas beside a row that writes no time', () => {
      const notesRow = row({ id: 'task-1', notes: 'B' });
      expect(commutes([syncTimeSpentOp()], [notesRow])).toBe(true);
      expect(commutes([syncTimeSpentOp(), deferredSyncTimeSpentOp()], [notesRow])).toBe(
        true,
      );
      expect(
        commutes(
          [syncTimeSpentOp()],
          [row({ id: 'task-1', title: 'T' }, { lwwUpdateMode: 'replace' })],
        ),
      ).toBe(true);
    });

    it('is false for a row that writes or clears a time field', () => {
      expect(commutes([syncTimeSpentOp()], [row({ id: 'task-1', timeSpent: 0 })])).toBe(
        false,
      );
      expect(
        commutes([syncTimeSpentOp()], [row({ id: 'task-1', timeSpentOnDay: {} })]),
      ).toBe(false);
      expect(
        commutes(
          [syncTimeSpentOp()],
          [row({ id: 'task-1', notes: 'B' }, { clearedFields: ['timeSpentOnDay'] })],
        ),
      ).toBe(false);
    });

    it('is false unless the local side is only time deltas', () => {
      const notesRow = row({ id: 'task-1', notes: 'B' });
      const rename = op({ payload: { task: { id: 'task-1', changes: { title: 'A' } } } });
      expect(commutes([syncTimeSpentOp(), rename], [notesRow])).toBe(false);
      expect(commutes([removeTimeSpentOp()], [notesRow])).toBe(false);
    });

    it('is false for a row of several entities or of another task', () => {
      expect(
        commutes(
          [syncTimeSpentOp()],
          [{ ...row({ id: 'task-1', notes: 'B' }), entityIds: ['task-1', 'task-2'] }],
        ),
      ).toBe(false);
      expect(
        commutes(
          [syncTimeSpentOp()],
          [{ ...row({ id: 'task-2', notes: 'B' }), entityId: 'task-2' }],
        ),
      ).toBe(false);
    });
  });

  describe('touchesCrossEntityTaskFields', () => {
    const edit = (task: Record<string, unknown>): Operation =>
      op({ payload: { task: { id: 'task-1', ...task } } });
    const touches = (ops: Operation[]): boolean =>
      touchesCrossEntityTaskFields(ops, 'task', 'task-1');

    it('is false for time deltas and edits of fields only task ops write', () => {
      expect(touches([syncTimeSpentOp(), deferredSyncTimeSpentOp()])).toBe(false);
      expect(touches([syncTimeSpentOp(), edit({ title: 'T', notes: 'N' })])).toBe(false);
    });

    it('is true for a field that ops of other entity types also write', () => {
      for (const field of ['tagIds', 'projectId', 'parentId', 'dueDay', 'dueWithTime']) {
        expect(touches([syncTimeSpentOp(), edit({ [field]: 'x' })]))
          .withContext(field)
          .toBe(true);
      }
    });

    it('is true when an op cannot be read as task fields', () => {
      expect(touches([convertToSubTaskOp()])).toBe(true);
      const plannerMove = op({
        entityType: 'PLANNER' as EntityType,
        payload: { actionPayload: {}, entityChanges: [] },
      });
      expect(touches([syncTimeSpentOp(), plannerMove])).toBe(true);
    });
  });

  describe('synthesizeMergedChanges', () => {
    it("keeps each side's own fields and the winner's value of a shared one", () => {
      expect(
        synthesizeMergedChanges(
          { title: 'L', isDone: true, modified: 1 },
          { title: 'R', notes: 'n', modified: 2 },
          'remote',
        ),
      ).toEqual({ title: 'R', isDone: true, notes: 'n', modified: 2 });
      expect(
        synthesizeMergedChanges(
          { title: 'L', isDone: true, modified: 1 },
          { title: 'R', notes: 'n', modified: 2 },
          'local',
        ),
      ).toEqual({ title: 'L', isDone: true, notes: 'n', modified: 1 });
    });

    it('builds the same delta on both clients when each names the same side', () => {
      const x = { title: 'X', dueWithTime: undefined };
      const y = { title: 'Y', notes: 'y' };
      // Client 1 sees X local / Y remote; client 2 the mirror. The planner is
      // symmetric, so both name Y.
      expect(synthesizeMergedChanges(x, y, 'remote')).toEqual(
        synthesizeMergedChanges(y, x, 'local'),
      );
    });

    it("keeps a clear of the winner's shared field as an undefined key", () => {
      const merged = synthesizeMergedChanges(
        { dueWithTime: undefined },
        { dueWithTime: 5 },
        'local',
      );
      expect('dueWithTime' in merged).toBeTrue();
      expect(merged['dueWithTime']).toBeUndefined();
    });
  });

  // ── cleared fields (#9776): `changes: { field: undefined }` + out-of-band
  // `clearedFields`. The author's op keeps the undefined key (structured clone);
  // the same op after a JSON wire round-trip loses it. Both shapes must extract
  // the IDENTICAL field set, or the author merges while the receiver falls back
  // to whole-entity LWW — silent divergence on the same conflict. ──────────────
  describe('cleared fields', () => {
    /** Author-side shape: undefined key survives IndexedDB structured clone. */
    const authorClearOp = (): Operation =>
      op({
        payload: {
          actionPayload: {
            task: { id: 'task-1', changes: { _hideSubTasksMode: undefined } },
            clearedFields: ['_hideSubTasksMode'],
          },
          entityChanges: [],
        },
      });

    /** The identical op after a JSON wire round-trip (undefined key dropped). */
    const wireClearOp = (): Operation => JSON.parse(JSON.stringify(authorClearOp()));

    it('restores a wire-dropped clear into the extracted changes', () => {
      const changes = mergeChangedFields([wireClearOp()], 'task', 'task-1');
      expect(Object.keys(changes)).toEqual(['_hideSubTasksMode']);
      expect(changes['_hideSubTasksMode']).toBeUndefined();
      expect(hasOpaqueChanges([wireClearOp()], 'task', 'task-1')).toBe(false);
    });

    it('extracts the identical field set for author-side and wire-side shapes', () => {
      expect(mergeChangedFields([authorClearOp()], 'task', 'task-1')).toEqual(
        mergeChangedFields([wireClearOp()], 'task', 'task-1'),
      );
    });

    it('judges merge eligibility identically on both clients (clear vs disjoint edit)', () => {
      const otherSideOp = op({
        clientId: 'B',
        vectorClock: { B: 1 },
        payload: { task: { id: 'task-1', changes: { title: 'New title' } } },
      });
      const eligibleFor = (clearOp: Operation): boolean =>
        isDisjointMergeEligible({
          localOps: [clearOp],
          remoteOps: [otherSideOp],
          payloadKey: 'task',
          entityId: 'task-1',
        });
      expect(eligibleFor(authorClearOp())).toBe(true);
      expect(eligibleFor(wireClearOp())).toBe(true);
    });

    it('ignores junk clearedFields from the wire', () => {
      const junkOp = op({
        payload: {
          actionPayload: {
            task: { id: 'task-1', changes: {} },
            clearedFields: 'not-an-array',
          },
          entityChanges: [],
        },
      });
      expect(mergeChangedFields([junkOp], 'task', 'task-1')).toEqual({});
      expect(hasOpaqueChanges([junkOp], 'task', 'task-1')).toBe(true);
    });
  });
});
