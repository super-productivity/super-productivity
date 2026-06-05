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

  const applyRemotely = (changes: Partial<TaskRepeatCfg>): TaskRepeatCfg | undefined => {
    // Same creator the local client dispatches; the whole ACTION is then
    // wire-round-tripped (like the op-log payload) and replayed through the
    // real reducer — exactly what a remote client does.
    const replayed = wireRoundTrip(
      updateTaskRepeatCfg({ taskRepeatCfg: { id: baseEntity.id, changes } }),
    );
    const state = taskRepeatCfgReducer(
      {
        ids: [baseEntity.id],
        entities: { [baseEntity.id]: baseEntity },
      } as never,
      replayed,
    );
    return state.entities[baseEntity.id];
  };

  it('rrule REPLACEMENT (preset switch) survives the wire', () => {
    const remote = applyRemotely({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      monthlyLastDay: false,
    });
    expect(remote?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });

  it('monthlyLastDay clearing via `false` survives the wire', () => {
    const remote = applyRemotely({ monthlyLastDay: false });
    expect(remote?.monthlyLastDay).toBe(false);
  });

  it('DOCUMENTED GAP: anchor clearing via `undefined` does NOT survive the wire', () => {
    // `null` is not an option: released clients' typia schema has no `| null`
    // on these fields, and an out-of-schema value triggers their blocking
    // data-repair confirm dialog on every sync. The stale anchor is inert on
    // rrule-aware clients (the engine routes on `rrule`); legacy clients keep
    // a best-effort approximation. Making this durable requires first SHIPPING
    // `| null` on both anchor fields in a release, then switching the reset
    // value to null — if this test starts failing because the anchors now
    // clear remotely, that migration happened and this pin can be inverted.
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
