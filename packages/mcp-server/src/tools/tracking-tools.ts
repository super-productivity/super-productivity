import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { z } from 'zod';

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
      const task = await client.getCurrentTask();
      if (!task) {
        return {
          content: [
            { type: 'text' as const, text: 'No task is currently being tracked.' },
          ],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
      };
    },
  );

  server.tool(
    'start_task',
    'Start tracking time on a task. Stops any previously tracked task.',
    TaskIdParam as AnyParams,
    async (params: z.objectOutputType<typeof TaskIdParam, z.ZodTypeAny>) => {
      await client.startTask(params.taskId);
      return {
        content: [
          { type: 'text' as const, text: `Started tracking task ${params.taskId}.` },
        ],
      };
    },
  );

  server.tool(
    'stop_task',
    'Stop tracking time on the current task.',
    {} as AnyParams,
    async () => {
      await client.stopTask();
      return { content: [{ type: 'text' as const, text: 'Stopped tracking.' }] };
    },
  );
}
