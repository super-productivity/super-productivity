import { createPluginTimers } from './plugin-timers.util';

describe('createPluginTimers', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('runs timers normally until disposed', () => {
    const { timers } = createPluginTimers();
    const spy = jasmine.createSpy('cb');

    timers.setTimeout(spy, 10, 'arg');
    jasmine.clock().tick(10);

    expect(spy).toHaveBeenCalledOnceWith('arg');
  });

  it('cancels pending timeouts and intervals on dispose', () => {
    const { timers, dispose } = createPluginTimers();
    const timeoutSpy = jasmine.createSpy('timeout');
    const intervalSpy = jasmine.createSpy('interval');
    timers.setTimeout(timeoutSpy, 50);
    timers.setInterval(intervalSpy, 10);

    dispose();
    jasmine.clock().tick(100);

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it('schedules nothing after dispose', () => {
    const { timers, dispose } = createPluginTimers();
    const spy = jasmine.createSpy('cb');
    dispose();

    timers.setTimeout(spy, 10);
    timers.setInterval(spy, 10);
    jasmine.clock().tick(100);

    expect(spy).not.toHaveBeenCalled();
  });

  it('still runs string handlers like the native timers', () => {
    const { timers } = createPluginTimers();
    const g = globalThis as unknown as Record<string, number>;
    g['__pluginTimersSpec__'] = 0;

    timers.setTimeout('globalThis.__pluginTimersSpec__++', 10);
    timers.setInterval('globalThis.__pluginTimersSpec__++', 10);
    jasmine.clock().tick(20);

    expect(g['__pluginTimersSpec__']).toBe(3);
    delete g['__pluginTimersSpec__'];
  });

  it('lets the plugin clear its own timers', () => {
    const { timers } = createPluginTimers();
    const spy = jasmine.createSpy('cb');

    timers.clearInterval(timers.setInterval(spy, 10));
    timers.clearTimeout(timers.setTimeout(spy, 10));
    jasmine.clock().tick(100);

    expect(spy).not.toHaveBeenCalled();
  });
});
