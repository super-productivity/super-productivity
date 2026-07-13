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

const validTriggers = new Set<string>(AUTOMATION_TRIGGER_TYPES);
const validConditions = new Set<string>(AUTOMATION_CONDITION_TYPES);
const validActions = new Set<string>(AUTOMATION_ACTION_TYPES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAutomationTriggerType = (value: unknown): value is AutomationTriggerType =>
  typeof value === 'string' && validTriggers.has(value);

const isConditionType = (value: unknown): value is ConditionType =>
  typeof value === 'string' && validConditions.has(value);

const isActionType = (value: unknown): value is ActionType =>
  typeof value === 'string' && validActions.has(value);

const toAutomationTrigger = (value: unknown): AutomationRule['trigger'] | null => {
  if (!isRecord(value) || !isAutomationTriggerType(value.type)) {
    return null;
  }

  if (value.type === 'timeBased') {
    return typeof value.value === 'string' ? { type: value.type, value: value.value } : null;
  }

  if (value.value === undefined) {
    return { type: value.type };
  }

  return typeof value.value === 'string' ? { type: value.type, value: value.value } : null;
};

const toCondition = (value: unknown): AutomationRule['conditions'][number] | null => {
  if (
    !isRecord(value) ||
    !isConditionType(value.type) ||
    typeof value.value !== 'string' ||
    (value.isRegex !== undefined && typeof value.isRegex !== 'boolean')
  ) {
    return null;
  }

  return value.isRegex === undefined
    ? { type: value.type, value: value.value }
    : { type: value.type, value: value.value, isRegex: value.isRegex };
};

const toAction = (value: unknown): AutomationRule['actions'][number] | null => {
  if (!isRecord(value) || !isActionType(value.type) || typeof value.value !== 'string') {
    return null;
  }

  return { type: value.type, value: value.value };
};

const toAutomationRule = (value: unknown): AutomationRule | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.isEnabled !== 'boolean' ||
    !Array.isArray(value.conditions) ||
    !Array.isArray(value.actions)
  ) {
    return null;
  }

  const trigger = toAutomationTrigger(value.trigger);
  if (!trigger) {
    return null;
  }

  const conditions: AutomationRule['conditions'] = [];
  for (const conditionValue of value.conditions) {
    const condition = toCondition(conditionValue);
    if (!condition) {
      return null;
    }
    conditions.push(condition);
  }

  const actions: AutomationRule['actions'] = [];
  for (const actionValue of value.actions) {
    const action = toAction(actionValue);
    if (!action) {
      return null;
    }
    actions.push(action);
  }

  return {
    id: value.id,
    name: value.name,
    isEnabled: value.isEnabled,
    trigger,
    conditions,
    actions,
  };
};

const isAutomationRule = (value: unknown): value is AutomationRule =>
  toAutomationRule(value) !== null;

export class RuleRegistry {
  private rules: AutomationRule[] = [];
  // Preserve the complete loaded array as opaque JSON. Older clients only expose
  // known rules for execution, but explicit edits must round-trip newer or malformed
  // entries instead of silently deleting them from every synced device.
  private persistedRules: unknown[] = [];
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
      if (data === null) {
        this.plugin.log.info('RuleRegistry: No rules found, using defaults.');
        this.initDefaultRules();
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data) as unknown;
      } catch {
        this.initError = new Error('Corrupted JSON in automation rules');
        this.plugin.log.warn('Corrupted JSON in automation rules; no rules loaded.');
        this.initDefaultRules();
        return;
      }

      if (!Array.isArray(parsed)) {
        this.initError = new Error('Persisted automation rules are invalid');
        this.plugin.log.warn('Persisted automation rules are not an array; no rules loaded.');
        this.initDefaultRules();
        return;
      }

      this.persistedRules = parsed;
      this.rules = [];
      for (const entry of parsed) {
        const rule = toAutomationRule(entry);
        if (rule) {
          this.rules.push(rule);
        }
      }
      const preservedCount = parsed.length - this.rules.length;
      if (preservedCount > 0) {
        this.plugin.log.warn(
          `RuleRegistry: preserved ${preservedCount} unsupported or malformed rule entries.`,
        );
      }
      this.plugin.log.info(`RuleRegistry: loaded ${this.rules.length} rules.`);
    } catch (e) {
      this.initError = e instanceof Error ? e : new Error(String(e));
      this.plugin.log.error('Failed to load rules', e);
      this.initDefaultRules();
    }
  }

  private initDefaultRules() {
    // Hardcoded example rules for MVP
    this.rules = [];
    this.persistedRules = [];
  }

  getInitializationError(): Error | null {
    return this.initError;
  }

  private async persistRules(rules: unknown[]) {
    try {
      await this.plugin.persistDataSynced(JSON.stringify(rules));
    } catch (e) {
      this.plugin.log.error('Failed to save rules', e);
      throw e;
    }
  }

  private enqueueMutation(mutation: () => Promise<void>): Promise<void> {
    const pendingMutation = this.saveQueue.then(mutation);
    this.saveQueue = pendingMutation.catch(() => undefined);
    return pendingMutation;
  }

  private upsertPersistedRule(persistedRules: unknown[], rule: AutomationRule) {
    const index = persistedRules.findIndex(
      (entry) => isAutomationRule(entry) && entry.id === rule.id,
    );
    if (index !== -1) {
      persistedRules[index] = rule;
    } else {
      persistedRules.push(rule);
    }
  }

  private ensureInitializedForMutation() {
    if (this.initError) {
      throw new Error('Automation rules failed to initialize');
    }
  }

  async getRules(): Promise<AutomationRule[]> {
    await this.initPromise;
    return this.rules;
  }

  async getEnabledRules(): Promise<AutomationRule[]> {
    await this.initPromise;
    return this.rules.filter((r) => r.isEnabled);
  }

  async addOrUpdateRule(value: unknown) {
    const rule = toAutomationRule(value);
    if (!rule) {
      throw new Error('Invalid automation rule');
    }

    await this.initPromise;
    this.ensureInitializedForMutation();
    await this.enqueueMutation(async () => {
      const nextRules = [...this.rules];
      const nextPersistedRules = [...this.persistedRules];
      const index = nextRules.findIndex((r) => r.id === rule.id);
      if (index !== -1) {
        nextRules[index] = rule;
      } else {
        nextRules.push(rule);
      }
      this.upsertPersistedRule(nextPersistedRules, rule);
      await this.persistRules(nextPersistedRules);
      this.rules = nextRules;
      this.persistedRules = nextPersistedRules;
    });
  }

  async addRules(value: unknown) {
    if (!Array.isArray(value)) {
      throw new Error('Invalid automation rules');
    }

    const rules: AutomationRule[] = [];
    for (const entry of value) {
      const rule = toAutomationRule(entry);
      if (!rule) {
        throw new Error('Invalid automation rules');
      }
      rules.push(rule);
    }

    if (rules.length === 0) return;
    await this.initPromise;
    this.ensureInitializedForMutation();
    await this.enqueueMutation(async () => {
      const nextRules = [...this.rules];
      const nextPersistedRules = [...this.persistedRules];
      for (const rule of rules) {
        const index = nextRules.findIndex((r) => r.id === rule.id);
        if (index !== -1) {
          nextRules[index] = rule;
        } else {
          nextRules.push(rule);
        }
        this.upsertPersistedRule(nextPersistedRules, rule);
      }
      await this.persistRules(nextPersistedRules);
      this.rules = nextRules;
      this.persistedRules = nextPersistedRules;
    });
  }

  async deleteRule(ruleId: unknown) {
    if (typeof ruleId !== 'string') {
      throw new Error('Invalid automation rule ID');
    }

    await this.initPromise;
    this.ensureInitializedForMutation();
    await this.enqueueMutation(async () => {
      const nextRules = this.rules.filter((r) => r.id !== ruleId);
      const nextPersistedRules = this.persistedRules.filter(
        (entry) => !isAutomationRule(entry) || entry.id !== ruleId,
      );
      await this.persistRules(nextPersistedRules);
      this.rules = nextRules;
      this.persistedRules = nextPersistedRules;
    });
  }

  async toggleRuleStatus(ruleId: unknown, isEnabled: unknown) {
    if (typeof ruleId !== 'string') {
      throw new Error('Invalid automation rule ID');
    }
    if (typeof isEnabled !== 'boolean') {
      throw new Error('Invalid automation rule status');
    }

    await this.initPromise;
    this.ensureInitializedForMutation();
    await this.enqueueMutation(async () => {
      const index = this.rules.findIndex((r) => r.id === ruleId);
      if (index !== -1) {
        const nextRules = [...this.rules];
        const nextPersistedRules = [...this.persistedRules];
        const updatedRule = { ...this.rules[index], isEnabled };
        nextRules[index] = updatedRule;
        this.upsertPersistedRule(nextPersistedRules, updatedRule);
        await this.persistRules(nextPersistedRules);
        this.rules = nextRules;
        this.persistedRules = nextPersistedRules;
      }
    });
  }
}
