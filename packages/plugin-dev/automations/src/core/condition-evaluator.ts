import { PluginAPI } from '@super-productivity/plugin-api';
import { Condition, TaskEvent } from '../types';
import { AutomationRegistry } from './registry';
import { AutomationContext } from './definitions';
import { DataCache } from './data-cache';

export class ConditionEvaluator {
  constructor(
    private plugin: PluginAPI,
    private registry: AutomationRegistry,
    private dataCache: DataCache,
  ) {}

  async allConditionsMatch(conditions: Condition[], event: TaskEvent): Promise<boolean> {
    for (const condition of conditions) {
      if (!(await this.checkCondition(condition, event))) {
        return false;
      }
    }
    return true;
  }

  private async checkCondition(condition: Condition, event: TaskEvent): Promise<boolean> {
    // Let's just call the implementation.
    const conditionImpl = this.registry.getCondition(condition.type);
    if (!conditionImpl) {
      // Fallback or log?
      return false;
    }

    const context: AutomationContext = { plugin: this.plugin, dataCache: this.dataCache };
    return conditionImpl.check(context, event, condition.value, condition);
  }
}
