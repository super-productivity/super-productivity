import {
  aggregateEntityConflict,
  buildSurvivingFieldPatches,
  isFieldPatchEligible,
  keptLocalTimeDeltas,
  localWinningFieldGroups,
  rebaseKeptTimeDeltas,
  supersededPatchFields,
  survivingLocalFields,
  timeDeltasSurvivingRemoteWins,
} from './conflict-field-patch.util';
import {
  ActionType,
  EntityConflict,
  EntityType,
  OpType,
  Operation,
} from '../core/operation.types';

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  actionType: '[Task Shared] updateTask' as ActionType,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  payload: { actionPayload: { task: { id: 'task-1', changes: {} } }, entityChanges: [] },
  clientId: 'A',
  vectorClock: { A: 1 },
  timestamp: 1000,
  schemaVersion: 1,
  ...over,
});

const edit = (
  changes: Record<string, unknown>,
  over: Partial<Operation> = {},
): Operation =>
  op({
    payload: {
      actionPayload: { task: { id: 'task-1', changes } },
      entityChanges: [],
    },
    ...over,
  });

const delta = (over: Partial<Operation> = {}): Operation =>
  op({
    id: 'delta',
    actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
    payload: {
      actionPayload: { taskId: 'task-1', date: '2026-01-01', duration: 1000 },
      entityChanges: [],
    },
    ...over,
  });

const sides = (
  localOps: Operation[],
  remoteOps: Operation[],
): {
  localOps: Operation[];
  remoteOps: Operation[];
  payloadKey: string;
  entityId: string;
} => ({
  localOps,
  remoteOps,
  payloadKey: 'task',
  entityId: 'task-1',
});

describe('conflict-field-patch.util', () => {
  describe('isFieldPatchEligible', () => {
    it('admits disjoint and overlapping readable edits', () => {
      expect(
        isFieldPatchEligible(sides([edit({ title: 'a' })], [edit({ notes: 'n' })])),
      ).toBeTrue();
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a', isDone: true })], [edit({ title: 'b' })]),
        ),
      ).toBeTrue();
    });

    it('refuses deletes, multi-entity and opaque ops', () => {
      const remote = [edit({ title: 'b' })];
      expect(
        isFieldPatchEligible(sides([op({ opType: OpType.Delete })], remote)),
      ).toBeFalse();
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a' }, { entityIds: ['task-1', 'task-2'] })], remote),
        ),
      ).toBeFalse();
      const opaque = op({
        payload: { actionPayload: { taskId: 'task-1', x: 1 }, entityChanges: [] },
      });
      expect(isFieldPatchEligible(sides([opaque], remote))).toBeFalse();
    });

    it("refuses an overlap with a flat-snapshot op such as moveToOtherProject's", () => {
      // Its payload is the full PRE-move task: read as fields it would write
      // the old projectId back.
      const move = (projectId: string): Operation =>
        op({
          actionType: '[Task Shared] moveToOtherProject' as ActionType,
          payload: {
            actionPayload: {
              task: { id: 'task-1', projectId, title: 't', subTasks: [] },
              targetProjectId: 'P-new',
            },
            entityChanges: [],
          },
        });
      expect(isFieldPatchEligible(sides([move('P1')], [move('P1')]))).toBeFalse();
      expect(
        supersededPatchFields([move('P1')], 'TASK' as EntityType, 'task', 'task-1'),
      ).toBeUndefined();
    });

    it('refuses a side that changed only noise fields', () => {
      expect(
        isFieldPatchEligible(
          sides([edit({ modified: 5 })], [edit({ title: 'b', modified: 6 })]),
        ),
      ).toBeFalse();
    });

    it('admits a local time delta beside readable edits, but not a remote one', () => {
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a' }), delta()], [edit({ title: 'b' })]),
        ),
      ).toBeTrue();
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a' })], [edit({ title: 'b' }), delta()]),
        ),
      ).toBeFalse();
    });

    it('refuses a delta beside an absolute time write, and removeTimeSpent', () => {
      const day = '2026-01-01';
      const absolute = edit({ timeSpentOnDay: { [day]: 5 }, timeSpent: 5 });
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a' }), delta()], [edit({ title: 'b' }), absolute]),
        ),
      ).toBeFalse();
      const remove = op({ actionType: ActionType.TASK_REMOVE_TIME_SPENT });
      expect(
        isFieldPatchEligible(
          sides([edit({ title: 'a' }), remove], [edit({ title: 'b' })]),
        ),
      ).toBeFalse();
    });

    it('refuses an overlapping patch that clears a reminder field', () => {
      const clear = edit({ title: 'a', reminderId: undefined });
      expect(isFieldPatchEligible(sides([clear], [edit({ title: 'b' })]))).toBeFalse();
      // The other side's value wins the shared field: nothing is cleared.
      expect(
        isFieldPatchEligible(
          sides(
            [edit({ title: 'a', dueWithTime: undefined })],
            [edit({ dueWithTime: 5 })],
          ),
        ),
      ).toBeTrue();
      // Today's disjoint merge already patched a clear: unchanged.
      expect(isFieldPatchEligible(sides([clear], [edit({ notes: 'n' })]))).toBeTrue();
    });
  });

  describe('localWinningFieldGroups', () => {
    const at = (
      changes: Record<string, unknown>,
      clientId: string,
      timestamp: number,
    ): Operation => edit(changes, { id: `${clientId}${timestamp}`, clientId, timestamp });

    it('re-sends only the local fields newer than every remote write, each at its own time', () => {
      // A: notes at 1, rename at 2. B: rename at 4 (#10422's shape).
      const local = [at({ notes: 'A' }, 'A', 1), at({ title: 'A' }, 'A', 2), delta()];
      expect(localWinningFieldGroups(sides(local, [at({ title: 'B' }, 'B', 4)]))).toEqual(
        [{ timestamp: 1, changes: { notes: 'A' } }],
      );
      // B resolving the same two sides re-sends only its rename.
      expect(localWinningFieldGroups(sides([at({ title: 'B' }, 'B', 4)], local))).toEqual(
        [{ timestamp: 4, changes: { title: 'B' } }],
      );
    });

    it('wins a field per field, not per side', () => {
      // C's notes (3) beat A's re-sent notes (1), though B's rename (4) is newer.
      const remote = [at({ title: 'B' }, 'B', 4), at({ notes: 'A' }, 'A', 1)];
      expect(
        localWinningFieldGroups(sides([at({ notes: 'C' }, 'C', 3)], remote)),
      ).toEqual([{ timestamp: 3, changes: { notes: 'C' } }]);
    });

    it('breaks an exact tie by clientId, the same way on both devices', () => {
      const x = [at({ title: 'x' }, 'X', 5)];
      const y = [at({ title: 'y' }, 'Y', 5)];
      expect(localWinningFieldGroups(sides(x, y))).toEqual([]);
      expect(localWinningFieldGroups(sides(y, x))).toEqual([
        { timestamp: 5, changes: { title: 'y' } },
      ]);
    });

    it("counts a patch row's keys and a replace row's every field as written at its time", () => {
      const row = (mode: 'patch' | 'replace'): Operation =>
        op({
          id: `row-${mode}`,
          actionType: '[TASK] LWW Update' as ActionType,
          clientId: 'B',
          timestamp: 4,
          payload: {
            actionPayload: { id: 'task-1', title: 'B' },
            entityChanges: [],
            lwwUpdateMode: mode,
          },
        });
      const local = [at({ notes: 'C', title: 'C' }, 'C', 3)];
      expect(localWinningFieldGroups(sides(local, [row('patch')]))).toEqual([
        { timestamp: 3, changes: { notes: 'C' } },
      ]);
      expect(localWinningFieldGroups(sides(local, [row('replace')]))).toEqual([]);
      expect(isFieldPatchEligible(sides(local, [row('patch')]))).toBeTrue();
    });

    it("counts a patch row's cleared fields as written", () => {
      const clearingRow = op({
        id: 'row-clear',
        actionType: '[TASK] LWW Update' as ActionType,
        clientId: 'B',
        timestamp: 4,
        payload: {
          actionPayload: { id: 'task-1', title: 'B' },
          entityChanges: [],
          lwwUpdateMode: 'patch',
          clearedFields: ['notes'],
        },
      });
      expect(
        localWinningFieldGroups(sides([at({ notes: 'C' }, 'C', 3)], [clearingRow])),
      ).toEqual([]);
    });

    it('refuses a local time delta beside a row that may write time', () => {
      const rowOf = (
        mode: 'patch' | 'replace',
        fields: Record<string, unknown>,
      ): Operation =>
        op({
          id: `row-${mode}`,
          actionType: '[TASK] LWW Update' as ActionType,
          clientId: 'B',
          timestamp: 4,
          payload: {
            actionPayload: { id: 'task-1', ...fields },
            entityChanges: [],
            lwwUpdateMode: mode,
          },
        });
      const local = [at({ notes: 'C' }, 'C', 3), delta({ clientId: 'C' })];
      const titleRow = rowOf('patch', { title: 'B' });
      expect(isFieldPatchEligible(sides(local, [titleRow]))).toBeTrue();
      expect(
        isFieldPatchEligible(sides(local, [rowOf('patch', { timeSpent: 9 })])),
      ).toBeFalse();
      expect(
        isFieldPatchEligible(sides(local, [rowOf('replace', { title: 'B' })])),
      ).toBeFalse();
    });

    it('keeps whole-entity LWW for a pending local row, so rows never merge', () => {
      // Two file-based resolvers' re-sends meet as a local row vs a remote row.
      const rowOf = (clientId: string, fields: Record<string, unknown>): Operation =>
        op({
          id: `row-${clientId}`,
          actionType: '[TASK] LWW Update' as ActionType,
          clientId,
          timestamp: 4,
          payload: {
            actionPayload: { id: 'task-1', ...fields },
            entityChanges: [],
            lwwUpdateMode: 'patch',
          },
        });
      const localRow = rowOf('A', { notes: 'A' });
      expect(
        isFieldPatchEligible(sides([localRow], [rowOf('B', { title: 'B' })])),
      ).toBeFalse();
      expect(
        isFieldPatchEligible(sides([localRow], [at({ title: 'B' }, 'B', 4)])),
      ).toBeFalse();
    });

    it('carries the doneOn a done toggle derives', () => {
      expect(
        localWinningFieldGroups(
          sides([at({ isDone: true }, 'A', 7)], [at({ title: 'B' }, 'B', 4)]),
        ),
      ).toEqual([{ timestamp: 7, changes: { isDone: true, doneOn: 7 } }]);
    });
  });

  describe('aggregateEntityConflict', () => {
    it("joins an entity's conflicts, deduplicating ops by id", () => {
      const local = edit({ title: 'a' }, { id: 'l' });
      const r1 = edit({ title: 'b' }, { id: 'r1' });
      const r2 = edit({ notes: 'n' }, { id: 'r2' });
      const conflict = (remoteOps: Operation[]): EntityConflict => ({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        localOps: [local],
        remoteOps,
        suggestedResolution: 'manual',
      });
      const joined = aggregateEntityConflict([conflict([r1]), conflict([r2])]);
      expect(joined.localOps).toEqual([local]);
      expect(joined.remoteOps).toEqual([r1, r2]);
    });
  });

  describe('keptLocalTimeDeltas / rebaseKeptTimeDeltas', () => {
    const conflict: EntityConflict = {
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      localOps: [edit({ title: 'a' }, { id: 'l' }), delta({ id: 'd' })],
      remoteOps: [
        edit({ title: 'b' }, { id: 'r1', vectorClock: { B: 1 } }),
        edit({ notes: 'n' }, { id: 'r2', vectorClock: { B: 2, C: 1 } }),
      ],
      suggestedResolution: 'manual',
    };

    it('keeps only the local deltas and dominates every remote op', () => {
      const kept = keptLocalTimeDeltas([conflict]);
      expect([...kept.opIds]).toEqual(['d']);
      expect(kept.clockToDominate).toEqual({ B: 2, C: 1 });
    });

    it('rebases the pending deltas with the patches after them', async () => {
      const store = {
        getOpById: jasmine
          .createSpy('getOpById')
          .and.resolveTo({ source: 'local' } as { source: string }),
        rebasePendingLocalOps: jasmine.createSpy('rebase').and.resolveTo([]),
      };
      await rebaseKeptTimeDeltas(store, keptLocalTimeDeltas([conflict]), ['patch']);
      expect(store.rebasePendingLocalOps).toHaveBeenCalledWith(['d', 'patch'], {
        B: 2,
        C: 1,
      });
    });

    it('leaves an already-uploaded delta and the patches alone', async () => {
      const store = {
        getOpById: jasmine.createSpy('getOpById').and.resolveTo({
          source: 'local',
          syncedAt: 1,
        } as {
          source: string;
          syncedAt?: number;
        }),
        rebasePendingLocalOps: jasmine.createSpy('rebase').and.resolveTo([]),
      };
      await rebaseKeptTimeDeltas(store, keptLocalTimeDeltas([conflict]), ['patch']);
      expect(store.rebasePendingLocalOps).not.toHaveBeenCalled();
    });
  });

  describe('timeDeltasSurvivingRemoteWins (#10378)', () => {
    const plan = (over: Partial<Operation> = {}): Operation =>
      op({
        actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
        entityId: undefined,
        entityIds: ['task-1'],
        payload: {
          actionPayload: { taskIds: ['task-1'], today: '2026-01-01' },
          entityChanges: [],
        },
        ...over,
      });
    const conflict = (localOps: Operation[], remoteOps: Operation[]): EntityConflict => ({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    });
    const tick = [
      plan({ id: 'plan', vectorClock: { A: 1 } }),
      delta({ id: 'd', vectorClock: { A: 2 } }),
    ];
    const remotePlan = plan({ id: 'remote-plan', clientId: 'B', vectorClock: { B: 1 } });
    const survivors = (winner: 'local' | 'remote', c: EntityConflict): EntityConflict[] =>
      timeDeltasSurvivingRemoteWins([{ conflict: c, winner }], 'task');

    it('keeps the local delta beside a winner that writes no time, rebased past it', () => {
      const [kept] = survivors('remote', conflict(tick, [remotePlan]));
      expect(kept.localOps.map((o) => o.id)).toEqual(['d']);
      const clocks = keptLocalTimeDeltas([kept]);
      expect([...clocks.opIds]).toEqual(['d']);
      expect(clocks.clockToDominate).toEqual({ B: 1 });
    });

    it('leaves a local win to its snapshot', () => {
      expect(survivors('local', conflict(tick, [remotePlan]))).toEqual([]);
    });

    // D10 refined: a winner that writes no time has no total, so a clock
    // that covers the delta (inherited knowledge, #10438) proves nothing.
    it('keeps a delta even when the winner clock covers it', () => {
      const covering = plan({ id: 'covering', vectorClock: { A: 2, B: 1 } });
      const [kept] = survivors('remote', conflict(tick, [covering]));
      expect(kept.localOps.map((o) => o.id)).toEqual(['d']);
    });

    it('keeps whole-entity LWW when either side writes or may write time', () => {
      const day = '2026-01-01';
      const timeEdit = edit(
        { timeSpentOnDay: { [day]: 5 } },
        { id: 'time', vectorClock: { B: 1 } },
      );
      const replaceRow = op({
        id: 'row',
        actionType: '[TASK] LWW Update' as ActionType,
        vectorClock: { B: 1 },
        payload: { actionPayload: { id: 'task-1' }, lwwUpdateMode: 'replace' },
      });
      expect(survivors('remote', conflict(tick, [timeEdit]))).toEqual([]);
      expect(survivors('remote', conflict(tick, [replaceRow]))).toEqual([]);
      expect(
        survivors('remote', conflict([timeEdit, delta({ id: 'd' })], [remotePlan])),
      ).toEqual([]);
    });
  });

  describe('supersededPatchFields', () => {
    it('lists the fields of readable single-entity edits', () => {
      expect(
        supersededPatchFields(
          [edit({ title: 'a' }), edit({ isDone: true, modified: 3 })],
          'TASK' as EntityType,
          'task',
          'task-1',
        ),
      ).toEqual(['title', 'isDone', 'modified', 'doneOn']);
    });

    it('keeps the whole entity for a reminder clear, as the conflict path does', () => {
      for (const field of ['dueWithTime', 'remindAt', 'reminderId', 'deadlineRemindAt']) {
        expect(
          supersededPatchFields(
            [edit({ title: 'a', [field]: undefined })],
            'TASK' as EntityType,
            'task',
            'task-1',
          ),
        )
          .withContext(field)
          .toBeUndefined();
      }
      expect(
        supersededPatchFields(
          [edit({ dueWithTime: 5 })],
          'TASK' as EntityType,
          'task',
          'task-1',
        ),
      ).toEqual(['dueWithTime']);
    });

    it('keeps the whole entity for deltas, opaque ops, LWW rows and types without a fallback', () => {
      const lwwRow = op({
        actionType: '[TASK] LWW Update' as ActionType,
        payload: {
          actionPayload: { id: 'task-1', title: 'a' },
          entityChanges: [],
          lwwUpdateMode: 'patch',
        },
      });
      for (const ops of [[delta()], [lwwRow], [op({ opType: OpType.Delete })]]) {
        expect(supersededPatchFields(ops, 'TASK' as EntityType, 'task', 'task-1'))
          .withContext(ops[0].actionType)
          .toBeUndefined();
      }
      expect(
        supersededPatchFields(
          [edit({ content: 'x' })],
          'NOTE' as EntityType,
          'note',
          'task-1',
        ),
      ).toBeUndefined();
    });
  });
  describe('done normalization', () => {
    it('clears doneOn beside an undone toggle, as the task reducer does', () => {
      const [{ changes }] = localWinningFieldGroups(
        sides([edit({ isDone: false })], [edit({ title: 'b' }, { timestamp: 500 })]),
      );
      expect('doneOn' in changes).toBeTrue();
      expect(changes['doneOn']).toBeUndefined();
    });

    it('keeps a doneOn the op carried', () => {
      expect(
        localWinningFieldGroups(
          sides(
            [edit({ isDone: true, doneOn: 7 })],
            [edit({ title: 'b' }, { timestamp: 500 })],
          ),
        )[0].changes['doneOn'],
      ).toBe(7);
    });
  });

  describe('survivingLocalFields / buildSurvivingFieldPatches', () => {
    const lwwRow = op({
      id: 'row',
      actionType: '[TASK] LWW Update' as ActionType,
      payload: {
        actionPayload: { id: 'task-1', title: 'row' },
        entityChanges: [],
        lwwUpdateMode: 'patch',
      },
    });
    const conflictOf = (
      localOps: Operation[],
      remoteOps: Operation[],
    ): EntityConflict => ({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    });

    it('re-emits only the local fields the winning row left in state', () => {
      const local = edit({ title: 'mine', isDone: true }, { id: 'l' });
      expect(
        survivingLocalFields(
          conflictOf([local], [lwwRow]),
          { id: 'task-1', title: 'row', isDone: true, doneOn: 5 },
          'task',
        ),
      ).toEqual({ isDone: true, doneOn: 5 });
    });

    it('re-emits nothing when the row overwrote every local field', () => {
      const local = edit({ title: 'mine' }, { id: 'l' });
      expect(
        survivingLocalFields(conflictOf([local], [lwwRow]), { title: 'row' }, 'task'),
      ).toBeUndefined();
    });

    it('leaves readable and opaque winners to their own paths', () => {
      const local = edit({ isDone: true }, { id: 'l' });
      const state = { isDone: true };
      expect(
        survivingLocalFields(conflictOf([local], [edit({ title: 'x' })]), state, 'task'),
      ).toBeUndefined();
      const count = op({
        actionType: '[SimpleCounter] Set SimpleCounter Counter Today' as ActionType,
        payload: { actionPayload: { id: 'task-1', newVal: 3 }, entityChanges: [] },
      });
      expect(
        survivingLocalFields(conflictOf([local], [count]), state, 'task'),
      ).toBeUndefined();
    });

    it('builds one patch per entity, only for remote wins whose local ops are pending', async () => {
      const local = edit({ isDone: true }, { id: 'l' });
      const conflict = conflictOf([local], [lwwRow]);
      const createPatch = jasmine
        .createSpy('createPatch')
        .and.callFake((_c: EntityConflict, fields: Record<string, unknown>) =>
          op({ id: 'patch', payload: fields }),
        );
      const deps = {
        getState: async (): Promise<unknown> => ({ isDone: true }),
        payloadKeyFor: (): string => 'task',
        createPatch,
      };
      const patches = await buildSurvivingFieldPatches(
        [
          { conflict, winner: 'remote' },
          { conflict, winner: 'remote' },
        ],
        new Set(['l']),
        deps,
      );
      expect(patches.length).toBe(1);
      expect(createPatch).toHaveBeenCalledWith(conflict, {
        isDone: true,
        doneOn: undefined,
      });
      expect(
        await buildSurvivingFieldPatches(
          [{ conflict, winner: 'local' }],
          new Set(['l']),
          deps,
        ),
      ).toEqual([]);
      expect(
        await buildSurvivingFieldPatches(
          [{ conflict, winner: 'remote' }],
          new Set(),
          deps,
        ),
      ).toEqual([]);
    });
  });
});
