# PR 7 — SuperSync Slice (design doc)

> For Claude executing this: this is a **design doc for multi-review**, not a
> step-by-step implementation plan. Once the design choices below are
> ratified, rewrite as a TDD plan or execute in commits per the "Suggested
> commit shape" section.

**Goal.** Move the SuperSync provider (`super-sync.ts`,
`super-sync.model.ts`, and its co-located spec) into
`@sp/sync-providers`, behind the ports introduced for Dropbox + WebDAV
plus one new storage port and one new response-validator port. Leave
a thin app-side factory shim so `sync-providers.factory.ts` keeps
working unchanged. The four SuperSync-named app services
(`super-sync-status.service`, `super-sync-websocket.service`,
`super-sync-restore.service`, `supersync-encryption-toggle.service`)
stay app-side because they depend on Angular/NgRx wiring that doesn't
belong in the package.

**Status.** PR 5 has shipped slices 1-6 (scaffold, envelope types,
PKCE, native HTTP retry, error classes + Dropbox proper, WebDAV +
Nextcloud). This is slice 7 in the long-term plan, the second-to-last
provider lift. LocalFile remains as slice 8. See
`docs/long-term-plans/sync-core-extraction-plan.md` § "Remaining Slice
Plan" item 1 for surrounding context.

---

## Multi-review consensus (2026-05-12)

Six Claude reviewers (correctness, security/privacy, architecture,
alternatives, performance, simplicity) ran in parallel against the
original design. Codex and Gemini were not run for this slice (the
WebDAV-slice precedent already established the multi-review protocol
shape, and the Claude lenses converged strongly on the open
questions). Consensus is recorded below; minority positions explicitly
noted.

### Decisions revised after review

- **Open question 1 (`WebFetchFactory` adoption) — ADOPT.**
  Simplicity, alternatives, and architecture all agreed: free
  consistency with Dropbox/WebDAV, identical iOS late-patching risk
  at construction time, three-line wiring cost. Closed.
- **Open question 2 (`RestorePointType` narrowing) — KEEP PACKAGE
  GENERIC; app shim narrows.** Alternatives + simplicity both
  argued threading the narrow union into the package re-introduces
  domain coupling the boundary forbids. Mirrors how
  `OperationSyncCapable<'superSyncOps'>` is handled today.
- **Open question 3 (`KeyValueStoragePort` vs narrow
  `SuperSyncStorage`) — PICK NARROW (option A).** Architecture and
  alternatives both pushed back on the generic option. Three reasons
  the narrow port wins: (1) `lastServerSeq` is provider state, not
  transport state — the generic port advertises a generality the
  package doesn't use; (2) the prefix + `parseInt` indirection
  becomes host-coupled if the port is generic; (3) LocalFile (slice 8) is `FileSyncProvider`-shaped and has no `lastServerSeq`
  equivalent, so the "reuse" argument is speculative. Architecture's
  further "absorb into `SuperSyncPrivateCfg`" alternative is more
  invasive than this slice should attempt — noted as a follow-up.
- **Open question 4 (`isTransientNetworkError` strategy) — PROMOTE
  under an intent-anchored name, not `isTransientErrorMessage`.**
  Architecture flagged the naming smell: after promotion the package
  has `isTransientNetworkError(e: unknown)` (native-code-aware) and
  the promoted helper. Names that discriminate on input shape will
  get mixed up. Pick a name that anchors on intent — e.g.
  `isRetryableUploadError` (the actual semantic surface — "should
  this upload-result error trigger a retry?"). Correctness
  separately flagged the barrel-export collision risk — explicit
  resolution: barrel exports both as distinct names; app's
  `sync-error-utils.ts` re-exports the promoted helper aliased back
  to its current name so `operation-log-upload.service.ts` doesn't
  change.
- **Open question 5 (spec migration — monolithic vs split) —
  MONOLITHIC, defer split.** Three reviewers (architecture,
  performance, simplicity) affirmed; one (alternatives) preferred a
  pre-split-then-move three-way commit. Architecture's reasoning
  carried: conflating a 1.8×-larger-than-WebDAV Jasmine→Vitest port
  with a structural split burns review attention. The three-way
  split (core/ops/fetch) is recorded as a follow-up commit shape so
  the deferred work is concrete. Alternatives' dissent noted in §
  "Recorded dissents" below.
- **Open question 6 (compression — direct import vs port) — DIRECT
  `@sp/sync-core` import.** Performance verified the paths are
  observationally equivalent; architecture and simplicity affirmed;
  correctness's grep proved no `instanceof CompressError` catches
  exist downstream. Alternatives' dissent (move
  `CompressError`/`DecompressError` into `@sp/sync-core` for
  strict behavior preservation) noted in § "Recorded dissents".
- **Open question 7 (privacy A1 — fixed status vs scrubbed) —
  EXTRACTED-REASON form, not blanket fixed status.** Both correctness
  and security flagged that the doc's "fixed `HTTP <status>
<statusText>`" form discards useful 5xx debug information that
  comes from the server's JSON `error` field. The right shape is:
  call `_extractServerErrorReason(body)` (already exists) on the
  generic-error path too, cap the extracted reason at 80 chars, and
  thread it through the thrown `Error.message`. Statusline form
  differs by transport: web uses `HTTP <status> <statusText> — <reason?>`,
  native uses `HTTP <status> — <reason?>` (`CapacitorHttp` doesn't
  surface `statusText`). The blanket "drop body" rule still applies
  for everything other than the extracted-reason short string.
- **Open question 8 (factory shape) — DROP `extraPath`.** Architecture
  and alternatives both noted that SuperSync explicitly ignores
  `basePath` (super-sync.ts:70-72 comment). Carrying a dead parameter
  for "consistency" with Dropbox/WebDAV hides intent. `createSuperSyncProvider()`
  takes no arguments. The `sync-providers.factory.ts` call site is the
  only update.

### Decisions affirmed

- **`SuperSyncResponseValidators` six-method port shape.** Alternatives
  noted a single-function `(name, data) => unknown` dispatcher
  alternative; rejected because string-typed dispatch pushes the
  type-key mapping into the package and degrades call-site
  ergonomics. Architecture affirmed: the validator-as-port shape
  with the response _types_ already in `@sp/sync-providers` is the
  inverted-dep solution the architectural rule wants.
- **`PROVIDER_ID_SUPER_SYNC` + `AssertSuperSyncId` pattern.**
  Simplicity initially flagged this as cargo cult; verification
  against Dropbox at `packages/sync-providers/src/file-based/dropbox/dropbox.ts:43`
  and `src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts:19`
  proved it's load-bearing — the package generic is keyed on
  `typeof PROVIDER_ID_DROPBOX`, and the assert protects against
  enum-vs-constant drift. Keep.
- **`getAuthHelper` not on SuperSync.** Correctness confirmed via
  grep that no consumer expects SuperSync to implement it
  (`sync-wrapper.service.ts:899`, `dialog-sync-cfg.component.ts:442`,
  `config-page.component.ts:133` all feature-detect). No action.
- **Bundle size deferral.** Performance estimated CJS lands at
  ~95-100 KB (under the doc's 110 KB projection — SuperSync's
  private helpers minify well). Tiered-barrel split stays a
  documented deferral; cost rises with each slice but does not
  bind this one.

### New blockers surfaced (must fix in slice)

The security and correctness reviewers independently surfaced four
privacy regression sites the doc's original sweep undercounted. All
of these must be fixed inside PR 7b:

- **`AuthFailSPError(reason, body)` retains body in `additionalLog`.**
  `super-sync.ts:413` constructs `new AuthFailSPError(reason || ...,
body)`. The package-side class `AuthFailSPError` at
  `packages/sync-providers/src/errors/index.ts:205-207` extends
  `AdditionalLogErrorBase`, whose constructor (L29-36 of the same
  file) stores all rest-args on `this.additionalLog`. PR 5b's
  Dropbox slice did NOT scrub this for SuperSync — it only stopped
  the constructor-time `OP_LOG_SYNC_LOGGER.log` side effect. The raw
  `body` (which may contain user content on a 401/403 response)
  still lives on the error instance and can flow into log exports or
  error-reporting UI. **Fix:** drop the `body` arg at the SuperSync
  call site; construct as
  `new AuthFailSPError(reason || \`Authentication failed (HTTP \${status})\`)`.
  Pin the invariant in a code comment.
- **`_handleNativeRequestError` user-facing message embeds raw
  `errorMessage`.** `super-sync.ts:478-481` re-throws with
  `\`Unable to connect to SuperSync server. Check your internet
  connection. (\${errorMessage})\``. The `errorMessage`was extracted
via`\_getErrorMessage(error)`; on low-level CapacitorHttp DNS/TLS
errors the underlying `.message` can carry the resolved hostname
  or full URL. **Fix:** drop the parenthesised interpolation
  entirely; the fixed user-facing string suffices. Logging the
  underlying error happens separately via the structured log on
  L470-475 (already safe).
- **Timeout `Error.message` embeds `path` with query string.**
  `super-sync.ts:620` throws
  `\`SuperSync request timeout after \${...}s: \${path}\``. The
`path`for`downloadOps`carries`?sinceSeq=…&excludeClient=…&limit=…`; `excludeClient`is a
pseudonymous device identifier (clientId). **Fix:** drop`path`
  from the thrown message; the structured log on L617-619 already
  captures the path.
- **`_extractServerErrorReason` returns server `error` field uncapped.**
  `super-sync.ts:424-432` extracts a JSON `error` field with no
  length cap. The SuperSync server's auth-fail contract is fixed-
  vocabulary today, but a future server change could embed the
  rejected `clientId` or path. **Fix:** cap the extracted reason at
  80 chars and document the assumption as a code comment on the
  helper.

Additional pinned invariants to land alongside the move (mirroring
WebDAV slice's "response headers are not logged" boundary
documentation):

- **`getEncryptKey` JSDoc invariant.** "Callers MUST NOT log the
  return value; pass to encryption pipeline only." The credential
  store already redacts to length-only on storage; the boundary at
  the public method is the right place to pin.
- **`getWebSocketParams` JSDoc invariant.** "This is the only method
  that exposes the access token to callers. Callers MUST NOT log the
  return value." Without this, a future refactor could leak the
  token through other return values.
- **`_cachedServerSeqKey` invalidation invariant.** The `null`-reset
  in `setPrivateCfg` (L91) is load-bearing for per-user/per-server
  seq isolation. Pin as a JSDoc `@invariant` on the private field.
  Add a Vitest spec asserting the reset survives the port adapter.
- **`deleteAllData` response-shape invariant.** L347 logs the full
  `validated` response. `validateDeleteAllDataResponse` returns
  `{ success: boolean }` today; pin the invariant that the
  response-validators port must continue to return a primitives-only
  shape, or the log line must be rewritten to log explicit fields.
- **Spec privacy-regression test.** Add one Vitest spec that drives
  an HTTP-error path with a body of `'{"taskId":"abc","title":"secret
task title"}'` and asserts (a) the captured `SyncLogger` mock's
  meta contains neither string and (b) the thrown `Error.message`
  contains neither string.

### Action items folded into PR 7a/7b

The new blockers raise the privacy-sweep scope. The commit shape
stays two-commit (7a helper promotion, 7b bulk move), but 7b's
content list grows:

- Apply the four new privacy fixes inline at their call sites
  (AuthFailSPError body drop, native-error rethrow scrub, timeout
  path drop, extracted-reason cap).
- Add the JSDoc invariants for `getEncryptKey`, `getWebSocketParams`,
  `_cachedServerSeqKey`.
- Add the spec privacy-regression test as a single Vitest spec under
  the bulk move.
- Switch `KeyValueStoragePort` → narrow `SuperSyncStorage` port
  shape.
- Rename the promoted helper to `isRetryableUploadError` (or another
  intent-anchored name agreed at commit time).
- Drop `extraPath` from the factory; update
  `sync-providers.factory.ts`.
- Factory shim return type must explicitly include
  `OperationSyncCapable<'superSyncOps'>` and
  `RestoreCapable<RestorePointType>` so consumers like
  `snapshot-upload.service.ts:77-95` and
  `super-sync-restore.service.ts:118` keep type-checking without
  `as any` casts.

### Recorded dissents

- **Alternatives — spec pre-split before move.** Argued for a
  three-commit shape: 7a helper, 7b pre-split monolith into three
  themed files (Jasmine, behavior-preserving), 7c bulk move +
  Vitest convert. Rejected by the architecture/simplicity
  consensus that conflating any structural change with the
  Jasmine→Vitest port obscures conversion mistakes. Recorded
  because the alternative is genuinely lower-risk for review
  diffing; consensus picks lower-PR-count + the same WebDAV-slice
  pattern.
- **Alternatives — move `CompressError` / `DecompressError` into
  `@sp/sync-core` for strict behavior preservation.** Argued the
  doc's "no instanceof catches exist today" audit could be
  invalidated by a future contributor; relocating the error
  classes is a strictly safer move. Rejected because the relocation
  itself is scope creep (the error classes live in app-side
  sync-errors with other SP-specific error classes that don't move
  cleanly together), and the grep is reliable for the size of the
  current codebase. Adopt the direct import; if a future consumer
  needs `instanceof CompressError` at the SuperSync boundary, that
  consumer adds the relocation as a separate commit.
- **Alternatives — barrel split now (PR 7d).** Argued the cost of
  the tiered split rises with each slice. Rejected because
  performance's bundle-size estimate (95-100 KB CJS) is under any
  threshold a reviewer flagged, and barrel splitting after LocalFile
  (slice 8) covers all providers in one polish PR.
- **Alternatives — type-only `@sp/super-sync-protocol-types` leaf
  package.** Argued ~50 LOC type-only leaf removes the
  `provider.types.ts` duplication risk. Rejected for this slice
  (scope creep), recorded as a candidate shape if more providers
  need typed responses without `@sp/shared-schema` coupling.

### Simplicity-driven scope reductions

The simplicity reviewer recommended cutting the doc by ~40-45% to
land near ~450 lines, closing 7 of 8 open questions in-doc with
defaults. After this consensus folds in:

- All 8 open questions now have decisions; section "Open questions
  for multi-review" below collapses to a one-line pointer to this
  consensus block.
- "Storage port" section drops option A vs B discussion (option A
  picked).
- "Response validators port" drops the schema-relocation
  alternatives (decision is the port).
- "isTransientNetworkError" section drops options 2 and 3 (option 1
  picked, renamed).
- "Compression" section drops the logger-handling subsection and the
  open-question pointer.
- "Privacy sweep checklist" drops the "Privacy invariants pinned"
  meta-section (the new-blockers content above is the substantive
  list).
- "Spec migration scope" drops the describe-block hierarchy (one
  sentence on file size + decision).
- "Risks for the slice" drops items now folded into the consensus
  blockers (OAuth/SP-account auth, response-shape coupling); keeps
  native compressed-body path and WebSocket integration boundary as
  real residual risks.

---

## What moves

### Source files

From `src/app/op-log/sync-providers/super-sync/` →
`packages/sync-providers/src/super-sync/`:

- `super-sync.ts` (692 lines) — provider class implementing
  `SyncProviderBase<SuperSync>`, `OperationSyncCapable<'superSyncOps'>`,
  `RestoreCapable`. Methods: `isReady`, `setPrivateCfg`,
  `clearAuthCredentials`, `uploadOps`, `downloadOps`,
  `getLastServerSeq`, `setLastServerSeq`, `uploadSnapshot`,
  `getRestorePoints`, `getStateAtSeq`, `getWebSocketParams`,
  `deleteAllData`, `getEncryptKey`. Private helpers: `_cfgOrError`,
  `_resolveBaseUrl`, `_getServerSeqKey`, `_checkHttpStatus`,
  `_extractServerErrorReason`, `_sanitizeToken`, `_getErrorMessage`,
  `_handleNativeRequestError`, `_fetchApi`, `_fetchApiCompressed`,
  `_fetchApiCompressedNative`, `_doWebFetch`, `_doNativeFetch`.
- `super-sync.model.ts` (17 lines) — `SuperSyncPrivateCfg` interface,
  `SUPER_SYNC_DEFAULT_BASE_URL` constant.
- `super-sync.spec.ts` (1553 lines, Jasmine → Vitest).

### Stays app-side

- `response-validators.ts` (130 lines) — imports
  `@sp/shared-schema`, which is banned in `packages/sync-providers/**`
  by ESLint. Becomes a `responseValidators` dep injected into the
  package class. See § "Response validators port" below.
- `response-validators.spec.ts` (288 lines) — stays with the
  validators.
- `src/app/op-log/sync/super-sync-status.service.ts` and its spec —
  NgRx-coupled status observable.
- `src/app/op-log/sync/super-sync-websocket.service.ts` and its spec
  — WebSocket connection + reconnection logic that touches NgRx
  state and uses Angular DI for `SuperSyncProvider`.
- `src/app/imex/sync/super-sync-restore.service.ts` and its spec —
  Restore-snapshot UI orchestration.
- `src/app/imex/sync/supersync-encryption-toggle.service.ts` and its
  spec — Encryption-toggle orchestration with dialog flows.
- `src/app/op-log/sync-providers/provider.const.ts`
  (`SyncProviderId.SuperSync`) — app keeps the enum for OAuth
  routing and config-UI dispatch; the package adds the string
  constant alongside.
- `src/app/op-log/sync-providers/sync-providers.factory.ts` — app
  composition. The `new SuperSyncProvider(extraPath)` line collapses
  to `createSuperSyncProvider(extraPath)`.

---

## Ports the package class needs

Five of these already exist (introduced by slices 5-6); two are new
to this slice.

### Already-introduced ports (reuse)

1. **`SyncLogger` (`@sp/sync-core`)** — replaces every `SyncLog.*`
   call. The app injects `OP_LOG_SYNC_LOGGER`.
2. **`ProviderPlatformInfo` (`@sp/sync-providers`)** — replaces
   `Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW` at
   `super-sync.ts:82`. `isNativePlatform` is already the union
   (Capacitor native + Android WebView shim), so the package can read
   `deps.platformInfo.isNativePlatform` directly. The app injects
   `APP_PROVIDER_PLATFORM_INFO`.
3. **`NativeHttpExecutor` (`@sp/sync-providers`)** — backs
   `executeNativeRequestWithRetry`. Package imports the helper
   directly from the same package; the executor is injected via
   `deps.nativeHttpExecutor`. The app injects
   `(cfg) => CapacitorHttp.request(cfg)` (mirrors the Dropbox factory).
4. **`SyncCredentialStorePort` (`@sp/sync-providers`)** — replaces
   `new SyncCredentialStore(SyncProviderId.SuperSync)` at
   `super-sync.ts:73`. App injects a `SyncCredentialStore` instance.
5. **`WebFetchFactory` (`@sp/sync-providers`)** — adopted for
   consistency with Dropbox/WebDAV (identical iOS late-patching risk
   at construction time).

### New ports (this slice)

6. **`SuperSyncResponseValidators` (new, six methods)** — see §
   "Response validators port" below.
7. **`SuperSyncStorage` (new, three methods)** — narrow port for
   `lastServerSeq` (per multi-review consensus, not the generic
   `KeyValueStoragePort` originally proposed). See § "Storage port
   for `lastServerSeq`" below.

---

## Response validators port

`super-sync.ts` calls six validators today (`validateOpUploadResponse`,
`validateOpDownloadResponse`, `validateSnapshotUploadResponse`,
`validateRestorePointsResponse`, `validateRestoreSnapshotResponse`,
`validateDeleteAllDataResponse`). Each takes `unknown` and returns the
typed response (or throws `InvalidDataSPError`). Validators use
Zod-like `safeParse` against schemas from `@sp/shared-schema`, which
is banned in `packages/sync-providers/**` (per the long-term plan's
"Domain Rule"). Validators stay app-side; package injects via
`deps.responseValidators`.

### Port shape

```ts
// packages/sync-providers/src/super-sync/response-validators.ts
import type {
  OpUploadResponse,
  SuperSyncOpDownloadResponse,
  SnapshotUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
} from '../provider.types';

export interface SuperSyncResponseValidators {
  validateOpUpload(data: unknown): OpUploadResponse;
  validateOpDownload(data: unknown): SuperSyncOpDownloadResponse;
  validateSnapshotUpload(data: unknown): SnapshotUploadResponse;
  validateRestorePoints(data: unknown): RestorePointsResponse;
  validateRestoreSnapshot(data: unknown): RestoreSnapshotResponse;
  validateDeleteAllData(data: unknown): { success: boolean };
}
```

App-side `response-validators.ts` and its spec stay in
`src/app/op-log/sync-providers/super-sync/`; they implement the port
and are injected via `deps.responseValidators`. Validators throw
`InvalidDataSPError` (already a package error class from PR 5a) —
the package class catches nothing here, so error identity
preservation works through the re-export shim.

`RestorePointType` narrowing: package types
(`provider.types.ts:144-197`) stay generic on
`TRestorePointType extends string = string`. The app shim narrows
at the boundary — mirrors `OperationSyncCapable<'superSyncOps'>`.

---

## Storage port for `lastServerSeq`

Three `localStorage` call sites in `super-sync.ts:183, 189, 351`.
`_getServerSeqKey()` hashes `${baseUrl}|${accessToken}` so different
users on the same server get separate sequence tracking; the cached
key is invalidated in `setPrivateCfg()` (L91 reset), pinned as an
invariant in the package class JSDoc.

Port shape (consensus pick — narrow, not generic):

```ts
// packages/sync-providers/src/super-sync/storage.ts
export interface SuperSyncStorage {
  /** Returns null if the key is unset. */
  getLastServerSeq(key: string): number | null;
  setLastServerSeq(key: string, value: number): void;
  removeLastServerSeq(key: string): void;
}
```

Methods sync because `localStorage` is sync. Three methods, no
leakage of the storage backend. Package owns the prefix constant
(`super_sync_last_server_seq_`) and the int conversion.

App wiring:

```ts
// In createSuperSyncProvider, before constructing the package class:
const APP_SUPER_SYNC_STORAGE: SuperSyncStorage = {
  getLastServerSeq: (key) => {
    const v = localStorage.getItem(key);
    return v == null ? null : Number.parseInt(v, 10);
  },
  setLastServerSeq: (key, value) => localStorage.setItem(key, String(value)),
  removeLastServerSeq: (key) => localStorage.removeItem(key),
};
```

---

## Promote `isRetryableUploadError` (renamed)

Two implementations exist today:

- **App-side broad-pattern version** at
  `src/app/op-log/sync/sync-error-utils.ts:96` — regex-pattern matching
  on lowercased message string. Looks for `failed to fetch`,
  `network error`, `timeout`, `econnrefused`, HTTP 500/502/503/504,
  server phrases ("transaction rolled back"). Two consumers:
  `super-sync.ts:28` (moving) and
  `operation-log-upload.service.ts:31, 166` (app-side, not moving).
- **Package version** at
  `packages/sync-providers/src/http/native-http-retry.ts:136` —
  native-error-code-aware. Different semantic surface; designed for
  the native retry helper.

Consensus promotes the broad-pattern version into the package as
**`isRetryableUploadError(error: string | Error | undefined)`**
(intent-anchored name to avoid colliding with `isTransientNetworkError`
already in the barrel). App `sync-error-utils.ts:96` re-exports it
aliased to the current name so `operation-log-upload.service.ts`
keeps importing unchanged. SuperSync (in the package) imports
`isRetryableUploadError` directly. Package barrel exports both
distinct helpers.

---

## Compression — direct `@sp/sync-core` import

`super-sync.ts:22-25` currently imports `compressWithGzip` /
`compressWithGzipToString` from the app-side shim at
`encryption/compression-handler.ts`, which wraps thrown errors in
`CompressError`. Grep across `src/` confirms no consumer catches
`CompressError` from SuperSync's call paths — the compression result
bubbles up through `_fetchApiCompressed` / `_fetchApiCompressedNative`
generic `catch (error)` clauses. The package version imports the
helpers directly from `@sp/sync-core` and passes `deps.logger`
through the `{ logger?: SyncLogger }` option. Generic `Error`
propagation is observationally equivalent. App-side
`compression-handler.ts` shim stays in place for
`EncryptAndCompressHandlerService` (other consumer).

---

## Provider ID constants

Add to the package alongside `PROVIDER_ID_DROPBOX` / `PROVIDER_ID_WEBDAV`:

```ts
export const PROVIDER_ID_SUPER_SYNC = 'SuperSync' as const;
```

Replace `SyncProviderId.SuperSync` reads inside the package with this
constant. App-side `super-sync.ts` factory shim uses the same type-
level `AssertSuperSyncId` conditional pattern as Dropbox:

```ts
type AssertSuperSyncId = SyncProviderId.SuperSync extends typeof PROVIDER_ID_SUPER_SYNC
  ? true
  : never;
```

so renames or drift fails at compile time without `as unknown as`
double-casts at runtime.

---

## Privacy sweep checklist

The substantive blocker list lives in § "New blockers surfaced (must
fix in slice)" inside the multi-review consensus block at the top of
this doc. Summary of what to apply during PR 7b:

- **A1 fix (`_doWebFetch:582` and `_doNativeFetch:646-648`).** Replace
  the response-body-in-`Error.message` with the extracted-reason form:
  call `_extractServerErrorReason(body)` (already exists), cap at 80
  chars, thread through. Web form: `HTTP <status> <statusText> — <reason?>`;
  native form: `HTTP <status> — <reason?>` (`CapacitorHttp` doesn't
  surface `statusText`).
- **`AuthFailSPError(reason, body)` body drop.** Drop the `body` arg
  at `super-sync.ts:413`; the package-side class retains it on
  `additionalLog`.
- **Native-rethrow scrub** at `super-sync.ts:478-481`. Drop the
  parenthesised `(${errorMessage})` from the user-facing message.
- **Timeout `Error.message` path drop** at `super-sync.ts:620`.
- **`_extractServerErrorReason` length cap** at L424-432: 80 chars,
  document the fixed-vocabulary server contract.
- **JSDoc invariants** on `getEncryptKey`, `getWebSocketParams`,
  `_cachedServerSeqKey`, `deleteAllData` response shape.
- **B3.5 — gzip diagnostic logging.** `super-sync.ts:259-263` logs
  first 10 bytes of compressed output (gzip header `1f 8b 08 ...`).
  Invariant; pin as documented diagnostic boundary so future changes
  don't widen it.
- **Spec privacy-regression test.** One Vitest spec drives an HTTP-
  error path with a body of
  `'{"taskId":"abc","title":"secret task title"}'` and asserts the
  captured `SyncLogger` mock's meta and the thrown `Error.message`
  contain neither string.

---

## Spec migration scope

`super-sync.spec.ts` is 1553 lines, ~2× `dropbox-api.spec.ts` and
~3× `webdav-api.spec.ts`. The WebDAV slice's consensus decision was
to keep monolithic, with the reasoning that "splitting during
Jasmine→Vitest migration conflates two changes and balloons review
diff."

Top-level `describe` blocks (per `grep -n 'describe('`):

**Keep monolithic for the move, defer split to a follow-up commit.**
Mirrors WebDAV slice precedent. The Jasmine→Vitest conversion
(`jasmine.SpyObj` → `vi.Mocked`, `spyOn(...).and.returnValue` →
`vi.spyOn(...).mockReturnValue`) is itself a high-risk one-to-one
port; splitting concurrently obscures conversion mistakes. Future
split commit (`super-sync-core.spec.ts` / `super-sync-ops.spec.ts` /
`super-sync-fetch.spec.ts`) reads cleanly against an already-green
monolithic Vitest file.

`super-sync.spec.ts:1202-1303` currently uses a
`TestableSuperSyncProvider` subclass override to swap the
`isNativePlatform` getter. Under Vitest with injected
`platformInfo` + `nativeHttpExecutor` mocks, this subclass goes
away (mirrors Dropbox slice un-skip).

---

## Suggested commit shape

Following the Dropbox 5a/5b and WebDAV 6a/6b precedent: helper
promotion first, then the bulk move.

1. **`refactor(sync-providers): promote isRetryableUploadError helper`**
   (PR 7a). Move the broad-pattern `isTransientNetworkError` from
   `src/app/op-log/sync/sync-error-utils.ts:96` into
   `packages/sync-providers/src/http/retryable-upload-error.ts`
   under the intent-anchored name `isRetryableUploadError` (avoids
   colliding with the package's existing native-code-aware
   `isTransientNetworkError`). Re-export from the package barrel
   as a distinct symbol. App `sync-error-utils.ts` becomes a
   re-export shim aliased to the current name for
   `operation-log-upload.service.ts`. No behavior change.
2. **`refactor(sync-providers): move SuperSync provider into package`**
   (PR 7b). The bulk move. `super-sync.ts`, `super-sync.model.ts`,
   and `super-sync.spec.ts` move into
   `packages/sync-providers/src/super-sync/`. Convert spec to
   Vitest. Add `PROVIDER_ID_SUPER_SYNC` constant +
   `AssertSuperSyncId` shim. Add narrow `SuperSyncStorage` port +
   `SuperSyncResponseValidators` port. Switch compression to direct
   `@sp/sync-core` import. Apply the four privacy fixes inline
   (AuthFailSPError body drop, native-rethrow scrub, timeout path
   drop, extracted-reason cap at 80 chars). Add the JSDoc
   invariants. Add the spec privacy-regression test. App-side
   `super-sync.ts` shrinks to `createSuperSyncProvider()` (no
   `extraPath`) wiring `OP_LOG_SYNC_LOGGER`,
   `APP_PROVIDER_PLATFORM_INFO`, `APP_WEB_FETCH`,
   `SyncCredentialStore`, `CapacitorHttp.request`,
   `APP_SUPER_SYNC_STORAGE`, and the app's `response-validators`
   module into `SuperSyncDeps`. Factory return type explicitly
   `SuperSyncProvider & OperationSyncCapable<'superSyncOps'> &
RestoreCapable<RestorePointType>` so existing consumers
   (`snapshot-upload.service.ts:77-95`,
   `super-sync-restore.service.ts:118`) keep type-checking. Delete
   `TestableSuperSyncProvider` subclass from the spec.

Each commit ships independently green: package tests + lint after
each.

---

## Open questions for multi-review

All resolved in § "Multi-review consensus" above.

---

## Verification gates

Before merging:

- `npm run sync-providers:test` — package specs green (performance
  reviewer projects ~+60-70 new Vitest specs after Jasmine port).
- `npm run sync-providers:build` — package builds. Performance
  estimate: CJS lands at ~95-100 KB (under the original 110 KB
  projection; SuperSync's private helpers minify well). Tiered
  barrel split stays a documented deferral.
- `npm run lint` — boundary lint clean.
- Targeted app specs:
  `super-sync-status.service.spec.ts`,
  `super-sync-websocket.service.spec.ts`,
  `super-sync-restore.service.spec.ts`,
  `supersync-encryption-toggle.service.spec.ts`,
  `response-validators.spec.ts`,
  `sync-wrapper.service.spec.ts`,
  `operation-log-upload.service.spec.ts` (verifies the helper
  re-export shim path),
  `encryption-password-change.service.spec.ts`,
  `op-log/testing/integration/service-logic.integration.spec.ts`
  (both flagged by the correctness reviewer as indirectly exercising
  SuperSync behavior).
- Full `npm test` (two timezone variants per the WebDAV slice
  protocol).
- Full E2E (Playwright + SuperSync docker-compose per
  `e2e/CLAUDE.md`).
- Manual SuperSync round-trip:
  - Snapshot upload (initial, recovery, migration reasons).
  - Op upload (compressed payload, native vs web path).
  - Op download (paginated, with `excludeClient`, with `limit`).
  - Restore points fetch.
  - `getStateAtSeq` snapshot restore.
  - Encryption toggle flow (when `isEncryptionEnabled`, `getEncryptKey`
    returns the key; when disabled, returns `undefined`).
  - Auth failure path (401/403 → `AuthFailSPError`).
  - Server URL switching (account migration invalidates cached
    `lastServerSeq` key — verify `_cachedServerSeqKey` reset on
    `setPrivateCfg`).
  - Native-platform path on Android via WebView (binary body
    corruption — verify base64 gzip path still works).
  - iOS native (CapacitorHttp `_fetchApiCompressedNative` path).
- WebSocket reconnection smoke test (out of scope this slice, but
  verify `getWebSocketParams` still returns the right
  `{ baseUrl, accessToken }` shape).

---

## Not in scope this slice

- LocalFile provider move (slice 8).
- WebSocket service move (`super-sync-websocket.service.ts` stays
  app-side — NgRx-coupled and not relevant to the provider boundary).
- Status service move (`super-sync-status.service.ts` stays
  app-side).
- Restore service move (`super-sync-restore.service.ts` stays
  app-side — UI orchestration).
- Encryption toggle service move
  (`supersync-encryption-toggle.service.ts` stays app-side).
- Per-package barrel split
  (`@sp/sync-providers/super-sync`, etc.) — deferred to PR 7
  polish.
- `md5HashPromise` consumer migration in
  `local-file-sync-base.ts:178` — LocalFile slice.
- Removal of the legacy `SyncProviderId.SuperSync` enum value —
  app keeps the enum for OAuth routing and config-UI dispatch; the
  package adds the string constant alongside.
- `compression-handler.ts`'s app-side shim (still wraps
  `EncryptAndCompressHandlerService`; only SuperSync's call site
  moves to direct `@sp/sync-core` import).
- The performance reviewer's `getElementsByTagNameNS('*', name)`
  one-pass-childNodes-scan suggestion from the WebDAV slice —
  unrelated to SuperSync; tracked for a separate perf pass.

---

## Risks for the slice

- **Spec migration scope.** 1553 lines of Jasmine → Vitest is the
  largest single conversion in this PR series. Mitigations:
  spec-by-spec one-to-one porting, run package tests after each
  `describe`-block conversion, no semantic changes during conversion.
- **Native compressed-body path.** Three CapacitorHttp call sites
  (`super-sync.ts:127, 229, 533`) route through
  `executeNativeRequestWithRetry` to dodge Android WebView's binary-
  body corruption and iOS WebKit's response-body bugs.
  `NativeHttpExecutor`'s `data: string` argument is the base64-gzip
  payload; verify the response shape (Capacitor returns
  base64-encoded binary on some platforms; the validators expect
  JSON-decoded objects) is correctly decoded by the port adapter.
- **WebSocket integration boundary.** `SuperSyncWebSocketService` is
  app-side and reads `getWebSocketParams()`. Currently the method
  returns plain `{ baseUrl, accessToken } | null` (no
  `SuperSyncProvider`-typed leakage) — pin as JSDoc invariant per
  the consensus block. WebSocket service stays app-side until
  slice 8 polish, if then.
