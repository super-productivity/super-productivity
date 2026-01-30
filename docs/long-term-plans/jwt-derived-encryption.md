# JWT-Derived Encryption for SuperSync

## Goal

Provide automatic "encryption at rest" for lazy users who don't want to enter a passphrase. This protects against database leaks while maintaining zero UX friction.

**Security Model:**
| Threat | Protected? |
|--------|------------|
| Database dump/leak | ✅ Yes |
| Backup file theft | ✅ Yes |
| Server operator | ❌ No (can decrypt with JWT_SECRET) |

---

## Critical Issue: JWT Instability

**All 5 reviewers identified this as a blocker.**

The plan proposes `SHA-256(jwt)` as the encryption key. However:

1. JWTs can be refreshed (new signature = new key)
2. Re-login produces a different JWT
3. Token expiration invalidates the key

**Result:** User's encrypted data becomes permanently unreadable after token refresh.

### Solution: Store Derived Key on First Enable

Instead of deriving the key every time from the current JWT:

```typescript
// On first enable of auto-encryption:
const derivedKey = await crypto.subtle.digest('SHA-256', encoder.encode(jwt));
const keyAsBase64 = btoa(String.fromCharCode(...new Uint8Array(derivedKey)));

// Store this derived key, NOT the JWT
await provider.setConfig({
  isAutoEncryptionEnabled: true,
  autoEncryptionKey: keyAsBase64, // Stable across token refreshes
});

// On subsequent operations, use the stored key
```

This ensures:

- Key stability across token refreshes
- Multi-device works (all devices get same derived key from initial JWT)
- No data loss on re-login

---

## Implementation Plan

### Phase 1: Model & Config (1 day)

**Files:**

- `src/app/op-log/sync-providers/super-sync/super-sync.model.ts`
- `src/app/features/config/global-config.model.ts`

**Changes:**

```typescript
// super-sync.model.ts
export interface SuperSyncPrivateCfg extends SyncProviderPrivateCfgBase {
  // ... existing fields ...

  /** Auto-encryption enabled (JWT-derived, not passphrase) */
  isAutoEncryptionEnabled?: boolean;

  /** Stored derived key (base64). Set once on first enable, stable across sessions */
  autoEncryptionKey?: string;
}
```

### Phase 2: Encryption Function (0.5 day)

**File:** `src/app/op-log/encryption/encryption.ts`

**Add:**

```typescript
/**
 * Fast key derivation for high-entropy inputs (JWT-derived keys).
 * Skips Argon2id since JWT already has 256+ bits of entropy.
 */
export const deriveKeyFromHighEntropy = async (
  keyMaterial: string,
): Promise<DerivedKeyInfo> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(keyMaterial);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Use a fixed salt since key material is already high-entropy
  const salt = new Uint8Array(SALT_LENGTH).fill(0);

  const key = await crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  );

  return { key, salt };
};
```

**Integration with existing functions:**

- Existing `encrypt(data, password)` and `decrypt(data, password)` use Argon2id
- Add new `encryptWithDerivedKey(data, derivedKeyInfo)` for pre-derived keys
- `operation-encryption.service.ts` needs a new code path for auto-encryption

### Phase 3: SuperSync Provider (1 day)

**File:** `src/app/op-log/sync-providers/super-sync/super-sync.ts`

**Modify `getEncryptKey()`:**

```typescript
async getEncryptKey(): Promise<string | undefined> {
  const cfg = await this.privateCfg.load();
  if (!cfg) return undefined;

  // Existing passphrase encryption takes priority
  if (cfg.isEncryptionEnabled && cfg.encryptKey) {
    return cfg.encryptKey;
  }

  // Auto-encryption uses stored derived key
  if (cfg.isAutoEncryptionEnabled && cfg.autoEncryptionKey) {
    return cfg.autoEncryptionKey;
  }

  return undefined;
}
```

### Phase 4: Enable/Disable Services (1 day)

**New file:** `src/app/imex/sync/auto-encryption-enable.service.ts`

**Flow:**

1. Derive key from current JWT: `SHA-256(accessToken)`
2. Store derived key in config as `autoEncryptionKey`
3. Set `isAutoEncryptionEnabled: true`
4. Delete all server data (can't mix encrypted/unencrypted)
5. Upload current state with encryption

**Reuse existing patterns from:**

- `encryption-enable.service.ts` (lines 16-80)
- `encryption-disable.service.ts`

### Phase 5: UI Integration (1 day)

**File:** `src/app/features/config/form-cfgs/sync-form.const.ts`

**Add toggle in SuperSync Advanced settings:**

```typescript
{
  key: 'isAutoEncryptionEnabled',
  type: 'checkbox',
  hideExpression: (model: any) => model.isEncryptionEnabled, // Hide if passphrase enabled
  templateOptions: {
    label: T.F.SYNC.FORM.SUPER_SYNC.L_AUTO_ENCRYPTION,
    description: T.F.SYNC.FORM.SUPER_SYNC.AUTO_ENCRYPTION_DESCRIPTION,
  },
  // ... hooks for enable/disable flow
}
```

**Translation keys needed:**

```json
{
  "L_AUTO_ENCRYPTION": "Encrypt my data automatically",
  "AUTO_ENCRYPTION_DESCRIPTION": "Encrypts data on the server. Protects against database leaks, but server operator can decrypt if needed.",
  "AUTO_ENCRYPTION_WARNING": "This will delete sync data and re-upload with encryption."
}
```

---

## Files to Modify

| File                                                           | Changes                                            |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `src/app/op-log/sync-providers/super-sync/super-sync.model.ts` | Add `isAutoEncryptionEnabled`, `autoEncryptionKey` |
| `src/app/op-log/encryption/encryption.ts`                      | Add `deriveKeyFromHighEntropy()`                   |
| `src/app/op-log/sync-providers/super-sync/super-sync.ts`       | Modify `getEncryptKey()`                           |
| `src/app/op-log/sync/operation-encryption.service.ts`          | Support pre-derived keys                           |
| `src/app/features/config/form-cfgs/sync-form.const.ts`         | Add UI toggle                                      |
| `src/app/features/config/global-config.model.ts`               | Add `isAutoEncryptionEnabled` to `SuperSyncConfig` |
| `src/app/imex/sync/auto-encryption-enable.service.ts`          | NEW: Enable flow                                   |
| `src/app/imex/sync/auto-encryption-disable.service.ts`         | NEW: Disable flow                                  |
| `src/assets/i18n/en.json`                                      | Add translation keys                               |
| `src/app/t.const.ts`                                           | Add translation constants                          |

---

## Edge Cases & Error Handling

### 1. Decryption Failure (e.g., key mismatch)

**Current behavior:** Shows password dialog (wrong for auto-encryption)

**Required change:** Detect auto-encryption mode and show appropriate error:

```
"Unable to decrypt sync data. Your encryption key may be invalid.
Options:
[Re-enable Auto Encryption] - Upload local data with new key
[Cancel]"
```

**File:** `src/app/imex/sync/dialog-handle-decrypt-error/dialog-handle-decrypt-error.component.ts`

### 2. Switching Between Encryption Modes

| From       | To         | Action                                     |
| ---------- | ---------- | ------------------------------------------ |
| None       | Auto       | Delete server data, upload encrypted       |
| Auto       | None       | Delete server data, upload unencrypted     |
| Auto       | Passphrase | Delete server data, upload with passphrase |
| Passphrase | Auto       | Delete server data, upload with auto key   |

All require clean slate (existing pattern in codebase).

### 3. Multi-Device First Sync

When a new device syncs for the first time with auto-encryption:

1. Download encrypted ops
2. Derive key from JWT: `SHA-256(accessToken)`
3. Attempt decryption
4. If success: store derived key locally
5. If failure: show error (different account?)

---

## Tests Required

### Unit Tests

**`encryption.ts`:**

```typescript
describe('deriveKeyFromHighEntropy', () => {
  it('should derive consistent key from same input');
  it('should derive different keys from different inputs');
  it('should be fast (<10ms)');
});
```

**`super-sync.ts`:**

```typescript
describe('getEncryptKey with auto-encryption', () => {
  it('should return autoEncryptionKey when isAutoEncryptionEnabled');
  it('should prefer passphrase over auto-encryption');
  it('should return undefined when neither enabled');
});
```

### Integration Tests

```typescript
describe('Auto-encryption flow', () => {
  it('should encrypt operations during upload');
  it('should decrypt operations during download');
  it('should work across token refreshes (key is stable)');
});
```

### E2E Tests

```typescript
describe('SuperSync auto-encryption', () => {
  it('should enable auto-encryption via settings');
  it('should sync encrypted data to server');
  it('should decrypt on second device with same account');
});
```

---

## Verification Checklist

1. [ ] Enable auto-encryption on device A
2. [ ] Create tasks, verify they sync
3. [ ] Check server DB - payloads are encrypted blobs
4. [ ] Refresh JWT token on device A
5. [ ] Verify sync still works (key is stable)
6. [ ] Login on device B with same account
7. [ ] Verify data syncs and decrypts correctly
8. [ ] Disable auto-encryption on device A
9. [ ] Verify server data is now unencrypted
10. [ ] Verify device B detects change and updates

---

## Security Considerations

### What This Protects Against

- Database dumps (encrypted blobs are useless without key)
- Backup file leaks
- SQL injection reading data

### What This Does NOT Protect Against

- Server operator with access to JWT_SECRET
- Man-in-the-middle if HTTPS is compromised
- Client-side token theft

### Why This Is Acceptable

- Target audience is "lazy users" who won't use a passphrase
- "Encryption at rest" is a real security improvement over no encryption
- Users who want true E2E can still use passphrase encryption
- Security model is honest and documented

---

## Future Exploration: Device-Bound Key

For users who want true E2E without a passphrase, explore:

1. **Random key stored in IndexedDB**
   - Risk: Lost on browser data wipe
   - Need: Export/import flow

2. **Electron keychain integration**
   - More persistent storage
   - Platform-specific implementation

3. **Passkey PRF extension**
   - True E2E with zero UX friction
   - Limited browser support (2025)

These are out of scope for initial implementation but worth exploring.
