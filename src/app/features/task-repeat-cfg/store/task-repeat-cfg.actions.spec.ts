import {
  addTaskRepeatCfgToTask,
  updateTaskRepeatCfg,
  updateTaskRepeatCfgs,
} from './task-repeat-cfg.actions';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { taskRepeatCfgReducer } from './task-repeat-cfg.reducer';

// The op-log replays action *payloads* (operation-capture.service.ts), so the
// action creators are the single boundary that keeps an out-of-union
// quickSetting off the wire. These guard that clamp directly.
const cfg = (over: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({ ...DEFAULT_TASK_REPEAT_CFG, id: 'r1', ...over }) as TaskRepeatCfg;

describe('task-repeat-cfg actions — quickSetting persist clamp', () => {
  describe('addTaskRepeatCfgToTask', () => {
    it('clamps a newer preset literal to CUSTOM', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({
          quickSetting: 'WEEKENDS',
          rrule: 'FREQ=WEEKLY;BYDAY=SA,SU',
        }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('CUSTOM');
      // the opaque rule and other fields survive untouched
      expect(action.taskRepeatCfg.rrule).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    });

    it('clamps the in-memory RRULE literal to CUSTOM', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({ quickSetting: 'RRULE', rrule: 'FREQ=DAILY' }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('CUSTOM');
    });

    it('passes a released (master) value through unchanged', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({ quickSetting: 'DAILY' }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('DAILY');
    });
  });

  describe('updateTaskRepeatCfg', () => {
    it('clamps quickSetting in the Update changes', () => {
      const action = updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: 'r1',
          changes: { quickSetting: 'RRULE', rrule: 'FREQ=DAILY' },
        },
      });
      expect(action.taskRepeatCfg.changes.quickSetting).toBe('CUSTOM');
      expect(action.taskRepeatCfg.changes.rrule).toBe('FREQ=DAILY');
      expect(action.taskRepeatCfg.id).toBe('r1');
    });

    it('leaves changes without a quickSetting untouched (never invents one)', () => {
      const action = updateTaskRepeatCfg({
        taskRepeatCfg: { id: 'r1', changes: { startTime: '09:00' } },
      });
      expect('quickSetting' in action.taskRepeatCfg.changes).toBe(false);
      expect(action.taskRepeatCfg.changes.startTime).toBe('09:00');
    });
  });

  describe('updateTaskRepeatCfgs', () => {
    it('clamps quickSetting in the bulk changes', () => {
      const action = updateTaskRepeatCfgs({
        ids: ['r1', 'r2'],
        changes: { quickSetting: 'QUARTERLY_CURRENT_DATE' },
      });
      expect(action.changes.quickSetting).toBe('CUSTOM');
      expect(action.ids).toEqual(['r1', 'r2']);
    });
  });
});

describe('task-repeat-cfg actions — monthly anchor null strip', () => {
  // Released clients' typia schema allows the numeric anchors only
  // absent-or-numeric: a `null` on the wire would trip their validation /
  // repair flow. The creators normalize a null leaking in from an untyped
  // path (formly model, import) to `undefined`, which JSON.stringify drops.
  it('normalizes null anchors to undefined in a create payload', () => {
    const action = addTaskRepeatCfgToTask({
      taskId: 't1',
      taskRepeatCfg: cfg({
        monthlyWeekOfMonth: null,
        monthlyWeekday: null,
      } as unknown as Partial<TaskRepeatCfg>),
    });
    expect(action.taskRepeatCfg.monthlyWeekOfMonth).toBeUndefined();
    expect(action.taskRepeatCfg.monthlyWeekday).toBeUndefined();
    expect(
      JSON.parse(JSON.stringify(action.taskRepeatCfg)).monthlyWeekOfMonth,
    ).toBeUndefined();
  });

  it('normalizes null anchors to undefined in Update changes', () => {
    const action = updateTaskRepeatCfg({
      taskRepeatCfg: {
        id: 'r1',
        changes: {
          monthlyWeekOfMonth: null,
          monthlyWeekday: null,
        } as unknown as Partial<TaskRepeatCfg>,
      },
    });
    expect(action.taskRepeatCfg.changes.monthlyWeekOfMonth).toBeUndefined();
    expect(action.taskRepeatCfg.changes.monthlyWeekday).toBeUndefined();
  });

  it('passes numeric anchors through unchanged', () => {
    const action = updateTaskRepeatCfg({
      taskRepeatCfg: {
        id: 'r1',
        changes: { monthlyWeekOfMonth: 2, monthlyWeekday: 3 },
      },
    });
    expect(action.taskRepeatCfg.changes.monthlyWeekOfMonth).toBe(2);
    expect(action.taskRepeatCfg.changes.monthlyWeekday).toBe(3);
  });

  it('strips out-of-union anchor numbers (released clients typia-reject them)', () => {
    // e.g. a BYDAY=5MO / -2MO ordinal a converter bug let through, or a
    // foreign import — must never reach the wire.
    const action = updateTaskRepeatCfg({
      taskRepeatCfg: {
        id: 'r1',
        changes: {
          monthlyWeekOfMonth: 5,
          monthlyWeekday: 9,
        } as unknown as Partial<TaskRepeatCfg>,
      },
    });
    expect(action.taskRepeatCfg.changes.monthlyWeekOfMonth).toBeUndefined();
    expect(action.taskRepeatCfg.changes.monthlyWeekday).toBeUndefined();

    const negative = addTaskRepeatCfgToTask({
      taskId: 't1',
      taskRepeatCfg: cfg({
        monthlyWeekOfMonth: -2,
        monthlyWeekday: 1.5,
      } as unknown as Partial<TaskRepeatCfg>),
    });
    expect(negative.taskRepeatCfg.monthlyWeekOfMonth).toBeUndefined();
    expect(negative.taskRepeatCfg.monthlyWeekday).toBeUndefined();
    expect(
      JSON.parse(JSON.stringify(negative.taskRepeatCfg)).monthlyWeekOfMonth,
    ).toBeUndefined();
  });

  it('keeps the -1 (last) anchor and boundary weekday values', () => {
    const action = updateTaskRepeatCfg({
      taskRepeatCfg: {
        id: 'r1',
        changes: { monthlyWeekOfMonth: -1, monthlyWeekday: 0 },
      },
    });
    expect(action.taskRepeatCfg.changes.monthlyWeekOfMonth).toBe(-1);
    expect(action.taskRepeatCfg.changes.monthlyWeekday).toBe(0);
  });
});

describe('task-repeat-cfg op-log JSON round-trip (remote-apply durability)', () => {
  // The op-log serializes action payloads with JSON.stringify, which DROPS
  // `undefined` keys — a remote client's reducer then merges a partial update
  // that never contained the cleared field. These tests pin which schedule
  // transitions ARE durable over the wire and which are a documented gap.
  const wireRoundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  const baseEntity = cfg({
    quickSetting: 'CUSTOM',
    repeatCycle: 'MONTHLY',
    startDate: '2024-06-11',
    // Stored as an nth-weekday cfg ("2nd Tuesday"):
    monthlyWeekOfMonth: 2,
    monthlyWeekday: 2,
    monthlyLastDay: false,
    rrule: 'FREQ=MONTHLY;BYDAY=2TU',
  });

  const applyRemotely = (
    changes: Partial<TaskRepeatCfg>,
    base: TaskRepeatCfg = baseEntity,
  ): TaskRepeatCfg | undefined => {
    // Same creator the local client dispatches; the whole ACTION is then
    // wire-round-tripped (like the op-log payload) and replayed through the
    // real reducer — exactly what a remote client does.
    const replayed = wireRoundTrip(
      updateTaskRepeatCfg({ taskRepeatCfg: { id: base.id, changes } }),
    );
    const state = taskRepeatCfgReducer(
      {
        ids: [base.id],
        entities: { [base.id]: base },
      } as never,
      replayed,
    );
    return state.entities[base.id];
  };

  it('rrule REPLACEMENT (preset switch) survives the wire', () => {
    const remote = applyRemotely({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      monthlyLastDay: false,
    });
    expect(remote?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });

  it('monthlyLastDay clearing via `false` survives the wire', () => {
    // Start from `true` so this proves `false` actually overwrites the stored
    // flag over the wire — against an already-false base the assertion would
    // pass even if the update were dropped/ignored.
    const lastDayBase = cfg({
      ...baseEntity,
      // A coherent "last day of month" base (no Nth-weekday anchor).
      monthlyWeekOfMonth: undefined,
      monthlyWeekday: undefined,
      monthlyLastDay: true,
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
    });
    const remote = applyRemotely({ monthlyLastDay: false }, lastDayBase);
    expect(remote?.monthlyLastDay).toBe(false);
  });

  it('INHERENT LIMITATION: anchor clearing via `undefined` does NOT survive the wire', () => {
    // This is unfixable for the affected clients, not a deferred TODO:
    //  - The clear can only reach a remote client as a concrete in-schema
    //    value. `hasNthWeekdayAnchor` accepts only {1,2,3,4,-1} × {0..6}, so no
    //    in-schema value means "no anchor" (0 is a valid weekday). `undefined`
    //    is dropped by the op-log's JSON partial-update merge; `null`/`0` trip
    //    released clients' blocking data-repair dialog on every sync.
    //  - The only clients that misfire here are those with the #6040 anchor but
    //    PRE-rrule. They run released code, so no payload we send disables their
    //    anchor path — the engine routes on the anchor, ignoring `rrule`.
    //  - A `| null` migration does NOT help: it would only benefit a client
    //    that is null-aware yet rrule-UNAWARE, but `| null` can only ship
    //    with-or-after rrule (rrule lands first, here), so that band is empty —
    //    any client new enough to accept a null clear already routes on `rrule`,
    //    where the stale anchor is inert. Don't spend a release on it.
    // Only the UPDATE path is affected; ADD sends the field absent (no anchor
    // remotely), which is already durable.
    const remote = applyRemotely({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      monthlyWeekOfMonth: undefined,
      monthlyWeekday: undefined,
    });
    expect(remote?.monthlyWeekOfMonth).toBe(2); // stale — see comment above
    expect(remote?.monthlyWeekday).toBe(2);
    // But the rule itself DID replace, which is what rrule-aware clients use.
    expect(remote?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });
});
