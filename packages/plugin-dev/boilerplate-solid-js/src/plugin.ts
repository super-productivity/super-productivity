import {
  AnyTaskUpdatePayload,
  PluginAPI,
  TaskCompletePayload,
  TaskUpdatePayload,
} from '@super-productivity/plugin-api';
import type { PluginHooks } from '@super-productivity/plugin-api';

declare const plugin: PluginAPI;

// Plugin initialization
plugin.log.info('Boilerplate plugin initialized');

// Example: Register a header button
plugin.registerHeaderButton({
  icon: 'rocket',
  label: 'Open Boilerplate Plugin',
  onClick: () => {
    plugin.showIndexHtmlAsView();
  },
});

// Example: Register a menu entry
plugin.registerMenuEntry({
  label: 'Boilerplate Plugin',
  icon: 'rocket',
  onClick: () => {
    plugin.showIndexHtmlAsView();
  },
});

// Example: Register keyboard shortcut
plugin.registerShortcut({
  id: 'open-boilerplate-plugin',
  label: 'Open Boilerplate Plugin',
  onExec: () => {
    plugin.showIndexHtmlAsView();
  },
});

// Example: Hook into task completion
plugin.registerHook(PluginHooks.TASK_COMPLETE, (taskData: TaskCompletePayload) => {
  plugin.log.info('Task completed:', taskData.task.title);

  // Example: Show notification
  plugin.showSnack({
    msg: `Great job! You completed: ${taskData.task.title}`,
    type: 'SUCCESS',
  });
});

// Example: Hook into task updates
plugin.registerHook(PluginHooks.TASK_UPDATE, (taskData: TaskUpdatePayload) => {
  plugin.log.info('Task updated:', taskData.task.title);
});

// Example: Hook into context changes
plugin.registerHook(PluginHooks.ANY_TASK_UPDATE, async (payload: AnyTaskUpdatePayload) => {
  const changes = payload.changes;
  if (changes && 'projectId' in changes && changes.projectId) {
    const projects = await plugin.getAllProjects();
    const currentProject = projects.find((p) => p.id === changes.projectId);
    if (currentProject) {
      plugin.log.info('Switched to project:', currentProject.title);
    }
  }
});

// Example: Custom command handler
if (plugin.onMessage) {
  plugin.onMessage(async (message: any) => {
    switch (message?.type) {
      case 'getStats':
        const tasks = await plugin.getTasks();
        const completedToday = tasks.filter(
          (t) => t.isDone && new Date(t.doneOn!).toDateString() === new Date().toDateString(),
        );

        return {
          totalTasks: tasks.length,
          completedToday: completedToday.length,
          pendingTasks: tasks.filter((t) => !t.isDone).length,
        };
      case 'createTask': {
        const newTask = await plugin.addTask({
          title: message.payload.title,
          projectId: message.payload.projectId,
        });

        plugin.showSnack({
          msg: `Task "${message.payload.title}" created!`,
          type: 'SUCCESS',
        });

        return newTask;
      }
      case 'getTasks':
        return await plugin.getTasks();
      case 'getAllProjects':
        return await plugin.getAllProjects();
      // Example: Persist plugin data
      case 'saveSettings':
        await plugin.persistDataSynced(JSON.stringify(message.payload));
        return { success: true };
      // Example: Load plugin data
      case 'loadSettings': {
        const settings = await plugin.loadSyncedData();
        return settings ? JSON.parse(settings) : {};
      }
      // i18n support
      case 'translate':
        return await plugin.translate(message.payload.key, message.payload.params);
      case 'getCurrentLanguage':
        return await plugin.getCurrentLanguage();
      default:
        return { error: 'Unknown message type' };
    }
  });
}

// Listen for language changes and notify iframe
plugin.registerHook(PluginHooks.LANGUAGE_CHANGE, (language: string) => {
  // Notify the iframe about language change
  const iframe = document.querySelector('iframe[data-plugin-iframe]');
  if (iframe && (iframe as HTMLIFrameElement).contentWindow) {
    (iframe as HTMLIFrameElement).contentWindow!.postMessage(
      { type: 'languageChanged', language },
      '*',
    );
  }
});
