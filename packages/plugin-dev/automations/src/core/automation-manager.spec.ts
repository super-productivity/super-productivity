import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { AutomationManager } from './automation-manager';
import { PluginAPI } from '@super-productivity/plugin-api';
import { RuleRegistry } from './rule-registry';
import { ConditionEvaluator } from './condition-evaluator';
import { ActionExecutor } from './action-executor';
import { RateLimiter } from './rate-limiter';
import { globalRegistry } from './registry';
import { AutomationRule, TaskEvent } from '../types';
import { DataCache } from './data-cache';

// Mock dependencies
vi.mock('./rule-registry', () => ({
  RuleRegistry: vi.fn(),
}));
vi.mock('./condition-evaluator', () => ({
  ConditionEvaluator: vi.fn(),
}));
vi.mock('./action-executor', () => ({
  ActionExecutor: vi.fn(),
}));
vi.mock('./rate-limiter', () => ({
  RateLimiter: vi.fn(),
}));
vi.mock('./data-cache', () => ({
  DataCache: vi.fn(),
}));
vi.mock('./registry', async () => {
  const actual = await vi.importActual<typeof import('./registry')>('./registry');
  return {
    ...actual,
    globalRegistry: {
      ...actual.globalRegistry,
      getTrigger: vi.fn(),
      registerTrigger: vi.fn(),
      registerCondition: vi.fn(),
      registerAction: vi.fn(),
    },
  };
});

describe('AutomationManager', () => {
  let manager: AutomationManager;
  let mockPlugin: PluginAPI;

  // Mock instances
  let mockRuleRegistry: any;
  let mockConditionEvaluator: any;
  let mockActionExecutor: any;
  let mockRateLimiter: any;
  let mockDataCache: any;

  beforeEach(() => {
    mockPlugin = {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      openDialog: vi.fn(),
      showSnack: vi.fn(),
      getFocusedTask: vi.fn().mockResolvedValue(null),
      registerShortcut: vi.fn(),
      unregisterShortcut: vi.fn(),
    } as unknown as PluginAPI;

    // Setup mocks
    mockRuleRegistry = {
      getRules: vi.fn().mockResolvedValue([]),
      getEnabledRules: vi.fn().mockResolvedValue([]),
      addOrUpdateRule: vi.fn(),
      addRules: vi.fn(),
      deleteRule: vi.fn(),
      toggleRuleStatus: vi.fn(),
    };
    (RuleRegistry as unknown as Mock).mockImplementation(function () {
      return mockRuleRegistry;
    });

    mockConditionEvaluator = {
      allConditionsMatch: vi.fn().mockResolvedValue(true),
    };
    (ConditionEvaluator as unknown as Mock).mockImplementation(function () {
      return mockConditionEvaluator;
    });

    mockActionExecutor = {
      executeAll: vi.fn(),
    };
    (ActionExecutor as unknown as Mock).mockImplementation(function () {
      return mockActionExecutor;
    });

    mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
      reset: vi.fn(),
    };
    (RateLimiter as unknown as Mock).mockImplementation(function () {
      return mockRateLimiter;
    });

    mockDataCache = {
      getProjects: vi.fn(),
      getTags: vi.fn(),
    };
    (DataCache as unknown as Mock).mockImplementation(function () {
      return mockDataCache;
    });

    manager = new AutomationManager(mockPlugin);
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
    vi.clearAllMocks();
  });

  describe('onTaskEvent', () => {
    it('should match a taskCreated event with a titleStartsWith condition', async () => {
      // 1. Setup Rule
      const rule = {
        id: 'r1',
        name: 'Move Rule',
        trigger: { type: 'taskCreated' },
        conditions: [{ type: 'titleStartsWith', value: 'MoveMe' }],
        actions: [{ type: 'moveToProject', value: 'Project B' }],
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);

      // 2. Setup trigger mock
      const mockTrigger = { matches: vi.fn().mockImplementation((e) => e.type === 'taskCreated') };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      // 3. Setup condition evaluator mock (real behavior)
      mockConditionEvaluator.allConditionsMatch.mockImplementation(
        async (conditions: any, event: any) => {
          for (const cond of conditions) {
            if (cond.type === 'titleStartsWith') {
              if (!event.task?.title.toLowerCase().startsWith(cond.value.toLowerCase()))
                return false;
            }
          }
          return true;
        },
      );

      // 4. Fire event
      const event = { type: 'taskCreated', task: { id: 't1', title: 'MoveMe task' } } as TaskEvent;
      await manager.onTaskEvent(event);

      // 5. Verify action called
      expect(mockActionExecutor.executeAll).toHaveBeenCalledWith(rule.actions, event);
    });

    it('should not match a taskCreated rule on taskUpdated event after creation', async () => {
      const rule = {
        id: 'r1',
        name: 'Move Rule',
        trigger: { type: 'taskCreated' },
        conditions: [{ type: 'titleStartsWith', value: 'MoveMe' }],
        actions: [{ type: 'moveToProject', value: 'Project B' }],
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);

      const mockTrigger = { matches: vi.fn().mockImplementation((e) => e.type === 'taskCreated') };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      mockConditionEvaluator.allConditionsMatch.mockImplementation(
        async (_conditions: any, event: any) => {
          return event.task?.title.startsWith('MoveMe');
        },
      );

      const event1 = { type: 'taskCreated', task: { id: 't1', title: '' } } as TaskEvent;
      await manager.onTaskEvent(event1);
      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();

      const event2 = {
        type: 'taskUpdated',
        task: { id: 't1', title: 'MoveMe task' },
        changes: { title: 'MoveMe task' },
      } as TaskEvent;
      await manager.onTaskEvent(event2);

      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();
    });

    it('should match a taskUpdated event with a taskUpdated trigger', async () => {
      // 1. Setup Rule with taskUpdated trigger
      const rule = {
        id: 'r1',
        name: 'Update Rule',
        trigger: { type: 'taskUpdated' },
        conditions: [{ type: 'titleStartsWith', value: 'UpdateMe' }],
        actions: [{ type: 'moveToProject', value: 'Project B' }],
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);

      // 2. Setup trigger mock
      const mockTrigger = {
        matches: vi.fn().mockImplementation((e) => e.type === 'taskUpdated'),
      };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      // 3. Setup condition evaluator mock
      mockConditionEvaluator.allConditionsMatch.mockImplementation(
        async (conditions: any, event: any) => {
          return event.task?.title.startsWith('UpdateMe');
        },
      );

      // 4. Fire taskUpdated event
      const event = {
        type: 'taskUpdated',
        task: { id: 't1', title: 'UpdateMe task' },
      } as TaskEvent;
      await manager.onTaskEvent(event);

      // 5. Verify action called
      expect(mockActionExecutor.executeAll).toHaveBeenCalledWith(rule.actions, event);
    });

    it('should warn if event has no task', async () => {
      await manager.onTaskEvent({ type: 'taskCreated' } as TaskEvent);
      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('without task data'),
      );
    });

    it('should process matching rules', async () => {
      const rule = {
        id: 'r1',
        name: 'Rule 1',
        trigger: { type: 'taskCompleted' },
        conditions: [],
        actions: [],
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);

      const mockTrigger = { matches: vi.fn().mockReturnValue(true) };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      const event = { type: 'taskCompleted', task: { title: 'Done' } } as TaskEvent;

      await manager.onTaskEvent(event);

      expect(mockTrigger.matches).toHaveBeenCalled();
      expect(mockConditionEvaluator.allConditionsMatch).toHaveBeenCalled();
      expect(mockRateLimiter.check).toHaveBeenCalledWith('r1');
      expect(mockActionExecutor.executeAll).toHaveBeenCalled();
    });

    it('should skip if trigger does not match', async () => {
      const rule = {
        id: 'r1',
        trigger: { type: 'taskCreated' }, // Different trigger
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);
      const mockTrigger = { matches: vi.fn().mockReturnValue(false) };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      const event = { type: 'taskCompleted', task: { title: 'Done' } } as TaskEvent;

      await manager.onTaskEvent(event);

      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();
    });

    it('should handle rate limiting', async () => {
      const rule = {
        id: 'r1',
        name: 'Loop Rule',
        trigger: { type: 'taskCompleted' },
      };
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);
      const mockTrigger = { matches: vi.fn().mockReturnValue(true) };
      (globalRegistry.getTrigger as any).mockReturnValue(mockTrigger);

      mockRateLimiter.check.mockReturnValue(false); // Rate limited

      const event = { type: 'taskCompleted', task: { title: 'Done' } } as TaskEvent;

      await manager.onTaskEvent(event);

      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded'),
      );
      expect(mockPlugin.openDialog).toHaveBeenCalled(); // Should ask user
      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();
    });
  });

  describe('shortcut trigger', () => {
    const shortcutRule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
      id: 'r1',
      name: 'Tag focused task',
      trigger: { type: 'shortcut' },
      conditions: [],
      actions: [],
      isEnabled: true,
      ...overrides,
    });

    it('should run the shortcut rule the pressed shortcut belongs to', async () => {
      const rule = shortcutRule({ actions: [{ type: 'addTag', value: 'urgent' }] });
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);
      const focusedTask = { id: 't1', title: 'Focused' };
      (mockPlugin.getFocusedTask as Mock).mockResolvedValue(focusedTask);

      await manager.runShortcutRule('r1');

      expect(mockActionExecutor.executeAll).toHaveBeenCalledWith(rule.actions, {
        type: 'shortcut',
        task: focusedTask,
      });
    });

    it('should run a shortcut rule without a task when nothing is focused', async () => {
      const rule = shortcutRule({
        actions: [{ type: 'webhook', value: 'https://example.com' }],
      });
      mockRuleRegistry.getEnabledRules.mockResolvedValue([rule]);

      await manager.runShortcutRule('r1');

      expect(mockActionExecutor.executeAll).toHaveBeenCalledWith(rule.actions, {
        type: 'shortcut',
        task: undefined,
      });
    });

    it('should still run the rule when the focused task cannot be read', async () => {
      mockRuleRegistry.getEnabledRules.mockResolvedValue([shortcutRule()]);
      (mockPlugin.getFocusedTask as Mock).mockRejectedValue(new Error('nope'));

      await manager.runShortcutRule('r1');

      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not read the focused task'),
      );
      expect(mockActionExecutor.executeAll).toHaveBeenCalled();
    });

    it('should not run a rule whose trigger is not a shortcut', async () => {
      mockRuleRegistry.getEnabledRules.mockResolvedValue([
        shortcutRule({ trigger: { type: 'taskCreated' } }),
      ]);

      await manager.runShortcutRule('r1');

      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();
      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('No enabled shortcut rule'),
      );
    });

    it('should not rate-limit shortcut rules, so rapid presses raise no dialog', async () => {
      mockRuleRegistry.getEnabledRules.mockResolvedValue([shortcutRule()]);
      mockRateLimiter.check.mockReturnValue(false);

      await manager.runShortcutRule('r1');

      expect(mockRateLimiter.check).not.toHaveBeenCalled();
      expect(mockActionExecutor.executeAll).toHaveBeenCalled();
    });

    it('should do nothing when the conditions of a shortcut rule do not match', async () => {
      mockRuleRegistry.getEnabledRules.mockResolvedValue([
        shortcutRule({ conditions: [{ type: 'hasTag', value: 'urgent' }] }),
      ]);
      mockConditionEvaluator.allConditionsMatch.mockResolvedValue(false);

      await manager.runShortcutRule('r1');

      expect(mockActionExecutor.executeAll).not.toHaveBeenCalled();
    });

    it('should register the shortcut of a newly saved shortcut rule', async () => {
      const rule = shortcutRule();
      mockRuleRegistry.getRules.mockResolvedValue([rule]);

      await manager.saveRule(rule);

      expect(mockRuleRegistry.addOrUpdateRule).toHaveBeenCalledWith(rule);
      expect(mockPlugin.registerShortcut).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', label: 'Tag focused task' }),
      );
    });

    // The rate-limit dialog's "Disable Rule" button goes through this wrapper.
    it('should release the shortcut when a rule is disabled', async () => {
      const rule = shortcutRule();
      mockRuleRegistry.getRules.mockResolvedValue([rule]);
      await manager.saveRule(rule);

      mockRuleRegistry.getRules.mockResolvedValue([{ ...rule, isEnabled: false }]);
      await manager.toggleRuleStatus('r1', false);

      expect(mockRuleRegistry.toggleRuleStatus).toHaveBeenCalledWith('r1', false);
      expect(mockPlugin.unregisterShortcut).toHaveBeenCalledWith('r1');
    });

    it('should release the shortcut when a rule mutation removes it from the list', async () => {
      const rule = shortcutRule();
      mockRuleRegistry.getRules.mockResolvedValue([rule]);
      await manager.saveRule(rule);

      mockRuleRegistry.getRules.mockResolvedValue([]);
      await manager.deleteRule('r1');

      expect(mockRuleRegistry.deleteRule).toHaveBeenCalledWith('r1');
      expect(mockPlugin.unregisterShortcut).toHaveBeenCalledWith('r1');
    });
  });
});
