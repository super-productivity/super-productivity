# AGENTS.md

Guidance for AI agents working in this repository. Super Productivity is a todo and time-tracking app on Angular + Electron + Capacitor.

## Repo map

For task keywords, code entry points, and focused tests, start with the [repository content map](docs/repository-map.md). Follow only the relevant links; this is navigation, not additional required reading in full.

For layer boundaries see the [app map](src/app/README.md); for package ownership and checks see [packages](packages/README.md).

## Product principles

- **Avoid feature creep:** extend existing building blocks; new UI, settings, and sync surface must make users faster. This is a personal deep-work tool, not team management or reporting. Surface the leaner alternative when scope outgrows the problem.
- **Less noise, more depth:** no constant alerts, vanity dashboards, streaks, or dopamine loops. Attention-grabbing behavior ships off by default; reminders remain opt-in.
- **Adapt, don't impose:** prefer one calm default; add a setting only when real workflows diverge. Prefer not building a feature over adding a toggle to dodge a decision.
- **Privacy & offline first:** no analytics, tracking, or telemetry. Core tasks and time tracking work offline; sync and integrations are optional and degrade gracefully.

## Required reading per task

- Styling changes → [`docs/styling-guide.md`](docs/styling-guide.md)
- User-facing functionality changes → [`docs/documentation-guide.md`](docs/documentation-guide.md)
- Sync, op-log, vector clocks → [sync index](docs/sync-and-op-log/README.md), then only the relevant contracts
- Effects/reducers/bulk-dispatch touching synced state → [`docs/sync-and-op-log/contributor-sync-model.md`](docs/sync-and-op-log/contributor-sync-model.md)
- E2E tests → [`e2e/AGENTS.md`](e2e/AGENTS.md); marketing videos → [`e2e/store-video/AGENTS.md`](e2e/store-video/AGENTS.md)
- Load-bearing decisions → [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md)
- Reviewing a feature or PR → [`docs/feature-review-guide.md`](docs/feature-review-guide.md)
- Editing a type in `packages/plugin-api/`, `packages/shared-schema/`, `packages/sync-core/`, `src/app/op-log/core/`, or a model a `MODEL_CONFIGS` slice persists → [`docs/feature-review-guide.md`](docs/feature-review-guide.md) § Long-term cost of a change
- Judging whether a sync bug is real / how severe → [`docs/sync-and-op-log/sync-severity-triage.md`](docs/sync-and-op-log/sync-severity-triage.md)

## Core commands

**Run `npm run checkFile <filepath>` on every modified `.ts` or `.scss` file before reporting work as done.** If root ESLint excludes a package, use formatting plus that package's checks in [packages/README.md](packages/README.md#validation) instead; an ignored file is not a lint pass. Generated files should be regenerated through their owner script.

```bash
npm run checkFile <filepath>   # prettier + lint a single file
npm run prettier               # multi-file format
npm run lint                   # multi-file lint
npm test                       # shared packages + release tooling + Angular specs (Berlin/LA)
npm run test:file <filepath>   # single Angular spec; package tests use package scripts
npm run test:electron          # main-process tests — `electron/*.test.cjs`, NOT .spec.ts
                               # (tsconfig.electron.json excludes *.spec.ts, so a spec
                               #  placed under electron/ silently never runs)
npm run e2e                    # browser E2E, excludes SuperSync/WebDAV
npm run e2e:file <path> -- --retries=0   # single non-sync E2E; add --grep "name"
npm run e2e:supersync:file <path> -- --retries=0   # starts and requires SuperSync
npm run e2e:webdav:file <path> -- --retries=0      # starts and requires WebDAV
npm start                      # Electron dev
npm run startFrontend          # web dev, generates environment constants first
npm run dist                   # validated Electron distribution for the host platform
```

Prefer the [scheduled E2E workflow](.github/workflows/e2e-scheduled.yml) for full provider suites on your branch: `grep` filters SuperSync, `webdav_grep` filters WebDAV, and `run_webdav` enables that job. For focused local runs and prerequisites, read [e2e/AGENTS.md](e2e/AGENTS.md). Provider-switch tests need both servers and both required flags; a single-provider runner alone can still skip them. Skipped tests do not validate a fix.

Do not use `tsc -p tsconfig.json --noEmit` as validation: the root config has `files: []`. Use the relevant app/spec/Electron config or package checks; see [the observed failure](docs/hardening-earns-its-place.md#the-three-failure-modes-worth-remembering).

## Project rules

- **Translations:** `T` holds keys; render with the translate pipe or `TranslateService`. Edit only `en.json`, except when adding placeholders: update every existing translation to interpolate them too. See [translation workflow](docs/TRANSLATING.md).
- **Privacy:** no analytics or tracking — user data stays local unless explicitly synced.
- **Dependencies:** PRs must not add new packages to the root project's `dependencies` or `devDependencies`; use platform APIs, existing packages, or a small in-repo implementation instead. Dependencies scoped to an individual plugin are allowed when they are necessary and remain isolated to that plugin.
- **Electron:** check `IS_ELECTRON` before using Electron-specific APIs.
- **Templates:** plain HTML, minimal CSS/classes, Angular Material sparingly. See [`docs/styling-guide.md`](docs/styling-guide.md).
- **Styling review:** do not locally restyle Angular Material or shared `src/app/ui/` components for one-off context needs. This includes overriding button styles via `.mat-*`, `.mdc-*`, `button[mat-*]`, or component internals in local SCSS. Prefer existing inputs/classes/tokens; if a variant must exist, make it reusable or add it to the shared style layer.
- **Strict TypeScript:** no `any` (use `unknown` if truly unknown).
- **State:** never mutate NgRx state — return new objects in reducers. Prefer Signals to Observables.
- **Tests:** add unit tests for new services and state logic.
- **Service size:** at most 1200 physical lines in `*.service.ts` (specs exempt), enforced by ESLint `max-lines`. Split by responsibility before crossing the cap. Never grow grandfathered offenders; the warning list in `eslint.config.js` may only shrink.
- **Agent-control files:** never modify `AGENTS.md`, `CLAUDE.md`, `.agents/**`, or `.codex/**` unless the user explicitly requests it in the current task. Keep such changes isolated from product/code changes in a dedicated commit or PR, and describe how they alter future agent behavior. When adding an incident-derived rule to this file, keep it to invariant + enforcement + issue/doc pointers and move the narrative to `docs/` — this file must stay skimmable — and date any statistics you cite ("measured YYYY-MM").
- **Hardening needs evidence:** grep for an observed instance before adding a guard; zero instances → record a gap instead. Allowlists may only shrink: fix false positives or scope a justified disable. Verify a check can fail before trusting a pass. [Evidence and rejected approaches](docs/hardening-earns-its-place.md).
- **Does it earn its place?** Verify demand and motivation before judging implementation. A correct feature that adds unjustified complexity should be declined. [Review guide](docs/feature-review-guide.md).
- **Code review:** assess maintenance cost, dependencies, scale, and cross-client behavior. Explicitly check persisted models, the sync wire, and public/plugin APIs on every change touching them, however small. [Long-term cost review](docs/feature-review-guide.md#long-term-cost-of-a-change).
- **Task component is a hot path:** every change to `src/app/features/tasks/task/task.component.*` (rendered once per task in long, scrollable lists) must be double-checked for negative performance impact — avoid function/getter calls in the template, extra change-detection work, and uncleaned subscriptions; verify against a large task list.

## Sync-correctness rules

These apply to state-related work, including feature code. **One user intent = one op; replayed/remote ops must not re-trigger effects.** Read [the contributor model](docs/sync-and-op-log/contributor-sync-model.md) before editing. Sync changes are high-risk: check replay determinism, concurrent/remote edits, vector-clock conflicts, and data-loss failure modes; report material risks before marking the work done.

- **Released clients:** `master` auto-publishes to Play internal, Snap `edge`, and `supersync:latest`. Prove release inclusion with `git tag --contains`; an unreproduced finding is not a false one. [Severity triage](docs/sync-and-op-log/sync-severity-triage.md).
- **Reproduce first:** every sync change starts from a reproducible failure using real data shapes, not a mocked seam. Every sync bug fix needs an exact E2E reproduction written first, failing without the fix and passing with it. Unit tests may supplement it. Only app-unreachable server internals or providers without an E2E harness may use the narrowest real-path test instead; state why in the PR. Question unreproducible hardening rather than adding guards.

1. **Effects inject `LOCAL_ACTIONS`**, never `Actions` (`ALL_ACTIONS` only for the op-log capture effect; remote archive side effects → `ArchiveOperationHandler`, not `ALL_ACTIONS`). Lint-enforced (`no-actions-in-effects`). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `src/app/util/local-actions.token.ts`.
2. **Prefer action-based effects**; a selector-based effect needs `skipDuringSyncWindow()`. Lint-enforced (`require-hydration-guard`). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md).
3. **Multi-entity change = meta-reducer**, not an effect fan-out (one reducer pass = one op). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `src/app/root-store/meta/task-shared-meta-reducers/`.
4. **Logical clock:** route "what day is this?" through `DateService` (`getLogicalTodayDate`, `isToday`, `todayStr`). Pure reducers/selectors take `startOfNextDayDiffMs` as an arg and call `isTodayWithOffset` for replay determinism. The raw `DateService.startOfNextDayDiff` is `private`; use `getStartOfNextDayDiffMs()` at service boundaries.
5. **`TODAY_TAG` (`'TODAY'`) is virtual** — never add to `task.tagIds`; membership comes from `task.dueWithTime` or `task.dueDay`. `TODAY_TAG.taskIds` only stores ordering. → `ARCHITECTURE-DECISIONS.md` Decision #2.
6. **Bulk dispatch loop:** `await new Promise(r => setTimeout(r, 0))` after the loop (else 50+ rapid dispatches lose state). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `OperationApplierService.applyOperations()`.
7. **`SYNC_IMPORT` / `BACKUP_IMPORT`** replace state and intentionally drop concurrent ops (CONCURRENT or LESS_THAN by vector clock) — by design, not a bug. → `SyncImportFilterService`.
8. **Vector clocks:** `MAX_VECTOR_CLOCK_SIZE = 20`. Server prunes after conflict detection, before storage. → `docs/sync-and-op-log/vector-clocks.md`.
9. **Logging:** `Log.log({ id: task.id })`, never `Log.log(task)` or `Log.log(title)` — log history is exportable, never log user content.
10. **Do not bump `CURRENT_SCHEMA_VERSION` by default.** A bump does not protect released clients. New semantics must degrade gracefully (`LwwUpdatePayload` / inert markers); incompatible semantics cannot ship behind a bump alone, and compatible changes do not justify a bump. [Normative bump policy](docs/sync-and-op-log/operation-log-architecture.md#bump-policy--a-bump-does-not-protect-the-released-fleet).
11. **New persisted fields must be optional (`?`) with a runtime default.** Existing on-disk data lacks them; do not assume a heal exists. If [frozen-state.spec.ts](src/app/op-log/validation/frozen-state.spec.ts) fails, fix the model, never the fixture. [Failure analysis and rules](docs/sync-and-op-log/persisted-model-fields.md), #9125, #9124.

## Anti-patterns

| Avoid                                                                      | Do instead                                |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| `any` type                                                                 | proper types, `unknown` if truly unknown  |
| Direct DOM access                                                          | Angular bindings, `viewChild()`           |
| Side effects in constructors                                               | `async` pipe or `toSignal`                |
| Subscribing without cleanup                                                | `takeUntilDestroyed()` or async pipe      |
| `NgModules` for new code                                                   | standalone components                     |
| Re-declaring Material theme styles                                         | existing theme variables                  |
| One-off `.mat-*`, `.mdc-*`, `button[mat-*]`, or shared component overrides | reusable inputs, tokens, or shared styles |
