# AGENTS.md

Guidance for AI agents working in this repository. Super Productivity is a todo and time-tracking app on Angular + Electron + Capacitor.

## Repo map

Start with the [repository content map](docs/repository-map.md) (task keywords, code entry points, focused tests) and follow only the relevant links. Layer boundaries: [app map](src/app/README.md). Package ownership and checks: [packages](packages/README.md).

Read by section, not whole: the long sync docs open with a **Sections** index and `ARCHITECTURE-DECISIONS.md` with a **Decisions** index; for any long doc, `rg -n '^#{1,3} ' <file>` gives line numbers for `sed -n`. For large source files, `rg -n` first, then read the range.

## Product principles

Privacy is never traded away; the others are ranked, and the earlier one wins a conflict. In reviews, start with 2.

1. **Privacy & offline first:** no analytics, tracking or telemetry. Data stays local unless the user syncs it or turns on a feature that sends it (AI planning: off by default, own key). Core tasks and time tracking work offline; sync and integrations degrade gracefully.
2. **Avoid feature creep:** extend existing building blocks; new UI, settings and sync surface must make users faster. A personal deep-work tool, not team management, collaboration (#10830) or reporting. Surface the leaner alternative when scope outgrows the problem.
3. **Less noise, more depth:** no constant alerts, vanity dashboards, streaks, gamification or dopamine loops; attention-grabbing behavior ships off, reminders stay opt-in. No always-visible explanatory UI (status lines, "what syncs" labels, badges): explain at the moment it matters (an error, a tooltip, the owning setting).
4. **Fast & keyboard-first:** frequent actions are keyboard-reachable and take few steps (`Call Anna @tomorrow 3pm`, not a form); tighten existing flows rather than add surface.
5. **Adapt, don't impose:** one calm default; add a setting only when real workflows diverge, never to dodge a decision.

## Required reading per task

- Styling → [`docs/styling-guide.md`](docs/styling-guide.md); user-facing functionality → [`docs/documentation-guide.md`](docs/documentation-guide.md); public documentation work → that guide and the [`diataxis` skill](.agents/skills/diataxis/SKILL.md)
- Sync, op-log, vector clocks → [sync index](docs/sync-and-op-log/README.md), then only the relevant contracts. Effects/reducers/bulk dispatch touching synced state → [`contributor-sync-model.md`](docs/sync-and-op-log/contributor-sync-model.md). Judging whether a sync bug is real / how severe → [`sync-severity-triage.md`](docs/sync-and-op-log/sync-severity-triage.md)
- E2E tests → [`e2e/AGENTS.md`](e2e/AGENTS.md); marketing videos → [`e2e/store-video/AGENTS.md`](e2e/store-video/AGENTS.md)
- Load-bearing decisions → [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md)
- Designing a user-facing feature or writing its plan → [`docs/feature-review-guide.md`](docs/feature-review-guide.md) § Does it earn its place? and § Prior art
- Reviewing a feature or PR → [`docs/feature-review-guide.md`](docs/feature-review-guide.md); editing a type in `packages/plugin-api/`, `packages/shared-schema/`, `packages/sync-core/`, `src/app/op-log/core/`, or a model a `MODEL_CONFIGS` slice persists → its § Long-term cost of a change

## Core commands

**Run `npm run checkFile <file...>` on every modified `.ts` or `.scss` file before reporting work as done** (pass all files in one call). If root ESLint ignores a file (e.g. in a package), use formatting plus that package's checks in [packages/README.md](packages/README.md#validation); an ignored file is not a lint pass. Regenerate generated files through their owner script.

```bash
npm run checkFile <files...>   # prettier + lint
npm run docs:public:check      # public docs: Vale, markdownlint, frontmatter, visual, lychee
npm run prettier               # multi-file format
npm run lint                   # multi-file lint
npm run typecheck              # app incl. templates, specs, Electron (not worker/e2e/packages)
npm test                       # shared packages + release tooling + Angular specs (Berlin, LA subset; CI: test:ci, full LA)
npm run test:affected          # Angular specs importing files changed vs master (Berlin + LA subset); `-- --list` to preview
npm run test:file <filepath>   # single Angular spec; package tests use package scripts
npm run test:electron          # main-process tests are electron/*.test.cjs; a .spec.ts there never runs
npm run e2e                    # browser E2E, excludes SuperSync/WebDAV
npm run e2e:file <path> -- --retries=0             # single non-sync E2E; add --grep "name"
npm run e2e:supersync:file <path> -- --retries=0   # starts and requires SuperSync
npm run e2e:webdav:file <path> -- --retries=0      # starts and requires WebDAV
npm start                      # Electron dev
npm run startFrontend          # web dev, generates environment constants first
npm run dist                   # validated Electron distribution for the host platform
```

**Wrap test, lint and E2E runs in `npm run quiet -- <script> [args]`** (e.g. `npm run quiet -- test:affected`, `npm run quiet -- e2e:file <path> --retries=0`): the full output goes to `.tmp/logs/`, and only the pass line (with test counts where the runner prints them), or the last 60 log lines on failure, reach your context. `rg` the printed log path for more.

While iterating on app code, use `npm run test:affected` instead of a full `npm test`. It covers Angular specs only: after editing `packages/*` also run that package's tests, and run `npm test` before opening a PR. It follows static imports, templates and styles; test setup, configs and unimported assets/styles trigger a full run. "Nothing to run" means nothing was tested. CI runs everything (`test:ci`).

For full provider suites prefer the [scheduled E2E workflow](.github/workflows/e2e-scheduled.yml) (`grep` filters SuperSync; `webdav_grep` + `run_webdav` for WebDAV); focused local runs and provider-switch prerequisites are in [e2e/AGENTS.md](e2e/AGENTS.md) (they need both servers and both flags, else they silently skip). Skipped tests do not validate a fix.

`tsc -p tsconfig.json --noEmit` validates nothing (root config has `files: []`); use `npm run typecheck` or package checks ([why](docs/hardening-earns-its-place.md#the-three-failure-modes-worth-remembering)).

## Project rules

- **Translations:** `T` holds keys; render with the translate pipe or `TranslateService`. Edit only `en.json`, except when adding placeholders: then update every existing translation to interpolate them. See [translation workflow](docs/TRANSLATING.md).
- **Dependencies:** never add packages to the root `dependencies`/`devDependencies`; use platform APIs, existing packages or a small in-repo implementation. A plugin may add a necessary dependency isolated to that plugin.
- **Electron:** check `IS_ELECTRON` before using Electron-specific APIs.
- **Templates & styling:** plain HTML, minimal CSS/classes, Angular Material sparingly ([styling guide](docs/styling-guide.md)). Never restyle Angular Material or shared `src/app/ui/` components for a one-off (local `.mat-*`, `.mdc-*`, `button[mat-*]` or component-internal overrides, re-declared theme styles); use existing inputs/classes/tokens/theme variables, or make the variant reusable in the shared style layer.
- **State:** never mutate NgRx state — reducers return new objects. Prefer Signals to Observables.
- **Code style:** no `any` (lint allows it; use proper types or `unknown`); standalone components, no new `NgModules`; bindings and `viewChild()`, not direct DOM access; no side effects in constructors; clean up subscriptions (`takeUntilDestroyed()` or async pipe).
- **Tests:** add unit tests for new services and state logic.
- **Service size:** ≤ 1200 physical lines per `*.service.ts` (specs exempt; ESLint `max-lines`). Split by responsibility before crossing; never grow grandfathered offenders — the per-file caps pinned in `eslint.config.js` may only go down.
- **Agent-control files:** modify `AGENTS.md` or `CLAUDE.md` only when the user explicitly asks in the current task; keep it in a dedicated commit/PR that says how it changes agent behavior. Incident-derived rules here are invariant + enforcement + issue/doc pointer only (narrative goes to `docs/`; this file must stay skimmable); date cited statistics ("measured YYYY-MM").
- **Issues & PRs:** one closing keyword per issue (`Fixes #1, fixes #2`; a list or "Related to" leaves issues open, e.g. #9551); create issues with a type (`gh issue create --type Bug|Feature|Task`).
- **Hardening needs evidence:** grep for an observed instance before adding a guard; zero instances → record a gap instead. Allowlists only shrink (fix false positives or scope a justified disable). Verify a check can fail before trusting a pass. [Evidence](docs/hardening-earns-its-place.md).
- **Does it earn its place?** Verify demand before judging implementation; decline a correct feature that adds unjustified complexity. [Review guide](docs/feature-review-guide.md).
- **Code review:** assess maintenance cost, dependencies, scale and cross-client behavior; on every change touching persisted models, the sync wire or public/plugin APIs, check them explicitly, however small. [Long-term cost](docs/feature-review-guide.md#long-term-cost-of-a-change).
- **Task component is a hot path:** `src/app/features/tasks/task/task.component.*` renders once per task in long lists; double-check every change for performance impact — no template function/getter calls, no extra change detection, no uncleaned subscriptions; verify against a large task list.

## Sync-correctness rules

These apply to all state-related work. **One user intent = one op; replayed/remote ops must not re-trigger effects.** Read [the contributor model](docs/sync-and-op-log/contributor-sync-model.md) before editing. Sync changes are high-risk: check replay determinism, concurrent/remote edits, vector-clock conflicts and data-loss modes; report material risks before marking work done.

- **Released clients:** `master` auto-publishes to Play internal, Snap `edge` and `supersync:latest` (after green sync suites). Prove release inclusion with `git tag --contains`; an unreproduced finding is not a false one. [Severity triage](docs/sync-and-op-log/sync-severity-triage.md).
- **Reproduce first:** every sync change starts from a reproducible failure with real data shapes, not a mocked seam. A sync bug fix needs an exact E2E reproduction written first (fails without the fix, passes with it); unit tests may supplement it. Only app-unreachable server internals or providers without an E2E harness may use the narrowest real-path test instead — say why in the PR. Question unreproducible hardening rather than adding guards.

1. **Effects inject `LOCAL_ACTIONS`**, never `Actions` (`ALL_ACTIONS` only for the op-log capture effect; remote archive side effects → `ArchiveOperationHandler`). Lint: `no-actions-in-effects`. → `src/app/util/local-actions.token.ts`.
2. **Prefer action-based effects**; a selector-based effect needs `skipDuringSyncWindow()`. Lint: `require-hydration-guard`.
3. **Multi-entity change = meta-reducer**, not an effect fan-out (one reducer pass = one op). → `src/app/root-store/meta/task-shared-meta-reducers/`.
4. **Logical clock:** "what day is this?" goes through `DateService` (`getLogicalTodayDate`, `isToday`, `todayStr`). Pure reducers/selectors take `startOfNextDayDiffMs` as an arg and call `isTodayWithOffset` for replay determinism. At service boundaries use `getStartOfNextDayDiffMs()` (the raw field is `private`).
5. **`TODAY_TAG` (`'TODAY'`) is virtual** — never in `task.tagIds`; membership comes from `task.dueWithTime`/`task.dueDay`, `TODAY_TAG.taskIds` only orders. → `ARCHITECTURE-DECISIONS.md` Decision #2.
6. **Bulk dispatch loop:** needs no `setTimeout(0)` yield (capture is synchronous, writes are ordered under the op-log lock, #10441); leave existing yields in place. Prefer one meta-reducer action (rule 3); if a follow-up depends on the loop's ops, await `OperationWriteFlushService.flushPendingWrites()` (never while holding the op-log lock). → [atomicity rule](docs/sync-and-op-log/contributor-sync-model.md#the-atomicity-rule--one-replay-atomic-transition-one-op).
7. **`SYNC_IMPORT` / `BACKUP_IMPORT`** replace state and intentionally drop concurrent ops (CONCURRENT or LESS_THAN by vector clock) — by design, not a bug. → `SyncImportFilterService`.
8. **Vector clocks:** `MAX_VECTOR_CLOCK_SIZE = 20`; the server prunes after conflict detection, before storage. → `docs/sync-and-op-log/vector-clocks.md`.
9. **Logging:** `Log.log({ id: task.id })`, never `Log.log(task)` or a title — log history is exportable; never log user content.
10. **Don't bump `CURRENT_SCHEMA_VERSION` by default.** A bump does not protect released clients; new semantics must degrade gracefully (`LwwUpdatePayload` / inert markers); incompatible semantics cannot ship behind a bump alone, and compatible changes do not justify one. [Bump policy](docs/sync-and-op-log/operation-log-architecture.md#bump-policy--a-bump-does-not-protect-the-released-fleet).
11. **New persisted fields must be optional (`?`) with a runtime default** — on-disk data lacks them; don't assume a heal. If [frozen-state.spec.ts](src/app/op-log/validation/frozen-state.spec.ts) fails, fix the model, never the fixture. [Rules](docs/sync-and-op-log/persisted-model-fields.md), #9125, #9124.
12. **Conflict fixes take generic paths** (field patch, derived membership, admission sets); per-action logic only if none fits, as the smallest safe change, with the reason in the PR. Prove convergence and content preservation in both conflict directions with an E2E. Removing a safety stop alone is not a fix (#10264). → [conflict resolution](docs/sync-and-op-log/contributor-sync-model.md#conflict-resolution--stay-on-generic-paths).
13. **No new denormalized lists or undeclared cross-entity writes** — store the fact on the child and derive membership (true multi-entity transitions still follow rule 3). → same section.
14. **No new crossing may reach the fail-closed stop** (`UnsupportedMultiEntityConflictError`); an added or changed multi-entity action names its resolution path and covers it with an E2E, or is reshaped (one declared entity, fact on the child). → same section.
15. **A sync fix needs evidence of harm** (user report, unreleased-master regression (revert first unless that revives a released bug), or reproduced data loss / sync stop / permanent divergence on a released path); other findings become issues. → [fix intake](docs/sync-and-op-log/contributor-sync-model.md#fix-intake--evidence-before-a-fix).
16. **Sync PR flow:** at most five open (more waits as a draft PR or issue). Before ready, a fresh-context review-and-improve subagent sees only the branch, diff, tracker and [`feature-review-guide.md`](docs/feature-review-guide.md); findings go fixed/not fixed in the PR body's "Review" section, not PR comments. An agent never approves its own sync PR. → same section.

Rules 12–16 are review-enforced.
