import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationRegistry } from './registry';
import { IAutomationAction, IAutomationCondition, IAutomationTrigger } from './definitions';

describe('AutomationRegistry', () => {
  let registry: AutomationRegistry;

  beforeEach(() => {
    registry = new AutomationRegistry();
  });

  describe('Triggers', () => {
    it('should register and retrieve triggers', () => {
      const trigger: IAutomationTrigger = {
        id: 't1',
        name: 'Trigger 1',
        matches: () => true,
      };

      registry.registerTrigger(trigger);
      expect(registry.getTrigger('t1')).toBe(trigger);
      expect(registry.getTriggers()).toContain(trigger);
    });

    it('should return undefined for unknown trigger', () => {
      expect(registry.getTrigger('unknown')).toBeUndefined();
    });
  });

  describe('Conditions', () => {
    it('should register and retrieve conditions', () => {
      const condition: IAutomationCondition = {
        id: 'c1',
        name: 'Condition 1',
        check: async () => true,
      };

      registry.registerCondition(condition);
      expect(registry.getCondition('c1')).toBe(condition);
      expect(registry.getConditions()).toContain(condition);
    });
  });

  describe('Actions', () => {
    it('should register and retrieve actions', () => {
      const action: IAutomationAction = {
        id: 'a1',
        name: 'Action 1',
        execute: async () => {},
      };

      registry.registerAction(action);
      expect(registry.getAction('a1')).toBe(action);
      expect(registry.getActions()).toContain(action);
    });
  });
});
