import { fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import {
  BeforeCloseCoordinator,
  PLUGIN_BEFORE_CLOSE_ID,
} from './before-close-coordinator';

describe('BeforeCloseCoordinator', () => {
  let port: { schedule: jasmine.Spy; unschedule: jasmine.Spy; done: jasmine.Spy };
  let coordinator: BeforeCloseCoordinator;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  beforeEach(() => {
    port = jasmine.createSpyObj('close port', ['schedule', 'unschedule', 'done']);
    coordinator = new BeforeCloseCoordinator(port);
  });

  it('waits for sync and exit confirmation before invoking a finalizer', async () => {
    const callback = jasmine.createSpy('cleanup').and.resolveTo();
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'sync', 'confirm'], () => {});
    await settle();
    expect(callback).not.toHaveBeenCalled();
    coordinator.done('sync');
    await settle();
    expect(callback).not.toHaveBeenCalled();
    coordinator.done('confirm');
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(port.done.calls.allArgs()).toEqual([
      ['sync'],
      ['confirm'],
      [PLUGIN_BEFORE_CLOSE_ID],
    ]);
  });

  it('does not run after cancelled confirmation, but accepts a later exit attempt', async () => {
    const callback = jasmine.createSpy('cleanup').and.resolveTo();
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'confirm'], () => {});
    coordinator.cancelCloseAttempt();
    await settle();
    expect(callback).not.toHaveBeenCalled();
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'confirm'], () =>
      coordinator.done('confirm'),
    );
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not revive a cancelled attempt after an ordinary participant is unscheduled', async () => {
    const callback = jasmine.createSpy('cleanup').and.resolveTo();
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'confirm'], () => {});
    coordinator.cancelCloseAttempt();
    coordinator.unscheduled('confirm');
    await settle();
    expect(callback).not.toHaveBeenCalled();
    expect(port.done).not.toHaveBeenCalled();
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('does not acknowledge a cancelled running finalizer or let it acknowledge a new attempt', async () => {
    let firstSignal!: AbortSignal;
    let finish!: () => void;
    let calls = 0;
    coordinator.register('plugin/background', ({ signal }) => {
      calls++;
      if (calls === 1) {
        firstSignal = signal;
        return new Promise<void>(() => {});
      }
      return new Promise<void>((resolve) => (finish = resolve));
    });
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    coordinator.cancelCloseAttempt();
    expect(firstSignal.aborted).toBeTrue();
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    expect(calls).toBe(2);
    expect(port.done).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('captures synchronous acknowledgements before broadcasting the close request', async () => {
    const callback = jasmine.createSpy('cleanup').and.resolveTo();
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'confirm'], () =>
      coordinator.done('confirm'),
    );
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(port.done).toHaveBeenCalledWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('aborts and releases a never-settling callback after the shared 15 second deadline', fakeAsync(() => {
    let signal!: AbortSignal;
    let deadlineAt = 0;
    coordinator.register('plugin/background', (context) => {
      signal = context.signal;
      deadlineAt = context.deadlineAt;
      return new Promise<void>(() => {});
    });
    const startedAt = Date.now();
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => fail('no ordinary participants'));
    flushMicrotasks();
    expect(deadlineAt).toBe(startedAt + 15_000);
    expect(signal.aborted).toBeFalse();
    tick(14_999);
    expect(port.done).not.toHaveBeenCalled();
    tick(1);
    expect(signal.aborted).toBeTrue();
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  }));

  it('releases a rejected callback and aborts its signal', async () => {
    let signal!: AbortSignal;
    coordinator.register('plugin/background', (context) => {
      signal = context.signal;
      return Promise.reject(new Error('network unavailable'));
    });
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    expect(signal.aborted).toBeTrue();
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('does not duplicate a callback when exit is requested again during cleanup', async () => {
    let finish!: () => void;
    const callback = jasmine
      .createSpy('cleanup')
      .and.returnValue(new Promise<void>((resolve) => (finish = resolve)));
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('unregisters a waiting finalizer without leaving the native close blocked', async () => {
    const callback = jasmine.createSpy('cleanup');
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'confirm'], () => {});
    coordinator.register('plugin/background', null);
    coordinator.done('confirm');
    await settle();
    expect(callback).not.toHaveBeenCalled();
    expect(port.done.calls.allArgs()).toEqual([[PLUGIN_BEFORE_CLOSE_ID], ['confirm']]);
  });

  it('aborts a removed running callback without awaiting its dead promise', async () => {
    let signal!: AbortSignal;
    coordinator.register('plugin\0background', (context) => {
      signal = context.signal;
      return new Promise<void>(() => {});
    });
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID], () => {});
    await settle();
    coordinator.unregisterPlugin('plugin');
    await settle();
    expect(signal.aborted).toBeTrue();
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('registers one native participant for multiple callbacks and removes it when unused', () => {
    coordinator.register('a', () => {});
    coordinator.register('b', () => {});
    coordinator.register('a', null);
    expect(port.schedule).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
    expect(port.unschedule).not.toHaveBeenCalled();
    coordinator.register('b', null);
    expect(port.unschedule).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });

  it('does not wait for an ordinary participant that has been unscheduled', async () => {
    const callback = jasmine.createSpy('cleanup').and.resolveTo();
    coordinator.register('plugin/background', callback);
    coordinator.request([PLUGIN_BEFORE_CLOSE_ID, 'sync'], () => {});
    coordinator.unscheduled('sync');
    await settle();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(port.done).toHaveBeenCalledOnceWith(PLUGIN_BEFORE_CLOSE_ID);
  });
});
