# Design: Sync Provider Plugins

## Goal

Enable community developers to build sync providers (Google Drive, OneDrive, S3, etc.) as plugins, using the existing plugin system's runtime loading and sandboxed execution.

## Design Decisions

- Plugins run in the **same sandbox** as regular plugins (no elevated trust)
- Plugins handle their **own auth UI** (OAuth flows, credential forms)
- Credentials stored via a **new `persistDataLocal()` API** (IndexedDB, never synced)
- **App manages encryption** — plugins only transport opaque bytes
- Built-in providers (Dropbox, WebDAV, LocalFile, SuperSync) **stay built-in for now**
- Plugin sync providers are always **file-based** (wrapped by `FileBasedSyncAdapterService`)

## Architecture

### 1. New Plugin API: `registerSyncProvider()`

Added to `PluginAPI` interface. A plugin calls this during initialization:

```javascript
plugin.registerSyncProvider({
  id: 'google-drive',
  label: 'Google Drive',
  icon: 'cloud', // material icon name or inline SVG

  // Core file operations
  getFileRev: async (path, localRev) => {
    // Return { rev: string } or throw if not found
  },
  downloadFile: async (path) => {
    // Return { rev: string, dataStr: string }
  },
  uploadFile: async (path, dataStr, revToMatch, isForceOverwrite) => {
    // Return { rev: string }
  },
  removeFile: async (path) => {},

  // State
  isReady: async () => true, // true if configured & authenticated

  // Optional
  listFiles: async (path) => [], // directory listing
  isUploadForcePossible: true, // can force-overwrite on conflict
  maxConcurrentRequests: 4, // concurrent upload/download limit
});
```

Only one sync provider per plugin. Calling `registerSyncProvider()` a second time replaces the first.

### 2. New Plugin API: `persistDataLocal()` / `loadLocalData()`

General-purpose local-only storage. Stored in IndexedDB, never synced.

```javascript
// Store credentials locally
await plugin.persistDataLocal(
  JSON.stringify({
    accessToken: '...',
    refreshToken: '...',
  }),
);

// Load on startup
const data = await plugin.loadLocalData();
const creds = data ? JSON.parse(data) : null;
```

Same constraints as `persistDataSynced()` (1 MB limit, rate limiting), but data stays on-device.

### 3. PluginSyncProviderAdapter

New class in `src/app/plugins/` that wraps plugin callbacks into `SyncProviderServiceInterface`:

```
src/app/plugins/plugin-sync-provider-adapter.ts
```

- Implements `SyncProviderServiceInterface<SyncProviderId>`
- Delegates file operations to plugin callbacks via `PluginBridgeService`
- `privateCfg` uses a no-op credential store (plugin manages its own creds)
- `isReady()` delegates to the plugin's `isReady()` callback

### 4. SyncProviderManager Changes

**File**: `src/app/op-log/sync-providers/provider-manager.service.ts`

Currently: static `SYNC_PROVIDERS` array populated at construction.

Changes:

- Add `registerPluginProvider(adapter: PluginSyncProviderAdapter)` method
- Add `unregisterPluginProvider(providerId: string)` method
- `SYNC_PROVIDERS` becomes a mutable list (or better: maintain a separate `pluginProviders` map)
- `SyncProviderId` enum extended with a dynamic/string approach for plugin IDs (e.g., `plugin:google-drive`)
- `activeProviderId$` and related observables react to plugin provider registration

### 5. Sync Settings UI Changes

**File**: `src/app/features/config/form-cfgs/sync-form.const.ts`

Currently: hardcoded provider dropdown options.

Changes:

- Provider dropdown dynamically includes registered plugin providers
- When a plugin provider is selected, instead of showing hardcoded form fields:
  - Show a "Configure [Provider Name]" button
  - Clicking it triggers the plugin's config UI (the plugin can use `plugin.openDialog()`, a side panel, or `plugin.showIndexHtmlAsView()`)
- Show connection status from the plugin's `isReady()` result

### 6. Lifecycle Handling

**Startup with plugin sync provider selected:**

1. App starts, loads sync config → selected provider is `plugin:google-drive`
2. `SyncProviderManager` sees unknown provider ID → `isProviderReady$` emits `false`
3. Plugin system loads and activates the Google Drive plugin
4. Plugin calls `registerSyncProvider(...)` → adapter registered with manager
5. Manager detects matching provider → `isProviderReady$` emits `true`
6. Sync begins

**Plugin disabled/uninstalled:**

1. `PluginService` calls cleanup → `unregisterPluginProvider('plugin:google-drive')`
2. `SyncProviderManager` removes the provider → `isProviderReady$` emits `false`
3. Sync stops
4. Settings UI shows warning: "Sync provider 'Google Drive' unavailable — enable the plugin or select another provider"

**Encryption:**

- Managed entirely by the app via `FileBasedSyncAdapterService`
- Encrypt key stored in app-level config (existing mechanism)
- Plugin never sees decrypted data and never handles the key

## Files to Modify

| File                                                        | Change                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/plugin-api/src/types.ts`                          | Add `registerSyncProvider()` and `persistDataLocal()`/`loadLocalData()` to API types |
| `src/app/plugins/plugin-api.ts`                             | Implement new API methods                                                            |
| `src/app/plugins/plugin-bridge.service.ts`                  | Add bridge methods for sync provider registration and local data persistence         |
| `src/app/plugins/plugin-cleanup.service.ts`                 | Unregister sync provider on plugin disable/unload                                    |
| **New**: `src/app/plugins/plugin-sync-provider-adapter.ts`  | Adapter wrapping plugin callbacks → `SyncProviderServiceInterface`                   |
| `src/app/op-log/sync-providers/provider-manager.service.ts` | Add `registerPluginProvider()` / `unregisterPluginProvider()`, dynamic provider list |
| `src/app/op-log/sync-providers/provider.const.ts`           | Support dynamic plugin provider IDs alongside the enum                               |
| `src/app/features/config/form-cfgs/sync-form.const.ts`      | Dynamic provider dropdown, "Configure" button for plugin providers                   |
| `src/app/plugins/store/`                                    | Add reducer/actions for local plugin data persistence                                |
| `src/app/plugins/plugin-persistence.model.ts`               | Add `PluginLocalData` model                                                          |

## New File

**`src/app/plugins/plugin-sync-provider-adapter.ts`**

Thin adapter that implements `SyncProviderServiceInterface` by delegating to plugin callbacks. ~50-80 lines.

## Verification Plan

1. **Unit test**: `PluginSyncProviderAdapter` correctly delegates all methods
2. **Unit test**: `SyncProviderManager` handles dynamic registration/unregistration
3. **Integration test**: Plugin registers → appears in settings dropdown → can be selected
4. **E2E test**: Build a test sync provider plugin that syncs to a local mock, verify full sync cycle works
5. **Edge case tests**: Plugin not loaded at startup, plugin disabled while active, plugin re-enabled

## Example Plugin

A minimal Google Drive sync plugin would look like:

```javascript
// manifest.json
{
  "name": "Google Drive Sync",
  "id": "google-drive-sync",
  "version": "1.0.0",
  "manifestVersion": 1,
  "minSupVersion": "11.0.0",
  "description": "Sync via Google Drive",
  "hooks": [],
  "permissions": ["syncProvider", "localData"]
}

// plugin.js
const GDRIVE_API = 'https://www.googleapis.com/drive/v3';

let credentials = null;

async function init() {
  const data = await plugin.loadLocalData();
  credentials = data ? JSON.parse(data) : null;
}

plugin.registerSyncProvider({
  id: 'google-drive',
  label: 'Google Drive',
  icon: 'cloud',
  maxConcurrentRequests: 4,
  isUploadForcePossible: true,

  isReady: async () => {
    await init();
    return !!credentials?.accessToken;
  },

  downloadFile: async (path) => {
    // Use fetch() to call Google Drive API
    // Return { rev, dataStr }
  },

  uploadFile: async (path, dataStr, revToMatch, isForceOverwrite) => {
    // Upload to Google Drive
    // Return { rev }
  },

  getFileRev: async (path, localRev) => {
    // Check file metadata on Google Drive
    // Return { rev }
  },

  removeFile: async (path) => {
    // Delete file from Google Drive
  },
});

// Auth UI via menu entry
plugin.registerMenuEntry({
  label: 'Configure Google Drive Sync',
  icon: 'settings',
  onClick: async () => {
    // Show auth dialog, store credentials
    await plugin.persistDataLocal(JSON.stringify(credentials));
  },
});
```
