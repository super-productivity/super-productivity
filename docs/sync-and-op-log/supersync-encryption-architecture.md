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

| Property            | Guarantee                             |
| ------------------- | ------------------------------------- |
| **Confidentiality** | Server cannot read operation payloads |
| **Integrity**       | GCM auth tag detects tampering        |
| **Key Security**    | Argon2id makes brute-force expensive  |
| **Forward Secrecy** | Each operation uses random IV         |
| **Wrong Password**  | Decryption fails, operation rejected  |

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
