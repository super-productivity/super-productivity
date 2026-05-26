import { PluginHooks } from '@super-productivity/plugin-api';
import { PluginHooksService } from './plugin-hooks';
import { PluginLog } from '../core/log';

describe('PluginHooksService.dispatchHookToPlugin', () => {
  let service: PluginHooksService;
  let logErrSpy: jasmine.Spy;

  beforeEach(() => {
    service = new PluginHooksService();
    logErrSpy = spyOn(PluginLog, 'err');
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

  it('swallows synchronously-thrown handler errors and logs them', async () => {
    const throwing = jasmine
      .createSpy('throwing')
      .and.throwError(new Error('boom from plugin'));
    service.registerHookHandler('bad', PluginHooks.PERSISTED_DATA_CHANGED, throwing);

    await expectAsync(
      service.dispatchHookToPlugin('bad', PluginHooks.PERSISTED_DATA_CHANGED),
    ).toBeResolved();
    expect(throwing).toHaveBeenCalledTimes(1);
    // Pin the error-swallow branch so a future refactor that drops the
    // try/catch surfaces as a spec failure rather than a silent regression.
    expect(logErrSpy).toHaveBeenCalledTimes(1);
    expect(logErrSpy.calls.mostRecent().args[0]).toContain(
      'Plugin bad persistedDataChanged handler error',
    );
  });

  it('swallows async-rejected handler promises and logs them', async () => {
    const rejecting = jasmine
      .createSpy('rejecting')
      .and.returnValue(Promise.reject(new Error('async boom')));
    service.registerHookHandler(
      'async-bad',
      PluginHooks.PERSISTED_DATA_CHANGED,
      rejecting,
    );

    await expectAsync(
      service.dispatchHookToPlugin('async-bad', PluginHooks.PERSISTED_DATA_CHANGED),
    ).toBeResolved();
    expect(rejecting).toHaveBeenCalledTimes(1);
    expect(logErrSpy).toHaveBeenCalledTimes(1);
  });

  it('times out a stuck handler at HOOK_TIMEOUT_MS and logs the timeout', async () => {
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
      // Without this assertion the spec would silently pass even if the
      // timeout race were removed entirely (dispatcher always resolves).
      expect(logErrSpy).toHaveBeenCalledTimes(1);
      const [msg, err] = logErrSpy.calls.mostRecent().args;
      expect(msg).toContain('Plugin hang persistedDataChanged handler error');
      expect((err as Error).message).toBe('Hook handler timed out');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('refuses to register handlers under pluginIds containing ":"', () => {
    // Defense-in-depth: composeId already throws on colon-bearing pluginIds at
    // the persistence boundary, but the hooks Map is independently callable —
    // and the persistence boundary cleared the only programmatic path that
    // would have validated. A handler registered as 'victim:doc' would never
    // fire today (the differ collapses to bare owner), but the invariant is
    // worth pinning here so a future shape change can't reopen the gap.
    const handler = jasmine.createSpy('handler');
    expect(() =>
      service.registerHookHandler(
        'victim:doc',
        PluginHooks.PERSISTED_DATA_CHANGED,
        handler,
      ),
    ).toThrowError(/must not contain ':'/);
  });

  it('fires every handler when a plugin registers more than once for the same hook', async () => {
    // document-mode registers from both its background script and its iframe
    // editor under the same pluginId — pre-fix the second registration
    // silently overwrote the first, so iframe registration permanently
    // shadowed background's enabledIds-reconcile handler.
    const bgHandler = jasmine.createSpy('bgHandler');
    const iframeHandler = jasmine.createSpy('iframeHandler');
    service.registerHookHandler(
      'document-mode',
      PluginHooks.PERSISTED_DATA_CHANGED,
      bgHandler,
    );
    service.registerHookHandler(
      'document-mode',
      PluginHooks.PERSISTED_DATA_CHANGED,
      iframeHandler,
    );

    await service.dispatchHookToPlugin(
      'document-mode',
      PluginHooks.PERSISTED_DATA_CHANGED,
    );

    expect(bgHandler).toHaveBeenCalledTimes(1);
    expect(iframeHandler).toHaveBeenCalledTimes(1);
  });

  it('unregisterPluginHooks drops every handler for that plugin across all hooks', () => {
    const dataChanged = jasmine.createSpy('dataChanged');
    const dataChanged2 = jasmine.createSpy('dataChanged2');
    const taskComplete = jasmine.createSpy('taskComplete');
    const otherPlugin = jasmine.createSpy('otherPlugin');

    service.registerHookHandler(
      'document-mode',
      PluginHooks.PERSISTED_DATA_CHANGED,
      dataChanged,
    );
    service.registerHookHandler(
      'document-mode',
      PluginHooks.PERSISTED_DATA_CHANGED,
      dataChanged2,
    );
    service.registerHookHandler('document-mode', PluginHooks.TASK_COMPLETE, taskComplete);
    // Sibling plugin's handler must survive a teardown targeting document-mode.
    service.registerHookHandler('other', PluginHooks.TASK_COMPLETE, otherPlugin);

    service.unregisterPluginHooks('document-mode');

    return Promise.all([
      service.dispatchHookToPlugin('document-mode', PluginHooks.PERSISTED_DATA_CHANGED),
      service.dispatchHook(PluginHooks.TASK_COMPLETE),
    ]).then(() => {
      expect(dataChanged).not.toHaveBeenCalled();
      expect(dataChanged2).not.toHaveBeenCalled();
      expect(taskComplete).not.toHaveBeenCalled();
      expect(otherPlugin).toHaveBeenCalledTimes(1);
    });
  });

  it('dispatchHook fan-out fires every handler from every plugin', async () => {
    const aH1 = jasmine.createSpy('aH1');
    const aH2 = jasmine.createSpy('aH2');
    const bH = jasmine.createSpy('bH');
    service.registerHookHandler('plugin-a', PluginHooks.TASK_COMPLETE, aH1);
    service.registerHookHandler('plugin-a', PluginHooks.TASK_COMPLETE, aH2);
    service.registerHookHandler('plugin-b', PluginHooks.TASK_COMPLETE, bH);

    await service.dispatchHook(PluginHooks.TASK_COMPLETE);

    expect(aH1).toHaveBeenCalledTimes(1);
    expect(aH2).toHaveBeenCalledTimes(1);
    expect(bH).toHaveBeenCalledTimes(1);
  });
});
