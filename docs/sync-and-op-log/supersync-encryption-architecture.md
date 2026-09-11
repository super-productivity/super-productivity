# SuperSync End-to-End Encryption Architecture

## Overview

SuperSync uses **AES-256-GCM** encryption with **Argon2id** key derivation for
end-to-end encryption (E2EE). Operation payload encryption/decryption happens
client-side. The server still sees the plaintext operation envelope metadata
described under [Security Properties](#security-properties).

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

[`OperationEncryptionService`](../../src/app/op-log/sync/operation-encryption.service.ts)
owns operation and snapshot payload encryption. Its current contract is more
than an encrypt/decrypt round trip:

- Upload encrypts the JSON payload and marks the resulting operation encrypted.
- Download authenticates and decrypts the ciphertext, parses the payload, and
  then checks the unauthenticated envelope against authenticated payload data
  before returning an operation for application.
- LWW target/footprint mismatches and a plaintext `opType` that promotes a
  non-full-state payload to a full-state operation fail closed. The executable
  checks live in
  [`verify-decrypted-op-integrity.ts`](../../src/app/op-log/sync/verify-decrypted-op-integrity.ts);
  its specs define the accepted legacy and full-state shapes.

### 2. Encryption Algorithm

**Location**: `packages/sync-core/src/encryption.ts` and its
`packages/sync-core/src/encryption/` collaborators.

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: Argon2id (memory-hard, resistant to GPU attacks)
- **Salt**: Random 16 bytes when a password's session encrypt key is derived;
  reused with that cached key for the process session
- **IV**: Fresh random 12 bytes per encrypted payload
- **Output Format**: `salt || iv || (AES-GCM ciphertext + authTag)` (base64
  encoded)

The session-stable salt amortizes the expensive Argon2id derivation across
operations. AES-GCM safety under that fixed derived key depends on the fresh IV
remaining unique for every encrypted payload.

### 3. Upload Integration

[`OperationLogUploadService`](../../src/app/op-log/sync/operation-log-upload.service.ts)
gets the key through the provider contract and encrypts operation and snapshot
payloads before transport. The upload boundary is fail-closed:

- A provider that mandates E2EE (SuperSync) cannot upload pending operations or
  snapshots without a usable key. Pending work remains unsynced for a later
  encrypted retry, and the result reports that encryption setup is incomplete.
- A file provider whose configuration says encryption is enabled but whose key
  is missing throws before upload instead of falling back to plaintext.
- The file-format encryption chokepoint independently enforces the same
  no-key/no-upload rule in
  [`encrypt-and-compress-handler.service.ts`](../../src/app/op-log/encryption/encrypt-and-compress-handler.service.ts).

Regression coverage lives in
[`operation-log-upload.service.spec.ts`](../../src/app/op-log/sync/operation-log-upload.service.spec.ts)
and
[`encrypt-and-compress-handler.service.spec.ts`](../../src/app/op-log/encryption/encrypt-and-compress-handler.service.spec.ts).

### 4. Download Integration

[`OperationLogDownloadService`](../../src/app/op-log/sync/operation-log-download.service.ts)
screens downloaded operations before application; the upload service applies
the same inbound checks to piggybacked operations:

- If SuperSync configuration expects encryption, any plaintext inbound
  operation rejects its batch. This prevents a forged
  `isPayloadEncrypted=false` flag from bypassing decryption and all
  post-decrypt checks; the focused owner is
  [`assert-ops-encryption-expected.ts`](../../src/app/op-log/sync/assert-ops-encryption-expected.ts).
- Encrypted input without a key raises the password-recovery error; it is never
  treated as plaintext.
- Successful AES-GCM authentication is followed by payload parsing and the
  metadata/full-state checks described above. Decrypted operations are not
  released to the apply pipeline first.

## Configuration Storage

The encryption password/key is stored only in provider **private config**; it is
not part of synced application state and is never sent to the server. Encryption
intent is also stored in private config, but is mirrored to
`globalConfig.sync.isEncryptionEnabled` so the sync pipeline can fail closed.
That intent bit may travel inside an operation or snapshot payload, but remote
values are non-authoritative: hydration reapplies the device's local value. The
credential store and provider expose intent separately from key presence so a
dropped key cannot silently turn an encrypted configuration into a plaintext
one. Follow
[`credential-store.service.ts`](../../src/app/op-log/sync-providers/credential-store.service.ts),
[`provider-types.ts`](../../packages/sync-providers/src/provider-types.ts), and
the concrete
[`SuperSyncProvider`](../../packages/sync-providers/src/super-sync/super-sync.ts)
instead of copying the private-config shape into new code.

## Security Properties

| Property              | Guarantee                                                          |
| --------------------- | ------------------------------------------------------------------ |
| **Confidentiality**   | Server cannot read operation payloads                              |
| **Payload integrity** | GCM auth tag detects tampering of the encrypted payload            |
| **Key security**      | Argon2id makes password brute-force attempts expensive             |
| **Nonce uniqueness**  | Each encrypted payload uses a fresh random IV under the cached key |
| **Forward secrecy**   | Not provided; IV uniqueness is not forward secrecy                 |
| **Wrong password**    | Decryption fails and the operation is rejected                     |

> **Integrity scope (important).** Only `op.payload` is encrypted and covered by
> the AES-GCM authentication tag. Every other operation field — `actionType`,
> `opType`, `entityType`, `entityId`, `entityIds`, `vectorClock`, `timestamp`,
> `schemaVersion`, `syncImportReason`, **and the `isPayloadEncrypted` flag
> itself** — travels as **plaintext** and is **not** bound as Additional
> Authenticated Data (AAD), so a malicious/compromised sync server or a TLS MITM
> can tamper with it. As **defense-in-depth**, the client fails closed on four
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
> - **LWW `entityId` retarget:** for adapter-backed LWW updates, where
>   `payload.id` selects the entity the reducer applies, the client rejects an
>   _encrypted_ op whose authenticated `payload.id` does not equal
>   `op.entityId` (`verify-decrypted-op-integrity.ts`). Singleton LWW actions
>   target their registered feature state as a whole, so contextual conflict
>   IDs such as TIME_TRACKING's composite key have no canonical payload `id`.
> - **Project-move footprint injection:** when an encrypted TASK project-move
>   payload carries `projectMoveSubTaskIds`, the client requires exact-set
>   equality between plaintext `op.entityIds` and the authenticated set
>   `{op.entityId} ∪ projectMoveSubTaskIds`. This prevents a compromised server
>   from appending victim task IDs to an otherwise valid move. Synthetic LWW
>   operations without an authenticated footprint cannot be checked by this
>   interim guard; binding the full envelope as GCM AAD remains the durable fix.
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
> here with the tamper message. Keep older peers offline and update them before
> they sync again. If an updated client has a verified complete copy, export a
> backup and use its explicit **Force Overwrite** action to replace the mixed
> history with an encrypted clean-slate full state. Never run that action from a
> fresh or incomplete client. If no verified complete client remains, preserve
> the database and clients for incident recovery; do not skip the row or advance
> a cursor past it. See
> [`backup-and-recovery.md`](../../packages/super-sync-server/docs/backup-and-recovery.md#recovering-a-mixed-encryptedplaintext-history).
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

Full-state operations (backup import and repair) use the snapshot endpoint but
retain the same fail-closed boundary. The upload service validates the
full-state structure before transport, encrypts the payload when a key is
present, and cannot reach the snapshot upload branch for a
mandatory-encryption provider with pending work but no key. On download, an
encrypted full-state operation is accepted only after AES-GCM authentication
and `assertDecryptedFullStateOpIntegrity()` validates it as complete
application data (including supported legacy migration on a validation copy).

Executable owners:

- Upload routing and mandatory-key guard:
  [`operation-log-upload.service.ts`](../../src/app/op-log/sync/operation-log-upload.service.ts)
- Payload crypto and post-decrypt dispatch boundary:
  [`operation-encryption.service.ts`](../../src/app/op-log/sync/operation-encryption.service.ts)
- Full-state integrity validation:
  [`verify-decrypted-op-integrity.ts`](../../src/app/op-log/sync/verify-decrypted-op-integrity.ts)
- Full-state regression coverage:
  [`verify-decrypted-op-integrity.spec.ts`](../../src/app/op-log/sync/verify-decrypted-op-integrity.spec.ts)
