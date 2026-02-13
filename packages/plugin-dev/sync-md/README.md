# Sync-MD Plugin v2.0.0

A SuperProductivity plugin that enables bidirectional synchronization between markdown files and project tasks.

## Features

- **Bidirectional Sync**: Keep markdown files and SuperProductivity tasks in sync
- **Batch API Integration**: Efficient bulk operations for better performance
- **Smart Debouncing**: 10-second delays prevent conflicts during active editing
- **Real-time Monitoring**: File system watching with automatic sync triggers
- **Task Hierarchy**: Preserves parent-child relationships in markdown
- **Modern Architecture**: Built with Solid.js UI and modular TypeScript

## Quick Start

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev:watch

# Build for production
npm run build

# Package as plugin
npm run package
```

## Architecture

### Core Components

- `src/fileWatcherBatch.ts` - Main sync engine with batch API support
- `src/background.ts` - Plugin lifecycle and message handling
- `src/App.tsx` - Solid.js UI for configuration
- `src/utils/` - Reusable utilities (parser, debouncer, file ops)

### Build System

- `build-proper.js` - Main build script
- `build-plugin.js` - Package as distributable ZIP
- `watch-and-build.js` - Development with auto-rebuild

## Configuration

```typescript
{
  projectId: "project-uuid",
  filePath: "/path/to/tasks.md",
  syncDirection: "fileToProject" | "projectToFile" | "bidirectional"
}
```

## Markdown Format

```markdown
- [ ] Parent task
  - [x] <!-- sp:task-id --> Completed subtask
  - [ ] Pending subtask
```

Tasks are linked using HTML comments containing unique IDs.

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Cleanup

To remove old/unnecessary files after updating:

```bash
chmod +x cleanup.sh
./cleanup.sh
```
