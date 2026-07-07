# Super Productivity — Complete Architecture Review

**Date:** 2026-07-07
**Method:** Eight parallel subsystem reviews (app shell/state, task domain, issue+plugins, sync/op-log boundaries, Electron+mobile, persistence, UI layer, engineering health), each grounded in code reading with file:line evidence, then cross-verified and synthesized. Builds on — and does not repeat — the dedicated SuperSync/op-log architecture reviews of 2026-06 and 2026-07 (issues #8746–#8760, `docs/plans/2026-07-03-sync-engine-extraction-plan.md`).
**Scope:** ~250k LOC non-spec TS across `src/app` (1,266 files / ~203k LOC), `packages/` (~50k), `electron/` (~9k), plus ~7.1k Kotlin and 217 Swift LOC.

> **Verification addendum (Opus adversarial pass, 2026-07-07).** Every finding below was re-checked against the code and against existing GitHub issues. Technical substance held throughout (no finding fully refuted), but several headline counts were inflated and several findings duplicate already-open issues. Corrected counts and the duplicate map are in the [Verification addendum](#verification-addendum) at the end; the corrections are folded into the finding text below. **Findings that duplicate existing issues were not re-filed** — see the map for cross-references (#8746, #8752, #7913, #8326, #8736, #8476, #8209, #8226, #8299, #8759, #8337, #8770).

---

## Executive summary

The codebase is in **substantially better architectural shape than its size and age would predict**. The patterns that were deliberately engineered — the meta-reducer pipeline with runtime ordering validation, the lint-enforced sync invariants, the sync package boundaries, zoneless change detection with 99.2% OnPush, the single destructive-import path, op-log test density of 2.3:1 spec:source — all *actually hold* when checked against the code. Documentation is unusually honest (3 of 4 spot-checked ADR claims accurate).

The dominant structural risk is a single asymmetry: **everything that is lint-enforced has held; everything that relies on convention has drifted.** The sync packages have zero boundary violations because ESLint rejects them. Inside `src/app`, where no boundary rules exist, there are 65 circular dependencies, a shared UI layer that imports features, a "core" layer that imports features 73 times, an op-log facade that 83 files bypass, and a task store whose internals are imported by ~268 files. The codebase has already proven it knows how to fix this — the mechanism just hasn't been pointed inward.

The second theme is **stalled migrations accumulating as permanent hybrids**: issue-providers→plugins (~15% done by LOC, with a new 2k-LOC built-in added *during* the migration), Signals↔Observables (dual APIs on the highest-fan-in services), Material M2→M3 (the entire theming feature pinned to deprecated APIs via a third-party package), Android's legacy remote-loading runtime alongside Capacitor, and the legacy `pf` database probe with no sunset date. Each hybrid taxes every new feature until someone either finishes it or declares it permanent.

One finding is **time-sensitive**: the SQLite op-log adapter has no transaction serialization, and the staged Android rollout (#8389) plans to share one `SqliteDb` handle between two services. That must be fixed before the flip.

### Per-area health

| Area | Health | One-line verdict |
| --- | --- | --- |
| Sync/op-log + packages | **Strong** | Boundaries hold, tests exceptional; app-facing facade porous; extraction plan not started |
| App shell & NgRx | **Strong** | Meta-reducer discipline is rare-quality; startup orchestration and core-layering are the debt |
| Electron | **Strong** | Correct isolation config, typed IPC enum, tested main process |
| Persistence | **Good** | Single destructive-write path, well-specified dual-backend port; SQLite serialization gap is pre-rollout critical |
| UI layer | **Good** | Modern-Angular adoption near-total; M2 pinning and ui→features inversion are the risks |
| Task domain | **Mixed** | Hot-path discipline excellent; scheduling triple-source-of-truth and TaskService god object at the core |
| Issue + plugins | **Mixed** | Clean polymorphic seam and real migration wins; dual system structurally permanent without contract work; plugin trust model unresolved |
| Engineering health | **Mixed** | Current framework stack, executable invariants; TS strictness contradicts stated policy; 65 cycles; bundle budget 5.5–6 MB |

---

## What is working (keep doing this)

- **Executable invariants.** Four custom ESLint rules (`no-actions-in-effects`, `require-hydration-guard`, `no-multi-entity-effect`, `require-entity-registry`) with their own spec runner; package-boundary `no-restricted-imports` incl. a dynamic-import ban. Verified: zero `inject(Actions)` violations app-wide; zero package-boundary violations.
- **Meta-reducer registry** (`src/app/root-store/meta/meta-reducer-registry.ts`) documents an 8-phase ordering contract and *throws in dev mode* on violation — this directly protects "one reducer pass = one op".
- **Zoneless + OnPush at 249/251 components; control-flow migration 100%** (822 `@if`, zero live `*ngIf`); 5 remaining NgModules, each justified.
- **One sync engine, not two:** file-based providers adapt into the operation-based engine via `OperationSyncCapable`; the feared file-based/SuperSync fork largely doesn't exist (one small triplication, see M-13).
- **Single canonical destructive-write path:** every import/restore funnels into `runDestructiveStateReplacement` — atomic, guarded, spec'd with interrupt injection.
- **Test weight tracks risk:** op-log 142 specs/146 sources (~76.5k spec LOC), server 27.4k spec vs 11.5k src, 20 Electron main-process suites incl. regression guards for removed attack surface (`exec.test.cjs`).
- **Decision discipline:** ARCHITECTURE-DECISIONS.md #5 documents a ~1,750-LOC complexity *removal* with full downstream-cost rationale. Rare and valuable; keep writing these.
- **Hot-path task row:** signal inputs, shared-signal plumbing to avoid 200+ per-row subscriptions, lazy menus, clean teardown; the 387-line template has ~1 non-signal call.

---

## Cross-cutting themes

### Theme 1 — Enforcement asymmetry (the root cause behind most HIGHs)
Lint-enforced boundaries: 0 violations. Convention-only boundaries: 65 circular deps (madge), `ui/ → features/` 26 imports, `core/ → features/` 73 imports, `task.service → task-focus.service → task.component` (a service importing the hot-path component), op-log ↔ `imex/sync` mutual dependency, 83 files deep-importing ~41 op-log internal paths, ~268 files importing `features/tasks` internals (49 the selectors, 25 the reducer). Every planned refactor — sync-engine extraction, task-store evolution, plugin migration — pays this tax first.

### Theme 2 — Documented policy vs. actual configuration
- CLAUDE.md: "Strict TypeScript: no `any`" — but `tsconfig.base.json:18` sets `noImplicitAny: false`, ESLint `no-explicit-any` is **off** (`eslint.config.js:47`), templates use deprecated `fullTemplateTypeCheck` instead of `strictTemplates`, and ~231 non-spec `any` uses exist in `src/app`.
- ADR #3 contains two stale load-bearing claims: `@sp/sync-core` *does* have runtime deps (`@noble/ciphers`, `hash-wasm`), and the claimed shared-schema vector-clock re-export does not exist.
- The styling guide's core prohibitions (hardcoded colors/spacing, `.mat-*` overrides) are enforced by nothing in `.stylelintrc.mjs`; measured drift: 137 `.mat-`/`.mdc-` selectors in 38 component SCSS files, 103 hardcoded px spacings, 6 phantom CSS tokens used as `var()` fallbacks that are defined nowhere.
- Two of the four invariant lint rules are `warn`-only; all four apply only to `**/*.effects.ts` (a `createEffect` in a service file bypasses them — currently zero real occurrences, latent hole).

### Theme 3 — Stalled migrations as permanent hybrids
| Migration | Status | Tax while unfinished |
| --- | --- | --- |
| Issue providers → plugins | 6/14 providers, ~15% by LOC; Plainspace (2k LOC) landed as a *new built-in* mid-migration | ~92 dual-dispatch checks in 18 files; every metadata consumer branches twice |
| Signals ← Observables | ~⅔ migrated; high-fan-in services expose both APIs | Every consumer picks an idiom; `toObservable→toSignal` round-trips; 1 real staleness bug found |
| Material M2 → M3 | Not started; theming pinned to `m2-*` APIs via `angular-material-css-vars@10` | Forced large migration when Material removes M2; 287 `--palette-*` usages downstream |
| Android Capacitor ← legacy remote WebView | Both runtimes fully alive (`LaunchDecider` → `FullscreenActivity` 436 LOC vs `CapacitorMainActivity` 647 LOC) | Everything tested twice; full native bridge exposed to remote content |
| SQLite ← IndexedDB op-log | Adapter done + CI-tested, factory still vends IDB only | Serialization gap (H-6) must land before flip |
| Legacy `pf` DB migration | Probe runs on every fresh-looking startup, forever | No sunset policy; anchors legacy types in `core/persistence` |

**Recommendation:** for each hybrid, make an explicit finish-by / declare-permanent decision and record it in ARCHITECTURE-DECISIONS.md. The most expensive state is the current one — undecided.

### Theme 4 — God files concentrated at the riskiest points
195 files exceed the 300-line house rule; the >1,400 club is precisely the security- and data-critical set: `plugin.service.ts` 2,158, `plugin-bridge.service.ts` 2,145, `operation-log-store.service.ts` 1,937, `sync-wrapper.service.ts` 1,598, `data-repair.ts` 1,586, `task.component.ts` 1,403, `task.service.ts` 1,397 (~59 public methods, 129 importers). No big-bang rewrites warranted — but split-on-touch should be the standing rule for this list, and the seams are already visible (documented per finding).

---

## Findings — HIGH

### H-1. No dependency-direction enforcement inside `src/app`
**Evidence:** 65 circular dependencies (madge, re-derived). Clusters: `op-log/model/model-config.ts` imports ~15 feature reducers while features import op-log back via `root-store/meta/load-all-data.action.ts`; `task.service ↔ task.component` via `task-focus.service`; `imex/sync/sync-wrapper.service` ↔ op-log sync services; `issue.model` ↔ 10 provider models. Inverted layers: `ui/→features/` 26 imports across 9 files (`ui/formly-config.module.ts:18-27`, `ui/datetime-picker/…:33-38`), `core/→features/` 73 imports across 21 files. The op-log facade (`op-log/sync-exports.ts`) covers 14 of ~289 external import statements. Task-store blast radius (re-derived, correcting the initial pass): ~268 files import something from `features/tasks`; `task.selectors` has 49 importers, `task.reducer` 25 (of which ~25 want only `TASK_FEATURE_NAME`). **Overlaps open issue #8299** (tasks↔work-context↔project/tag decoupling + feature-boundary lint), which measured "78 non-spec files" for the tasks-coupling subset.
**Why it matters:** the sync engine can't be built or reasoned about in isolation; the task store's internal shape is de-facto public API with a multi-hundred-file blast radius; the extraction plan's steps 2–8 each become app-wide refactors.
**Direction:** extend the proven package-boundary lint inward, in order of leverage: (1) `no-restricted-imports` on `**/op-log/**` deep paths from outside op-log + 2–3 intentional barrels; (2) ban `ui/ → features/` and relocate/invert the ~10 offending components; (3) per-feature `index.ts` public API starting with `features/tasks` (37 of the 52 reducer importers only need a re-exported `TASK_FEATURE_NAME`); (4) invert `model-config.ts` to the registration pattern `require-entity-registry` already hints at.

### H-2. Scheduling state has three parallel sources of truth, reconciled by hand in every write path
**Evidence:** "when is this task planned?" lives in `task.dueDay`/`dueWithTime` (membership), `TODAY_TAG.taskIds` (today ordering), and `plannerState.days` (future ordering). The generic `updateTask` handler carries ~60 lines of manual reconciliation (`task-shared-crud.reducer.ts:702-759`); `planner.reducer.ts:32-62` and `task-shared-scheduling.reducer.ts:263-264` re-implement the scrubbing; a dedicated repair selector ships because the invariant demonstrably breaks under sync (`work-context.selectors.ts:413-501` + `tag.effects.ts:242`). Decision #1's read pattern (`dueWithTime` first) is re-implemented inline in ~8 places with copy-pasted comments and no shared helper; the generic `updateTask` path does **not** normalize the exclusivity (a raw `{changes:{dueDay}}` on a task with `dueWithTime` leaves both set). Deadlines already added a fourth field pair following the same pattern.
**Why it matters:** every scheduling feature re-learns the reconciliation; per-entity sync conflict resolution can split the three structures on any missed path; failure mode is silent list corruption across devices.
**Direction:** one `applyScheduleChange(state, taskId, change)` helper called by all meta-reducers; one pure `isTaskDueToday`/`getEffectiveDueDay` util next to `isTodayWithOffset` migrated across the 8 read sites; normalize exclusivity in the generic update path. Longer-term: evaluate deriving `plannerState.days` ordering the way `selectTodayTaskIds` already is.

### H-3. Issue-provider→plugin migration is structurally stalled; the dual system trends permanent
**Evidence:** 6 of 14 providers migrated (~40% by count, ~15% by LOC; migrated plugins are 3–8× smaller than their built-in ancestors — LOC figures include specs). The four biggest built-ins (Jira ~3k non-spec, CalDAV, OpenProject, GitLab) are blocked on contract gaps: deterministic task-id generation, `getSubTasks`, worklog/time-posting + status transitions (**5 provider-specific NgRx effect files** still in core: gitlab, jira, nextcloud-deck, open-project, redmine), custom view components. Plainspace landed as a **new ~2k-LOC built-in** three months into the migration (**tracked in #8476**). Dual-dispatch checks (re-derived, correcting the initial "~92"): `hasProvider`(18) + `isPluginIssueProvider`(6) ≈ **24–32 across ~12 non-plugin files**; `dialog-edit-issue-provider.component.ts` (852 lines) is the worst chokepoint. `docs/add-new-integration.md` still teaches the built-in path.
**Direction:** (1) unified provider-descriptor registry for metadata (icon/name/strings/pollInterval) with built-ins registered at startup — kills most of the 92 branches; (2) contract extensions in dependency order (deterministic-id hook and `getSubTasks` are cheap; one generic "post time / transition on task event" hook covers Jira/OpenProject/Redmine/GitLab effects); (3) adopt the rule *no new provider lands in `src/app/features/issue/providers/`* and rewrite add-new-integration.md to lead with the plugin path.

### H-4. Plugin trust model is unresolved while plugins become the recommended delivery vehicle
**Evidence:** code plugins execute via `new Function(...)` in the app's JS context (`plugin-runner.ts:172-186`); `plugin-security.ts` is explicitly advisory; iframe plugins get `sandbox="allow-scripts allow-same-origin"` (same-origin acknowledged re #8467). The only hard boundary is the main-process nodeExecution consent gate (GHSA-hh7g remains open there). Compounding: migrated provider keys (`'GITHUB'`, `'TRELLO'`, …) are *not* reserved (`plugin-bridge.service.ts:430-433` blocks only built-in types), so an uploaded plugin can claim `'GITHUB'` first-wins and receive the user's stored token; `PluginManifest.minSupVersion` is required by the type but never checked by the host; `packages/plugin-api` has 0 spec files at npm version 1.0.1 against a ~60-method surface.
**Why it matters:** "install a plugin" now means "grant full app + `window.ea` access", and the provider-migration strategy (H-3) will tell ordinary users to do exactly that routinely.
**Direction:** make an explicit ADR: either document full-trust-on-install as the permanent model and gate distribution accordingly, or invest in a no-same-origin runtime for the issue-provider plugin class (declarative, needs no DOM — the cheapest class to isolate). Independently and immediately: reserve `MIGRATED_KEYS`, enforce `minSupVersion` at install, add plugin-api contract specs, route `PluginFormField` secrets through the existing secret store instead of synced state.

### H-5. Android runs two complete runtimes; the legacy one attaches the full native bridge to remote content
**Evidence:** `LaunchDecider.kt` routes MODE_ONLINE users to `FullscreenActivity` (loads `https://app.super-productivity.com` remotely) vs `CapacitorMainActivity` (bundled); upgraders with legacy data are pinned ONLINE indefinitely. Both inject the 31-method `@JavascriptInterface` bridge — including `setSuperSyncCredentials(baseUrl, accessToken)` and raw DB read/write — with no origin gating, so XSS on (or compromise of) the web origin becomes native-level access with credential-redirection capability on those devices. Additionally three JS↔native mechanisms coexist (Capacitor plugins; the hand-rolled 31-method bridge where every TS-side method is optional and async calls use a timeout-less promise map; polling queues drained on resume).
**Direction:** define a MODE_ONLINE sunset (one-time migration to offline on next update), then delete `FullscreenActivity` and the duplicated injection path. Until then, gate credential/DB bridge methods on the loaded origin. Converge new native surface on Capacitor plugins (typed, promise-based).

### H-6. SQLite op-log adapter has no transaction serialization — must fix before the #8389 rollout flip
**Evidence:** `sqlite-op-log-adapter.ts:653-671` issues raw `BEGIN…COMMIT` on the shared handle with no queue/mutex; the `OpLogDbAdapter` contract doesn't require callers to serialize; the rollout plan (`sqlite-migration-followup.md` B3) mandates both services share **one** `SqliteDb`. IDB tolerates the app's real concurrent transactions (capture appends vs archive writes vs compaction); on one SQLite connection a second `BEGIN` errors, and non-transactional writes issued mid-transaction silently join the foreign transaction and roll back with it.
**Direction:** promise-chain mutex inside the `SqliteDb` wrapper (or adapter); encode transaction exclusivity into the port contract; add a concurrent-transactions contract test both backends must pass. Do this before the device-gated token flip.

### H-7. TypeScript strictness configuration contradicts the stated policy
**Evidence:** `tsconfig.base.json:18` `noImplicitAny: false` (explicit override of `strict: true`); `eslint.config.js:47` disables `no-explicit-any`; `src/tsconfig.app.json:20` uses deprecated `fullTemplateTypeCheck` instead of `strictTemplates`; ~231 non-spec `any` uses in `src/app` (incl. `planner.selectors.ts:169` `plannerState: any`, 7 `Store<any>`).
**Why it matters:** in a codebase where a silent type hole can corrupt synced data across devices, the strongest compile-time guarantees are off at exactly the config layer — and contributors (and agents) act on the false documented invariant.
**Direction:** enable `strictTemplates` first (catches signal/input mismatches; bounded fallout), flip `no-explicit-any` to `error` with inline disables, ratchet `noImplicitAny` per-directory starting with op-log. If any part is deliberately kept loose, amend CLAUDE.md to say so.

### H-8. Runtime theming is pinned to deprecated Material M2 APIs via a third-party bridge package
**Evidence:** `src/styles/themes.scss:1-10` (`angular-material-css-vars` + `mat.m2-define-typography-config`); `angular-material-css-vars@^10` against Material 21; `global-theme.service.ts:26` injects `MaterialCssVarsService`; ~287 `--palette-*` usages. The entire user-facing theming feature (runtime colors, 14 shipped themes, the theming contract) sits on a package that must be re-released for every Material major, bridging APIs Angular has slated for removal.
**Direction:** generate the `--palette-*` ladder in-house — it's a finite set of custom properties the app already treats as its own token API. The theming-contract layer isolates consumers, so blast radius is contained to `themes.scss` + `global-theme.service.ts`. Plan it deliberately rather than under a forced-upgrade deadline. (Related second cliff, lower urgency: `@ngx-formly/material@7` reaches 47 files and plugin config schemas.)

---

## Findings — MEDIUM (consolidated)

- **M-1. Startup orchestration smeared across four locations** with implicit ordering: 5 `APP_INITIALIZER`s (three constructor-side-effect no-ops, `main.ts:266-307`), `AppComponent` constructor init calls, a magic `setTimeout(1000)` block in `StartupService.init()`, and `DataInitService`'s constructor-dispatch with a literal `// TODO better construction than this`. Sequencing is expressed via three differently-named gate observables. Several past bugs (#7901-class races) are this shape. → One orchestrator with named, awaited phases.
- **M-2. Signals migration stalled at the seam:** high-fan-in services (`GlobalConfigService`, `WorkContextService`, `DataInitStateService`) expose both observable and signal APIs; `toObservable→toSignal` round-trips add timing subtleties where determinism matters. Found one real bug of this class: `task.component.ts:233` `computed(() => this.workContextService.isTodayList)` over a plain mutable boolean — never invalidates, feeds the add/remove-from-today affordances. → Convert the high-fan-in trio first; grep for other computeds over non-signal state.
- **M-3. `TaskService` god object** (1,397 LOC, ~59 methods, 12 deps, 129 importers) mixing CRUD dispatch, move/reorder, time-tracking accumulation, raw-DOM focus management, router navigation, archive queries, and the task factory. → Split along existing seams (`TaskFocusService` exists; tracking belongs near `GlobalTrackingIntervalService`; archive queries on `TaskArchiveService`).
- **M-4. Task model ownership inverted + field sprawl:** `TaskCopy extends Omit<PluginTask,…>` — the core domain type is defined by the published plugin-api package and claws back strictness via 9+ overrides; 35 effective fields (24 optional), 9 scheduling/reminder fields under 3 pairwise conventions, 9 issue fields on every task. → Define `TaskCopy` natively, make the plugin type a derived projection (or structural-compat test); stop the top-level-pair growth pattern for new scheduling concepts.
- **M-5. Two near-duplicate recurrence engines** (`get-newest-possible-due-date.util.ts` 191 LOC backward-scan vs `get-next-repeat-occurrence.util.ts` 219 LOC forward-scan, each with its own `switch (repeatCycle)`), plus 4 projection call sites. Already the source of drift bugs; the RRULE epic needs this seam anyway. → One `occurrencesBetween(cfg, from, to)` core.
- **M-6. Work-context polymorphism leaks:** 78 `WorkContextType` branches in 34 files; mutable snapshot fields consumed with `as string` casts at 29 sites; `inboxWorkContext$` stamps a Project as `type: TAG`; active context derived by URL-string parsing. → Signals instead of snapshot fields; make INBOX honest; absorb per-type behavior into the service.
- **M-7. op-log ↔ `imex/sync` bidirectional tangle** (10 upward imports op-log→imex, 18 downward): the "sync system" has no single root; `imex/` is ~85% sync orchestration by LOC, a pfapi-era naming legacy. Internal op-log layering also inverted: `persistence/` imports `sync/` because base infra (LockService, VectorClockService, session validation) lives in the top orchestration dir. → Move the shared services below both (matches extraction-plan step 4 grouping); relocate `UserInputWaitStateService`, legacy `sync.model` types, OAuth consts.
- **M-8. Backup files carry no enforced schema version:** exports stamp a write-only `crossModelVersion: 4.5` nothing reads; the op-log `schemaVersion` + `MAX_VERSION_SKIP` gate exists only on the sync path; `LocalBackupService` writes bare state with no envelope. Future-schema imports fall through to typia→dataRepair, which can silently strip newer fields. → Stamp `schemaVersion` into the envelope now; refuse/warn on `schemaVersion > CURRENT_SCHEMA_VERSION`.
- **M-9. Multi-tab cache coherence is convention-based:** `_vectorClockCache` requires manual `clearVectorClockCache()`; `_unsyncedCache` self-heals only on appends (an in-place `syncedAt` flip by another tab is invisible — same `lastSeq`); no BroadcastChannel/versionstamp invalidation exists. Failure modes: re-upload of synced ops; ops minted with non-dominating clocks. → Small cross-tab invalidation mechanism (BroadcastChannel or meta revision row).
- **M-10. Enforcement gaps in the enforcement layer:** boundary lint covers 2 of 4 packages (`shared-schema`, `super-sync-server` are eslint-ignored with no own configs); `no-multi-entity-effect` and `require-entity-registry` are warn-only (and the latter has no spec); all four invariant rules key on the `*.effects.ts` filename. → Per-package minimal configs; ratchet warns to errors; widen rule scope or require `createEffect` to live in `*.effects.ts`.
- **M-11. Bundle architecture:** initial budget 5.5–6 MB; 11 of 18 lazy routes funnel into one shared chunk via the `src/app/routes/pages.routes.ts` barrel, silently negating route-level splitting. → Point `loadComponent` at component files directly; ratchet the budget to actual+5%.
- **M-12. Platform-capability abstraction exists but is barely adopted:** 228 `IS_ELECTRON` checks / 72 files, 115 raw `window.ea` refs / 40+ files, 131 `IS_ANDROID_WEB_VIEW` / 37 files, while `core/platform/platform-capabilities.model.ts` is consumed by ~5 files. Same concern (notifications, storage, idle) implemented 3–4× with per-callsite routing. IPC channel→payload types aren't bound (per-call `as` casts over 84 channels; `ea.on` has no unsubscribe). → Grow `core/platform/` into the single injection point, lint-ban new raw `window.ea` outside core; add a channel→{request,response} type map.
- **M-13. Assorted verified structural debt:** `GlobalThemeService` 965 lines spanning ~6 concerns (iOS keyboard geometry, icon registry, wallpaper, StatusBar, charts — extract `MobileViewportService` + `IconRegistryService`); snapshot-for-upload preparation triplicated across the two sync paths (one divergence = one path uploads what the other strips → single `buildUploadSnapshot()`); `SyncProviderId.SuperSync` special-cased at 39 sites instead of capability flags; legacy `pf` DB probe + dialog machinery on every fresh startup with no sunset policy; Material internal-DOM overrides in 38 component SCSS files (worst: `ui/datetime-picker`, 26 occurrences) + 192 `::ng-deep` + stylelint enforcing none of the styling guide; `IssueServiceInterface` bypassed with casts at 3 sites; plugin providers registered late are silently dropped from polling until the next context switch (`poll-issue-updates.effects.ts:41-49` snapshots with `first()`; the 8s boot delay masks it by timing); test-thin spots exactly where op-log discipline doesn't reach (`sync-providers` 33% spec ratio, `plugin-api` 0%); unmaintained deps in the privileged Electron main process (`node-fetch@2`, `electron-localshortcut`, deprecated `@types/electron` stub); Jira as the only provider with a privileged main-process HTTP path (blocks its plugin migration).

---

## Quick wins (verified; low-risk; mostly < 1 day each)

1. **Delete `src/app/pfapi/`** — compiled JS, zero imports (verified), internally broken `require()`s, misleading "load-bearing" header. Real legacy migration lives in `core/persistence/legacy-pf-db.service.ts`.
2. **Fix `task.component.ts:233`** — `computed()` over non-signal `isTodayList`; expose `toSignal(isTodayList$)` on the service. Real staleness bug in the hot path.
3. **`archive-compression.service.ts:85-87`** — switch `Promise.all([saveArchiveYoung, saveArchiveOld])` to the existing `saveArchivesAtomic` (torn-write + replica-divergence window).
4. **Drop dead dependency config** — `postinstall: patch-package` with no `patches/` dir (gratuitous supply-chain surface on every install) and the npm-ignored `resolutions` block.
5. **Fix ADR #3 stale claims** (sync-core runtime deps; nonexistent shared-schema re-export) — it's the designated load-bearing-decisions file.
6. **Replace the 6 phantom CSS tokens** (`--warn-color`, `--primary-color`, `--success-color`, …) with canonical ones (`--color-danger`, `--c-primary`, …) across the 6+ affected dialogs — they currently always render hardcoded hex and ignore themes.
7. **Reserve `MIGRATED_KEYS`** in plugin provider registration (credential-exposure escalation path, survives any future sandbox).
8. **Enforce `minSupVersion`** — one semver check in `validate-manifest.util.ts`.
9. **Ratchet `no-multi-entity-effect` / `require-entity-registry` to `error`** (grandfather with inline disables) and add the missing rule spec.
10. **SHA-pin the 4 tag-pinned workflow actions; replace the one `@master` action ref** with a `github-script` snippet.
11. **Stamp `schemaVersion` into the backup export envelope** + import gate (M-8) — cheap now, hard-to-reverse format decision if delayed.

---

## Suggested sequencing

**Now (safety + in-flight coupling):**
- H-6 SQLite transaction mutex + contract test — *before* the #8389 device-gated flip.
- Quick wins 1–11.
- H-7 step one: enable `strictTemplates`, decide and document the real strictness policy.

**Next (highest structural leverage, enables everything else):**
- H-1 boundary lint inward: op-log facade + deep-import ban → `ui/→features/` ban → `features/tasks` public API. This is also the cheapest de-risking of the sync-engine extraction plan (currently 0/10 steps), worth doing even if extraction never happens.
- H-2 scheduling: `applyScheduleChange` helper + `isTaskDueToday` util + exclusivity normalization in the generic update path.
- H-3/H-4 plugin decisions as ADRs: trust model (sandbox-or-declare), contract extensions, unified metadata registry, "no new built-in providers" rule.
- M-1 startup orchestrator; M-2 signals conversion of the three high-fan-in services.

**Later (planned, not forced):**
- H-8 in-house palette generation (decouple from `angular-material-css-vars` before Material forces it).
- H-5 MODE_ONLINE sunset, then delete `FullscreenActivity`; converge native surface on Capacitor plugins.
- M-4 Task model ownership inversion (next sync-format break is the natural moment for field grouping); M-5 unified recurrence core (align with RRULE epic); M-3/M-13 god-file splits on touch.

---

## Appendix — key metrics

- **Size:** `src/app` 1,266 non-spec TS files / ~203k LOC; features 96.6k (tasks 18.2k, issue 16.8k, schedule 7.1k); op-log 32.7k; ui 16.1k; plugins 13.1k; core 12.7k; packages 49.7k; electron ~9k TS + 114-line Rust helper; android ~7.1k Kotlin; ios 217 Swift.
- **Discipline:** OnPush 249/251; `@if` 822 vs 0 live `*ngIf`; signal inputs 86%; 5 NgModules; 0 `inject(Actions)` violations; 0 package-boundary violations; meta-reducer registry with dev-mode ordering validation.
- **Debt:** 65 circular deps; 195 files > 300 lines (79 > 500, 14 > 1,000); ~231 non-spec `any`; 137 `.mat-*` selector occurrences in 38 component SCSS files; 192 `::ng-deep`; 92 plugin dual-dispatch checks in 18 files; 228 `IS_ELECTRON` / 115 raw `window.ea` refs.
- **Tests:** op-log 142/146 specs (~2.3:1 spec:source LOC); server 27.4k spec vs 11.5k src; features 50% file ratio; sync-providers 33%; plugin-api 0%; 195 Playwright e2e specs; 20 Electron main-process suites.
- **Stack:** Angular 21.2, Material 21.2, NgRx 21.1, Capacitor 8.4, Electron 41.4, TS 5.9 — fully current; 15 runtime deps; Karma/Jasmine (deprecated upstream, no urgency).

---

## Verification addendum

An Opus adversarial pass re-checked every finding against the code and against open GitHub issues. Summary: no finding was fully refuted; the technical facts hold. Two classes of correction were applied above: **inflated counts** (fixed inline) and **duplicates of existing issues** (cross-referenced, not re-filed).

### Corrected counts (initial pass → verified)

| Claim | Initial | Verified |
| --- | --- | --- |
| Files importing `features/tasks` internals | 370 (69 selectors / 52 reducer) | ~268 (49 selectors / 25 reducer) |
| `core/ → features/` imports | 47 | 73 across 21 files (understated) |
| `ui/ → features/` imports | 21 | 26 across 9 files |
| Issue dual-dispatch checks | ~92 / 18 files | ~24–32 / ~12 files |
| Per-provider NgRx effects in core | 9 | 5 provider-specific effect files |
| `activeWorkContextId as string` casts (M-6) | 29 | 17 |
| `imex/sync → op-log` imports (M-7) | 18 | 136 (understated ~7×) |
| `@ngx-formly/material` file reach (H-8) | 47 | 14 |
| `IssueServiceInterface` cast bypasses (M-13) | 3 | 1 |
| `SuperSync` special-case sites (M-13) | 39 | 53 / 18 files (understated) |
| `IS_ELECTRON` / `window.ea` / `IS_ANDROID_WEB_VIEW` (M-12) | 228 / 115 / 131 | 240 / 138 / 160 (all understated) |
| `platform-capabilities` importers (M-12) | ~5 | 2 |
| Phantom CSS tokens (QW6) | 6 | ~7 |

The corrections cut some counts and raise others; in every case the *architectural* conclusion (coupling exists, abstraction under-adopted, boundary un-enforced) is unchanged or strengthened.

### Duplicate map — findings already tracked (NOT re-filed)

| Finding | Existing issue | Overlap |
| --- | --- | --- |
| H-6 SQLite tx serialization | **#8746** | Full — same file/line/fix; already gates the #8389 rollout |
| M-10 / QW9 lint rules warn-only + dead rule | **#8752** | Full (verifier found `require-entity-registry` can never fire — dead rule) |
| M-5 duplicate recurrence engines | **#7913** | Full |
| QW1 delete `src/app/pfapi/` | **#8326** | Full (item 1 of a dead-code sweep) |
| QW8 enforce `minSupVersion` | **#8736** | Full |
| M-4 Task model = plugin type | **#8736** | Partial (same issue's second half) |
| H-4 sandbox the plugin runtime | **#8209**, **#8226** | Full for the sandbox core (iframe opaque-origin work partly landed in #8205) |
| H-3 Plainspace-as-built-in | **#8476** | Full for that sub-point |
| H-1 / M-3 / M-6 tasks coupling + boundary lint | **#8299** | Partial (broader dep-direction thesis is net-new) |
| M-7 / M-13 decomposition debt | **#8759** | Partial (umbrella: god objects, drifted duplicates, op-log boundary) |
| M-9 multi-tab op-log cache | **#8337** | Partial (tail-replay seq race) |
| M-8 / QW11 schema-version gates | **#8770**, **#8765** | Partial (op-log caches + server replay; the *backup-file envelope* angle is net-new) |
| QW6 phantom tokens | **#8417** | Weak/inverse (that issue = declared-but-unused; this = used-but-undeclared) |

### Severity adjustments

- **H-6** — not a new issue; it *is* #8746. Cross-reference only.
- **H-4** — split: the sandbox core is #8209/#8226; the net-new, cheap, security-relevant pieces are **reserve `MIGRATED_KEYS`** (credential-theft path — filed) and the ADR decision. Drop the "GHSA-hh7g remains open" line pending reconciliation with #8512 Phase 2 (the self-grant vector appears closed in this checkout).
- **QW2 / M-2** — the `computed()`-over-boolean at `task.component.ts:233` is a real anti-pattern but **latent**: per-work-context component recreation + `shareReplay(1)` make the realistic failure a narrow first-render race, not guaranteed staleness. Fix it (cheap, correct), but don't headline it as a live hot-path bug. Also: the "dual-API trio" claim was overstated — only `GlobalConfigService` is genuinely dual; `DataInitStateService` exposes 0 signals, `WorkContextService` 1.

### Net-new issues filed from this review

Filed 2026-07-07 (12 issues, #8832–#8843):

| # | Finding | Notes |
| --- | --- | --- |
| [#8832](https://github.com/super-productivity/super-productivity/issues/8832) | H-5 Android legacy MODE_ONLINE runtime | security-relevant |
| [#8833](https://github.com/super-productivity/super-productivity/issues/8833) | H-2 scheduling three sources of truth | ref #8299 |
| [#8834](https://github.com/super-productivity/super-productivity/issues/8834) | H-7 TS strictness vs documented policy | |
| [#8835](https://github.com/super-productivity/super-productivity/issues/8835) | H-8 Material M2 pinning via css-vars | |
| [#8836](https://github.com/super-productivity/super-productivity/issues/8836) | H-1 dependency-direction enforcement | ref #8299 |
| [#8837](https://github.com/super-productivity/super-productivity/issues/8837) | H-3 complete provider→plugin migration | ref #8476, #8209/#8226 |
| [#8838](https://github.com/super-productivity/super-productivity/issues/8838) | M-1 startup orchestration | |
| [#8839](https://github.com/super-productivity/super-productivity/issues/8839) | M-8 backup schema-version envelope | adjacent #8770/#8765 |
| [#8840](https://github.com/super-productivity/super-productivity/issues/8840) | M-11 route-barrel bundle splitting | |
| [#8841](https://github.com/super-productivity/super-productivity/issues/8841) | M-12 platform-capability adoption | |
| [#8842](https://github.com/super-productivity/super-productivity/issues/8842) | QW7 reserve `MIGRATED_KEYS` | credential-exposure path |
| [#8843](https://github.com/super-productivity/super-productivity/issues/8843) | Quick wins checklist | QW3/QW4/QW5/QW6/QW10 + M-2 computed fix |

**Not re-filed** (already tracked): H-6→#8746, M-10/QW9→#8752, M-5→#7913, QW1→#8326, QW8/M-4→#8736, H-4 sandbox→#8209/#8226, and the partial overlaps in the duplicate map above.
