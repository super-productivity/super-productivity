# Super Productivity Plugin Development Guide

This is a comprehensive documentation of the Super Productivity Plugin System. This guide covers everything you need to know about creating plugins for Super Productivity.

These docs might not always be perfectly up to date. You find the latest typescript interfaces here:
[types.ts](../packages/plugin-api/src/types.ts)

Personally I think the best way to figure out how to write a plugin is to check out the example plugins:

- [yesterday-tasks-plugin](../packages/plugin-dev/yesterday-tasks-plugin)
- [procrastination-buster](../packages/plugin-dev/procrastination-buster)
- [api-test-plugin](../packages/plugin-dev/api-test-plugin)

If you want to build a sophisticated UI there is a boilerplate available for solidjs:
[boilerplate-solid-js](../packages/plugin-dev/boilerplate-solid-js)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Plugin Manifest](#plugin-manifest)
- [Plugin Types](#plugin-types)
- [Available API Methods](#available-api-methods)
- [Best Practices](#best-practices)
- [Security Considerations](#security-considerations)
- [Testing Your Plugin](#testing-your-plugin)

## Quick Start

### 1. Basic Plugin Structure

```
my-plugin/
├── manifest.json      # Plugin metadata (required)
├── plugin.js          # Main plugin code that is launched when activated and when Super Productivity starts
├── index.html         # UI interface (optional) => requires iFrame:true in manifest
└── icon.svg           # Plugin icon (optional)
```

### 2. Minimal Example

**manifest.json:**

```json
{
  "id": "hello-world",
  "name": "Hello World Plugin",
  "version": "1.0.0",
  "description": "My first Super Productivity plugin",
  "manifestVersion": 1,
  "minSupVersion": "14.0.0"
}
```

**plugin.js:**

```javascript
console.log('Hello World plugin loaded!');

// Show a notification
PluginAPI.showSnack({
  msg: 'Hello from my plugin!',
  type: 'SUCCESS',
});

// Demo a simple counter
await PluginAPI.setCounter('hello-count', 0);
PluginAPI.registerHeaderButton({
  label: 'Hello (Count: 0)',
  icon: 'waving_hand',
  onClick: async () => {
    const newCount = await PluginAPI.incrementCounter('hello-count');
    PluginAPI.showSnack({
      msg: `Button clicked! Count: ${newCount}`,
      type: 'INFO',
    });
  },
});
```

## Plugin Manifest

The `manifest.json` file is required for all plugins and defines the plugin's metadata and configuration.

### Manifest Fields

| Field             | Type     | Required | Description                                                        |
| ----------------- | -------- | -------- | ------------------------------------------------------------------ |
| `id`              | string   | ✓        | Unique identifier for your plugin (use kebab-case)                 |
| `name`            | string   | ✓        | Display name shown to users                                        |
| `version`         | string   | ✓        | Semantic version (e.g., "1.0.0")                                   |
| `description`     | string   | ✓        | Brief description of what your plugin does                         |
| `manifestVersion` | number   | ✓        | Currently must be `1`                                              |
| `minSupVersion`   | string   | ✓        | Minimum Super Productivity version required                        |
| `author`          | string   |          | Plugin author name                                                 |
| `homepage`        | string   |          | Plugin website or repository URL                                   |
| `icon`            | string   |          | Path to icon file (SVG recommended)                                |
| `iFrame`          | boolean  |          | Whether plugin uses iframe UI (default: false)                     |
| `sidePanel`       | boolean  |          | Show plugin in side panel (default: false), requires `iFrame:true` |
| `permissions`     | string[] |          | The permissions the plugin needs (e.g., ["nodeExecution"])         |
| `hooks`           | string[] |          | App events to listen to                                            |

### Complete Manifest Example

```json
{
  "id": "my-advanced-plugin",
  "name": "My Advanced Plugin",
  "version": "2.1.0",
  "description": "An advanced plugin with UI and hooks",
  "manifestVersion": 1,
  "minSupVersion": "14.0.2",
  "author": "John Doe",
  "homepage": "https://github.com/johndoe/my-plugin",
  "icon": "icon.svg",
  "iFrame": true,
  "sidePanel": false,
  "permissions": ["nodeExecution"],
  "hooks": ["taskComplete", "taskUpdate", "currentTaskChange"]
}
```

## Plugin Types

### 1. JavaScript Plugins (`plugin.js`)

Pure JavaScript plugins that run in a sandboxed environment with full API access.

**Use when:**

- For setup background stuff that is to be executed even when the plugin ui (iFrame) is not shown
- For registering and handling keyboard shortcuts
- You want to listen to app hooks/events
- You need programmatic interaction with tasks/projects

**Example:**

```javascript
// Register multiple UI elements
PluginAPI.registerHeaderButton({
  label: 'My Button',
  icon: 'star',
  onClick: async () => {
    const tasks = await PluginAPI.getTasks();
    console.log(`You have ${tasks.length} tasks`);
  },
});

PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, (taskId) => {
  console.log(`Task ${taskId} completed!`);
});
```

### 2. HTML/Iframe Plugins (`index.html`)

Plugins that render custom UI in a sandboxed iframe.

**Use when:**

- You need custom UI/visualizations
- You want to display charts, forms, or complex interfaces

**Important:** When using iframes, you must inline all CSS and JavaScript directly in the HTML file. External stylesheets and scripts are blocked for security reasons.

**Example index.html:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My Plugin UI</title>

    <!-- CSS must be inlined -->
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 20px;
        background: #f5f5f5;
      }

      .task-list {
        background: white;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .task-item {
        padding: 8px;
        border-bottom: 1px solid #eee;
      }

      button {
        background: #4caf50;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
      }

      button:hover {
        background: #45a049;
      }
    </style>
  </head>
  <body>
    <h1>My Plugin</h1>
    <div id="content">
      <button id="loadTasks">Load Tasks</button>
      <div
        id="taskList"
        class="task-list"
      ></div>
    </div>

    <!-- JavaScript must be inlined -->
    <script>
      document.getElementById('loadTasks').addEventListener('click', async () => {
        try {
          const tasks = await PluginAPI.getTasks();
          const taskList = document.getElementById('taskList');

          taskList.innerHTML = '<h3>Your Tasks:</h3>';

          tasks.forEach((task) => {
            const taskEl = document.createElement('div');
            taskEl.className = 'task-item';
            taskEl.textContent = task.title;
            taskList.appendChild(taskEl);
          });

          PluginAPI.showSnack({
            msg: `Loaded ${tasks.length} tasks`,
            type: 'SUCCESS',
          });
        } catch (error) {
          console.error('Error loading tasks:', error);
          PluginAPI.showSnack({
            msg: 'Failed to load tasks',
            type: 'ERROR',
          });
        }
      });
    </script>
  </body>
</html>
```

## Available API Methods

### Data Operations

#### Tasks

- `getTasks()` - Get all active tasks
- `getArchivedTasks()` - Get archived tasks
- `getCurrentContextTasks()` - Get tasks in current context
- `addTask(task)` - Create a new task
- `updateTask(taskId, updates)` - Update existing task

#### Projects

- `getAllProjects()` - Get all projects
- `addProject(project)` - Create new project
- `updateProject(projectId, updates)` - Update project

#### Tags

- `getAllTags()` - Get all tags
- `addTag(tag)` - Create new tag
- `updateTag(tagId, updates)` - Update tag

#### Simple Counters

Simple counters let you track lightweight metrics (e.g., daily clicks or habits) that persist and sync with your data. There are two levels: **basic** (key-value pairs for today's count) and **full model** (full CRUD on `SimpleCounter` entities with date-specific values).

##### Basic Counters

These treat counters as a simple `{ [id: string]: number }` map for today's values (auto-upserts via NgRx).

| Method                                  | Description                                                                      | Example                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `getAllCounters()`                      | Get all counters as `{ [id: string]: number }`                                   | `const counters = await PluginAPI.getAllCounters(); console.log(counters['my-key']);` |
| `getCounter(id)`                        | Get today's value for a counter (returns `null` if unset)                        | `const val = await PluginAPI.getCounter('daily-commits');`                            |
| `setCounter(id, value)`                 | Set today's value (non-negative number; validates id regex `/^[A-Za-z0-9_-]+$/`) | `await PluginAPI.setCounter('daily-commits', 5);`                                     |
| `incrementCounter(id, incrementBy = 1)` | Increment and return new value (floors at 0)                                     | `const newVal = await PluginAPI.incrementCounter('daily-commits', 2);`                |
| `decrementCounter(id, decrementBy = 1)` | Decrement and return new value (floors at 0)                                     | `const newVal = await PluginAPI.decrementCounter('daily-commits');`                   |
| `deleteCounter(id)`                     | Delete the counter                                                               | `await PluginAPI.deleteCounter('daily-commits');`                                     |

**Example:**

```javascript
// Track daily commits
let commits = (await PluginAPI.getCounter('daily-commits')) ?? 0;
await PluginAPI.incrementCounter('daily-commits');
PluginAPI.showSnack({
  msg: `Commits today: ${await PluginAPI.getCounter('daily-commits')}`,
  type: 'INFO',
});
```

##### Full SimpleCounter Model

For advanced use: Full CRUD on counters with metadata (title, enabled state, date-specific values via `countOnDay: { [date: string]: number }`).

| Method                                   | Description                                                                       | Example                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `getAllSimpleCounters()`                 | Get all as `SimpleCounter[]`                                                      | `const all = await PluginAPI.getAllSimpleCounters();`                 |
| `getSimpleCounter(id)`                   | Get one by id (returns `undefined` if not found)                                  | `const counter = await PluginAPI.getSimpleCounter('my-id');`          |
| `updateSimpleCounter(id, updates)`       | Partial update (e.g., `{ title: 'New Title', countOnDay: { '2025-11-17': 10 } }`) | `await PluginAPI.updateSimpleCounter('my-id', { isEnabled: false });` |
| `toggleSimpleCounter(id)`                | Toggle `isOn` state (throws if not found)                                         | `await PluginAPI.toggleSimpleCounter('my-id');`                       |
| `setSimpleCounterEnabled(id, isEnabled)` | Set enabled state                                                                 | `await PluginAPI.setSimpleCounterEnabled('my-id', true);`             |
| `deleteSimpleCounter(id)`                | Delete by id                                                                      | `await PluginAPI.deleteSimpleCounter('my-id');`                       |
| `setSimpleCounterToday(id, value)`       | Set today's value (YYYY-MM-DD)                                                    | `await PluginAPI.setSimpleCounterToday('my-id', 10);`                 |
| `setSimpleCounterDate(id, date, value)`  | Set value for specific date (validates YYYY-MM-DD)                                | `await PluginAPI.setSimpleCounterDate('my-id', '2025-11-16', 5);`     |

**Example:**

```javascript
// Create/update a habit counter
await PluginAPI.updateSimpleCounter('habit-streak', {
  title: 'Daily Streak',
  type: 'ClickCounter',
  isEnabled: true,
  countOnDay: { '2025-11-17': 1 }, // Today's count
});
await PluginAPI.toggleSimpleCounter('habit-streak');
const counter = await PluginAPI.getSimpleCounter('habit-streak');
console.log(`Streak on: ${counter.isOn}`);
```

### UI Operations

#### Notifications

```javascript
// Show snackbar notification
PluginAPI.showSnack({
  msg: 'Operation completed!',
  type: 'SUCCESS', // SUCCESS, ERROR, INFO, WARNING
  ico: 'check', // Optional Material icon
  actionStr: 'Undo', // Optional action button
  actionFn: () => console.log('Undo clicked'),
});

// System notification
PluginAPI.notify({
  title: 'Task Complete',
  body: 'Great job!',
  ico: 'done',
});
```

#### Dialogs

```javascript
// Open a dialog
const result = await PluginAPI.openDialog({
  title: 'Confirm Action',
  content: 'Are you sure?',
  okBtnLabel: 'Yes',
  cancelBtnLabel: 'No',
});
```

### Registration Methods (plugin.js only)

#### Header Button

```javascript
PluginAPI.registerHeaderButton({
  id: 'my-header-btn', // Optional unique ID
  label: 'Click Me',
  icon: 'star', // Material icon name
  onClick: () => {
    console.log('Header button clicked');
  },
});
```

#### Menu Entry

```javascript
PluginAPI.registerMenuEntry({
  label: 'My Plugin Action',
  icon: 'extension',
  onClick: () => {
    console.log('Menu item clicked');
  },
});
```

#### Side Panel Button

```javascript
PluginAPI.registerSidePanelButton({
  label: 'My Panel',
  icon: 'dashboard',
  onClick: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});
```

#### Keyboard Shortcut

```javascript
PluginAPI.registerShortcut({
  keys: 'ctrl+shift+p',
  label: 'My Plugin Shortcut',
  action: () => {
    console.log('Shortcut triggered');
  },
});
```

#### Hooks

```javascript
// Available hooks
const hooks = {
  TASK_COMPLETE: 'taskComplete',
  TASK_UPDATE: 'taskUpdate',
  TASK_DELETE: 'taskDelete',
  CURRENT_TASK_CHANGE: 'currentTaskChange',
  FINISH_DAY: 'finishDay',
  LANGUAGE_CHANGE: 'languageChange',
  PERSISTED_DATA_UPDATE: 'persistedDataUpdate',
  ACTION: 'action',
};

// Register hook listener
PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, (taskId) => {
  console.log(`Task ${taskId} completed!`);
});

// Listen to Redux actions
PluginAPI.registerHook(PluginAPI.Hooks.ACTION, (action) => {
  if (action.type === 'ADD_TASK_SUCCESS') {
    console.log('New task added:', action.payload);
    // Bonus: Increment a counter on task add
    PluginAPI.incrementCounter('tasks-added-today');
  }
});
```

### Data Persistence

You can persist data that will also be synced vai the `persistDataSynced` and `loadSyncedData` APIs. For local storage I recommend using `localStorage`.

```javascript
// Save plugin data
await PluginAPI.persistDataSynced(JSON.stringify({ count: 42 }));

// Load saved data
const data = await PluginAPI.loadSyncedData();
console.log(data); // '{ count: 42 }'
```

## Best Practices

### 1. Performance

- **Lazy load resources**: Don't load everything on plugin initialization
- **Be responsive with using resources**: Avoid heavy operations and don't save excessive amounts of data.
- **Keep it lightweight**: Super Productivity is not the only app on the users system and your plugin is not the only plugin.

### 2. User Experience

- **Provide feedback**: Show loading states and confirmations
- **Be non-intrusive**: Don't spam notifications
- **Follow the app's design**: Use the injected theme variables and try to keep styles minimal.
- **Respect user preferences**: Check dark mode, and language settings (if possible or stick to english if not)

### 3. Security

- **Request minimal permissions**: Only what you need

### 4. Don't spam the logs

`console.logs` should be kept to a minimum.

1. **Inline everything**: CSS and JavaScript must be in the HTML file

```html
<!-- Good: Everything inlined -->
<!DOCTYPE html>
<html>
  <head>
    <style>
      /* All styles here */
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      // All JavaScript here
    </script>
  </body>
</html>
```

## Security Considerations

### Sandboxing

- JavaScript plugins run in isolated VM contexts
- Iframe plugins run in sandboxed iframes with restricted permissions
- No access to file system unless through API

### API Restrictions

In iframe context, these methods are NOT available:

- `registerHeaderButton()`
- `registerMenuEntry()`
- `registerSidePanelButton()`
- `registerShortcut()`
- `registerHook()`
- `execNodeScript()`

### Content Security Policy

- External scripts/styles are blocked in iframes
- Only same-origin resources are allowed
- Inline scripts must be within the HTML file

## Testing Your Plugin

### 1. Local Development

1. Use "Load Plugin from Folder" to test your plugin
2. Open DevTools (F12 or Ctrl+Shift+i) to see console logs
3. Use the API Test Plugin as reference

### 2. Debugging Tips

```javascript
// Add debug logging
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[MyPlugin]', ...args);
  }
}

// Test API methods
async function testAPI() {
  log('Testing getTasks...');
  const tasks = await PluginAPI.getTasks();
  log('Tasks:', tasks);

  log('Testing showSnack...');
  PluginAPI.showSnack({
    msg: 'API test successful!',
    type: 'SUCCESS',
  });
}
```

### 3. Common Issues

**Plugin not loading:**

- Check manifest.json syntax
- Verify minSupVersion compatibility
- Look for errors in console

**API methods failing:**

- Check if method is available in current context
- Verify permissions in manifest

**Iframe not displaying:**

- Check that all resources are inlined
- Verify no external dependencies
- Look for CSP violations in console

## Resources

- **Plugin API Types**: [@super-productivity/plugin-api](https://www.npmjs.com/package/@super-productivity/plugin-api)
- **Plugin Boilerplate**: [boilerplate-solid-js](../packages/plugin-dev/boilerplate-solid-js)
- **Example Plugins**: [plugin-dev](../packages/plugin-dev)
- **Community Plugins**:
  - [counter-tester-plugin](https://github.com/Mustache-Games/counter-tester-plugin) by [Mustache Dev](https://github.com/Mustache-Games)
  - [sp-reporter](https://github.com/dougcooper/sp-reporter) by [dougcooper](https://github.com/dougcooper)

## Contributing

If you create a useful plugin, consider:

1. Posting on reddit or GitHub discussions about it
2. Submitting a PR to add it to the community plugins list (coming soon)

Happy plugin development! 🚀

## Bonus: Vibe Coding your Plugins

### Tips

- Don't test on your real world data! Use a test instance! (you can use https://test-app.super-productivity.com/ if you don't know how get one)
- Be as specific as possible
- Outline what APIs your plugin should use
- Test for errors (`Ctrl+Shift+i` opens the console) and iterate until it works. Don't expect that everything works on your first try.
- Read the code! Don't trust it blindly.

### Example

```md
Can you you write me a plugin for Super Productivity that plays a beep sound every time i click on a header button (You need to add a header button via PluginAPI.registerHeaderButton).

Here are the docs: https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md

Don't use any PluginAPI methods that are not listed in the guide.

Please give me the output as flat zip file to download.
```
