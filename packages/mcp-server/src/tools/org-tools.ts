import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { z } from 'zod';

const QueryParam = {
  query: z.string().optional().describe('Filter by title'),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS2589 workaround for deep Zod type inference in MCP SDK
type AnyParams = any;

export function registerOrgTools(
  server: McpServer,
  client: SuperProductivityClient,
): void {
  server.tool(
    'get_status',
    'Get an overview of the Super Productivity app: current task, total task count.',
    {} as AnyParams,
    async () => {
      const status = await client.status();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      };
    },
  );

  server.tool(
    'list_projects',
    'List all projects. Optionally filter by name.',
    QueryParam as AnyParams,
    async (params: z.objectOutputType<typeof QueryParam, z.ZodTypeAny>) => {
      const projects = await client.listProjects(params.query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }],
      };
    },
  );

  server.tool(
    'list_tags',
    'List all tags. Optionally filter by name.',
    QueryParam as AnyParams,
    async (params: z.objectOutputType<typeof QueryParam, z.ZodTypeAny>) => {
      const tags = await client.listTags(params.query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(tags, null, 2) }],
      };
    },
  );
}
