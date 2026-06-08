# Plugin API Development Guide

## For Plugin Developers

### Installation

```bash
npm install @super-productivity/plugin-api
```

### TypeScript Setup

Create a `tsconfig.json` in your plugin project:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Basic Plugin Structure

```
my-plugin/
├── src/
│   └── plugin.ts
├── dist/
│   └── plugin.js
├── manifest.json
├── index.html (optional)
├── icon.svg (optional)
├── package.json
└── tsconfig.json
```

### Development Workflow

1. **Write TypeScript code** with full type safety
2. **Compile to JavaScript** for Super Productivity
3. **Test in Super Productivity** plugin system

### Example Build Script

Add to your `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "@super-productivity/plugin-api": "^1.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Plugin Template

See `example/my-plugin.ts` for a complete TypeScript plugin example.

## For Core Developers

### Updating the API

When adding new features to the plugin system:

1. **Update `src/types.ts`** with new interfaces/types
2. **Update `src/index.ts`** to export new types
3. **Update `README.md`** with usage examples
4. **Version bump** the package
5. **Rebuild and test**
6. **Publish to npm**

### Syncing with Main Project

The main Super Productivity project should eventually import types from this package instead of maintaining local definitions:

```typescript
// Before:
import { PluginManifest } from './plugin-api.model';

// After:
import type { PluginManifest } from '@super-productivity/plugin-api';
```

### Testing Changes

1. Build the package: `npm run build`
2. Test locally: `npm link` in this directory
3. In test project: `npm link @super-productivity/plugin-api`
4. Verify types work correctly

### Release Process

1. Update version: `npm version patch|minor|major`
2. Build: `npm run build`
3. Test: `npm pack --dry-run`
4. Publish: `npm publish --access public`

## Available Types Reference

### Core Interfaces

- `PluginAPI` - Main API interface
- `PluginManifest` - Plugin configuration
- `PluginBaseCfg` - Runtime configuration

### Hook Types

- `PluginHooks` - Available hook events
- `PluginHookHandler` - Hook function signature

### Data Types

- `TaskData` - Task information
- `ProjectData` - Project information
- `TagData` - Tag information
- `PluginCreateTaskData` - Task creation data

### UI Types

- `DialogCfg` - Dialog configuration
- `DialogResult` - Dialog return value
- `DialogButtonCfg` - Dialog button configuration
- `SnackCfg` - Notification configuration
- `NotifyCfg` - System notification configuration
- `PluginMenuEntryCfg` - Menu entry configuration
- `PluginShortcutCfg` - Keyboard shortcut configuration
- `PluginHeaderBtnCfg` - Header button configuration

## Best Practices

1. **Always use TypeScript** for plugin development
2. **Import types only** to avoid runtime dependencies
3. **Follow semantic versioning** for plugin releases
4. **Test thoroughly** before publishing
5. **Document your plugins** for other developers
