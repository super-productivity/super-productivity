import { AutomationRule } from '../types';
import { PluginAPI } from '@super-productivity/plugin-api';

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

    const validTriggers = new Set(['taskCompleted', 'taskCreated', 'taskUpdated', 'timeBased']);
    const validConditions = new Set([
      'titleContains',
      'titleStartsWith',
      'projectIs',
      'hasTag',
      'weekdayIs',
    ]);
    const validActions = new Set([
      'createTask',
      'deleteTask',
      'addTag',
      'moveToProject',
      'displaySnack',
      'displayDialog',
      'webhook',
    ]);

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
