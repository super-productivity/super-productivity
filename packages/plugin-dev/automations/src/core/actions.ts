import { IAutomationAction } from './definitions';

export const ActionCreateTask: IAutomationAction = {
  id: 'createTask',
  name: 'Create Task',
  execute: async (ctx, event, value) => {
    if (!value) return;
    await ctx.plugin.addTask({
      title: value,
      projectId: event.task?.projectId,
    });
    ctx.plugin.log.info(`[Automation] Action: Created task "${value}"`);
  },
};

export const ActionDeleteTask: IAutomationAction = {
  id: 'deleteTask',
  name: 'Delete Task',
  execute: async (ctx, event) => {
    if (!event.task?.id) {
      ctx.plugin.log.warn('[Automation] Cannot delete task without task context.');
      return;
    }

    await ctx.plugin.deleteTask(event.task.id);
    ctx.plugin.log.info(`[Automation] Action: Deleted task "${event.task.title}"`);
  },
};

export const ActionAddTag: IAutomationAction = {
  id: 'addTag',
  name: 'Add Tag',
  execute: async (ctx, event, value) => {
    if (!event.task || !value) {
      ctx.plugin.log.warn(`[Automation] Cannot add tag "${value}" without task context.`);
      return;
    }
    const tags = await ctx.dataCache.getTags();
    let tagId = tags.find((t) => t.id === value || t.title === value)?.id;

    if (!tagId) {
      ctx.plugin.log.warn(`[Automation] Tag "${value}" not found.`);
      return;
    }
    if (event.task.tagIds.includes(tagId)) return;

    await ctx.plugin.updateTask(event.task.id, {
      tagIds: [...event.task.tagIds, tagId],
    });
    ctx.plugin.log.info(`[Automation] Action: Added tag "${value}"`);
  },
};

export const ActionMoveToProject: IAutomationAction = {
  id: 'moveToProject',
  name: 'Move to Project',
  execute: async (ctx, event, value) => {
    if (!event.task || !value) {
      ctx.plugin.log.warn(
        `[Automation] Cannot move task to project "${value}" without task context.`,
      );
      return;
    }
    const projects = await ctx.dataCache.getProjects();
    const project = projects.find((p) => p.id === value || p.title === value);

    if (!project) {
      ctx.plugin.log.warn(
        `[Automation] Project "${value}" not found in: ${projects.map((p) => p.title).join(', ')}`,
      );
      return;
    }

    if (event.task.projectId === project.id) {
      ctx.plugin.log.info(`[Automation] Task already in project "${project.title}"`);
      return;
    }

    await ctx.plugin.updateTask(event.task.id, { projectId: project.id });
    ctx.plugin.log.info(`[Automation] Action: Moved task to project "${project.title}"`);
  },
};

export const ActionDisplaySnack: IAutomationAction = {
  id: 'displaySnack',
  name: 'Display Snack',
  execute: async (ctx, event, value) => {
    if (!value) return;
    ctx.plugin.showSnack({ msg: value, type: 'SUCCESS' });
    ctx.plugin.log.info(`[Automation] Action: Displayed snack "${value}"`);
  },
};

export const ActionDisplayDialog: IAutomationAction = {
  id: 'displayDialog',
  name: 'Display Dialog',
  execute: async (ctx, event, value) => {
    if (!value) return;
    const escapedValue = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    await ctx.plugin.openDialog({
      htmlContent: `<p>${escapedValue}</p>`,
      buttons: [{ label: 'OK', onClick: () => {} }],
    });
    ctx.plugin.log.info(`[Automation] Action: Displayed dialog "${value}"`);
  },
};

export const ActionWebhook: IAutomationAction = {
  id: 'webhook',
  name: 'Webhook',
  execute: async (ctx, event, value) => {
    if (!value) return;
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      ctx.plugin.log.warn(
        `[Automation] Invalid webhook URL: "${value}". Must start with http:// or https://`,
      );
      return;
    }

    // Sanitize event data to avoid leaking all task details
    const sanitizedEvent = {
      type: event.type,
      task: event.task
        ? {
            id: event.task.id,
            title: event.task.title,
            projectId: event.task.projectId,
            isDone: event.task.isDone,
            tagIds: event.task.tagIds,
          }
        : undefined,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch(value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedEvent),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      ctx.plugin.log.info(`[Automation] Action: Webhook sent to "${value}"`);
    } catch (e) {
      ctx.plugin.log.error(`[Automation] Webhook failed: ${e}`);
    }
  },
};
