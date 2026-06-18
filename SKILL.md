---
name: super-productivity
description: >
  Agent integration reference for Super Productivity — a todo & time-tracking app (Angular + Electron + Capacitor).
  Covers the Local REST API (port 3876, Electron only), Plugin API (web + desktop), and URL protocol handler.
  Use when an agent needs to create tasks, complete work, query projects/tags, or react to task events.
triggers:
  - super productivity
  - superproductivity
  - add task to super productivity
  - local rest api 3876
  - superproductivity plugin
  - task management agent integration
---

# Super Productivity — Agent Integration

Super Productivity is a todo and time-tracking app. This skill covers every mechanism an AI agent can use to create tasks, mark them done, query state, and react to events.

## Quick-start decision tree

```
Is the Electron desktop app running?
  YES → Use the Local REST API on port 3876  (simplest, no setup)
  NO  → Use the Plugin API                  (load a plugin.js via Settings → Plugins)
```

---

## 1. Local REST API (Electron desktop only)

**Port:** `127.0.0.1:3876`  
**Enable:** Settings → Misc → Enable Local REST API  
**Works in web version at :4200 / ng serve:** No — Electron only.

### Full route table

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | App status + current task summary |
| GET | `/task-control/current` | Active (focused) task object |
| POST | `/task-control/current` | `{taskId}` — set active task |
| POST | `/task-control/stop` | Stop current task timer |
| GET | `/tasks` | List tasks (see filters below) |
| POST | `/tasks` | Create a task |
| GET | `/tasks/:id` | Get task by ID |
| PATCH | `/tasks/:id` | Update task fields |
| DELETE | `/tasks/:id` | Delete task |
| POST | `/tasks/:id/start` | Focus / set as current task |
| POST | `/tasks/:id/archive` | Archive task |
| POST | `/tasks/:id/restore` | Restore from archive |
| GET | `/projects` | List all projects |
| GET | `/tags` | List all tags |

### Query filters for `GET /tasks`

| Param | Values | Description |
|-------|--------|-------------|
| `source` | `active` \| `archived` \| `all` | Default: active |
| `isDone` | `true` \| `false` | Filter by completion |
| `projectId` | project ID string | Filter by project |
| `tagId` | tag ID string | Filter by tag |
| `dueDay` | `YYYY-MM-DD` | Filter by due date |
| `search` | string | Full-text search |
| `limit` | number | Pagination |
| `offset` | number | Pagination |

### Create task — full field reference

```json
{
  "title": "Required — task title",
  "notes": "Optional markdown notes",
  "timeEstimate": 1800000,
  "projectId": "<project-id>",
  "tagIds": ["<tag-id>"],
  "dueDay": "2024-12-31",
  "dueWithTime": 1735603200000,
  "plannedAt": 1735603200000,
  "parentId": "<parent-task-id>"
}
```

### Update task — allowed fields for `PATCH /tasks/:id`

`title`, `notes`, `isDone`, `timeEstimate`, `timeSpent`, `projectId`, `tagIds`, `dueDay`, `dueWithTime`, `plannedAt`

### Shell examples

```bash
# Check current task
curl http://127.0.0.1:3876/task-control/current

# Create a task
curl -X POST http://127.0.0.1:3876/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Review PR #42", "notes": "Added by agent", "timeEstimate": 1800000}'

# Mark a task done
curl -X PATCH http://127.0.0.1:3876/tasks/<id> \
  -H 'Content-Type: application/json' \
  -d '{"isDone": true}'

# Focus a task (start timer)
curl -X POST http://127.0.0.1:3876/tasks/<id>/start

# List today's active tasks
curl "http://127.0.0.1:3876/tasks?source=active&isDone=false"

# List projects and tags
curl http://127.0.0.1:3876/projects
curl http://127.0.0.1:3876/tags
```

### Python example

```python
import requests

BASE = "http://127.0.0.1:3876"

def add_task(title: str, project_id: str | None = None, estimate_minutes: int = 30) -> str:
    payload = {
        "title": title,
        "timeEstimate": estimate_minutes * 60_000,
    }
    if project_id:
        payload["projectId"] = project_id
    r = requests.post(f"{BASE}/tasks", json=payload)
    r.raise_for_status()
    return r.json()["id"]

def complete_task(task_id: str) -> None:
    requests.patch(f"{BASE}/tasks/{task_id}", json={"isDone": True}).raise_for_status()

def get_current_task() -> dict | None:
    r = requests.get(f"{BASE}/task-control/current")
    r.raise_for_status()
    return r.json().get("data")
```

---

## 2. Plugin API (web + desktop)

Plugins are sandboxed JavaScript files loaded in iframes. This is the **only integration path for the web version**.

**Load a plugin:** Settings → Plugins → load folder containing `manifest.json` + `plugin.js`

### Minimal plugin structure

```
my-agent-plugin/
  manifest.json
  plugin.js
```

**`manifest.json`** (required):
```json
{
  "name": "My Agent Plugin",
  "id": "my-agent-plugin",
  "manifestVersion": 1,
  "version": "1.0.0",
  "minSupVersion": "0.0.1",
  "hooks": ["anyTaskUpdate", "taskComplete"],
  "permissions": []
}
```

**`plugin.js`** — full `PluginAPI` surface:

```javascript
// ── Tasks ────────────────────────────────────────────────────────────────────
const tasks      = await PluginAPI.getTasks();                // Task[]
const archived   = await PluginAPI.getArchivedTasks();        // Task[]
const ctx        = await PluginAPI.getCurrentContextTasks();  // Task[]

const taskId = await PluginAPI.addTask({
  title: "Do the thing",
  notes: "Added by agent",
  timeEstimate: 1_800_000,  // ms
});

await PluginAPI.updateTask(taskId, { isDone: true });

// ── Projects ─────────────────────────────────────────────────────────────────
const projects  = await PluginAPI.getAllProjects();
const project   = await PluginAPI.addProject({ title: "AI Work", themeColor: "#4a90d9" });
await PluginAPI.updateProject(project.id, { title: "Renamed" });

// ── Tags ─────────────────────────────────────────────────────────────────────
const tags = await PluginAPI.getAllTags();
const tag  = await PluginAPI.addTag({ title: "agent", color: "#ff6b6b" });
await PluginAPI.updateTag(tag.id, { title: "ai-agent" });

// ── Context ───────────────────────────────────────────────────────────────────
const ctx = await PluginAPI.getActiveWorkContext(); // current project or tag context

// ── Persistent storage (synced cross-device) ─────────────────────────────────
await PluginAPI.persistDataSynced(JSON.stringify({ lastRun: Date.now() }));
const raw = await PluginAPI.loadSyncedData(); // string | null

// ── UI helpers ────────────────────────────────────────────────────────────────
PluginAPI.showSnack({ msg: "Task created!", type: "SUCCESS" });
PluginAPI.notify({ title: "Agent", body: "Task complete" });

// ── Event hooks ───────────────────────────────────────────────────────────────
PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE,       (task) => { ... });
PluginAPI.registerHook(PluginAPI.Hooks.TASK_UPDATE,         (task) => { ... });
PluginAPI.registerHook(PluginAPI.Hooks.TASK_DELETE,         (task) => { ... });
PluginAPI.registerHook(PluginAPI.Hooks.CURRENT_TASK_CHANGE, (task) => { ... });
PluginAPI.registerHook("anyTaskUpdate",                     (task) => { ... });
PluginAPI.registerHook("finishDay",                         ()     => { ... });
PluginAPI.registerHook("workContextChange",                 (ctx)  => { ... });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
PluginAPI.registerShortcut({
  id: "my-agent-action",
  label: "Run agent task",
  onExec: () => { ... },
});

// ── Electron-only: run a Node.js script ──────────────────────────────────────
// Requires "nodeScript" in manifest.json permissions
const result = await PluginAPI.execNodeScript(`
  const os = require('os');
  return { hostname: os.hostname() };
`);
```

### Boilerplate

`packages/plugin-dev/boilerplate-solid-js/` — full Solid.js + TS plugin starter  
`packages/plugin-dev/api-test-plugin/` — exhaustive API surface demo  
`packages/plugin-dev/clickup-issue-provider/` — reference issue provider plugin

---

## 3. URL Protocol Handler (Electron only)

Trigger actions directly from shell scripts, Alfred/Raycast, or other apps:

```bash
# macOS / Linux with xdg-open
open "superproductivity://create-task/My%20Task%20Title"
xdg-open "superproductivity://create-task/My%20Task%20Title"

# Toggle start / stop current task timer
open "superproductivity://task-toggle-start"
```

Source: `electron/protocol-handler.ts` — `PROTOCOL_NAME = 'superproductivity'`

---

## 4. Electron IPC (in-process only)

Only relevant if you're building an Electron plugin or extending the main process. The full channel enum is at `electron/shared-with-frontend/ipc-events.const.ts`.

Agent-relevant channels:

| Channel | Direction | Payload |
|---------|-----------|---------|
| `ADD_TASK_FROM_APP_URI` | → renderer | `{title: string}` |
| `SHOW_ADD_TASK_BAR` | → renderer | — |
| `TASK_TOGGLE_START` | → renderer | — |
| `CURRENT_TASK_UPDATED` | renderer → | task object |
| `TODAY_TASKS_UPDATED` | renderer → | task[] |

---

## Data model reference

### Task

```typescript
interface Task {
  id: string;
  title: string;
  notes: string;              // markdown
  isDone: boolean;
  timeEstimate: number;       // ms
  timeSpent: number;          // ms (cumulative)
  projectId: string | null;
  tagIds: string[];
  dueDay: string | null;      // "YYYY-MM-DD"
  dueWithTime: number | null; // unix ms
  plannedAt: number | null;   // unix ms
  parentId: string | null;    // subtask parent
  subTaskIds: string[];
  created: number;            // unix ms
}
```

### Project / Tag

```typescript
interface Project { id: string; title: string; themeColor: string; }
interface Tag     { id: string; title: string; color: string; }
```

---

## Integration selection guide

| Scenario | Mechanism | Notes |
|----------|-----------|-------|
| Agent script on same machine, Electron running | **REST API :3876** | Simplest — plain HTTP |
| Web version only | **Plugin** | Load via Settings → Plugins |
| CLI / shell trigger (task title only) | **URL protocol** | `open superproductivity://...` |
| Real-time event reactions | **Plugin hooks** | `TASK_COMPLETE`, `CURRENT_TASK_CHANGE`, etc. |
| Full CRUD + sync storage | **Plugin** | `getTasks()` + `persistDataSynced()` |
| Read from external tracker (Jira/Linear/etc.) | **Issue provider plugin** | See `clickup-issue-provider` boilerplate |
