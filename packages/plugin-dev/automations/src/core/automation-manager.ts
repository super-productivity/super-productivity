import { PluginAPI, Task } from '@super-productivity/plugin-api';
import { AutomationRule, TaskEvent } from '../types';
import { RuleRegistry } from './rule-registry';
import { ConditionEvaluator } from './condition-evaluator';
import { ActionExecutor } from './action-executor';
import { lazySetInterval } from './lazy-set-interval';

import { RateLimiter } from './rate-limiter';
import { DialogCfg } from '@super-productivity/plugin-api';
import { globalRegistry } from './registry';
import * as Triggers from './triggers';
import * as Conditions from './conditions';
import * as Actions from './actions';
import { DataCache } from './data-cache';
import { ShortcutBinder } from './shortcut-binder';

export class AutomationManager {
  private static readonly RATE_LIMIT_MAX = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 1000;
  private static readonly CHECK_INTERVAL_MS = 10000;
  private static readonly TIME_RULE_COOLDOWN_MS = 60000;

  private ruleRegistry: RuleRegistry;
  private conditionEvaluator: ConditionEvaluator;
  private actionExecutor: ActionExecutor;
  private rateLimiter: RateLimiter;
  private dataCache: DataCache;
  private shortcutBinder: ShortcutBinder;
  private pendingDialogs: Set<string> = new Set();
  private lastExecutionTimes: Map<string, number> = new Map();
  private clearTimeCheck?: () => void;

  constructor(private plugin: PluginAPI) {
    this.registerDefaults();
    this.dataCache = new DataCache(plugin);
    this.ruleRegistry = new RuleRegistry(plugin);
    this.conditionEvaluator = new ConditionEvaluator(plugin, globalRegistry, this.dataCache);
    this.actionExecutor = new ActionExecutor(plugin, globalRegistry, this.dataCache);
    this.rateLimiter = new RateLimiter(
      AutomationManager.RATE_LIMIT_MAX,
      AutomationManager.RATE_LIMIT_WINDOW_MS,
    );
    this.shortcutBinder = new ShortcutBinder(plugin, (ruleId) => {
      void this.runShortcutRule(ruleId);
    });
    void this.syncShortcuts();
    this.initTimeCheck();
  }

  private registerDefaults() {
    // Triggers
    globalRegistry.registerTrigger(Triggers.TriggerTaskCompleted);
    globalRegistry.registerTrigger(Triggers.TriggerTaskCreated);
    globalRegistry.registerTrigger(Triggers.TriggerTaskUpdated);
    globalRegistry.registerTrigger(Triggers.TriggerTaskStarted);
    globalRegistry.registerTrigger(Triggers.TriggerTaskStopped);
    globalRegistry.registerTrigger(Triggers.TriggerTimeBased);
    globalRegistry.registerTrigger(Triggers.TriggerShortcut);

    // Conditions
    globalRegistry.registerCondition(Conditions.ConditionTitleContains);
    globalRegistry.registerCondition(Conditions.ConditionTitleStartsWith);
    globalRegistry.registerCondition(Conditions.ConditionProjectIs);
    globalRegistry.registerCondition(Conditions.ConditionHasTag);
    globalRegistry.registerCondition(Conditions.ConditionWeekdayIs);

    // Actions
    globalRegistry.registerAction(Actions.ActionCreateTask);
    globalRegistry.registerAction(Actions.ActionDeleteTask);
    globalRegistry.registerAction(Actions.ActionAddTag);
    globalRegistry.registerAction(Actions.ActionRemoveTag);
    globalRegistry.registerAction(Actions.ActionMoveToProject);
    globalRegistry.registerAction(Actions.ActionDisplaySnack);
    globalRegistry.registerAction(Actions.ActionDisplayDialog);
    globalRegistry.registerAction(Actions.ActionWebhook);
  }

  private async syncShortcuts() {
    try {
      this.shortcutBinder.sync(await this.ruleRegistry.getRules());
    } catch (e) {
      this.plugin.log.error(`[Automation] Failed to sync shortcuts: ${e}`);
    }
  }

  async saveRule(value: unknown) {
    await this.ruleRegistry.addOrUpdateRule(value);
    await this.syncShortcuts();
  }

  async addRules(value: unknown) {
    await this.ruleRegistry.addRules(value);
    await this.syncShortcuts();
  }

  async deleteRule(ruleId: unknown) {
    await this.ruleRegistry.deleteRule(ruleId);
    await this.syncShortcuts();
  }

  async toggleRuleStatus(ruleId: unknown, isEnabled: unknown) {
    await this.ruleRegistry.toggleRuleStatus(ruleId, isEnabled);
    await this.syncShortcuts();
  }

  private initTimeCheck() {
    this.clearTimeCheck = lazySetInterval(() => {
      this.checkTimeBasedRules();
    }, AutomationManager.CHECK_INTERVAL_MS);
  }

  destroy() {
    if (this.clearTimeCheck) {
      this.clearTimeCheck();
      this.clearTimeCheck = undefined;
    }
  }

  private async checkTimeBasedRules() {
    try {
      const rules = await this.ruleRegistry.getEnabledRules();

      // Cleanup execution times for deleted rules to prevent memory leaks
      this.syncExecutionTimes(rules.map((r) => r.id));

      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeStr = `${currentHours.toString().padStart(2, '0')}:${currentMinutes.toString().padStart(2, '0')}`;

      for (const rule of rules) {
        try {
          if (rule.trigger.type !== 'timeBased' || !rule.trigger.value) continue;

          if (rule.trigger.value === currentTimeStr) {
            const lastRun = this.lastExecutionTimes.get(rule.id) || 0;
            // Prevent multiple executions within the same minute
            if (now.getTime() - lastRun < AutomationManager.TIME_RULE_COOLDOWN_MS) continue;

            // Check conditions (even for time-based rules, though most conditions require a task)
            // We pass a dummy event. The evaluator must handle missing tasks gracefully.
            const event: TaskEvent = {
              type: 'timeBased',
              task: undefined,
            };

            const matches = await this.conditionEvaluator.allConditionsMatch(
              rule.conditions,
              event,
            );
            if (!matches) continue;

            this.lastExecutionTimes.set(rule.id, now.getTime());
            this.plugin.log.info(`[Automation] Time-based rule matched: ${rule.name}`);

            // Execute actions
            await this.actionExecutor.executeAll(rule.actions, {
              type: 'timeBased',
            });
          }
        } catch (e) {
          this.plugin.log.error(`[Automation] Error processing time-based rule ${rule.name}: ${e}`);
        }
      }
    } catch (e) {
      this.plugin.log.error(`[Automation] Error in checkTimeBasedRules: ${e}`);
    }
  }

  private syncExecutionTimes(activeRuleIds: string[]) {
    const activeSet = new Set(activeRuleIds);
    for (const id of this.lastExecutionTimes.keys()) {
      if (!activeSet.has(id)) {
        this.lastExecutionTimes.delete(id);
      }
    }
  }

  async onTaskEvent(event: TaskEvent) {
    if (!event.task) {
      this.plugin.log.warn(`[Automation] Event ${event.type} received without task data`);
      return;
    }

    try {
      const rules = await this.ruleRegistry.getEnabledRules();

      for (const rule of rules) {
        try {
          const triggerImpl = globalRegistry.getTrigger(rule.trigger.type);
          // If trigger not found, skip
          if (!triggerImpl) {
            this.plugin.log.warn(
              `[Automation] Trigger implementation not found for rule "${rule.name}" with type "${rule.trigger.type}"`,
            );
            continue;
          }

          const isMatchingTrigger = triggerImpl.matches(event, rule.trigger.value);

          if (!isMatchingTrigger) {
            continue;
          }

          await this.runRule(rule, event);
        } catch (e) {
          this.plugin.log.error(`[Automation] Error processing rule ${rule.name}: ${e}`);
        }
      }
    } catch (e) {
      this.plugin.log.error(`[Automation] Error in onTaskEvent: ${e}`);
    }
  }

  /**
   * Runs the rule bound to the given keyboard shortcut. Actions apply to the
   * task row the user currently has focused, if any — task-less rules (snack,
   * webhook, create task) work without one.
   */
  async runShortcutRule(ruleId: string) {
    try {
      const rules = await this.ruleRegistry.getEnabledRules();
      const rule = rules.find((r) => r.id === ruleId && r.trigger.type === 'shortcut');
      if (!rule) {
        this.plugin.log.warn(`[Automation] No enabled shortcut rule for id: ${ruleId}`);
        return;
      }

      this.plugin.log.info(`[Automation] Shortcut rule triggered: ${rule.id}`);
      // Loop protection off: a keypress cannot feed itself, so rapid presses
      // must not raise the "high activity" dialog.
      await this.runRule(
        rule,
        { type: 'shortcut', task: await this.getFocusedTask() },
        {
          applyLoopProtection: false,
        },
      );
    } catch (e) {
      this.plugin.log.error(`[Automation] Error running shortcut rule ${ruleId}: ${e}`);
    }
  }

  private async getFocusedTask(): Promise<Task | undefined> {
    try {
      return (await this.plugin.getFocusedTask()) ?? undefined;
    } catch (e) {
      this.plugin.log.warn(`[Automation] Could not read the focused task: ${e}`);
      return undefined;
    }
  }

  private async runRule(
    rule: AutomationRule,
    event: TaskEvent,
    { applyLoopProtection = true }: { applyLoopProtection?: boolean } = {},
  ) {
    const matches = await this.conditionEvaluator.allConditionsMatch(rule.conditions, event);
    if (!matches) {
      return;
    }

    if (applyLoopProtection && (await this.isRateLimited(rule))) {
      return;
    }

    this.plugin.log.info(`[Automation] Rule matched: ${rule.name}`);
    await this.actionExecutor.executeAll(rule.actions, event);
  }

  /**
   * Breaks automation loops: an action can trigger the very event that runs the
   * rule again. Returns true when the run must be skipped, offering the user a
   * one-time dialog to disable the rule.
   */
  private async isRateLimited(rule: AutomationRule): Promise<boolean> {
    if (this.rateLimiter.check(rule.id)) {
      return false;
    }

    this.plugin.log.warn(`[Automation] Rate limit exceeded for rule: ${rule.name}`);

    if (!this.pendingDialogs.has(rule.id)) {
      this.pendingDialogs.add(rule.id);

      const dialogCfg: DialogCfg = {
        htmlContent: `
              <h3>High Automation Activity Detected</h3>
              <p>The rule <strong>"${this.escapeHtml(rule.name)}"</strong> is triggering too frequently (infinite loop protection).</p>
              <p>Do you want to disable this rule or continue execution?</p>
            `,
        buttons: [
          {
            label: 'Disable Rule',
            color: 'warn',
            onClick: async () => {
              await this.toggleRuleStatus(rule.id, false);
              this.plugin.showSnack({ msg: `Rule "${rule.name}" disabled`, type: 'INFO' });
              this.pendingDialogs.delete(rule.id);
            },
          },
          {
            label: 'Continue',
            color: 'primary',
            onClick: () => {
              this.rateLimiter.reset(rule.id);
              this.pendingDialogs.delete(rule.id);
            },
          },
        ],
      };

      await this.plugin.openDialog(dialogCfg);
    }
    return true;
  }

  // Minimal HTML escape to prevent rule-provided strings from injecting markup in dialogs.
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getRules(): Promise<AutomationRule[]> {
    return this.ruleRegistry.getRules();
  }
}
