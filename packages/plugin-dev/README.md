# Super Productivity Plugin Development

This directory contains tools and examples for developing plugins for Super Productivity.

## Quick Commands

```bash
# Build all plugins
npm run build

# Install dependencies for all plugins
npm run install:all

# Clean build artifacts
npm run clean:dist

# List available plugins
npm run list
```

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- TypeScript knowledge (recommended)

### Quick Start

1. **Copy the example plugin**:

   ```bash
   cp -r example-plugin my-plugin
   cd my-plugin
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Update plugin metadata**:
   - Edit `manifest.json` with your plugin details
   - Update `package.json` with your plugin name and description

4. **Start development**:

   ```bash
   npm run dev
   ```

5. **Build for production**:
   ```bash
   npm run build
   ```

## Project Structure

```
my-plugin/
├── package.json          # NPM package configuration
├── tsconfig.json         # TypeScript configuration
├── webpack.config.js     # Build configuration
├── manifest.json         # Plugin manifest (metadata)
├── src/
│   └── index.ts         # Main plugin code
├── assets/
│   ├── index.html       # Optional UI (for iframe plugins)
│   └── icon.svg         # Plugin icon
├── scripts/
│   └── package.js       # Script to create plugin.zip
└── dist/                # Build output
    ├── plugin.js        # Compiled plugin code
    ├── manifest.json    # Copied manifest
    └── plugin.zip       # Packaged plugin
```

## Development Workflow

### 1. Local Development

For rapid development within the Super Productivity repo:

```bash
# Build and install to local Super Productivity
npm run install-local

# This copies your built plugin to:
# ../../../src/assets/my-plugin/
```

Then run Super Productivity in development mode to test your plugin.

### 2. Watch Mode

Keep the plugin building automatically as you make changes:

```bash
npm run dev
```

### 3. Type Checking

Ensure your code is type-safe:

```bash
npm run typecheck
```

### 4. Linting

Check code quality:

```bash
npm run lint
```

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
npm run package
```

This creates `dist/plugin.zip` ready for distribution.

### 2. File Size Limits

- Plugin ZIP: 50MB maximum
- Plugin code (plugin.js): 10MB maximum
- Manifest: 100KB maximum
- index.html: 100KB maximum

### 3. Required Files

Your plugin ZIP must contain:

- `manifest.json` - Plugin metadata
- `plugin.js` - Main plugin code

Optional files:

- `index.html` - UI for iframe plugins
- `icon.svg` - Plugin icon
- `i18n/*.json` - Translation files for multi-language support

## Publishing Your Plugin

### GitHub Release (Recommended)

1. Create a GitHub repository for your plugin
2. Use GitHub Actions to build releases:

```yaml
name: Build Plugin
on:
  release:
    types: [created]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - run: npm run package
      - uses: softprops/action-gh-release@v1
        with:
          files: dist/plugin.zip
```

3. Users can download the `.zip` file from your releases

### NPM Package

You can also publish your plugin source to npm:

1. Update `package.json` with your npm scope
2. Build your plugin: `npm run build`
3. Publish: `npm publish`

Users would need to build it themselves or you can include the built files.

## Testing Your Plugin

### 1. In Development Mode

```bash
# Build your plugin
npm run build

# Copy to Super Productivity assets
npm run install-local

# Run Super Productivity in dev mode
cd ../../.. && npm start
```

### 2. In Production Build

1. Build your plugin: `npm run package`
2. Open Super Productivity
3. Go to Settings → Plugins
4. Click "Upload Plugin"
5. Select your `plugin.zip` file

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
- Check webpack.config.js for errors
- Ensure all dependencies are installed

## Examples

### Available Examples

1. **minimal-plugin** - The simplest possible plugin (10 lines)
2. **simple-typescript-plugin** - TypeScript with minimal tooling
3. **example-plugin** - Full featured example with webpack
4. **procrastination-buster** - SolidJS plugin with modern UI

### Example Features

**example-plugin** demonstrates:

- TypeScript setup with webpack
- All API methods
- iframe UI integration
- State persistence
- Hook handling
- Build configuration

**procrastination-buster** demonstrates:

- SolidJS for reactive UI
- Vite for fast builds
- Modern component architecture
- Plugin-to-iframe communication
- Real-world use case

## Support

- GitHub Issues: [Super Productivity Issues](https://github.com/super-productivity/super-productivity/issues)
- Plugin API Docs: See `packages/plugin-api/README.md`
