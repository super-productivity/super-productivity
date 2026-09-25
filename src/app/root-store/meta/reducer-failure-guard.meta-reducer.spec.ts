/**
 * Regression for #10195: one throwing reducer must not freeze the NgRx store.
 *
 * NgRx runs reducers inside the `State` pipeline's `scan`, so a throw is
 * diverted to the observable error channel: `store.dispatch()` returns
 * normally, the State subscription is torn down and EVERY later dispatch is
 * silently dropped — including bulk-applied remote ops that the op log still
 * marks as applied. Real reducer + registered meta-reducer chain, no mocked
 * seam: `addTaskAttachment` on a missing task id (a dialog-held id after a
 * remote archive) throws in `task.reducer.ts` today.
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Action, ActionReducer, MetaReducer, Store, StoreModule } from '@ngrx/store';
import {
  TASK_FEATURE_NAME,
  initialTaskState,
  taskReducer,
} from '../../features/tasks/store/task.reducer';
import { TaskState } from '../../features/tasks/task.model';
import { createTask } from '../../features/tasks/task.test-helper';
import { setCurrentTask } from '../../features/tasks/store/task.actions';
import { addTaskAttachment } from '../../features/tasks/task-attachment/task-attachment.actions';
import { META_REDUCERS } from './meta-reducer-registry';
import {
  isReducerRejectedAction,
  reducerFailureGuardMetaReducer,
} from './reducer-failure-guard.meta-reducer';
import { _resetDevErrorState } from '../../util/dev-error';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

// devError shows a native alert + confirm (and throws if confirm returns true).
// src/test.ts installs a PERMANENT global confirm spy, so reset its calls per
// test and restore the global returnValue(true) default afterwards.
const spyNativeDialogs = (): jasmine.Spy => {
  if (!jasmine.isSpy(window.alert)) {
    spyOn(window, 'alert');
  }
  const confirmSpy = jasmine.isSpy(window.confirm)
    ? (window.confirm as jasmine.Spy)
    : spyOn(window, 'confirm');
  confirmSpy.calls.reset();
  confirmSpy.and.returnValue(false);
  return confirmSpy;
};

const TASK = createTask({ id: 'EXISTING', title: 'still here' });

const seedState: TaskState = {
  ...initialTaskState,
  ids: [TASK.id],
  entities: { [TASK.id]: TASK },
};

type RootState = { [TASK_FEATURE_NAME]: TaskState };

describe('reducerFailureGuardMetaReducer (#10195)', () => {
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    _resetDevErrorState();
    confirmSpy = spyNativeDialogs();
  });

  afterEach(() => {
    confirmSpy.and.returnValue(true);
  });

  describe('with the registered META_REDUCERS chain and the real task reducer', () => {
    let store: Store<RootState>;

    const taskState = (): TaskState => {
      let s: TaskState | undefined;
      store
        .select((rootState) => rootState[TASK_FEATURE_NAME])
        .subscribe((v) => (s = v))
        .unsubscribe();
      return s as TaskState;
    };

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [
          StoreModule.forRoot(
            { [TASK_FEATURE_NAME]: taskReducer },
            {
              initialState: { [TASK_FEATURE_NAME]: seedState },
              metaReducers: META_REDUCERS as MetaReducer<RootState>[],
            },
          ),
        ],
      });
      store = TestBed.inject(Store);
    });

    it('keeps the store alive after a reducer throw, so the next action is applied', () => {
      const bad = addTaskAttachment({
        taskId: 'missing-after-remote-archive',
        taskAttachment: { id: 'a1', type: 'LINK', path: 'https://example.com' },
      });

      expect(() => store.dispatch(bad)).not.toThrow();
      expect(taskState().entities[TASK.id]).toBe(TASK);

      store.dispatch(setCurrentTask({ id: TASK.id }));
      expect(taskState().currentTaskId)
        .withContext('store is dead — the dispatch after the throw never reached state')
        .toBe(TASK.id);
    });
  });

  describe('dispatch ordering against LOCAL_ACTIONS (real store)', () => {
    const throwing: ActionReducer<number> = (state = 0, action) => {
      if (action.type === 'THROW') {
        throw new Error('reducer boom');
      }
      return action.type === 'INC' ? state + 1 : state;
    };
    let store: Store<{ n: number }>;
    let seen: Action[];

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [
          StoreModule.forRoot(
            { n: throwing },
            { metaReducers: META_REDUCERS as MetaReducer<{ n: number }>[] },
          ),
        ],
      });
      store = TestBed.inject(Store);
      seen = [];
      TestBed.inject(LOCAL_ACTIONS).subscribe((a) => seen.push(a));
    });

    it('hides a rejected top-level dispatch from LOCAL_ACTIONS', () => {
      store.dispatch({ type: 'THROW' });
      expect(seen.map((a) => a.type)).not.toContain('THROW');
    });

    it('hides a rejected action dispatched synchronously from a state subscriber', () => {
      // NgRx State reads actions via observeOn(queueScheduler), so a dispatch
      // issued inside a state emission is queued. The filters still hold
      // because `Actions` is fed by ScannedActionsSubject, which State emits
      // only AFTER the reducer chain (and thus the guard) has run.
      let dispatched = false;
      store
        .select((s) => s.n)
        .subscribe((n) => {
          if (n === 1 && !dispatched) {
            dispatched = true;
            store.dispatch({ type: 'THROW' });
          }
        });
      store.dispatch({ type: 'INC' });
      expect(dispatched).toBe(true);
      expect(seen.map((a) => a.type)).not.toContain('THROW');
    });
  });

  describe('unit', () => {
    const boom = new Error('reducer boom');
    const inner: ActionReducer<number> = (state = 0, action) => {
      if (action.type === 'THROW') {
        throw boom;
      }
      return action.type === 'INC' ? state + 1 : state;
    };
    const guarded = reducerFailureGuardMetaReducer(inner);

    it('is a pass-through when the reducer does not throw', () => {
      const inc: Action = { type: 'INC' };
      expect(guarded(1, inc)).toBe(2);
      expect(isReducerRejectedAction(inc)).toBe(false);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('returns the previous state, marks the action rejected and reports via devError', () => {
      const throwing: Action = { type: 'THROW' };
      expect(guarded(5, throwing)).toBe(5);
      expect(isReducerRejectedAction(throwing)).toBe(true);
      // devError (dev build): blocking confirm carrying the error
      expect(confirmSpy.calls.mostRecent().args[0]).toContain('reducer boom');
    });

    it('marks only the action instance that threw', () => {
      const throwing: Action = { type: 'THROW' };
      const twin: Action = { type: 'THROW' };
      guarded(0, throwing);
      expect(isReducerRejectedAction(twin)).toBe(false);
    });

    it('keeps devErrors dev-mode throw off the reducer stack', fakeAsync(() => {
      // The developer confirmed "Throw an error?". Escaping here would tear
      // down the State scan — the freeze this guard exists to prevent.
      confirmSpy.and.returnValue(true);
      const throwing: Action = { type: 'THROW' };

      expect(() => guarded(5, throwing)).not.toThrow();
      expect(isReducerRejectedAction(throwing)).toBe(true);
      // Re-raised asynchronously instead, so the developer still sees it.
      expect(() => tick()).toThrow();
    }));

    it('rethrows when there is no previous state to keep (store init)', () => {
      const initAction: Action = { type: 'THROW' };
      // Returning `undefined` as root state would make every selector misread
      // it, so a failure to build the initial state must stay fatal.
      expect(() => guarded(undefined, initAction)).toThrowError('reducer boom');
      expect(isReducerRejectedAction(initAction)).toBe(false);
    });
  });
});
