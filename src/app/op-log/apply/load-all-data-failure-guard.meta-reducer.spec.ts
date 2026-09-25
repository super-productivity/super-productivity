import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, MetaReducer, Store, StoreModule } from '@ngrx/store';
import {
  loadAllDataFailureGuardMetaReducer,
  runWithLoadAllDataFailureCollector,
} from './load-all-data-failure-guard.meta-reducer';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../model/model-config';
import { META_REDUCERS } from '../../root-store/meta/meta-reducer-registry';
import { isReducerRejectedAction } from '../../root-store/meta/reducer-failure-guard.meta-reducer';

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

  // The load-bearing claim behind this guard's existence — "a reducer throw
  // on loadAllData silently freezes an unguarded store, and the guard keeps
  // it alive" — must be proven through a REAL store with the registered
  // meta-reducer chain, not simulated seams (#9045 lesson: verify the fix
  // actually fires).
  describe('real store integration', () => {
    interface CounterState {
      count: number;
    }
    interface RootState {
      counter: CounterState;
    }
    const incAction: Action = { type: 'TEST_INC' };
    const counterReducer: ActionReducer<CounterState> = (
      state = { count: 0 },
      action,
    ) => {
      if (action.type === loadAllData.type) {
        throw new Error('feature reducer boom');
      }
      if (action.type === incAction.type) {
        return { count: state.count + 1 };
      }
      return state;
    };

    let store: Store<RootState>;

    const readCount = (): number => {
      let count = -1;
      store.subscribe((s) => (count = s.counter.count)).unsubscribe();
      return count;
    };

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [
          StoreModule.forRoot(
            { counter: counterReducer },
            { metaReducers: META_REDUCERS as MetaReducer<RootState>[] },
          ),
        ],
      });
      store = TestBed.inject(Store);
    });

    it('reports the failure through the registered chain and keeps the store alive', () => {
      let collected: Error | undefined;

      runWithLoadAllDataFailureCollector(
        (error) => (collected = error),
        () =>
          store.dispatch(
            loadAllData({ appDataComplete: {} as unknown as AppDataComplete }),
          ),
      );

      expect(collected?.message).toBe('feature reducer boom');
      expect(readCount()).toBe(0);
      // The store must still accept and commit dispatches — this is the whole
      // point of catching inside the reducer chain.
      store.dispatch(incAction);
      expect(readCount()).toBe(1);
    });

    it('falls through to reducerFailureGuardMetaReducer without a collector (#10195)', () => {
      // Without an active collector this guard is a pass-through. Before
      // #10195 the throw then escaped the NgRx State scan and froze the store;
      // the outer guard at META_REDUCERS[0] now boxes it instead. devError's
      // dev-mode prompt is declined so it does not throw (src/test.ts installs
      // a global confirm spy returning true).
      const confirmSpy = window.confirm as jasmine.Spy;
      confirmSpy.and.returnValue(false);
      try {
        const bad = loadAllData({
          appDataComplete: {} as unknown as AppDataComplete,
        });
        expect(() => store.dispatch(bad)).not.toThrow();
        expect(isReducerRejectedAction(bad)).toBe(true);
        expect(readCount()).toBe(0);

        // The store is alive: later dispatches still commit.
        store.dispatch(incAction);
        expect(readCount()).toBe(1);
      } finally {
        confirmSpy.and.returnValue(true);
      }
    });
  });
});
