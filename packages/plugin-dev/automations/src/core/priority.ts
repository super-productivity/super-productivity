import { Task } from '@super-productivity/plugin-api';

/** How rules store a priority: the levels the app offers, plus "none". */
export type RulePriority = 'high' | 'medium' | 'low' | 'none';

/**
 * The task's priority as a rule value. Reads both encodings the app keeps
 * (numbers, and the older strings); anything else, including null, is "none".
 */
export const getRulePriority = (priority: Task['priority']): RulePriority => {
  switch (priority) {
    case 3:
    case 'high':
      return 'high';
    case 2:
    case 'medium':
      return 'medium';
    case 1:
    case 'low':
      return 'low';
    default:
      return 'none';
  }
};

/** The value to write for a rule priority (the app writes numbers), or undefined if invalid. */
export const toTaskPriority = (value: string): 1 | 2 | 3 | null | undefined => {
  switch (value.trim().toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    case 'none':
      return null;
    default:
      return undefined;
  }
};
