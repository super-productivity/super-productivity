# MCP Server Implementation Plan for Super Productivity

## Overview

Build an MCP (Model Context Protocol) server that lets AI assistants (Claude, etc.) interact with Super Productivity — querying tasks, creating/updating them, managing projects and tags, and controlling time tracking. The server communicates with the running Super Productivity Electron app via its existing local REST API (`127.0.0.1:3876`).

## Architecture Decision: CLI + MCP Server

**Two new packages** under `packages/`:

```
packages/
├── cli/                  # CLI tool: `sp` command
│   ├── src/
│   │   ├── client.ts     # Shared HTTP client for REST API
│   │   ├── commands/     # CLI command implementations
│   │   └── index.ts      # CLI entry point
│   ├── package.json
│   └── tsconfig.json
├── mcp-server/           # MCP server (uses same HTTP client)
│   ├── src/
│   │   ├── server.ts     # MCP server setup
│   │   ├── tools/        # MCP tool definitions
│   │   └── index.ts      # Entry point (stdio transport)
│   ├── package.json
│   └── tsconfig.json
```

**Why two packages?**
- The CLI is useful standalone (scripting, shell aliases, quick terminal usage)
- The MCP server reuses the same HTTP client library from the CLI package
- Both talk to the same REST API — no new app-side code needed
- Users can install just the CLI, just the MCP server, or both

**Alternative considered:** Single MCP-only package. Rejected because a CLI is independently valuable and the shared client code is trivial to extract.

## Step 1: Shared HTTP Client (`packages/cli/src/client.ts`)

A thin typed wrapper around the existing REST API:

```typescript
// Core client that both CLI and MCP server use
export class SuperProductivityClient {
  constructor(private baseUrl = 'http://127.0.0.1:3876') {}

  // Health / status
  async health(): Promise<HealthResponse>
  async status(): Promise<StatusResponse>

  // Tasks
  async listTasks(opts?: { query?: string; projectId?: string; tagId?: string; source?: 'active' | 'archived' | 'all'; includeDone?: boolean }): Promise<Task[]>
  async getTask(id: string): Promise<Task>
  async createTask(title: string, fields?: Partial<TaskCreateFields>): Promise<Task>
  async updateTask(id: string, fields: Partial<TaskUpdateFields>): Promise<Task>
  async deleteTask(id: string): Promise<void>
  async archiveTask(id: string): Promise<void>
  async restoreTask(id: string): Promise<Task>

  // Task control (time tracking)
  async getCurrentTask(): Promise<Task | null>
  async startTask(id: string): Promise<void>
  async stopTask(): Promise<void>

  // Projects
  async listProjects(query?: string): Promise<Project[]>

  // Tags
  async listTags(query?: string): Promise<Tag[]>
}
```

- Uses `fetch` (Node 18+ built-in) — no dependencies
- Throws typed errors (`AppNotRunning`, `TaskNotFound`, etc.)
- Types imported from `@super-productivity/plugin-api` where possible

## Step 2: CLI Package (`packages/cli`)

**Package:** `@super-productivity/cli`  
**Binary:** `sp`

### Commands

```
sp status                          # Show current task + task count
sp tasks [--query X] [--project X] [--tag X] [--done] [--archived]
sp task <id>                       # Show task details
sp add "Task title" [--project X] [--tag X] [--due YYYY-MM-DD] [--estimate 1h30m]
sp update <id> [--title X] [--notes X] [--done] [--due X]
sp delete <id>
sp archive <id>
sp restore <id>
sp start <id>                      # Start tracking time
sp stop                            # Stop tracking time
sp current                         # Show currently tracked task
sp projects [--query X]
sp tags [--query X]
sp health                          # Check if app is running
```

### Implementation Details

- Use a minimal CLI parser (e.g., `commander` or hand-rolled with `process.argv`)
- Output: plain text by default, `--json` flag for machine-readable output
- Duration parsing for estimates: `1h30m`, `45m`, `2h`
- Colored output via basic ANSI codes (no dependency needed)
- Exit codes: 0 success, 1 error, 2 app not running

### package.json

```json
{
  "name": "@super-productivity/cli",
  "bin": { "sp": "./dist/index.js" },
  "dependencies": {},
  "devDependencies": {
    "@super-productivity/plugin-api": "workspace:*",
    "typescript": "..."
  }
}
```

Zero runtime dependencies — uses Node built-in `fetch` and simple arg parsing.

## Step 3: MCP Server Package (`packages/mcp-server`)

**Package:** `@super-productivity/mcp-server`

### MCP Tools

Each tool maps to one or more REST API calls:

#### Task Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_tasks` | Search and filter tasks | `query?`, `projectId?`, `tagId?`, `source?`, `includeDone?` |
| `get_task` | Get task details by ID | `taskId` |
| `create_task` | Create a new task | `title`, `projectId?`, `tagIds?`, `notes?`, `dueDay?`, `timeEstimate?` |
| `update_task` | Update task fields | `taskId`, `title?`, `notes?`, `isDone?`, `dueDay?`, `timeEstimate?`, `tagIds?`, `projectId?` |
| `delete_task` | Delete a task | `taskId` |
| `complete_task` | Mark task as done | `taskId` |
| `archive_task` | Move task to archive | `taskId` |
| `restore_task` | Restore from archive | `taskId` |

#### Time Tracking

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_current_task` | Get currently tracked task | — |
| `start_task` | Start tracking time on a task | `taskId` |
| `stop_task` | Stop tracking time | — |

#### Organization

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_projects` | List all projects | `query?` |
| `list_tags` | List all tags | `query?` |
| `get_status` | Get app status overview | — |

### MCP Resources (read-only context)

| Resource | URI | Description |
|----------|-----|-------------|
| Current task | `sp://current-task` | Currently tracked task details |
| Today's tasks | `sp://tasks/today` | Tasks due today (via `dueDay` filter) |
| Active tasks | `sp://tasks/active` | All non-done active tasks |
| Projects | `sp://projects` | All projects |
| Tags | `sp://tags` | All tags |

### Implementation

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SuperProductivityClient } from '@super-productivity/cli';

const client = new SuperProductivityClient();
const server = new McpServer({
  name: 'super-productivity',
  version: '1.0.0',
});

// Example tool registration
server.tool(
  'list_tasks',
  'Search and list tasks from Super Productivity',
  {
    query: z.string().optional().describe('Search text to filter tasks by title'),
    projectId: z.string().optional().describe('Filter by project ID'),
    tagId: z.string().optional().describe('Filter by tag ID'),
    includeDone: z.boolean().optional().describe('Include completed tasks'),
    source: z.enum(['active', 'archived', 'all']).optional(),
  },
  async ({ query, projectId, tagId, includeDone, source }) => {
    const tasks = await client.listTasks({ query, projectId, tagId, includeDone, source });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(tasks, null, 2),
      }],
    };
  }
);

// ... register all other tools similarly

const transport = new StdioServerTransport();
await server.connect(transport);
```

### package.json

```json
{
  "name": "@super-productivity/mcp-server",
  "bin": { "sp-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "@super-productivity/cli": "workspace:*",
    "zod": "^3.x"
  }
}
```

### MCP Configuration (for Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["@super-productivity/mcp-server"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "sp-mcp"
    }
  }
}
```

## Step 4: REST API Enhancements (app-side, if needed)

The existing REST API covers the core operations well. A few additions that would make the MCP server more powerful:

1. **`GET /tasks/today`** — Return tasks where `dueDay === today`. Currently requires client-side filtering.
2. **`GET /projects/:id`** — Get single project by ID (currently only list endpoint exists).
3. **`GET /tags/:id`** — Get single tag by ID.
4. **`GET /tasks/:id/subtasks`** — Return subtasks for a task.

These are **nice-to-haves**, not blockers. The MCP server can work without them by filtering client-side.

## Implementation Order

| Phase | What | Effort |
|-------|------|--------|
| **Phase 1** | `packages/cli/src/client.ts` — HTTP client with types | Small |
| **Phase 2** | `packages/cli` — Full CLI with all commands | Medium |
| **Phase 3** | `packages/mcp-server` — MCP server with all tools + resources | Medium |
| **Phase 4** | REST API additions (optional, in main app) | Small |
| **Phase 5** | Testing, docs, npm publish setup | Small |

## Prerequisites

- Super Productivity desktop app must be running with **Local REST API enabled** (Settings > Misc > Enable Local REST API)
- Node.js 18+ (for built-in `fetch`)
- The REST API only listens on `127.0.0.1` — this is local-only by design (security)

## Key Design Decisions

1. **REST API as the integration point** — No new IPC channels or direct database access. The REST API is the stable, well-tested boundary.
2. **Zero app-side changes for Phase 1-3** — Everything works with the existing REST API.
3. **Workspace packages** — Both packages live in the monorepo under `packages/`, using workspace dependencies.
4. **Minimal dependencies** — CLI has zero runtime deps. MCP server only needs `@modelcontextprotocol/sdk` and `zod`.
5. **`complete_task` as a convenience tool** — Maps to `updateTask(id, { isDone: true })` but is a common enough operation to warrant its own tool for AI ergonomics.
6. **Resources for context** — MCP resources let AI assistants see current state without explicit tool calls, reducing round-trips.
