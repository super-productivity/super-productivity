# Plugin System: View-Adapter API for Task Grouping

**Date:** 2026-01-20
**Approach:** Option B - Simpler view-adapter API (not full wrapping system)
**Estimated Complexity:** ~500 lines of code

## Overview

Enable plugins to provide custom task grouping (e.g., sections, kanban boards) while core handles all rendering. Plugins provide **grouping logic**, core provides **UI rendering**.

**Key Benefits:**

- Simple: Reuses existing TaskViewCustomizerService infrastructure
- Performant: No iframe-per-slot, just function calls
- Sync-compatible: Plugin state via existing persistDataSynced()
- Type-safe: Full TypeScript support via PluginAPI

## Architecture

```
Plugin (JS code)
  ↓ registerTaskGrouping({ id, label, groupFn })
PluginTaskGroupingService (new)
  ↓ exposes groupingOptions signal
TaskViewCustomizerService (modified)
  ↓ calls plugin groupFn when selected
WorkViewComponent (minimal template changes)
  ↓ renders groups using existing <collapsible> + <task-list>
```

## Implementation Plan

### Task 1: Create Core Grouping Service

**File:** `src/app/plugins/plugin-task-grouping.service.ts` (NEW, ~150 lines)

**What it does:**

- Stores plugin grouping registrations in a signal
- Exposes `groupingOptions()` for UI integration
- Provides `applyPluginGrouping(id, tasks)` to execute grouping
- Implements caching (1 second) and timeout (5 seconds) for performance
- Cleans up when plugins are unloaded

**Key types:**

```typescript
interface PluginTaskGrouping {
  id: string;
  label: string;
  icon?: string;
  groupFn: (tasks: Task[]) => Promise<PluginTaskGroup[]> | PluginTaskGroup[];
  getGroupMetadata?: (groupKey: string) => PluginGroupMetadata;
}

interface PluginTaskGroup {
  key: string;
  label: string;
  tasks: Task[];
  icon?: string;
  color?: string;
  order?: number;
}
```

**Verification:**

- Unit test: Register grouping, verify it appears in groupingOptions()
- Unit test: applyPluginGrouping returns correct format
- Unit test: Timeout protection (mock slow groupFn)
- Unit test: Caching works (same tasks = cached result)

---

### Task 2: Extend PluginAPI

**Files to modify:**

- `src/app/plugins/plugin-api.ts` (~30 lines)
- `src/app/plugins/plugin-bridge.service.ts` (~20 lines)
- `packages/plugin-api/src/types.ts` (~40 lines)

**Changes:**

1. **Add method to PluginAPI class:**

```typescript
registerTaskGrouping(grouping: PluginTaskGrouping): void {
  this._sendMessage({
    type: 'API_CALL',
    method: 'registerTaskGrouping',
    args: [this._pluginId, grouping],
  });
}

unregisterTaskGrouping(id: string): void {
  // ...
}
```

2. **Add to PluginBridgeService.createBoundMethods():**

```typescript
registerTaskGrouping: (grouping: PluginTaskGrouping) => {
  this._pluginTaskGroupingService.registerGrouping(pluginId, grouping);
},
```

3. **Export types in packages/plugin-api:**

```typescript
export interface PluginTaskGrouping {
  /* ... */
}
export interface PluginTaskGroup {
  /* ... */
}
export interface PluginGroupMetadata {
  /* ... */
}
```

**Verification:**

- Build plugin-api package: `npm run build:plugin-api`
- TypeScript types are exported
- Integration test: Plugin can call registerTaskGrouping()

---

### Task 3: Integrate with TaskViewCustomizerService

**File:** `src/app/features/task-view-customizer/task-view-customizer.service.ts` (~50 lines modified)

**Changes:**

1. **Inject PluginTaskGroupingService:**

```typescript
private _pluginGroupingService = inject(PluginTaskGroupingService);
```

2. **Expose combined grouping options:**

```typescript
public availableGroupOptions = computed(() => {
  const builtIn = OPTIONS.group.list;
  const pluginOptions = this._pluginGroupingService.groupingOptions();
  return [...builtIn, ...pluginOptions];
});
```

3. **Update applyGrouping to handle plugin groupings:**

```typescript
private async applyGrouping(
  tasks: TaskWithSubTasks[],
  groupType: GROUP_OPTION_TYPE | null,
  pluginGroupingId?: string,
): Promise<Record<string, TaskWithSubTasks[]>> {
  if (groupType === GROUP_OPTION_TYPE.plugin && pluginGroupingId) {
    return this._pluginGroupingService.applyPluginGrouping(
      pluginGroupingId,
      tasks,
    );
  }

  // Existing built-in grouping logic unchanged...
}
```

**Files to modify:**

- `src/app/features/task-view-customizer/types.ts` (~10 lines)
  - Add `plugin` to GROUP_OPTION_TYPE enum
  - Add `pluginId?` and `pluginGroupingId?` to GroupOption interface

**Verification:**

- Start app with test plugin
- Plugin grouping appears in customizer dropdown
- Selecting plugin grouping applies grouping correctly
- Console shows no errors

---

### Task 4: Update Work View Template

**File:** `src/app/features/work-view/work-view.component.html` (~10 lines modified)

**Changes:**

1. **Create metadata pipe** (NEW file: `src/app/ui/pipes/plugin-group-metadata.pipe.ts`, ~40 lines):

```typescript
@Pipe({ name: 'pluginGroupMetadata', standalone: true })
export class PluginGroupMetadataPipe implements PipeTransform {
  transform(groupKey: string): { label: string; icon?: string } {
    // Gets metadata from plugin or falls back to groupKey
  }
}
```

2. **Update template to use metadata:**

```html
@for (group of customized.grouped | keyvalue; track group.key) { @let metadata = group.key
| pluginGroupMetadata;
<collapsible
  [title]="metadata.label"
  [icon]="metadata.icon"
  [isIconBefore]="true"
  [isExpanded]="true"
>
  <task-list
    [tasks]="group.value"
    listId="PARENT"
    listModelId="UNDONE"
  ></task-list>
</collapsible>
}
```

**Verification:**

- Plugin-provided group labels render correctly
- Icons appear if provided by plugin
- Built-in groups still work (backward compatibility)

---

### Task 5: Plugin Cleanup Integration

**File:** `src/app/plugins/plugin-cleanup.service.ts` (~10 lines)

**Changes:**

Add cleanup of groupings when plugin is unloaded:

```typescript
unload(pluginId: string): void {
  // ... existing cleanup ...
  this._pluginTaskGroupingService.cleanupPlugin(pluginId);
}
```

**Verification:**

- Disable plugin in settings
- Plugin grouping option disappears from UI
- No memory leaks (check with Chrome DevTools)

---

### Task 6: Documentation & Example Plugin

**Files to create:**

1. **`docs/plugin-api-task-grouping.md`** (~100 lines)
   - API reference for registerTaskGrouping
   - Type definitions
   - Best practices (performance, state management)
   - Complete sections plugin example

2. **`packages/plugin-dev/sections-plugin-example/`** (example plugin)
   - `manifest.json`
   - `plugin.js` - Implements sections grouping
   - `README.md` - Usage instructions
   - Demonstrates:
     - Registering grouping
     - Persisting section assignments via persistDataSynced()
     - Using ANY_TASK_UPDATE hook to refresh grouping

**Verification:**

- Build example plugin
- Install in app
- Create sections, assign tasks
- Verify sections sync across browser tabs (persistDataSynced)
- Verify sections work after app reload

---

## Critical Files Summary

**New files (~290 lines):**

- `src/app/plugins/plugin-task-grouping.service.ts` (~150 lines)
- `src/app/ui/pipes/plugin-group-metadata.pipe.ts` (~40 lines)
- `docs/plugin-api-task-grouping.md` (~100 lines)

**Modified files (~200 lines changes):**

- `src/app/plugins/plugin-api.ts` (~30 lines)
- `src/app/plugins/plugin-bridge.service.ts` (~20 lines)
- `src/app/features/task-view-customizer/task-view-customizer.service.ts` (~50 lines)
- `src/app/features/task-view-customizer/types.ts` (~10 lines)
- `src/app/features/work-view/work-view.component.html` (~10 lines)
- `src/app/plugins/plugin-cleanup.service.ts` (~10 lines)
- `packages/plugin-api/src/types.ts` (~40 lines)

**Total: ~490 lines** ✓

---

## Example: Sections Plugin

```typescript
// sections-plugin.js
let taskSections = {}; // { taskId: sectionName }

// Load persisted section assignments
plugin.loadPersistedData().then((data) => {
  taskSections = data ? JSON.parse(data) : {};
});

// Register grouping
plugin.registerTaskGrouping({
  id: 'sections',
  label: 'By Section',
  icon: 'category',

  groupFn: async (tasks) => {
    const groups = new Map();
    const sectionOrder = ['Urgent', 'Today', 'This Week', 'Backlog'];

    for (const task of tasks) {
      const section = taskSections[task.id] || 'Uncategorized';
      if (!groups.has(section)) {
        groups.set(section, []);
      }
      groups.get(section).push(task);
    }

    return Array.from(groups.entries()).map(([key, tasks]) => ({
      key,
      label: key,
      tasks,
      icon: key === 'Urgent' ? 'priority_high' : 'folder',
      order: sectionOrder.indexOf(key),
    }));
  },

  getGroupMetadata: (groupKey) => ({
    label: groupKey,
    icon: groupKey === 'Urgent' ? 'priority_high' : 'folder',
  }),
});

// Helper: Assign task to section
async function setTaskSection(taskId, sectionName) {
  taskSections[taskId] = sectionName;
  await plugin.persistDataSynced(JSON.stringify(taskSections));
}

// Provide UI to move tasks (via header button)
plugin.registerHeaderButton({
  label: 'Manage Sections',
  icon: 'category',
  onClick: () => {
    plugin.showIndexHtmlAsView(); // Show section management UI
  },
});
```

---

## Testing Strategy

### Unit Tests

**PluginTaskGroupingService:**

- Registration adds grouping to signal
- applyPluginGrouping executes groupFn correctly
- Timeout protection (5s limit)
- Caching works (same task IDs = cached result)
- Cleanup removes all groupings for plugin

**PluginGroupMetadataPipe:**

- Returns metadata for plugin groups
- Falls back for built-in groups
- Handles missing metadata gracefully

### Integration Tests

**E2E test:** `e2e/tests/plugins/task-grouping.spec.ts`

- Load test plugin with grouping
- Select plugin grouping in customizer
- Verify tasks are grouped correctly in UI
- Verify groups have correct labels/icons
- Disable plugin → grouping option disappears

### Manual Testing Checklist

- [ ] Plugin grouping appears in customizer dropdown
- [ ] Selecting grouping shows tasks in groups
- [ ] Group labels and icons render correctly
- [ ] Collapsible groups work (expand/collapse)
- [ ] Drag-drop resets grouping (existing behavior)
- [ ] Plugin data syncs across browser tabs
- [ ] Groups persist after page reload (via persistDataSynced)
- [ ] Disabling plugin removes grouping option
- [ ] No console errors or warnings
- [ ] Performance: 100+ tasks group in < 1 second

---

## Performance Considerations

**Timeout protection:**

- groupFn execution limited to 5 seconds
- Prevents slow plugins from freezing UI
- Falls back to "All Tasks" group on timeout

**Caching:**

- Results cached for 1 second
- Cache invalidated when task list changes (compare task IDs)
- Prevents re-running expensive grouping on every render

**Memory:**

- Cache cleared after 1 second
- Max ~10KB per grouping
- Cleanup on plugin unload

---

## Sync & Operation Log

**What syncs:**

- Plugin state (via `persistDataSynced()`) → creates operation in op-log
- Syncs across all devices running the same plugin

**What doesn't sync:**

- Grouping function code (plugin installed locally)
- Selected grouping option (local UI preference)
- Collapsed/expanded state (local UI state)

**Cross-device behavior:**

- Device A: Plugin installed, assigns tasks to sections
- Device B (with plugin): Loads synced section data, grouping works
- Device B (no plugin): Data syncs but has no effect, tasks visible in default view

---

## Risks & Mitigations

| Risk                                 | Impact | Mitigation                                                  |
| ------------------------------------ | ------ | ----------------------------------------------------------- |
| Slow groupFn blocks UI               | Medium | 5s timeout, caching, performance guidelines in docs         |
| Plugin state corruption              | Low    | try/catch + fallback to "All Tasks" group                   |
| Drag-drop UX unclear                 | Low    | Use existing behavior (reset grouping), document limitation |
| Plugin not installed on other device | Low    | Tasks still accessible, just not grouped                    |

---

## Future Enhancements (Not in MVP)

These can be added later without breaking changes:

1. **Drag-between-groups:**
   - Add optional `onTaskMoved(taskId, fromGroup, toGroup)` callback
   - Plugin updates state when task dragged to different group

2. **Context menu integration:**
   - New hook: `TASK_CONTEXT_MENU_OPEN`
   - Plugins can add "Move to Section" menu items

3. **Loading states:**
   - Show spinner while groupFn executes
   - Better UX for slow grouping functions

4. **Group statistics:**
   - Show task count per group in header
   - Optional metadata field: `count?: number`

5. **Nested groups:**
   - Support hierarchical grouping (e.g., Project → Section → Priority)
   - `PluginTaskGroup.subGroups?: PluginTaskGroup[]`

---

## Success Criteria

✅ Plugins can register custom grouping via `registerTaskGrouping()`
✅ Plugin groupings appear in customizer UI
✅ Core renders groups using existing components
✅ Plugin state syncs via `persistDataSynced()`
✅ Performance: < 5% overhead with plugin grouping
✅ ~500 lines of implementation code
✅ Type-safe plugin development
✅ Backward compatible (no breaking changes)
✅ Example sections plugin works end-to-end
✅ All tests passing

---

## Open Questions

None - design is ready for implementation.

---

## Confidence: 90%

**Strengths:**

- Reuses existing architecture (TaskViewCustomizerService, signals, persistence)
- Simple implementation (~500 lines)
- No performance concerns (timeout + caching)
- Clean plugin API

**Potential Issues:**

- Drag-drop UX limitation (resets grouping) - but acceptable for MVP
- Plugin must handle async state loading - documented in example

**Side Effects:**

- Minimal: just extends existing customizer infrastructure
- No breaking changes to core or existing plugins
