# SuperSync Extraction Plan — standalone, framework-agnostic sync library (v2)

**Status:** Deferred as the immediate roadmap; retained as future standalone-library research. See [`2026-07-13-sync-simplification-plan.md`](./2026-07-13-sync-simplification-plan.md).
**Date:** 2026-07-03 (v2 — revised after two-agent adversarial review; v1's step 5 "near drop-in" claim was wrong)
**Evidence warning:** All counts, line references, dependency inventories, and coverage claims below are a 2026-07-03 point-in-time audit, not current repository facts. Re-audit them before reusing this plan.
**Decisions baked in:** the extracted library has **no rxjs** and **no `@angular/core` signals** (both verified below)
**Builds on:** `docs/sync-and-op-log/package-boundaries.md` (the extraction is an established, lint-enforced direction; `@sp/sync-core` + `@sp/sync-providers` + `@sp/shared-schema` already exist)

---

## 0. Review history

- **Fact-check review:** every hard number verified against code — LOC counts (1204/1558/333/307/69KB), the 19-branch error chain, call-site counts (6 snack / 1 dispatch / 2 confirm / 20 `createValidate` / 11 rxjs files), all cited line numbers, port inventory, ESLint boundary rules, stale `build-packages.js` comment. **Zero factual errors**; two wording fixes applied in this v2 (`OpLogDbAdapter` is still app-side; "Phase B" citation tightened).
- **Adversarial gap review:** found 2 blockers + 1 missed category, all spot-verified and incorporated below: (1) the orchestrator's dependency graph — 16 injections including `MatDialog`/`TranslateService`-bound services — invalidated v1's "swap 3 things" framing for step 5; (2) `SyncSessionValidationService` is a shared-singleton correctness latch (issue #7330) injected by 10 files straddling the cut, with silent-corruption risk if duplicated; (3) Angular **signals** in three engine-slated services (the v1 no-rxjs analysis never checked for them). Plus: reactive provider lifecycle vs pull-based `getConfig()`, the unaddressed boot hydrator, an engine↔engine `lazyInject` cycle, dynamic per-entity selector reads, i18n-key leakage, and Karma/TestBed test-gate circularity.

---

## 1. Verified facts the plan rests on

| Claim | Status | Evidence |
| --- | --- | --- |
| Core orchestrator `src/app/op-log/sync/operation-log-sync.service.ts` (1204 LOC) has zero rxjs; fully sequential async/await (54 awaits) with `DownloadOutcome`/`UploadOutcome` unions | ✅ twice-verified | grep + two independent reads |
| Upload/download services (`operation-log-upload/download.service.ts`): zero rxjs | ✅ | grep |
| All other engine-side rxjs is one-shot `firstValueFrom` reads; genuinely-streaming observables (`syncInterval$`, `afterCurrentSyncDoneOrSyncDisabled$`, UI signals) are shell concerns | ✅ | per-file import audit |
| `sync-wrapper.service.ts` (1558 LOC): `_syncBody` try block (444–642) is pure engine; catch (643–902) = 19-branch error chain, classification=engine / reaction=shell | ✅ | full read, branch-by-branch |
| **BUT: Angular signals exist in the engine set** — `super-sync-status.service.ts:23-41` (`signal`/`computed`, written by orchestrator at `operation-log-sync.service.ts:363,834` and `operation-log-download.service.ts:415`), `apply/hydration-state.service.ts:65-84` (signals + `toObservable`, implements `RemoteApplyWindowPort`, drives the capture meta-reducer via module-level `setIsApplyingRemoteOps`), `super-sync-websocket.service.ts:43` (`isConnected = signal(false)`) | ⚠ new in v2 | adversarial review, spot-verified |
| `SyncSessionValidationService` = one mutable-boolean latch whose docstring requires a single shared instance; injected by 10 files on both sides of the cut (`sync-wrapper`, `ws-triggered-download`, `conflict-resolution`, `remote-ops-processing`, `rejected-ops-handler`, `immediate-upload`, `sync-hydration`, `sync-cycle-guard`, + types) | ⚠ new in v2 | grep, spot-verified |
| Orchestrator injects 16 services; among them `ServerMigrationService` (opens `MatDialog` at `server-migration.service.ts:309`; called at `operation-log-sync.service.ts:211,414,648`), `SyncLocalStateService` (injects `TranslateService`, `translateService.instant` at `:45-46` — welds engine predicates `hasMeaningfulStoreData`/`isWhollyFreshClient` to dialog-string building), `BackupService` (injects `Store`), `SuperSyncStatusService` (signals) | ⚠ new in v2 | spot-verified |
| Engine↔engine cycle: `sync-wrapper` ↔ `ws-triggered-download` (broken today via `lazyInject(Injector, SyncWrapperService)` at `ws-triggered-download.service.ts:42`); `immediate-upload.service.ts:53-55` injects both `OperationLogSyncService` and `SyncWrapperService` | ⚠ new in v2 | spot-verified |
| `conflict-resolution.service.ts` reads **dynamic per-entity selectors** (`store.select(config.selectById(entityId, null))` at `:952`, registry-driven) — a flat state-snapshot port cannot express this | ⚠ new in v2 | spot-verified |
| Provider lifecycle is reactive: `provider-manager.service.ts:127-149` subscribes `selectSyncConfig` and rebuilds the active provider on config change; encryption toggles fire `setProviderConfig` mid-session; `wrapped-provider.service.ts:50-56` invalidates adapter cache via `providerConfigChanged$` | ⚠ new in v2 | adversarial review |
| Boot flow: `data-init.service.ts` → `operation-log-hydrator.service.ts` interleaves engine work (snapshot load, schema migration, replay) with host-only work (legacy PFAPI migration, `store.dispatch(loadAllData)` ×4, snacks/alerts, signals) | ⚠ new in v2 | adversarial review |
| Multi-tab: no cross-tab op broadcast exists (only single-instance detection, `startup.service.ts:262`); `navigator.locks` + `SyncCycleGuard` → a `LockPort` suffices | ✅ | grep |
| typia: type-only leakage (`ValidationResult<T> = IValidation<T>`); all 20 `createValidate` codegen sites confined to host-side `validation/validation-fn.ts` → lib defines its own shape, no typia dep | ✅ | grep |
| Capture effect is a thin shell: `createEffect` at `operation-log.effects.ts:101` → async `writeOperation*` methods → maps to `engine.captureAction()` | ✅ | read |
| Test coverage: `sync-wrapper.service.spec.ts` 130 tests but these error branches have **zero** coverage: `EmptyRemoteBodySPError`, `LegacySyncFormatDetectedError`, HTTP-423, `DecryptNoPasswordError`→dialog, `DecryptError`→dialog, `WebCryptoNotAvailableError`, flatpak/snap variants. `operation-log-sync.service.spec.ts`: 81 tests, well-covered | ✅ | spec grep |
| Test-gate integrity: orchestrator/integration specs are Karma/TestBed with **real Chrome IndexedDB**; packages test with vitest. TZ-sensitive sync logic is covered by the `test:tz:*` Karma matrix; moved code drops out unless re-wired | ⚠ new in v2 | adversarial review |
| E2EE: all crypto already framework-free in `packages/sync-core/src/encryption*` (Argon2id + AES-256-GCM, `@noble/ciphers` fallback, session caches, legacy PBKDF2); `encrypt-and-compress-handler.service.ts` already framework-free; `isEncryptionMandatory` fail-closed guards at `operation-log-upload.service.ts:134` + `snapshot-upload.service.ts:251`; `setLegacyKdfWarningHandler` host hook at `src/main.ts:115` | ✅ twice-verified | reads |
| Host-domain leaks inside persistence: `archive-store.service.ts` imports `ArchiveModel` from `features/time-tracking`; `operation-log-store.service.ts:1900-1932` implements SP profile-switching (`profile_data` store) | ⚠ new in v2 | adversarial review |
| `sync-core` is consumed by `super-sync-server` (`package.json:45`, vector-clock imports) → engine goes in a **new package**, not into sync-core | ✅ | verified |

---

## 2. Target architecture

```
host app (SP / any TS host)
   └─► @sp/sync-engine   (NEW — orchestration; NO rxjs, NO Angular incl. signals, NO NgRx)
          ├─► @sp/sync-providers   (existing — Dropbox/OneDrive/WebDAV/Nextcloud/LocalFile/SuperSync, OAuth/PKCE)
          └─► @sp/sync-core        (existing — ops model, vector clocks, LWW planners, E2EE crypto, ports)
super-sync-server ─► @sp/sync-core, @sp/shared-schema   (unchanged)
```

- `shared-schema` stays SP-specific, never a library dependency; hosts supply entity types (plain strings) and migrations via ports (`createFullStateOpTypeHelpers` / `createLwwUpdateActionTypeHelpers` already anticipate this).
- Async model: `async/await` + typed result unions + plain callback subscriptions (`onX(cb): () => void`). Debounce via `setTimeout`. Signals become engine-owned plain state + change callbacks; the Angular shell wraps them back into signals for UI.
- **Wiring model (v2):** the boundary is a set of injected ports with a few engine-exposed handles, *not* a one-way `engine.run()`. The engine constructs its internal subsystems itself and late-binds the two known cycles (wrapper↔ws-download, immediate-upload→wrapper) via setters at build time — replacing today's Angular `lazyInject`.

### Public API sketch (v2 — port list revised)

```ts
const engine = createSyncEngine({
  // host semantics
  entityRegistry: EntityRegistry,                 // sync-core structural contract
  actionSchema: { isPersistentAction /* op ↔ host-action mapping */ },
  validation?: ValidationPort,                    // engine-defined ValidationResult (typia-free)
  migration?: SchemaMigrationPort,

  // host infrastructure
  db: OpLogDbAdapter,                             // today app-side (op-log/persistence); moves into the lib in step 3
  credentialStore: SyncCredentialStorePort,       // exists in sync-providers
  platform: ProviderPlatformInfo, webFetch, nativeHttpExecutor,  // exist
  lock: LockPort, clientId: ClientIdPort,
  logger: SyncLogger,                             // exists

  // config & provider lifecycle — PUSH, not pull (v2)
  config: {
    get(): Promise<SyncEngineConfig>;
    onChange(cb: (cfg: SyncEngineConfig) => void): Unsubscribe;   // provider-manager rebuild + adapter-cache invalidation
  },
  providerFactories: Record<ProviderId, ProviderFactory>,          // host composes platform deps; engine owns the ACTIVE-provider lifecycle (today's SyncProviderManager + WrappedProviderService logic moves in)

  // host state access — registry-driven, not a flat snapshot (v2)
  state: {
    readEntityById(entityType: string, id: string): Promise<unknown | null>;   // conflict-resolution dynamic reads
    readFeatureState(entityType: string): Promise<unknown>;
    getFullSnapshot(): Promise<AppStateSnapshot>;                              // backup/state-snapshot stays host-implemented
    resetToDefault(): Promise<void>;                                           // today: store.dispatch(loadAllData(default))
  },

  // host UI/decisions (all Promise-returning)
  ui: {
    resolveLocalDataConflict(d: ConflictData): Promise<'USE_LOCAL'|'USE_REMOTE'|'CANCEL'>;
    resolveSyncImportConflict: ConflictUiPort<SyncImportConflictResolution>;   // exists, pattern proven
    confirmFreshClientSync(info: FreshClientInfo): Promise<boolean>;           // engine passes data; host builds strings
    confirmServerMigration(info: ServerMigrationInfo): Promise<boolean>;       // v2: ServerMigrationService's MatDialog
    requestEncryptionPassword(ctx): Promise<PasswordResult>;
  },

  // engine → host event sinks (v2: three distinct sinks, not one)
  onStatus: (s: SyncStatus) => void,                              // ~20 setSyncStatus call sites
  onPendingOpsStatus: (s: PendingOpsStatus) => void,              // v2: today's SuperSyncStatusService signals
  onRemoteApplyWindow: (w: RemoteApplyWindowState) => void,       // v2: today's HydrationStateService signals; host feeds its capture meta-reducer
  onNotification: (n: SyncNotification) => void,                  // typed SEMANTIC codes (v2), host maps code → i18n key → snack/alert
  onRemoteOpsAvailable: (n: NewOpsNotification) => void,          // WS push (Subject → callback)
});

engine.sync({ isUserTriggered }): Promise<SyncOutcome>
engine.captureAction(action): Promise<void>
engine.hydrate(applyPort): Promise<void>              // engine replay half of today's hydrator (see step 8)
engine.forceUploadLocal(src) / engine.forceDownloadRemote()
engine.runWithSyncBlocked(op)                         // promise mutex (today a BehaviorSubject latch)
engine.session: SyncSessionValidation                 // v2: the #7330 latch — engine-owned, SINGLE instance, exposed as a handle so shell code reads the same latch
engine.encryption.{enable, disable, changePassword, setPassword}
engine.restore.{getRestorePoints, restoreToPoint}
engine.ws.{connect, disconnect}
```

**`SyncNotification` (v2):** the engine emits `{ code: SyncNotificationCode, status?, severity, offerForceUpload?, silentIfAutomatic?, data }` where `code` is a **semantic enum** (`'REMOTE_FILE_EMPTY' | 'AUTH_REJECTED' | 'LOCK_TIMEOUT' | …`). The host owns the code→`T.*` mapping; SP translation keys never enter the library (v1 leaked `msgKey`). Notification actions (e.g. "force upload") are expressed as `code`-level affordances the host wires back to `engine.forceUploadLocal(...)` — the shell holds the engine handle.

### Stays host-side (SP adapter), permanently

Trigger policy (`sync-trigger.service.ts`, `sync.effects.ts`, immediate-upload cadence config), OAuth **redirect capture** (`oauth-callback-handler.service.ts`), all dialogs/snacks/banners/config forms and the code→i18n mapping, `entity-registry.ts` / `model-config.ts` / `backup/state-snapshot.service.ts` (host implementations of registry/state ports), typia-generated validators, **legacy PFAPI migration + archive migration** (boot-time, hydrator's host half), profile-switching (`profile_data`) and SP-typed archive models, `_promptSuperSyncEncryptionIfNeeded` (MatDialog-stack polling), flatpak/snap message selection (behind `getPermissionMessage()`), signal/`toObservable` wrappers for UI.

---

## 3. E2EE — boundary confirmation (unchanged from v1, twice-verified)

Nothing to redesign. Primitives already extracted and pure (`packages/sync-core/src/encryption*`; deps: `@noble/ciphers`, `hash-wasm` only). Moves into `sync-engine`: `operation-encryption.service.ts` (per-op/batch, SuperSync), `encrypt-and-compress-handler.service.ts` (gzip+encrypt+prefix, file-based — already framework-free), the `isEncryptionMandatory` fail-closed guards (GHSA-9v8x) with their upload paths, and the delete+reupload sequencing from toggle/password-change services (UI confirmation stays host-side). Key storage stays behind `SyncCredentialStorePort`; `setLegacyKdfWarningHandler` is already the right host-hook shape.

---

## 4. Ordered migration path (v2)

Every step keeps the app green: `npm test`, `npm run lint`, `npm run packages:test`, scheduled SuperSync/WebDAV E2E after risky steps. **Test-gate rule (v2):** while a facade exists, the old Karma/TestBed spec keeps running against the moved code *through the facade* — a moved unit is only "done" when its spec is also ported to vitest (with fake-indexeddb where needed) **and** TZ-sensitive specs are re-wired into a package-level TZ matrix (vitest `TZ=` env runs). Never delete a Karma spec before its vitest replacement is green.

**Step 0 — Characterization tests first.**
Cover the untested error-matrix branches before touching them: `EmptyRemoteBodySPError` + `LegacySyncFormatDetectedError` (force-upload snack actions), HTTP-423, `DecryptNoPasswordError`/`DecryptError` dialog flows, `WebCryptoNotAvailableError`, flatpak/snap variants, payload-too-large `alertDialog`. These are exactly the branches the seam cuts through.
*Verify: new tests green on unmodified code.*

**Step 1 — Scaffold + port design (bigger than v1).**
Create `packages/sync-engine` (tsup, workspace, tsconfig alias, vitest; ESLint boundary rule banning `@angular/*` — **which covers signals** — `@ngrx/*`, **`rxjs`**, `src/app`, `@sp/shared-schema`). Fix the stale `build-packages.js` comment. **Design and land the v2 port set as types first** (state reader, config push, three event sinks, semantic notification codes, session-latch handle, UI ports incl. `confirmServerMigration`) — steps 4–8 all consume them, so they must exist before code moves, not be invented mid-move.
*Verify: lint + package builds; port types reviewed against the call-site inventory in §1.*

**Step 2 — Move the already-pure files (low risk).**
`op-log/encryption/*`, `op-log/util/*` (minus the `client-id.provider.ts` DI token), `op-log/core` types/consts/errors (lib defines its own `ValidationResult`; `EntityType` generic over strings), `persistence/` adapters + `compact/` codec + `db-upgrade.ts`/`op-log-db-schema.ts`, pure utils in `apply/` and `sync/`. **v2 carve-outs:** `archive-store.service.ts` keeps its SP `ArchiveModel` typing host-side (generic blob-store interface in the lib); `profile_data`/profile-switching stays host-side (or becomes a generic namespaced-blob API).
*Verify: full suite + boundary grep from package-boundaries.md.*

**Step 3 — Finish persistence connection-ownership inversion (medium risk).**
The remaining tail of `docs/sync-and-op-log/sqlite-migration.md` Phase B (followup B3): `operation-log-store.service.ts` (69 KB) stops calling `openDB` directly / lending connections via `adoptConnection()`, goes fully behind `OpLogDbAdapter`; then becomes a lib class constructed with the adapter. (Data-access routing — the doc's Phase A — is already done; connection ownership is what's left.)
*Verify: unit suite + IndexedDB integration specs + manual upgrade test from a v7 `SUP_OPS` DB.*

**Step 4 — Split the shared singletons + status/window state (v2, new step — prerequisite for everything after).**
These cross-cutting objects must move **as single instances** before any consumer moves, or the cut duplicates them:
- `SyncSessionValidationService` → engine-owned `SyncSessionValidation` latch, constructed once, exposed via `engine.session`; the Angular facade delegates to that same instance. **Never two instances** — a duplicated latch silently re-enables the #7330 corruption class it exists to prevent. Move it and re-point all 10 injection sites in one PR.
- `SuperSyncStatusService` → plain engine state + `onPendingOpsStatus` callback; SP shell wraps it back into signals for the header UI.
- `HydrationStateService` → engine `RemoteApplyWindow` state + `onRemoteApplyWindow` callback; the SP shell keeps feeding the capture meta-reducer (`setIsApplyingRemoteOps`) from it. The `RemoteApplyWindowPort` contract already exists in sync-core.
- `SyncCycleGuardService` (same latch family) moves alongside.
*Verify: characterization tests for #7330 latch semantics (set/read across upload/download/conflict paths); full suite.*

**Step 5 — De-rxjs/de-Angular the mid-tier services (v2: NOT purely mechanical).**
Move: vector-clock, lock (`LockPort`), sync-import-filter, upload, download, conflict-resolution, remote-ops-processing, rejected-ops/superseded-op handlers, compaction, snapshot, operation-encryption, `imex/sync/snapshot-upload.service.ts`. The rxjs part is cheap (`firstValueFrom` → port reads; debounce → `setTimeout`; Subject → callback). **The real work (v1 undercounted):** `remote-ops-processing` has 7 snack sites + `selectSyncConfig` reads; `conflict-resolution` has snacks, optional `TranslateService`, and the **dynamic per-entity selector reads** (`:947-978`) that require the registry-driven `state.readEntityById` port; `download` has 2 snack sites. All of these consume the step-1 ports — notifications become semantic codes here, not in step 6.
*Verify: per-service vitest port + facade-routed Karma specs; scheduled SuperSync E2E.*

**Step 6 — Move `operation-log-sync.service.ts` (v2: real work, not "near drop-in").**
The file itself is rxjs-free and sequential, but it injects 16 services. Beyond the mechanical swaps (6 snack sites → `onNotification`, 1 `store.dispatch(loadAllData)` → `state.resetToDefault()`), this step requires:
- **Split `SyncLocalStateService`**: engine predicates (`hasMeaningfulStoreData`, `isWhollyFreshClient`) move; `TranslateService.instant` dialog-string building becomes host-side via `ui.confirmFreshClientSync(info)` receiving structured data.
- **Port `ServerMigrationService`**: its decision logic moves; its `MatDialog` (`:309`) becomes `ui.confirmServerMigration(info)`. Called from deep inside the state machine (`:211,414,648`), so it must land with this step.
- `BackupService` (injects `Store`) stays host-side behind the snapshot/import port; `SuperSyncStatusService` writes go through the step-4 engine state; gate/coordinator services are already port-shaped and move.
*Verify: the 81-test spec ported to vitest against the same outcome unions; scheduled SuperSync E2E.*

**Step 7 — ⚠ Riskiest: split `sync-wrapper.service.ts` + resolve the engine↔engine cycle.**
Into lib `SyncRunner`: the `_syncBody` try block (state machine), the 19-branch error **classifier** emitting semantic `SyncNotification`s, `runWithSyncBlocked` as a promise mutex, `sync()` entry guards, pure predicates (`_isPermissionError`, `_isTimeoutError`), the SuperSync 3-strike auth-tolerance counter, `_syncVectorClockToPfapi`, WS connect/disconnect orchestration + `ws-triggered-download` + `immediate-upload` cores. **v2:** the `sync-wrapper ↔ ws-triggered-download` cycle (today `lazyInject`) and `immediate-upload`'s dual injection are resolved by the engine constructing these subsystems itself and late-binding via setters — design this in step 1's port work. Unify Path-A conflict onto `ui.resolveLocalDataConflict`.
Stays in shell: reaction rendering (code→i18n→snack/alert), all dialog methods, `_promptSuperSyncEncryptionIfNeeded`, streaming observables (`syncInterval$`, `afterCurrentSyncDoneOrSyncDisabled$`), signal wrappers. Provider lifecycle: `SyncProviderManager`'s rebuild-on-config-change logic moves into the engine driven by `config.onChange`; the host keeps only the NgRx `selectSyncConfig` subscription that feeds it.
*Verify: step-0 characterization tests + the 130-test spec split (lib classifier vs shell rendering) + full scheduled E2E matrix incl. multi-tab and encryption suites.*

**Step 8 — ⚠ Invert capture/apply + split the boot hydrator (v2: hydrator now explicit).**
- Capture: `ALL_ACTIONS` effect body → `engine.captureAction()`; host keeps a ~10-line effect. Sync-correctness rules 1–3/6 live here (one intent = one op; replayed ops must not re-trigger effects).
- Apply/hydration: split `operation-log-hydrator.service.ts` — engine half = snapshot load + schema migration + tail replay planning (`engine.hydrate(applyPort)`); host half = legacy PFAPI/archive migration, the four `store.dispatch(loadAllData)` sites, snacks/alerts, `window.ea.reloadMainWin()`. The bulk-dispatch meta-reducer, `setTimeout(0)` flush, and hydration windows stay host-side by design (NgRx-timing-specific).
*Verify: op-log integration specs (ported per the test-gate rule), replay-determinism benchmarks, SuperSync multi-client E2E, TZ matrix runs.*

**Step 9 — Validation port split.**
Generic machinery (repair-op lifecycle, typia-error auto-fix loop shape, entity-id checks) → lib behind `ValidationPort`; SP-typed validators + typia codegen stay app-side as the port implementation.
*Verify: validation + data-repair specs.*

**Step 10 — Reference host + publish.**
Final SP shape: `src/app/op-log` = port implementations + provider factories + dialogs; `imex/sync` = UI. Minimal Node/CLI reference host (doubles as the framework-agnosticism integration test — it would have caught the signals gap). Publish under real names (e.g. `@super-productivity/sync-*`), semver the port interfaces; separate-repo extraction optional and orthogonal.

Granularity: steps 2–3 = several small PRs; step 4 = one PR per singleton (latch PR is atomic across its 10 consumers); steps 5–8 = one focused PR per service, characterization/port tests first.

---

## 5. Risks & unknowns (v2)

- **Resolved by verification:** rxjs (none needed in engine), multi-tab (LockPort suffices), typia (type-only), capture-effect separability, E2EE boundary, all v1 factual claims (fact-check found zero errors).
- **Named and mitigated in v2 (were v1 blind spots):**
  - **Shared-singleton latch** (`SyncSessionValidationService`, #7330): duplicated instances = silent cross-device corruption → step 4 moves it atomically with all 10 consumers; engine exposes the single instance.
  - **Angular signals** in three engine services → explicit ban + three dedicated event-sink ports; ESLint rule catches regressions.
  - **Reactive provider lifecycle** → `config.onChange` push port; provider-manager logic moves into the engine.
  - **Engine↔engine cycle** (`lazyInject`) → engine-internal construction + setter late-binding, designed up front in step 1.
  - **Boot hydrator** → explicit engine/host split in step 8.
  - **Dynamic entity reads** in conflict resolution → registry-driven `state.readEntityById` port.
  - **i18n leakage** → semantic notification codes; host owns code→`T.*` mapping.
  - **Test-gate circularity + TZ matrix** → facade-routed Karma specs during transition; vitest+fake-indexeddb ports required per move; package-level TZ runs.
- **Remaining, real:**
  - The ~20 mid-flow `setSyncStatus` mutations and UI↔engine re-entry make step 7 a careful diff (mitigation: `onStatus` callback + engine handles + step-0 tests).
  - fake-indexeddb vs real Chrome IDB behavioral gaps for ported persistence specs (transaction auto-commit timing) — needs a spike in step 3.
  - Effort: v1's "steps 0–5 are the low-regret core" was over-optimistic. The honest cheap core is **steps 0–3** (characterization tests, scaffold+ports, pure moves, persistence inversion). Steps 4–6 are moderate, coupled work; steps 7–8 touch the most dangerous code in the app and remain deferrable until a second host is imminent.
  - This is a large multi-week effort on the subsystem where bugs silently corrupt user data across devices; the step gates are the point, not overhead.

**Confidence: ~85% on the boundary design and step ordering** (v2 incorporates a full fact-check — zero errors found — plus an adversarial gap review whose blockers are now modeled).
*Verified:* six agent sweeps + direct reads of both orchestrators and their specs; rxjs/signals/typia/broadcast greps; all blocker claims spot-checked by hand.
*Unsure about:* vitest/fake-indexeddb parity for persistence specs; exact effort of steps 5–7 (the dependency web is mapped but not yet sized per-PR); whether the WS-triggered download path has E2E coverage.
*Risks:* behavioral parity in steps 7–8 (sync-correctness invariants) and the session-latch move in step 4 — both gated by characterization-first testing and the scheduled E2E matrix.
