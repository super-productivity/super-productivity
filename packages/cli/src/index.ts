// Public API — used by @super-productivity/mcp-server and other consumers
export {
  SuperProductivityClient,
  SuperProductivityError,
  AppNotRunningError,
} from './client';
export type {
  Task,
  Project,
  Tag,
  StatusResponse,
  HealthResponse,
  ListTasksOptions,
  TaskCreateFields,
  TaskUpdateFields,
  TaskSource,
} from './types';
