# Secure Secret Storage Plan

Status: planned

This plan replaces the older sync-credential-only secure storage sketch and
folds in the independent broader draft. The target is a secure storage
architecture for all app-managed secrets: sync credentials, sync encryption
passphrases, issue-provider tokens/passwords, plugin config secrets, plugin
OAuth tokens, and native background-sync credentials.

## Core Tradeoff

Moving secrets out of synced state is a deliberate UX tradeoff.

By default, secrets become device-local. A second client can sync non-sensitive
configuration metadata, but it cannot receive the raw token/password from sync.
The user will need to re-enter, reauthenticate, or unlock a separate portable
vault on each client.

This is a degradation compared with today's "everything arrives through sync"
experience for issue/provider credentials, but it is the safer default because
synced state, op-log operations, backups, and retained server history are not
appropriate places for raw secrets.

UX mitigation:

- Keep provider metadata synced so setup forms are prefilled except for the
  missing secret.
- Show clear per-device states: "credential saved on this device",
  "credential missing on this device", and "secure storage unavailable".
- Provide direct reauth/re-enter actions from each affected integration.
- Add a future opt-in portable encrypted vault for users who explicitly want
  selected integration secrets to move between devices.

## Can We Avoid This Tradeoff?

Not completely. Any design that avoids per-device re-entry must sync or transfer
the secret, a secret-encryption key, or enough material to recover one. That can
be a valid product choice, but it changes the trust model.

Viable alternatives:

- **Portable encrypted vault:** sync encrypted secret blobs and require the user
  to unlock them on each new device with a vault passphrase, recovery key, or
  enrolled device key. This gives good multi-device UX after one unlock per
  device, but adds password/recovery UX and exposes users with weak vault
  passphrases to offline brute-force risk.
- **Device-to-device vault transfer:** a trusted existing device encrypts the
  vault key for a new device, for example via QR code or pairing flow. This is a
  strong compromise when an old device is available, but it does not help fresh
  installs after all devices are gone.
- **Server-assisted or account-derived vault key:** derive or unwrap the vault
  key from SuperSync login/account material. This is the smoothest UX, but it
  either makes the server part of the secret recovery trust boundary or creates
  hard recovery problems when passwords are reset.
- **OS cloud keychain:** rely on iCloud Keychain, Google Password Manager, or a
  similar platform facility. This can be good UX within a platform ecosystem,
  but it is fragmented, hard to make uniform across Electron/Web/Android/iOS,
  and outside Super Productivity's sync semantics.

Recommended default:

- Use device-local storage for sync credentials and sync encryption
  passphrases.
- Make a portable encrypted vault an explicit opt-in for selected integration
  secrets.
- Consider device-to-device vault transfer as a later UX improvement.

## Post-V1 - Low-Friction Portable Vault Variant

For a cheaper, lower-maintenance improvement with no new password prompt for
users who already use sync E2EE, use the existing sync E2EE unlock material to
wrap the portable vault key.

This variant is deliberately less ambitious than a standalone vault passphrase:

- It requires no new server.
- It requires no new password, recovery key, or separate vault account.
- It gives no additional protection if sync E2EE is disabled.
- It does not create a security boundary stronger than the existing sync
  encryption passphrase.
- It must not silently enable portable synced secrets for users with weak or
  disabled sync E2EE.

Recommended behavior:

- Keep sync provider credentials and sync encryption passphrases device-local in
  OS-backed storage. Do not store the only sync unlock secret inside the vault
  that depends on sync unlock.
- For synced issue-provider and plugin secrets, store only `SecretRef` metadata
  in normal app state.
- Store the actual secret values in a synced portable vault record encrypted
  with a random `vaultDek`.
- Wrap `vaultDek` with a vault wrapping key derived from existing sync E2EE
  material:
  - If the input is a user passphrase, derive the wrapping key with Argon2id,
    per-vault salt, versioned parameters, and domain separation.
  - If the input is an existing high-entropy sync key, derive a separate wrapping
    key with HKDF-SHA-256, vault-specific salt, and an `info` string such as
    `super-productivity-portable-vault-v1`.
  - Never use the sync content-encryption key directly as a vault wrapping key.
- Store an OS-protected wrapped copy of `vaultDek` locally so already-configured
  devices unlock silently. Keep the plaintext `vaultDek` only in memory while
  the vault is unlocked.
- On sync E2EE passphrase/key rotation, unlock the current vault, create a new
  wrapper, and sync the updated manifest atomically. Keep old wrappers for a
  bounded grace period so offline devices can migrate; document that a device
  without the old unlock material may need integration reauth.
- If sync E2EE is not enabled, offer only device-local secure storage for real
  protection. Do not create new portable synced secret records.

User experience:

- Existing devices can migrate silently once they have the sync E2EE key and a
  usable local secure-storage backend.
- New devices get the same prompt they already need for sync E2EE. After sync
  decrypts, the vault unlocks automatically from the same material.
- No extra vault password is introduced.
- No integration token needs to be re-entered as long as the user has the
  existing sync E2EE unlock material.

Security improvement:

- Raw integration secrets no longer live in NgRx state, op-log operations,
  snapshots, normal backups, plugin synced data, or diagnostic logs.
- Remote sync storage still sees only ciphertext when sync E2EE is enabled.
- Local OS-backed storage protects cached vault material at rest on each device.

Limitations:

- An attacker who can brute-force or obtain the sync E2EE key can also unlock
  the portable secret vault.
- If a user chose a weak sync E2EE passphrase, the low-friction vault inherits
  that weakness. Do not silently enable portable vault sync when existing
  passphrase-strength checks fail.
- A compromised running client can still read secrets after vault unlock.
- Users without sync E2EE get only local hardening, not secure portable synced
  secrets.
- Old synced history may still contain previously stored plaintext secrets until
  compaction/retention cleanup is complete.

E2EE-disabled fallback:

- A fixed app key, static "standard key", encoding, or bundled public secret is
  only obfuscation. It prevents casual plaintext grepping but does not protect
  against anyone who can inspect the app code or synced data format.
- Do not use fixed-key obfuscation for new synced secret writes.
- If fixed-key obfuscation is used at all, restrict it to one-time legacy
  read/migration compatibility, call it "plaintext-equivalent compatibility
  encoding" internally, and define an expiry/removal release.
- A per-device random key stored in OS secure storage is real local protection,
  but it cannot decrypt secrets on another device and therefore is not a
  no-friction sync solution.
- Real portable protection without sync E2EE requires some other key source:
  user passphrase, platform cloud keychain, device-to-device transfer, passkey
  escrow, or a trusted server-side recovery design.
- For sync without E2EE, do not silently migrate synced integration secrets.
  Prompt once with explicit choices: enable sync E2EE and migrate later, or move
  credentials to this device only. New credentials default to device-local unless
  a real portable vault is available.

## Goals

- Keep passwords, access tokens, refresh tokens, API keys, and encryption
  passphrases out of NgRx state, op-log payloads, snapshots, normal backups,
  plugin synced data, and diagnostic logs.
- Use OS-backed secret storage where available.
- Make degraded platforms explicit instead of silently falling back to plaintext.
- Preserve existing masked-field UX with explicit unchanged/replace/clear
  behavior.
- Migrate existing plaintext local secrets without breaking sync provider auth,
  and migrate synced integration secrets only after compatibility gates are
  satisfied.
- Add tests that fail when canary secret values appear in serialized app state,
  operation payloads, backups, or logs.

## Non-Goals

- This is not a general password manager.
- This does not protect secrets after a compromised renderer, malicious plugin,
  browser extension, malware, or injected script has runtime access to a
  resolved secret.
- This does not remove the need for SuperSync/file-sync E2E encryption for user
  content.
- This does not make third-party tokens safer than their upstream scopes.
- The first release does not add native OS-backed storage, a portable vault,
  browser persistent secret storage, or deep cleanup of historical remote sync
  history.

## Release Split

### V1 - KISS Scope

V1 focuses on the highest-value security improvement: stop raw integration
secrets from entering synced state, op-log payloads, backups, plugin synced data,
and logs.

Because migrating synced config to `SecretRef` is schema-breaking, V1 is split
into two coordinated releases:

`V1a - compatibility and guardrails`:

- Secret registry, redaction, and canary tests.
- An Electron-profile `indexedDbProfile` `LocalSecretStore` backend.
- SecretRef-tolerant readers that preserve unknown/unsupported `SecretRef`
  values without overwriting them.
- Pre-dispatch and op-log guardrails that prevent new raw secret writes where
  the new flow is active.
- Backup/import/sync-hydration/state-cache sanitizers.
- `persistDataSynced` marked and tested as non-secret storage.

`V1b - synced-secret migration`:

- Built-in issue-provider secret fields stored as `SecretRef` plus local secret
  values.
- Plugin schema `password` fields stored as `SecretRef` plus local secret
  values.
- Simple per-provider states: saved on this device, missing on this device,
  storage unavailable.
- A hard compatibility gate proving all supported clients preserve `SecretRef`
  values before raw synced credentials are removed.

V1 explicitly defers:

- Sync provider private config, SuperSync access tokens, and `encryptKey`
  migration.
- Plugin OAuth token migration.
- Android background sync token hardening.
- Electron `safeStorage`, Android Keystore, and iOS Keychain backends.
- Portable synced vault, recovery keys, device pairing, and vault export/import.
- Browser persistent passphrase vault.
- Full historical cleanup of old remote ops/snapshots and old backup files.
- The broader "Connections on this device" checklist UI.

V1 storage capability matrix:

| Platform              | V1 persistent local secret store | Notes                                                                                  |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Electron desktop      | Yes, `indexedDbProfile`          | Local-isolation tier only; not OS-backed at-rest protection                            |
| Browser/PWA           | No                               | Use session-only or unavailable mode in V1                                             |
| Android/iOS Capacitor | No                               | Use session-only or unavailable mode until native storage/backup rules are implemented |

V1 does not improve local at-rest protection for persisted Electron profile
data. Its main win is removing raw integration secrets from synced state, op-log
payloads, backups, plugin synced data, and logs.

## Current Secret Inventory

### Sync Provider Secrets

Current storage:

- `SyncCredentialStore` stores private provider config in the `sup-sync`
  IndexedDB database.
- Private config can include WebDAV/Nextcloud passwords, Dropbox access and
  refresh tokens, SuperSync access and refresh tokens, and `encryptKey`.
- The data is local-only from a sync model perspective, but plaintext in
  IndexedDB.

Relevant files:

- [`src/app/op-log/sync-providers/credential-store.service.ts`](../../src/app/op-log/sync-providers/credential-store.service.ts)
- [`src/app/op-log/core/types/sync.types.ts`](../../src/app/op-log/core/types/sync.types.ts)
- [`src/app/op-log/sync-providers/super-sync/super-sync.model.ts`](../../src/app/op-log/sync-providers/super-sync/super-sync.model.ts)
- [`src/app/op-log/sync-providers/file-based/webdav/webdav.model.ts`](../../src/app/op-log/sync-providers/file-based/webdav/webdav.model.ts)
- [`src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts`](../../src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts)

### Android Background Sync Secrets

Current storage:

- SuperSync access tokens are mirrored from the WebView into native Android
  storage for background sync/reminder cancellation.
- Native storage uses `EncryptedSharedPreferences`, but currently falls back to
  standard `SharedPreferences` if encrypted preferences fail.
- `android:allowBackup="true"` is enabled and no backup exclusion rule for
  these encrypted preferences is present in the current tree.

Relevant files:

- [`android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncCredentialStore.kt`](../../android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncCredentialStore.kt)
- [`src/app/features/android/store/android-sync-bridge.effects.ts`](../../src/app/features/android/store/android-sync-bridge.effects.ts)
- [`android/app/src/main/AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml)

### Built-In Issue Provider Secrets

Current storage:

- Built-in issue provider configs live in the `issueProvider` NgRx state.
- `issueProvider` is part of the op-log model config, snapshots, sync data, and
  backups.
- Secret fields include:
  - Jira: `password`
  - GitLab: `token`
  - CalDAV: `password`
  - OpenProject: `token`
  - Gitea: `token`
  - Redmine: `api_key`
  - Trello: `apiKey`, `token`
  - Linear: `apiKey`
  - Azure DevOps: `token`
  - Nextcloud Deck: `password`

Relevant files:

- [`src/app/features/issue/issue.model.ts`](../../src/app/features/issue/issue.model.ts)
- [`src/app/features/issue/store/issue-provider.reducer.ts`](../../src/app/features/issue/store/issue-provider.reducer.ts)
- [`src/app/op-log/model/model-config.ts`](../../src/app/op-log/model/model-config.ts)
- [`src/app/op-log/backup/state-snapshot.service.ts`](../../src/app/op-log/backup/state-snapshot.service.ts)

### Plugin Secrets

Current storage:

- Plugin OAuth tokens are local-only in the `sup-plugin-oauth` IndexedDB
  database, but plaintext.
- Plugin config is stored via `PluginUserPersistenceService`, which is part of
  synced `pluginUserData`.
- Password fields in plugin issue-provider schemas are currently regular plugin
  config values. For example, GitHub and ClickUp issue-provider tokens can end
  up in synced plugin config.

Relevant files:

- [`src/app/plugins/oauth/plugin-oauth-token-store.ts`](../../src/app/plugins/oauth/plugin-oauth-token-store.ts)
- [`src/app/plugins/plugin-user-persistence.service.ts`](../../src/app/plugins/plugin-user-persistence.service.ts)
- [`src/app/plugins/plugin-config.service.ts`](../../src/app/plugins/plugin-config.service.ts)
- [`src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.ts`](../../src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.ts)

## Architecture

Introduce two separate concepts:

- `LocalSecretStore`: device-local secret/key storage. The first release may use
  the existing local IndexedDB profile storage with secret-specific boundaries;
  native OS-backed stores are a later hardening phase.
- `PortableVault`: synced encrypted secret records that can be unlocked only
  with valid vault key material.

`SecretRef` is metadata, not an authorization capability. Possession of a
`SecretRef` must not be enough to resolve a secret. Every resolution must enforce
the caller domain, plugin identity when applicable, `ownerType`, `ownerId`, and
`field`.

```ts
export interface SecretRef {
  kind: 'SecretRef';
  version: 1;
  id: string;
  ownerType:
    | 'syncProvider'
    | 'issueProvider'
    | 'pluginConfig'
    | 'pluginOAuth'
    | 'nativeBackground';
  ownerId: string;
  field: string;
  storageMode: 'device' | 'portableEncrypted';
  updatedAt: number;
  versionToken?: string;
}

export type SecretAccessContext =
  | {
      callerType: 'app' | 'nativeBridge';
      expectedOwnerType: SecretRef['ownerType'];
      expectedOwnerId: string;
      expectedField: string;
    }
  | {
      callerType: 'plugin';
      callerId: string;
      expectedOwnerType: 'pluginConfig' | 'pluginOAuth';
      expectedOwnerId: string;
      expectedField: string;
    };

export interface LocalSecretStoreCapabilities {
  mode:
    | 'localProfile'
    | 'osBacked'
    | 'passphraseProtected'
    | 'sessionOnly'
    | 'plaintextEquivalent'
    | 'unavailable';
  backend:
    | 'indexedDbProfile'
    | 'electronSafeStorage'
    | 'androidKeystore'
    | 'iosKeychain'
    | 'webSession'
    | 'webPassphrase';
  canPersistDeviceSecrets: boolean;
  canUsePortableVault: boolean;
  securityNotes?: string;
}

export interface LocalSecretStore {
  capabilities(): Promise<LocalSecretStoreCapabilities>;
  set(
    input: SecretRefInput,
    value: string,
    context: SecretAccessContext,
  ): Promise<SecretRef>;
  useSecret<T>(
    ref: SecretRef,
    context: SecretAccessContext,
    fn: (value: string) => Promise<T>,
  ): Promise<T | null>;
  delete(ref: SecretRef, context: SecretAccessContext): Promise<void>;
  exists(ref: SecretRef, context: SecretAccessContext): Promise<boolean>;
}
```

Only `SecretRef` and non-sensitive metadata may be stored in NgRx state, op-log
operations, snapshots, backups, and plugin synced data. The actual secret value
must live behind `LocalSecretStore` or `PortableVault`.

`versionToken` must not be a raw hash, prefix, suffix, checksum, or reusable
derivative of the secret. If needed, it should be a random opaque marker or a
keyed HMAC with a non-synced key. Otherwise omit it. V1 has no required use case
for `versionToken`; prefer omitting it until a concrete need exists.

### Storage Modes

`device`:

- Default mode.
- Stored only on the current device.
- Used for sync provider credentials, sync encryption passphrases, plugin OAuth
  tokens, and native background-sync credentials.
- Other devices must reauthenticate or re-enter these values.
- In V1, synced config must not contain a per-device random secret id. Use a
  deterministic secret slot id derived from stable metadata, for example
  `v1:${ownerType}:${ownerId}:${field}` with plugin id included in `ownerId` for
  plugin-owned secrets.
- Replacing a device-local secret value updates only the local secret store once
  the synced `SecretRef` slot exists. It must not update synced metadata such as
  `updatedAt` merely because the local secret value changed.
- Clearing an integration removes the synced `SecretRef`; clearing or replacing
  a secret on one device must not make another device's local secret missing if
  the integration remains configured.

`portableEncrypted`:

- Future opt-in mode for selected integration credentials.
- Secret ciphertext may sync, but only after being encrypted with a separate
  portable-vault key.
- The portable-vault key is unlocked by sync E2EE material, user passphrase,
  passkey/device key enrollment, or an explicit export/import flow.
- This mode must not be used to bootstrap SuperSync access tokens or the only
  copy of a sync encryption passphrase.
- `SecretRef.id` for portable records is minted once and synced with the owning
  config so every device can find the same vault record. Device-local refs must
  not be interpreted as portable ids on other devices.

### Post-V1 Portable Encrypted Vault Mechanics

A portable encrypted vault does not require a new server. Existing sync can
carry the vault manifest and encrypted records as normal app data because the
vault encrypts secrets before they reach normal state, op-log, and snapshot
code. When SuperSync or file-sync E2E encryption is enabled, portable vault
records are encrypted twice: once by the vault and again by sync payload
encryption.

Why this is still useful when sync is E2E encrypted:

- Sync E2EE protects remote payloads from the sync server or storage provider.
- After sync decryption, normal app state is plaintext on the client. If raw
  secrets remain in issue or plugin config, they can enter local state, backups,
  logs, and plugin persistence.
- Sync E2EE does not bootstrap new devices by itself. The current sync
  encryption passphrase/private config is local-only and still needs to be
  supplied per device.
- The sync target still sees ciphertext metadata and can delete, replay, or
  withhold records. Sync E2EE gives confidentiality, not full freshness,
  integrity, or availability against a malicious storage provider.

Recommended key structure:

- Generate a random 256-bit `vaultDek` when the user enables the portable vault.
- Encrypt each secret record with AES-256-GCM or XChaCha20-Poly1305 using
  `vaultDek`, a unique nonce, and authenticated data containing record id,
  owner, field, and schema version.
- Sync only `SecretRef` metadata, the vault manifest, encrypted secret records,
  and wrapped copies of `vaultDek`.
- Store an authenticated manifest with manifest version, vault epoch, wrapper
  metadata, record ids, and tombstones for deleted records.
- Define conflict and rollback behavior for stale manifests, resurrected
  records, wrapper-set rollback, and `SecretRef.updatedAt` rollback.
- Never sync plaintext `vaultDek`. Persist only wrapped copies of it. Keep the
  plaintext `vaultDek` only in memory while the vault is unlocked.

Unlock methods:

- `device`: wrap `vaultDek` with the OS-backed local `LocalSecretStore` for fast
  unlock on already-enrolled devices.
- `passphrase`: derive a wrapping key with Argon2id, per-vault salt, versioned
  parameters, and domain separation, then wrap `vaultDek`. This supports
  recovery and new-device unlock without an old device.
- `recoveryKey`: optional high-entropy recovery key displayed once or exported
  explicitly.
- `devicePairing`: optional later flow where an old device encrypts `vaultDek`
  for a new device public key.
- `syncE2EE`: low-friction mode deriving a distinct vault wrapping key from
  existing sync E2EE material as described above. Never reuse the sync content
  key directly.

New device flow:

1. Sync downloads `SecretRef` metadata plus vault ciphertext.
2. The app shows affected integrations as "credential locked" instead of
   "credential missing".
3. The user unlocks with the vault passphrase/recovery key or pairs with an
   existing device.
4. The client unwraps `vaultDek` and stores an OS-protected wrapped copy locally.
5. Subsequent use resolves the secret through `PortableVault` and
   `LocalSecretStore` without storing the plaintext in synced state.

Server role:

- No custom vault server is required for the baseline design.
- The server or sync target stores ciphertext plus vault metadata only.
- A server would only be needed for optional account recovery, remote device
  approval queues, passkey/account-based escrow, or push-assisted pairing.
- Do not use SuperSync access tokens as vault keys.
- Using the existing sync encryption passphrase or key as vault unlock material
  is possible, but must be explicit because it couples vault security and
  recovery to sync encryption configuration.

## Platform Backends

Native OS-backed stores are not required for the first release. The first
release can use an Electron local profile store and focus on removing raw
secrets from sync state, op-log payloads, backups, plugin synced data, and logs.
Native stores should be implemented later as platform hardening.

### First Release - Local Profile Store

On Electron desktop, use a dedicated local IndexedDB store for secret values.
Browser/PWA and Android/iOS Capacitor builds do not persist secrets in V1.

Implementation sketch:

- Store only `SecretRef` metadata in synced app state.
- Store secret values in a local-only database separate from synced model data.
- Encrypt with sync E2EE-derived vault material only when that material is
  already available. Otherwise treat this as local isolation, not strong
  at-rest encryption.
- Do not sync, back up, log, or export this database through normal app flows.
- Keep the same `LocalSecretStore` API so native backends can replace the
  storage implementation later.

### Deferred - Electron Desktop

Use Electron main-process IPC as the only bridge to the vault.

Implementation sketch:

- Add `electron/ipc-handlers/local-secret-store.ts`.
- Register the handler in `electron/ipc-handler.ts`.
- Add narrow preload methods in `electron/preload.ts` and
  `electron/electronAPI.d.ts`:
  - `localSecretStoreSet`
  - `localSecretStoreResolve`
  - `localSecretStoreDelete`
  - `localSecretStoreCapabilities`
- Use `safeStorage.encryptString()` and `safeStorage.decryptString()` in the
  main process.
- Store encrypted blobs in a small app-data file or a dedicated local database
  under `app.getPath('userData')`.
- Reject persistent device-secret storage or require explicit degraded consent
  when Linux reports the `basic_text` backend. That backend must not be a
  silent plaintext-equivalent fallback.
- On upgrade, if Linux reports `basic_text` and legacy plaintext credentials
  exist, do not delete them silently. Show an explicit choice: keep legacy
  plaintext with warning, switch to passphrase-protected storage, or use
  session-only storage and reauth when needed.

### Deferred - Android

Use a native Capacitor/JavaScript bridge backed by Android Keystore.

Implementation sketch:

- Add a native `LocalSecretStore`.
- Generate an AES-GCM key in `AndroidKeyStore`.
- Store ciphertext and metadata in private app storage or SharedPreferences.
- Do not fall back to plaintext `SharedPreferences`.
- Exclude vault ciphertext and encrypted preference files from Android Auto
  Backup. KeyStore keys may not survive restore, so restored ciphertext should
  be treated as unavailable and trigger reauth.
- Add `android:dataExtractionRules` for API 31+ and `android:fullBackupContent`
  rules for older devices. Exclude both the legacy background-sync preferences
  and the new local secret-store files before Phase 1 writes new secrets.
- Replace the current `BackgroundSyncCredentialStore` fallback with either
  "store encrypted" or "do not persist".

### Deferred - iOS

Use Keychain Services through a native Capacitor bridge.

- Store small secrets as keychain items.
- Use a non-iCloud, device-local accessibility class for device-only secrets.
- Set `kSecAttrSynchronizable=false` for device-local secrets.
- Define the keychain access group explicitly.
- Pick accessibility based on runtime need:
  - `whenUnlockedThisDeviceOnly` for secrets that do not need background access.
  - `afterFirstUnlockThisDeviceOnly` only where background tasks require access.
- Document app reinstall behavior. iOS keychain items can survive uninstall, so
  stale tokens must be detected and cleared or replaced during first-run setup.

### Web/PWA

The browser build cannot offer OS-level secret storage through standard web
APIs.

Recommended behavior:

- Default to session-only secret retention for the most sensitive values.
- Do not offer persistent browser secret storage in the first release.
- Defer browser passphrase vault work. If implemented later, pin the KDF first:
  WebCrypto gives PBKDF2 natively, while Argon2id requires a WASM dependency and
  explicit bundle-size acceptance.
- If "remember on this browser" is implemented later, store only
  non-extractable `CryptoKey` material where available and make the degraded
  security model explicit.
- Never claim browser persistent storage is equivalent to OS keychain storage.

## Data Flow

### Forms

Password/token fields should have three states:

- `unchanged`: a `SecretRef` exists and the user did not type a replacement.
- `replace`: the user typed a new secret, so the vault is updated and state
  receives the new `SecretRef`.
- `clear`: the user explicitly deletes the secret, so the vault entry and state
  reference are removed.

The form model must not emit the existing secret value to NgRx. Masked
placeholders are display-only.

Secret-bearing UI paths must vault replacement values and dispatch only
`SecretRef` values before any persistent action is emitted. The vault layer must
reject masked placeholder sentinels such as `********` as real secret values, and
forms must use dirty-state tracking instead of comparing placeholder strings.
If a user starts editing a secret field and then reverts it to its original
masked/empty display state, the form should collapse back to `unchanged`, not
`clear` or `replace`.

### Runtime Resolution

Services that need credentials resolve them as late as possible:

1. Load public config from NgRx or provider private config.
2. Resolve required `SecretRef` values through `LocalSecretStore` or
   `PortableVault` with a `SecretAccessContext`.
3. Build a short-lived runtime config object.
4. Use it for the request.
5. Do not dispatch, persist, or log the resolved object.

### Plugin Config

Plugin JSON schema fields with `type: "password"` should be intercepted by the
host app.

- Synced plugin config stores `SecretRef` values instead of raw secret strings.
- `PluginAPI.getConfig()` should return config metadata and `SecretRef` values,
  not resolved secret strings.
- Resolved plugin secrets should be exposed through a short-lived, namespaced API
  such as `PluginAPI.useSecret(ref, fn)`. The host validates that the ref belongs
  to the calling plugin before resolving it. The first implementation maps
  plugin-owned refs by `callerId === ownerId`.
- `persistDataSynced` is explicitly non-secret storage. It must not log payloads
  and should reject active canary/registered secret values in tests.
- Defer broader plugin secret APIs such as `persistSecret`, `loadSecret`, and
  `deleteSecret`. Initially support schema `password` fields and
  `PluginAPI.useSecret(ref, fn)` only.
- Plugin OAuth token migration is deferred. V1 only ensures plugin OAuth values
  remain registered for redaction/canary checks and are not newly leaked through
  logs, exports, or backups.

### Deferred Sync Provider Config

Continue treating provider private config as local-only in V1. Do not change
writes to `sup-sync` in V1. A later platform-hardening phase can store these
secret fields behind refs or native/OS-backed storage:

- WebDAV/Nextcloud: `password`, optional bearer `accessToken`, `encryptKey`
- Dropbox: `accessToken`, `refreshToken`, `encryptKey`
- SuperSync: `accessToken`, `refreshToken`, `encryptKey`
- Local file: `encryptKey`

Non-secret fields such as base URLs and folder paths can remain normal config.

V1 still registers these fields for redaction and canary checks so `encryptKey`,
access tokens, refresh tokens, and passwords do not newly appear in op-log
payloads, snapshots, backups, logs, or exports.

Deferred provider work:

- Provider APIs should expose public config separately from secrets.
- Call paths that need private values should resolve them asynchronously through
  `SecretRef`s.
- Android native mirroring resolves a SuperSync token only for the bridge write,
  refuses plaintext fallback or marks storage as unavailable, and relies on
  backup exclusions for restored devices.

## Migration Strategy

### Phase 0 - Secret Registry and Guards

- Add a typed registry of sensitive paths by domain:
  - sync provider private config fields
  - built-in issue provider fields
  - migrated GitHub/ClickUp plugin config fields
  - plugin schema `password` fields
  - plugin OAuth token records
- Add test helpers that scan snapshots, operation payloads, and backups for
  canary secret values.
- Add an op-log capture guard that rejects or fails tests when registered canary
  secrets appear in persistent action payloads.
- Add a pre-persistence `AppDataComplete` secret migration/sanitizer used by
  backup import, remote sync hydration, file-sync snapshot download, full-state
  tail-op hydration, state-cache writes, and `loadAllData`.
- Handle `SYNC_IMPORT` and `BACKUP_IMPORT` replacement semantics explicitly:
  block concurrent secret writes during import/hydration, then rerun the
  sanitizer and re-emit deterministic `SecretRef` metadata if an import replaced
  it. Secret refs must not be lost while local secret-store entries remain
  orphaned.
- Introduce one registry-backed `redactSecrets(value)` used by log recording,
  log export, privacy export, crash/error additional data, and plugin/config
  payload logging.
- Extend redaction to include `apiKey`, `api_key`, `clientSecret`,
  `client_secret`, `authorization`, case variants, and nested plugin config
  password fields.
- Mark `persistDataSynced` as non-secret storage and remove payload logging.
- Store migration markers only in local profile storage, never in synced NgRx
  state.
- V1 canary exit criterion: after migration, newly produced/current serialized
  outputs contain zero raw secret hits. This includes current state, new
  persistent actions, new op-log entries, new snapshots, new backups, logs,
  privacy export, and plugin synced data.
- Old local/remote op history and old backup files may still contain previously
  stored secrets until deferred historical cleanup. V1 should warn about those
  artifacts rather than claim they were purged.

### Phase 1 - V1 Local Profile Store

- Implement the common `LocalSecretStore` interface.
- Add an `indexedDbProfile` backend first for Electron desktop only.
- Surface capabilities in the UI so users can distinguish `localProfile`,
  `sessionOnly`, and `unavailable` storage in the first release.
- Keep browser/PWA and Android/iOS persistent secret storage out of the first
  release; use session-only or unavailable mode there.
- Defer Electron `safeStorage`, Android Keystore, iOS Keychain, Android backup
  exclusions, and Linux `basic_text` handling to post-V1 platform hardening.

### Deferred - Local-Only Sync Secrets

Do not migrate these in V1. They are local-only already, so they do not drive
the main synced-state/op-log leak risk. Move them after the V1 leak-path cleanup
or combine them with native platform hardening.

- Sync provider private config in `sup-sync`.
- Plugin OAuth tokens in `sup-plugin-oauth`.
- Android background SuperSync credential mirror only if the native hardening
  phase is pulled forward.

Migration flow:

1. Check migration marker for the profile and backend.
2. For each known local-only secret source, check if a vault entry already
   exists.
3. Load plaintext legacy value.
4. Store value in `LocalSecretStore`.
5. Replace persisted value with a `SecretRef` or remove it if the owning config
   can derive the ref deterministically.
6. Clear plaintext legacy value only after a successful vault write.
7. Retry idempotently on next startup if migration fails mid-way.
8. On migration failure, keep the raw value only in its original legacy source
   for retry. Do not write the raw value into NgRx, persistent actions, imports,
   backups, or synced state.

After successful migration:

- Delete plaintext legacy values.
- Clear in-memory caches where relevant.
- Keep compatibility reads for one or two releases, but never write plaintext
  secrets again.

### Phase 2 - V1 Synced Issue and Plugin Config Secrets

Migrate high-risk synced secrets next:

- Built-in issue provider tokens/passwords.
- Plugin config fields marked as password.
- Legacy migrated GitHub/ClickUp provider config.

This phase is a schema-breaking sync boundary unless client-version gating or
op migration exists.

Rollout gate:

- `V1a` is the compatibility release. All supported clients must be able to read
  and preserve `SecretRef` values before any client removes raw synced
  credentials.
- Define an explicit sync `schemaVersion` or `minClientVersion` signal on
  operations/snapshots before `V1b`. Do not rely on vector-clock entries as a
  durable old-client detector; vector clocks are bounded and can be pruned.
- If older clients may still sync, show a blocking upgrade warning and keep
  affected providers read-only or unmigrated until the user confirms the risk.
- Do not run historical cleanup while the explicit compatibility signal says a
  pre-migration client can still publish plaintext credentials.

First-release scope:

- Use device-local migration for `V1b`. Migrate synced integration secrets into
  device-local storage. Every device must reconnect integrations once.
- Defer E2EE portable migration to the post-V1 portable vault phase. Do not
  implement portable vault migration, key rotation, recovery keys, device
  pairing, export/import, or rollback handling in V1.
- Make migration idempotent by deterministic secret slot
  `(ownerType, ownerId, field)`. Two upgraded devices migrating the same
  provider should produce the same synced `SecretRef` metadata, so last-writer
  wins does not orphan either device's local secret.

For sync without E2EE:

- Do not silently migrate synced integration secrets into a portable synced
  store.
- Prompt once with explicit choices: enable sync E2EE and migrate later, or move
  credentials to this device only.
- New credentials default to device-local unless a real portable vault is
  available in a later release.

Legacy GitHub/ClickUp migration:

- Read legacy plaintext fields.
- Store them in `LocalSecretStore`.
- Remove raw `token`, `apiKey`, and password-like fields from migrated entities.
- Do not copy raw legacy fields into plugin config during reducer migration.

### Deferred - Historical Data Cleanup

Removing current state fields is not enough because local op logs, remote
operation history, snapshots, backups, and old exported files may already
contain raw secrets.

This is not required for V1. V1 should prevent new leaks and warn that old
history/backups may still contain previously stored secrets.

Deferred cleanup:

- Rewrite or purge `OPS`, `STATE_CACHE` current/backup, `IMPORT_BACKUP`,
  `PROFILE_DATA`, file-sync `sync-data.json.state`, file-sync `recentOps`, and
  remote SuperSync snapshots/ops where supported.
- Compact local operation logs after migration and after compatibility gates are
  satisfied.
- Rewrite current snapshots with sanitized state.
- For file-based sync, force-upload a stripped snapshot.
- For SuperSync, ensure server-side retained history no longer exposes raw
  secrets after compaction/retention. If no such retention guarantee exists,
  document that old server-side records may still contain legacy secrets.
- Delete migrated plaintext values from legacy IndexedDB stores.
- Update privacy export masking to include all registry keys.
- Warn users that older backups, copied sync files, and retained sync history may
  still contain previously saved tokens/passwords. Recommend deleting/protecting
  old backup files and rotating third-party tokens if those files may have been
  shared or exposed.

### Post-V1 - Native Stores and Optional Portable Vault

Only after device-local storage and compatibility gates are stable:

- Add Electron `safeStorage`, Android Keystore, and iOS Keychain backends.
- Add Android backup exclusion resources before Android native secret writes.
- Add explicit opt-in for syncing selected integration secrets.
- Use a separate `vaultDek`, not a SuperSync access token or the sync content
  encryption key.
- Add authenticated manifest versioning, tombstones, wrapper metadata, and
  rollback/replay handling.
- Allow encrypted export/import of vault contents for backup.
- Never include device-local sync credentials in portable vault export by
  default.

## Error Handling

| Scenario                                           | Handling                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| V1 device-local entry missing                      | Show "credential missing on this device" and offer reauth/re-enter                                                                     |
| V1 local profile store unavailable                 | Mark affected integration missing/read-only on this device; do not write raw fallback state                                            |
| V1 corrupted local entry                           | Do not delete the `SecretRef` automatically; offer reconnect/replace and diagnostic export without the secret                          |
| Migration fails mid-way                            | Keep the legacy value only in its original legacy source for retry; do not re-persist it through NgRx, op-log, backup, or synced state |
| Secret lookup fails during sync                    | Stop sync and ask for credential; do not overwrite or disable config                                                                   |
| Older client still syncing                         | Keep affected providers read-only or unmigrated until compatibility gate is satisfied                                                  |
| Post-V1 portable vault locked                      | Show "credential locked" and offer the existing sync E2EE unlock, vault passphrase, recovery key, or device-pairing flow               |
| Post-V1 OS-backed storage unavailable              | Use session-only storage or explicit passphrase-protected/degraded mode                                                                |
| Post-V1 Linux `basic_text` backend                 | Do not silently persist secrets; require explicit plaintext-equivalent consent or passphrase/session-only alternative                  |
| Post-V1 sync E2EE key rotation cannot rewrap vault | Keep old wrapper during grace period; if unavailable, require old unlock material or integration reauth                                |

## Backup and Restore Rules

- Normal app backups must never contain raw device secrets.
- For device-local secrets, backups contain only `SecretRef` metadata and
  provider metadata.
- For post-V1 portable vault secrets, backups may include portable vault ciphertext and
  non-device wrappers, but never plaintext secrets or device-local wrappers.
  This gives restore support while preserving the same offline brute-force risk
  as the portable vault itself.
- Post-V1 automatic platform backups must exclude native secret ciphertext if the
  decrypting key is device-bound.
- Manual encrypted vault export can be a separate artifact:
  - user supplies an export passphrase
  - export uses fresh salt and authenticated encryption
  - import requires explicit confirmation and conflict handling
- Restoring an app backup on a new device should show integrations as
  "configured, credentials missing" or "credential locked" with direct reauth or
  unlock actions.

## UX Requirements

- V1 settings pages need only simple stable states: "credential saved on this
  device", "missing on this device", and "storage unavailable".
- Defer "credential locked", "restored but key unavailable", "unrecoverable on
  this device", and the broader "Connections on this device" checklist to the
  portable/native hardening phases.
- Reauth is explicit and provider-specific.
- Clearing an integration deletes both the config reference and vault secret.
- Failed secret lookup must not silently disable sync or overwrite config.
- On degraded Linux storage, the user chooses between session-only storage and a
  passphrase-protected local store. On web/PWA, first release behavior is
  session-only or unavailable.
- Device-local behavior must be documented in the sync and integration settings:
  secrets are intentionally not synced by default.
- Release notes must say that new backups no longer include raw integration
  credentials, while older backups or sync history may still contain previously
  saved tokens/passwords. Users should delete/protect old backups and rotate
  third-party tokens if those files may have been exposed.

## Security Invariants

V1a guardrail invariants:

- No new raw secret values in persistent action capture, op-log operations,
  `BACKUP_IMPORT`, `SYNC_IMPORT`, state cache, hydration payloads, plugin synced
  data, `persistDataSynced` payloads, logs, error additional data, stack traces,
  privacy export, or log export for paths covered by the registry.
- Deferred local-only secrets such as `encryptKey`, sync access tokens, and
  plugin OAuth tokens stay in their existing stores, but registry/canary tests
  must verify they are not newly leaked through logs, exports, backups, or sync
  payloads.
- No fixed-key obfuscation for new synced secret writes.

V1b migrated-secret invariants:

- Migrated built-in issue-provider and plugin schema `password` values do not
  appear as raw values in NgRx state, action payloads, op-log operations,
  complete backup snapshots, plugin synced data, or logs.
- If migration cannot write to `LocalSecretStore`, the integration becomes
  missing or read-only on that device. Raw fallback state is not written.
- `SecretRef` is not an authorization capability; resolution validates caller
  identity and owner metadata.
- For V1 `indexedDbProfile`, `SecretRef` is useless without the local profile
  store from the same device/profile. This is not an at-rest encryption claim:
  anyone with local profile disk access may be able to read the local store.
- Runtime-resolved config objects stay local to the call path that needs them.

Post-V1 invariants:

- No plaintext native fallback for native OS-backed persistent storage.
- Plaintext `vaultDek` is never synced or persisted; it exists only in memory
  while the portable vault is unlocked.

## Testing Strategy

V1 tests:

- Unit tests for `indexedDbProfile` `LocalSecretStore` using canary values.
- Unit tests for `SecretRef` authorization boundaries:
  - wrong owner type/id/field is denied
  - plugin A cannot resolve plugin B's ref
  - a copied or stale ref is not sufficient to access a secret
- Multi-device tests for deterministic device-local slots: client A and client B
  can both reconnect the same integration, and syncing B's metadata does not
  make A's local credential missing.
- Migration tests for fresh install, existing issue/plugin credentials, partial
  migration, and failed local-store writes.
- Form tests for unchanged/replace/clear behavior, including masked sentinel
  rejection and "typed then reverted" collapsing back to `unchanged`.
- Plugin config tests for schema password fields.
- Compatibility-release tests:
  - new clients preserve existing raw config before migration
  - compatibility clients preserve `SecretRef` values
  - unsupported peers trigger read-only/blocking behavior
  - older-client overwrite of refs with raw/empty values is blocked or detected
- Snapshot/backup/op-log tests that fail if canary secrets appear in serialized
  state.
- Registry/redaction tests for case variants and nested keys such as `apiKey`,
  `api_key`, `authorization`, `clientSecret`, and plugin config password fields.
- `encryptKey` and sync-token canaries even though their migration is deferred.
- Integration canaries for persistent action capture, `OPS`, `BACKUP_IMPORT`,
  `SYNC_IMPORT`, `STATE_CACHE`, file-sync `sync-data.json.state`, file-sync
  `recentOps`, SuperSync snapshot upload, plugin `persistDataSynced`, log
  export, and privacy export.
- E2E smoke tests for:
  - Electron desktop: configure provider, reload app, credential still works
  - restore backup on a new device/profile, credential is missing but config
    metadata remains
  - sync between two upgraded clients without leaking issue-provider secrets
  - configure on client A, sync to client B, and assert no canary token appears
    in persisted stores, op-log files, or server/file-sync snapshots

Deferred tests:

- Electron tests for `safeStorage` unavailable and Linux `basic_text`.
- Android tests for KeyStore failure behavior and backup exclusion metadata.
- Portable vault tests for unlock, rewrap, rollback/tombstone behavior, and
  export/import.

## Implementation Sketch

V1 likely new files:

- `src/app/core/secret-storage/local-secret-store.model.ts`
- `src/app/core/secret-storage/local-secret-store.service.ts`
- `src/app/core/secret-storage/secret-registry.ts`
- `src/app/core/secret-storage/secret-migration.service.ts`
- `src/app/core/secret-storage/redact-secrets.ts`

V1 likely changed areas:

- issue provider config forms and API service resolution
- issue provider action creation before persistent dispatch
- plugin config service, plugin bridge, and `persistDataSynced`
- backup import, sync hydration, snapshot download, state-cache writes, and
  privacy/log export

Deferred likely files/areas:

- `src/app/core/secret-storage/portable-vault.service.ts`
- `electron/ipc-handlers/local-secret-store.ts`
- `android/app/src/main/java/com/superproductivity/superproductivity/service/LocalSecretStore.kt`
- Android backup exclusion resources for legacy background-sync prefs and new
  local secret-store files
- sync provider private config loading/saving
- plugin OAuth token store
- Android backup rules and background sync credential bridge

## Decisions Required Before V1a

- How long should legacy plaintext read compatibility remain?
- Should browser/PWA and Android/iOS show session-only secret retention or mark
  persistent secret storage unavailable?

## Required Before V1b Synced-Secret Migration

- Define an explicit `schemaVersion` or `minClientVersion` signal proving that
  supported clients preserve `SecretRef` values.
- What user-facing upgrade warning is acceptable before moving synced
  integration credentials to device-local storage?

## Decisions Deferred To Post-V1

- Does SuperSync retention/compaction currently guarantee old raw secret
  payloads disappear after migration?
- What minimum sync E2EE passphrase-strength rule is required before enabling
  the low-friction portable vault?
- How will sync E2EE passphrase/key rotation rewrap existing portable vault
  keys?
- Should portable vault backup/export be part of normal backup or a separate
  explicit export?

## References

- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- Android Keystore system: https://developer.android.com/privacy-and-security/keystore
- Android `EncryptedSharedPreferences` reference: https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- MDN SubtleCrypto/Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
