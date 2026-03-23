import { IAutomationCondition } from './definitions';

export const ConditionTitleContains: IAutomationCondition = {
  id: 'titleContains',
  name: 'Title contains',
  check: async (ctx, event, value) => {
    if (!event.task || !event.task.title || !value) return false;
    return event.task.title.toLowerCase().includes(value.toLowerCase());
  },
};

export const ConditionProjectIs: IAutomationCondition = {
  id: 'projectIs',
  name: 'Project is',
  check: async (ctx, event, value) => {
    if (!event.task || !event.task.projectId || !value) return false;
    const projects = await ctx.dataCache.getProjects();
    const project = projects.find((p) => p.id === event.task?.projectId);
    return project ? project.title === value : false;
  },
};

export const ConditionHasTag: IAutomationCondition = {
  id: 'hasTag',
  name: 'Has tag',
  check: async (ctx, event, value) => {
    if (!event.task || !event.task.tagIds || !value) return false;
    const tags = await ctx.dataCache.getTags();
    const tag = tags.find((t) => t.title === value);
    return tag ? event.task.tagIds.includes(tag.id) : false;
  },
};

export const ConditionWeekdayIs: IAutomationCondition = {
  id: 'weekdayIs',
  name: 'Weekday is',
  description: 'Checks if the current day is one of the specified days (e.g. "Monday", "Mon,Tue")',
  check: async (ctx, event, value) => {
    if (!value) return false;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayIndex = new Date().getDay();
    const todayName = days[todayIndex];

    const allowedDays = value
      .toLowerCase()
      .split(',')
      .map((d) => d.trim());

    // Use exact match for full names or 3-letter abbreviations
    return allowedDays.some((day) => {
      if (day.length < 3) return false; // Prevent short ambiguous matches
      return day === todayName || (todayName.startsWith(day) && day.length === 3);
    });
  },
};
