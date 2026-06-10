import { asyncScheduler } from 'rxjs';

/**
 * Guards the rxjs scheduler hardening installed in `src/test.ts`.
 *
 * A leaked time-based subscription can leave a scheduled `AsyncAction` whose
 * timer fires AFTER the action was unsubscribed (closed). rxjs would then make
 * `AsyncScheduler.flush` rethrow `Error('executing a cancelled action')`
 * synchronously inside the timer callback, crashing the whole Karma session.
 * The harness patch turns executing a cancelled action into a no-op so one
 * leaked timer can no longer take down the run. See the comment in src/test.ts.
 */
describe('test harness: leaked rxjs scheduler action', () => {
  it('does not crash flush when a cancelled action fires after teardown', () => {
    const work = jasmine.createSpy('scheduledWork');
    // Long delay so the action is still pending when we cancel it; unsubscribe
    // clears the real interval, then we simulate the post-teardown timer fire.
    const action = asyncScheduler.schedule(work, 60_000);
    action.unsubscribe();

    expect(action.closed).toBe(true);
    const scheduler = asyncScheduler as unknown as { flush(action: unknown): void };
    expect(() => scheduler.flush(action)).not.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it('still executes a live (open) action normally', () => {
    const work = jasmine.createSpy('scheduledWork');
    const action = asyncScheduler.schedule(work, 60_000);

    const scheduler = asyncScheduler as unknown as { flush(action: unknown): void };
    expect(() => scheduler.flush(action)).not.toThrow();
    expect(work).toHaveBeenCalledTimes(1);

    action.unsubscribe();
  });
});
