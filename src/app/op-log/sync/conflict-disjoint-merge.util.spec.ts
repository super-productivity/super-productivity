import {
  buildMergedFieldDiffs,
  hasOpaqueChanges,
  isDisjointMergeEligible,
  mergeChangedFields,
  MergeSideMeta,
  noiseTiebreakSide,
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

  describe('noiseTiebreakSide', () => {
    it('picks the greater-timestamp side (local newer)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 2000, clientId: 'A' },
          { timestamp: 1000, clientId: 'Z' },
        ),
      ).toBe('local');
    });

    it('picks the greater-timestamp side (remote newer)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'Z' },
          { timestamp: 2000, clientId: 'A' },
        ),
      ).toBe('remote');
    });

    // The equal-timestamp branch: falls back to the greater clientId. This is the
    // cross-client determinism guarantee — without it two clients could pick
    // different noise values and diverge.
    it('breaks an equal-timestamp tie by the greater clientId (local wins)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'B' },
          { timestamp: 1000, clientId: 'A' },
        ),
      ).toBe('local');
    });

    it('breaks an equal-timestamp tie by the greater clientId (remote wins)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'A' },
          { timestamp: 1000, clientId: 'B' },
        ),
      ).toBe('remote');
    });

    it('is fully symmetric on equal timestamps: both clients pick the SAME physical side', () => {
      // X and Y differ only by clientId. Whichever side X is passed as, the result
      // must always point at the SAME side (the greater clientId, Y here).
      const x: MergeSideMeta = { timestamp: 1000, clientId: 'A' };
      const y: MergeSideMeta = { timestamp: 1000, clientId: 'B' };
      // Client 1 sees X local / Y remote → picks remote (= Y).
      expect(noiseTiebreakSide(x, y)).toBe('remote');
      // Client 2 sees Y local / X remote → picks local (= Y).
      expect(noiseTiebreakSide(y, x)).toBe('local');
    });

    it('defaults to local when both identity components are equal', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'A' },
          { timestamp: 1000, clientId: 'A' },
        ),
      ).toBe('local');
    });
  });

  describe('buildMergedFieldDiffs', () => {
    const localMeta: MergeSideMeta = { timestamp: 1000, clientId: 'A' };
    const remoteMeta: MergeSideMeta = { timestamp: 2000, clientId: 'B' };

    it('captures each side verbatim and attributes disjoint real fields to their side', () => {
      const diffs = buildMergedFieldDiffs(
        { title: 'Local' },
        { notes: 'Remote' },
        localMeta,
        remoteMeta,
      );

      expect(diffs).toContain({
        field: 'title',
        localVal: 'Local',
        remoteVal: undefined,
        localChanged: true,
        remoteChanged: false,
        pickedSide: 'local',
      });
      expect(diffs).toContain({
        field: 'notes',
        localVal: undefined,
        remoteVal: 'Remote',
        localChanged: false,
        remoteChanged: true,
        pickedSide: 'remote',
      });
      expect(diffs.length).toBe(2);
    });

    it('resolves a field changed on BOTH sides (only noise can be) via the timestamp tiebreak', () => {
      const diffs = buildMergedFieldDiffs(
        { modified: 1111 },
        { modified: 2222 },
        localMeta, // ts 1000
        remoteMeta, // ts 2000 → newer wins
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0]).toEqual({
        field: 'modified',
        localVal: 1111,
        remoteVal: 2222,
        localChanged: true,
        remoteChanged: true,
        pickedSide: 'remote',
      });
    });

    it('resolves a both-sides field by clientId when timestamps are equal', () => {
      const diffs = buildMergedFieldDiffs(
        { modified: 1111 },
        { modified: 2222 },
        { timestamp: 1000, clientId: 'B' }, // greater clientId → local wins
        { timestamp: 1000, clientId: 'A' },
      );

      expect(diffs[0].pickedSide).toBe('local');
    });

    it('returns an empty array when neither side changed anything', () => {
      expect(buildMergedFieldDiffs({}, {}, localMeta, remoteMeta)).toEqual([]);
    });
  });
});
