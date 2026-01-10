# Solid.js Boilerplate Plugin for Super Productivity

A modern, TypeScript-based boilerplate for creating Super Productivity plugins using Solid.js.

## Features

- 🚀 **Solid.js** - Fast, reactive UI framework
- 📘 **TypeScript** - Full type safety with Super Productivity Plugin API
- 🎨 **Modern UI** - Clean, responsive design with dark mode support
- 🔧 **Vite** - Lightning-fast development and build tooling
- 📦 **Ready to Use** - Complete setup with examples for all plugin features

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Super Productivity 8.0.0+

### Installation

1. Clone this boilerplate:

```bash
cd packages/plugin-dev
cp -r boilerplate-solid-js my-plugin
cd my-plugin
```

2. Install dependencies:

```bash
npm install
```

3. Update plugin metadata in `src/manifest.json`:
   - Change `id` to a unique identifier
   - Update `name`, `description`, and `author`
   - Modify `permissions` and `hooks` as needed

### Development

Run the development server:

```bash
npm run dev
```

This starts Vite in watch mode. Your plugin will rebuild automatically when you make changes.

### Building

Build the plugin for production:

```bash
npm run build
```

This creates optimized files in the `dist/` directory.

### Packaging

Create a ZIP file for distribution:

```bash
npm run package
```

This will:

1. Build the plugin
2. Create a ZIP file containing all necessary files
3. Place the ZIP in the root directory

### Deployment (for Plugins with HTML UI)

If your plugin has an `index.html` file (for UI components, side panels, etc.), use the deploy command instead:

```bash
npm run deploy
```

This will:

1. Build the plugin
2. Inline all CSS and JavaScript assets into the HTML file
3. Create a ZIP file for distribution

**Note**: The `deploy` command is necessary for any plugin with HTML UI because Super Productivity loads plugin HTML as data URLs, which cannot access external files. The inline-assets script ensures all assets are embedded directly in the HTML.

## Project Structure

```
src/
├── assets/          # Static assets (icons, images)
│   └── icon.svg     # Plugin icon
├── app/             # Solid.js application
│   ├── App.tsx      # Main app component
│   └── App.css      # App styles
├── index.html       # Plugin UI entry point
├── index.ts         # UI initialization
├── plugin.ts        # Plugin logic and API integration
└── manifest.json    # Plugin metadata

scripts/            # Build and utility scripts
└── build-plugin.js  # Plugin packaging script

dist/               # Build output (gitignored)
├── assets/
├── index.html
├── index.js
├── plugin.js
└── manifest.json
```

## Plugin API Usage

### Basic Setup

The plugin API is exposed through the global `plugin` object in `plugin.ts`:

```typescript
import { PluginInterface } from '@super-productivity/plugin-api';

declare const plugin: PluginInterface;
```

### Common API Methods

#### UI Registration

```typescript
// Register header button
plugin.registerHeaderButton({
  icon: 'rocket',
  tooltip: 'Open Plugin',
  action: () => plugin.showIndexHtmlAsView(),
});

// Register menu entry
plugin.registerMenuEntry({
  label: 'My Plugin',
  icon: 'rocket',
  action: () => plugin.showIndexHtmlAsView(),
});

// Register keyboard shortcut
plugin.registerShortcut({
  keys: 'ctrl+shift+m',
  label: 'Open My Plugin',
  action: () => plugin.showIndexHtmlAsView(),
});
```

#### Data Operations

```typescript
// Get tasks
const tasks = await plugin.getTasks();
const archivedTasks = await plugin.getArchivedTasks();

// Create task
const newTask = await plugin.addTask({
  title: 'New Task',
  projectId: 'project-id',
});

// Update task
await plugin.updateTask('task-id', {
  title: 'Updated Title',
  isDone: true,
});

// Get projects and tags
const projects = await plugin.getAllProjects();
const tags = await plugin.getAllTags();
```

#### Event Hooks

```typescript
// Task completion
plugin.on('taskComplete', (task) => {
  console.log('Task completed:', task.title);
});

// Task updates
plugin.on('taskUpdate', (task) => {
  console.log('Task updated:', task);
});

// Context changes
plugin.on('contextChange', (context) => {
  console.log('Context changed:', context);
});
```

#### Communication with UI

In `plugin.ts`:

```typescript
plugin.onMessage('myCommand', async (data) => {
  // Handle message from UI
  return { result: 'success' };
});
```

In your Solid.js component:

```typescript
const sendMessage = async (type: string, payload?: any) => {
  return new Promise((resolve) => {
    const messageId = Math.random().toString(36).substr(2, 9);

    const handler = (event: MessageEvent) => {
      if (event.data.messageId === messageId) {
        window.removeEventListener('message', handler);
        resolve(event.data.response);
      }
    };

    window.addEventListener('message', handler);
    window.parent.postMessage({ type, payload, messageId }, '*');
  });
};

// Usage
const result = await sendMessage('myCommand', { foo: 'bar' });
```

## Customization

### Styling

The boilerplate includes:

- CSS custom properties for theming
- Dark mode support
- Responsive design
- Minimal, clean styling

Modify `src/app/App.css` to customize the appearance.

### Adding Features

1. **New UI Components**: Add them in `src/app/` as `.tsx` files
2. **New API Endpoints**: Add handlers in `src/plugin.ts` using `plugin.onMessage()`
3. **New Hooks**: Register them in `manifest.json` and handle in `plugin.ts`
4. **Permissions**: Add required permissions to `manifest.json`

## Best Practices

1. **Type Safety**: Always use TypeScript types from `@super-productivity/plugin-api`
2. **Error Handling**: Wrap async operations in try-catch blocks
3. **Performance**: Use Solid.js signals and effects efficiently
4. **Security**: Never expose sensitive data or operations
5. **User Experience**: Provide loading states and error feedback

## Deployment

1. Build the plugin: `npm run build`
2. Package it: `npm run package`
3. Upload the ZIP file to Super Productivity:
   - Open Super Productivity
   - Go to Settings → Plugins
   - Click "Upload Plugin"
   - Select your ZIP file

## Troubleshooting

### Plugin not loading

- Check browser console for errors
- Verify `manifest.json` is valid JSON
- Ensure `minSupVersion` matches your Super Productivity version

### API calls failing

- Check if you have required permissions in `manifest.json`
- Verify Super Productivity is running the correct version
- Look for error messages in the console

### Build errors

- Run `npm run typecheck` to check for TypeScript errors
- Ensure all dependencies are installed
- Clear `node_modules` and reinstall if needed

## Resources

- [Super Productivity Plugin API Documentation](https://github.com/super-productivity/super-productivity)
- [Solid.js Documentation](https://www.solidjs.com/docs/latest)
- [Vite Documentation](https://vitejs.dev/)

## License

This boilerplate is provided as-is for creating Super Productivity plugins. Feel free to modify and distribute your plugins as you see fit.
