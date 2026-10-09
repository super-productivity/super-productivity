import { describe, it, expect, vi } from 'vitest';
import { PluginAPI } from '@super-productivity/plugin-api';
import { RuleRegistry } from './core/rule-registry';

describe('plugin', () => {
  it('stops checking time-based rules once the plugin unloads', async () => {
    vi.useFakeTimers();
    const getEnabledRules = vi.spyOn(RuleRegistry.prototype, 'getEnabledRules');
    let unload: (() => void | Promise<void>) | undefined;
    (globalThis as unknown as { plugin: PluginAPI }).plugin = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerHook: vi.fn(),
      loadSyncedData: vi.fn().mockResolvedValue(null),
      onUnload: (fn: () => void | Promise<void>) => (unload = fn),
    } as unknown as PluginAPI;

    await import('./plugin');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getEnabledRules).toHaveBeenCalledTimes(1);

    await unload?.();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getEnabledRules).toHaveBeenCalledTimes(1);
  });
});
