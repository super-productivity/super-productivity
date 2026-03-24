import { PluginAPI } from '@super-productivity/plugin-api';
import { Action, TaskEvent } from '../types';
import { AutomationRegistry } from './registry';
import { AutomationContext } from './definitions';
import { DataCache } from './data-cache';

export class ActionExecutor {
  constructor(
    private plugin: PluginAPI,
    private registry: AutomationRegistry,
    private dataCache: DataCache,
  ) {}

  async executeAll(actions: Action[], event: TaskEvent) {
    // Execute deleteTask last so other actions can still operate on the task
    const sorted = [...actions].sort((a, b) =>
      a.type === 'deleteTask' ? 1 : b.type === 'deleteTask' ? -1 : 0,
    );
    for (const action of sorted) {
      await this.executeAction(action, event);
    }
  }

  private async executeAction(action: Action, event: TaskEvent) {
    const actionImpl = this.registry.getAction(action.type);
    if (!actionImpl) {
      this.plugin.log.warn(`[Automation] Unknown action type: ${action.type}`);
      return;
    }

    const context: AutomationContext = { plugin: this.plugin, dataCache: this.dataCache };
    try {
      await actionImpl.execute(context, event, action.value);
    } catch (e) {
      this.plugin.log.error(`[Automation] Action ${action.type} failed: ${e}`);
    }
  }
}
