# Super Productivity Plugin Development

This directory contains tools and examples for developing plugins for Super Productivity.

## Quick Commands

```bash
# Build all plugins
npm run build

# Install dependencies for all plugins (one shared npm workspace)
npm run install:all

# Clean build artifacts
npm run clean:dist

# List available plugins
npm run list
```

Every plugin folder (and `issue-provider-kit`) is an npm workspace of this
directory: one `package-lock.json` and one `node_modules` here serve all plugins.
`npm install` from any plugin folder updates that shared lockfile; commit it with
the plugin's `package.json`. This directory is deliberately not a workspace of
the repository root, so plugin tooling stays out of the app's install.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm (the shared lockfile is npm's)
- TypeScript knowledge (recommended)

### Quick Start

See [QUICK_START.md](QUICK_START.md): copy the existing plugin closest to what you
want to build, then edit its `manifest.json` and `package.json`.

## Project Structure

A TypeScript host-side plugin (e.g. [github-issue-provider](github-issue-provider)):

```
my-plugin/
├── package.json          # "build": "node ../scripts/build-with-esbuild.js"
├── tsconfig.json         # extends ../tsconfig.base.json
├── icon.svg              # Plugin icon
├── i18n/                 # Translation files (en.json required)
├── src/
│   ├── manifest.json     # Plugin manifest (metadata)
│   └── plugin.ts         # Main plugin code
└── dist/                 # Build output (plugin.js, manifest.json, icon.svg, i18n/)
```

The shared build script and tsconfig live next to the plugins
([scripts/build-with-esbuild.js](scripts/build-with-esbuild.js),
[tsconfig.base.json](tsconfig.base.json)) and are referenced by relative path, so
develop plugins inside this folder. SolidJS/Vite plugins such as
[boilerplate-solid-js](boilerplate-solid-js) use
[`@super-productivity/vite-plugin`](../vite-plugin) instead.

## Development Workflow

Scripts vary per plugin; check its `package.json`. Most TypeScript plugins have:

```bash
npm run build       # → dist/
npm run typecheck   # tsc --noEmit
npm test            # if the plugin has tests
```

Vite plugins (e.g. [boilerplate-solid-js](boilerplate-solid-js)) also have
`npm run dev` for watch mode.

## Plugin API

The plugin receives a global `PluginAPI` object with these capabilities:

### Configuration

- `cfg` - Current app configuration (theme, platform, version)

### UI Integration

- `registerMenuEntry()` - Add menu items
- `registerHeaderButton()` - Add header buttons
- `registerSidePanelButton()` - Add side panel buttons
- `registerShortcut()` - Register keyboard shortcuts
- `showIndexHtmlAsView()` - Display plugin UI

### Data Access

- `getTasks()` - Get all tasks
- `getArchivedTasks()` - Get archived tasks
- `getCurrentContextTasks()` - Get current project/tag tasks
- `updateTask()` - Update a task
- `addTask()` - Create new task
- `getAllProjects()` - Get all projects
- `getAllTags()` - Get all tags

### User Interaction

- `showSnack()` - Display snack bar notifications
- `notify()` - Show system notifications
- `openDialog()` - Open custom dialogs

### Data Persistence

- `persistDataSynced()` - Save plugin data
- `loadSyncedData()` - Load saved data

### Internationalization (i18n)

- `translate(key, params?)` - Get translated text
- `formatDate(date, format)` - Format dates with locale
- `getCurrentLanguage()` - Get current language code

See [PLUGIN_I18N.md](PLUGIN_I18N.md) for the complete i18n guide.

### Hooks

Register handlers for lifecycle events:

- `taskComplete` - Task marked as done
- `taskUpdate` - Task modified
- `taskDelete` - Task removed
- `currentTaskChange` - Active task changed
- `languageChange` - App language changed
- `finishDay` - End of day

### Example Usage

```typescript
// Register a task complete handler
PluginAPI.registerHook('taskComplete', async (task) => {
  console.log('Task completed:', task);

  PluginAPI.showSnack({
    msg: `Great job completing: ${task.title}`,
    type: 'SUCCESS',
  });
});

// Add a keyboard shortcut
PluginAPI.registerShortcut({
  id: 'my-action',
  label: 'My Plugin Action',
  onExec: async () => {
    const tasks = await PluginAPI.getTasks();
    console.log(`You have ${tasks.length} tasks`);
  },
});

// Use translations (if plugin has i18n support)
const greeting = PluginAPI.translate('MESSAGES.GREETING');
const taskCount = PluginAPI.translate('TASK_COUNT', { count: tasks.length });
const dueDate = PluginAPI.formatDate(task.dueDate, 'short');
```

## Building for Distribution

### 1. Create Plugin Package

```bash
npm run build
rm -f plugin.zip && (cd dist && zip -r ../plugin.zip .)
```

[boilerplate-solid-js](boilerplate-solid-js) and [automations](automations) also
have `npm run package`, which writes `<id>-v<version>.zip`.

### 2. File Size Limits

- Plugin ZIP: 50MB maximum
- Plugin code (plugin.js): 10MB maximum
- Manifest: 100KB maximum
- index.html: 100KB maximum

### 3. Required Files

Your plugin ZIP must contain:

- `manifest.json` - Plugin metadata
- `plugin.js` - Main plugin code, unless this is an iframe-only plugin with `iFrame: true`
  and `index.html`

Optional files:

- `index.html` - UI for iframe plugins
- `icon.svg` - Plugin icon
- `i18n/*.json` - Translation files for multi-language support

## Publishing Your Plugin

Build and zip the plugin here (see above) and share the zip, e.g. as a GitHub
release asset; users install it via Settings → Plugins → Upload Plugin.

Building in a separate repository needs its own build setup: the examples here
use relative paths to the shared build script, tsconfig, `issue-provider-kit` and
`../../plugin-api`, and the published `@super-productivity/plugin-api` npm
package lags behind the source (it lacks the issue-provider types).

## Testing Your Plugin

### 1. Upload

1. Build and zip your plugin (see above)
2. Open Super Productivity
3. Go to Settings → Plugins
4. Click "Upload Plugin"
5. Select your `plugin.zip` file

### 2. As a Bundled Plugin (repository development)

`npm run build:packages` (repository root) builds the plugins here (not the
boilerplate) and copies each `dist/` to `src/assets/bundled-plugins/<folder>/`.
The app only loads folders listed in `BUNDLED_PLUGIN_PATHS`, and each one's
manifest id must also be in `BUNDLED_PLUGIN_IDS` (both in
`src/app/plugins/bundled-plugins.const.ts`; `npm run test:electron` checks they
match); then run `npm run startFrontend` or `npm start`.

### 3. Debugging

- Open browser DevTools to see console logs
- Check the Console for plugin errors
- Use `console.log()` in your plugin code
- The plugin runs in the main window context

## TypeScript Development

### Benefits

1. **Type Safety**: Full IntelliSense and compile-time checking
2. **API Discovery**: Auto-complete for all PluginAPI methods
3. **Refactoring**: Safe code refactoring with TypeScript
4. **Documentation**: Inline documentation in your IDE

### Example with Types

```typescript
import type { TaskData, ProjectData } from '@super-productivity/plugin-api';

// Type-safe task handling
async function processTask(task: TaskData): Promise<void> {
  if (task.projectId) {
    const projects = await PluginAPI.getAllProjects();
    const project = projects.find((p) => p.id === task.projectId);

    if (project) {
      console.log(`Task "${task.title}" belongs to project "${project.title}"`);
    }
  }
}

// Type-safe hook registration
PluginAPI.registerHook('taskUpdate', (data: unknown) => {
  const task = data as TaskData;
  processTask(task);
});
```

## Best Practices

1. **Error Handling**: Always wrap async operations in try-catch
2. **Performance**: Don't block the main thread with heavy computations
3. **State Management**: Use `persistDataSynced()` for plugin state
4. **User Experience**: Provide clear feedback with snack messages
5. **Permissions**: Only request permissions you actually need
6. **Version Compatibility**: Set appropriate `minSupVersion`
7. **Internationalization**: Add i18n support to reach more users (see [PLUGIN_I18N.md](PLUGIN_I18N.md))

## Troubleshooting

### Plugin not loading

- Check browser console for errors
- Verify manifest.json is valid JSON
- Ensure all required fields are present
- Check file size limits

### TypeScript errors

- Run `npm run typecheck` to see all errors
- Ensure `@super-productivity/plugin-api` is installed
- Check tsconfig.json settings

### Build issues

- Delete `dist/` and rebuild
- Check the plugin's build script (`npm run build`) output for errors
- Ensure all dependencies are installed

## Examples

### Available Examples

1. **yesterday-tasks-plugin** - Plain JavaScript, no build step
2. **github-issue-provider** - TypeScript issue provider using the shared esbuild build
3. **todoist-import** - TypeScript iframe UI inlined into `index.html`, no framework
4. **boilerplate-solid-js** - Modern Solid.js boilerplate with i18n support
5. **procrastination-buster** - SolidJS plugin with modern UI

### Example Features

**boilerplate-solid-js** demonstrates:

- SolidJS for reactive UI
- Vite for fast builds
- Internationalization (i18n) support with example translations
- Modern component architecture
- Plugin-to-iframe communication
- Best practices for plugin development

**procrastination-buster** demonstrates:

- SolidJS for reactive UI
- Vite for fast builds
- Modern component architecture
- Plugin-to-iframe communication
- Real-world use case

## Support

- GitHub Issues: [Super Productivity Issues](https://github.com/super-productivity/super-productivity/issues)
- Plugin API Docs: See `packages/plugin-api/README.md`
