import {
  CurrentTaskChangePayload,
  PluginAPI,
  TaskCompletePayload,
  TaskUpdatePayload,
  TaskCreatedPayload,
} from '@super-productivity/plugin-api';

declare const plugin: PluginAPI;

import { AutomationManager } from './core/automation-manager';
import { globalRegistry } from './core/registry';

// Plugin initialization
plugin.log.info('Automation plugin initialized');

const automationManager = new AutomationManager(plugin);

// Hook into task creation
plugin.registerHook('taskCreated' as any, (payload: TaskCreatedPayload) => {
  if (!payload.task) {
    plugin.log.warn('Received taskCreated hook without task data');
    return;
  }
  automationManager.onTaskEvent({
    type: 'taskCreated',
    task: payload.task,
  });
});

// Hook into task completion
plugin.registerHook('taskComplete' as any, (payload: TaskCompletePayload) => {
  if (!payload.task) {
    plugin.log.warn('Received taskComplete hook without task data');
    return;
  }
  automationManager.onTaskEvent({
    type: 'taskCompleted',
    task: payload.task,
  });
});

// Hook into task updates
plugin.registerHook('taskUpdate' as any, (payload: TaskUpdatePayload) => {
  if (!payload.task) {
    plugin.log.warn('Received taskUpdate hook without task data');
    return;
  }
  automationManager.onTaskEvent({
    type: 'taskUpdated',
    task: payload.task,
    changes: payload.changes,
    previousTaskState: undefined, // TODO: How to get previous state? Payload changes only has partial.
  });
});

// The host provides both the new current task and the previous one on every
// transition, so we don't need to track state locally. A switch between two
// tasks arrives as { current: B, previous: A } and fires both stop+start.
plugin.registerHook('currentTaskChange' as any, (payload: CurrentTaskChangePayload) => {
  if (!payload) {
    plugin.log.warn('Received currentTaskChange hook without payload');
    return;
  }
  const { current, previous } = payload;
  if (previous) {
    automationManager.onTaskEvent({ type: 'taskStopped', task: previous });
  }
  if (current) {
    automationManager.onTaskEvent({ type: 'taskStarted', task: current });
  }
});

// Register UI commands
if (plugin.onMessage) {
  plugin.onMessage(async (message: any) => {
    switch (message?.type) {
      case 'getRules':
        return await automationManager.getRegistry().getRules();
      case 'getDefinitions':
        return {
          triggers: globalRegistry
            .getTriggers()
            .map((t) => ({ id: t.id, name: t.name, description: t.description })),
          conditions: globalRegistry
            .getConditions()
            .map((c) => ({ id: c.id, name: c.name, description: c.description })),
          actions: globalRegistry
            .getActions()
            .map((a) => ({ id: a.id, name: a.name, description: a.description })),
        };
      case 'saveRule':
        await automationManager.getRegistry().addOrUpdateRule(message.payload);
        return { success: true };
      case 'addRules':
        await automationManager.getRegistry().addRules(message.payload);
        return { success: true };
      case 'deleteRule':
        await automationManager.getRegistry().deleteRule(message.payload.id);
        return { success: true };
      case 'toggleRuleStatus':
        await automationManager
          .getRegistry()
          .toggleRuleStatus(message.payload.id, message.payload.isEnabled);
        return { success: true };
      case 'getProjects':
        return await plugin.getAllProjects();
      case 'getTags':
        return await plugin.getAllTags();
      case 'downloadFile':
        await plugin.downloadFile(message.payload.filename, message.payload.data);
        return { success: true };
      default:
        return { error: 'Unknown message type' };
    }
  });
}
