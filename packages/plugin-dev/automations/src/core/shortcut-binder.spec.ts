import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginAPI } from '@super-productivity/plugin-api';
import { ShortcutBinder } from './shortcut-binder';
import { AutomationRule } from '../types';

const rule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'r1',
  name: 'Tag as urgent',
  trigger: { type: 'shortcut' },
  conditions: [],
  actions: [],
  isEnabled: true,
  ...overrides,
});

describe('ShortcutBinder', () => {
  let mockPlugin: PluginAPI;
  let onExec: (ruleId: string) => void;
  let binder: ShortcutBinder;

  beforeEach(() => {
    mockPlugin = {
      registerShortcut: vi.fn(),
      unregisterShortcut: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as PluginAPI;
    onExec = vi.fn();
    binder = new ShortcutBinder(mockPlugin, onExec);
  });

  it('registers one shortcut per enabled shortcut rule, keyed by rule id', () => {
    binder.sync([rule(), rule({ id: 'r2', name: 'Ping webhook' })]);

    expect(mockPlugin.registerShortcut).toHaveBeenCalledTimes(2);
    expect(mockPlugin.registerShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', label: 'Tag as urgent' }),
    );
    expect(mockPlugin.registerShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r2', label: 'Ping webhook' }),
    );
  });

  it('ignores rules with other triggers', () => {
    binder.sync([rule({ trigger: { type: 'taskCreated' } })]);

    expect(mockPlugin.registerShortcut).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder label for unnamed rules', () => {
    binder.sync([rule({ name: '  ' })]);

    expect(mockPlugin.registerShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Unnamed automation rule' }),
    );
  });

  it('runs the rule the pressed shortcut belongs to', () => {
    binder.sync([rule()]);

    const cfg = (mockPlugin.registerShortcut as any).mock.calls[0][0];
    cfg.onExec();

    expect(onExec).toHaveBeenCalledWith('r1');
  });

  it('does not re-register unchanged rules', () => {
    binder.sync([rule()]);
    binder.sync([rule()]);

    expect(mockPlugin.registerShortcut).toHaveBeenCalledTimes(1);
  });

  it('re-registers with the new label when a rule is renamed', () => {
    binder.sync([rule()]);
    binder.sync([rule({ name: 'Tag as later' })]);

    expect(mockPlugin.registerShortcut).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'r1', label: 'Tag as later' }),
    );
    expect(mockPlugin.unregisterShortcut).not.toHaveBeenCalled();
  });

  it('unregisters the shortcut of a deleted rule', () => {
    binder.sync([rule()]);
    binder.sync([]);

    expect(mockPlugin.unregisterShortcut).toHaveBeenCalledWith('r1');
  });

  it('releases the key of a disabled rule and takes it back when re-enabled', () => {
    binder.sync([rule()]);
    binder.sync([rule({ isEnabled: false })]);

    expect(mockPlugin.unregisterShortcut).toHaveBeenCalledWith('r1');

    binder.sync([rule()]);

    expect(mockPlugin.registerShortcut).toHaveBeenCalledTimes(2);
  });
});
