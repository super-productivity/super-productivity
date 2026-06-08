import { ActionType, AutomationRule, AutomationTriggerType, ConditionType } from '../types';
import { PluginAPI } from '@super-productivity/plugin-api';

// Keep these arrays in sync with the unions in types.ts. They are duplicated
// here (and in utils/rule-validator.ts) rather than centralized in types.ts
// because types.ts must stay type-only — otherwise vite produces a shared
// runtime chunk that breaks plugin.js (which the host evaluates with
// `new Function`, not as an ES module).
//
// The `satisfies` clause catches extra / mistyped entries. The `_AssertEq`
// helper enforces the other direction: if a union gains a new member, this
// file fails to compile until the corresponding array is updated.
type _AssertEq<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;

const AUTOMATION_TRIGGER_TYPES = [
  'taskCompleted',
  'taskCreated',
  'taskUpdated',
  'taskStarted',
  'taskStopped',
  'timeBased',
] as const satisfies readonly AutomationTriggerType[];
const _exhaustiveTriggers: _AssertEq<
  AutomationTriggerType,
  (typeof AUTOMATION_TRIGGER_TYPES)[number]
> = true;

const AUTOMATION_CONDITION_TYPES = [
  'titleContains',
  'titleStartsWith',
  'projectIs',
  'hasTag',
  'weekdayIs',
] as const satisfies readonly ConditionType[];
const _exhaustiveConditions: _AssertEq<ConditionType, (typeof AUTOMATION_CONDITION_TYPES)[number]> =
  true;

const AUTOMATION_ACTION_TYPES = [
  'createTask',
  'deleteTask',
  'addTag',
  'removeTag',
  'moveToProject',
  'displaySnack',
  'displayDialog',
  'webhook',
] as const satisfies readonly ActionType[];
const _exhaustiveActions: _AssertEq<ActionType, (typeof AUTOMATION_ACTION_TYPES)[number]> = true;

export class RuleRegistry {
  private rules: AutomationRule[] = [];
  private plugin: PluginAPI;
  private initPromise: Promise<void>;
  private saveQueue: Promise<void> = Promise.resolve();

  private initError: Error | null = null;

  constructor(plugin: PluginAPI) {
    this.plugin = plugin;
    this.initPromise = this.loadRules();
  }

  private async loadRules() {
    try {
      const data = await this.plugin.loadSyncedData();
      if (data) {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          this.initError = new Error('Corrupted JSON in automation rules');
          this.plugin.log.warn('Corrupted JSON in automation rules, resetting.');
          // We don't return here, we let it fall through to initDefaultRules to reset
        }

        if (parsed) {
          const validated = this.validateRules(parsed);
          if (validated) {
            this.rules = validated;
            this.plugin.log.info(`RuleRegistry: loaded ${this.rules.length} rules.`);
            return;
          }
          this.initError = new Error('Persisted automation rules are invalid');
          this.plugin.log.warn('Persisted automation rules are invalid, resetting to defaults.');
        }
      }
      this.plugin.log.info('RuleRegistry: No valid rules found, initializing defaults.');
      this.initDefaultRules();
      await this.saveRules();
    } catch (e) {
      this.initError = e instanceof Error ? e : new Error(String(e));
      this.plugin.log.error('Failed to load rules', e);
      this.initDefaultRules();
      await this.saveRules();
    }
  }

  private initDefaultRules() {
    // Hardcoded example rules for MVP
    this.rules = [];
  }

  getInitializationError(): Error | null {
    return this.initError;
  }

  // Guard against corrupted/foreign persisted data to keep automation runtime stable.
  private validateRules(data: unknown): AutomationRule[] | null {
    if (!Array.isArray(data)) {
      return null;
    }

    const validTriggers = new Set<string>(AUTOMATION_TRIGGER_TYPES);
    const validConditions = new Set<string>(AUTOMATION_CONDITION_TYPES);
    const validActions = new Set<string>(AUTOMATION_ACTION_TYPES);

    const isValidCondition = (c: any) =>
      c &&
      typeof c === 'object' &&
      typeof c.type === 'string' &&
      validConditions.has(c.type) &&
      typeof c.value === 'string' &&
      (c.isRegex === undefined || typeof c.isRegex === 'boolean');

    const isValidAction = (a: any) =>
      a &&
      typeof a === 'object' &&
      typeof a.type === 'string' &&
      validActions.has(a.type) &&
      typeof a.value === 'string';

    for (const rule of data) {
      if (!rule || typeof rule !== 'object') {
        return null;
      }
      const r = rule as AutomationRule;
      if (
        typeof r.id !== 'string' ||
        typeof r.name !== 'string' ||
        typeof r.isEnabled !== 'boolean'
      ) {
        return null;
      }
      if (
        !r.trigger ||
        typeof r.trigger !== 'object' ||
        !validTriggers.has((r.trigger as any).type)
      ) {
        return null;
      }
      if (!Array.isArray(r.conditions) || r.conditions.some((c) => !isValidCondition(c))) {
        return null;
      }
      if (!Array.isArray(r.actions) || r.actions.some((a) => !isValidAction(a))) {
        return null;
      }
    }
    return data as AutomationRule[];
  }

  private async saveRules() {
    this.saveQueue = this.saveQueue
      .then(async () => {
        try {
          await this.plugin.persistDataSynced(JSON.stringify(this.rules));
        } catch (e) {
          this.plugin.log.error('Failed to save rules', e);
        }
      })
      .catch(() => {
        // Catch any errors from the promise chain itself to prevent blocking future saves
        this.plugin.log.error('Critical error in save queue');
      });
    await this.saveQueue;
  }

  async getRules(): Promise<AutomationRule[]> {
    await this.initPromise;
    return this.rules;
  }

  async getEnabledRules(): Promise<AutomationRule[]> {
    await this.initPromise;
    return this.rules.filter((r) => r.isEnabled);
  }

  async addOrUpdateRule(rule: AutomationRule) {
    await this.initPromise;
    this.saveQueue = this.saveQueue.then(async () => {
      const index = this.rules.findIndex((r) => r.id === rule.id);
      if (index !== -1) {
        this.rules[index] = rule;
      } else {
        this.rules.push(rule);
      }
      try {
        await this.plugin.persistDataSynced(JSON.stringify(this.rules));
      } catch (e) {
        this.plugin.log.error('Failed to save rules', e);
      }
    });
    await this.saveQueue;
  }

  async addRules(rules: AutomationRule[]) {
    if (rules.length === 0) return;
    await this.initPromise;
    this.saveQueue = this.saveQueue.then(async () => {
      for (const rule of rules) {
        const index = this.rules.findIndex((r) => r.id === rule.id);
        if (index !== -1) {
          this.rules[index] = rule;
        } else {
          this.rules.push(rule);
        }
      }
      try {
        await this.plugin.persistDataSynced(JSON.stringify(this.rules));
      } catch (e) {
        this.plugin.log.error('Failed to save rules', e);
      }
    });
    await this.saveQueue;
  }

  async deleteRule(ruleId: string) {
    await this.initPromise;
    this.saveQueue = this.saveQueue.then(async () => {
      this.rules = this.rules.filter((r) => r.id !== ruleId);
      try {
        await this.plugin.persistDataSynced(JSON.stringify(this.rules));
      } catch (e) {
        this.plugin.log.error('Failed to save rules', e);
      }
    });
    await this.saveQueue;
  }

  async toggleRuleStatus(ruleId: string, isEnabled: boolean) {
    await this.initPromise;
    this.saveQueue = this.saveQueue.then(async () => {
      const rule = this.rules.find((r) => r.id === ruleId);
      if (rule) {
        rule.isEnabled = isEnabled;
        try {
          await this.plugin.persistDataSynced(JSON.stringify(this.rules));
        } catch (e) {
          this.plugin.log.error('Failed to save rules', e);
        }
      }
    });
    await this.saveQueue;
  }
}
