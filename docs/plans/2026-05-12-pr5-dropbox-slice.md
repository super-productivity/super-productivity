# PR 5 — Dropbox Provider Slice (design doc)

> For Claude executing this: this is a **design doc for multi-review**, not a
> step-by-step implementation plan. Once the design choices below are
> ratified, rewrite as a TDD plan or execute in commits per the
> "Suggested commit shape" section.

**Goal.** Move the Dropbox provider (`dropbox.ts` + `dropbox-api.ts` +
specs) plus its supporting error classes and platform utilities into
`@sp/sync-providers`, behind a small set of new package ports. Leave a
thin app-side shim so `sync-providers.factory.ts` keeps working
unchanged.

**Status.** First four slices of PR 5 have shipped (scaffold, envelope
types, PKCE, native HTTP retry). This is the fifth slice and the
largest by line count and dependency surface. See
`docs/long-term-plans/sync-core-extraction-plan.md` § "Remaining Slice
Plan" item 1 for surrounding context.

---

## Multi-review consensus (2026-05-12)

Six Claude reviewers (correctness, security, architecture, alternatives,
performance, simplicity) ran in parallel against the original design.
Codex CLI was attempted but failed under the read-only sandbox; results
below reflect Claude-only consensus.

### Decisions revised after review

- **Decision 7 (shim form).** Replace `class Dropbox extends
PackageDropbox` with a **factory function** `createDropboxProvider(cfg)`
  invoked from `sync-providers.factory.ts` directly. Two reviewers
  (Alternatives §5, Simplicity W2) strongly recommended this; one
  (Architecture C2) flagged a real type-mismatch defect in the
  `extends` form (`id: typeof PROVIDER_ID_DROPBOX` vs
  `SyncProviderId.Dropbox`). The factory form removes the shim class
  entirely, drops two layers of `as unknown as` casts, and the
  `wrappedProvider` precedent already in the codebase uses composition.
  See revised Decision 7 below.

- **Decision 3 (`WebFetchProvider`).** Replace the interface with a
  callable factory type:

  ```ts
  export type WebFetchFactory = () => typeof fetch;
  ```

  Strong consensus (Architecture, Alternatives W2, Simplicity C1).
  Same lazy-resolution semantics, half the surface, no
  implementation class needed.

- **Decision 3 (`ProviderPlatformInfo`).** Expose three booleans rather
  than collapsing to one. Architecture reviewer flagged that future
  providers (WebDAV native plugin, LocalFile SAF) need to distinguish
  "Capacitor native" from "Android WebView shim." Final shape:

  ```ts
  export interface ProviderPlatformInfo {
    readonly isNativePlatform: boolean; // capacitor || androidWebView
    readonly isAndroidWebView: boolean;
    readonly isIosNative: boolean;
  }
  ```

- **Decision 4 (`DropboxFileMetadata`).** **Move, not duplicate.**
  Grep confirmed only one consumer (`dropbox-api.ts:5`). The
  Simplicity reviewer's audit (W1) verified `imex/sync/dropbox/dropbox.model.ts`
  has no other importers. Delete it after the move.

- **Decision 6 (`getTokensFromAuthCode` no-retry).** Add
  `maxRetries?: number` to `ExecuteNativeRequestOptions` and call the
  retry helper with `maxRetries: 0` from `getTokensFromAuthCode`.
  Removes the two-path asymmetry (Alternatives §4). One-line change
  in `packages/sync-providers/src/http/native-http-retry.ts`.

- **Decision 6 (timeouts).** Explicit preservation of both
  `NATIVE_REQUEST_READ_TIMEOUT = 120s` (data calls) and
  `NATIVE_AUTH_READ_TIMEOUT = 30s` (token refresh + auth-code exchange).
  Correctness reviewer W1 caught that the design's example snippet
  omitted `readTimeout` and would silently quadruple auth timeouts.

- **Decision 8 (spec migration).** Three additions:
  1. `TestableDropboxApi` subclass-override pattern (lines 16-29)
     **no longer applies** after isNativePlatform moves into injected
     `deps.platformInfo`. Specs pass a different `platformInfo` per
     test instead.
  2. The "isNativePlatform getter" tests at lines 615-635 test the
     getter's existence and should be **deleted**, not migrated.
     The field is just injected data; testing its presence is
     meaningless.
  3. Inject `delay: vi.fn().mockResolvedValue(undefined)` into
     `executeNativeRequestWithRetry` test calls — otherwise the
     un-skipped retry tests add up to 36 s of real wall-clock time
     (Performance S5).

- **Decision 8 (PKCE poison-cache test).** The Vitest `Object.defineProperty`
  on `globalThis.crypto.subtle` is environment-dependent. Verify in
  Vitest's `happy-dom` env; if it fails, the package's existing
  `generatePKCECodes` already accepts a `crypto` parameter (per
  `packages/sync-providers/src/pkce.ts` exports — confirm), and the
  spec should inject a throwing mock instead.

- **Suggested commit shape — ship errors as a separate PR.**
  Strong consensus (Alternatives §7) and reasoning the doc accepts:
  the error-class move is the highest-`instanceof`-blast-radius
  change, independently valuable to every remaining slice (WebDAV,
  SuperSync, LocalFile), and bisects cleanly. **Revised plan: PR 5a
  ships errors only; PR 5b ships Dropbox proper.** Slices 2/3/4 of
  the larger PR-5 plan can land in any order after 5a, in parallel
  if reviewers permit.

### Decisions affirmed

- **Decision 1 (Option A for `AdditionalLogErrorBase`).** Five
  reviewers affirmed; one (Security W1) preferred Option B. The
  Security argument — that catch-site logging is already imperfect, so
  the centralized log was load-bearing — is mitigated by the new
  audit-and-fix work in Decision 5 below. Going with **Option A** but
  pairing it with a comprehensive privacy-test sweep around moved
  errors AND fixing the existing call-site leaks now (rather than
  preserving them under Option B's safety net).

- **Decision 5 (`DropboxDeps` 5 fields).** Affirmed. Passing the
  whole deps object to `DropboxApi` is fine; it's an internal class.
  Architecture W1 suggested a narrower `DropboxApiDeps` interface —
  marginal benefit, deferred.

### New action items from the review

- **A1. Pre-existing privacy bug at `dropbox.ts:156`** — Security C1
  caught `SyncLog.critical('Dropbox.downloadFile() data', r.data)`,
  which logs the entire downloaded user sync blob when it's not a
  string. **Fix in the Dropbox-impl PR.** Replace with
  `logger.critical('Dropbox.downloadFile got non-string data', { dataType: typeof r.data })`.

- **A2. `HttpNotOkAPIError.message` includes response body excerpt**
  (Security C2). The body excerpt (up to 300 chars) is appended to
  `.message`, which then flows through every `SyncLog.critical(..., e)`
  catch site. The body excerpt is XML/HTML/JSON error content from the
  remote — usually safe, but on corporate proxy interception can
  contain reflected request data. **Mitigation in the errors PR:**
  keep the extracted body excerpt on a separate `.detail` field; cap
  `.message` to `HTTP <status> <statusText>`. Callers opt in to the
  detail.

- **A3. Expanded logger audit list** (Correctness W3, Security C1).
  Add to Decision 5 the following Dropbox call sites that log a raw
  error or user-identifying path:
  - `dropbox-api.ts:163` — `getMetaData() error for path: ${path}`
  - `dropbox-api.ts:259` — `upload() error for path: ${path}`
  - `dropbox-api.ts:278` — `remove() error for path: ${path}`
  - `dropbox-api.ts:301` — `checkUser() error` + raw `e`
  - `dropbox-api.ts:506` — `getTokensFromAuthCode() error` + raw `e`
    (CRITICAL: `e` may contain the auth code or verifier on
    error-handler rejection)
  - `dropbox-api.ts:603` — `_requestNative() error for ${url}` + raw `e`
  - `dropbox-api.ts:729` — `_request() error for ${url}` + raw `e`

  Plus the basePath leak: `this._getPath(targetPath) = basePath + targetPath`
  is logged whenever an error includes `path`. `basePath` is user-set
  (e.g. `/Apps/super-productivity/<device-id>`). Log only the relative
  `targetPath`, not the joined path. Per-site scrub during the
  Dropbox-impl PR.

- **A4. `tryCatchInlineAsync` masks real failures.** Security W4
  flagged that `dropbox-api.ts:251` returns the raw `Response` on
  parse failure, which then falls through to `!result.rev` → throws
  `NoRevAPIError`. The 429-comment may be stale (rate-limit is handled
  upstream in `_handleErrorResponse` before this line, since the
  `!response.ok` branch returns first). **Replace `tryCatchInlineAsync(()
=> response.json(), response)` with a defensive `response.json().catch(() => ({} as DropboxFileMetadata))`**
  pattern, or delete the wrapper if the 429 comment is confirmed stale.
  This is a quality fix shipped alongside the move.

- **A5. `instanceof` validation under dual ESM/CJS build.** Architecture
  C1 flagged that `tsup` emits both `.mjs` and `.js`; Angular's webpack
  could load two copies. App-side actually consumes the package via
  tsconfig path alias (Correctness C1 — to `packages/sync-providers/src/index.ts`
  directly), so the runtime risk is small. Mitigations:
  1. Add `"sideEffects": false` to `packages/sync-providers/package.json`
     to unlock tree-shaking through the barrel (Performance W2).
  2. Vitest specs in `packages/sync-providers/tests/` must import from
     `../src` (relative), not `@sp/sync-providers` (Correctness C1).
  3. Add a one-shot integration spec in the errors PR that imports
     the same error class from both `@sp/sync-providers` and
     `src/app/op-log/core/errors/sync-errors` and asserts `===` on
     the constructors.

- **A6. Add `_check` type assertion** to bind `PROVIDER_ID_DROPBOX`
  to `SyncProviderId.Dropbox` (Architecture S2):
  ```ts
  // in the shim, after the import
  const _idCheck: SyncProviderId.Dropbox = PROVIDER_ID_DROPBOX;
  ```
  Zero runtime cost; breaks the build if either side drifts.

### Open question resolutions

1. ✅ Option A. Pair with privacy test sweep (per A1–A3).
2. ✅ Move-not-duplicate (Decision 4 revised).
3. ✅ Split into three booleans (Decision 3 revised).
4. ✅ Audit list expanded per A3; also scrub `requestUrl` always
   (host + path only).
5. ✅ Pass full `DropboxDeps` to `DropboxApi`; narrower interface
   deferred.
6. ✅ One-line comment at the call site; no type-level signal.

### Reviewer disagreement (note for execution)

- Security wanted Option B for `AdditionalLogErrorBase`. Going Option
  A but with strong mitigations (A1–A3 fix the actual leaks Security
  cared about). If the privacy test sweep in PR 5a uncovers a
  catch-site leak that doesn't have an obvious fix, fall back to
  Option B in that PR.

## Round 2 review (2026-05-12) — additional findings

Round 2 (three focused reviewers: correctness + security + simplicity)
validated most of round 1's revisions. Four blockers surfaced; all
addressed below before PR 5a starts.

### B1 — Decision 7 body is stale (Correctness reviewer)

The consensus header announces the factory-function form, but the
Decision 7 body section further down in the doc still shows
`class Dropbox extends PackageDropbox`. An implementer following the
body would re-introduce the type defect round 1 flagged.

**Resolution (locks Decision 7):** the shim file at
`src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts` exports
a factory function, not a subclass:

```ts
import {
  Dropbox as PackageDropbox,
  type DropboxCfg,
  type DropboxDeps,
  type NativeHttpResponse,
  PROVIDER_ID_DROPBOX,
} from '@sp/sync-providers';
import { CapacitorHttp } from '@capacitor/core';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';

// Type-level bridge — fails to compile if the package's string-const
// drifts from the app's enum.
const _idCheck: SyncProviderId.Dropbox = PROVIDER_ID_DROPBOX;
void _idCheck;

export type { DropboxCfg, DropboxPrivateCfg } from '@sp/sync-providers';

export const createDropboxProvider = (cfg: DropboxCfg): PackageDropbox => {
  const deps: DropboxDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.Dropbox,
    ) as unknown as DropboxDeps['credentialStore'],
    nativeHttpExecutor: (cfg) =>
      CapacitorHttp.request(cfg) as unknown as Promise<NativeHttpResponse>,
  };
  return new PackageDropbox(cfg, deps);
};
```

Factory.ts changes:

```ts
const [{ createDropboxProvider }, ...] = await Promise.all([
  import('./file-based/dropbox/dropbox'),
  // …
]);
const providers: SyncProviderBase<SyncProviderId>[] = [
  createDropboxProvider({
    appKey: DROPBOX_APP_KEY,
    basePath: environment.production ? `/` : `/DEV/`,
  }) as SyncProviderBase<SyncProviderId>,
  // …
];
```

Casts: the `credentialStore` cast remains because the package's port
is generic over `<PID extends string, T>` while the app's
`SyncCredentialStore` is generic over the enum. The outer
`as SyncProviderBase<SyncProviderId>` cast already exists at
`sync-providers.factory.ts:47`. **The doc oversold "drops casts" in
round 1; the win is "drops the shim class," which is still net
positive.**

The body section "Decision 7 — App-side shim layout" further down has
been superseded by this resolution; treat the round-1 sketch as
historical context only.

### B2 — A2 (HttpNotOkAPIError.message) has a downstream UX impact

`src/app/util/get-error-text.ts:25` reads `e.message` to feed toasts
and the global error handler. Stripping the body excerpt off `.message`
shortens user-visible error text from `HTTP 503 Service Unavailable -
<server-error-detail>` to `HTTP 503 Service Unavailable`.

**Resolution:** keep `.message` brief (`HTTP <status> <statusText>`),
store the body excerpt on a new `.detail?: string` field, and **update
`getErrorTxt`** in the same PR (5a) to append `.detail` after
`.message` when present:

```ts
// add to getErrorTxt before the existing message branch
if (typeof errAny.message === 'string' && errAny.message) {
  const detail = typeof errAny.detail === 'string' ? errAny.detail : null;
  return detail ? `${errAny.message} - ${detail}` : errAny.message;
}
```

End-user UX is preserved; only internal log paths that use the
`SyncLogger` (privacy-aware) see the leaner `.message`.

### B3 — Security found three additional leak paths

Critical (must fix in PR 5a / PR 5b):

- **B3.1 (CRITICAL — bearer token in logs).**
  `dropbox-api.ts:757` constructs
  `new TooManyRequestsAPIError({ response, headers, responseData })`,
  and `headers` is the `requestHeaders` object built at line 544 —
  literally `{ Authorization: \`Bearer ${token}\`, ...headers }`. The
raw bearer token lands in `error.additionalLog`and flows through
every catch-site log. **PR 5b fix:** narrow to`new TooManyRequestsAPIError({ status: response.status, retryAfter, path })`— drop`headers`entirely, drop the raw`responseData`. Plus a
Vitest assertion in `errors.spec.ts`that`JSON.stringify(new TooManyRequestsAPIError(...))`never contains`'Bearer'`.

- **B3.2 (basePath leak via error `path` argument).**
  `dropbox-api.ts:590` and `:716` set
  `path = JSON.parse(headers['Dropbox-API-Arg']).path`, which is the
  joined `basePath + targetPath` (basePath is user-configured, e.g.
  `/Apps/super-productivity/<device>`). Then `path` is threaded into
  `AuthFailSPError`, `RemoteFileNotFoundAPIError`,
  `UploadRevToMatchMismatchAPIError`. **PR 5b fix:** strip `basePath`
  prefix before constructing the error, or pass only `targetPath` at
  the public-API layer.

- **B3.3 (raw response data in AuthFailSPError).**
  `dropbox-api.ts:777-779` —
  `throw new AuthFailSPError('Dropbox token expired or invalid', '', responseData);`
  passes raw Dropbox JSON. Usually safe (`error_summary` is opaque),
  but on edge cases can include account hints. **PR 5b fix:** drop
  `responseData` from the constructor call; rely on the catch-site
  `toSyncLogError(e)` summary.

These three additions land in **PR 5b** (Dropbox-impl PR), not 5a,
since they touch the Dropbox provider code rather than the error
classes. PR 5a updates the error class signatures to **accept** narrower
inputs (e.g. `TooManyRequestsAPIError` takes
`{ status, retryAfter?, path? }` — typed), so PR 5b's call-site
changes are mechanical follow-ups.

### B4 — A4 (tryCatchInlineAsync) ambiguity

Round 2 flagged the "OR" in A4's resolution. Locking it now:

**Default:** replace `tryCatchInlineAsync(() => response.json(), response)`
at `dropbox-api.ts:251` with
`await response.json().catch(() => ({} as DropboxFileMetadata))`.
The wrapper's swallow semantics are preserved without the indirection.
A follow-up commit (not blocking) can prove the 429 comment stale via
investigation and remove the fallback entirely.

This also removes the last consumer of `tryCatchInlineAsync` outside
the package — meaning the util **does not need to move into the
package at all**. Drop Decision 4 / util move; just delete the
app-side `try-catch-inline.ts` (sync version unused, async version
inlined above).

**Updated Decision 4:** move only `DropboxFileMetadata`. Delete
`src/app/util/try-catch-inline.ts` in PR 5b.

### B5 — A5.3 (identity test) location

Round 2 noted the identity test imports from both `src/app/...` and
`@sp/sync-providers`, so it cannot live in
`packages/sync-providers/tests/`. **Resolution:** the spec lives
app-side as
`src/app/op-log/core/errors/sync-errors.identity.spec.ts` (Karma) and
runs against the path-aliased package source. This is consistent with
A5.2 — package tests import from `../src`; app tests are free to
import from `@sp/sync-providers`.

### Round 2 — final verdict

With B1–B5 incorporated, the design is **ready for implementation**.

---

### Revised PR plan

**PR 5a — Provider error classes (errors only).**

- Move 12 error classes into `packages/sync-providers/src/errors/`.
- App-side `sync-errors.ts` becomes a re-export shim.
- Add `"sideEffects": false` to package.json.
- New Vitest privacy tests in `packages/sync-providers/tests/errors.spec.ts`.
- New integration spec asserting single class identity (A5.3).
- Adjust `HttpNotOkAPIError.message` to drop body excerpt (A2).
- Verification: full `npm test` green.

**PR 5b — Dropbox provider proper.**

- Platform-info + web-fetch-factory ports.
- `tryCatchInlineAsync` + `DropboxFileMetadata` move/delete.
- Dropbox + DropboxApi move with full logger audit (A1, A3, A4).
- Factory-function shim (Decision 7 revised).
- Jasmine → Vitest spec migration with the Decision 8 fixes.
- Un-skip native-platform tests.
- Verification: full `npm test` + manual Dropbox round-trip.

PR 5a unblocks the WebDAV / Nextcloud slice to start in parallel, since
WebDAV consumes the same error classes.

---

## Scope summary

In:

- Provider error classes (12 total, listed below) → package, with an
  app-side re-export shim so existing `catch (e) { if (e instanceof
…Error) … }` call sites stay unchanged.
- New ports: `ProviderPlatformInfo`, `WebFetchProvider`.
- Mini-utils: `tryCatchInlineAsync`, `DropboxFileMetadata` shape.
- Dropbox provider files: `dropbox.ts`, `dropbox-api.ts`, three specs
  (Jasmine → Vitest).
- App-side shim under `src/app/op-log/sync-providers/file-based/dropbox/`
  that re-exports the package's Dropbox class wired with the app's
  logger / platform-info / web-fetch / credential-store / native HTTP
  executor instances.

Out (next slices):

- WebDAV / Nextcloud — slice 2. Will reuse the platform-info / web-fetch
  ports and the moved error classes.
- SuperSync — slice 3.
- LocalFile (Electron + Android SAF bridges) — slice 4.
- `provider-manager.service.ts`, `sync-providers.factory.ts`,
  `wrapped-provider.service.ts` — stay app-side. They consume the moved
  Dropbox class via the shim.

---

## Decision 1 — `AdditionalLogErrorBase` constructor-time logging

This is the single biggest design decision and the one that determines
the shape of every error file in the package.

**Today (app).** `AdditionalLogErrorBase` in
`src/app/op-log/core/errors/sync-errors.ts:100` calls
`OP_LOG_SYNC_LOGGER.log(${errorName} additional error metadata…, {…})`
from its constructor, capturing a privacy-safe summary of the
additional args (key names only, no values). The `additionalLog` field
itself stores the raw input — callers must never log it directly.

**Constraint discovered.** `src/app/op-log/core/errors/sync-errors.spec.ts:18`
is an explicit privacy regression test that asserts (a) the log
contains the error name and key names; (b) the log does **not** contain
user values. The test exercises `InvalidDataSPError` directly. If the
moved error class no longer logs, this test must change.

### Options

**A. Drop constructor-time logging.**

- Package-side `AdditionalLogErrorBase` just stores `additionalLog`. No
  logger dependency.
- Existing `sync-errors.spec.ts:18` rewritten (or split): the moved
  errors keep a Vitest equivalent that asserts the constructor has no
  log side effect; the un-moved app errors keep their Jasmine
  assertion.
- Catch-site logging in `dropbox.ts` / `dropbox-api.ts` already
  captures the error metadata via injected `SyncLogger`, so we don't
  lose forensic information for the provider — only for the few
  call sites that _don't_ log at the catch (audit needed; the API
  layer logs `SyncLog.critical(…, e)` everywhere relevant).
- Privacy guarantee becomes: **"no log = no leak."** Stronger than
  "log only safe keys," but harder to verify in a test because there's
  nothing to assert against.

Trade-offs: smallest package surface, no global state, alignment with
"package has no module-level mutable state." Loses one defense-in-depth
test. Slight risk of losing breadcrumbs for any non-catch-site error
construction (very rare in provider code; verifiable via grep).

**B. Package exposes `setProviderErrorLogger(logger)` setter.**

- Module-level `let _logger: SyncLogger = NOOP_SYNC_LOGGER` plus
  `setProviderErrorLogger(l)`. App calls it once at boot.
- Behavior preserved exactly: existing privacy test passes unchanged,
  new Vitest privacy tests in the package can use a mock logger.
- Trade-off: one mutable module-level binding. The package
  consciously avoided this for `sync-core` ports — but
  `SyncLogger` is a documented privacy-aware port, set-once at boot
  is a known pattern, and the alternative (Option A) deletes a passing
  privacy assertion.

**C. Pass logger to each error constructor.**

- `throw new AuthFailSPError(logger, 'Dropbox 401', targetPath)`.
- Verbose at every throw site (>30 in dropbox-api.ts alone).
- Rejected: the verbosity tax doesn't buy clarity over A or B.

### Recommendation

**Option A** with one mitigation: keep the privacy guarantee by
preserving the test, but rewrite it to assert the **absence** of any
log call on construction. The current test verifies a positive
behavior; the rewritten test verifies a negative one. This is a strict
privacy improvement (no log can't leak by definition) and avoids
introducing module-level mutable state in the package.

The handover doc also recommends A. Multi-review should challenge this
recommendation against Option B; if a reviewer finds a real reason the
breadcrumb matters (e.g. an incident where it was load-bearing for
RCA), fall back to B.

**Open question for reviewers.** Is there a case where the
constructor-time breadcrumb captured information that the catch-site
log wouldn't? Specifically: are any of the 12 moved errors thrown from
a location that doesn't have a catch-and-log nearby?

---

## Decision 2 — Error classes to move

Move to `packages/sync-providers/src/errors/`:

| Error                              | Used by (besides Dropbox)                                                   |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `AuthFailSPError`                  | WebDAV, SuperSync, file-based sync adapter, sync-wrapper                    |
| `InvalidDataSPError`               | WebDAV, SuperSync, file-based adapter, sync-wrapper, op-log-download        |
| `EmptyRemoteBodySPError`           | WebDAV                                                                      |
| `RemoteFileNotFoundAPIError`       | WebDAV, SuperSync, file-based adapter, LocalFile, sync-wrapper, op-log-sync |
| `NoRevAPIError`                    | WebDAV, LocalFile                                                           |
| `HttpNotOkAPIError`                | WebDAV                                                                      |
| `MissingCredentialsSPError`        | WebDAV, SuperSync                                                           |
| `MissingRefreshTokenAPIError`      | (Dropbox only today; future Nextcloud OAuth)                                |
| `TooManyRequestsAPIError`          | WebDAV                                                                      |
| `UploadRevToMatchMismatchAPIError` | WebDAV, sync-wrapper, op-log-upload                                         |
| `PotentialCorsError`               | WebDAV                                                                      |
| `RemoteFileChangedUnexpectedly`    | WebDAV                                                                      |

All extend `AdditionalLogErrorBase` (package-side under Option A) except
`MissingCredentialsSPError` and `MissingRefreshTokenAPIError`, which
extend plain `Error`.

`HttpNotOkAPIError` keeps its `_extractErrorFromBody` private method —
pure string parsing, no app dependencies, already privacy-safe (caps
body length to 300 chars, only matches XML/JSON error fields).

**Stays app-side:** the remaining ~18 errors in `sync-errors.ts` that
are app-only (`ImpossibleError`, `LocalDataConflictError`,
`SyncAlreadyInProgressError`, `LockAcquisitionTimeoutError`,
`InvalidFilePrefixError`, `JsonParseError`,
`StorageQuotaExceededError`, `LegacySyncFormatDetectedError`, all the
model/validation/compression/decompression errors, etc.).

App-side `sync-errors.ts` becomes a barrel that re-exports the moved
classes:

```ts
export {
  AuthFailSPError,
  InvalidDataSPError,
  EmptyRemoteBodySPError,
  RemoteFileNotFoundAPIError,
  NoRevAPIError,
  HttpNotOkAPIError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
} from '@sp/sync-providers';
```

Critical invariant: **one class definition per error.** App and package
must resolve `e instanceof AuthFailSPError` to the same constructor.
The re-export pattern guarantees this; a redefinition would silently
break `instanceof` checks across `imex/sync/`, `sync-wrapper.service`,
and the WebDAV provider (untouched in this slice).

---

## Decision 3 — New platform / fetch ports

Two small ports, both in `packages/sync-providers/src/platform/`:

```ts
// provider-platform-info.ts
export interface ProviderPlatformInfo {
  readonly isNativePlatform: boolean;
  readonly isIosNative: boolean;
}
```

```ts
// web-fetch-provider.ts
//
// CapacitorWebFetch is Capacitor's original unpatched fetch, stored
// before the CapacitorHttp plugin patches window.fetch. Used by Dropbox
// on iOS to bypass URLSession.shared (-1005 errors).
export type WebFetch = typeof fetch;
export interface WebFetchProvider {
  getFetch(): WebFetch;
}
```

**Why an interface for `WebFetchProvider` instead of `WebFetch`
directly?** The fetch we need is read off `globalThis` at call time, not
at module load — Capacitor's `native-bridge.js` patches `window.fetch`
asynchronously during boot. The provider indirection lets the app
resolve lazily.

Why `readonly` fields on `ProviderPlatformInfo` and not a method? The
values are constants for the process lifetime — `IS_NATIVE_PLATFORM`
and `IS_IOS_NATIVE` are module-load-time evaluated. No need for a
function.

App-side concrete implementations in
`src/app/op-log/sync-providers/platform/` (new directory):

```ts
// app-provider-platform-info.ts
import { IS_NATIVE_PLATFORM, IS_IOS_NATIVE } from '../../../util/is-native-platform';
import type { ProviderPlatformInfo } from '@sp/sync-providers';

export const APP_PROVIDER_PLATFORM_INFO: ProviderPlatformInfo = {
  isNativePlatform: IS_NATIVE_PLATFORM,
  isIosNative: IS_IOS_NATIVE,
};
```

```ts
// app-web-fetch-provider.ts
import type { WebFetch, WebFetchProvider } from '@sp/sync-providers';

export const APP_WEB_FETCH_PROVIDER: WebFetchProvider = {
  getFetch: () =>
    ((globalThis as Record<string, unknown>).CapacitorWebFetch as WebFetch) ?? fetch,
};
```

Both exported from the package barrel.

**Open question for reviewers.** `IS_NATIVE_PLATFORM` includes
`IS_ANDROID_WEB_VIEW` (the SUPAndroid WebView flag). Is that semantics
the package wants to preserve, or is "native" strictly Capacitor? The
existing Dropbox code uses `Capacitor.isNativePlatform() ||
IS_ANDROID_WEB_VIEW` for `isNativePlatform`. The port preserves the
existing semantics; clean separation would be a future cleanup.

---

## Decision 4 — `tryCatchInlineAsync` and `DropboxFileMetadata`

`tryCatchInlineAsync` — used only by `dropbox-api.ts:251` (audited).
Move to `packages/sync-providers/src/util/try-catch-inline.ts`. Delete
the app-side file once the move is complete (the sync `tryCatchInline`
in the same file is unused — confirmed via grep across `src/`). YAGNI:
package gets only the async version.

`DropboxFileMetadata` — currently lives in
`src/app/imex/sync/dropbox/dropbox.model.ts` (102 lines, pure type
definitions). Approach: **duplicate** into
`packages/sync-providers/src/file-based/dropbox/dropbox.model.ts`. The
legacy `imex/sync/dropbox/` directory still exists for transitional
code that hasn't been deleted yet; duplicating avoids a cross-package
edge that would otherwise require leaving the app-side file as a
re-export shim. Same approach the project took for `FILE_BASED_SYNC_CONSTANTS`
duplication in slice 2.

**Open question.** Is the `imex/sync/dropbox/` directory scheduled for
deletion? If yes, prefer move-not-duplicate to avoid drift. Audit:
grep `imex/sync/dropbox/dropbox.model` consumers.

---

## Decision 5 — `DropboxDeps` shape and constructor

Today, `Dropbox` constructs its own `DropboxApi`, its own
`SyncCredentialStore`, and reads
`Capacitor.isNativePlatform()`/`IS_IOS_NATIVE`/`CapacitorWebFetch`/`CapacitorHttp`
directly. Inside the package, all of those become injected deps.

```ts
// packages/sync-providers/src/file-based/dropbox/dropbox.ts
import type { SyncLogger } from '@sp/sync-core';
import type {
  SyncCredentialStorePort,
  ProviderPlatformInfo,
  WebFetchProvider,
  NativeHttpExecutor,
  FileSyncProvider,
} from '@sp/sync-providers';

export const PROVIDER_ID_DROPBOX = 'Dropbox' as const;

export interface DropboxCfg {
  appKey: string;
  basePath: string;
}

export interface DropboxPrivateCfg {
  accessToken: string;
  refreshToken: string;
  encryptKey?: string;
  // …whatever SyncProviderPrivateCfgBase declares
}

export interface DropboxDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetchProvider: WebFetchProvider;
  credentialStore: SyncCredentialStorePort<typeof PROVIDER_ID_DROPBOX, DropboxPrivateCfg>;
  nativeHttpExecutor: NativeHttpExecutor;
}

export class Dropbox implements FileSyncProvider<
  typeof PROVIDER_ID_DROPBOX,
  DropboxPrivateCfg
> {
  readonly id = PROVIDER_ID_DROPBOX;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;
  readonly privateCfg: SyncCredentialStorePort<
    typeof PROVIDER_ID_DROPBOX,
    DropboxPrivateCfg
  >;

  private readonly _api: DropboxApi;
  // …

  constructor(
    cfg: DropboxCfg,
    private readonly _deps: DropboxDeps,
  ) {
    if (!cfg.appKey) throw new Error('Missing appKey for Dropbox');
    this._appKey = cfg.appKey;
    this._basePath = cfg.basePath || '/';
    this.privateCfg = _deps.credentialStore;
    this._api = new DropboxApi(this._appKey, this, _deps);
  }
}
```

`DropboxApi` receives the same `_deps` object (or a narrower subset —
it needs `logger`, `platformInfo`, `webFetchProvider`,
`nativeHttpExecutor`, and access to the parent's
`privateCfg`). Pass the whole `DropboxDeps` for simplicity; the
internal contract isn't part of the public surface.

**SyncLog → injected logger.** Every `SyncLog.critical(...)` /
`SyncLog.normal(...)` / `SyncLog.log(...)` call in `dropbox.ts` and
`dropbox-api.ts` becomes `this._deps.logger.critical(...)` (etc.).

**Logger audit** — every existing call must be checked for
`SyncLogMeta` compliance (primitives only, never raw entities or full
URLs with auth). Known offenders to scrub during the port:

- `SyncLog.critical(\`${DropboxApi.L}.download() error for path: ${path}\`, e)`—`e`is the raw error. Replace with`this.\_deps.logger.critical('DropboxApi.download error', { path, ...toSyncLogError(e) })`.
- `SyncLog.critical(\`${DropboxApi.L}.listFiles() error for path: ${path}\`, e)`— same pattern, multiple sites in`dropbox-api.ts`.
- `SyncLog.normal('Dropbox: Refresh access token Response', { hasAccessToken, hasRefreshToken, expiresIn })`
  — already safe (just booleans + number).
- `SyncLog.log(\`${DropboxApi.L}.\_requestNative() ${method} ${requestUrl}\`)`—`requestUrl`may include auth-sensitive query params. Audit:
current usage shows URLs are Dropbox API endpoints with no auth in
query; bearer token is in`Authorization`header. Safe today, but
prefer logging`{ method, urlHost: new URL(requestUrl).host, urlPath: new URL(requestUrl).pathname }`
  to be defensive.

This is privacy-sensitive work. Reviewers should flag any log call I
missed that could leak user data.

---

## Decision 6 — `NativeHttpExecutor` integration

`dropbox-api.ts:823` currently has its own `_executeNativeRequestWithRetry`
wrapper around the app-side `executeNativeRequestWithRetry`. Inside the
package, the provider calls `executeNativeRequestWithRetry` from
`@sp/sync-providers` (already moved in slice 4) and passes
`this._deps.nativeHttpExecutor` as the executor:

```ts
const response = await executeNativeRequestWithRetry(
  { url, method, headers, data, readTimeout: NATIVE_REQUEST_READ_TIMEOUT },
  {
    executor: this._deps.nativeHttpExecutor,
    logger: this._deps.logger,
    label: 'DropboxApi',
  },
);
```

**Special case — `getTokensFromAuthCode`.** Today calls
`CapacitorHttp.request(...)` directly (no retry wrapper) because it's
a one-time user-initiated auth exchange. Preserve that behavior by
calling `this._deps.nativeHttpExecutor(...)` directly, not via
`executeNativeRequestWithRetry`. Document the choice in a one-line
comment at the call site (see CLAUDE.md "WHY not WHAT" rule).

App-side, the `nativeHttpExecutor` is constructed as
`(cfg) => CapacitorHttp.request(cfg)` plus a cast (the existing
`src/app/op-log/sync-providers/native-http-retry.ts:24-29` shim already
demonstrates this).

---

## Decision 7 — App-side shim layout

`src/app/op-log/sync-providers/file-based/dropbox/dropbox.ts`:

```ts
import {
  Dropbox as PackageDropbox,
  type DropboxCfg,
  type DropboxDeps,
} from '@sp/sync-providers';
import { CapacitorHttp } from '@capacitor/core';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH_PROVIDER } from '../../platform/app-web-fetch-provider';

export type { DropboxCfg, DropboxPrivateCfg } from '@sp/sync-providers';

export class Dropbox extends PackageDropbox {
  constructor(cfg: DropboxCfg) {
    const deps: DropboxDeps = {
      logger: OP_LOG_SYNC_LOGGER,
      platformInfo: APP_PROVIDER_PLATFORM_INFO,
      webFetchProvider: APP_WEB_FETCH_PROVIDER,
      credentialStore: new SyncCredentialStore(
        SyncProviderId.Dropbox,
      ) as unknown as DropboxDeps['credentialStore'],
      nativeHttpExecutor: (cfg) =>
        CapacitorHttp.request(cfg) as unknown as Promise<
          import('@sp/sync-providers').NativeHttpResponse
        >,
    };
    super(cfg, deps);
  }
}
```

The `as unknown as` cast on `credentialStore` is because the app's
`SyncCredentialStore<PID extends SyncProviderId>` uses the enum-keyed
`PrivateCfgByProviderId` map, while the package's
`SyncCredentialStorePort<PID extends string, T>` is plain-string keyed.
The types are structurally compatible at runtime; the cast bridges the
nominal mismatch. Same pattern is already used in
`sync-providers.factory.ts:47` for `SyncProviderBase`.

**Factory unchanged.** `sync-providers.factory.ts:37` still
`import('./file-based/dropbox/dropbox')` and constructs `new Dropbox(cfg)`.
The shim makes the constructor signature identical.

`generate-pkce-codes.ts` shim stays as today
(`export { generatePKCECodes } from '@sp/sync-providers';`).

---

## Decision 8 — Spec migration (Jasmine → Vitest)

Three specs move:

| Source (Jasmine)                                                                   | Target (Vitest)                                                        |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/app/op-log/sync-providers/file-based/dropbox/dropbox-api.spec.ts` (876 lines) | `packages/sync-providers/tests/file-based/dropbox/dropbox-api.spec.ts` |
| `dropbox-auth-helper.spec.ts` (100 lines)                                          | same path                                                              |
| `generate-pkce-codes.spec.ts` (74 lines)                                           | (move) or fold into existing `tests/pkce.spec.ts`                      |

### Migration patterns

`jasmine.createSpyObj` → `vi.fn<...>()` + manual mock object.

```ts
// Before (Jasmine)
mockPrivateCfgStore = jasmine.createSpyObj('SyncCredentialStore', [
  'load',
  'updatePartial',
]);

// After (Vitest)
mockPrivateCfgStore = {
  load: vi.fn(),
  updatePartial: vi.fn(),
  setComplete: vi.fn(),
  // …all methods of SyncCredentialStorePort
};
```

`spyOn(api, 'getTokensFromAuthCode').and.resolveTo(...)` →
`vi.spyOn(api, 'getTokensFromAuthCode').mockResolvedValue(...)`.

`await expectAsync(p).toBeRejectedWith(err)` →
`await expect(p).rejects.toBe(err)` or `.rejects.toThrow(...)`.

`fetchSpy.calls.mostRecent().args[0]` →
`fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0]`.

`(globalThis as any).fetch = fetchSpy` — Vitest doesn't have an
ambient `fetch` mock; injecting via `WebFetchProvider` mock is cleaner
and the right thing to do here (the whole point of the port is
testability):

```ts
const fetchSpy = vi.fn<typeof fetch>();
const webFetchProvider: WebFetchProvider = { getFetch: () => fetchSpy };
```

### Skipped tests

`dropbox-api.spec.ts:574` has 12 skipped tests (`xdescribe`) for native
platform routing. The skip reason was "CapacitorHttp.request cannot be
properly mocked in Jasmine — Capacitor does internal processing before
the spy can intercept." That constraint disappears with the port: the
package mocks the injected `NativeHttpExecutor` directly. **Un-skip
during the port** and verify they pass; this is a net coverage win.

### `dropbox-auth-helper.spec.ts:3`

Currently imports `pkceUtil` from `'../../../../util/pkce.util'`.
Switch to `'@sp/sync-providers'` while moving the file (one-line
change, the symbol is already re-exported).

The "does not poison the cache when PKCE generation rejects" test
mutates `globalThis.crypto.subtle` via `Object.defineProperty`. In
vitest's `happy-dom`/`jsdom` env that pattern works the same way;
verify by running the spec. If the environment doesn't allow the
defineProperty, fall back to stubbing `generatePKCECodes` via
`vi.mock('@sp/sync-providers', …)` — but the original behavior is the
preferred test because it exercises the real PKCE generator's error
path.

---

## Decision 9 — Constants and minor details

`PROVIDER_ID_DROPBOX = 'Dropbox' as const` lives in the package's
`dropbox.ts`. The shim doesn't re-export it. App code uses
`SyncProviderId.Dropbox` (string-equal at runtime, type-distinct at
compile time).

The OAuth and Dropbox API URL constants
(`DROPBOX_AUTH_URL`, `DROPBOX_OAUTH_TOKEN_URL`, `PATH_NOT_FOUND_ERROR`,
`EXPIRED_TOKEN_ERROR`, `INVALID_TOKEN_ERROR`) stay private to the
package — they're internal to the Dropbox files.

`DROPBOX_APP_KEY` (in `src/app/imex/sync/dropbox/dropbox.const.ts`)
stays app-side. It's passed via `cfg.appKey` from the factory; the
package doesn't need to know app-specific keys.

---

## Lint / boundary check

Confirmed against `eslint.config.js:168-225` rules for
`packages/sync-providers/**`:

- ✗ Forbidden imports: `@angular/*`, `@ngrx/*`, `src/app/**`,
  `@sp/shared-schema`, `@sp/sync-core/*` (subpath), dynamic imports.
- ✓ Allowed: `@sp/sync-core` (root only), `hash-wasm`, vitest in tests.

Files moved must NOT import `@capacitor/core`, `SyncProviderId`,
`provider.const.ts`, `Log` / `SyncLog`, `IS_ANDROID_WEB_VIEW`,
`IS_IOS_NATIVE`, or anything from `src/app/`.

---

## Suggested commit shape

Four commits, matching the slice-4 shape:

1. `refactor(sync-providers): move provider error classes`
   - New `packages/sync-providers/src/errors/`
   - New `packages/sync-providers/tests/errors.spec.ts` (privacy assertions)
   - Re-export shim in `src/app/op-log/core/errors/sync-errors.ts`
   - **Verification gate:** full `npm test` must stay green. This commit
     is the biggest risk because the moved classes are caught across
     many call sites. If a spec breaks, it's almost certainly an
     `instanceof` resolving against the wrong constructor (lint will
     surface duplicate imports).
2. `refactor(sync-providers): add platform info and web fetch ports`
   - New `packages/sync-providers/src/platform/`
   - New `src/app/op-log/sync-providers/platform/`
   - Package barrel exports updated.
3. `refactor(sync-providers): move dropbox utilities`
   - `tryCatchInlineAsync` and `DropboxFileMetadata` move.
   - App-side `try-catch-inline.ts` deleted (unused after import switch).
4. `refactor(sync-providers): move dropbox provider`
   - `dropbox.ts`, `dropbox-api.ts`, three specs converted to Vitest.
   - App-side shim wired through factory.
   - Skipped native-platform tests un-skipped.

**Fallback plan.** If commit 1 proves disruptive, ship it as its own PR
("move provider error classes only") and verify nothing regresses
before the Dropbox-impl PR. Each downstream slice (WebDAV, SuperSync,
LocalFile) benefits from the error move regardless of Dropbox.

---

## Verification checklist

After each commit:

- `npm run checkFile <path>` on every modified `.ts`.
- `cd packages/sync-providers && npm test` — Vitest stays green.
- `npm test` from root — every consumer of moved errors still works.
- `npm run lint` — boundary rules hold.
- `npm run sync-providers:build` — tsup emits ESM + CJS + DTS clean.

After the final commit:

- `npm run test:file src/app/op-log/sync-providers/sync-providers.factory.spec.ts`
  and any related shim specs.
- Manual Dropbox sync round-trip in a dev build. Unit tests are the
  primary gate, but OAuth refresh + upload-with-revToMatch is hard to
  fully cover at unit level — exercise both at least once before
  merge.

---

## Open questions for multi-review

1. **Option A vs B for `AdditionalLogErrorBase`.** Does any reviewer
   find a case where dropping constructor-time logging measurably
   weakens diagnostics?
2. **`DropboxFileMetadata` move vs duplicate.** Should I delete the
   app-side `imex/sync/dropbox/dropbox.model.ts` or keep it as a
   transitional alias? (See Decision 4.)
3. **`isNativePlatform` semantics.** The port preserves
   `Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW`. Worth
   splitting `isNativePlatform` from `isAndroidWebView` in the port,
   or keep coupled for now and clean up post-PR-5?
4. **Logger audit scope.** I've listed three log-call patterns to
   scrub in `dropbox-api.ts`. Are there other privacy patterns the
   reviewer wants enforced (e.g. stripping query strings from logged
   URLs, hashing path components)?
5. **`DropboxDeps` granularity.** I'm passing the whole deps object
   to `DropboxApi`. Alternative: extract a `DropboxApiDeps` interface
   with only the fields `DropboxApi` uses. More surface but cleaner
   coupling. Worth it for a class only the Dropbox class instantiates?
6. **Should `getTokensFromAuthCode`'s "no retry" comment be expanded
   into a doc/type-level signal?** It's a deliberate behavioral
   asymmetry that's easy to break by accident.

---

## Risk and time estimate

**Risk:** High. Largest PR-5 slice by surface area. Error move alone
touches `imex/sync/`, file-based sync adapter, WebDAV adapter (caught
errors, not moved provider code), and many specs.

**Time estimate:**

- Errors move cleanly: ~4–6 hours focused work.
- Error move triggers spec churn (e.g. construction-time logging
  assertions): +2–4 hours.
- Multi-review feedback cycle: +1–2 hours to incorporate.

Total expected: **1–1.5 working days** including review.
