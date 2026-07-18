import { Action, ActionReducer } from '@ngrx/store';
import {
  loadAllDataFailureGuardMetaReducer,
  runWithLoadAllDataFailureCollector,
} from './load-all-data-failure-guard.meta-reducer';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../model/model-config';

describe('loadAllDataFailureGuardMetaReducer', () => {
  interface TestState {
    value: string;
  }

  const prevState: TestState = { value: 'previous' };
  const loadAction = loadAllData({
    appDataComplete: {} as unknown as AppDataComplete,
  });

  const throwingReducer: ActionReducer<TestState> = (state, action) => {
    if (action.type === loadAllData.type) {
      throw new Error('reducer boom');
    }
    return state as TestState;
  };

  const succeedingReducer: ActionReducer<TestState> = () => ({ value: 'next' });

  it('propagates a loadAllData reducer throw when no collector is active', () => {
    const wrapped = loadAllDataFailureGuardMetaReducer(throwingReducer);

    expect(() => wrapped(prevState, loadAction)).toThrowError('reducer boom');
  });

  it('catches the throw, reports it, and returns the previous state while a collector is active', () => {
    const wrapped = loadAllDataFailureGuardMetaReducer(throwingReducer);
    let collected: Error | undefined;
    let result: TestState | undefined;

    runWithLoadAllDataFailureCollector(
      (error) => (collected = error),
      () => {
        result = wrapped(prevState, loadAction);
      },
    );

    expect(collected?.message).toBe('reducer boom');
    expect(result).toBe(prevState);
  });

  it('does not intercept throws from other action types even while a collector is active', () => {
    const otherThrowingReducer: ActionReducer<TestState> = () => {
      throw new Error('other boom');
    };
    const wrapped = loadAllDataFailureGuardMetaReducer(otherThrowingReducer);
    let collected: Error | undefined;

    expect(() =>
      runWithLoadAllDataFailureCollector(
        (error) => (collected = error),
        () => wrapped(prevState, { type: 'OTHER' } as Action),
      ),
    ).toThrowError('other boom');
    expect(collected).toBeUndefined();
  });

  it('passes a successful loadAllData reduction through unchanged', () => {
    const wrapped = loadAllDataFailureGuardMetaReducer(succeedingReducer);
    let result: TestState | undefined;

    runWithLoadAllDataFailureCollector(
      () => fail('collector must not fire on success'),
      () => {
        result = wrapped(prevState, loadAction);
      },
    );

    expect(result).toEqual({ value: 'next' });
  });

  it('deactivates the collector after the run completes', () => {
    const wrapped = loadAllDataFailureGuardMetaReducer(throwingReducer);

    runWithLoadAllDataFailureCollector(
      () => undefined,
      () => wrapped(prevState, loadAction),
    );

    // Outside the run the guard must be a pass-through again.
    expect(() => wrapped(prevState, loadAction)).toThrowError('reducer boom');
  });
});
