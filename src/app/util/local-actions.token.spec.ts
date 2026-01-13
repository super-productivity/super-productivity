import { TestBed } from '@angular/core/testing';
import { Action, Store, StoreModule } from '@ngrx/store';
import { LOCAL_ACTIONS, ALL_ACTIONS } from './local-actions.token';

/**
 * Tests for LOCAL_ACTIONS and ALL_ACTIONS injection tokens.
 *
 * These tokens are critical for the sync architecture:
 * - LOCAL_ACTIONS filters out remote sync operations (meta.isRemote: true)
 * - ALL_ACTIONS passes through all actions (used only by operation-log.effects.ts)
 *
 * All 27 effects files use LOCAL_ACTIONS to ensure effects don't run for remote ops.
 * Testing this mechanism once validates the filtering for all effects.
 */
describe('LOCAL_ACTIONS token', () => {
  let store: Store;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StoreModule.forRoot({})],
    });
    store = TestBed.inject(Store);
  });

  describe('LOCAL_ACTIONS', () => {
    it('should filter out actions with meta.isRemote: true', (done) => {
      const localActions$ = TestBed.inject(LOCAL_ACTIONS);
      const emissions: Action[] = [];

      const sub = localActions$.subscribe((a) => emissions.push(a));

      store.dispatch({ type: 'REMOTE_ACTION', meta: { isRemote: true } } as Action);

      // Give time for any potential emission
      setTimeout(() => {
        expect(emissions.filter((a) => a.type === 'REMOTE_ACTION')).toEqual([]);
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should pass through local actions (no meta)', (done) => {
      const localActions$ = TestBed.inject(LOCAL_ACTIONS);
      const emissions: Action[] = [];

      const sub = localActions$.subscribe((a) => emissions.push(a));

      store.dispatch({ type: 'LOCAL_ACTION' });

      setTimeout(() => {
        expect(emissions.some((a) => a.type === 'LOCAL_ACTION')).toBe(true);
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should pass through actions with meta.isRemote: false', (done) => {
      const localActions$ = TestBed.inject(LOCAL_ACTIONS);
      const emissions: Action[] = [];

      const sub = localActions$.subscribe((a) => emissions.push(a));

      store.dispatch({ type: 'EXPLICIT_LOCAL', meta: { isRemote: false } } as Action);

      setTimeout(() => {
        expect(emissions.some((a) => a.type === 'EXPLICIT_LOCAL')).toBe(true);
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should pass through actions with meta but no isRemote property', (done) => {
      const localActions$ = TestBed.inject(LOCAL_ACTIONS);
      const emissions: Action[] = [];

      const sub = localActions$.subscribe((a) => emissions.push(a));

      store.dispatch({ type: 'META_NO_REMOTE', meta: { someOther: 'value' } } as Action);

      setTimeout(() => {
        expect(emissions.some((a) => a.type === 'META_NO_REMOTE')).toBe(true);
        sub.unsubscribe();
        done();
      }, 0);
    });
  });

  describe('ALL_ACTIONS', () => {
    it('should receive both remote and local actions', (done) => {
      const allActions$ = TestBed.inject(ALL_ACTIONS);
      const emissions: Action[] = [];

      const sub = allActions$.subscribe((a) => emissions.push(a));

      store.dispatch({ type: 'REMOTE', meta: { isRemote: true } } as Action);
      store.dispatch({ type: 'LOCAL' });

      setTimeout(() => {
        expect(emissions.some((a) => a.type === 'REMOTE')).toBe(true);
        expect(emissions.some((a) => a.type === 'LOCAL')).toBe(true);
        sub.unsubscribe();
        done();
      }, 0);
    });
  });
});
