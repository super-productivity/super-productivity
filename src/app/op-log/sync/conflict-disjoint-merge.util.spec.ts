import {
  hasOpaqueChanges,
  isAdditiveTimeOp,
  isCommutingTimeDeltaCrossing,
  isDisjointMergeEligible,
  isTaskSnapshotUnchangedByContent,
  mergeChangedFields,
  touchesCrossEntityTaskFields,
  writesNoTaskTime,
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
    });

    it('commutes a delta with mixed retained timeless patches and deltas in both directions', () => {
      const timeless = row({ id: 'task-1', title: 'B' });
      const rename = op({ payload: { task: { id: 'task-1', changes: { notes: 'A' } } } });
      const mixed = [timeless, rename, deferredSyncTimeSpentOp()];
      expect(commutes([syncTimeSpentOp()], mixed)).toBeTrue();
      expect(commutes(mixed, [syncTimeSpentOp()])).toBeTrue();
    });

    it('does not commute non-time writes on both sides just because one also tracks time', () => {
      const local = [syncTimeSpentOp(), row({ id: 'task-1', title: 'A' })];
      const remote = [row({ id: 'task-1', title: 'B' })];
      expect(commutes(local, remote)).toBeFalse();
      expect(commutes(remote, local)).toBeFalse();
      const rename = op({ payload: { task: { id: 'task-1', changes: { title: 'B' } } } });
      expect(commutes(local, [rename])).toBeFalse();
      expect(commutes([rename], local)).toBeFalse();
    });

    it('reads only keys of a timeless patch when it commutes with a remote delta', () => {
      const fields = {
        id: 'task-1',
        get title(): string {
          throw new Error('row value read');
        },
      };
      expect(
        commutes([row(fields), deferredSyncTimeSpentOp()], [syncTimeSpentOp()]),
      ).toBeTrue();
    });

    for (const unsafe of [
      { actionPayload: { timeSpent: 0 } },
      { actionPayload: { title: 'B' }, clearedFields: ['timeSpentOnDay'] },
      { actionPayload: { title: 'B' }, lwwUpdateMode: 'replace' },
    ]) {
      it(`refuses mixed source history with ${JSON.stringify(unsafe)} in both directions`, () => {
        const mixed = [row({}, unsafe), deferredSyncTimeSpentOp()];
        expect(commutes(mixed, [syncTimeSpentOp()])).toBeFalse();
        expect(commutes([syncTimeSpentOp()], mixed)).toBeFalse();
      });
    }

    // `setOne` rewrites every field, so a replace row writes time whatever
    // keys it carries.
    it('is false for any replace row', () => {
      expect(
        commutes(
          [syncTimeSpentOp()],
          [row({ id: 'task-1', title: 'T' }, { lwwUpdateMode: 'replace' })],
        ),
      ).toBe(false);
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

  describe('isCommutingTimeDeltaCrossing (timeless ops, #10378)', () => {
    /** Production-shaped auto-plan op that tracking an unscheduled task emits. */
    const planOp = (over: Partial<Operation> = {}): Operation =>
      op({
        actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
        entityId: undefined,
        entityIds: ['task-1'],
        payload: {
          actionPayload: { taskIds: ['task-1'], today: DAY, startOfNextDayDiffMs: 0 },
          entityChanges: [],
        },
        ...over,
      });
    const commutes = (localOps: Operation[], remoteOps: Operation[]): boolean =>
      isCommutingTimeDeltaCrossing({
        localOps,
        remoteOps,
        payloadKey: 'task',
        entityId: 'task-1',
      });

    it('is true for time deltas beside a tick of the other device, in both directions', () => {
      const tick = [planOp({ id: 'plan' }), syncTimeSpentOp({ id: 'delta' })];
      expect(commutes(tick, [syncTimeSpentOp({ id: 'remote' })])).toBe(true);
      expect(commutes([syncTimeSpentOp({ id: 'local' })], tick)).toBe(true);
      expect(commutes([deferredSyncTimeSpentOp()], [planOp()])).toBe(true);
    });

    it('is true beside a readable edit that writes no time field', () => {
      const rename = op({ payload: { task: { id: 'task-1', changes: { title: 'A' } } } });
      expect(commutes([syncTimeSpentOp()], [planOp({ id: 'plan' }), rename])).toBe(true);
    });

    // Both sides hold a non-delta op, so the plans still meet in a conflict.
    it('is false when neither side is only time deltas', () => {
      const tick = [planOp({ id: 'plan' }), syncTimeSpentOp({ id: 'delta' })];
      expect(commutes(tick, [planOp({ id: 'remote-plan' })])).toBe(false);
    });

    it('is false beside an op that writes or may write time', () => {
      const timeEdit = op({
        payload: { task: { id: 'task-1', changes: { timeSpentOnDay: { [DAY]: 1 } } } },
      });
      const rounding = op({
        actionType: '[Task] RoundTimeSpentForDay' as ActionType,
        entityId: undefined,
        entityIds: ['task-1'],
        payload: { actionPayload: { day: DAY, taskIds: ['task-1'] }, entityChanges: [] },
      });
      expect(commutes([syncTimeSpentOp()], [planOp({ id: 'plan' }), timeEdit])).toBe(
        false,
      );
      expect(commutes([syncTimeSpentOp()], [rounding])).toBe(false);
      expect(commutes([syncTimeSpentOp()], [convertToSubTaskOp()])).toBe(false);
      expect(commutes([syncTimeSpentOp()], [removeTimeSpentOp()])).toBe(false);
      expect(commutes([syncTimeSpentOp()], [op({ opType: OpType.Delete })])).toBe(false);
    });

    it('is false for a plan of several tasks or of another task', () => {
      const bulk = planOp({
        entityIds: ['task-1', 'task-2'],
        payload: {
          actionPayload: { taskIds: ['task-1', 'task-2'], today: DAY },
          entityChanges: [],
        },
      });
      expect(commutes([syncTimeSpentOp()], [bulk])).toBe(false);
      expect(writesNoTaskTime(planOp({ entityIds: ['task-2'] }), 'task', 'task-1')).toBe(
        false,
      );
    });

    // A replace row rewrites every field; rows keep their own rule above.
    it('never reads an LWW row as timeless', () => {
      const replaceRow = op({
        actionType: '[TASK] LWW Update' as ActionType,
        payload: {
          actionPayload: { id: 'task-1', title: 'T' },
          entityChanges: [],
          lwwUpdateMode: 'replace',
        },
      });
      expect(writesNoTaskTime(replaceRow, 'task', 'task-1')).toBe(false);
      expect(commutes([syncTimeSpentOp()], [planOp({ id: 'plan' }), replaceRow])).toBe(
        false,
      );
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

describe('isTaskSnapshotUnchangedByContent', () => {
  const snapshot = op({
    payload: {
      lwwUpdateMode: 'replace',
      entityChanges: [],
      actionPayload: {
        id: 'task-1',
        title: 'retained',
        notes: 'kept',
        created: 1000,
        priority: 1,
        dueDay: DAY,
        timeSpent: 3000,
      },
    },
  });
  const update = (changes: Record<string, unknown>, entityId = 'task-1'): Operation =>
    op({
      entityId,
      actionType: ActionType.TASK_SHARED_UPDATE,
      payload: { task: { id: entityId, changes } },
    });

  it('proves equal plain content is a no-op without changing the replacement', () => {
    const before = JSON.stringify(snapshot);
    expect(
      isTaskSnapshotUnchangedByContent(
        snapshot,
        update({ title: 'retained', notes: 'kept', priority: 1 }),
      ),
    ).toBeTrue();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('refuses actual content differences, clears, scheduling and completion', () => {
    for (const changes of [
      { title: 'different' },
      { notes: undefined },
      { dueDay: DAY },
      { isDone: false },
      { timeSpent: 3000 },
    ]) {
      expect(isTaskSnapshotUnchangedByContent(snapshot, update(changes))).toBeFalse();
    }
  });

  it('refuses creation identity changes and metadata beyond display arrival time', () => {
    // created identifies a repeat occurrence; an unchanged replacement must
    // never be moved after an edit that changes that persisted value.
    for (const changes of [{ created: 2000 }, { lastModified: 2000 }]) {
      expect(isTaskSnapshotUnchangedByContent(snapshot, update(changes))).toBeFalse();
    }
    expect(
      isTaskSnapshotUnchangedByContent(snapshot, update({ modified: 2000 })),
    ).toBeTrue();
  });

  it('allows content on another task, but never its scheduling mutations', () => {
    expect(
      isTaskSnapshotUnchangedByContent(snapshot, update({ title: 'other' }, 'task-2')),
    ).toBeTrue();
    expect(
      isTaskSnapshotUnchangedByContent(snapshot, update({ dueDay: DAY }, 'task-2')),
    ).toBeFalse();
  });

  it('never reads incoming resolution values, even equal ones', () => {
    for (const mode of ['patch', 'replace']) {
      expect(
        isTaskSnapshotUnchangedByContent(
          snapshot,
          op({
            payload: {
              lwwUpdateMode: mode,
              entityChanges: [],
              actionPayload: { title: 'retained' },
            },
          }),
        ),
      ).toBeFalse();
    }
  });
});
