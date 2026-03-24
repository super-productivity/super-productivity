# Plan: Protect Integration Tokens on the Local Filesystem

**Issue:** [#5915](https://github.com/super-productivity/super-productivity/issues/5915)

## Problem

Integration tokens (GitHub, Jira, GitLab, WebDAV, etc.) are stored in plaintext in:
1. **IndexedDB** (`SUP_OPS` database) — in both `state_cache` and `ops` stores
2. **Backup files** — complete JSON exports include all credentials
3. **Plugin OAuth store** — separate IndexedDB (`sup-plugin-oauth`) also plaintext

Anyone with filesystem access can extract these tokens.

## Proposed Solution: Field-Level Encryption with Master Password

Encrypt sensitive fields **before** they enter the NgRx store, so they are encrypted at rest in IndexedDB, in operation logs, in backups, and during sync — while remaining decrypted only in memory for active use.

## Architecture Overview

```
User enters token → encrypt(token, masterPassword) → store encrypted value in NgRx
                                                       ↓
                                                    IndexedDB (encrypted)
                                                    Op-log sync (encrypted)
                                                    Backups (encrypted)

API call needs token → decrypt(encryptedToken, masterPassword) → use in HTTP header
                       ↑ (cached in memory for session)
```

## Implementation Steps

### Step 1: Define Sensitive Field Registry

**File:** `src/app/core/encryption/sensitive-fields.const.ts` (new)

Create a registry mapping entity types to their sensitive field paths. This is the single source of truth for what gets encrypted.

```typescript
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  // Issue providers
  'JIRA': ['password'],
  'GITLAB': ['token'],
  'CALDAV': ['password'],
  'OPEN_PROJECT': ['token'],
  'GITEA': ['token'],
  'REDMINE': ['token'],
  'TRELLO': ['accessToken'],
  'LINEAR': ['token'],
  'AZURE_DEVOPS': ['token'],
  'NEXTCLOUD_DECK': ['password'],
  // Global config - sync section
  'SYNC_WEBDAV': ['password'],
  'SYNC_SUPERSYNC': ['accessToken', 'encryptKey'],
  'SYNC_ENCRYPT': ['encryptKey'],
};
```

### Step 2: Create a Lightweight Secret Encryption Service

**File:** `src/app/core/encryption/secret-encryption.service.ts` (new)

Unlike the sync encryption (which uses expensive Argon2id for large data blobs), token encryption needs to be **fast** since it runs on every config read. Use a simpler but still secure approach:

- **Algorithm:** AES-GCM (reuse existing infrastructure)
- **Key derivation:** Argon2id derived **once** at unlock time, cached for the session
- **Storage:** The derived key lives only in memory (cleared on app close)
- **Format:** Same `[salt][iv][ciphertext]` format as existing encryption, but derive key only once

Key design decisions:
- Reuse `deriveKeyFromPassword()` and `encryptWithDerivedKey()` / `decryptWithDerivedKey()` from `src/app/op-log/encryption/encryption.ts`
- Cache the derived key in the service for the session lifetime
- Provide `encryptSecret(plaintext): string` and `decryptSecret(ciphertext): string` methods
- Provide `isUnlocked(): boolean` signal for UI gating

```typescript
@Injectable({ providedIn: 'root' })
export class SecretEncryptionService {
  private _derivedKey: DerivedKeyInfo | null = null;
  private _isUnlocked = signal(false);
  readonly isUnlocked = this._isUnlocked.asReadonly();

  async unlock(masterPassword: string): Promise<void> { /* derive + cache key */ }
  lock(): void { /* clear cached key */ }
  async encryptSecret(plaintext: string): Promise<string> { /* fast AES-GCM */ }
  async decryptSecret(ciphertext: string): Promise<string> { /* fast AES-GCM */ }
  isEncryptedValue(value: string): boolean { /* check if value looks like base64 ciphertext */ }
}
```

### Step 3: Master Password UI

**Files:**
- `src/app/core/encryption/master-password-dialog/` (new directory)
  - `master-password-dialog.component.ts` — standalone Angular component
  - `master-password-dialog.component.html`

Two modes:
1. **Setup mode:** First time — user sets a master password (with confirmation field)
2. **Unlock mode:** Subsequent launches — user enters existing master password to decrypt

Triggered:
- Automatically on app startup if encrypted secrets exist in state
- Manually via a "Set Master Password" button in settings

Validation:
- Store a **verification token** (a known string encrypted with the master password) in global config to verify the password is correct on unlock
- On wrong password, AES-GCM decryption will fail (authentication tag mismatch) → show error

### Step 4: Global Config Integration

**File:** `src/app/features/config/global-config.model.ts` (modify)

Add a new section to `GlobalConfigState`:

```typescript
export type SecretEncryptionConfig = Readonly<{
  isEnabled: boolean;
  verificationToken?: string | null; // encrypted known string for password verification
}>;
```

Add `secretEncryption: SecretEncryptionConfig` to `GlobalConfigState`.

**File:** `src/app/features/config/default-global-config.const.ts` (modify)

Add default:
```typescript
secretEncryption: {
  isEnabled: false,
  verificationToken: null,
}
```

### Step 5: Settings UI for Master Password

**File:** `src/app/features/config/config-section/` (modify existing)

Add a "Security" section to the settings page with:
- Toggle to enable/disable master password protection
- "Change Master Password" button (requires current password)
- Clear explanation of what this protects

When enabling:
1. Prompt for new master password (with confirmation)
2. Encrypt all existing plaintext tokens in-place
3. Store verification token
4. Set `isEnabled: true`

When disabling:
1. Prompt for current master password
2. Decrypt all tokens back to plaintext
3. Remove verification token
4. Set `isEnabled: false`

### Step 6: Encrypt/Decrypt Tokens at Config Boundaries

This is the core integration point. Two approaches considered:

**Chosen approach: Encrypt on save, decrypt on use**

Modify the issue provider service and config service to encrypt/decrypt at the boundary:

#### 6a. Issue Provider Forms (encrypt on save)

**Files:** Each provider's form component (e.g., `jira-cfg/jira-cfg.component.ts`, `gitlab-cfg/gitlab-cfg.component.ts`, etc.)

When saving provider config:
- Before dispatching the NgRx action, encrypt sensitive fields using `SecretEncryptionService`
- The encrypted value is what gets stored in NgRx → IndexedDB → sync

#### 6b. Issue Provider API Services (decrypt on use)

**Files:** Each provider's API service (e.g., `jira-api.service.ts`, `gitlab-api.service.ts`, etc.)

When making API calls:
- Decrypt the token from config before injecting into HTTP headers
- Use the cached derived key (fast, no Argon2 re-derivation)

#### 6c. Plugin OAuth Token Store (encrypt at rest)

**File:** `src/app/plugins/oauth/plugin-oauth-token-store.ts` (modify)

Wrap `saveOAuthTokens` / `loadOAuthTokens` to encrypt/decrypt when master password is enabled.

#### 6d. Sync Config (encrypt on save)

**File:** Sync config form handling

Encrypt WebDAV password, SuperSync accessToken, and encryptKey fields before saving to global config.

### Step 7: Startup Flow

**File:** `src/app/app.component.ts` or a new `master-password-guard.service.ts`

On app startup:
1. Check if `globalConfig.secretEncryption.isEnabled === true`
2. If yes, show the master password dialog (blocking)
3. On successful unlock, the `SecretEncryptionService` caches the derived key
4. App proceeds normally — all token decryptions use the cached key
5. If user cancels, app works but integrations are non-functional (tokens remain encrypted)

### Step 8: Migration Handling

**File:** `src/app/core/encryption/secret-migration.service.ts` (new)

When master password is first enabled:
- Walk all issue providers in the store
- For each sensitive field that has a non-empty plaintext value, encrypt it
- Dispatch update actions for each modified provider
- Walk global config sync section, encrypt sensitive fields
- Walk plugin OAuth store, encrypt tokens

When master password is disabled:
- Reverse: decrypt all fields and save plaintext

### Step 9: Backup Compatibility

No changes needed to the backup service itself — backups will naturally contain encrypted tokens since the tokens are encrypted in the store. When restoring a backup:
- If backup has encrypted tokens and master password is set → works seamlessly
- If backup has encrypted tokens but no master password → user must enter the original master password
- If backup has plaintext tokens and master password is now set → re-encrypt on import

## Files to Create

| File | Purpose |
|------|---------|
| `src/app/core/encryption/sensitive-fields.const.ts` | Registry of sensitive field names per provider |
| `src/app/core/encryption/secret-encryption.service.ts` | Core encrypt/decrypt service with key caching |
| `src/app/core/encryption/secret-migration.service.ts` | Handles bulk encrypt/decrypt when enabling/disabling |
| `src/app/core/encryption/master-password-dialog/master-password-dialog.component.ts` | Dialog component |
| `src/app/core/encryption/master-password-dialog/master-password-dialog.component.html` | Dialog template |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/features/config/global-config.model.ts` | Add `SecretEncryptionConfig` type and field |
| `src/app/features/config/default-global-config.const.ts` | Add defaults |
| `src/app/features/config/global-config-form-config.const.ts` | Add Security section to settings |
| `src/app/features/issue/providers/*/\*-cfg.component.ts` | Encrypt on save |
| `src/app/features/issue/providers/*/\*-api.service.ts` | Decrypt on use |
| `src/app/plugins/oauth/plugin-oauth-token-store.ts` | Wrap with encryption |
| `src/app/app.component.ts` (or equivalent) | Master password prompt on startup |
| `src/app/imex/file-imex/privacy-export.ts` | No change needed (already masks tokens) |

## Security Considerations

1. **Master password is never stored** — only the derived key lives in memory
2. **Verification token** prevents silent data corruption from wrong password
3. **AES-GCM authentication** detects tampering or wrong password (tag mismatch)
4. **No downgrade attack** — once enabled, tokens are only stored encrypted; disabling requires the password
5. **Sync safety** — encrypted tokens sync normally (they're just strings); each device needs the master password to use them
6. **Argon2id** makes brute-force attacks on the master password expensive (64MB memory, 3 iterations)

## Scope Boundaries (What This Does NOT Do)

- Does **not** encrypt all app data (task names, notes, etc.) — only tokens and credentials
- Does **not** protect against memory dumps while the app is running (derived key is in memory)
- Does **not** replace E2E sync encryption (that's a separate feature for sync-in-transit data)
- Does **not** require master password re-entry during the session (unlock once per launch)

## Testing Strategy

1. **Unit tests** for `SecretEncryptionService` — encrypt/decrypt round-trip, wrong password detection
2. **Unit tests** for migration service — bulk encrypt/decrypt of provider configs
3. **Integration tests** — enable master password, verify tokens are encrypted in store, verify API calls still work
4. **E2E tests** — full flow: set master password → add integration → restart → unlock → verify integration works
