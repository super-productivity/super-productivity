import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { z } from 'zod';
import { toolError, jsonResult, textResult } from './util.js';

const ListTasksParams = {
  query: z
    .string()
    .optional()
    .describe('Filter tasks by title (case-insensitive substring match)'),
  projectId: z.string().optional().describe('Filter by project ID'),
  tagId: z.string().optional().describe('Filter by tag ID'),
  includeDone: z
    .boolean()
    .optional()
    .describe('Include completed tasks (default: false)'),
  source: z
    .enum(['active', 'archived', 'all'])
    .optional()
    .describe('Which task pool to search (default: active)'),
};

const TaskIdParam = {
  taskId: z.string().describe('The task ID'),
};

const CreateTaskParams = {
  title: z.string().describe('Task title (required)'),
  notes: z.string().optional().describe('Task notes/description'),
  projectId: z.string().optional().describe('Assign to a project by ID'),
  tagIds: z.array(z.string()).optional().describe('Tag IDs to assign'),
  dueDay: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  timeEstimate: z.number().optional().describe('Time estimate in milliseconds'),
};

const UpdateTaskParams = {
  taskId: z.string().describe('The task ID to update'),
  title: z.string().optional().describe('New title'),
  notes: z.string().optional().describe('New notes'),
  isDone: z.boolean().optional().describe('Mark done or not done'),
  projectId: z
    .string()
    .nullable()
    .optional()
    .describe('Move to project (null to unassign)'),
  tagIds: z.array(z.string()).optional().describe('Replace tag list'),
  dueDay: z
    .string()
    .nullable()
    .optional()
    .describe('Due date YYYY-MM-DD (null to clear)'),
  dueWithTime: z
    .number()
    .nullable()
    .optional()
    .describe('Due datetime as unix ms (null to clear)'),
  timeEstimate: z.number().optional().describe('Time estimate in milliseconds'),
  timeSpent: z.number().optional().describe('Time spent in milliseconds'),
  plannedAt: z
    .number()
    .nullable()
    .optional()
    .describe('Planned-at timestamp in unix ms (null to clear)'),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS2589 workaround for deep Zod type inference in MCP SDK
type AnyParams = any;

export function registerTaskTools(
  server: McpServer,
  client: SuperProductivityClient,
): void {
  server.tool(
    'list_tasks',
    'Search and list tasks from Super Productivity. Returns active non-done tasks by default.',
    ListTasksParams as AnyParams,
    async (params: z.objectOutputType<typeof ListTasksParams, z.ZodTypeAny>) => {
      try {
        const tasks = await client.listTasks({
          query: params.query,
          projectId: params.projectId,
          tagId: params.tagId,
          includeDone: params.includeDone,
          source: params.source,
        });
        return jsonResult(tasks);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_task',
    'Get full details of a single task by its ID, including notes, time tracking, subtask IDs, and due dates.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        const task = await client.getTask(params.taskId);
        return jsonResult(task);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'create_task',
    'Create a new task in Super Productivity.',
    CreateTaskParams as AnyParams,
    async (params: z.objectOutputType<typeof CreateTaskParams, z.ZodTypeAny>) => {
      try {
        const task = await client.createTask(params.title, {
          notes: params.notes,
          projectId: params.projectId,
          tagIds: params.tagIds,
          dueDay: params.dueDay,
          timeEstimate: params.timeEstimate,
        });
        return jsonResult(task);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'update_task',
    'Update fields on an existing task. Only provided fields are changed.',
    UpdateTaskParams as AnyParams,
    async (params: z.objectOutputType<typeof UpdateTaskParams, z.ZodTypeAny>) => {
      try {
        const { taskId, ...fields } = params;
        const task = await client.updateTask(taskId, fields);
        return jsonResult(task);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'complete_task',
    'Mark a task as done.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        const task = await client.updateTask(params.taskId, { isDone: true });
        return textResult(`Task "${task.title}" marked as done.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'delete_task',
    'Permanently delete a task.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        await client.deleteTask(params.taskId);
        return textResult(`Task ${params.taskId} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'archive_task',
    'Move a task to the archive.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        await client.archiveTask(params.taskId);
        return textResult(`Task ${params.taskId} archived.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'restore_task',
    'Restore a task from the archive back to the active task list.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        const task = await client.restoreTask(params.taskId);
        return jsonResult(task);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
