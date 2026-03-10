import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleRegistry } from './rule-registry';
import { PluginAPI } from '@super-productivity/plugin-api';
import { AutomationRule } from '../types';

describe('RuleRegistry', () => {
  let registry: RuleRegistry;
  let mockPlugin: PluginAPI;

  beforeEach(() => {
    mockPlugin = {
      loadSyncedData: vi.fn().mockResolvedValue(null),
      persistDataSynced: vi.fn(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as PluginAPI;
  });

  it('should load empty rules initially', async () => {
    registry = new RuleRegistry(mockPlugin);
    // Wait for async load in constructor (implementation detail: constructor is sync but calls async load)
    // Ideally RuleRegistry should expose an init method, or we wait.
    // Since loadRules is called in constructor without await, we need to wait for promises.
    await new Promise(process.nextTick);

    expect(await registry.getRules()).toEqual([]);
    expect(registry.getInitializationError()).toBeNull();
  });

  it('should load existing rules', async () => {
    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'Rule 1',
        isEnabled: true,
        trigger: { type: 'taskCompleted' },
        conditions: [],
        actions: [],
      },
    ];
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify(rules));

    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    expect(await registry.getRules()).toEqual(rules);
  });

  it('should load existing rules with regex-enabled conditions', async () => {
    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'Rule 1',
        isEnabled: true,
        trigger: { type: 'taskCompleted' },
        conditions: [{ type: 'titleContains', value: '^bug', isRegex: true }],
        actions: [],
      },
    ];
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify(rules));

    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    expect(await registry.getRules()).toEqual(rules);
  });

  it('should load existing rules with deleteTask actions', async () => {
    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'Delete completed task',
        isEnabled: true,
        trigger: { type: 'taskCompleted' },
        conditions: [],
        actions: [{ type: 'deleteTask', value: '' }],
      },
    ];
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify(rules));

    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    expect(await registry.getRules()).toEqual(rules);
  });

  it('should add rule and persist', async () => {
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    const newRule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };

    await registry.addOrUpdateRule(newRule);

    expect(await registry.getRules()).toContainEqual(newRule);
    expect(mockPlugin.persistDataSynced).toHaveBeenCalledWith(JSON.stringify([newRule]));
  });

  it('should update existing rule', async () => {
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify([rule]));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    const updatedRule = { ...rule, name: 'Updated Rule' };
    await registry.addOrUpdateRule(updatedRule);

    const rules = await registry.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Updated Rule');
  });

  it('should delete rule', async () => {
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify([rule]));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    await registry.deleteRule('r1');
    expect(await registry.getRules()).toHaveLength(0);
    expect(mockPlugin.persistDataSynced).toHaveBeenCalledWith(JSON.stringify([]));
  });

  it('should get only enabled rules', async () => {
    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'R1',
        isEnabled: true,
        trigger: { type: 'taskCompleted' },
        conditions: [],
        actions: [],
      },
      {
        id: 'r2',
        name: 'R2',
        isEnabled: false,
        trigger: { type: 'taskCompleted' },
        conditions: [],
        actions: [],
      },
    ];
    (mockPlugin.loadSyncedData as any).mockResolvedValue(JSON.stringify(rules));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    const enabledRules = await registry.getEnabledRules();
    expect(enabledRules).toHaveLength(1);
    expect(enabledRules[0].id).toBe('r1');
  });
});
