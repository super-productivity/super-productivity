import { Condition } from '../types';
import { IAutomationCondition } from './definitions';

const MAX_REGEX_PATTERN_LENGTH = 200;
const DANGEROUS_REGEX_PATTERN = /(\([^)]*[+*{][^)]*\))[+*{]/;

const matchesTitleWithRegex = (
  ctx: Parameters<IAutomationCondition['check']>[0],
  title: string,
  pattern: string,
  shouldMatchFromStart = false,
): boolean => {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    ctx.plugin.log.warn(
      `[Automation] Regex pattern too long (${pattern.length} chars, max ${MAX_REGEX_PATTERN_LENGTH}). Skipping.`,
    );
    return false;
  }

  if (DANGEROUS_REGEX_PATTERN.test(pattern)) {
    ctx.plugin.log.warn(
      `[Automation] Regex pattern rejected: contains nested quantifiers that may cause catastrophic backtracking.`,
    );
    return false;
  }

  try {
    const regex = new RegExp(pattern, 'i');
    if (!shouldMatchFromStart) {
      return regex.test(title);
    }

    const match = regex.exec(title);
    return match?.index === 0;
  } catch (error) {
    ctx.plugin.log.warn(`[Automation] Invalid regex pattern for condition: ${pattern}`, error);
    return false;
  }
};

const isRegexCondition = (condition?: Condition): boolean => Boolean(condition?.isRegex);

export const ConditionTitleContains: IAutomationCondition = {
  id: 'titleContains',
  name: 'Title contains',
  check: async (ctx, event, value, condition) => {
    if (!event.task || !event.task.title || !value) return false;
    if (isRegexCondition(condition)) {
      return matchesTitleWithRegex(ctx, event.task.title, value);
    }
    return event.task.title.toLowerCase().includes(value.toLowerCase());
  },
};

export const ConditionTitleStartsWith: IAutomationCondition = {
  id: 'titleStartsWith',
  name: 'Title starts with',
  check: async (ctx, event, value, condition) => {
    if (!event.task || !event.task.title || !value) return false;
    return isRegexCondition(condition)
      ? matchesTitleWithRegex(ctx, event.task.title, value, true)
      : event.task.title.toLowerCase().startsWith(value.toLowerCase());
  },
};

export const ConditionProjectIs: IAutomationCondition = {
  id: 'projectIs',
  name: 'Project is',
  check: async (ctx, event, value) => {
    if (!event.task || !event.task.projectId || !value) return false;
    const projects = await ctx.dataCache.getProjects();
    const project = projects.find((p) => p.id === event.task?.projectId);
    return project ? project.id === value || project.title === value : false;
  },
};

export const ConditionHasTag: IAutomationCondition = {
  id: 'hasTag',
  name: 'Has tag',
  check: async (ctx, event, value) => {
    if (!event.task || !event.task.tagIds || !value) return false;
    const tags = await ctx.dataCache.getTags();
    const tag = tags.find((t) => t.id === value || t.title === value);
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
