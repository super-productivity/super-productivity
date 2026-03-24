# Plan: Protect Integration Tokens on the Local Filesystem

**Issue:** [#5915](https://github.com/super-productivity/super-productivity/issues/5915)

## Problem

Integration tokens (GitHub, Jira, GitLab, WebDAV, etc.) are stored in plaintext in:
1. **IndexedDB** (`SUP_OPS` database) — in `state_cache` and `ops` stores
2. **Backup files** (`~/.config/superProductivity/backups/`) — complete JSON exports
3. **Plugin OAuth store** — separate IndexedDB (`sup-plugin-oauth`)
4. **Sync credential store** — separate IndexedDB (`sup-sync`)

Anyone with filesystem access can extract these tokens.

## Proposed Solution: Transparent OS-Level Encryption via Electron `safeStorage`

Use **Electron's `safeStorage` API** to encrypt sensitive values using the OS credential store (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet). This is **completely transparent to the user** — no master password needed, no prompts, no extra steps.

For **Web/PWA**: IndexedDB is already origin-sandboxed by the browser. The main threat (filesystem access to `~/.config/superProductivity`) only applies to Electron.

For **Mobile/Capacitor**: Defer to a future phase using platform-specific secure storage plugins.

## Architecture Overview

```
                          ELECTRON (Desktop)
                          ==================
Token entered by user
        │
        ▼
  ┌─────────────────┐     IPC invoke          ┌─────────────────────┐
  │  Frontend        │ ──────────────────────► │  Main Process       │
  │  (renderer)      │   "SAFE_STORAGE_ENCRYPT"│  safeStorage API    │
  │                  │ ◄────────────────────── │  (OS keychain)      │
  └─────────────────┘     encrypted string     └─────────────────────┘
        │
        ▼
  Store encrypted value in NgRx → IndexedDB → backups → sync
        │
        ▼  (on API call)
  ┌─────────────────┐     IPC invoke          ┌─────────────────────┐
  │  Frontend        │ ──────────────────────► │  Main Process       │
  │  needs token     │   "SAFE_STORAGE_DECRYPT"│  safeStorage API    │
  │                  │ ◄────────────────────── │  (OS keychain)      │
  └─────────────────┘     plaintext token      └─────────────────────┘


                       WEB / PWA (No change needed)
                       ============================
  Browser origin-sandbox protects IndexedDB.
  No filesystem exposure like Electron's userData folder.
```

## Why `safeStorage` Over a Master Password

| Aspect | Master Password | `safeStorage` |
|--------|----------------|---------------|
| User friction | Must enter password every launch | Zero — fully transparent |
| Security backing | Custom Argon2id | OS-managed (Keychain/DPAPI/libsecret) |
| Forgotten password | Data loss risk | OS handles credential lifecycle |
| Implementation complexity | High (UI, migration, startup flow) | Low (IPC + service wrapper) |
| Cross-device sync | Each device needs the password | Each device encrypts independently |
| Platform coverage | All platforms | Electron only (Web is already safe) |

## Implementation Steps

### Step 1: Add `safeStorage` IPC Handlers in Electron Main Process

**File:** `electron/safe-storage.ts` (new)

Register two IPC handlers using Electron's `safeStorage` module:

```typescript
import { ipcMain, safeStorage } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';

export function initSafeStorage(): void {
  ipcMain.handle(IPC.SAFE_STORAGE_ENCRYPT, (_ev, plaintext: string): string | null => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  });

  ipcMain.handle(IPC.SAFE_STORAGE_DECRYPT, (_ev, encryptedBase64: string): string | null => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buffer = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(buffer);
  });
}
```

**Key points:**
- `safeStorage.isEncryptionAvailable()` returns `false` on some Linux setups without a keyring. In that case, fall back to storing plaintext (same as today — no regression).
- `encryptString` / `decryptString` are synchronous and fast (microseconds).
- Values are base64-encoded for safe storage in JSON/IndexedDB.

### Step 2: Add IPC Events

**File:** `electron/shared-with-frontend/ipc-events.const.ts` (modify)

Add two new IPC events to the `IPC` enum:
```typescript
SAFE_STORAGE_ENCRYPT = 'SAFE_STORAGE_ENCRYPT',
SAFE_STORAGE_DECRYPT = 'SAFE_STORAGE_DECRYPT',
```

### Step 3: Expose via Preload Bridge

**File:** `electron/preload.ts` (modify)

Add to the `ea` object:
```typescript
safeStorageEncrypt: (plaintext: string) =>
  _invoke('SAFE_STORAGE_ENCRYPT', plaintext) as Promise<string | null>,
safeStorageDecrypt: (encryptedBase64: string) =>
  _invoke('SAFE_STORAGE_DECRYPT', encryptedBase64) as Promise<string | null>,
```

**File:** `electron/electronAPI.d.ts` (modify)

Add type definitions:
```typescript
safeStorageEncrypt(plaintext: string): Promise<string | null>;
safeStorageDecrypt(encryptedBase64: string): Promise<string | null>;
```

### Step 4: Create Frontend `SecretEncryptionService`

**File:** `src/app/core/encryption/secret-encryption.service.ts` (new)

A thin Angular service that wraps the IPC calls, with a **decrypted-value cache** so we only call IPC once per token per session:

```typescript
@Injectable({ providedIn: 'root' })
export class SecretEncryptionService {
  // In-memory cache: encrypted base64 → plaintext
  private _decryptCache = new Map<string, string>();

  /** Returns true if OS-level encryption is available (Electron + keyring present) */
  isAvailable(): boolean {
    return IS_ELECTRON && typeof window.ea?.safeStorageEncrypt === 'function';
  }

  /** Encrypt a secret. Returns original value if not in Electron. */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.isAvailable() || !plaintext) return plaintext;
    const encrypted = await window.ea.safeStorageEncrypt(plaintext);
    if (!encrypted) return plaintext; // encryption unavailable, no regression
    return `enc:${encrypted}`; // prefix to distinguish from plaintext
  }

  /** Decrypt a secret. Returns original value if not encrypted. */
  async decrypt(value: string): Promise<string> {
    if (!value?.startsWith('enc:')) return value; // not encrypted, return as-is
    const encryptedBase64 = value.slice(4);

    // Check cache first
    const cached = this._decryptCache.get(encryptedBase64);
    if (cached) return cached;

    const plaintext = await window.ea.safeStorageDecrypt(encryptedBase64);
    if (plaintext === null) throw new Error('Failed to decrypt secret');
    this._decryptCache.set(encryptedBase64, plaintext);
    return plaintext;
  }

  /** Check if a value is encrypted */
  isEncrypted(value: string): boolean {
    return value?.startsWith('enc:') ?? false;
  }

  /** Clear the in-memory cache */
  clearCache(): void {
    this._decryptCache.clear();
  }
}
```

**Design notes:**
- The `enc:` prefix makes encrypted values self-describing. This enables gradual migration — old plaintext values continue working, new values get encrypted.
- The cache avoids repeated IPC round-trips for the same token during a session.
- On Web/PWA, `isAvailable()` returns false and all values pass through unchanged.

### Step 5: Define Sensitive Field Registry

**File:** `src/app/core/encryption/sensitive-fields.const.ts` (new)

Single source of truth for which fields contain secrets:

```typescript
/** Maps issue provider keys to their sensitive field names */
export const SENSITIVE_PROVIDER_FIELDS: Record<string, string[]> = {
  JIRA: ['password'],
  GITLAB: ['token'],
  CALDAV: ['password'],
  OPEN_PROJECT: ['token'],
  GITEA: ['token'],
  REDMINE: ['token'],
  TRELLO: ['accessToken'],
  LINEAR: ['token'],
  AZURE_DEVOPS: ['token'],
  NEXTCLOUD_DECK: ['password'],
};

/** Sensitive fields in the global sync config */
export const SENSITIVE_SYNC_FIELDS = {
  webDav: ['password'],
  superSync: ['accessToken', 'encryptKey'],
  root: ['encryptKey'],
};
```

### Step 6: Integrate at Config Boundaries

#### 6a. Issue Provider Config — Encrypt on Save

**File:** `src/app/features/issue/store/issue-provider.effects.ts` (or the relevant save path)

When an issue provider config is saved/updated, encrypt its sensitive fields:

```typescript
// Before dispatching updateIssueProvider action:
for (const field of SENSITIVE_PROVIDER_FIELDS[provider.issueProviderKey] ?? []) {
  if (provider[field]) {
    provider[field] = await secretEncryptionService.encrypt(provider[field]);
  }
}
```

This happens **once** at save time. The encrypted value is what persists.

#### 6b. Issue Provider API Services — Decrypt on Use

**Files:** Each provider's API service where tokens are read from config.

Example for GitLab (`gitlab-api.service.ts`):
```typescript
// Before making HTTP request:
const token = await this._secretEncryption.decrypt(cfg.token);
headers: { 'PRIVATE-TOKEN': token }
```

Similarly for Jira (`jira-api.service.ts`), Gitea, etc.

#### 6c. Plugin OAuth Token Store

**File:** `src/app/plugins/oauth/plugin-oauth-token-store.ts` (modify)

Wrap save/load:
```typescript
export const saveOAuthTokens = async (key: string, data: string): Promise<void> => {
  const encrypted = await secretEncryptionService.encrypt(data);
  // ... store encrypted
};

export const loadOAuthTokens = async (key: string): Promise<string | null> => {
  const raw = // ... load from db
  return raw ? await secretEncryptionService.decrypt(raw) : null;
};
```

#### 6d. Sync Credential Store

**File:** `src/app/op-log/sync-providers/credential-store.service.ts` (modify)

Encrypt sensitive fields in `_save()` and decrypt in `load()`.

### Step 7: Encrypt Backup Data

**File:** `electron/backup.ts` (modify)

The backup file (`~/.config/superProductivity/backups/*.json`) is the primary concern from the issue. Since tokens are now stored encrypted in the NgRx store, backups **automatically contain encrypted tokens** — no backup code changes needed.

However, we should also encrypt the entire backup file for defense-in-depth:

```typescript
function backupData(ev: IpcMainEvent, data: AppDataCompleteLegacy): void {
  const backup = JSON.stringify(data);
  // Encrypt the whole backup using safeStorage if available
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(backup);
    writeFileSync(filePath, encrypted); // binary file
  } else {
    writeFileSync(filePath, backup); // plaintext JSON fallback
  }
}
```

On restore, detect whether the file is encrypted (binary) or plaintext (JSON):
```typescript
function loadBackupData(backupPath: string): string {
  const raw = readFileSync(backupPath);
  try {
    JSON.parse(raw.toString('utf8')); // if it parses, it's plaintext
    return raw.toString('utf8');
  } catch {
    return safeStorage.decryptString(raw); // binary = encrypted
  }
}
```

### Step 8: Migration — Encrypt Existing Plaintext Tokens

**File:** `src/app/core/encryption/secret-migration.service.ts` (new)

On first run after this feature ships (detected by absence of `enc:` prefix on tokens):

1. Read all issue providers from the store
2. For each provider, encrypt sensitive fields that are non-empty plaintext
3. Dispatch update actions
4. Do the same for sync config credentials
5. Do the same for plugin OAuth tokens and sync credential store

This migration runs automatically and silently. The `enc:` prefix means it's idempotent — already-encrypted values are skipped.

### Step 9: Register in Electron Main

**File:** `electron/main.ts` (modify)

Call `initSafeStorage()` during app initialization, alongside existing `initBackupAdapter()` etc.

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `electron/safe-storage.ts` | IPC handlers for `safeStorage.encryptString/decryptString` |
| `src/app/core/encryption/secret-encryption.service.ts` | Frontend service wrapping IPC calls + cache |
| `src/app/core/encryption/sensitive-fields.const.ts` | Registry of sensitive field names |
| `src/app/core/encryption/secret-migration.service.ts` | One-time migration of existing plaintext tokens |

### Modified Files
| File | Change |
|------|--------|
| `electron/shared-with-frontend/ipc-events.const.ts` | Add `SAFE_STORAGE_ENCRYPT/DECRYPT` events |
| `electron/preload.ts` | Expose `safeStorageEncrypt/Decrypt` on `window.ea` |
| `electron/electronAPI.d.ts` | Type definitions for new methods |
| `electron/main.ts` | Call `initSafeStorage()` |
| `electron/backup.ts` | Encrypt/decrypt backup files |
| `src/app/features/issue/providers/*/\*-api.service.ts` | Decrypt tokens before API calls |
| `src/app/features/issue/store/issue-provider.effects.ts` | Encrypt tokens on save |
| `src/app/plugins/oauth/plugin-oauth-token-store.ts` | Wrap with encryption |
| `src/app/op-log/sync-providers/credential-store.service.ts` | Wrap with encryption |

## Security Properties

1. **Zero user friction** — OS handles key management transparently
2. **OS-backed security** — macOS Keychain, Windows DPAPI, Linux libsecret/kwallet
3. **Graceful degradation** — if no keyring available (some Linux), falls back to plaintext (no regression)
4. **Gradual migration** — `enc:` prefix distinguishes encrypted from plaintext; old data works until re-saved
5. **Defense in depth** — both individual tokens AND entire backup files are encrypted
6. **Sync-safe** — encrypted tokens are just strings; sync works unchanged
7. **Web/PWA safe** — browser sandbox already protects IndexedDB; no filesystem exposure

## Limitations & Future Work

- **Linux without keyring**: Falls back to plaintext. Could show a one-time warning suggesting the user install `gnome-keyring` or `kwallet`.
- **Web/PWA**: No additional protection (already origin-sandboxed). Could add optional master password in a future phase for paranoid users.
- **Mobile**: Not addressed in this phase. Future work: add `@capacitor-community/secure-storage` for Android Keystore / iOS Keychain integration.
- **Cross-device encrypted tokens**: If a user syncs encrypted tokens to another Electron device, that device's `safeStorage` can't decrypt them (different OS key). Tokens would need to be re-entered on each device. This matches how the existing `sup-plugin-oauth` and `sup-sync` stores already work (local-only, not synced). For tokens in the synced store (issue providers), we need to either:
  - (a) Only encrypt in local-only stores, not in the synced NgRx state, OR
  - (b) Encrypt in the synced state but store the encryption key in `safeStorage` so each device can access it

  **Recommended: Option (a)** — Move sensitive fields out of the synced state into a local-only credential store (similar to how `sup-sync` and `sup-plugin-oauth` already work). This is a cleaner architectural separation: non-sensitive config syncs, credentials stay local.

## Testing Strategy

1. **Unit tests** for `SecretEncryptionService` — encrypt/decrypt round-trip, `enc:` prefix handling, cache behavior, graceful fallback when not in Electron
2. **Unit tests** for migration service — encrypts only plaintext values, skips already-encrypted
3. **E2E test** (Electron) — configure an integration, verify token is encrypted in backup file, restart app, verify integration still works
4. **Manual testing** — verify on macOS, Windows, and Linux (with and without keyring)
