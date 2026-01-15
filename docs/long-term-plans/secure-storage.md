# Secure Credential Storage Implementation Plan

## Overview

Implement platform-specific secure storage for all sync provider credentials (SuperSync, WebDAV, Dropbox) with automatic silent migration from plaintext IndexedDB storage.

**Confidence: 85%**

---

## Architecture

### Unified Interface

```typescript
interface SecureStorage {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

### Platform Implementations

| Platform | Mechanism                               | Security Level |
| -------- | --------------------------------------- | -------------- |
| Electron | `safeStorage` API (OS keychain)         | High           |
| Android  | `EncryptedSharedPreferences` (Keystore) | High           |
| Web      | WebCrypto with non-exportable key       | Medium         |

---

## Implementation Steps

### Step 1: Core Interface & Service

**New files:**

- `src/app/core/secure-storage/secure-storage.interface.ts` - Interface definition
- `src/app/core/secure-storage/secure-storage.service.ts` - Angular service with platform detection

```typescript
// secure-storage.service.ts
@Injectable({ providedIn: 'root' })
export class SecureStorageService implements SecureStorage {
  private _impl: SecureStorage;

  constructor() {
    if (IS_ELECTRON) {
      this._impl = new ElectronSecureStorage();
    } else if (IS_ANDROID_WEB_VIEW) {
      this._impl = new AndroidSecureStorage();
    } else {
      this._impl = new WebSecureStorage();
    }
  }
}
```

### Step 2: Electron Implementation

**New files:**

- `electron/secure-storage.ts` - Main process safeStorage handlers
- `src/app/core/secure-storage/electron-secure-storage.ts` - Renderer implementation

**Modified files:**

- `electron/shared-with-frontend/ipc-events.const.ts` - Add IPC events:
  ```typescript
  SECURE_STORAGE_SET = 'SECURE_STORAGE_SET',
  SECURE_STORAGE_GET = 'SECURE_STORAGE_GET',
  SECURE_STORAGE_REMOVE = 'SECURE_STORAGE_REMOVE',
  SECURE_STORAGE_IS_AVAILABLE = 'SECURE_STORAGE_IS_AVAILABLE',
  ```
- `electron/preload.ts` - Add methods to ElectronAPI
- `electron/electronAPI.d.ts` - Type definitions
- `electron/ipc-handler.ts` - Register handlers
- `src/app/core/window-ea.d.ts` - Frontend types

**Main process handler pattern:**

```typescript
// electron/secure-storage.ts
import { safeStorage } from 'electron';
import * as fs from 'fs/promises';

const SECURE_FILE = path.join(app.getPath('userData'), 'secureCredentials.enc');

export async function secureStorageSet(key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Not available');
  const existing = await loadFile();
  existing[key] = safeStorage.encryptString(value).toString('base64');
  await fs.writeFile(SECURE_FILE, JSON.stringify(existing));
}
```

### Step 3: Android Implementation

**New files:**

- `android/app/src/main/java/com/superproductivity/superproductivity/plugins/SecureStoragePlugin.kt`
- `src/app/core/secure-storage/android-secure-storage.ts`

**Modified files:**

- `android/app/build.gradle` - Add dependency:
  ```gradle
  implementation "androidx.security:security-crypto:1.1.0-alpha06"
  ```
- `android/app/src/main/java/.../CapacitorMainActivity.kt` - Register plugin

**Kotlin implementation:**

```kotlin
@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {
    private lateinit var encryptedPrefs: SharedPreferences

    override fun load() {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        encryptedPrefs = EncryptedSharedPreferences.create(...)
    }

    @PluginMethod fun set(call: PluginCall) { ... }
    @PluginMethod fun get(call: PluginCall) { ... }
}
```

### Step 4: Web Implementation

**New files:**

- `src/app/core/secure-storage/web-secure-storage.ts`
- `src/app/core/secure-storage/web-crypto-key-manager.ts`

**Approach:** Generate non-exportable AES-256-GCM key stored in IndexedDB. Encrypt credentials before storing.

```typescript
// web-crypto-key-manager.ts
async getOrCreateKey(): Promise<CryptoKey> {
  const existing = await this.loadKey();
  if (existing) return existing;

  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable - key cannot be exported
    ['encrypt', 'decrypt']
  );
}
```

**Note:** Web has weaker security (XSS can still access keys). This provides defense-in-depth, not absolute protection.

### Step 5: Migration Service

**New file:**

- `src/app/core/secure-storage/credential-migration.service.ts`

**Modified files:**

- `src/app/core/startup/startup.service.ts` - Call migration in `init()`
- `src/app/sync/providers/private-cfg-store.ts` - Add `clear()` method

**Migration flow:**

```
App Start → migrateIfNeeded()
  │
  ├─ Check localStorage flag 'secure_storage_migration_v1'
  │   └─ If set → skip (already migrated)
  │
  ├─ For each provider (SuperSync, WebDAV, Dropbox):
  │   ├─ Check secure storage → if exists, skip
  │   ├─ Load from plaintext IndexedDB
  │   ├─ Encrypt and save to secure storage
  │   └─ Delete from plaintext IndexedDB
  │
  └─ Set migration flag
```

### Step 6: Integration

**Modified files:**

- `src/app/pfapi/api/pfapi.ts` - Use SecureStorage for provider credentials
- `src/app/imex/sync/sync-config.service.ts` - Route credential saves through SecureStorage

**Storage keys:**

- `SECURE_CRED_SuperSync` - SuperSync tokens
- `SECURE_CRED_WebDAV` - WebDAV credentials
- `SECURE_CRED_Dropbox` - Dropbox tokens

---

## Error Handling

| Scenario                                      | Handling                              |
| --------------------------------------------- | ------------------------------------- |
| Decryption fails (different machine)          | Clear corrupted entry, prompt re-auth |
| Secure storage unavailable (Linux no keyring) | Fall back to plaintext with warning   |
| Migration fails mid-way                       | Idempotent - retry on next startup    |

```typescript
async get(key: string): Promise<string | null> {
  try {
    return await this._getInternal(key);
  } catch (error) {
    PFLog.err('Decryption failed', { key, error });
    await this.remove(key).catch(() => {});
    return null; // Triggers re-authentication
  }
}
```

---

## Files Summary

### New Files (11)

| Path                                                          | Purpose          |
| ------------------------------------------------------------- | ---------------- |
| `src/app/core/secure-storage/secure-storage.interface.ts`     | Interface        |
| `src/app/core/secure-storage/secure-storage.service.ts`       | Platform router  |
| `src/app/core/secure-storage/electron-secure-storage.ts`      | Electron impl    |
| `src/app/core/secure-storage/android-secure-storage.ts`       | Android impl     |
| `src/app/core/secure-storage/web-secure-storage.ts`           | Web impl         |
| `src/app/core/secure-storage/web-crypto-key-manager.ts`       | Web key mgmt     |
| `src/app/core/secure-storage/credential-migration.service.ts` | Migration        |
| `electron/secure-storage.ts`                                  | Main process     |
| `electron/ipc-handlers/secure-storage.ts`                     | IPC registration |
| `android/.../plugins/SecureStoragePlugin.kt`                  | Android plugin   |
| `src/app/core/secure-storage/index.ts`                        | Barrel export    |

### Modified Files (9)

| Path                                                | Changes             |
| --------------------------------------------------- | ------------------- |
| `electron/shared-with-frontend/ipc-events.const.ts` | Add 4 IPC events    |
| `electron/preload.ts`                               | Add 4 methods       |
| `electron/electronAPI.d.ts`                         | Type definitions    |
| `electron/ipc-handler.ts`                           | Register handlers   |
| `src/app/core/window-ea.d.ts`                       | Frontend types      |
| `src/app/core/startup/startup.service.ts`           | Trigger migration   |
| `src/app/sync/providers/private-cfg-store.ts`       | Add clear()         |
| `android/app/build.gradle`                          | Add security-crypto |
| `android/.../CapacitorMainActivity.kt`              | Register plugin     |

---

## Risks & Mitigations

| Risk                           | Mitigation                           |
| ------------------------------ | ------------------------------------ |
| Linux without Secret Service   | Fallback to plaintext + user warning |
| Migration corrupts credentials | Atomic operations, idempotent retry  |
| Web XSS can still access keys  | CSP hardening, defense-in-depth only |

---

## Testing Strategy

1. **Unit tests** for each platform implementation
2. **Migration tests** - fresh install, existing credentials, partial migration
3. **E2E tests** - sync after migration works correctly
4. **Manual testing** - each platform (Electron macOS/Windows/Linux, Android, Web)
