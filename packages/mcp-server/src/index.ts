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

function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resourceError(uri: URL, message: string) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'text/plain' as const,
        text: `Error: ${message}`,
      },
    ],
  };
}

server.resource('current-task', 'sp://current-task', async (uri) => {
  try {
    const task = await client.getCurrentTask();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(task, null, 2),
        },
      ],
    };
  } catch (err) {
    return resourceError(uri, err instanceof Error ? err.message : String(err));
  }
});

server.resource('active-tasks', 'sp://tasks/active', async (uri) => {
  try {
    const tasks = await client.listTasks({ source: 'active' });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  } catch (err) {
    return resourceError(uri, err instanceof Error ? err.message : String(err));
  }
});

server.resource('today-tasks', 'sp://tasks/today', async (uri) => {
  try {
    const today = todayLocal();
    const tasks = await client.listTasks({ source: 'active', includeDone: true });
    const todayTasks = tasks.filter((t) => t.dueDay === today);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(todayTasks, null, 2),
        },
      ],
    };
  } catch (err) {
    return resourceError(uri, err instanceof Error ? err.message : String(err));
  }
});

server.resource('projects', 'sp://projects', async (uri) => {
  try {
    const projects = await client.listProjects();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(projects, null, 2),
        },
      ],
    };
  } catch (err) {
    return resourceError(uri, err instanceof Error ? err.message : String(err));
  }
});

server.resource('tags', 'sp://tags', async (uri) => {
  try {
    const tags = await client.listTags();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json' as const,
          text: JSON.stringify(tags, null, 2),
        },
      ],
    };
  } catch (err) {
    return resourceError(uri, err instanceof Error ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

main().catch((err: unknown) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
