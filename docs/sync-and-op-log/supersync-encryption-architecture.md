# SuperSync End-to-End Encryption Architecture

## Overview

SuperSync uses **AES-256-GCM** encryption with **Argon2id** key derivation for end-to-end encryption (E2EE). The server never sees plaintext data - all encryption/decryption happens client-side.

## Encryption Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT A (Upload)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User Action                                                             │
│     ┌──────────────┐                                                        │
│     │ Add Task     │                                                        │
│     │ "Buy milk"   │                                                        │
│     └──────┬───────┘                                                        │
│            │                                                                │
│            ▼                                                                │
│  2. NgRx Action Dispatched                                                  │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ { type: '[Task] Add Task',                                   │        │
│     │   task: { id: 'abc123', title: 'Buy milk', ... },            │        │
│     │   meta: { isPersistent: true, entityType: 'task', ... } }    │        │
│     └──────────────────────────┬───────────────────────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│  3. Operation Capture (operation-capture.meta-reducer.ts)                   │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ MultiEntityPayload {                                         │        │
│     │   actionPayload: { task: {...}, isAddToBottom: false, ... }, │        │
│     │   entityChanges: [{ entityType: 'task', entityId: 'abc123',  │        │
│     │                     changeType: 'create' }]                  │        │
│     │ }                                                            │        │
│     └──────────────────────────┬───────────────────────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│  4. Encryption (operation-encryption.service.ts)                            │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │                                                             │         │
│     │  User Password: "mySecretPass123"                           │         │
│     │         │                                                   │         │
│     │         ▼                                                   │         │
│     │  ┌─────────────────┐                                        │         │
│     │  │   Argon2id      │  Key Derivation                        │         │
│     │  │   + Salt        │  (CPU/memory-hard)                     │         │
│     │  └────────┬────────┘                                        │         │
│     │           │                                                 │         │
│     │           ▼                                                 │         │
│     │  256-bit Encryption Key                                     │         │
│     │           │                                                 │         │
│     │           ▼                                                 │         │
│     │  ┌─────────────────┐                                        │         │
│     │  │   AES-256-GCM   │  Authenticated Encryption              │         │
│     │  │   + Random IV   │  (confidentiality + integrity)         │         │
│     │  └────────┬────────┘                                        │         │
│     │           │                                                 │         │
│     │           ▼                                                 │         │
│     │  Encrypted Payload (base64 string)                          │         │
│     │  "U2FsdGVkX1+abc123..."                                     │         │
│     │                                                             │         │
│     └─────────────────────────┬───────────────────────────────────┘         │
│                               │                                             │
│                               ▼                                             │
│  5. SyncOperation Ready for Upload                                          │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ { id: 'op-xyz', clientId: 'client-A',                        │        │
│     │   actionType: '[Task] Add Task',                             │        │
│     │   payload: "U2FsdGVkX1+abc123...",  ← Encrypted!             │        │
│     │   isPayloadEncrypted: true,          ← Flag set              │        │
│     │   vectorClock: { 'client-A': 5 }, ... }                      │        │
│     └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPERSYNC SERVER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Server stores encrypted payload AS-IS                                      │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  operations table:                                               │       │
│  │  ┌─────────┬────────────────────────────┬───────────────────┐    │       │
│  │  │ seq     │ payload                    │ is_encrypted      │    │       │
│  │  ├─────────┼────────────────────────────┼───────────────────┤    │       │
│  │  │ 42      │ "U2FsdGVkX1+abc123..."     │ true              │    │       │
│  │  └─────────┴────────────────────────────┴───────────────────┘    │       │
│  │                                                                  │       │
│  │  ⚠️  Server CANNOT read payload contents                         │       │
│  │  ⚠️  Server has NO access to encryption key                      │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT B (Download)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Download Operations (operation-log-download.service.ts)                 │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ Received: { payload: "U2FsdGVkX1+abc123...",                 │        │
│     │            isPayloadEncrypted: true, ... }                   │        │
│     └──────────────────────────┬───────────────────────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│  2. Decryption (operation-encryption.service.ts)                            │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │                                                             │         │
│     │  User Password: "mySecretPass123"  (same as Client A)       │         │
│     │         │                                                   │         │
│     │         ▼                                                   │         │
│     │  ┌─────────────────┐                                        │         │
│     │  │   Argon2id      │  Same key derivation                   │         │
│     │  │   + Salt        │  → Same 256-bit key                    │         │
│     │  └────────┬────────┘                                        │         │
│     │           │                                                 │         │
│     │           ▼                                                 │         │
│     │  ┌─────────────────┐                                        │         │
│     │  │   AES-256-GCM   │  Decrypt + verify integrity            │         │
│     │  │   Decrypt       │                                        │         │
│     │  └────────┬────────┘                                        │         │
│     │           │                                                 │         │
│     │           ▼                                                 │         │
│     │  Original Payload (JSON)                                    │         │
│     │  { actionPayload: { task: {...} }, entityChanges: [...] }   │         │
│     │                                                             │         │
│     └─────────────────────────┬───────────────────────────────────┘         │
│                               │                                             │
│                               ▼                                             │
│  3. Convert to Action (operation-converter.util.ts)                         │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ extractActionPayload() → { task: {...}, isAddToBottom, ... } │        │
│     └──────────────────────────┬───────────────────────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│  4. Dispatch Action (operation-applier.service.ts)                          │
│     ┌──────────────────────────────────────────────────────────────┐        │
│     │ { type: '[Task] Add Task',                                   │        │
│     │   task: { id: 'abc123', title: 'Buy milk', ... },            │        │
│     │   meta: { isPersistent: true, isRemote: true, ... } }        │        │
│     └──────────────────────────┬───────────────────────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│  5. State Updated                                                           │
│     ┌──────────────┐                                                        │
│     │ Task appears │                                                        │
│     │ "Buy milk"   │                                                        │
│     └──────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. OperationEncryptionService

**Location**: `src/app/op-log/sync/operation-encryption.service.ts`

```typescript
// Encrypt before upload
async encryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
  const payloadStr = JSON.stringify(op.payload);
  const encryptedPayload = await encrypt(payloadStr, encryptKey);
  return { ...op, payload: encryptedPayload, isPayloadEncrypted: true };
}

// Decrypt after download
async decryptOperation(op: SyncOperation, encryptKey: string): Promise<SyncOperation> {
  if (!op.isPayloadEncrypted) return op;
  const decryptedStr = await decrypt(op.payload, encryptKey);
  return { ...op, payload: JSON.parse(decryptedStr), isPayloadEncrypted: false };
}
```

### 2. Encryption Algorithm

**Location**: `src/app/pfapi/api/encryption/encryption.ts`

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: Argon2id (memory-hard, resistant to GPU attacks)
- **Salt**: Random 16 bytes per encryption
- **IV**: Random 12 bytes per encryption
- **Output Format**: `salt || iv || ciphertext || authTag` (base64 encoded)

### 3. Upload Integration

**Location**: `src/app/op-log/sync/operation-log-upload.service.ts`

```typescript
// Check if encryption is enabled
const privateCfg = await syncProvider.privateCfg.load();
const isEncryptionEnabled = privateCfg?.isEncryptionEnabled && !!privateCfg?.encryptKey;

// Encrypt if enabled
if (isEncryptionEnabled && encryptKey) {
  syncOps = await this.encryptionService.encryptOperations(syncOps, encryptKey);
}
```

### 4. Download Integration

**Location**: `src/app/op-log/sync/operation-log-download.service.ts`

```typescript
// Decrypt if encrypted
const hasEncryptedOps = ops.some((op) => op.isPayloadEncrypted);
if (hasEncryptedOps && encryptKey) {
  ops = await this.encryptionService.decryptOperations(ops, encryptKey);
}
```

## Configuration Storage

The encryption password is stored in the **private config** (not synced):

```
privateCfg: {
  isEncryptionEnabled: true,
  encryptKey: "user's password"  // Stored locally, never sent to server
}
```

## Security Properties

| Property            | Guarantee                                       |
| ------------------- | ----------------------------------------------- |
| **Confidentiality** | Server cannot read operation payloads           |
| **Integrity**       | GCM auth tag detects tampering of the _payload_ |
| **Key Security**    | Argon2id makes brute-force expensive            |
| **Forward Secrecy** | Each operation uses random IV                   |
| **Wrong Password**  | Decryption fails, operation rejected            |

> **Integrity scope (important).** Only `op.payload` is encrypted and covered by
> the AES-GCM authentication tag. Every other operation field — `actionType`,
> `opType`, `entityType`, `entityId`, `entityIds`, `vectorClock`, `timestamp`,
> `schemaVersion`, `syncImportReason`, **and the `isPayloadEncrypted` flag
> itself** — travels as **plaintext** and is **not** bound as Additional
> Authenticated Data (AAD), so a malicious/compromised sync server or a TLS MITM
> can tamper with it. As **defense-in-depth**, the client fails closed on three
> tamper vectors:
>
> - **Plaintext-injection downgrade:** a forged op with `isPayloadEncrypted=false`
>   would skip decryption _and_ the payload check and be applied as-is — arbitrary
>   op forgery on an encryption-mandatory client. `assertOpsEncryptedWhenExpected`
>   rejects any inbound plaintext op (download + piggyback) when encryption is
>   **enabled in config** (`isEncryptionMandatory && isEncryptionEnabled()` —
>   config intent, not key presence, so it also fails closed in the
>   dropped-credential state). Safe because enabling encryption deletes +
>   re-uploads all data encrypted, so no legitimate plaintext op remains — this
>   rests on the server contract that `deleteAllData()` removes every downloadable
>   plaintext op. This is the SuperSync op-level twin of the file-based GHSA-vrc7
>   download guard and the GHSA-9544 _upload_ guard.
> - **LWW `entityId` retarget:** the client rejects an _encrypted_ LWW-update op
>   whose authenticated `payload.id` does not equal `op.entityId`
>   (`verify-decrypted-op-integrity.ts`).
> - **Full-state `opType` promotion:** after decrypting an operation tagged as
>   `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR`, the client structurally validates
>   the authenticated payload as complete application data before the metadata can
>   promote it to `loadAllData`. Both direct and `appDataComplete`-wrapped payloads
>   are supported. Supported legacy payloads are migrated on a validation copy;
>   known compatible omissions (pre-section backups and the device-local sync
>   interval stripped from wire snapshots) are restored only on that copy. The
>   original remains unchanged for the existing operation-processing pipeline
>   (`assertDecryptedFullStateOpIntegrity`).
>
> This is **not** full integrity. Still open pending the durable fix:
>
> - Within-LWW `entityType`/`actionType` swap (ids left equal, so it passes).
> - `vectorClock`/`timestamp` reorder/replay.
> - The restore-to-point path (`getStateAtSeq` → `importCompleteBackup`) applies
>   server-reconstructed state without this guard; it is server-authored by
>   nature and the server blocks it for encrypted accounts, but E2EE cannot
>   authenticate it.
>
> Known limitation: a peer running an app version that predates the GHSA-9544
> _upload_ guard can still push plaintext ops; a keyed client then fails closed
> here with the tamper message. Recovery is to update the old peer.
>
> Full protection — binding the metadata (and the encryption flag) as GCM AAD
> behind an envelope-version migration, with a monotonic "encryption floor" to
> block downgrades — is tracked in **GHSA-8pxh-mgc7-gp3g**. Do not treat
> plaintext metadata as trusted at client decision points.

## Initial Setup — Password Dialog Selection

During initial SuperSync setup, the app determines which encryption dialog to show by **probing the server** before opening any dialog:

```
DialogSyncInitialCfgComponent.save()
    │
    ▼
Save config + auth
    │
    ▼
Probe server: downloadOps(0, undefined, 1)
    │
    ├─── Server has encrypted ops ──► DialogEnterEncryptionPasswordComponent
    │    (isPayloadEncrypted=true)      (enter existing password)
    │
    ├─── Server empty or ───────────► DialogEnableEncryptionComponent
    │    unencrypted ops                (create new password)
    │
    └─── Probe fails ───────────────► DialogEnableEncryptionComponent
         (network/auth error)           (fallback; sync error handling
                                         catches mismatches later)
```

This prevents a confusing double-prompt when a second client joins: without the probe, the app would always show "create password", then immediately fail during sync and show "enter password".

**Safety nets:** If the probe gives wrong results (e.g. race condition), the existing `_handleMissingPasswordDialog()` and `_promptSuperSyncEncryptionIfNeeded()` in `sync-wrapper.service.ts` will catch mismatches during the subsequent sync.

## Wrong Password Handling

```
Client C (wrong password) tries to sync:
    │
    ▼
Download encrypted ops
    │
    ▼
Attempt decryption with wrong key
    │
    ▼
┌─────────────────────────────┐
│  DecryptError thrown        │
│  "Failed to decrypt payload"│
└─────────────────────────────┘
    │
    ▼
Operation NOT applied to state
Sync error shown in UI
```

## Snapshot Encryption

Full-state operations (backup import, repair) use the snapshot endpoint but follow the same encryption:

```typescript
// In operation-log-upload.service.ts
if (encryptKey) {
  state = await this.encryptionService.encryptPayload(state, encryptKey);
}
await syncProvider.uploadSnapshot(
  state,
  clientId,
  reason,
  vectorClock,
  schemaVersion,
  isPayloadEncrypted,
);
```
