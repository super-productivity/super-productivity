# Secure Secret Storage Plan

Status: planned (revised 2026-07-03)

This plan replaces the older sync-credential-only secure storage sketch and
folds in the independent broader draft. The target is a secure storage
architecture for all app-managed secrets: sync credentials, sync encryption
passphrases, issue-provider tokens/passwords, plugin config secrets, plugin
OAuth tokens, and native background-sync credentials.

Revision note (2026-07-03): reconciled with shipped work (plugin secret
storage API #8633, setup-time E2EE offers #8709, E2EE-mandatory SuperSync
uploads GHSA-9v8x, issue-provider-to-plugin migrations). Headline changes:
the sync-E2EE-wrapped portable vault moves into V1b so E2EE users never
re-enter credentials; the blocking compatibility warning becomes a silent
dual-write gate; the local profile store covers all platforms; recovery keys,
device pairing, the vault DEK/manifest machinery, and speculative capability
modes are cut; `SecretAccessContext` is reframed honestly as misuse
prevention, not a security boundary; Electron main-process logs join the
redaction/canary surface.

## Scope Reality Check: What Actually Syncs Today

Before weighing tradeoffs, be precise about the surface:

- Sync provider credentials (WebDAV/Nextcloud passwords, Dropbox tokens,
  SuperSync tokens) and every provider's `encryptKey` are **already
  device-local** (`sup-sync` IndexedDB, never synced). Users already re-enter
  these once per device today.
- Plugin OAuth tokens (`sup-plugin-oauth`) and plugin `setSecret` values
  (`sup-plugin-secrets`, shipped in #8633) are **already device-local**.
- The only secrets that sync are: secret fields of the seven built-in issue
  providers (Jira, GitLab, CalDAV, OpenProject, Redmine, Nextcloud Deck,
  Plainspace) and `type: 'password'` config fields of issue-provider plugins
  (GitHub, ClickUp, Gitea, Linear, Trello, Azure DevOps). A typical user has
  0–3 of these configured.
- SuperSync uploads are E2EE-mandatory (GHSA-9v8x fix), file-based providers
  offer E2EE at setup (#8709), and legacy unencrypted SuperSync users get a
  calm migration banner (#8672). The E2EE cohort is the default and growing.

So the "everything arrives through sync" experience this plan disturbs is
limited to issue-provider and plugin credentials, and for the dominant
E2EE cohort the portable vault (V1b) preserves it entirely.

## Core Tradeoff

Moving secrets out of synced state trades a small, targeted UX cost for
keeping raw secrets out of synced state, op-log operations, snapshots,
backups, plugin synced data, and logs.

With the V1b portable vault, the cost lands only on users **without** sync
E2EE:

- **Sync E2EE enabled (default cohort):** issue-provider and plugin secrets
  move into a portable vault encrypted with a key derived from the existing
  sync E2EE material. New devices already enter the sync passphrase to sync
  at all; the vault unlocks from the same material. Zero new prompts, zero
  re-entry.
- **Sync without E2EE:** existing synced secrets stay where they are (see
  "Sync without E2EE" below); newly entered secrets become device-local and
  must be re-entered per device. The already-shipped E2EE nudges shrink this
  cohort over time, and enabling E2EE migrates secrets into the vault
  silently.
- **No sync:** nothing changes.

UX mitigation for the device-local cases:

- Keep provider metadata synced so setup forms are prefilled except for the
  missing secret.
- Show clear per-device states: "credential saved on this device" and
  "credential missing on this device".
- Provide direct reauth/re-enter actions from each affected integration.

Every vaulted or device-local secret is recoverable by reauthenticating with
the third-party service, so the worst case of any vault/storage loss is the
device-local baseline, never data loss.

## Sync without E2EE

For users who sync without E2EE, do not prompt and do not silently migrate:

- Existing synced integration secrets stay in synced config unmigrated. Their
  entire task dataset already syncs in plaintext to the same target; token
  confidentiality against that target is marginal, and a migration prompt
  would be exactly the imposed decision the manifesto rejects.
- New/replaced secrets are written as device-local `SecretRef` values (never
  raw into synced state), so the plaintext surface stops growing.
- The existing calm E2EE banner and setup-time offer remain the migration
  path. When the user enables sync E2EE, existing raw synced secrets migrate
  into the portable vault silently on each upgraded device.
- A fixed app key, static "standard key", or bundled obfuscation secret is
  only obfuscation and must not be used for new synced secret writes. If used
  at all, restrict it to one-time legacy read/migration compatibility with a
  defined removal release.

## Goals

- Keep passwords, access tokens, refresh tokens, API keys, and encryption
  passphrases out of NgRx state, op-log payloads, snapshots, normal backups,
  plugin synced data, and diagnostic logs — renderer **and** Electron main
  process.
- Preserve the multi-device experience for sync E2EE users: no credential
  re-entry beyond the sync passphrase they already enter.
- Use OS-backed secret storage where available (post-V1 hardening).
- Make degraded platforms explicit instead of silently falling back to
  plaintext.
- Preserve masked-field UX with a simple empty-control model.
- Migrate existing plaintext secrets without breaking auth, without blocking
  dialogs, and only behind compatibility gates where synced schema changes.
- Add tests that fail when canary secret values appear in serialized app
  state, operation payloads, backups, or logs.

## Non-Goals

- This is not a general password manager (no recovery keys, no device
  pairing, no passkey escrow — reauth with the upstream service is the
  recovery path).
- This does not protect secrets after a compromised renderer, malicious
  plugin, browser extension, malware, or injected script has runtime access.
  In particular, it does **not** create a boundary between app code and
  plugin code — see "Honest threat model" below.
- This does not remove the need for sync E2EE for user content.
- This does not make third-party tokens safer than their upstream scopes.
- The first release does not add native OS-backed storage or deep cleanup of
  historical remote sync history.

## Honest Threat Model

What each tier actually buys — write user-facing and internal docs to these
claims, never stronger ones:

- **V1 local profile store (`indexedDbProfile`):** local _isolation_ only.
  Secrets leave synced state, backups, exports, and logs. Anyone with disk
  access to the profile — or any code running in the app origin, including
  plugins — can still read them, exactly like the existing `sup-sync`,
  `sup-plugin-oauth`, and `sup-plugin-secrets` stores today. This is not an
  at-rest encryption claim.
- **Portable vault:** confidentiality of integration secrets against the
  sync target/storage provider, layered under sync E2EE. It inherits the
  strength of the sync E2EE passphrase and adds no new offline brute-force
  exposure beyond what sync E2EE already has (same key material protects the
  full dataset today). A malicious storage provider can still withhold or
  roll back vault records along with the rest of the synced data;
  confidentiality holds, freshness does not. Rotation: see "Rotation".
- **Post-V1 OS-backed stores (safeStorage/Keystore/Keychain):** at-rest
  protection for the local device (stolen-disk, other-OS-user). Still no
  app-vs-plugin separation: plugins execute in the host renderer
  (`src/app/plugins/plugin-runner.ts`, iframe plugins are
  `allow-same-origin`), so IPC calls are indistinguishable by caller. A real
  plugin boundary requires the separate plugin process/origin isolation work
  plus main-process enforcement keyed to the isolated caller; this plan
  should not claim it.

## Current Secret Inventory

### Sync Provider Secrets (device-local today)

- `SyncCredentialStore` stores private provider config plaintext in the
  `sup-sync` IndexedDB database. Local-only, never synced.
- Secret fields: WebDAV/Nextcloud `password` + optional bearer `accessToken`,
  Dropbox `accessToken` + `refreshToken`, SuperSync `accessToken` +
  `refreshToken`, and `encryptKey` on all providers (incl. local file).
- Note: the store deliberately logs `encryptKey` length only, never the
  value.

Relevant files:

- [`src/app/op-log/sync-providers/credential-store.service.ts`](../../src/app/op-log/sync-providers/credential-store.service.ts)
- [`src/app/op-log/core/types/sync.types.ts`](../../src/app/op-log/core/types/sync.types.ts)
- [`packages/sync-providers/src/super-sync/super-sync.model.ts`](../../packages/sync-providers/src/super-sync/super-sync.model.ts)
- [`packages/sync-providers/src/file-based/webdav/webdav.model.ts`](../../packages/sync-providers/src/file-based/webdav/webdav.model.ts)
- [`packages/sync-providers/src/file-based/dropbox/dropbox.ts`](../../packages/sync-providers/src/file-based/dropbox/dropbox.ts)

### Android Background Sync Secrets (device-local today)

- SuperSync access tokens are mirrored from the WebView into native Android
  storage for background sync/reminder cancellation.
- `BackgroundSyncCredentialStore` uses `EncryptedSharedPreferences` but falls
  back to standard plaintext `SharedPreferences` if encrypted preferences
  fail.
- `android:allowBackup="true"` is set, and backup rule files
  (`data_extraction_rules.xml`, `backup_rules.xml`) already exist — but they
  do **not** exclude the `SuperProductivitySync` preferences file, so the
  (encrypted or fallback-plaintext) token store is currently backed up. The
  fix is one `<exclude>` entry per rules file, not new infrastructure — see
  "Quick Wins".

Relevant files:

- [`android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncCredentialStore.kt`](../../android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncCredentialStore.kt)
- [`src/app/features/android/store/android-sync-bridge.effects.ts`](../../src/app/features/android/store/android-sync-bridge.effects.ts)
- [`android/app/src/main/AndroidManifest.xml`](../../android/app/src/main/AndroidManifest.xml)

### Built-In Issue Provider Secrets (synced today — primary V1b target)

- Built-in issue provider configs live in the `issueProvider` NgRx state,
  which is part of the op-log model config, snapshots, sync data, and
  backups.
- Secret fields:
  - Jira: `password`
  - GitLab: `token`
  - CalDAV: `password`
  - OpenProject: `token`
  - Redmine: `api_key`
  - Nextcloud Deck: `password`
  - Plainspace: `token`
- Gitea, Trello, Linear, Azure DevOps, GitHub, and ClickUp are **no longer
  built-in** — they migrated to plugins and their secrets are plugin config
  fields (next section).

Relevant files:

- [`src/app/features/issue/issue.model.ts`](../../src/app/features/issue/issue.model.ts)
- [`src/app/features/issue/store/issue-provider.reducer.ts`](../../src/app/features/issue/store/issue-provider.reducer.ts)
- [`src/app/op-log/model/model-config.ts`](../../src/app/op-log/model/model-config.ts)
- [`src/app/op-log/backup/state-snapshot.service.ts`](../../src/app/op-log/backup/state-snapshot.service.ts)

### Plugin Secrets

Three distinct stores exist today:

- **Plugin config (synced — V1b target):** plugin issue-provider schemas
  declare `type: 'password'` fields (e.g. GitHub `token`, ClickUp `apiKey`)
  that are stored as regular values in synced `pluginUserData` via
  `PluginUserPersistenceService`. This is the plugin-side twin of the
  built-in issue-provider leak.
- **Plugin secret store (device-local, shipped #8633):**
  `setSecret`/`getSecret`/`deleteSecret` on the plugin API, backed by the
  dedicated `sup-plugin-secrets` IndexedDB. Local-only, plaintext at rest,
  namespaced per plugin, purged on plugin uninstall **and** plugin
  cache-clear. This is the canonical plugin-facing secret store; this plan
  builds on it rather than adding a parallel one.
- **Plugin OAuth tokens (device-local):** `sup-plugin-oauth` IndexedDB,
  local-only, plaintext, purged on uninstall/cache-clear.

Relevant files:

- [`src/app/plugins/secret/plugin-secret-store.ts`](../../src/app/plugins/secret/plugin-secret-store.ts)
- [`src/app/plugins/secret/plugin-secret.service.ts`](../../src/app/plugins/secret/plugin-secret.service.ts)
- [`src/app/plugins/oauth/plugin-oauth-token-store.ts`](../../src/app/plugins/oauth/plugin-oauth-token-store.ts)
- [`src/app/plugins/plugin-user-persistence.service.ts`](../../src/app/plugins/plugin-user-persistence.service.ts)
- [`src/app/plugins/plugin-config.service.ts`](../../src/app/plugins/plugin-config.service.ts)

### Electron Main-Process Leaks (missing from earlier drafts)

- `electron/jira.ts` receives the full Jira config (including `password`)
  over IPC and logs raw error responses to disk via electron-log.
- The renderer's global error handler forwards error objects wholesale to
  main-process electron-log; stringified HTTP errors routinely embed request
  config with `Authorization` headers.
- electron-log files persist on disk and are covered by no current masking.

Relevant files:

- [`electron/jira.ts`](../../electron/jira.ts)
- [`src/app/core/error-handler/global-error-handler.class.ts`](../../src/app/core/error-handler/global-error-handler.class.ts)

### Existing Building Blocks (favorable)

- `packages/sync-core/src/encryption*` already ships Argon2id KDF, AES-256-GCM
  (WebCrypto with `@noble/ciphers` fallback), versioned KDF parameters, and a
  session key cache. HKDF is available natively via WebCrypto. The portable
  vault needs no new crypto dependency.
- `src/app/imex/file-imex/privacy-export.ts` already masks `password`,
  `token`, `apiKey`, `secret`, `authorization`, `accessToken`, `authCode`,
  `api_key` — but misses `refreshToken`, `clientSecret`/`client_secret`,
  `encryptKey`, `apiToken`, and is exact-key case-sensitive. See "Quick
  Wins".
- `PluginAPI.persistDataSynced` already logs only key length, never payloads,
  with a spec enforcing it.
- `src/app/plugins/util/plugin-persistence-key.util.ts` (`composeId`) is the
  reference implementation for delimiter-safe composite ids.

## Quick Wins (ship immediately, independent of V1)

Each is small, has no schema or UX impact, and closes a real hole:

1. Add `<exclude>` entries for the `SuperProductivitySync` preferences file
   to `data_extraction_rules.xml` and `backup_rules.xml` (KeyStore keys do
   not survive restore anyway, so backed-up ciphertext is dead weight at
   best and a plaintext-fallback leak at worst).
2. Stop logging raw Jira responses in `electron/jira.ts`; log status +
   redacted metadata only.
3. Extend privacy-export masking: add `refreshToken`, `clientSecret`,
   `client_secret`, `encryptKey`, `apiToken`; make matching
   case-insensitive.
4. Scrub or truncate error objects before forwarding renderer errors to
   main-process electron-log (drop request-config/header blobs).

## Architecture

Two concepts:

- `LocalSecretStore`: device-local secret storage. V1 uses a dedicated
  local-only IndexedDB (`indexedDbProfile`) on **all** platforms; native
  OS-backed backends replace the storage implementation post-V1 behind the
  same interface.
- `PortableVault`: synced, vault-encrypted secret records for sync-E2EE
  users, carried as ordinary op-log entities.

`SecretRef` is metadata. Only `SecretRef` and non-sensitive metadata may be
stored in NgRx state, op-log operations, snapshots, backups, and plugin
synced data; secret values live behind `LocalSecretStore` or `PortableVault`.

```ts
export interface SecretRef {
  kind: 'SecretRef';
  version: 1;
  id: string; // delimiter-safe composite, see "Slot ids"
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
  // extend these unions only when a backend actually ships (YAGNI)
  mode: 'localProfile' | 'unavailable';
  backend: 'indexedDbProfile';
  canPersistDeviceSecrets: boolean;
  canUsePortableVault: boolean;
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

**What `SecretAccessContext` is — and is not:** it is a misuse-prevention
assertion that catches accidental cross-owner reads and wrong-wiring bugs
(wrong owner type/id/field is rejected; the host maps plugin-owned refs by
`callerId === ownerId`). It is **not** a security boundary: the context is a
caller-supplied object in a single JS realm, and plugins execute in the host
renderer, so a malicious plugin can forge an `app` context or open the
IndexedDB directly. Tests for it are API-contract tests, not security tests.
A real caller boundary arrives only with plugin process/origin isolation plus
main-process enforcement, and no release note may claim otherwise.

### Slot ids

Synced config must not contain per-device random secret ids. Use a
deterministic slot id from stable metadata so two devices migrating the same
provider mint the same `SecretRef` and LWW cannot orphan either side.

- Encode each segment delimiter-safely (reuse/align with `composeId` in
  `plugin-persistence-key.util.ts`); plugin ids and schema field names are
  third-party-controlled strings, so naive `v1:${ownerType}:${ownerId}:${field}`
  joining is ambiguous (`("a","b:c")` vs `("a:b","c")`).
- Validate `ownerType` against the closed enum.
- Orphan GC: periodically sweep local-store entries whose owning config no
  longer exists, with a grace window for sync races. Clearing an integration
  removes the synced `SecretRef` and the local/vault value; replacing a
  secret value on one device must not invalidate another device's local
  entry while the integration remains configured (value replacement updates
  the store, not synced metadata).

### Storage Modes

`device` (default for non-E2EE sync and all non-synced secrets):

- Stored only on the current device in `LocalSecretStore`.
- Other devices show "credential missing on this device" and offer re-entry.

`portableEncrypted` (default when sync E2EE is enabled):

- Secret ciphertext syncs as ordinary op-log records, encrypted by the vault
  before it ever reaches state/op-log/snapshot code (so it is double-wrapped
  by sync E2EE on the wire).
- Must not be used to bootstrap SuperSync access tokens or the only copy of
  a sync encryption passphrase — sync credentials and `encryptKey` stay
  device-local so vault unlock never depends on itself.

### Portable Vault Mechanics (V1b, E2EE users)

Deliberately minimal — the vault holds a handful of sub-kilobyte records, so
it needs none of the DEK/manifest/epoch machinery of a general vault:

- **Key:** `vaultKey = HKDF-SHA-256(syncE2EEKey, salt = per-vault random salt,
info = 'super-productivity-portable-vault-v1')`. The salt is random,
  minted at vault creation, and stored as plaintext metadata in the synced
  vault config record (salts are not secret). Never use the sync content
  key directly. If the E2EE input is a passphrase, it already passes through
  the existing Argon2id KDF (same implementation and parameter-versioning as
  sync E2EE — no PBKDF2 fork, no second KDF to maintain).
- **Records:** each secret is encrypted with AES-256-GCM under `vaultKey`
  with a **fresh CSPRNG nonce on every encryption** (including updates —
  multiple devices encrypt under the same key, so nonces must never be
  counter- or metadata-derived) and AAD binding
  `{recordId, ownerType, ownerId, field, schemaVersion, updatedAt}`.
- **Sync:** records are ordinary synced entities, so LWW conflict handling
  and deletion tombstones come from the existing op-log for free. No
  separate manifest.
- **Unlock:** derive `vaultKey` whenever the sync E2EE key is available (the
  existing session cache makes this free). Optionally persist a wrapped copy
  in `LocalSecretStore` for access before sync unlock; never persist the
  plaintext key.
- **Rotation:** changing the sync E2EE passphrase derives a new `vaultKey`
  (new salt) and re-encrypts all records — trivial at this record count, and
  it is _true_ rotation: old ciphertext in retained sync history becomes
  undecryptable under material derived from the old passphrase only if the
  attacker never had it. Be explicit in docs: rotating after a suspected
  passphrase compromise protects future records, but anything the attacker
  could already decrypt (including old history) must be treated as exposed —
  the honest remedy is rotating the third-party tokens themselves, and the
  UI should say so.
- **Residual risk (document, don't engineer around):** a malicious sync
  target can roll the whole dataset back to an older state, resurrecting a
  deleted vault record along with everything else. That is the existing sync
  trust model (E2EE gives confidentiality, not freshness) and the recovered
  record is at worst a stale credential the user can revoke upstream. A
  per-vault epoch/MAC scheme is not worth its complexity here; revisit only
  if the vault ever outgrows this scale.
- **No weak-passphrase gate:** the same key material already protects the
  user's full synced dataset, so vaulting secrets under it adds zero new
  brute-force exposure. Passphrase-strength nudges belong to sync E2EE
  setup, not the vault.

Cut from earlier drafts (reauth-with-upstream covers recovery, and the
"not a password manager" non-goal applies to the plan itself): `vaultDek`
indirection, authenticated manifests, vault epochs, wrapper sets, grace-period
rewrap, `recoveryKey`, `devicePairing`, passkey escrow, vault export/import.

## Platform Backends

### V1 — Local Profile Store (all platforms)

One backend everywhere: a dedicated local-only IndexedDB for secret values,
separate from synced model data, on Electron, browser/PWA, and Android/iOS
Capacitor alike.

Rationale: `sup-sync` already stores WebDAV passwords and `encryptKey` in
plaintext IndexedDB on every platform, so refusing the same tier for issue
tokens on mobile/web would protect nothing while making V1b a mobile
showstopper (integrations dying or demanding re-entry every session). A
uniform backend also deletes the session-only/unavailable UX states from V1
entirely. On web, IndexedDB eviction risk equals that of the app data
itself — no worse.

- Store only `SecretRef` metadata in synced app state; values in the local
  DB.
- Do not sync, back up, log, or export this database through normal app
  flows.
- Keep the `LocalSecretStore` interface so native backends can replace the
  storage implementation later without a second data-model migration.
- For `pluginConfig`-owned values, back the store with the existing
  `sup-plugin-secrets` database (host-reserved key namespace) instead of a
  second plugin-secret surface — its per-plugin purge on uninstall and
  cache-clear then applies automatically. Decision recorded below.

### Post-V1 — Electron `safeStorage`

Main-process IPC as the only bridge; buys at-rest OS-keychain protection and
keeps secrets out of the renderer-readable profile DB. It does **not** buy
plugin separation (see Honest Threat Model).

- `electron/ipc-handlers/local-secret-store.ts`, registered in
  `electron/ipc-handler.ts`; narrow preload methods
  (`localSecretStoreSet/Resolve/Delete/Capabilities`) in
  `electron/preload.ts` + `electron/electronAPI.d.ts`.
- `safeStorage.encryptString()`/`decryptString()` in the main process;
  encrypted blobs in a small file/db under `app.getPath('userData')`.
- Linux `basic_text` backend must not be a silent plaintext-equivalent
  fallback: require explicit degraded consent or offer session-only. On
  upgrade with legacy plaintext credentials present, show an explicit choice
  rather than deleting silently.

### Post-V1 — Android

- Native `LocalSecretStore` backed by an AES-GCM key in `AndroidKeyStore`;
  ciphertext in private app storage. No plaintext `SharedPreferences`
  fallback — "store encrypted" or "do not persist".
- The Quick Wins backup excludes must land before native secret writes;
  extend them to cover the new secret-store files. KeyStore keys may not
  survive restore, so restored ciphertext is treated as unavailable and
  triggers reauth.
- Replace the current `BackgroundSyncCredentialStore` plaintext fallback.

### Post-V1 — iOS

- Keychain Services via a native Capacitor bridge; device-local accessibility
  classes (`kSecAttrSynchronizable=false`; `whenUnlockedThisDeviceOnly`, or
  `afterFirstUnlockThisDeviceOnly` only where background tasks require it);
  explicit access group.
- Keychain items can survive uninstall: detect and clear stale tokens during
  first-run setup.

### Web/PWA notes

- V1 uses the same `indexedDbProfile` tier as everywhere else (local
  isolation, honestly labeled).
- If a stronger browser story is ever wanted, "session-only" means in-memory
  service state only — never `sessionStorage`, `localStorage`, `window.name`,
  or `BroadcastChannel` (browsers persist `sessionStorage` to disk for
  session restore). Add a canary test for those sinks.
- Never claim browser storage is equivalent to OS keychain storage.

## Data Flow

### Forms

Secret fields use an initially **empty control** with a per-device hint
("credential saved on this device" / "missing on this device"):

- untouched or emptied control → `unchanged` (dirty-state tracking gives the
  "typed then reverted" collapse for free);
- typed value → `replace` (value goes to the vault/local store; only the new
  `SecretRef` is dispatched);
- explicit remove affordance → `clear` (store entry and synced ref removed).

No masked sentinel (`********`) ever exists in the model, so no sentinel
rejection layer is needed. The form model must never emit a secret value to
NgRx; the vault/local-store write happens before any persistent action is
dispatched.

### Runtime Resolution

Services resolve credentials as late as possible:

1. Load public config from NgRx or provider private config.
2. Resolve required `SecretRef` values through `LocalSecretStore` /
   `PortableVault` with a `SecretAccessContext`.
3. Build a short-lived runtime config object, use it for the request.
4. Never dispatch, persist, or log the resolved object. When a resolved
   secret must cross IPC (e.g. Jira via Electron main), the receiving side
   is part of the redaction surface too.

### Plugin Config

- Plugin JSON-schema fields with `type: 'password'` are intercepted by the
  host: synced plugin config stores `SecretRef` values; the actual values
  live in the `sup-plugin-secrets`-backed store (device mode) or the
  portable vault (E2EE mode).
- `PluginAPI.getConfig()` returns config metadata and `SecretRef` values,
  never resolved secrets. Resolution goes through a narrow
  `PluginAPI.useSecret(ref, fn)` where the host asserts
  `callerId === ownerId` (misuse prevention; see Honest Threat Model for
  what this does not claim).
- The shipped `setSecret`/`getSecret`/`deleteSecret` API stays as-is for
  plugin-managed secrets; schema-`password` interception is the host-managed
  complement, sharing the same store and purge lifecycle.
- `persistDataSynced` remains non-secret storage: payload logging is already
  removed and spec-enforced; add registry canaries so registered secret
  values are rejected in tests.
- Plugin OAuth token migration is deferred; V1 registers those values for
  redaction/canary checks only.

### Sync Provider Config (stays device-local; deferred hardening)

Provider private config in `sup-sync` (passwords, tokens, `encryptKey`) does
not change in V1 — it is already local-only and does not drive the synced
leak risk. Post-V1, move it behind the OS-backed `LocalSecretStore` backends.
V1 still registers all these fields for redaction and canary checks so they
never newly appear in op-log payloads, snapshots, backups, logs, or exports.

## Migration Strategy

### Phase 0 — Registry, Redaction, Guards (with V1a)

- Typed registry of sensitive paths by domain: sync provider private config,
  built-in issue provider fields, migrated GitHub/ClickUp plugin config,
  plugin schema `password` fields, plugin OAuth token records, plugin
  `setSecret` values.
- One registry-backed `redactSecrets(value)` used by log recording, log
  export, privacy export, crash/error additional data, plugin/config payload
  logging, **and the Electron main process** (electron-log writes, forwarded
  renderer errors, `electron/jira.ts`).
- Redaction key set includes `apiKey`, `api_key`, `apiToken`, `refreshToken`,
  `clientSecret`, `client_secret`, `encryptKey`, `authorization`, case
  variants, and nested plugin config password fields.
- Canary test helpers that scan snapshots, operation payloads, backups, and
  both renderer and main-process log output for canary secret values; an
  op-log capture guard that fails tests when registered canaries appear in
  persistent action payloads.
- Pre-persistence `AppDataComplete` sanitizer used by backup import, remote
  sync hydration, file-sync snapshot download, full-state tail-op hydration,
  state-cache writes, and `loadAllData`. Handle `SYNC_IMPORT` /
  `BACKUP_IMPORT` replacement semantics explicitly: block concurrent secret
  writes during import/hydration, rerun the sanitizer, re-emit deterministic
  `SecretRef` metadata if an import replaced it (refs must not be lost while
  local entries remain orphaned).
- Migration markers live in local profile storage only, never synced state.
- Exit criterion (falsifiable): zero raw registered-secret hits in all newly
  produced serialized outputs — current state, persistent actions, op-log
  entries, snapshots, backups, renderer and main-process logs, privacy
  export, plugin synced data. Old history/backups may still contain secrets
  until deferred cleanup; V1 warns rather than claims purging.

### V1a — Compatibility and Guardrails (ships alone, no schema break)

- Everything in Phase 0.
- `LocalSecretStore` with the `indexedDbProfile` backend on all platforms.
- SecretRef-tolerant readers that preserve unknown/unsupported `SecretRef`
  values without overwriting them.
- Dual-write plumbing (see gate below) behind a flag, dark.
- This release already captures most of the practical value for E2EE users
  (whose remote payloads are ciphertext anyway): local artifacts — backups,
  exports, logs — stop leaking. Ship it early and independently.

### V1b — Synced-Secret Migration + Portable Vault

Migrates built-in issue provider secrets, plugin schema `password` fields,
and legacy migrated GitHub/ClickUp config; ships the portable vault in the
same release so E2EE users never re-enter credentials and no second
schema/compat event is needed later.

**Transition = silent dual-write, no blocking dialogs:**

1. Upgraded clients write both the `SecretRef` (+ vault/local value) and the
   legacy raw field. Sync-visible security is unchanged during transition
   (the raw field was already there); UX cost is zero.
2. Raw fields are stripped only when the compatibility gate for that
   account clears (below). Stripping is automatic and silent.
3. If a raw secret arrives via sync **after** stripping (a straggler old
   client wrote it), sanitize it into the vault/local store and surface a
   one-time, non-blocking hint that the credential may exist in sync
   history/backups and can be rotated. Never silently swallow the event, and
   never block sync.

**Compatibility gate, split by transport (an old client cannot emit the new
signal, so absence of a signal is never proof — hence dual-write + sanitize
rather than trust):**

- SuperSync: server-enforced `minClientVersion` on op upload — the only hard
  arbiter. Do not rely on vector-clock entries (bounded, prunable).
- File-based sync (WebDAV/Dropbox/local): verify empirically whether current
  released clients refuse to write when the sync format version is bumped.
  If they do, a format bump is the gate; if they ignore unknown versions,
  document that file-based sync has **no hard gate** and rely on
  dual-write + sanitize-on-receive + the rotation hint indefinitely (strip
  raw fields after a long deprecation window instead).

**Migration mechanics:**

- Deterministic slot ids (see "Slot ids") make migration idempotent across
  devices; LWW on identical metadata cannot orphan either device's value.
- E2EE users: existing raw synced secrets migrate into the portable vault
  silently; nothing to re-enter on any device that has the sync passphrase.
- Non-E2EE users: existing synced secrets stay unmigrated (see "Sync without
  E2EE"); new/replaced secrets become device-local refs.
- Legacy GitHub/ClickUp reducer migration must not copy raw fields into
  plugin config; raw values go to the store, refs to config.
- On failed store writes, keep the legacy value only in its original legacy
  source for idempotent retry on next startup; never re-persist raw values
  through NgRx, persistent actions, imports, backups, or synced state.
- After a device's migration succeeds and the gate has stripped synced raw
  fields: delete plaintext legacy values, keep compatibility reads for one
  or two releases, never write plaintext again.

### Deferred — Local-Only Secret Hardening

`sup-sync` private config, `sup-plugin-oauth`, `sup-plugin-secrets` values,
and the Android background-sync mirror move behind OS-backed backends in the
post-V1 platform-hardening phase (same migration flow: marker → store write →
replace/remove legacy → clear plaintext only after success).

### Deferred — Historical Data Cleanup

Old local op logs, remote history, snapshots, and backups may contain
previously stored secrets. V1 prevents new leaks and warns; cleanup is a
follow-up:

- Rewrite/purge `OPS`, `STATE_CACHE` current/backup, `IMPORT_BACKUP`, file-sync
  `sync-data.json.state` + `recentOps`, and remote
  SuperSync snapshots/ops where supported; compact local op logs after the
  gate clears; force-upload stripped snapshots for file-based sync.
- For SuperSync, verify whether retention/compaction bounds old raw payloads;
  if not, document that server-side history may retain legacy secrets.
- Release notes: new backups no longer include raw credentials; older
  backups, copied sync files, and retained history may — delete/protect old
  backup files and rotate third-party tokens if they may have been exposed.

## Error Handling

| Scenario                              | Handling                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Device-local entry missing            | "Credential missing on this device" + direct re-enter/reauth action                                                                    |
| Local profile store unavailable       | Mark affected integration missing/read-only on this device; never write raw fallback state                                             |
| Corrupted local entry                 | Do not delete the `SecretRef` automatically; offer reconnect/replace and diagnostic export without the secret                          |
| Migration fails mid-way               | Keep the legacy value only in its original legacy source for retry; do not re-persist it through NgRx, op-log, backup, or synced state |
| Secret lookup fails during sync       | Stop sync and ask for the credential; do not overwrite or disable config                                                               |
| Raw secret arrives post-strip         | Sanitize into store/vault; one-time non-blocking rotation hint; never block sync                                                       |
| Vault record fails AAD/decrypt        | Treat as missing (not corrupted config); offer re-enter; log a redacted diagnostic                                                     |
| Post-V1 OS-backed storage unavailable | Session-only (in-memory) or explicit degraded mode; Linux `basic_text` requires explicit consent, never a silent plaintext-equivalent  |

## Backup and Restore Rules

- Normal app backups contain only `SecretRef` + provider metadata for
  device-local secrets, and portable-vault ciphertext for vaulted secrets
  (same offline exposure as the vault itself) — never plaintext values.
- Restoring a backup on a new device shows integrations as "configured,
  credential missing" (device-local) or working-after-sync-unlock (vaulted),
  with direct reauth actions.
- Post-V1 platform backups exclude native secret ciphertext where the
  decrypting key is device-bound (Android rules per Quick Wins/native
  phase).

## UX Requirements

- V1 settings need exactly two per-integration states: "credential saved on
  this device" and "missing on this device" (plus a rare "storage
  unavailable"). Vaulted credentials on an E2EE-synced device simply work
  and need no state chip at all.
- No blocking upgrade dialogs, no migration prompts, no consent modals in
  V1. The only new user-visible text is the per-device state hints and the
  one-time post-strip rotation hint.
- Reauth is explicit and provider-specific; failed secret lookup never
  silently disables sync or overwrites config.
- Settings docs state plainly: sync provider credentials and encryption
  passphrases are intentionally per-device; integration credentials travel
  inside the encrypted vault only when sync E2EE is on.
- Release notes must say that new backups no longer include raw integration
  credentials, while older backups/sync history may still contain previously
  saved values, with rotation advice.

## Security Invariants

V1a guardrail invariants:

- No new raw secret values in persistent action capture, op-log operations,
  `BACKUP_IMPORT`, `SYNC_IMPORT`, state cache, hydration payloads, plugin
  synced data, `persistDataSynced` payloads, renderer logs, **main-process
  logs**, error additional data, privacy export, or log export for
  registry-covered paths.
- Deferred local-only secrets (`encryptKey`, sync tokens, plugin OAuth,
  plugin `setSecret` values) stay in their existing stores, with
  registry/canary coverage proving no new leak paths.
- No fixed-key obfuscation for new synced secret writes.

V1b invariants:

- Migrated secrets never appear raw in NgRx state, action payloads, op-log
  operations, backups, plugin synced data, or logs once the strip gate has
  cleared for the account; during dual-write, exposure equals the status quo
  and never exceeds it.
- If the store write fails, the integration becomes missing/read-only on
  that device; raw fallback state is never written.
- Resolution asserts declared owner metadata (misuse prevention); caller
  identity is **not** verifiable in-renderer and no stronger claim is made.
- `SecretRef` plus the local profile DB from another device resolves
  nothing; this is an isolation claim, not an at-rest encryption claim.
- Plaintext `vaultKey` material is never synced or persisted unwrapped; it
  exists in memory (and the existing E2EE session cache) only.
- Runtime-resolved config objects stay local to the call path.

## Testing Strategy

V1 tests:

- `indexedDbProfile` `LocalSecretStore` unit tests with canary values, on
  the web/Capacitor build targets too (single backend everywhere).
- API-contract tests for `SecretAccessContext` (wrong owner type/id/field
  denied; plugin refs resolve only for `callerId === ownerId`) — labeled as
  contract tests, not security tests.
- Slot-id encoding tests: delimiter-containing plugin ids/field names cannot
  alias another slot.
- Multi-device determinism: clients A and B migrate the same integration;
  syncing B's metadata does not orphan A's value.
- Vault tests: AAD mismatch rejected; fresh-nonce-per-write; passphrase
  change re-encrypts records and old-key material no longer decrypts new
  records; unlock via session-cached E2EE material requires no prompt.
- Dual-write/gate tests: transition writes both forms; strip only after gate
  signal; post-strip raw arrival is sanitized + hinted, sync not blocked;
  compatibility clients preserve `SecretRef` values; older-client raw/empty
  overwrite of refs is detected and repaired from the local store.
- Form tests for the empty-control model (untouched/emptied → unchanged,
  typed → replace, remove → clear).
- Migration tests: fresh install, existing credentials, partial migration,
  failed store writes, E2EE-enable triggering silent vault migration.
- Canary integration tests: persistent action capture, `OPS`,
  `BACKUP_IMPORT`, `SYNC_IMPORT`, `STATE_CACHE`, file-sync
  `sync-data.json.state` + `recentOps`, SuperSync snapshot upload, plugin
  `persistDataSynced`, log export, privacy export, **electron-log output**
  (main + forwarded renderer errors), and the in-memory-only rule for any
  session-mode (no `sessionStorage`/`localStorage`/`window.name` sinks).
- Redaction tests for case variants and nested keys (`apiKey`, `api_key`,
  `apiToken`, `refreshToken`, `authorization`, `clientSecret`,
  `client_secret`, `encryptKey`, plugin password fields).
- E2E smoke: configure provider on Electron, reload, credential works;
  restore backup on a new profile → config present, credential
  missing/locked as designed; two upgraded E2EE clients sync an issue
  provider with zero canary hits in persisted stores, op-log files, or
  sync snapshots, and client B needs no re-entry.

Deferred tests: Electron `safeStorage` unavailable / Linux `basic_text`;
Android KeyStore failure + backup-exclusion metadata; iOS keychain
survive-uninstall handling.

## Implementation Sketch

V1 likely new files:

- `src/app/core/secret-storage/local-secret-store.model.ts`
- `src/app/core/secret-storage/local-secret-store.service.ts`
- `src/app/core/secret-storage/secret-registry.ts`
- `src/app/core/secret-storage/secret-migration.service.ts`
- `src/app/core/secret-storage/redact-secrets.ts` (shared with `electron/`)
- `src/app/core/secret-storage/portable-vault.service.ts` (V1b)

V1 likely changed areas:

- issue provider config forms and API service resolution
- issue provider action creation before persistent dispatch
- plugin config service, plugin bridge (`useSecret`), schema-password
  interception into the `sup-plugin-secrets`-backed store
- backup import, sync hydration, snapshot download, state-cache writes,
  privacy/log export
- `electron/jira.ts`, main-process log wiring (redaction)
- op-log entity registry + validation for the vault record type (V1b)

Deferred: `electron/ipc-handlers/local-secret-store.ts`, Android/iOS native
stores + backup rules, sync provider private config re-homing, plugin OAuth
store hardening.

## Decisions Required Before V1a

- How long should legacy plaintext read compatibility remain?
- Confirm: back `pluginConfig`-owned host secrets with the existing
  `sup-plugin-secrets` DB (recommended — inherits purge lifecycle) vs. a
  separate namespace in the new store.
- Cost out skipping `indexedDbProfile` on Electron in favor of going straight
  to the main-process `safeStorage` backend (web/mobile keep
  `indexedDbProfile` either way). Recommended default: uniform
  `indexedDbProfile` first — one backend, one migration path, and the
  interface swap to `safeStorage` later is internal to `LocalSecretStore`.

## Required Before V1b

- Implement the SuperSync server `minClientVersion` upload rejection.
- Empirically verify old released clients' behavior on a file-based sync
  format-version bump (gate exists vs. dual-write-forever, see gate
  section).
- Verify the op-log entity registry + typia validation can carry the new
  vault record type without breaking pre-V1a clients (if a new entity kind
  breaks old-client validation, vault records must wait behind the same
  dual-write gate — same release, ordered rollout).

## Decisions Deferred To Post-V1

- Does SuperSync retention/compaction bound old raw secret payloads after
  migration?
- Scope of historical cleanup automation vs. documented rotation advice.

## References

- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- Android Keystore system: https://developer.android.com/privacy-and-security/keystore
- Android `EncryptedSharedPreferences` reference: https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- MDN SubtleCrypto/Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
- Shipped plugin secret storage (#8633): `src/app/plugins/secret/`
- Sync E2EE primitives: `packages/sync-core/src/encryption*`
