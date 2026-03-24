# Plan: Protect Integration Tokens on the Local Filesystem

**Issue:** [#5915](https://github.com/super-productivity/super-productivity/issues/5915)

## Problem

Integration tokens (GitHub, Jira, GitLab, WebDAV, etc.) are stored in plaintext in:
1. **IndexedDB** (`SUP_OPS` database) — in `state_cache` and `ops` stores
2. **Backup files** (`~/.config/superProductivity/backups/`) — complete JSON exports
3. **Plugin OAuth store** — separate IndexedDB (`sup-plugin-oauth`)
4. **Sync credential store** — separate IndexedDB (`sup-sync`)

Anyone with filesystem access can extract these tokens.

## Proposed Solution: Transparent Per-Platform Encryption

Encrypt sensitive values using platform-native mechanisms — **completely transparent to the user**. No master password, no prompts, no extra steps.

| Platform | Mechanism | User Action Required |
|----------|-----------|---------------------|
| **Electron (Desktop)** | `safeStorage` API → macOS Keychain / Windows DPAPI / Linux libsecret | None |
| **Android** | `EncryptedSharedPreferences` via Android Keystore (AES256-GCM) | None |
| **iOS** | iOS Keychain via Capacitor Secure Storage plugin | None |
| **Web/PWA** | Simple obfuscation (base64 + XOR) — defense against casual inspection | None |

## Architecture Overview

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                      SecretEncryptionService                        │
  │              (single Angular service, platform-adaptive)            │
  │                                                                     │
  │   encrypt(plaintext) → "enc:<base64>"                              │
  │   decrypt("enc:<base64>") → plaintext                              │
  │   decrypt("not-prefixed") → passthrough (backwards compat)         │
  └─────────────┬──────────────┬──────────────┬────────────────────────┘
                │              │              │
       ┌────────▼────┐  ┌─────▼──────┐  ┌───▼──────────┐  ┌──────────┐
       │  Electron    │  │  Android   │  │  iOS         │  │  Web     │
       │  safeStorage │  │  Encrypted │  │  Keychain    │  │  XOR     │
       │  (IPC)       │  │  SharedPref│  │  (Capacitor) │  │  obfusc. │
       └──────────────┘  └────────────┘  └──────────────┘  └──────────┘
```

All platforms use the **same `enc:` prefix convention** so encrypted values are interchangeable in the codebase. The service auto-detects the platform and uses the appropriate backend.

## Why Platform-Native Over a Master Password

| Aspect | Master Password | Platform-Native |
|--------|----------------|-----------------|
| User friction | Must enter password every launch | Zero — fully transparent |
| Security backing | Custom Argon2id | OS-managed (Keychain/DPAPI/Keystore) |
| Forgotten password | Data loss risk | OS handles credential lifecycle |
| Implementation complexity | High (UI, migration, startup) | Moderate (per-platform adapter) |
| Android | Same complexity | Already have `EncryptedSharedPreferences` |
| Web | Same as native | Simple obfuscation (sufficient for origin-sandboxed storage) |

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

### Step 4: Add Android Native Bridge Methods

**Existing infrastructure:** Android already has `EncryptedSharedPreferences` with AES256-GCM (`BackgroundSyncCredentialStore.kt`). We extend this pattern to expose encrypt/decrypt to the WebView.

**File:** `android/.../webview/JavaScriptInterface.kt` (modify)

Add two new `@JavascriptInterface` methods:

```kotlin
@JavascriptInterface
fun secureEncrypt(requestId: String, plaintext: String) {
    callJavaScriptFunction("window.SUPAndroid.secureEncryptCallback('$requestId', " +
        "'${encryptViaKeystore(plaintext)}')")
}

@JavascriptInterface
fun secureDecrypt(requestId: String, encryptedBase64: String) {
    callJavaScriptFunction("window.SUPAndroid.secureDecryptCallback('$requestId', " +
        "'${decryptViaKeystore(encryptedBase64)}')")
}
```

**File:** `android/.../service/SecureStorageHelper.kt` (new)

Reuse the existing `MasterKey` / `EncryptedSharedPreferences` pattern from `BackgroundSyncCredentialStore.kt`, but expose generic encrypt/decrypt:

```kotlin
object SecureStorageHelper {
    fun encrypt(context: Context, plaintext: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        // Use or create a dedicated key for token encryption
        val key = getOrCreateKey(keyStore, "sp_token_key")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        // Concatenate IV + ciphertext, base64 encode
        return Base64.encodeToString(iv + encrypted, Base64.NO_WRAP)
    }

    fun decrypt(context: Context, encryptedBase64: String): String {
        val data = Base64.decode(encryptedBase64, Base64.NO_WRAP)
        val iv = data.sliceArray(0 until 12)
        val ciphertext = data.sliceArray(12 until data.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = keyStore.getKey("sp_token_key", null) as SecretKey
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }
}
```

**Key points:**
- Uses Android Keystore directly (hardware-backed on most devices)
- Key material never leaves the secure element
- Same pattern as existing `BackgroundSyncCredentialStore` but generic
- Callback-based to match existing `JavaScriptInterface` patterns (`saveToDb`, `loadFromDb`)

### Step 5: Add Android Frontend Bridge

**File:** `src/app/features/android/android-interface.ts` (modify)

Add wrapped Promise methods following the existing pattern (like `saveToDbWrapped`):

```typescript
secureEncryptWrapped(plaintext: string): Promise<string>;
secureDecryptWrapped(encryptedBase64: string): Promise<string>;
```

### Step 6: iOS Secure Storage (Capacitor Plugin)

**Option A (recommended):** Use `@capacitor-community/secure-storage` plugin:

```bash
npm install @capacitor-community/secure-storage
npx cap sync ios
```

This provides iOS Keychain integration via a simple API:
```typescript
import { SecureStorage } from '@capacitor-community/secure-storage';
await SecureStorage.set({ key: 'token_key', value: plaintext });
const { value } = await SecureStorage.get({ key: 'token_key' });
```

**Option B (simpler for encrypt/decrypt only):** Since we need encrypt/decrypt rather than key-value storage, we can add a small native Swift plugin that wraps CommonCrypto with a Keychain-stored key, similar to the Android approach.

**Recommended:** Option A for simplicity. Store the encrypted representation as the value, retrieve on demand. The plugin handles Keychain key management internally.

### Step 7: Web Obfuscation

**File:** `src/app/core/encryption/web-obfuscation.ts` (new)

For Web/PWA, IndexedDB is already origin-sandboxed. The main risk is browser extensions or devtools inspection. A simple obfuscation prevents casual reading without pretending to be real security:

```typescript
/**
 * Simple XOR obfuscation for web platform.
 * NOT cryptographically secure — just prevents casual plaintext exposure
 * in devtools / IndexedDB viewers. Real protection comes from browser
 * origin sandboxing.
 */
const OBFUSCATION_KEY = 'sp-web-token-obfuscation-v1';

export function obfuscate(plaintext: string): string {
  const bytes = new TextEncoder().encode(plaintext);
  const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return btoa(String.fromCharCode(...result));
}

export function deobfuscate(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder().decode(result);
}
```

### Step 8: Create Unified Frontend `SecretEncryptionService`

**File:** `src/app/core/encryption/secret-encryption.service.ts` (new)

A single Angular service that auto-detects the platform and routes to the appropriate backend. Includes an in-memory **decryption cache** to minimize IPC/bridge round-trips:

```typescript
@Injectable({ providedIn: 'root' })
export class SecretEncryptionService {
  private _decryptCache = new Map<string, string>();

  /** Encrypt a secret using the platform-appropriate mechanism */
  async encrypt(plaintext: string): Promise<string> {
    if (!plaintext) return plaintext;

    let encrypted: string | null = null;

    if (IS_ELECTRON) {
      encrypted = await window.ea.safeStorageEncrypt(plaintext);
    } else if (IS_ANDROID_WEB_VIEW) {
      encrypted = await androidInterface.secureEncryptWrapped(plaintext);
    } else if (isNativePlatform() && isIOS()) {
      encrypted = await capacitorSecureEncrypt(plaintext);
    } else {
      // Web: simple obfuscation
      encrypted = obfuscate(plaintext);
    }

    if (!encrypted) return plaintext; // platform encryption unavailable
    return `enc:${encrypted}`;
  }

  /** Decrypt a secret. Passes through non-encrypted values. */
  async decrypt(value: string): Promise<string> {
    if (!value?.startsWith('enc:')) return value;
    const payload = value.slice(4);

    const cached = this._decryptCache.get(payload);
    if (cached) return cached;

    let plaintext: string | null = null;

    if (IS_ELECTRON) {
      plaintext = await window.ea.safeStorageDecrypt(payload);
    } else if (IS_ANDROID_WEB_VIEW) {
      plaintext = await androidInterface.secureDecryptWrapped(payload);
    } else if (isNativePlatform() && isIOS()) {
      plaintext = await capacitorSecureDecrypt(payload);
    } else {
      plaintext = deobfuscate(payload);
    }

    if (plaintext === null) throw new Error('Failed to decrypt secret');
    this._decryptCache.set(payload, plaintext);
    return plaintext;
  }

  isEncrypted(value: string): boolean {
    return value?.startsWith('enc:') ?? false;
  }

  clearCache(): void {
    this._decryptCache.clear();
  }
}
```

**Design notes:**
- The `enc:` prefix makes encrypted values self-describing across all platforms
- Backwards compatible — old plaintext values pass through `decrypt()` unchanged
- Cache avoids repeated IPC/bridge round-trips for the same token
- Platform detection uses existing constants (`IS_ELECTRON`, `IS_ANDROID_WEB_VIEW`, etc.)

### Step 9: Define Sensitive Field Registry

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

### Step 10: Integrate at Config Boundaries

#### 10a. Issue Provider Config — Encrypt on Save

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

#### 10b. Issue Provider API Services — Decrypt on Use

**Files:** Each provider's API service where tokens are read from config.

Example for GitLab (`gitlab-api.service.ts`):
```typescript
// Before making HTTP request:
const token = await this._secretEncryption.decrypt(cfg.token);
headers: { 'PRIVATE-TOKEN': token }
```

Similarly for Jira (`jira-api.service.ts`), Gitea, etc.

#### 10c. Plugin OAuth Token Store

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

#### 10d. Sync Credential Store

**File:** `src/app/op-log/sync-providers/credential-store.service.ts` (modify)

Encrypt sensitive fields in `_save()` and decrypt in `load()`.

### Step 11: Encrypt Backup Data

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

### Step 12: Migration — Encrypt Existing Plaintext Tokens

**File:** `src/app/core/encryption/secret-migration.service.ts` (new)

On first run after this feature ships (detected by absence of `enc:` prefix on tokens):

1. Read all issue providers from the store
2. For each provider, encrypt sensitive fields that are non-empty plaintext
3. Dispatch update actions
4. Do the same for sync config credentials
5. Do the same for plugin OAuth tokens and sync credential store

This migration runs automatically and silently. The `enc:` prefix means it's idempotent — already-encrypted values are skipped.

### Step 13: Register in Electron Main

**File:** `electron/main.ts` (modify)

Call `initSafeStorage()` during app initialization, alongside existing `initBackupAdapter()` etc.

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `electron/safe-storage.ts` | IPC handlers for `safeStorage.encryptString/decryptString` |
| `android/.../service/SecureStorageHelper.kt` | Android Keystore encrypt/decrypt helper |
| `src/app/core/encryption/secret-encryption.service.ts` | Unified frontend service (platform-adaptive) + cache |
| `src/app/core/encryption/web-obfuscation.ts` | Simple XOR obfuscation for Web/PWA |
| `src/app/core/encryption/sensitive-fields.const.ts` | Registry of sensitive field names |
| `src/app/core/encryption/secret-migration.service.ts` | One-time migration of existing plaintext tokens |

### Modified Files
| File | Change |
|------|--------|
| `electron/shared-with-frontend/ipc-events.const.ts` | Add `SAFE_STORAGE_ENCRYPT/DECRYPT` events |
| `electron/preload.ts` | Expose `safeStorageEncrypt/Decrypt` on `window.ea` |
| `electron/electronAPI.d.ts` | Type definitions for new Electron methods |
| `electron/main.ts` | Call `initSafeStorage()` |
| `electron/backup.ts` | Encrypt/decrypt backup files |
| `android/.../webview/JavaScriptInterface.kt` | Add `secureEncrypt/Decrypt` bridge methods |
| `src/app/features/android/android-interface.ts` | Add `secureEncryptWrapped/DecryptWrapped` |
| `src/app/features/issue/providers/*/\*-api.service.ts` | Decrypt tokens before API calls |
| `src/app/features/issue/store/issue-provider.effects.ts` | Encrypt tokens on save |
| `src/app/plugins/oauth/plugin-oauth-token-store.ts` | Wrap with encryption |
| `src/app/op-log/sync-providers/credential-store.service.ts` | Wrap with encryption |
| `package.json` | Add `@capacitor-community/secure-storage` (for iOS) |

## Security Properties

1. **Zero user friction** — OS handles key management transparently
2. **OS-backed security** — macOS Keychain, Windows DPAPI, Linux libsecret/kwallet
3. **Graceful degradation** — if no keyring available (some Linux), falls back to plaintext (no regression)
4. **Gradual migration** — `enc:` prefix distinguishes encrypted from plaintext; old data works until re-saved
5. **Defense in depth** — both individual tokens AND entire backup files are encrypted
6. **Sync-safe** — encrypted tokens are just strings; sync works unchanged
7. **Web/PWA safe** — browser sandbox already protects IndexedDB; no filesystem exposure

## Limitations & Notes

- **Linux without keyring**: `safeStorage` returns `isEncryptionAvailable() === false`. Falls back to plaintext (no regression). Could show a one-time warning suggesting `gnome-keyring` or `kwallet`.
- **Web obfuscation is NOT security**: It prevents casual inspection in devtools/IndexedDB viewers, but anyone who reads the source can reverse it. This is acceptable because browser origin-sandboxing is the real protection on web — there's no `~/.config/` folder to steal.
- **Cross-device encrypted tokens**: Each device encrypts with its own platform key. Synced encrypted tokens can't be decrypted on a different device. **Recommended solution: Option (a)** — encrypt only in local-only stores (like `sup-sync` and `sup-plugin-oauth` already do), not in the synced NgRx state. Non-sensitive config syncs, credentials stay local per-device.
- **Android Keystore reset**: Factory reset or certain OS updates can invalidate Android Keystore keys. Handle gracefully — if decryption fails, clear the encrypted value and prompt re-entry (same UX as token expiration).

## Testing Strategy

1. **Unit tests** for `SecretEncryptionService` — encrypt/decrypt round-trip, `enc:` prefix handling, cache behavior, passthrough for non-encrypted values
2. **Unit tests** for web obfuscation — round-trip, handles unicode, handles empty strings
3. **Unit tests** for migration service — encrypts only plaintext values, skips already-encrypted
4. **E2E test** (Electron) — configure an integration, verify token is encrypted in backup file, restart app, verify integration still works
5. **Android instrumented test** — verify `SecureStorageHelper` encrypt/decrypt round-trip with Android Keystore
6. **Manual testing** — verify on macOS, Windows, Linux (with/without keyring), Android, iOS, and Web
