# SuperSync Client Simplification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce ~600-900 lines of duplicated/unnecessary code across the SuperSync client sync stack while improving type safety and maintainability.

**Architecture:** The SuperSync client spans three layers — transport (`sync-providers/super-sync/`), sync orchestration (`op-log/sync/`), and application-level services (`imex/sync/`). Each task in this plan targets a specific duplication or architectural weakness, ordered by risk (low-risk first).

**Tech Stack:** Angular 19, TypeScript strict, NgRx, Jasmine/Karma tests

---

## Phase 1: Low-Risk, High-Reward (Pure Refactors, No Behavior Change)

### Task 1: Unify 4 HTTP methods in `super-sync.ts` (~150 lines saved)

**Context:**
Four nearly-identical HTTP methods exist in `SuperSyncProvider`:
- `_fetchApi` (lines 480-558) — web, JSON body
- `_fetchApiNative` (lines 564-615) — native (CapacitorHttp), JSON body
- `_fetchApiCompressed` (lines 621-695) — web, gzip body
- `_fetchApiCompressedNative` (lines 704-766) — native, gzip body

The web methods share ~50 lines of identical AbortController setup, `!response.ok` check, slow-request logging (>30s), `_checkHttpStatus`, and error handling. The native methods share CapacitorHttp call pattern, status check, slow-request logging, and `_handleNativeRequestError`.

**Files:**
- Modify: `src/app/op-log/sync-providers/super-sync/super-sync.ts`
- Test: `src/app/op-log/sync-providers/super-sync/super-sync.spec.ts`

**Step 1: Read and run the existing tests**

Run: `npm run test:file src/app/op-log/sync-providers/super-sync/super-sync.spec.ts`
Expected: All tests pass (establishes baseline).

**Step 2: Extract `_doWebFetch<T>()` from `_fetchApi` and `_fetchApiCompressed`**

Replace `_fetchApi` and `_fetchApiCompressed` with a single unified method:

```typescript
private async _doWebFetch<T>(
  url: string,
  headers: Headers,
  options: { method: string; body?: BodyInit },
): Promise<T> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPERSYNC_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorText = await response.text().catch(() => 'Unknown error');
      this._checkHttpStatus(response.status, errorText);
      throw new Error(
        `SuperSync API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    // CRITICAL: Read response body BEFORE clearing timeout
    const data = (await response.json()) as T;
    clearTimeout(timeoutId);

    // Log slow requests
    const duration = Date.now() - startTime;
    if (duration > 30000) {
      SyncLog.warn(this.logLabel, `Slow SuperSync request detected`, {
        path: new URL(url).pathname,
        durationMs: duration,
        durationSec: (duration / 1000).toFixed(1),
      });
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const path = new URL(url).pathname;

    if (error instanceof Error && error.name === 'AbortError') {
      SyncLog.error(this.logLabel, `SuperSync request timeout`, {
        path,
        durationMs: duration,
        timeoutMs: SUPERSYNC_REQUEST_TIMEOUT_MS,
      });
      throw new Error(
        `SuperSync request timeout after ${SUPERSYNC_REQUEST_TIMEOUT_MS / 1000}s: ${path}`,
      );
    }

    SyncLog.error(this.logLabel, `SuperSync request failed`, {
      path,
      durationMs: duration,
      error: (error as Error).message,
    });
    throw error;
  }
}
```

Then `_fetchApi` becomes:

```typescript
private async _fetchApi<T>(
  cfg: SuperSyncPrivateCfg,
  path: string,
  options: RequestInit,
): Promise<T> {
  const baseUrl = this._resolveBaseUrl(cfg);
  const url = `${baseUrl}${path}`;
  const sanitizedToken = this._sanitizeToken(cfg.accessToken);

  if (this.isNativePlatform) {
    return this._doNativeFetch<T>(cfg, path, options.method || 'GET');
  }

  const headers = new Headers(options.headers as HeadersInit);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${sanitizedToken}`);

  return this._doWebFetch<T>(url, headers, { method: options.method || 'GET' });
}
```

And `_fetchApiCompressed` becomes:

```typescript
private async _fetchApiCompressed<T>(
  cfg: SuperSyncPrivateCfg,
  path: string,
  compressedBody: Uint8Array,
): Promise<T> {
  const baseUrl = this._resolveBaseUrl(cfg);
  const url = `${baseUrl}${path}`;
  const sanitizedToken = this._sanitizeToken(cfg.accessToken);

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Content-Encoding', 'gzip');
  headers.set('Authorization', `Bearer ${sanitizedToken}`);

  return this._doWebFetch<T>(url, headers, {
    method: 'POST',
    body: new Blob([compressedBody as BlobPart]),
  });
}
```

**Step 3: Extract `_doNativeFetch<T>()` from `_fetchApiNative` and `_fetchApiCompressedNative`**

```typescript
private async _doNativeFetch<T>(
  cfg: SuperSyncPrivateCfg,
  path: string,
  method: string,
  requestData?: { data: string; extraHeaders?: Record<string, string> },
): Promise<T> {
  const startTime = Date.now();
  const baseUrl = this._resolveBaseUrl(cfg);
  const url = `${baseUrl}${path}`;
  const sanitizedToken = this._sanitizeToken(cfg.accessToken);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${sanitizedToken}`,
    'Content-Type': 'application/json',
    ...requestData?.extraHeaders,
  };

  try {
    const response = await executeNativeRequestWithRetry(
      {
        url,
        method,
        headers,
        data: requestData?.data,
        connectTimeout: 10000,
        readTimeout: SUPERSYNC_REQUEST_TIMEOUT_MS,
      },
      this.logLabel,
    );

    if (response.status < 200 || response.status >= 300) {
      const errorData =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      this._checkHttpStatus(response.status, errorData);
      throw new Error(`SuperSync API error: ${response.status} - ${errorData}`);
    }

    // Log slow requests
    const duration = Date.now() - startTime;
    if (duration > 30000) {
      SyncLog.warn(this.logLabel, `Slow SuperSync request detected (native)`, {
        path,
        durationMs: duration,
        durationSec: (duration / 1000).toFixed(1),
      });
    }

    return response.data as T;
  } catch (error) {
    this._handleNativeRequestError(error, path, startTime);
  }
}
```

Then `_fetchApiNative` is removed entirely (callers use `_doNativeFetch` directly), and `_fetchApiCompressedNative` becomes:

```typescript
private async _fetchApiCompressedNative<T>(
  cfg: SuperSyncPrivateCfg,
  path: string,
  jsonPayload: string,
): Promise<T> {
  const base64Gzip = await compressWithGzipToString(jsonPayload);

  SyncLog.debug(this.logLabel, '_fetchApiCompressedNative', {
    path,
    originalSize: jsonPayload.length,
    compressedBase64Size: base64Gzip.length,
  });

  return this._doNativeFetch<T>(cfg, path, 'POST', {
    data: base64Gzip,
    extraHeaders: {
      'Content-Encoding': 'gzip',
      'Content-Transfer-Encoding': 'base64',
    },
  });
}
```

**Step 4: Run tests**

Run: `npm run test:file src/app/op-log/sync-providers/super-sync/super-sync.spec.ts`
Expected: All tests pass.

**Step 5: Lint and format**

Run: `npm run checkFile src/app/op-log/sync-providers/super-sync/super-sync.ts`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/app/op-log/sync-providers/super-sync/super-sync.ts
git commit -m "refactor(sync): unify duplicated HTTP methods in SuperSyncProvider"
```

---

### Task 2: Remove encryption injection tokens — use `spyOn` in tests (~74 lines saved)

**Context:**
Five `InjectionToken` wrappers exist in `encryption.token.ts` solely for test mocking. The real functions (`encrypt`, `decrypt`, etc.) are module-level exports from `encryption.ts`. Tests can use `spyOn` on the module instead.

Only one service (`OperationEncryptionService`) injects these tokens. The integration test and the spec file also reference them.

**Files:**
- Delete: `src/app/op-log/encryption/encryption.token.ts`
- Modify: `src/app/op-log/sync/operation-encryption.service.ts`
- Modify: `src/app/op-log/sync/operation-encryption.service.spec.ts`
- Modify: `src/app/op-log/testing/integration/service-logic.integration.spec.ts`

**Step 1: Run existing tests**

Run: `npm run test:file src/app/op-log/sync/operation-encryption.service.spec.ts`
Expected: All pass.

**Step 2: Modify `OperationEncryptionService` to import functions directly**

Replace token injection with direct imports:

```typescript
// Before:
import { ENCRYPT_FN, DECRYPT_FN, ENCRYPT_BATCH_FN, DECRYPT_BATCH_FN } from '../encryption/encryption.token';

// After:
import { encrypt, decrypt, encryptBatch, decryptBatch } from '../encryption/encryption';
```

Replace the inject calls in the class:

```typescript
// Before:
private readonly _encrypt = inject(ENCRYPT_FN);
private readonly _decrypt = inject(DECRYPT_FN);
private readonly _encryptBatch = inject(ENCRYPT_BATCH_FN);
private readonly _decryptBatch = inject(DECRYPT_BATCH_FN);

// After: use the module functions directly throughout the class
// Replace this._encrypt(...) with encrypt(...)
// Replace this._decrypt(...) with decrypt(...)
// Replace this._encryptBatch(...) with encryptBatch(...)
// Replace this._decryptBatch(...) with decryptBatch(...)
```

**Step 3: Update the spec file to use `spyOn` on the module**

In `operation-encryption.service.spec.ts`, replace token providers with `spyOn`:

```typescript
import * as encryptionModule from '../encryption/encryption';

// In beforeEach:
spyOn(encryptionModule, 'encrypt').and.callFake(async (data: string) => `encrypted:${data}`);
spyOn(encryptionModule, 'decrypt').and.callFake(async (data: string) => data.replace('encrypted:', ''));
spyOn(encryptionModule, 'encryptBatch').and.callFake(async (items: string[]) => items.map(d => `encrypted:${d}`));
spyOn(encryptionModule, 'decryptBatch').and.callFake(async (items: string[]) => items.map(d => d.replace('encrypted:', '')));
```

Remove the token providers from TestBed.

**Step 4: Update integration spec similarly**

In `service-logic.integration.spec.ts`, replace token providers with `spyOn` on the module.

**Step 5: Delete `encryption.token.ts`**

Remove the file entirely.

**Step 6: Run tests**

Run: `npm run test:file src/app/op-log/sync/operation-encryption.service.spec.ts`
Run: `npm run test:file src/app/op-log/testing/integration/service-logic.integration.spec.ts`
Expected: All pass.

**Step 7: Lint**

Run: `npm run checkFile src/app/op-log/sync/operation-encryption.service.ts`
Expected: No errors.

**Step 8: Commit**

```bash
git add -u
git commit -m "refactor(sync): remove encryption injection tokens, use spyOn in tests"
```

---

### Task 3: Remove `DerivedKeyCacheService` wrapper (~33 lines saved)

**Context:**
`DerivedKeyCacheService` is a 33-line Angular service that only wraps two module-level functions: `clearSessionKeyCache()` and `getSessionKeyCacheStats()` from `encryption.ts`. Callers can import and call these directly.

**Consumers (6 files):**
- `src/app/imex/sync/file-based-encryption.service.ts`
- `src/app/imex/sync/file-based-encryption.service.spec.ts`
- `src/app/imex/sync/encryption-password-change.service.ts`
- `src/app/imex/sync/encryption-password-change.service.spec.ts`
- `src/app/imex/sync/sync-config.service.ts`

**Files:**
- Delete: `src/app/op-log/encryption/derived-key-cache.service.ts`
- Modify: each consumer listed above

**Step 1: Run existing tests for all consumers**

Run:
```bash
npm run test:file src/app/imex/sync/file-based-encryption.service.spec.ts
npm run test:file src/app/imex/sync/encryption-password-change.service.spec.ts
```
Expected: All pass.

**Step 2: In each consumer service, replace `DerivedKeyCacheService` with direct imports**

For each service file:

```typescript
// Before:
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
// ...
private _derivedKeyCache = inject(DerivedKeyCacheService);
// ...
this._derivedKeyCache.clearCache();

// After:
import { clearSessionKeyCache } from '../../op-log/encryption/encryption';
// ...
// (remove the inject)
// ...
clearSessionKeyCache();
```

Do the same for `getCacheStats()` → `getSessionKeyCacheStats()` if used.

**Step 3: Update spec files**

In spec files, replace the `DerivedKeyCacheService` spy object with `spyOn(encryptionModule, 'clearSessionKeyCache')`.

**Step 4: Delete `derived-key-cache.service.ts`**

**Step 5: Run tests for all modified files**

Run:
```bash
npm run test:file src/app/imex/sync/file-based-encryption.service.spec.ts
npm run test:file src/app/imex/sync/encryption-password-change.service.spec.ts
```
Expected: All pass.

**Step 6: Lint all modified files**

Run: `npm run checkFile` on each modified `.ts` file.

**Step 7: Commit**

```bash
git add -u
git commit -m "refactor(sync): remove DerivedKeyCacheService wrapper, use direct imports"
```

---

### Task 4: Cache `_getServerSeqKey()` result in SuperSync (~10 lines)

**Context:**
`super-sync.ts` calls `privateCfg.load()` in both `_cfgOrError()` and `_getServerSeqKey()` during every upload/download cycle. The key uses a djb2 hash of `${baseUrl}|${accessToken}` which doesn't change within a session. Caching it avoids redundant computation.

**Files:**
- Modify: `src/app/op-log/sync-providers/super-sync/super-sync.ts`
- Test: `src/app/op-log/sync-providers/super-sync/super-sync.spec.ts`

**Step 1: Add cache field and invalidation**

```typescript
// Add field:
private _cachedServerSeqKey: string | null = null;

// Modify _getServerSeqKey to cache:
private async _getServerSeqKey(): Promise<string> {
  if (this._cachedServerSeqKey) {
    return this._cachedServerSeqKey;
  }
  const cfg = await this.privateCfg.load();
  const baseUrl = cfg?.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL;
  const accessToken = cfg?.accessToken ?? '';
  const identifier = `${baseUrl}|${accessToken}`;
  const hash = identifier
    .split('')
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
    .toString(16);
  this._cachedServerSeqKey = `${LAST_SERVER_SEQ_KEY_PREFIX}${hash}`;
  return this._cachedServerSeqKey;
}

// Invalidate in setPrivateCfg:
async setPrivateCfg(cfg: SuperSyncPrivateCfg): Promise<void> {
  this._cachedServerSeqKey = null;
  await this.privateCfg.setComplete(cfg);
}
```

**Step 2: Run tests**

Run: `npm run test:file src/app/op-log/sync-providers/super-sync/super-sync.spec.ts`
Expected: All pass.

**Step 3: Lint and commit**

```bash
npm run checkFile src/app/op-log/sync-providers/super-sync/super-sync.ts
git add src/app/op-log/sync-providers/super-sync/super-sync.ts
git commit -m "perf(sync): cache _getServerSeqKey() result in SuperSyncProvider"
```

---

## Phase 2: Medium-Risk Architectural Improvements

### Task 5: Split `SyncProviderServiceInterface` — remove file-op stubs from SuperSync (~40 lines + cleaner types)

**Context:**
SuperSync implements `SyncProviderServiceInterface` which requires 5 file operations (`getFileRev`, `downloadFile`, `uploadFile`, `removeFile`, `listFiles`) — all throw `Error('SuperSync uses operation-based sync only')`. The interface should be split so SuperSync only implements what it actually supports.

**Files:**
- Modify: `src/app/op-log/sync-providers/provider.interface.ts`
- Modify: `src/app/op-log/sync-providers/super-sync/super-sync.ts`
- Modify: `src/app/op-log/sync-providers/provider-manager.service.ts` (and any other files referencing `SyncProviderServiceInterface` with SuperSync)
- Possibly modify: files that use `SYNC_PROVIDERS` array or type-narrow providers

**Step 1: Define the new split interfaces**

In `provider.interface.ts`, extract shared properties into a base:

```typescript
/**
 * Base sync provider properties shared by all provider types.
 */
export interface SyncProviderBase<PID extends SyncProviderId> {
  id: PID;
  isUploadForcePossible?: boolean;
  maxConcurrentRequests: number;
  privateCfg: SyncCredentialStore<PID>;
  isReady(): Promise<boolean>;
  getAuthHelper?(): Promise<SyncProviderAuthHelper>;
  setPrivateCfg(privateCfg: PrivateCfgByProviderId<PID>): Promise<void>;
  clearAuthCredentials?(): Promise<void>;
}

/**
 * File-based sync provider (Dropbox, WebDAV, LocalFile).
 */
export interface FileSyncProvider<PID extends SyncProviderId> extends SyncProviderBase<PID> {
  isLimitedToSingleFileSync?: boolean;
  getFileRev(targetPath: string, localRev: string | null): Promise<FileRevResponse>;
  downloadFile(targetPath: string): Promise<FileDownloadResponse>;
  uploadFile(targetPath: string, dataStr: string, revToMatch: string | null, isForceOverwrite?: boolean): Promise<FileRevResponse>;
  removeFile(targetPath: string): Promise<void>;
  listFiles?(targetPath: string): Promise<string[]>;
}

// Keep SyncProviderServiceInterface as alias for backward compat during migration:
export type SyncProviderServiceInterface<PID extends SyncProviderId> = FileSyncProvider<PID>;
```

**Step 2: Make SuperSync implement `SyncProviderBase` + `OperationSyncCapable` + `RestoreCapable`**

Remove the 5 dead file-operation stubs (lines 106-144).

**Step 3: Update `provider-manager.service.ts` and `SYNC_PROVIDERS`**

The `SYNC_PROVIDERS` array type becomes `SyncProviderBase<any>[]`. Any code that needs file operations narrows via a type guard:

```typescript
export const isFileSyncProvider = (
  provider: SyncProviderBase<SyncProviderId>,
): provider is FileSyncProvider<SyncProviderId> => {
  return 'getFileRev' in provider && typeof (provider as any).getFileRev === 'function';
};
```

**Step 4: Search for all references to `SyncProviderServiceInterface` and update**

Run `grep -r 'SyncProviderServiceInterface' src/` to find all references. Each reference either:
- Works with any provider → change to `SyncProviderBase`
- Needs file operations → change to `FileSyncProvider` or add a type guard
- Already checks `isOperationSyncCapable` → leave as is, update type

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass. This is a cross-cutting type change so run the full suite.

**Step 6: Lint and commit**

```bash
npm run lint
git add -u
git commit -m "refactor(sync): split SyncProviderServiceInterface, remove dead file-op stubs from SuperSync"
```

---

### Task 6: Merge encryption toggle and import handler patterns (~100 lines saved)

**Context:**
`SuperSyncEncryptionToggleService.enableEncryption` and `ImportEncryptionHandlerService.handleEncryptionStateChange` follow the exact same pattern:
1. `gatherSnapshotData()`
2. `isCryptoSubtleAvailable()` check
3. `encryptPayload()` (if enabling)
4. `syncProvider.deleteAllData()`
5. Update provider config
6. Upload snapshot
7. `updateLastServerSeq()`

The only differences: error handling (toggle throws; import returns result), and config revert on failure (toggle reverts; import does not).

**Approach:** Add a `deleteAndReupload()` method to `SnapshotUploadService` that encapsulates steps 1-7. Both callers invoke it with their specific options.

**Files:**
- Modify: `src/app/imex/sync/snapshot-upload.service.ts`
- Modify: `src/app/imex/sync/supersync-encryption-toggle.service.ts`
- Modify: `src/app/imex/sync/import-encryption-handler.service.ts`
- Test: existing spec files for both services

**Step 1: Run existing tests**

Run:
```bash
npm run test:file src/app/imex/sync/supersync-encryption-toggle.service.spec.ts
npm run test:file src/app/imex/sync/import-encryption-handler.service.spec.ts
```
Expected: All pass.

**Step 2: Add `deleteAndReuploadWithNewEncryption()` to `SnapshotUploadService`**

```typescript
/**
 * Deletes all server data and uploads a fresh snapshot with new encryption settings.
 * Common pattern used by both encryption toggle and import encryption handler.
 */
async deleteAndReuploadWithNewEncryption(options: {
  encryptKey: string | undefined;
  isEncryptionEnabled: boolean;
  logPrefix: string;
}): Promise<SnapshotUploadResult & { existingCfg: SuperSyncPrivateCfg | null }> {
  const { encryptKey, isEncryptionEnabled, logPrefix } = options;

  // Validate crypto availability before destructive action
  if (isEncryptionEnabled && !isCryptoSubtleAvailable()) {
    throw new WebCryptoNotAvailableError(
      'Cannot enable encryption: WebCrypto API is not available.',
    );
  }

  const { syncProvider, existingCfg, state, vectorClock, clientId } =
    await this.gatherSnapshotData(logPrefix);

  // Encrypt before delete (fail-early)
  let payload: unknown = state;
  if (isEncryptionEnabled && encryptKey) {
    payload = await this._encryptionService.encryptPayload(state, encryptKey);
  }

  // Delete all server data
  await syncProvider.deleteAllData();

  // Update config before upload
  await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, {
    ...existingCfg,
    encryptKey: isEncryptionEnabled ? encryptKey : undefined,
    isEncryptionEnabled,
  } as SuperSyncPrivateCfg);

  // Upload snapshot
  const result = await this.uploadSnapshot(
    syncProvider,
    payload,
    clientId,
    vectorClock,
    isEncryptionEnabled && !!encryptKey,
  );

  if (result.accepted) {
    await this.updateLastServerSeq(syncProvider, result.serverSeq, logPrefix);
  }

  return { ...result, existingCfg };
}
```

This requires injecting `OperationEncryptionService` and `SyncProviderManager` into `SnapshotUploadService`.

**Step 3: Simplify `SuperSyncEncryptionToggleService.enableEncryption`**

```typescript
async enableEncryption(encryptKey: string): Promise<void> {
  if (!encryptKey) throw new Error('Encryption key is required');

  // Guard against concurrent calls
  const activeProvider = this._providerManager.getActiveProvider();
  if (activeProvider) {
    const currentCfg = await activeProvider.privateCfg.load() as { isEncryptionEnabled?: boolean; encryptKey?: string } | undefined;
    if (currentCfg?.isEncryptionEnabled && currentCfg?.encryptKey) return;
  }

  try {
    const result = await this._snapshotUploadService.deleteAndReuploadWithNewEncryption({
      encryptKey,
      isEncryptionEnabled: true,
      logPrefix: LOG_PREFIX,
    });
    if (!result.accepted) throw new Error(`Snapshot upload failed: ${result.error}`);
    this._wrappedProviderService.clearCache();
  } catch (error) {
    // Revert config on failure
    // ... (revert logic stays here — specific to toggle service)
    throw error;
  }
}
```

**Step 4: Simplify `ImportEncryptionHandlerService.handleEncryptionStateChange`**

```typescript
async handleEncryptionStateChange(...): Promise<EncryptionStateChangeResult> {
  try {
    const result = await this._snapshotUploadService.deleteAndReuploadWithNewEncryption({
      encryptKey: isEncryptionEnabled ? newEncryptKey : undefined,
      isEncryptionEnabled,
      logPrefix: LOG_PREFIX,
    });
    if (!result.accepted) throw new Error(`Snapshot upload failed: ${result.error}`);
    return { encryptionStateChanged: true, serverDataDeleted: true, snapshotUploaded: true };
  } catch (error) {
    return { encryptionStateChanged: true, serverDataDeleted: false, snapshotUploaded: false, error: ... };
  }
}
```

**Step 5: Run tests**

Run:
```bash
npm run test:file src/app/imex/sync/supersync-encryption-toggle.service.spec.ts
npm run test:file src/app/imex/sync/import-encryption-handler.service.spec.ts
npm run test:file src/app/imex/sync/snapshot-upload.service.spec.ts
```
Expected: All pass.

**Step 6: Lint and commit**

```bash
npm run checkFile src/app/imex/sync/snapshot-upload.service.ts
npm run checkFile src/app/imex/sync/supersync-encryption-toggle.service.ts
npm run checkFile src/app/imex/sync/import-encryption-handler.service.ts
git add -u
git commit -m "refactor(sync): extract shared delete-and-reupload pattern into SnapshotUploadService"
```

---

### Task 7: Decompose `operation-log-sync.service.ts` — extract helper methods (~100-200 lines)

**Context:**
At 1,106 lines with 13 injected dependencies, this is the largest orchestrator. Specific extraction targets:

1. **SYNC_IMPORT conflict dialog logic** — duplicated between upload and download paths. Extract `_handleSyncImportConflict()`.
2. **`_hasMeaningfulLocalData()` + `_hasMeaningfulPendingOps()`** — always called together in 3 places. Extract `_hasAnyMeaningfulData(pendingOps)`.
3. **Server migration detection** — in both upload and download. Extract `_checkForServerMigration()`.

**Files:**
- Modify: `src/app/op-log/sync/operation-log-sync.service.ts`
- Test: `src/app/op-log/sync/operation-log-sync.service.spec.ts`

**Step 1: Run existing tests**

Run: `npm run test:file src/app/op-log/sync/operation-log-sync.service.spec.ts`
Expected: All pass.

**Step 2: Extract `_hasAnyMeaningfulData()`**

Find the 3 places where `_hasMeaningfulLocalData()` and `_hasMeaningfulPendingOps()` are called together and replace with a single method:

```typescript
private _hasAnyMeaningfulData(pendingOps: OperationLogEntry[]): boolean {
  return this._hasMeaningfulPendingOps(pendingOps) || this._hasMeaningfulLocalData();
}
```

**Step 3: Extract `_handleSyncImportConflict()` for shared dialog logic**

Identify the SYNC_IMPORT dialog handling in both `uploadPendingOps` and `downloadRemoteOps` and extract the common pattern.

**Step 4: Run tests after each extraction**

Run: `npm run test:file src/app/op-log/sync/operation-log-sync.service.spec.ts`
Expected: All pass after each change.

**Step 5: Lint and commit**

```bash
npm run checkFile src/app/op-log/sync/operation-log-sync.service.ts
git add src/app/op-log/sync/operation-log-sync.service.ts
git commit -m "refactor(sync): extract helper methods from operation-log-sync.service.ts"
```

---

### Task 8: Auto-invalidate `WrappedProviderService` cache on credential changes (~20 lines saved, fragility removed)

**Context:**
`WrappedProviderService._cache.clear()` is called manually in 5 different places across 3 services when encryption changes. This is fragile — new code paths that change encryption could forget to invalidate.

**Approach:** Have `WrappedProviderService` subscribe to `SyncCredentialStore` changes and auto-invalidate.

**Files:**
- Modify: `src/app/op-log/sync-providers/wrapped-provider.service.ts`
- Modify: callers that manually call `clearCache()` (remove those calls)
- Test: `src/app/op-log/sync-providers/wrapped-provider.service.spec.ts`

**Step 1: Investigate how `SyncCredentialStore` notifies changes**

Check if `SyncCredentialStore` has an observable or callback for changes. If not, add one. The simplest approach: have `SyncProviderManager.setProviderConfig()` emit a signal that `WrappedProviderService` subscribes to.

**Step 2: Subscribe and auto-clear**

```typescript
constructor() {
  // Auto-invalidate cache when provider config changes
  this._providerManager.providerConfigChanged$
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      this._cache.clear();
      OpLog.normal('WrappedProviderService: Cache auto-invalidated due to config change');
    });
}
```

**Step 3: Remove manual `clearCache()` calls from consumers**

Remove the explicit `this._wrappedProviderService.clearCache()` calls from:
- `supersync-encryption-toggle.service.ts` (3 occurrences)
- `import-encryption-handler.service.ts`
- `file-based-encryption.service.ts`
- `sync-config.service.ts` (3 occurrences)

Keep the public `clearCache()` method as an escape hatch but mark it `@deprecated` with a note about auto-invalidation.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All pass.

**Step 5: Lint and commit**

```bash
npm run lint
git add -u
git commit -m "refactor(sync): auto-invalidate WrappedProviderService cache on config changes"
```

---

## Phase 3: Lower Priority (Optional, Do If Time Permits)

### Task 9: Extract conflict resolution entity-type strategies from `conflict-resolution.service.ts`

**Context:**
At 1,324 lines, this file handles both conflict detection AND entity-type-specific LWW merge strategies. The entity-specific merge logic could be extracted into strategy objects per entity type, making the core service shorter and each strategy independently testable.

**Scope:** This is a large refactor. Consider it a follow-up task. The current approach works; this is about maintainability.

**Approach:**
1. Define a `ConflictResolutionStrategy` interface with a `resolve(local, remote): LWWResolution` method
2. Create one strategy per entity type in a `strategies/` subdirectory
3. The core service dispatches to the appropriate strategy based on `entityType`
4. Each strategy is independently testable

**Files:**
- Create: `src/app/op-log/sync/strategies/` directory
- Modify: `src/app/op-log/sync/conflict-resolution.service.ts`

This task should be done as a separate PR due to its scope.

---

### Task 10: Consolidate encryption key storage (architectural — future consideration)

**Context:**
The encryption key and `isEncryptionEnabled` flag exist in three places:
1. `SyncCredentialStore` (IndexedDB `sup-sync` database) — **the source of truth**
2. NgRx global config store (`globalConfig.sync.superSync`) — view model for the settings form
3. `WrappedProviderService` runtime config — derived from #1 and #2

Toggling encryption requires updating both #1 and #2. This dual-update pattern is a source of subtle bugs.

**Long-term approach:** Make `SyncCredentialStore` the single source of truth. The NgRx sync config should derive encryption state from the credential store via an effect or signal, not store its own copy.

**Risk:** High. This is a cross-cutting change that affects the settings form, sync initialization, and multiple services. Recommend doing this only after the above refactors are stable.

---

## Summary

| Task | Phase | Lines Saved | Risk | Dependencies |
|------|-------|-------------|------|--------------|
| 1. Unify HTTP methods | 1 | ~150 | Low | None |
| 2. Remove encryption tokens | 1 | ~74 | Low | None |
| 3. Remove DerivedKeyCacheService | 1 | ~33 | Low | None |
| 4. Cache server seq key | 1 | ~10 | Low | None |
| 5. Split provider interface | 2 | ~40 + types | Medium | None |
| 6. Merge encryption patterns | 2 | ~100 | Medium | None |
| 7. Decompose orchestrator | 2 | ~100-200 | Medium | None |
| 8. Auto-invalidate cache | 2 | ~20 | Medium | Task 3 done |
| 9. Extract conflict strategies | 3 | ~200 moved | Medium-High | None |
| 10. Consolidate key storage | 3 | ~50 + bugs | High | Task 8 done |
| **Total** | | **~600-900** | | |

Tasks 1-4 are fully independent and can be done in any order (or in parallel via separate worktrees). Tasks 5-8 are also independent of each other but depend on Phase 1 being done. Tasks 9-10 are follow-up work.
