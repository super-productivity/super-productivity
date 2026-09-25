import { hasRecoverableData } from './has-recoverable-data.util';
import { createAppDataCompleteMock } from '../../util/app-data-mock';
import { initialSimpleCounterState } from '../../features/simple-counter/store/simple-counter.reducer';
import { DEFAULT_SIMPLE_COUNTERS } from '../../features/simple-counter/simple-counter.const';

describe('hasRecoverableData', () => {
  // A fresh install ships the three default counters, so the fixture must too.
  const pristine = (): Record<string, unknown> => ({
    ...(createAppDataCompleteMock() as unknown as Record<string, unknown>),
    simpleCounter: initialSimpleCounterState,
  });

  it('is false for a pristine install and for garbage input', () => {
    expect(initialSimpleCounterState.ids.length).toBe(3);
    expect(hasRecoverableData(pristine())).toBeFalse();
    expect(hasRecoverableData(null)).toBeFalse();
    expect(hasRecoverableData('x')).toBeFalse();
  });

  it('is true when only archived tasks exist', () => {
    const state = {
      ...pristine(),
      archiveOld: { task: { ids: ['a1'], entities: {} } },
    };
    expect(hasRecoverableData(state)).toBeTrue();
  });

  it('is true for recurring-task configs, providers, metrics and plugin data', () => {
    const withIds = { ids: ['x'], entities: {} };
    for (const key of ['taskRepeatCfg', 'issueProvider', 'metric']) {
      expect(hasRecoverableData({ ...pristine(), [key]: withIds }))
        .withContext(key)
        .toBeTrue();
    }
    expect(
      hasRecoverableData({ ...pristine(), pluginUserData: [{ id: 'p', data: 1 }] }),
    ).toBeTrue();
  });

  it('counts a counter only when it is custom, customized, or has recorded activity', () => {
    const [standingDesk] = DEFAULT_SIMPLE_COUNTERS;
    const withCounter = (counter: object): Record<string, unknown> => ({
      ...pristine(),
      simpleCounter: {
        ...initialSimpleCounterState,
        entities: { ...initialSimpleCounterState.entities, [standingDesk.id]: counter },
      },
    });

    expect(hasRecoverableData(withCounter(standingDesk))).toBeFalse();
    expect(
      hasRecoverableData(
        withCounter({ ...standingDesk, countOnDay: { ['2026-01-01']: 2 } }),
      ),
    ).toBeTrue();
    expect(
      hasRecoverableData(withCounter({ ...standingDesk, title: 'Walks' })),
    ).toBeTrue();
    expect(
      hasRecoverableData({
        ...pristine(),
        simpleCounter: {
          ids: ['mine'],
          entities: { mine: { ...standingDesk, id: 'mine' } },
        },
      }),
    ).toBeTrue();
  });

  it('ignores customized settings alone', () => {
    const state = {
      ...pristine(),
      globalConfig: { misc: { isConfirmBeforeExit: true } },
    };
    expect(hasRecoverableData(state)).toBeFalse();
  });
});
