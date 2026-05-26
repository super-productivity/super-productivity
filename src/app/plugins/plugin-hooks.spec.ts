import { PluginHooks } from '@super-productivity/plugin-api';
import { PluginHooksService } from './plugin-hooks';

describe('PluginHooksService.dispatchHookToPlugin', () => {
  let service: PluginHooksService;

  beforeEach(() => {
    service = new PluginHooksService();
  });

  it('invokes only the targeted plugin handler and is a no-op for unregistered ids', async () => {
    const handlerA = jasmine.createSpy('handlerA');
    const handlerB = jasmine.createSpy('handlerB');
    service.registerHookHandler('plugin-a', PluginHooks.PERSISTED_DATA_CHANGED, handlerA);
    service.registerHookHandler('plugin-b', PluginHooks.PERSISTED_DATA_CHANGED, handlerB);

    await service.dispatchHookToPlugin('plugin-a', PluginHooks.PERSISTED_DATA_CHANGED);

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();

    // Unregistered pluginId — must not throw or affect existing handlers.
    await expectAsync(
      service.dispatchHookToPlugin('plugin-nope', PluginHooks.PERSISTED_DATA_CHANGED),
    ).toBeResolved();
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('swallows handler errors so one plugin can not break another', async () => {
    const throwing = jasmine
      .createSpy('throwing')
      .and.throwError(new Error('boom from plugin'));
    service.registerHookHandler('bad', PluginHooks.PERSISTED_DATA_CHANGED, throwing);

    await expectAsync(
      service.dispatchHookToPlugin('bad', PluginHooks.PERSISTED_DATA_CHANGED),
    ).toBeResolved();
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it('times out a stuck handler instead of blocking indefinitely', async () => {
    jasmine.clock().install();
    try {
      const stuck = jasmine
        .createSpy('stuck')
        .and.returnValue(new Promise<void>(() => {}));
      service.registerHookHandler('hang', PluginHooks.PERSISTED_DATA_CHANGED, stuck);

      const dispatch = service.dispatchHookToPlugin(
        'hang',
        PluginHooks.PERSISTED_DATA_CHANGED,
      );
      // Trip the 5s timeout race.
      jasmine.clock().tick(6000);
      await expectAsync(dispatch).toBeResolved();
      expect(stuck).toHaveBeenCalledTimes(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
