# @super-productivity/plugin-api

Official TypeScript definitions for developing [Super Productivity](https://github.com/super-productivity/super-productivity) plugins.

Versioned like the app: version X.Y.Z describes the plugin API of Super
Productivity X.Y.Z. Your manifest's `minSupVersion` is the oldest app version
your plugin installs on: set it to the oldest version that has every method you
use, not simply the version you installed. (Versions before 19 were published
separately and are outdated: if your `package.json` says `^1.0.1`, change it.)

New to plugins? Start from the
[plugin starter](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-starter)
and the
[plugin development guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md).
The complete API, with comments, is
[`src/types.ts`](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts).

## Installation

```bash
npm install --save-dev @super-productivity/plugin-api
```

## Usage

### Plain JavaScript (`plugin.js`)

The app provides a global `PluginAPI`. Reference the global types at the top of
your file for autocomplete and, with `// @ts-check`, type checking:

```javascript
// @ts-check
/// <reference types="@super-productivity/plugin-api/global" />

PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, (payload) => {
  console.log('Task completed!', payload.taskId);
});
```

Code inside a plugin's iframe (`index.html`) gets a filtered subset of the API;
see "Iframe API Surface" in the guide.

### TypeScript

Declare the global yourself, or instead put
`/// <reference types="@super-productivity/plugin-api/global" />` at the very
top of the file and drop the `declare const` line:

```typescript
import { PluginHooks } from '@super-productivity/plugin-api';
import type { PluginAPI as PluginAPIType } from '@super-productivity/plugin-api';

declare const PluginAPI: PluginAPIType;

PluginAPI.registerHook(PluginHooks.TASK_COMPLETE, (payload) => {
  PluginAPI.showSnack({
    msg: 'Task completed successfully!',
    type: 'SUCCESS',
    ico: 'celebration',
  });
});

// Register a header button
PluginAPI.registerHeaderButton({
  label: 'My Plugin',
  icon: 'extension',
  onClick: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});

// Add an action to task and subtask context menus
PluginAPI.registerTaskContextMenuEntry({
  id: 'copy-external-link',
  label: 'Copy external link',
  icon: 'link', // Optional Material icon ligature name; custom SVGs are not supported
  showFor: ['TASK'], // Omit for both targets; [] is invalid
  onClick: ({ taskId }) => {
    console.log('Selected task:', taskId);
  },
});

// Register a keyboard shortcut
PluginAPI.registerShortcut({
  id: 'my_shortcut',
  label: 'My Custom Shortcut',
  onExec: () => {
    PluginAPI.showSnack({
      msg: 'Shortcut executed!',
      type: 'SUCCESS',
    });
  },
});
```

### Plugin Manifest

```json
{
  "name": "My Awesome Plugin",
  "id": "my-awesome-plugin",
  "manifestVersion": 1,
  "version": "1.0.0",
  "minSupVersion": "19.3.0",
  "author": "Your Name",
  "description": "An awesome plugin for Super Productivity",
  "hooks": ["taskComplete", "taskUpdate"],
  "permissions": ["showSnack", "getTasks", "addTask", "showIndexHtmlAsView"],
  "iFrame": true,
  "uiKit": true,
  "icon": "icon.svg"
}
```

## Available Types

### Core Types

- `PluginAPI` - Main plugin API interface
- `PluginManifest` - Plugin configuration
- `PluginHooks` - Available hook types
- `PluginBaseCfg` - Runtime configuration
- `PluginTaskContextMenuEntryCfg` - Task context-menu action configuration
- `PluginTaskContextMenuContext` - Context passed to a task action
- `PluginTaskContextMenuTarget` - Supported task-menu targets

### Data Types

- `TaskData` - Task information
- `ProjectData` - Project information
- `TagData` - Tag information

### UI Types

- `DialogCfg` - Dialog configuration
- `DialogResult` - Dialog return value
- `SnackCfg` - Notification configuration
- `PluginMenuEntryCfg` - Menu entry configuration
- `PluginShortcutCfg` - Keyboard shortcut configuration

## Plugin Development Guide

### 1. Available Hooks

See `PluginHooks` in
[`src/types.ts`](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts)
for the full list and each hook's payload type.

**`PERSISTED_DATA_CHANGED`** fires on any persistent-data change to this
plugin after the host has finished its initial boot load — including
remote sync deliveries and bulk imports. Handler receives no payload;
re-call `loadSyncedData(key?)` for any key your plugin tracks to get
fresh data (scoped to the calling plugin). Contract: call
`loadSyncedData()` on plugin init for the initial state; then use this
hook for subsequent changes. There is no replay-on-register, no
per-key discrimination in the event, and no guaranteed ordering across
rapid changes. Handlers must be idempotent.

### 2. Permissions

List the permissions your plugin uses in manifest.json. The app checks only
three of them: `nodeExecution` (a desktop consent prompt), `http` together with
`allowedHosts` (gates `PluginAPI.request` only) and `deleteProject` (gates that
call only). The others are shown in the plugin's details but not enforced.
Plugins are not sandboxed, so no permission limits what plugin code can read or
change; see
[Security Considerations](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md#security-considerations).

- `nodeExecution` - Run Node.js scripts (desktop only, after the user allows it)
- `http` - Send `PluginAPI.request` calls to the hosts listed in `allowedHosts`
- `showSnack` - Show notifications
- `notify` - System notifications
- `showIndexHtmlAsView` - Display plugin UI
- `openDialog` - Show dialogs
- `getTasks` - Read tasks
- `getArchivedTasks` - Read archived tasks
- `getCurrentContextTasks` - Read current context tasks
- `getSelectedTask` - Read the task selected in the task detail panel
- `getFocusedTask` - Read the currently focused task row, if any
- `addTask` - Create tasks
- `getAllProjects` - Read projects
- `addProject` - Create projects
- `deleteProject` - Delete a project and everything it contains (irreversible)
- `getAllTags` - Read tags
- `addTag` - Create tags
- `persistDataSynced` - Persist plugin data
- `getAppState` - Read-only snapshot of application state

### 3. Plugin Structure

```
my-plugin/
├── manifest.json
├── plugin.js
├── index.html (optional, if iFrame: true)
└── icon.svg (optional)
```

### 4. Example Plugin

```javascript
// plugin.js
console.log('My Plugin initializing...', PluginAPI);

// Register hook for task completion
PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, function (taskData) {
  console.log('Task completed!', taskData);

  PluginAPI.showSnack({
    msg: '🎉 Task completed!',
    type: 'SUCCESS',
    ico: 'celebration',
  });
});

// Register header button
PluginAPI.registerHeaderButton({
  label: 'My Plugin',
  icon: 'dashboard',
  onClick: function () {
    PluginAPI.showIndexHtmlAsView();
  },
});

// Read full app state
const state = await PluginAPI.getAppState();
```

## License

MIT - See the main Super Productivity repository for details.

## Contributing

Please contribute to the main [Super Productivity repository](https://github.com/super-productivity/super-productivity).
