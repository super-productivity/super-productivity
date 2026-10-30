import type { Task } from '@super-productivity/plugin-api';

/** Minimal task for specs; only the fields the matcher reads matter. */
export const makeTask = (p: Partial<Task> & { id: string; title: string }): Task =>
  ({ isDone: false, ...p }) as Task;
