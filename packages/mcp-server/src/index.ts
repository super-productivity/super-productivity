#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SuperProductivityClient } from '@super-productivity/cli';
import { registerTaskTools } from './tools/task-tools.js';
import { registerTrackingTools } from './tools/tracking-tools.js';
import { registerOrgTools } from './tools/org-tools.js';

const client = new SuperProductivityClient();

const server = new McpServer({
  name: 'super-productivity',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

registerTaskTools(server, client);
registerTrackingTools(server, client);
registerOrgTools(server, client);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource('current-task', 'sp://current-task', async (uri) => {
  const task = await client.getCurrentTask();
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(task, null, 2),
      },
    ],
  };
});

server.resource('active-tasks', 'sp://tasks/active', async (uri) => {
  const tasks = await client.listTasks({ source: 'active' });
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(tasks, null, 2),
      },
    ],
  };
});

server.resource('today-tasks', 'sp://tasks/today', async (uri) => {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = await client.listTasks({ source: 'active', includeDone: true });
  const todayTasks = tasks.filter((t) => t.dueDay === today);
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(todayTasks, null, 2),
      },
    ],
  };
});

server.resource('projects', 'sp://projects', async (uri) => {
  const projects = await client.listProjects();
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(projects, null, 2),
      },
    ],
  };
});

server.resource('tags', 'sp://tags', async (uri) => {
  const tags = await client.listTags();
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(tags, null, 2),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
