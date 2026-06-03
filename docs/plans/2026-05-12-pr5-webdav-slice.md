# PR 5 — WebDAV + Nextcloud Slice (design doc)

> For Claude executing this: this is a **design doc for multi-review**, not a
> step-by-step implementation plan. Once the design choices below are
> ratified, rewrite as a TDD plan or execute in commits per the "Suggested
> commit shape" section.

**Goal.** Move the WebDAV + Nextcloud providers
(`webdav-base-provider.ts` + `webdav-api.ts` + `webdav-xml-parser.ts` +
`webdav-http-adapter.ts` + `webdav.ts` + `nextcloud.ts` + their
constants/models/specs) into `@sp/sync-providers`, behind the ports
introduced for Dropbox plus one new port for the Capacitor-registered
WebDAV HTTP plugin. Leave thin app-side factory shims so
`sync-providers.factory.ts` keeps working unchanged.

**Status.** PR 5 has shipped slices 1-5 (scaffold, envelope types,
PKCE, native HTTP retry, error classes + Dropbox proper). This is
slice 6 in commit terms / "next slice" per the remaining-slice plan.
See `docs/long-term-plans/sync-core-extraction-plan.md` § "Remaining
Slice Plan" item 1 for surrounding context.

---

## Multi-review consensus (2026-05-12)

Four Claude reviewers (security/privacy, architecture, alternatives,
simplicity) ran in parallel against the original design. Codex and
Copilot were attempted but failed for environment reasons (Codex
blocked by harness sandbox, Copilot blocked by auto-mode classifier on
`--deny-tool` flags). Gemini eventually completed after a workspace-
sandbox retry and quota throttling; its report broadly agrees with the
Claude consensus on every decision below, with two dissents noted in
the "Gemini dissent" subsection at the end.

### Gemini dissent (not adopted)

- **Open question 1.** Gemini recommended **keeping** the dedicated
  `WebDavNativeHttpExecutor` port "for naming consistency" with
  `NativeHttpExecutor`. Rejected: the architecture and simplicity
  reviewers verified by code reading that the existing port already
  supports the WebDAV use case end-to-end (arbitrary `method` strings,
  `responseType: 'text'`, `maxRetries: 0`). Naming consistency is a
  weak argument against actual port duplication.
- **Open question 6.** Gemini recommended adding a **2-attempt /
  1s+2s retry policy with explicit `423 Locked` handling**. Rejected:
  alternatives and simplicity reviewers both flagged this as a
  behavior change in a move slice. The current adapter has zero
  retries today; preserving that until empirically motivated keeps the
  slice scope a refactor. Under open-question-1's port-reuse decision,
  per-call-site `maxRetries` is trivially available later if needed.

### Decisions revised after review

- **Open question 1 (`WebDavNativeHttpExecutor` port) — DROP the new
  port. Reuse `NativeHttpExecutor`.** Two of three reviewers
  (architecture, simplicity) verified the existing port already
  supports the WebDAV use case: `NativeHttpRequestConfig` accepts
  `method: string` (so `PROPFIND` / `MKCOL` / `MOVE` work), already
  has `responseType?: 'text' | 'json'` (so XML stays raw), and
  `executeNativeRequestWithRetry` exposes `maxRetries?: number` with
  explicit `0` support. The auto-JSON-parse "concern" is a property
  of `CapacitorHttp.request`, not of the port — the port is just
  `(config) => Promise<NativeHttpResponse>`. The app injects a
  different **adapter** (wired to `WebDavHttp` Capacitor plugin
  instead of `CapacitorHttp`) of the **same** port. The alternatives
  reviewer dissented (preferred a separate port to keep `data: string`
  strictly typed), but the architecture argument that the response
  contract `data: unknown` already covers strings, plus the YAGNI
  argument, wins. Commit 2 collapses to "wire app-side
  `APP_WEBDAV_NATIVE_HTTP: NativeHttpExecutor` factory" — no new
  type, just a new adapter wiring.

- **Open question 4 (inline `registerPlugin` cleanup) — DROP in this
  slice.** Architecture reviewer verified a real correctness point:
  `webdav-http-adapter.ts:31` registers `WebDavHttp` inline **without
  a `web:` fallback**, while `capacitor-webdav-http/index.ts:4-6`
  registers it **with** the `web: () => import('./web')` fallback.
  Capacitor's `registerPlugin` is idempotent by name, so both work
  today, but the canonical registration with the web fallback is the
  one to keep. Dropping the inline registration is part of moving
  the adapter into the package anyway. Resolved, not deferred.

- **Open question 5 (CORS heuristic) — TIGHTEN in this slice.** Two
  reviewers (security, simplicity) flag the existing heuristic at
  `webdav-http-adapter.ts:180-219` as both leaking a raw error to
  logs at line 208-211 (privacy regression — Firefox's "NetworkError
  when attempting to fetch resource at `<url>`" leaks the full URL)
  and being overly broad ("Failed to fetch" matches every offline
  state, not just CORS). Combined approach: collapse the heuristic
  to a ~3-line check (`error instanceof TypeError &&
error.message.includes('cors')`), and replace the ambiguous-error
  log with structured `toSyncLogError(error)` plus
  `urlPathOnly(options.url)` meta. Net result: ~40 lines deleted,
  one privacy leak closed.

- **Open question 6 (retry policy) — PRESERVE no-retry behavior.**
  Three reviewers agreed: adding retries is a behavior change
  masquerading as a refactor. WebDAV has stateful methods
  (LOCK/UNLOCK) and conditional writes (412 Precondition Failed)
  where retry semantics differ from Dropbox's idempotent file API.
  Under the open-question-1 decision (reuse `NativeHttpExecutor`),
  this becomes trivially a per-call-site `maxRetries: 0` argument —
  the port doesn't decide.

- **Open question 8 (spec split) — KEEP MONOLITHIC.** Dropbox
  precedent: `dropbox-api.spec.ts` (~876 lines) was moved as one
  file. Splitting during a Jasmine→Vitest migration conflates two
  changes and balloons review diff. File-split is a follow-up if it
  ever hurts maintenance.

- **Commit shape — match Dropbox 5a/5b split.** Ship the helper
  promotion (`errorMeta` / `urlPathOnly` → `packages/sync-providers/src/log/`)
  as its own PR **6a** before the bulk move. Alternatives reviewer
  noted this mirrors the Dropbox split, gets an independent green
  build, and unblocks SuperSync slice prep. Bulk move becomes
  PR **6b**: app-side `NativeHttpExecutor` adapter wiring +
  WebDAV/Nextcloud file move + privacy sweep + Nextcloud generic
  widening + `md5HashSync` migration, in one commit. Optionally
  split 6b into "adapter wiring" + "file move" if the diff is still
  unwieldy.

- **Factory shim signature — `createWebdavProvider(extraPath?: string)`,
  not `createWebdavProvider(deps)`.** Architecture reviewer caught
  that the Dropbox precedent at
  `src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts:31-43`
  has the factory **compose `deps` internally** from app singletons
  (`APP_PROVIDER_PLATFORM_INFO`, `APP_WEB_FETCH`, `OP_LOG_SYNC_LOGGER`,
  `SyncCredentialStore`). External callers pass app-level config
  (e.g., `extraPath`), not the internal deps bag. WebDAV/Nextcloud
  factories follow the same shape — `createWebdavProvider(extraPath?: string)`
  matches `WebdavBaseProvider(_extraPath?: string)`.

### Decisions affirmed

- **Open question 2 (`md5HashSync` → `hash-wasm` async).** All three
  reviewers that addressed it preferred option 1. Light recommendation
  from alternatives: include a one-line benchmark in the PR
  description (2 MB sync file) to confirm hash-wasm's WASM init cost
  doesn't dominate; fall back to keeping `spark-md5` only if
  empirically slower. The async ripple touches ~5 spec call sites
  and `_computeContentHash` in `webdav-api.ts:27-29` becomes `async`.

- **Open question 3 (Nextcloud generic — widen to union).** All three
  affirmed. Eliminates four `as unknown as` casts. Architecture
  reviewer flagged a future-cleanup observation: the generic is only
  used as a phantom type for `SyncCredentialStore<T>` keying, so a
  later slice could decouple the credential-store key from the
  private-cfg type entirely. Out of scope for this slice — note in
  the long-term plan only.

- **Open question 7 (test infrastructure — delete `TestableWebDavHttpAdapter`).**
  Mirrors the Dropbox slice un-skip pattern. Inject `platformInfo` +
  the native HTTP adapter (now `NativeHttpExecutor`) directly in
  specs; delete the subclass-override harness. Spec count delta TBD
  on execution.

### New blockers surfaced (must fix in slice)

The security reviewer identified privacy regression sites the original
privacy-sweep checklist undercounted:

- **URL/basePath leak via `_buildFullPath` results passed to error
  paths.** At least four call sites (`webdav-http-adapter.ts:118, 162,
173`, the catch-all log meta at `:117-121`) pass the full URL — must
  scrub via `urlPathOnly` (PR 6a helper) at every error-construction
  and log call site. Ordering note: PR 6a must land first so the
  helper exists.
- **PROPFIND response body fed into `HttpNotOkAPIError`** at
  `webdav-api.ts:66-71` and `webdav-http-adapter.ts:176`.
  Multistatus responses contain user filenames. The slice must
  audit `HttpNotOkAPIError`'s body retention and either drop the
  second-arg body or replace with a length-only summary.
- **`testConnection` returns raw `e.message`** at
  `webdav-api.ts:371-373`. Some runtimes embed the URL in the
  message. Strip via `toSyncLogError(e).message` or use a fixed
  user-facing string.
- **`_buildFullPath` throws generic `Error('Invalid path: ${path}')`**
  at `webdav-api.ts:483-485`. Replace with `InvalidDataSPError` and
  scrub the path.
- **A3 sweep undercount.** Privacy checklist enumerated only a few
  `SyncLog.error(..., e)` sites; actual count includes
  `webdav-api.ts:73, 111, 151, 261, 329, 372` plus
  `webdav-base-provider.ts:83, 109, 124, 130`. Replace each with
  `toSyncLogError(e)` + curated `SyncLogMeta`.
- **B3.4 (new): `FileMeta` never enters a log call site.** The
  PROPFIND parser returns `FileMeta` with `displayname` / `href`
  (user filenames). Add as an explicit invariant: any future logging
  of a parsed `FileMeta` is a privacy regression.
- **Package-boundary invariant.** Pin "response headers are not
  logged or attached to errors" as a documented package boundary so
  future provider work doesn't accidentally regress it.

### Simplicity-driven scope reductions

The simplicity reviewer's analysis aligns with the open-question
decisions above and suggests further trims to the doc itself:

- Once decisions are landed, the doc's "Open questions" section
  collapses — most have answers now. Keep the section as a
  decision-log instead of deferred questions.
- The `md5HashSync` section's option 2 (sync via injected port) is
  dropped now that option 1 is the consensus.
- The Nextcloud generic section's option 1 (keep casts) is dropped.
- Doc target after revision: ~250 lines, every paragraph either
  describes a move or records a decision.

The "deferred to a follow-up" item simplicity raised about
`errorMeta` / `urlPathOnly` premature promotion is **rejected**:
the bulk-move adopts them in webdav-api during the privacy sweep
(replacing the new raw-error log sites), so they have ≥2 consumers
by the time PR 6b lands. PR 6a stands.

### Action items going into PR 6a/6b

1. **PR 6a (shared log helpers).** Promote `errorMeta` and
   `urlPathOnly` from `dropbox-api.ts:88-104` into
   `packages/sync-providers/src/log/error-meta.ts`. Export from the
   package barrel. Update Dropbox imports. No behavior change.
2. **PR 6b (bulk move).** Single or two-commit (adapter wiring + file
   move). Reuse `NativeHttpExecutor`. Apply the expanded privacy
   sweep above. Widen Nextcloud generic. Migrate `md5HashSync` →
   `hash-wasm`. Drop the inline `registerPlugin`. Tighten the CORS
   heuristic. Convert specs to Vitest. Delete `TestableWebDavHttpAdapter`.

---

## What moves

### Source files

From `src/app/op-log/sync-providers/file-based/webdav/` →
`packages/sync-providers/src/file-based/webdav/`:

- `webdav-base-provider.ts` (175 lines) — abstract provider
- `webdav-api.ts` (545 lines) — file ops, hash-based conditional
  uploads, directory creation queue
- `webdav-xml-parser.ts` (211 lines) — PROPFIND multistatus parsing
- `webdav-http-adapter.ts` (220 lines) — platform-routed HTTP +
  status mapping. **The wrinkle for this slice.**
- `webdav.const.ts` (39 lines) — methods, headers, status codes
- `webdav.model.ts` (10 lines) — `WebdavPrivateCfg`
- `webdav.ts` (15 lines) — standard `Webdav` provider class
- `nextcloud.ts` (80 lines) — Nextcloud subclass + URL builder
- `nextcloud.model.ts` (8 lines) — `NextcloudPrivateCfg`
- All co-located `.spec.ts` files (Jasmine → Vitest)

### Stays app-side

- `src/app/op-log/sync-providers/file-based/webdav/capacitor-webdav-http/`
  — Capacitor plugin registration. The `registerPlugin<WebDavHttpPlugin>('WebDavHttp', { web: ... })`
  call must remain in the app because `@capacitor/core` is banned from
  the package.
- `src/app/op-log/sync-providers/sync-providers.factory.ts` — app
  composition, wires the new factories.
- Provider IDs (`SyncProviderId.WebDAV`, `SyncProviderId.Nextcloud`)
  in `provider.const.ts`. Package uses string constants.

---

## New port: `WebDavNativeHttpExecutor`

### Why a separate port from `NativeHttpExecutor`

WebDAV cannot reuse the existing `NativeHttpExecutor`
(`packages/sync-providers/src/http/native-http-retry.ts`) verbatim:

- `NativeHttpExecutor` is shaped around `CapacitorHttp.request`,
  which auto-parses JSON, mishandles XML responses on Android/Koofr
  (empty bodies), and breaks WebDAV semantics on iOS. The whole
  reason the `WebDavHttp` Capacitor plugin exists is to bypass
  `CapacitorHttp` for WebDAV.
- WebDAV methods include `PROPFIND`, `MKCOL`, `MOVE`, `COPY`,
  `LOCK`, `UNLOCK` (see `webdav.const.ts`). `NativeHttpExecutor`'s
  type signature doesn't constrain methods, so this isn't strictly
  a blocker — but a dedicated port makes the divergent transport
  explicit.
- The current adapter does not retry on its own. WebDAV servers
  return 423 Locked, 412 Precondition Failed, 207 Multi-Status —
  retry behavior is different from Dropbox's idempotent file API.
  Slice 4's `executeNativeRequestWithRetry` policy (2 attempts,
  1s/2s, transient network only) doesn't map cleanly.

### Proposed shape

```ts
// packages/sync-providers/src/http/webdav-native-http.ts
export interface WebDavNativeHttpRequest {
  readonly url: string;
  readonly method: string; // includes PROPFIND, MKCOL, etc.
  readonly headers?: Readonly<Record<string, string>>;
  readonly data?: string | null;
}

export interface WebDavNativeHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: string; // always string, never parsed
}

export type WebDavNativeHttpExecutor = (
  req: WebDavNativeHttpRequest,
) => Promise<WebDavNativeHttpResponse>;
```

Callable type (matching the `WebFetchFactory` precedent from slice 5)
rather than `interface { request(): ... }`. One method, no state, no
reason for a class.

### App-side wiring

In `src/app/op-log/sync-providers/file-based/webdav/capacitor-webdav-http/`,
add an `APP_WEBDAV_NATIVE_HTTP` factory that returns:

```ts
export const APP_WEBDAV_NATIVE_HTTP: WebDavNativeHttpExecutor = async (req) => {
  const r = await WebDavHttp.request({
    url: req.url,
    method: req.method,
    headers: req.headers,
    data: req.data,
  });
  return {
    status: r.status,
    headers: r.headers ?? {},
    data: r.data ?? '',
  };
};
```

The plugin's `web: () => import('./web').then(...)` fallback already
covers browsers; on Electron the same fallback works because
`Capacitor.isNativePlatform()` is `false`. The factory shim decides
whether to call the executor (`isNativePlatform`) or `fetch` directly,
mirroring the existing adapter behavior.

Package-side `WebDavHttpAdapter` becomes:

```ts
constructor(
  private readonly deps: {
    readonly platformInfo: ProviderPlatformInfo;
    readonly webFetch: WebFetchFactory;
    readonly nativeHttp: WebDavNativeHttpExecutor;
    readonly logger: SyncLogger;
  },
) {}
```

(Naming TBD — see open question 1 below.)

### Inline `registerPlugin` duplication

`webdav-http-adapter.ts` lines 13-31 currently registers `WebDavHttp`
inline, **and** `capacitor-webdav-http/index.ts` registers it again
with the same plugin name. Capacitor's `registerPlugin` is idempotent
by name, so this works today but is dead duplication. The slice
should drop the inline registration in the adapter and keep only the
subfolder's registration, which the app-side
`APP_WEBDAV_NATIVE_HTTP` factory will reference.

---

## Other moves

### `md5HashSync` → `hash-wasm`

`webdav-api.ts:14, 28` is the only non-spec consumer of
`md5HashSync` (`src/app/util/md5-hash.ts`, which wraps `spark-md5`).
`local-file-sync-base.ts:178` uses `md5HashPromise` — out of scope
this slice but track it for the LocalFile slice.

`hash-wasm` is already a package runtime dep (used by PKCE on
non-WebCrypto platforms — `packages/sync-providers/src/pkce.ts`).
It provides `md5(data)` returning a hex `Promise<string>`. Two
choices:

1. **Async hash in the package.** Switch
   `WebdavApi._computeContentHash` to `async` and adopt `hash-wasm`'s
   `md5`. All call sites already `await` the API; the change
   ripples through `getFileRev`, `uploadFile`, hash-based
   conditional upload. Pro: drops the `spark-md5` dep at the package
   boundary; aligns with the existing `hash-wasm` usage. Con: API
   shape change touches ~5 spec call sites.
2. **Sync hash via injected port.** Add an `Md5HashSync` port
   alongside the other deps; the app injects `spark-md5` wrapper,
   the package stays sync. Pro: minimal call-site churn. Con: yet
   another port, and `hash-wasm`'s `md5` is async-only.

**Recommendation: option 1.** Async ripples are mechanical, and
removing `spark-md5` from the package surface is worth it. (Open
question 2 — see below.)

### `errorMeta` / `urlPathOnly` promotion

Currently in
`packages/sync-providers/src/file-based/dropbox/dropbox-api.ts:88-104`.
Move to `packages/sync-providers/src/log/error-meta.ts` so WebDAV
can adopt them without copy-paste. This is the heads-up flagged at
the end of the Fifth Slice summary. Should land as **PR 6a** before
or alongside the WebDAV move.

### Provider ID constants

Add to the package alongside `PROVIDER_ID_DROPBOX`:

```ts
export const PROVIDER_ID_WEBDAV = 'WebDAV' as const;
export const PROVIDER_ID_NEXTCLOUD = 'Nextcloud' as const;
```

Replace `SyncProviderId.WebDAV` / `SyncProviderId.Nextcloud` reads
inside the package with these. The app composes
`SyncProviderId.WebDAV === PROVIDER_ID_WEBDAV` at type level via the
same `AssertWebdavId` / `AssertNextcloudId` conditional type pattern
used for Dropbox.

### Nextcloud's `as unknown as` casts

`nextcloud.ts:19, 25` and `nextcloud.ts:46, 77` use
`SyncProviderId.Nextcloud as unknown as SyncProviderId.WebDAV`
because `WebdavBaseProvider` is generic on `T extends
SyncProviderId.WebDAV`. After the move, the package's generic
parameter becomes `T extends typeof PROVIDER_ID_WEBDAV`, but
Nextcloud's id is `PROVIDER_ID_NEXTCLOUD`. The double-cast is
load-bearing for credential separation today.

Two options here:

1. **Keep the double-cast pattern in the package.** Direct port,
   preserves runtime behavior, but the package's strict tsconfig
   already bans `as unknown as` in two places — verify whether the
   lint rule passes.
2. **Widen the generic** to `T extends typeof PROVIDER_ID_WEBDAV |
typeof PROVIDER_ID_NEXTCLOUD` and drop the casts. Better typed,
   one extra union member. Probably the right call.

**Recommendation: option 2.** (Open question 3.)

---

## Privacy sweep checklist

Apply the same A1/A3/B3.x audit that ran during the Dropbox slice:

- **A1 — raw response bodies in logs.** Grep
  `SyncLog.(critical|error|warn|log).*r\.data\|response\.data` in
  webdav files. Replace with structured `toSyncLogError(e)` + curated
  `SyncLogMeta`.
- **A3 — `SyncLog.critical(..., e)` raw-error logs.** Every
  catch-site needs `toSyncLogError(e)` instead. Initial grep target:
  `webdav-api.ts`, `webdav-base-provider.ts`, `webdav-http-adapter.ts`.
- **B3.1 — bearer-token / `Authorization` header leaks.** Already
  fixed by PR 5a's `TooManyRequestsAPIError` narrowing. Re-verify the
  webdav-http-adapter catch path doesn't construct
  `HttpNotOkAPIError(response, body)` with anything containing the
  `Authorization` header. (Spot check: `_checkHttpStatus` passes
  `body` for the generic non-2xx case — confirm `body` never
  contains the request header echo.)
- **B3.2 — `basePath` leaked into error paths.** WebDAV's
  `_buildFullPath(cfg.baseUrl, dirPath)` is used as the URL **and**
  in error construction. Audit: any error class receiving the full
  URL should receive the relative `targetPath` (or
  host-scrubbed URL). `RemoteFileNotFoundAPIError(url)` at
  webdav-http-adapter.ts:162 is the prime suspect.
- **B3.3 — `responseData` carried in error fields.** Audit error
  constructors for raw response payload fields, mirroring the
  Dropbox `AuthFailSPError` fix.

Add the privacy sweep findings to the slice's PR description so the
multi-review has the same checklist material the Dropbox slice had.

---

## Suggested commit shape

Three commits:

1. **`refactor(sync-providers): promote shared log helpers`** —
   Move `errorMeta(e, extra)` and `urlPathOnly(url)` from
   `dropbox-api.ts` into `packages/sync-providers/src/log/error-meta.ts`.
   Re-export from the package barrel; update Dropbox imports. No
   behavior change.
2. **`refactor(sync-providers): add WebDavNativeHttpExecutor port`** —
   Introduce the port type in
   `packages/sync-providers/src/http/webdav-native-http.ts`. Add the
   app-side `APP_WEBDAV_NATIVE_HTTP` factory wired to the existing
   `capacitor-webdav-http/` plugin registration. No provider move
   yet; this commit exists in isolation so the port surface gets its
   own review focus.
3. **`refactor(sync-providers): move WebDAV provider into package`** —
   The bulk move. Files listed above. Convert specs to Vitest.
   Replace `SyncProviderId.WebDAV` / `.Nextcloud` with package
   constants. Switch `md5HashSync` to `hash-wasm`. Apply the
   privacy sweep findings inline. Replace the
   `WebdavBaseProvider`'s direct `WebDavHttpAdapter` instantiation
   with constructor-injected deps. App-side
   `webdav.ts` / `nextcloud.ts` shrink to
   `createWebdavProvider(deps)` / `createNextcloudProvider(deps)`
   factory functions called from `sync-providers.factory.ts`. Drop
   the inline `registerPlugin` from the moved adapter (the
   subfolder registration is canonical).

Each commit ships independently green: package tests + lint after
each. The third commit is the big one (~12 source files, ~5 spec
files, ~1500 LOC); split further if review feedback wants finer
bisects.

---

## Open questions for multi-review

1. **Port naming.** `WebDavNativeHttpExecutor` is consistent with
   `NativeHttpExecutor` but verbose. Alternatives:
   `WebDavHttpTransport`, `WebDavRequestExecutor`. Architecture
   reviewer to pick.
2. **`md5HashSync` strategy.** Async via `hash-wasm` (option 1
   above) vs sync via injected port (option 2). Performance
   reviewer to weigh in — hashing a 1-2 MB sync file ~10x per
   upload could matter.
3. **Nextcloud generic parameter.** Keep `as unknown as` casts or
   widen the package generic to a union. Simplicity reviewer to
   call.
4. **Inline `registerPlugin` cleanup.** Drop in this slice or defer
   to a follow-up. Alternatives reviewer to flag scope creep.
5. **CORS detection heuristic.** `webdav-http-adapter.ts:180-219`
   uses a string-match heuristic on `error.message`. The
   "ambiguous network error" log path also leaks the raw error.
   Should the slice tighten this (use structured meta only) or
   defer? Security reviewer to flag.
6. **`WebDavHttpAdapter` retry policy.** Currently no retries.
   Should the slice add the same 2-attempt / 1s+2s policy that
   Dropbox uses, or preserve "no retry" behavior? Performance +
   alternatives reviewers to call.
7. **Test infrastructure for native-routed specs.** Dropbox slice
   un-skipped 33 native specs under Vitest using the injected
   executor mock. WebDAV's specs currently use a `TestableWebDavHttpAdapter`
   subclass override pattern (similar to Dropbox pre-slice 5).
   Plan to delete that and inject `platformInfo` + `nativeHttp`
   mocks instead — confirm spec count delta.
8. **Spec migration scope.** `webdav-api.spec.ts` is 853 lines.
   Worth splitting into a few smaller files during the move, or
   keep monolithic to minimize review diff? Simplicity reviewer.

---

## Verification gates

Before merging:

- `npm run sync-providers:test` — package specs green
- `npm run sync-providers:build` — package builds, expect bundle
  growth (~+15-20 KB ESM)
- `npm run lint` — boundary lint clean
- Targeted app specs: `webdav-base-provider.spec.ts`,
  `webdav-api.spec.ts`, `webdav-http-adapter.spec.ts`,
  `webdav-xml-parser.spec.ts`, `sync-wrapper.spec.ts`,
  `file-based-sync-adapter.spec.ts`, identity spec
- Full `npm test`
- Full E2E
- Manual round-trip: WebDAV against a real Nextcloud, hash-based
  conditional upload (PUT with `If-Match` rev), 412 conflict path,
  401 reauth path, 404 fresh-client bootstrap

---

## Not in scope this slice

- SuperSync provider move (slice 7)
- LocalFile provider move (slice 8)
- `md5HashPromise` consumer migration in
  `local-file-sync-base.ts` — out of scope until LocalFile slice
- Per-package barrel split
  (`@sp/sync-providers/dropbox`, `/webdav`, ...) — deferred to
  PR 7 polish; the single barrel is still fine bundle-size-wise
- Removal of the legacy `SyncProviderId.WebDAV` /
  `.Nextcloud` enum values — app keeps the enum for OAuth routing
  and config-UI dispatch; the package only adds the string
  constants alongside
