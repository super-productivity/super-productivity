import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { z } from 'zod';
import { toolError, jsonResult, textResult } from './util.js';

const TaskIdParam = {
  taskId: z.string().describe('The task ID to start tracking'),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS2589 workaround for deep Zod type inference in MCP SDK
type AnyParams = any;

export function registerTrackingTools(
  server: McpServer,
  client: SuperProductivityClient,
): void {
  server.tool(
    'get_current_task',
    'Get the task currently being time-tracked, or null if nothing is running.',
    {} as AnyParams,
    async () => {
      try {
        const task = await client.getCurrentTask();
        if (!task) {
          return textResult('No task is currently being tracked.');
        }
        return jsonResult(task);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'start_task',
    'Start tracking time on a task. Stops any previously tracked task.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      try {
        await client.startTask(params.taskId);
        return textResult(`Started tracking task ${params.taskId}.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'stop_task',
    'Stop tracking time on the current task.',
    {} as AnyParams,
    async () => {
      try {
        await client.stopTask();
        return textResult('Stopped tracking.');
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
