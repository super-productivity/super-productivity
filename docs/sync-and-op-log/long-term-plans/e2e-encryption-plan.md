# E2E Encryption for SuperSync Server

> **Status:** ✅ **Implemented** (December 2025)
>
> This plan has been fully implemented. For the current implementation details, see:
>
> - [supersync-encryption-architecture.md](../supersync-encryption-architecture.md) - Implementation documentation with diagrams
> - `src/app/op-log/sync/operation-encryption.service.ts` - Core encryption service

## Summary

Add end-to-end encryption to SuperSync where the server cannot read operation payloads. Users provide a separate encryption password which is used to derive an encryption key client-side. This is the same approach used by legacy sync providers (Dropbox, WebDAV, Local File).

## Key Decisions

| Decision             | Choice                                                         |
| -------------------- | -------------------------------------------------------------- |
| Encryption scope     | Payload-only (metadata stays plaintext for conflict detection) |
| Key derivation       | User-provided encryption password → Argon2id → key             |
| Password change      | Not supported (would require re-encrypting all data)           |
| Server changes       | None required                                                  |
| Missing key handling | Fail gracefully with dialog to enter password                  |

---

## Architecture

### Encryption Flow

```
User Encryption Password → Argon2id (64MB, 3 iter) → AES-256 Key → encrypt/decrypt payloads
```

### Data Flow

```
Upload: Operation → encrypt payload with key → upload (metadata plaintext)
Download: Receive ops → decrypt payload with key → apply to state
```

### Why Payload-Only Encryption?

The server needs plaintext metadata for:

- **Conflict detection** - Uses vector clocks to detect concurrent edits
- **Deduplication** - Uses operation IDs to prevent duplicates
- **Ordering** - Uses timestamps and server sequence numbers
- **Tombstone tracking** - Uses entity IDs for delete tracking

The server does NOT need to read:

- **Payloads** - The actual data being created/updated/deleted

This design encrypts payloads while keeping metadata accessible, giving the server enough information to coordinate sync without seeing user data.

---

## Implementation Plan

### Phase 1: Data Model Changes

**File:** `src/app/pfapi/api/sync/sync-provider.interface.ts`

Add encryption flag to `SyncOperation`:

```typescript
export interface SyncOperation {
  // ... existing fields ...
  isPayloadEncrypted?: boolean; // NEW: true if payload is encrypted string
}
```

**File:** `src/app/pfapi/api/sync/providers/super-sync/super-sync.model.ts`

The `encryptKey` field already exists in `SyncProviderPrivateCfgBase`. Just need to add the enable flag:

```typescript
export interface SuperSyncPrivateCfg extends SyncProviderPrivateCfgBase {
  // ... existing fields ...
  isEncryptionEnabled?: boolean; // NEW
  // encryptKey?: string;         // Already inherited from base
}
```

---

### Phase 2: Client-Side Encryption Service

**New file:** `src/app/op-log/sync/operation-encryption.service.ts`

```typescript
import { inject, Injectable } from '@angular/core';
import { encrypt, decrypt } from '../../../../pfapi/api/encryption/encryption';

@Injectable({ providedIn: 'root' })
export class OperationEncryptionService {
  /**
   * Encrypts the payload of a SyncOperation.
   * Returns a new operation with encrypted payload and isPayloadEncrypted=true.
   */
  async encryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
    const payloadStr = JSON.stringify(op.payload);
    const encryptedPayload = await encrypt(payloadStr, encryptKey);
    return {
      ...op,
      payload: encryptedPayload,
      isPayloadEncrypted: true,
    };
  }

  /**
   * Decrypts the payload of a SyncOperation.
   * Returns a new operation with decrypted payload.
   * Throws DecryptError if decryption fails.
   */
  async decryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
    if (!op.isPayloadEncrypted) {
      return op; // Pass through unencrypted ops
    }
    const decryptedStr = await decrypt(op.payload as string, encryptKey);
    return {
      ...op,
      payload: JSON.parse(decryptedStr),
      isPayloadEncrypted: false,
    };
  }

  /**
   * Batch encrypt operations for upload.
   */
  async encryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    return Promise.all(ops.map((op) => this.encryptOperation(op, encryptKey)));
  }

  /**
   * Batch decrypt operations after download.
   * Non-encrypted ops pass through unchanged.
   */
  async decryptOperations(
    ops: SyncOperation[],
    encryptKey: string,
  ): Promise<SyncOperation[]> {
    return Promise.all(ops.map((op) => this.decryptOperation(op, encryptKey)));
  }
}
```

**Reuses:** Existing `src/app/pfapi/api/encryption/encryption.ts` (AES-GCM, Argon2id)

---

### Phase 3: Upload Integration

**File:** `src/app/op-log/sync/operation-log-upload.service.ts`

Modify `_uploadPendingOpsViaApi()`:

```typescript
// Add injection
private encryptionService = inject(OperationEncryptionService);

// In _uploadPendingOpsViaApi(), after converting to SyncOperation format:
const privateCfg = await syncProvider.privateCfg.load();
let opsToUpload = syncOps;

if (privateCfg?.isEncryptionEnabled && privateCfg?.encryptKey) {
  opsToUpload = await this.encryptionService.encryptOperations(syncOps, privateCfg.encryptKey);
}

// Upload opsToUpload instead of syncOps
const response = await syncProvider.uploadOps(opsToUpload, clientId, lastKnownServerSeq);

// Also encrypt piggybacked ops handling needs decryption:
if (response.newOps && response.newOps.length > 0) {
  let ops = response.newOps.map((serverOp) => serverOp.op);
  if (privateCfg?.encryptKey) {
    ops = await this.encryptionService.decryptOperations(ops, privateCfg.encryptKey);
  }
  const operations = ops.map((op) => syncOpToOperation(op));
  piggybackedOps.push(...operations);
}
```

---

### Phase 4: Download Integration

**File:** `src/app/op-log/sync/operation-log-download.service.ts`

Modify `_downloadRemoteOpsViaApi()`:

```typescript
// Add injection
private encryptionService = inject(OperationEncryptionService);
private matDialog = inject(MatDialog);

// After downloading ops, before converting to Operation format:
const privateCfg = await syncProvider.privateCfg.load();
let syncOps = response.ops
  .filter((serverOp) => !appliedOpIds.has(serverOp.op.id))
  .map((serverOp) => serverOp.op);

// Check if any ops are encrypted
const hasEncryptedOps = syncOps.some(op => op.isPayloadEncrypted);

if (hasEncryptedOps) {
  let encryptKey = privateCfg?.encryptKey;

  // If no key cached, prompt user
  if (!encryptKey) {
    encryptKey = await this._promptForEncryptionPassword();
    if (!encryptKey) {
      // User cancelled - abort sync
      return { newOps: [], success: false };
    }
  }

  try {
    syncOps = await this.encryptionService.decryptOperations(syncOps, encryptKey);
  } catch (e) {
    if (e instanceof DecryptError) {
      // Wrong password - prompt again
      await this._showDecryptionErrorDialog();
      return { newOps: [], success: false };
    }
    throw e;
  }
}

const operations = syncOps.map((op) => syncOpToOperation(op));
```

---

### Phase 5: UI Changes

**File:** `src/app/features/config/form-cfgs/sync-form.const.ts`

Add encryption fields to SuperSync provider form:

```typescript
// In SuperSync fieldGroup, add:
{
  key: 'isEncryptionEnabled',
  type: 'checkbox',
  props: {
    label: T.F.SYNC.FORM.SUPER_SYNC.L_ENABLE_E2E_ENCRYPTION,
  },
},
{
  hideExpression: (model: any) => !model.isEncryptionEnabled,
  key: 'encryptKey',
  type: 'input',
  props: {
    type: 'password',
    label: T.F.SYNC.FORM.L_ENCRYPTION_PASSWORD,
    required: true,
  },
},
{
  hideExpression: (model: any) => !model.isEncryptionEnabled,
  type: 'tpl',
  props: {
    tpl: `<div class="warn-text">{{ T.F.SYNC.FORM.SUPER_SYNC.ENCRYPTION_WARNING | translate }}</div>`,
  },
},
```

**Translations:** `src/assets/i18n/en.json`

```json
{
  "F": {
    "SYNC": {
      "FORM": {
        "SUPER_SYNC": {
          "L_ENABLE_E2E_ENCRYPTION": "Enable end-to-end encryption",
          "ENCRYPTION_WARNING": "Warning: If you forget your encryption password, your data cannot be recovered. This password is separate from your login password."
        }
      },
      "S": {
        "DECRYPTION_FAILED": "Failed to decrypt synced data. Please check your encryption password.",
        "ENCRYPTION_PASSWORD_REQUIRED": "Encryption password required to sync encrypted data."
      }
    }
  }
}
```

**New dialog component:** `src/app/imex/sync/dialog-encryption-password/`

Simple dialog to prompt for encryption password when needed:

- Input field for password
- Cancel and OK buttons
- Used when encrypted ops are received but no password is cached

---

## File Summary

### New Files

| File                                                  | Purpose                    |
| ----------------------------------------------------- | -------------------------- |
| `src/app/op-log/sync/operation-encryption.service.ts` | Encrypt/decrypt operations |
| `src/app/imex/sync/dialog-encryption-password/`       | Password prompt dialog     |

### Modified Files

| File                                                              | Changes                                   |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `src/app/pfapi/api/sync/sync-provider.interface.ts`               | Add `isPayloadEncrypted` to SyncOperation |
| `src/app/pfapi/api/sync/providers/super-sync/super-sync.model.ts` | Add `isEncryptionEnabled` flag            |
| `src/app/op-log/sync/operation-log-upload.service.ts`             | Encrypt before upload                     |
| `src/app/op-log/sync/operation-log-download.service.ts`           | Decrypt after download                    |
| `src/app/features/config/form-cfgs/sync-form.const.ts`            | Add encryption toggle + password field    |
| `src/app/t.const.ts`                                              | Add translation keys                      |
| `src/assets/i18n/en.json`                                         | Add translation strings                   |

### No Server Changes Required

The server treats encrypted payloads as opaque strings - no modifications needed.

---

## Security Considerations

### What's Protected

1. **Payload content** - All user data (tasks, projects, notes, etc.) is encrypted
2. **Zero-knowledge** - Server never sees encryption password or plaintext data
3. **Strong crypto** - AES-256-GCM with Argon2id key derivation

### What's Exposed (by design)

1. **Operation metadata** - IDs, timestamps, entity types, vector clocks
2. **Traffic patterns** - Server knows when you sync and how many operations
3. **Encryption status** - Server can see `isPayloadEncrypted: true`

### Cryptographic Details

| Component          | Algorithm   | Parameters                                    |
| ------------------ | ----------- | --------------------------------------------- |
| Key derivation     | Argon2id    | 64MB memory, 3 iterations                     |
| Payload encryption | AES-256-GCM | Random 12-byte IV, 16-byte salt per operation |

### Limitations

| Limitation           | Reason                                                    |
| -------------------- | --------------------------------------------------------- |
| No password change   | Would require re-encrypting all operations on all clients |
| No password recovery | True zero-knowledge means no recovery possible            |
| Two passwords        | Login password + encryption password (by design)          |

### Threat Model

| Threat               | Mitigated? | Notes                                               |
| -------------------- | ---------- | --------------------------------------------------- |
| Server reads data    | Yes        | Payloads encrypted client-side                      |
| Server breach        | Yes        | Attacker gets encrypted blobs, needs password       |
| MITM attack          | Yes        | HTTPS + authenticated encryption                    |
| Password brute force | Partially  | Argon2id makes attacks expensive (64MB per attempt) |
| Lost password        | No         | Data unrecoverable without password                 |

---

## Migration Path

### Enabling Encryption (Existing User)

1. User enables "E2E Encryption" in SuperSync settings
2. User enters encryption password
3. Warning shown about password recovery
4. Password saved to `SuperSyncPrivateCfg.encryptKey`
5. `isEncryptionEnabled` set to true
6. Future operations encrypted; existing operations remain plaintext
7. Other clients prompted for password when they encounter encrypted ops

### Multi-Client Scenario

When encryption is enabled on one client:

1. Other clients download operations normally
2. When they encounter `isPayloadEncrypted: true`, decryption is attempted
3. If no password cached, dialog prompts for password
4. Password cached in local `SuperSyncPrivateCfg` for future syncs

### Disabling Encryption

1. User unchecks encryption toggle
2. `isEncryptionEnabled` set to false
3. Future operations sent without encryption
4. Existing encrypted operations remain encrypted (still readable with password)

---

## Testing Strategy

1. **Unit tests** for `OperationEncryptionService`
   - Encrypt/decrypt round-trips with various payload types
   - Non-encrypted ops pass through unchanged
   - Wrong password throws DecryptError

2. **Integration tests** for upload/download
   - Encrypted operations sync correctly
   - Mixed encrypted/unencrypted history works
   - Piggybacked operations decrypt correctly

3. **E2E tests**
   - Two clients with same password sync correctly
   - Missing password shows dialog
   - Wrong password shows error and retries
