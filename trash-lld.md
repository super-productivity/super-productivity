# Trash Bin Feature — Low-Level Design

## Overview

When a user deletes an entity (initially tasks; later notes, issues, etc.), instead of permanently removing it, the entity is moved to a generic "trash bin" where it can be restored or permanently deleted. A global config toggle lets the user opt in to "move to trash" behavior (disabled by default — **trash is an experimental feature**).

The trash infrastructure is **entity-agnostic**: a single store, service, and UI page handle all entity types. Entity-specific logic (cleanup on trash, restore wiring) is provided per type. Initially only **tasks** are supported.

---

## 1. Data Model & Storage

**New IndexedDB store** — one record per trashed item (not a singleton blob):

- In `src/app/op-log/persistence/db-keys.const.ts`: Add `TRASH = 'trash'` to `STORE_NAMES`
- Increment `DB_VERSION` to `6`
- In `src/app/op-log/persistence/db-upgrade.ts`: Add version 6 block:
  ```typescript
  const trashStore = db.createObjectStore(STORE_NAMES.TRASH, { keyPath: 'id' });
  trashStore.createIndex('entityType', 'entityType', { unique: false });
  trashStore.createIndex('deletedAt', 'deletedAt', { unique: false });
  ```

Each trashed item is its own IndexedDB record, indexed by `entityType` and `deletedAt`. This allows:

- Querying by entity type without loading everything (e.g. show only trashed tasks)
- Efficient range-based purge on `deletedAt` (no full scan)
- Natural mapping to SQL (`SELECT * FROM trash WHERE entity_type = 'TASK' ORDER BY deleted_at DESC`)
- Adding new entity types without growing a single monolithic blob

**Trash model** — new file `src/app/features/trash/trash.model.ts`:

```typescript
// Supported entity types — extend this union as new types are added
export type TrashEntityType = 'TASK';

// Each trashed item is one IndexedDB record / one SQL row
export interface TrashedItem<T = unknown> {
  id: string; // Original entity ID (IndexedDB keyPath)
  entityType: TrashEntityType; // Indexed — for filtered queries
  data: T; // The original entity snapshot
  restoreContext: Record<string, unknown>; // Entity-specific restore metadata
  deletedAt: number; // Indexed — for expiry purge & sort
}

// Task-specific restore context
export interface TaskRestoreContext {
  projectId?: string;
  tagIds: string[];
  parentId?: string;
  subTaskIds: string[];
  backlog: boolean; // Was it in the backlog?
}

// Convenience alias
export type TrashedTask = TrashedItem<Task> & {
  entityType: 'TASK';
  restoreContext: TaskRestoreContext;
};
```

Unlike archive (which uses a singleton blob per store), trash uses **one record per item**. This scales to many entity types and large item counts without loading the entire trash into memory.

---

## 2. Configuration

Trash config is **global** (not per-entity) since it governs the trash bin as a whole.

> **Experimental feature**: Trash is treated as an experimental feature. The `isEnabled` flag (default: `false`) controls whether the user can use trash at all. When disabled:
>
> - The "Trash" nav item is hidden from the sidebar
> - The `/trash` route is inaccessible
> - All deletions are permanent (existing behavior)
> - No trash-related UI elements (context menu options, undo-via-trash snackbars) are shown
>
> When enabled, the full trash experience activates: deleted items go to trash, restore is available, and the trash page is accessible.

**Add new top-level config section `TrashConfig`** in `src/app/features/config/global-config.model.ts`:

```typescript
export type TrashConfig = Readonly<{
  isEnabled: boolean; // default: false — experimental; when false, delete is always permanent and trash UI is hidden
  retentionDays: number; // default: 30 — auto-purge after N days
}>;
```

**Add to `GlobalConfigState`**:

```typescript
trash: TrashConfig;
```

**Set defaults** in `src/app/features/config/default-global-config.const.ts`:

```typescript
trash: {
  isEnabled: false, // experimental — opt-in only
  retentionDays: 30,
},
```

**Add form config** — new file `src/app/features/config/form-cfgs/trash-settings-form.const.ts`:

- Checkbox for `isEnabled` (label: "Enable trash bin (experimental — deleted items can be restored)")
- Number input for `retentionDays` (label: "Auto-purge trash after N days", shown conditionally when enabled)

**Register the section** in the config page component alongside other sections.

**Translation keys** in `en.json` under a new `GCF.TRASH` namespace.

---

## 3. NgRx Actions

New actions in a new `src/app/features/trash/store/trash.actions.ts`:

```typescript
// Move item(s) to trash — generic, carries entity type
moveToTrash: (props: { items: TrashedItem[] }) => ({
  ...props,
  meta: { isPersistent, opType: OpType.Delete, isBulk },
});

// Restore from trash back to active state
restoreFromTrash: (props: { itemId: string; entityType: TrashEntityType }) => ({
  ...props,
  meta: { isPersistent },
});

// Permanently delete from trash
permanentlyDeleteFromTrash: (props: { itemIds: string[] }) => ({
  ...props,
  meta: { isPersistent },
});

// Empty entire trash (all entity types)
emptyTrash: () => ({ meta: { isPersistent } });
```

These are **persistent actions** so they sync across devices via the op-log.

**Task-specific wiring**: The existing `deleteTask` / `deleteTasks` actions remain for permanent deletion. When trash is enabled, the deletion call sites dispatch `moveToTrash` instead — the task-specific cleanup (remove from projects, tags, parent) still happens in the existing meta-reducers, but the effect additionally writes to the trash store.

---

## 4. Meta-Reducer & Reducer Changes

### 4a. `moveToTrash` — task cleanup

`moveToTrash` with `entityType: 'TASK'` needs the same state cleanup as `deleteTask`:

- Remove from task entities, projects, tags, parent, currentTaskId

**Approach**: Handle `moveToTrash` in the existing `task-shared-crud.reducer.ts` meta-reducer. Filter for items where `entityType === 'TASK'`, then reuse `deleteTaskHelper()` and the project/tag cleanup logic already in `handleDeleteTask()`. This avoids duplicating reducer code.

When future entity types are added (notes, issues), their respective meta-reducers handle `moveToTrash` for their own `entityType`.

### 4b. `restoreFromTrash` — task restore

Handle in the same meta-reducer, gated on `entityType === 'TASK'`:

- Re-add task entities (main + subtasks) via adapter
- Re-add to `project.taskIds` (or `backlogTaskIds` if `restoreContext.backlog`)
- Re-add to each tag's `taskIds`
- Re-link parent's `subTaskIds` if `restoreContext.parentId` exists

This mirrors the existing `restoreDeletedTask` pattern in `src/app/root-store/meta/undo-task-delete.meta-reducer.ts` but reads from the persistent `TrashedItem.restoreContext` instead of an in-memory snapshot.

### 4c. Trash-specific reducer (new)

A lightweight `trashReducer` in `src/app/features/trash/store/trash.reducer.ts` manages an in-memory cache of trash items (hydrated from IndexedDB on init). Uses `@ngrx/entity` adapter for normalized storage:

```typescript
export interface TrashState extends EntityState<TrashedItem> {
  loaded: boolean;
}
```

The adapter uses `id` as the primary key and default `sortComparer` by `deletedAt` descending.

Handles:

- `moveToTrash` → `adapter.addMany()`
- `restoreFromTrash` → `adapter.removeOne()`
- `permanentlyDeleteFromTrash` → `adapter.removeMany()`
- `emptyTrash` → `adapter.removeAll()`
- `loadTrashSuccess` → `adapter.setAll()` (hydrate from IndexedDB)

Selectors:

- `selectAllTrashedItems` — all items
- `selectTrashedItemsByType(entityType)` — filtered (memoized per type)
- `selectTrashedTaskItems` — convenience alias for `'TASK'`
- `selectTrashItemCount` — total count (for nav badge)

---

## 5. Services

**New `TrashStoreService`** — `src/app/op-log/persistence/trash-store.service.ts`:

- Unlike `ArchiveStoreService` (singleton blob), operates on individual records
- Methods:
  - `getAll(): Promise<TrashedItem[]>` — full load (for init hydration)
  - `getAllByType(entityType: TrashEntityType): Promise<TrashedItem[]>` — query by index
  - `getById(id: string): Promise<TrashedItem | undefined>` — single record lookup
  - `put(items: TrashedItem[]): Promise<void>` — upsert one or more records
  - `remove(ids: string[]): Promise<void>` — delete by key
  - `removeExpired(beforeTimestamp: number): Promise<string[]>` — range delete on `deletedAt` index, returns removed IDs
  - `clear(): Promise<void>` — delete all records

**New `TrashService`** — `src/app/features/trash/trash.service.ts`:

Generic orchestration, delegates to actions:

- `moveToTrash(items: TrashedItem[])` — dispatches `moveToTrash`
- `restore(itemId: string, entityType: TrashEntityType)` — dispatches `restoreFromTrash`
- `permanentlyDelete(itemIds: string[])` — dispatches `permanentlyDeleteFromTrash`
- `emptyTrash()` — dispatches `emptyTrash`
- `trashedItems: Signal<TrashedItem[]>` — all trash contents from store
- `trashedTasks: Signal<TrashedTask[]>` — computed, filtered by `entityType === 'TASK'`
- `purgeExpiredItems()` — called on app startup, removes items older than `retentionDays`

**Task-specific helper** — `src/app/features/trash/task-trash.helper.ts`:

Provides the function to build a `TrashedItem<Task>` from a `TaskWithSubTasks` + current state:

```typescript
export function buildTrashedTaskItems(
  task: TaskWithSubTasks,
  state: RootState,
): TrashedItem<Task>[] {
  // Returns one TrashedItem per task (main + each subtask),
  // with TaskRestoreContext capturing projectId, tagIds, parentId, backlog status
}
```

---

## 6. Effects

**New `TrashEffects`** — `src/app/features/trash/store/trash.effects.ts` (using `inject(LOCAL_ACTIONS)` per project rules):

- **`persistOnMoveToTrash$`**: On `moveToTrash` → `trashStoreService.put(items)`, show snackbar with "Undo" (dispatches `restoreFromTrash`)
- **`persistOnRestore$`**: On `restoreFromTrash` → `trashStoreService.remove([itemId])`, show success snackbar
- **`persistOnPermanentDelete$`**: On `permanentlyDeleteFromTrash` → `trashStoreService.remove(itemIds)`
- **`persistOnEmptyTrash$`**: On `emptyTrash` → `trashStoreService.clear()`
- **`purgeExpiredOnInit$`**: On app init → `trashStoreService.removeExpired(now - retentionDays)`, dispatch `permanentlyDeleteFromTrash` for the returned IDs to update in-memory state
- **`loadTrashOnInit$`**: On app init → `trashStoreService.getAll()`, dispatch `loadTrashSuccess`

---

## 7. Modify Existing Deletion Flow

### 7a. Context menu

In `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts` `deleteTask()`:

```typescript
// Current flow:
// confirm → taskService.remove(task)

// New flow:
if (trashConfig.isEnabled) {
  // confirm (if isConfirmBeforeDelete) → trashService.moveToTrash(buildTrashedTaskItems(task, state))
} else {
  // confirm → taskService.remove(task) (permanent, unchanged)
}
```

The context menu can also offer both options explicitly:

- "Delete" (moves to trash or permanently deletes per config)
- "Delete permanently" (always permanent, bypasses trash)

### 7b. Bulk deletion

Same change in `src/app/features/tasks/task.service.ts` `removeMultipleTasks()` — check config and route to trash or permanent delete.

### 7c. Keyboard shortcut

`src/app/features/tasks/task-shortcut.service.ts` — the `taskDelete` shortcut routes through the same logic.

---

## 8. Navigation & UI

**Add "Trash" to sidebar navigation** in `src/app/core-ui/magic-side-nav/magic-nav-config.service.ts`:

```typescript
{
  type: 'route',
  id: 'trash',
  label: T.TRASH.NAV_LABEL, // "Trash"
  icon: 'delete',
  route: '/trash',
}
```

Place it near the bottom of the nav, after tags/projects, before settings. **Only show when `trashConfig.isEnabled`** — since trash is experimental, the nav item must be completely hidden when the feature is off.

**New route** — add `/trash` route with lazy-loaded component.

**Trash page component** — `src/app/features/trash/trash-page.component.ts`:

- Tabs or grouped sections by entity type (initially just "Tasks")
- List of trashed items with:
  - Entity icon + title (for tasks: task title)
  - Original context (project name, tags)
  - Deletion date (relative, e.g. "3 days ago")
  - "Restore" button per item
  - "Delete permanently" button per item
- Toolbar with "Empty Trash" button (with confirmation dialog)
- Show total item count in nav badge (optional)
- Simple `<table>` or flat list — no need for the full task component
- Empty state: "Trash is empty" message

---

## 9. Sync Considerations

Following the architecture docs and CLAUDE.md rules:

- All trash actions are **persistent** (`isPersistent: true`) so they sync via op-log
- `moveToTrash` uses `OpType.Delete` for the task entity (same as current delete — from NgRx state's perspective the task is removed)
- The trash IndexedDB write happens in an **effect** (local side effect), and remote clients handle it via `ArchiveOperationHandler`-like pattern — a new `TrashOperationHandler` that writes to the trash store when receiving remote `moveToTrash` ops
- `restoreFromTrash` uses `OpType.Update` — re-adds to active state
- Auto-purge is local-only (each client purges independently based on `deletedAt` timestamp)

---

## 10. File Summary

| File                                                                                | Change                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/app/op-log/persistence/db-keys.const.ts`                                       | Add `TRASH` store name, `TrashStoreEntry`                   |
| `src/app/op-log/persistence/db-upgrade.ts`                                          | DB version 6, create trash store                            |
| `src/app/op-log/persistence/trash-store.service.ts`                                 | **New** — IndexedDB access for trash                        |
| `src/app/features/trash/trash.model.ts`                                             | **New** — `TrashedItem`, `TrashModel`, `TaskRestoreContext` |
| `src/app/features/trash/trash.service.ts`                                           | **New** — generic orchestration                             |
| `src/app/features/trash/task-trash.helper.ts`                                       | **New** — task-specific `TrashedItem` builder               |
| `src/app/features/trash/store/trash.actions.ts`                                     | **New** — generic trash actions                             |
| `src/app/features/trash/store/trash.reducer.ts`                                     | **New** — in-memory trash state                             |
| `src/app/features/trash/store/trash.effects.ts`                                     | **New** — side effects (persistence, purge)                 |
| `src/app/features/trash/trash-page.component.ts`                                    | **New** — UI (grouped by entity type)                       |
| `src/app/features/config/global-config.model.ts`                                    | Add `TrashConfig` section                                   |
| `src/app/features/config/default-global-config.const.ts`                            | Set trash defaults                                          |
| `src/app/features/config/form-cfgs/trash-settings-form.const.ts`                    | **New** — trash config form                                 |
| `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts`     | Handle `moveToTrash` / `restoreFromTrash` for tasks         |
| `src/app/root-store/root.module.ts`                                                 | Register trash reducer + meta-reducer wiring                |
| `src/app/features/tasks/task-context-menu/.../task-context-menu-inner.component.ts` | Route delete to trash when enabled                          |
| `src/app/features/tasks/task.service.ts`                                            | Route bulk delete to trash when enabled                     |
| `src/app/core-ui/magic-side-nav/magic-nav-config.service.ts`                        | Add trash nav item (conditional on config)                  |
| `src/app/app.routes.ts` (or equivalent)                                             | Add `/trash` route                                          |
| `src/assets/i18n/en.json`                                                           | Add translation keys under `TRASH.*` and `GCF.TRASH.*`      |

---

## 11. Extensibility — Adding a New Entity Type

To add trash support for a new entity (e.g. notes):

1. **Extend `TrashEntityType`**: Add `'NOTE'` to the union in `trash.model.ts`
2. **Define restore context**: Create `NoteRestoreContext` interface
3. **Create builder**: `note-trash.helper.ts` — builds `TrashedItem<Note>` with restore context
4. **Handle in meta-reducer**: In the note's meta-reducer, handle `moveToTrash` (cleanup) and `restoreFromTrash` (re-add) for `entityType === 'NOTE'`
5. **Wire deletion call sites**: Route note deletion through `trashService.moveToTrash()` when trash is enabled
6. **UI**: Trash page automatically shows notes in a "Notes" group (keyed by `entityType`)

No changes needed to: trash store, trash service, trash effects, trash actions, config, or IndexedDB schema.

---

## Key Design Decisions

1. **Generic `TrashedItem<T>` with `entityType` discriminator** — the trash infrastructure (store, service, effects, UI) is entity-agnostic. Entity-specific logic lives in helpers and meta-reducers. Adding a new entity type requires no changes to the core trash plumbing.

2. **One record per item** (not a singleton blob) — each `TrashedItem` is its own IndexedDB record, indexed by `entityType` and `deletedAt`. This allows filtered queries by type, efficient range-based purge, and maps naturally to SQL (`WHERE entity_type = ? ORDER BY deleted_at`). Adding new entity types doesn't bloat a single document.

3. **`restoreContext` as opaque `Record<string, unknown>`** at the generic level — each entity type defines its own typed context interface (`TaskRestoreContext`, etc.). The trash service doesn't interpret it; only the entity's meta-reducer does.

4. **Separate `TrashConfig` section** (not nested in `TasksConfig`) — since trash is cross-entity, it belongs at the global level. One toggle governs all entity types. The feature is **experimental and opt-in** (`isEnabled: false` by default). When disabled, the entire trash surface (nav, routes, context menu options, snackbar undo-via-trash) is hidden — the app behaves exactly as before.

5. **Auto-purge on app startup** — keeps trash bounded without a background timer. Each client purges independently based on `deletedAt` + `retentionDays`.

6. **`moveToTrash` reuses existing cleanup reducers** — for tasks, the same `deleteTaskHelper()` and project/tag cleanup runs. The only difference is the effect writes to the trash store instead of discarding data.

7. **Undo still works** — the snackbar after `moveToTrash` dispatches `restoreFromTrash` (functionally same as current undo, but trash-aware and persistent).

8. **Permanent delete remains available** — both as a user config preference (trash disabled) and as an explicit action from the trash page or context menu.
