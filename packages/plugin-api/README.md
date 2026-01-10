# @super-productivity/plugin-api

Official TypeScript definitions for developing [Super Productivity](https://github.com/super-productivity/super-productivity) plugins.

## Installation

```bash
npm install @super-productivity/plugin-api
```

## Usage

### TypeScript Plugin Development

```typescript
import type {
  PluginAPI,
  PluginManifest,
  PluginHooks,
} from '@super-productivity/plugin-api';

// Your plugin code with full type support
PluginAPI.registerHook(PluginHooks.TASK_COMPLETE, (taskData) => {
  console.log('Task completed!', taskData);

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
  "minSupVersion": "13.0.0",
  "description": "An awesome plugin for Super Productivity",
  "hooks": ["taskComplete", "taskUpdate"],
  "permissions": ["showSnack", "getTasks", "addTask", "showIndexHtmlAsView"],
  "iFrame": true,
  "icon": "icon.svg"
}
```

## Available Types

### Core Types

- `PluginAPI` - Main plugin API interface
- `PluginManifest` - Plugin configuration
- `PluginHooks` - Available hook types
- `PluginBaseCfg` - Runtime configuration

### Data Types

- `TaskData` - Task information
- `ProjectData` - Project information
- `TagData` - Tag information

### UI Types

- `DialogCfg` - Dialog configuration
- `SnackCfg` - Notification configuration
- `PluginMenuEntryCfg` - Menu entry configuration
- `PluginShortcutCfg` - Keyboard shortcut configuration

## Plugin Development Guide

### 1. Available Hooks

```typescript
enum PluginHooks {
  TASK_COMPLETE = 'taskComplete',
  TASK_UPDATE = 'taskUpdate',
  TASK_DELETE = 'taskDelete',
  FINISH_DAY = 'finishDay',
  LANGUAGE_CHANGE = 'languageChange',
  PERSISTED_DATA_UPDATE = 'persistedDataUpdate',
  ACTION = 'action',
}
```

### 2. Required Permissions

Add these to your manifest.json based on what your plugin needs:

- `showSnack` - Show notifications
- `notify` - System notifications
- `showIndexHtmlAsView` - Display plugin UI
- `openDialog` - Show dialogs
- `getTasks` - Read tasks
- `getArchivedTasks` - Read archived tasks
- `getCurrentContextTasks` - Read current context tasks
- `addTask` - Create tasks
- `getAllProjects` - Read projects
- `addProject` - Create projects
- `getAllTags` - Read tags
- `addTag` - Create tags
- `persistDataSynced` - Persist plugin data

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
```

## License

MIT - See the main Super Productivity repository for details.

## Contributing

Please contribute to the main [Super Productivity repository](https://github.com/super-productivity/super-productivity).
