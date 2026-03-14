# Plan: Sync Provider Plugin System + WebDAV Example Plugin

## Overview

Implement the sync provider plugin infrastructure (as designed in `docs/long-term-plans/sync-provider-plugins.md`), then build a WebDAV sync provider plugin that reuses the existing `webdav-api.ts` code as a proof-of-concept.

This is split into two tracks: **infrastructure** (app-side changes to support plugin sync providers) and **plugin** (the WebDAV example plugin).

---

## Track 1: Infrastructure — Plugin Sync Provider Support

### Step 1: Add `persistDataLocal()` / `loadLocalData()` to Plugin API

Plugins need local-only storage for credentials (can't use `persistDataSynced` — that would create a chicken-and-egg problem for sync provider plugins).

**Files to modify:**

1. **`packages/plugin-api/src/types.ts`** — Add to `PluginAPI` interface:
   ```typescript
   persistDataLocal(dataStr: string): Promise<void>;
   loadLocalData(): Promise<string | null>;
   ```

2. **`src/app/plugins/plugin-api.ts`** — Implement the two methods, delegating to bridge service.

3. **`src/app/plugins/plugin-bridge.service.ts`** — Add `_persistDataLocal()` and `_loadLocalData()` methods. Use a dedicated IndexedDB object store (not NgRx, since this data must not sync). Key format: `__sp_plugin_local_<pluginId>`.

4. **`src/app/plugins/plugin-local-persistence.service.ts`** *(new file)* — Simple IndexedDB wrapper for local plugin data. Stores per-plugin string blobs. Same 1MB size limit and rate limiting as synced persistence.

5. **`src/app/plugins/plugin-cleanup.service.ts`** — On plugin uninstall (not disable), clear local data.

### Step 2: Add `registerSyncProvider()` to Plugin API

**Files to modify:**

1. **`packages/plugin-api/src/types.ts`** — Add `SyncProviderPluginDefinition` interface and `registerSyncProvider()` to `PluginAPI`:
   ```typescript
   interface SyncProviderPluginDefinition {
     id: string;
     label: string;
     icon?: string;
     isUploadForcePossible?: boolean;
     maxConcurrentRequests?: number;
     isReady(): Promise<boolean>;
     getFileRev(path: string, localRev: string | null): Promise<{ rev: string }>;
     downloadFile(path: string): Promise<{ rev: string; dataStr: string }>;
     uploadFile(path: string, dataStr: string, revToMatch: string | null, isForceOverwrite?: boolean): Promise<{ rev: string }>;
     removeFile(path: string): Promise<void>;
     listFiles?(path: string): Promise<string[]>;
   }

   registerSyncProvider(definition: SyncProviderPluginDefinition): void;
   ```

2. **`src/app/plugins/plugin-api.ts`** — Implement `registerSyncProvider()`, delegating to bridge.

3. **`src/app/plugins/plugin-bridge.service.ts`** — Add `_registerSyncProvider()` method that validates the definition and calls the registry.

### Step 3: Create `PluginSyncProviderRegistryService`

**New file: `src/app/plugins/sync-provider/plugin-sync-provider-registry.service.ts`**

Follows the same pattern as `PluginIssueProviderRegistryService`:
- `Map<string, RegisteredPluginSyncProvider>` keyed by `plugin:<pluginId>`
- `register(pluginId, definition)` / `unregister(pluginId)`
- `getProvider(key)`, `hasProvider(key)`, `getAvailableProviders()`
- Emits a `providerChanged$` subject on register/unregister for the UI to react

### Step 4: Create `PluginSyncProviderAdapter`

**New file: `src/app/plugins/sync-provider/plugin-sync-provider-adapter.ts`**

A thin adapter (~80 lines) that implements `FileSyncProvider<SyncProviderId>` by delegating to the plugin's callback functions:

```typescript
class PluginSyncProviderAdapter implements FileSyncProvider<SyncProviderId> {
  id: SyncProviderId;  // Will use a dynamic approach (see Step 5)
  maxConcurrentRequests: number;
  isUploadForcePossible: boolean;
  privateCfg: SyncCredentialStore;  // No-op store (plugin manages its own creds)

  // Delegates to plugin definition callbacks
  isReady(): Promise<boolean>;
  getFileRev(...): Promise<FileRevResponse>;
  downloadFile(...): Promise<FileDownloadResponse>;
  uploadFile(...): Promise<FileRevResponse>;
  removeFile(...): Promise<void>;
  setPrivateCfg(): Promise<void>;  // No-op
}
```

### Step 5: Make `SyncProviderId` Support Dynamic Plugin IDs

Currently `SyncProviderId` is a static enum and `toSyncProviderId()` rejects unknown values. We need to support `plugin:<pluginId>` strings.

**Files to modify:**

1. **`src/app/op-log/sync-providers/provider.const.ts`** — Update `toSyncProviderId()` to also accept strings matching `plugin:*` pattern. Add helper `isPluginSyncProviderId()`.

2. **`src/app/op-log/sync/operation-sync.util.ts`** — Update `isFileBasedProvider()` to return `true` for plugin providers (since all plugin sync providers are file-based per the design doc). Use `isFileSyncProvider()` type guard (checks for `getFileRev` method) instead of hardcoded ID set.

### Step 6: Update `SyncProviderManager` for Dynamic Registration

**File: `src/app/op-log/sync-providers/provider-manager.service.ts`**

Add:
- `registerPluginProvider(adapter: PluginSyncProviderAdapter)` — adds to internal list, if it matches the currently selected provider ID, triggers readiness check
- `unregisterPluginProvider(pluginProviderId: string)` — removes adapter, if it was active, emits `isProviderReady$ = false`
- `getProviderById()` — also check plugin providers (in addition to built-in ones)
- `getAllProviders()` — include plugin providers in the returned list

### Step 7: Update `WrappedProviderService`

**File: `src/app/op-log/sync-providers/wrapped-provider.service.ts`**

The `isFileBasedProvider()` check currently uses a hardcoded set of IDs. After Step 5's change to use the `isFileSyncProvider()` type guard, plugin providers will automatically be recognized and wrapped by `FileBasedSyncAdapterService`. Minimal changes needed — just ensure the type guard path works.

### Step 8: Update Sync Settings UI

**File: `src/app/features/config/form-cfgs/sync-form.const.ts`**

The provider dropdown is currently hardcoded. Options:

**Option A (simpler):** Make the dropdown options array reactive. Inject `PluginSyncProviderRegistryService` and dynamically add plugin providers to the options list. When a plugin provider is selected, show a "Configure via plugin" message and a button that triggers the plugin's config UI (via `plugin.openDialog()` or `plugin.showIndexHtmlAsView()`).

**Option B (recommended):** Since Formly field configs are static objects, add a dynamic template that renders plugin providers as additional radio buttons or dropdown options. Use a custom Formly type or `expressions` to update the options list reactively.

The simplest approach: convert the sync form from a static `const` to a factory function that accepts the list of registered plugin providers. Re-evaluate the form when plugin providers change.

For plugin providers, no inline config fields are needed — the plugin handles its own config UI.

### Step 9: Plugin Cleanup on Disable/Uninstall

**File: `src/app/plugins/plugin-cleanup.service.ts`**

On plugin unload:
1. Call `PluginSyncProviderRegistryService.unregister(pluginId)`
2. Which triggers `SyncProviderManager.unregisterPluginProvider()`
3. If this was the active provider, sync stops gracefully

---

## Track 2: WebDAV Sync Provider Plugin

### Step 10: Create the Plugin Scaffold

**New directory: `packages/plugin-dev/webdav-sync/`**

```
packages/plugin-dev/webdav-sync/
├── manifest.json
├── plugin.js          (or plugin.ts → compiled)
├── index.html         (config UI for WebDAV credentials)
└── vite.config.ts     (build config, following existing plugin patterns)
```

**`manifest.json`:**
```json
{
  "id": "webdav-sync",
  "name": "WebDAV Sync Provider",
  "version": "1.0.0",
  "manifestVersion": 1,
  "minSupVersion": "14.0.0",
  "description": "Sync via any WebDAV server (Nextcloud, ownCloud, etc.)",
  "hooks": [],
  "permissions": ["syncProvider", "localData"],
  "iFrame": true,
  "icon": "icon.svg"
}
```

### Step 11: Extract WebDAV Protocol Logic for Plugin Use

The existing `webdav-api.ts` (800 lines) is mostly self-contained — it uses `fetch()` for HTTP and has its own XML parser. For the plugin, we need to:

1. **Copy and adapt `webdav-api.ts`** — Remove dependencies on app error classes (`RemoteFileChangedUnexpectedly`, `NoRevAPIError`, etc.) and replace with simple `Error` throws. Remove `SyncLog` references. Remove Capacitor plugin branching (plugin runs in browser context only, so `fetch` is fine).

2. **Copy `webdav-xml-parser.ts`** — Already self-contained, no changes needed.

3. **Copy relevant constants from `webdav.const.ts`** — HTTP methods, status codes.

4. **Skip `webdav-http-adapter.ts`** — Not needed; plugin uses `fetch` directly (the adapter's web path already just delegates to `fetch`).

The adapted code should be ~600-700 lines (removing Capacitor-specific paths and app error classes).

### Step 12: Implement Plugin Logic

**`plugin.js` (or compiled from TypeScript):**

```javascript
let config = null;

async function loadConfig() {
  const data = await plugin.loadLocalData();
  config = data ? JSON.parse(data) : null;
}

// Initialize
await loadConfig();

// Create WebdavApi instance with config getter
const api = new WebdavApi(() => {
  if (!config) throw new Error('WebDAV not configured');
  return config;
});

plugin.registerSyncProvider({
  id: 'webdav',
  label: 'WebDAV (Plugin)',
  icon: 'cloud',
  maxConcurrentRequests: 10,
  isUploadForcePossible: false,

  isReady: async () => {
    await loadConfig();
    return !!(config?.baseUrl && config?.userName && config?.password);
  },

  getFileRev: async (path, localRev) => {
    const filePath = buildPath(path, config);
    const meta = await api.getFileMeta(filePath, localRev, true);
    return { rev: meta.lastmod };
  },

  downloadFile: async (path) => {
    const filePath = buildPath(path, config);
    const result = await api.download({ path: filePath });
    return { rev: result.rev, dataStr: result.dataStr };
  },

  uploadFile: async (path, dataStr, revToMatch, isForceOverwrite) => {
    const filePath = buildPath(path, config);
    const result = await api.upload({
      path: filePath, data: dataStr,
      isForceOverwrite, expectedRev: isForceOverwrite ? null : revToMatch,
    });
    return { rev: result.rev };
  },

  removeFile: async (path) => {
    const filePath = buildPath(path, config);
    await api.remove(filePath);
  },
});
```

### Step 13: Implement Plugin Config UI

**`index.html`** — Simple form for WebDAV credentials:
- Base URL input
- Username input
- Password input
- Sync folder path input
- Test connection button
- Save button (calls `plugin.persistDataLocal()`)

This replaces the Formly-based config form from the built-in provider with a standalone HTML form inside the plugin iframe. Use the plugin UI kit for styling consistency.

### Step 14: Add a menu entry for configuration

```javascript
plugin.registerMenuEntry({
  label: 'Configure WebDAV Sync',
  icon: 'settings',
  onClick: () => plugin.showIndexHtmlAsView(),
});
```

---

## Track 3: Testing & Verification

### Step 15: Unit Tests

1. **`plugin-sync-provider-registry.service.spec.ts`** — register/unregister/getProvider
2. **`plugin-sync-provider-adapter.spec.ts`** — delegates correctly to callbacks
3. **`provider-manager.service.spec.ts`** — update existing tests for dynamic registration
4. **`provider.const.spec.ts`** — `toSyncProviderId()` accepts `plugin:*` strings
5. **`operation-sync.util.spec.ts`** — `isFileBasedProvider()` returns true for plugin providers

### Step 16: E2E Test

Add an E2E test in `e2e/tests/plugins/` that:
1. Loads the WebDAV sync plugin
2. Verifies it appears in the sync provider dropdown
3. Selects it and configures credentials
4. (Optional) Performs a sync cycle against a test WebDAV server

---

## Implementation Order

1. Steps 1-2: Plugin API additions (`persistDataLocal`, `registerSyncProvider`)
2. Steps 3-4: Registry service + adapter
3. Steps 5-7: Core sync system changes (dynamic IDs, manager, wrapped provider)
4. Step 8: Settings UI
5. Step 9: Cleanup
6. Steps 10-14: WebDAV plugin
7. Steps 15-16: Testing

## Risk Assessment

- **Low risk:** Steps 1-4, 10-14 are additive (new code, no existing behavior changes)
- **Medium risk:** Steps 5-7 modify core sync infrastructure — must not break existing providers
- **Medium risk:** Step 8 UI changes — Formly reactive options can be tricky
- **Key invariant:** Built-in providers (Dropbox, WebDAV, LocalFile, SuperSync) must continue working exactly as before
