import { asPatchSnapshotIfTypeShadowed } from './lww-snapshot-patch-mode.util';
import { ActionType, LwwUpdatePayload, Operation, OpType } from '../core/operation.types';

describe('asPatchSnapshotIfTypeShadowed', () => {
  const habit = {
    id: 'cnt-1',
    title: 'Habit',
    isEnabled: true,
    icon: null,
    type: 'StopWatch',
    countOnDay: {},
    isOn: false,
    isTrackStreaks: false,
    streakMinValue: undefined,
  };
  const lwwOp = (
    entityType: Operation['entityType'],
    payload: Partial<LwwUpdatePayload>,
  ): Operation => ({
    id: 'op-1',
    actionType: `[${entityType}] LWW Update` as ActionType,
    opType: OpType.Update,
    entityType,
    entityId: 'cnt-1',
    payload: {
      actionPayload: habit,
      entityChanges: [],
      lwwUpdateMode: 'replace',
      ...payload,
    },
    clientId: 'client-a',
    vectorClock: { clientA: 2 },
    timestamp: 1,
    schemaVersion: 4,
  });

  it('sends a habit snapshot as a patch that clears every optional field it lacks', () => {
    const op = lwwOp('SIMPLE_COUNTER', {});

    const result = asPatchSnapshotIfTypeShadowed(op);

    expect(result.payload).toEqual({
      actionPayload: habit,
      entityChanges: [],
      lwwUpdateMode: 'patch',
      clearedFields: [
        'isHideButton',
        'streakMinValue',
        'streakMode',
        'streakWeekDays',
        'streakWeeklyFrequency',
        'countdownDuration',
      ],
    });
    expect({ ...result, payload: op.payload }).toEqual(op);
  });

  it('lists no clears when the snapshot carries every optional field', () => {
    const result = asPatchSnapshotIfTypeShadowed(
      lwwOp('SIMPLE_COUNTER', {
        actionPayload: {
          ...habit,
          isHideButton: false,
          streakMinValue: 2,
          streakMode: 'weekly-frequency',
          streakWeekDays: {},
          streakWeeklyFrequency: 3,
          countdownDuration: 60000,
        },
      }),
    );

    expect((result.payload as LwwUpdatePayload).lwwUpdateMode).toBe('patch');
    expect(Object.keys(result.payload as object)).not.toContain('clearedFields');
  });

  it('keeps a recreate-after-delete snapshot a replace', () => {
    const op = lwwOp('SIMPLE_COUNTER', { recreatesEntityAfterDelete: true });

    expect(asPatchSnapshotIfTypeShadowed(op)).toBe(op);
  });

  it('leaves other entity types and existing patch deltas untouched', () => {
    const task = lwwOp('TASK', { actionPayload: { id: 'cnt-1', title: 'T' } });
    const mergedDelta = lwwOp('SIMPLE_COUNTER', {
      actionPayload: { id: 'cnt-1', title: 'T' },
      lwwUpdateMode: 'patch',
    });

    expect(asPatchSnapshotIfTypeShadowed(task)).toBe(task);
    expect(asPatchSnapshotIfTypeShadowed(mergedDelta)).toBe(mergedDelta);
  });
});
