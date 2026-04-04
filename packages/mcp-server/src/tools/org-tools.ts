import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { z } from 'zod';
import { toolError, jsonResult } from './util.js';

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
      try {
        const status = await client.status();
        return jsonResult(status);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'list_projects',
    'List all projects. Optionally filter by name.',
    QueryParam as AnyParams,
    async (params: z.objectOutputType<typeof QueryParam, z.ZodTypeAny>) => {
      try {
        const projects = await client.listProjects(params.query);
        return jsonResult(projects);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'list_tags',
    'List all tags. Optionally filter by name.',
    QueryParam as AnyParams,
    async (params: z.objectOutputType<typeof QueryParam, z.ZodTypeAny>) => {
      try {
        const tags = await client.listTags(params.query);
        return jsonResult(tags);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
