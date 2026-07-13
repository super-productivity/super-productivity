import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleRegistry } from './rule-registry';
import { PluginAPI } from '@super-productivity/plugin-api';
import { AutomationRule } from '../types';

describe('RuleRegistry', () => {
  let registry: RuleRegistry;
  let mockPlugin: PluginAPI;
  let loadSyncedDataMock: ReturnType<typeof vi.fn<PluginAPI['loadSyncedData']>>;
  let persistDataSyncedMock: ReturnType<typeof vi.fn<PluginAPI['persistDataSynced']>>;

  beforeEach(() => {
    loadSyncedDataMock = vi.fn<PluginAPI['loadSyncedData']>().mockResolvedValue(null);
    persistDataSyncedMock = vi.fn<PluginAPI['persistDataSynced']>().mockResolvedValue();
    mockPlugin = {
      loadSyncedData: loadSyncedDataMock,
      persistDataSynced: persistDataSyncedMock,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as PluginAPI;
  });

  it('loads empty rules without persisting defaults when synced data is missing', async () => {
    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([]);
    expect(registry.getInitializationError()).toBeNull();
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('does not persist empty rules when loading synced data fails', async () => {
    const loadError = new Error('Temporary load failure');
    loadSyncedDataMock.mockRejectedValue(loadError);

    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([]);
    expect(registry.getInitializationError()).toBe(loadError);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('does not persist empty rules when synced JSON is corrupted', async () => {
    loadSyncedDataMock.mockResolvedValue('{not valid json');

    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([]);
    expect(registry.getInitializationError()?.message).toBe('Corrupted JSON in automation rules');
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('does not persist empty rules when synced JSON has an invalid root value', async () => {
    loadSyncedDataMock.mockResolvedValue(JSON.stringify({ rules: [] }));

    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([]);
    expect(registry.getInitializationError()?.message).toBe(
      'Persisted automation rules are invalid',
    );
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('loads known rules and preserves unsupported or malformed entries on explicit edits', async () => {
    const knownRule: AutomationRule = {
      id: 'known',
      name: 'Known rule',
      isEnabled: true,
      trigger: { type: 'taskCompleted' },
      conditions: [],
      actions: [],
    };
    const unsupportedRules = [
      {
        id: 'future-trigger',
        name: 'Future trigger',
        isEnabled: true,
        trigger: { type: 'projectArchived' },
        conditions: [],
        actions: [],
      },
      {
        id: 'future-condition',
        name: 'Future condition',
        isEnabled: true,
        trigger: { type: 'taskUpdated' },
        conditions: [{ type: 'projectHasLabel', value: 'important' }],
        actions: [],
      },
      {
        id: 'future-action',
        name: 'Future action',
        isEnabled: true,
        trigger: { type: 'taskCreated' },
        conditions: [],
        actions: [{ type: 'archiveTask', value: '' }],
      },
    ];
    const malformedEntry = { id: 'malformed', name: 42 };
    const persistedEntries = [
      unsupportedRules[0],
      knownRule,
      malformedEntry,
      unsupportedRules[1],
      unsupportedRules[2],
    ];
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(persistedEntries));
    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([knownRule]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();

    const addedRule: AutomationRule = {
      id: 'added',
      name: 'Added rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    await registry.addOrUpdateRule(addedRule);

    expect(persistDataSyncedMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(persistDataSyncedMock.mock.calls[0][0])).toEqual([
      ...persistedEntries,
      addedRule,
    ]);
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
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(rules));

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
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(rules));

    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    expect(await registry.getRules()).toEqual(rules);
  });

  it('should load rules with taskStarted/taskStopped triggers and removeTag action', async () => {
    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'Tag while running',
        isEnabled: true,
        trigger: { type: 'taskStarted' },
        conditions: [],
        actions: [{ type: 'addTag', value: 'in-progress' }],
      },
      {
        id: 'r2',
        name: 'Untag when stopped',
        isEnabled: true,
        trigger: { type: 'taskStopped' },
        conditions: [],
        actions: [{ type: 'removeTag', value: 'in-progress' }],
      },
    ];
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(rules));

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
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(rules));

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

  it('addRules persists every rule with a single persistDataSynced call', async () => {
    const unsupportedRule = {
      id: 'future-action',
      name: 'Future action',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [{ type: 'archiveTask', value: '' }],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([unsupportedRule]));
    registry = new RuleRegistry(mockPlugin);

    const rules: AutomationRule[] = [
      {
        id: 'r1',
        name: 'A',
        isEnabled: true,
        trigger: { type: 'taskStarted' },
        conditions: [],
        actions: [{ type: 'addTag', value: 'in-progress' }],
      },
      {
        id: 'r2',
        name: 'B',
        isEnabled: true,
        trigger: { type: 'taskStopped' },
        conditions: [],
        actions: [{ type: 'removeTag', value: 'in-progress' }],
      },
    ];

    expect(persistDataSyncedMock).not.toHaveBeenCalled();

    await registry.addRules(rules);

    // Exactly one persist for the whole batch — no rate-limit risk.
    expect(persistDataSyncedMock).toHaveBeenCalledTimes(1);
    expect(await registry.getRules()).toEqual(rules);
    expect(JSON.parse(persistDataSyncedMock.mock.calls[0][0])).toEqual([unsupportedRule, ...rules]);
  });

  it('addRules is a no-op for an empty array', async () => {
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);
    const before = persistDataSyncedMock.mock.calls.length;

    await registry.addRules([]);

    expect(persistDataSyncedMock.mock.calls.length).toBe(before);
  });

  it('rejects a malformed batch atomically and accepts a later valid save', async () => {
    const validRule: AutomationRule = {
      id: 'valid',
      name: 'Valid rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    const laterRule: AutomationRule = {
      ...validRule,
      id: 'later',
      name: 'Later rule',
    };
    registry = new RuleRegistry(mockPlugin);

    await expect(
      registry.addRules([validRule, null] as unknown as AutomationRule[]),
    ).rejects.toThrow('Invalid automation rules');

    expect(await registry.getRules()).toEqual([]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();

    await registry.addOrUpdateRule(laterRule);

    expect(await registry.getRules()).toEqual([laterRule]);
    expect(persistDataSyncedMock).toHaveBeenCalledWith(JSON.stringify([laterRule]));
  });

  it('rolls back a failed persistence and keeps the queue usable', async () => {
    const failedRule: AutomationRule = {
      id: 'failed',
      name: 'Failed rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    const savedRule: AutomationRule = {
      ...failedRule,
      id: 'saved',
      name: 'Saved rule',
    };
    persistDataSyncedMock
      .mockRejectedValueOnce(new Error('Temporary persistence failure'))
      .mockResolvedValueOnce();
    registry = new RuleRegistry(mockPlugin);

    await expect(registry.addOrUpdateRule(failedRule)).rejects.toThrow(
      'Temporary persistence failure',
    );
    expect(await registry.getRules()).toEqual([]);

    await registry.addOrUpdateRule(savedRule);

    expect(await registry.getRules()).toEqual([savedRule]);
    expect(persistDataSyncedMock.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      [failedRule],
      [savedRule],
    ]);
  });

  it('persists concurrent mutations in invocation order', async () => {
    const firstRule: AutomationRule = {
      id: 'first',
      name: 'First rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    const secondRule: AutomationRule = {
      ...firstRule,
      id: 'second',
      name: 'Second rule',
    };
    let resolveFirstPersist: () => void = () => undefined;
    persistDataSyncedMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstPersist = resolve;
          }),
      )
      .mockResolvedValueOnce();
    registry = new RuleRegistry(mockPlugin);

    const firstMutation = registry.addOrUpdateRule(firstRule);
    await vi.waitFor(() => expect(persistDataSyncedMock).toHaveBeenCalledTimes(1));
    const secondMutation = registry.addOrUpdateRule(secondRule);

    expect(persistDataSyncedMock).toHaveBeenCalledTimes(1);
    resolveFirstPersist();
    await Promise.all([firstMutation, secondMutation]);

    expect(persistDataSyncedMock.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      [firstRule],
      [firstRule, secondRule],
    ]);
  });

  it('blocks mutations after an initialization error to avoid overwriting synced data', async () => {
    const rule: AutomationRule = {
      id: 'new',
      name: 'New rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockRejectedValue(new Error('Temporary load failure'));
    registry = new RuleRegistry(mockPlugin);

    await expect(registry.addOrUpdateRule(rule)).rejects.toThrow(
      'Automation rules failed to initialize',
    );

    expect(await registry.getRules()).toEqual([]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('canonicalizes valid mutation payloads before storing or persisting them', async () => {
    const expectedRule: AutomationRule = {
      id: 'safe',
      name: 'Safe rule',
      isEnabled: true,
      trigger: { type: 'taskUpdated' },
      conditions: [{ type: 'titleContains', value: 'test' }],
      actions: [{ type: 'displaySnack', value: 'Matched' }],
    };
    const messagePayload: Record<string, unknown> = { ...expectedRule };
    messagePayload.unsupported = messagePayload;
    registry = new RuleRegistry(mockPlugin);

    await registry.addOrUpdateRule(messagePayload as unknown as AutomationRule);

    expect(await registry.getRules()).toEqual([expectedRule]);
    expect(persistDataSyncedMock).toHaveBeenCalledWith(JSON.stringify([expectedRule]));
  });

  it('rejects unsupported rule discriminators received through mutation messages', async () => {
    const unsupportedRule = {
      id: 'future',
      name: 'Future rule',
      isEnabled: true,
      trigger: { type: 'projectArchived' },
      conditions: [],
      actions: [],
    };
    registry = new RuleRegistry(mockPlugin);

    await expect(
      registry.addOrUpdateRule(unsupportedRule as unknown as AutomationRule),
    ).rejects.toThrow('Invalid automation rule');

    expect(await registry.getRules()).toEqual([]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('rejects invalid toggle payloads without mutating or persisting rules', async () => {
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([rule]));
    registry = new RuleRegistry(mockPlugin);

    await expect(registry.toggleRuleStatus(rule.id, 'false' as unknown as boolean)).rejects.toThrow(
      'Invalid automation rule status',
    );

    expect(await registry.getRules()).toEqual([rule]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('keeps time-based rules without a value opaque and unexecutable', async () => {
    const incompleteTimeRule = {
      id: 'incomplete-time',
      name: 'Incomplete time rule',
      isEnabled: true,
      trigger: { type: 'timeBased' },
      conditions: [],
      actions: [],
    };
    const validRule: AutomationRule = {
      id: 'valid',
      name: 'Valid rule',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([incompleteTimeRule, validRule]));
    registry = new RuleRegistry(mockPlugin);

    expect(await registry.getRules()).toEqual([validRule]);
    expect(persistDataSyncedMock).not.toHaveBeenCalled();
  });

  it('should update existing rule', async () => {
    const unsupportedRule = {
      id: 'future-trigger',
      name: 'Future trigger',
      isEnabled: true,
      trigger: { type: 'projectArchived' },
      conditions: [],
      actions: [],
    };
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([unsupportedRule, rule]));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    const updatedRule = { ...rule, name: 'Updated Rule' };
    await registry.addOrUpdateRule(updatedRule);

    const rules = await registry.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Updated Rule');
    expect(JSON.parse(persistDataSyncedMock.mock.calls[0][0])).toEqual([
      unsupportedRule,
      updatedRule,
    ]);
  });

  it('should delete rule', async () => {
    const unsupportedRule = {
      id: 'future-action',
      name: 'Future action',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [{ type: 'archiveTask', value: '' }],
    };
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([unsupportedRule, rule]));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    await registry.deleteRule('r1');
    expect(await registry.getRules()).toHaveLength(0);
    expect(mockPlugin.persistDataSynced).toHaveBeenCalledWith(JSON.stringify([unsupportedRule]));
  });

  it('should toggle a known rule without deleting unsupported rules', async () => {
    const unsupportedRule = {
      id: 'future-condition',
      name: 'Future condition',
      isEnabled: true,
      trigger: { type: 'taskUpdated' },
      conditions: [{ type: 'projectHasLabel', value: 'important' }],
      actions: [],
    };
    const rule: AutomationRule = {
      id: 'r1',
      name: 'Rule 1',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    };
    loadSyncedDataMock.mockResolvedValue(JSON.stringify([unsupportedRule, rule]));
    registry = new RuleRegistry(mockPlugin);

    await registry.toggleRuleStatus(rule.id, false);

    expect(await registry.getRules()).toEqual([{ ...rule, isEnabled: false }]);
    expect(JSON.parse(persistDataSyncedMock.mock.calls[0][0])).toEqual([
      unsupportedRule,
      { ...rule, isEnabled: false },
    ]);
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
    loadSyncedDataMock.mockResolvedValue(JSON.stringify(rules));
    registry = new RuleRegistry(mockPlugin);
    await new Promise(process.nextTick);

    const enabledRules = await registry.getEnabledRules();
    expect(enabledRules).toHaveLength(1);
    expect(enabledRules[0].id).toBe('r1');
  });
});
