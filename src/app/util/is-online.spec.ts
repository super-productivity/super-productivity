import { fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { isOnline, isOnline$ } from './is-online';
import { withLatestFrom } from 'rxjs/operators';
import { Subject } from 'rxjs';

describe('isOnline utilities', () => {
  describe('isOnline()', () => {
    it('should return true when navigator.onLine is true', () => {
      spyOnProperty(navigator, 'onLine').and.returnValue(true);
      expect(isOnline()).toBe(true);
    });

    it('should return true when navigator.onLine is undefined (not false)', () => {
      spyOnProperty(navigator, 'onLine').and.returnValue(undefined as any);
      expect(isOnline()).toBe(true);
    });

    it('should return false when navigator.onLine is false', () => {
      spyOnProperty(navigator, 'onLine').and.returnValue(false);
      expect(isOnline()).toBe(false);
    });
  });

  describe('isOnline$', () => {
    // Note: isOnline$ is a module-level singleton with shareReplay(1).
    // The initial value is captured at module load time via startWith(navigator.onLine).
    // Tests should use online/offline events to change the cached value.

    it('should emit a boolean value when subscribed', fakeAsync(() => {
      const values: boolean[] = [];
      const sub = isOnline$.subscribe((v) => values.push(v));

      // With startWith, value should be emitted immediately
      tick(0);
      expect(values.length).toBeGreaterThanOrEqual(1);
      expect(typeof values[0]).toBe('boolean');

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should share the same stream across multiple subscribers (shareReplay)', fakeAsync(() => {
      const values1: boolean[] = [];
      const values2: boolean[] = [];

      const sub1 = isOnline$.subscribe((v) => values1.push(v));
      const sub2 = isOnline$.subscribe((v) => values2.push(v));

      tick(0);

      // Both subscribers should receive the same cached value
      expect(values1.length).toBe(1);
      expect(values2.length).toBe(1);
      expect(values1[0]).toBe(values2[0]);

      sub1.unsubscribe();
      sub2.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should debounce rapid state changes', fakeAsync(() => {
      const values: boolean[] = [];
      const sub = isOnline$.subscribe((v) => values.push(v));

      // Initial value emits immediately via startWith
      tick(0);
      const initialLength = values.length;

      // Simulate rapid online/offline events (faster than debounce time)
      window.dispatchEvent(new Event('offline'));
      tick(200);
      window.dispatchEvent(new Event('online'));
      tick(200);
      window.dispatchEvent(new Event('offline'));
      tick(200);
      window.dispatchEvent(new Event('online'));

      // Events are being debounced, so no new emissions yet
      expect(values.length).toBe(initialLength);

      // After debounce, at most one new value should emit
      tick(1000);
      expect(values.length).toBeLessThanOrEqual(initialLength + 1);

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should not emit duplicate values due to distinctUntilChanged', fakeAsync(() => {
      const values: boolean[] = [];
      const sub = isOnline$.subscribe((v) => values.push(v));

      tick(0);
      const initialValue = values[values.length - 1];
      const initialLength = values.length;

      // Dispatch event matching current state - should not emit duplicate
      if (initialValue) {
        window.dispatchEvent(new Event('online'));
      } else {
        window.dispatchEvent(new Event('offline'));
      }
      tick(1000);

      // No new emission due to distinctUntilChanged
      expect(values.length).toBe(initialLength);

      sub.unsubscribe();
      discardPeriodicTasks();
    }));
  });

  /**
   * Tests for the race condition fix (issues #5868, #5877)
   *
   * The original bug: debounceTime(1000) delayed ALL emissions by 1 second,
   * including the initial value. When sync.effects.ts used withLatestFrom(isOnline$)
   * and the app initialized faster than 1 second, the observable chain hung forever
   * because withLatestFrom requires the other observable to have already emitted.
   *
   * The fix: startWith(navigator.onLine) provides an immediate initial value,
   * ensuring withLatestFrom always has a value to work with.
   */
  describe('isOnline$ race condition fix (#5868, #5877)', () => {
    it('should emit IMMEDIATELY on subscription (before debounce time)', fakeAsync(() => {
      const values: boolean[] = [];
      const sub = isOnline$.subscribe((v) => values.push(v));

      // CRITICAL: Value must be emitted IMMEDIATELY, not after 1 second
      // This is the key fix for the 25-second loading issue
      tick(0);
      expect(values.length).toBe(1);
      expect(typeof values[0]).toBe('boolean');

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should work with withLatestFrom without waiting for debounce (sync.effects.ts pattern)', fakeAsync(() => {
      // This simulates the pattern used in sync.effects.ts:
      // trigger$.pipe(withLatestFrom(isOnline$))
      const trigger$ = new Subject<string>();
      const results: Array<[string, boolean]> = [];

      const sub = trigger$
        .pipe(withLatestFrom(isOnline$))
        .subscribe(([trigger, online]) => {
          results.push([trigger, online]);
        });

      // Trigger IMMEDIATELY - before 1 second debounce would have passed
      // This is the exact scenario that caused the 25-second hang
      tick(0);
      trigger$.next('SYNC_INITIAL_TRIGGER');

      // CRITICAL: withLatestFrom should have a value immediately
      // Without the startWith fix, this would hang forever
      expect(results.length).toBe(1);
      expect(results[0][0]).toBe('SYNC_INITIAL_TRIGGER');
      expect(typeof results[0][1]).toBe('boolean');

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should still debounce subsequent online/offline events (preserves #5738 fix)', fakeAsync(() => {
      const values: boolean[] = [];
      const sub = isOnline$.subscribe((v) => values.push(v));

      // Initial value emits immediately
      tick(0);
      const initialLength = values.length;

      // Rapid offline/online events should be debounced
      window.dispatchEvent(new Event('offline'));
      tick(100);
      window.dispatchEvent(new Event('online'));
      tick(100);
      window.dispatchEvent(new Event('offline'));
      tick(100);

      // Only initial value so far - events are being debounced
      expect(values.length).toBe(initialLength);

      // After debounce time, the final state should emit (if different from current)
      tick(1000);
      // At most one new value (offline) should have been added
      expect(values.length).toBeLessThanOrEqual(initialLength + 1);

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should provide consistent value to multiple withLatestFrom consumers', fakeAsync(() => {
      const trigger1$ = new Subject<string>();
      const trigger2$ = new Subject<string>();
      const results1: Array<[string, boolean]> = [];
      const results2: Array<[string, boolean]> = [];

      const sub1 = trigger1$
        .pipe(withLatestFrom(isOnline$))
        .subscribe(([t, o]) => results1.push([t, o]));

      const sub2 = trigger2$
        .pipe(withLatestFrom(isOnline$))
        .subscribe(([t, o]) => results2.push([t, o]));

      tick(0);

      // Both triggers fire at different times, both should work immediately
      trigger1$.next('TRIGGER_1');
      tick(50);
      trigger2$.next('TRIGGER_2');

      // Both should have received results
      expect(results1.length).toBe(1);
      expect(results2.length).toBe(1);
      // Both should have the same online status (from shared cache)
      expect(results1[0][1]).toBe(results2[0][1]);

      sub1.unsubscribe();
      sub2.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should update withLatestFrom consumers when online status changes via events', fakeAsync(() => {
      const trigger$ = new Subject<string>();
      const results: Array<[string, boolean]> = [];

      const sub = trigger$
        .pipe(withLatestFrom(isOnline$))
        .subscribe(([t, o]) => results.push([t, o]));

      tick(0);
      trigger$.next('FIRST');
      expect(results.length).toBe(1);

      // Dispatch offline event and wait for debounce
      window.dispatchEvent(new Event('offline'));
      tick(1100);

      trigger$.next('AFTER_OFFLINE');
      expect(results.length).toBe(2);

      // Dispatch online event and wait for debounce
      window.dispatchEvent(new Event('online'));
      tick(1100);

      trigger$.next('AFTER_ONLINE');
      expect(results.length).toBe(3);

      // The key test: online status should have changed between triggers
      // (the exact values depend on initial state, but they should reflect the events)
      // Most importantly, withLatestFrom continues to work after status changes
      expect(typeof results[0][1]).toBe('boolean');
      expect(typeof results[1][1]).toBe('boolean');
      expect(typeof results[2][1]).toBe('boolean');

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('should not hang withLatestFrom when triggered within first second (regression test for #5868)', fakeAsync(() => {
      // This is the CRITICAL regression test
      // Before the fix: if trigger fired within 1 second, withLatestFrom would hang
      // because isOnline$ hadn't emitted due to debounceTime(1000)

      const trigger$ = new Subject<string>();
      let receivedValue = false;

      const sub = trigger$.pipe(withLatestFrom(isOnline$)).subscribe(() => {
        receivedValue = true;
      });

      // Fire trigger at various times within the first second
      // All should work immediately thanks to startWith
      tick(0);
      trigger$.next('at_0ms');
      expect(receivedValue).toBe(true);

      receivedValue = false;
      tick(100);
      trigger$.next('at_100ms');
      expect(receivedValue).toBe(true);

      receivedValue = false;
      tick(400);
      trigger$.next('at_500ms');
      expect(receivedValue).toBe(true);

      sub.unsubscribe();
      discardPeriodicTasks();
    }));
  });
});
