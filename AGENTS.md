# AGENTS.md

Guidance for AI agents working in this repository. Super Productivity is a todo and time-tracking app on Angular + Electron + Capacitor.

## Product principles

From the project manifesto (_Deep Work, Your Way_), kept to what changes a build decision — weigh them on every feature, and surface the leaner path when a request fights them:

- **Avoid feature creep:** prefer the smallest change that solves the real problem. New UI, settings, and sync surface are permanent costs, so extend existing building blocks before adding new ones, and let a feature ship only if it makes users _faster_, not busier. When scope outgrows the problem, propose the leaner option rather than silently building the larger one — it's still the user's call. Scope guard: this is a personal deep-work tool, not a team-management or reporting product.
- **Less noise, more depth:** reject _constant_ alerts, vanity dashboards, streaks, and dopamine loops. Opt-in reminders and notifications are core to the app, but anything attention-grabbing ships off by default and stays quiet (flow, not friction).
- **Adapt, don't impose:** people plan, track, and reflect differently, so ship new behavior as building blocks. Prefer one calm default over a new toggle; add a setting only when real workflows genuinely diverge, never to dodge a default decision (don't build it → calm default → opt-in setting).
- **Privacy & offline first:** no analytics, tracking, or telemetry (see Project rules → Privacy). Core task and time tracking must work fully offline; sync and online integrations are optional layers that degrade gracefully, never prerequisites.

## Required reading per task

- Styling changes → [`docs/styling-guide.md`](docs/styling-guide.md)
- User-facing functionality changes → [`docs/documentation-guide.md`](docs/documentation-guide.md)
- Sync, op-log, vector clocks → [`docs/sync-and-op-log/`](docs/sync-and-op-log/)
- Effects/reducers/bulk-dispatch touching synced state → [`docs/sync-and-op-log/contributor-sync-model.md`](docs/sync-and-op-log/contributor-sync-model.md)
- E2E tests → [`e2e/CLAUDE.md`](e2e/CLAUDE.md)
- Load-bearing decisions → [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md)

## Core commands

**ALWAYS run `npm run checkFile <filepath>` on every `.ts` or `.scss` file you modify** before reporting work as done.

```bash
npm run checkFile <filepath>   # prettier + lint a single file
npm run prettier               # multi-file format
npm run lint                   # multi-file lint
npm test                       # all unit tests (Jasmine/Karma, .spec.ts co-located)
npm run test:file <filepath>   # single spec
npm run e2e                    # all E2E (Playwright, slow)
npm run e2e:file <path> -- --retries=0   # single E2E (~20s/test); add --grep "name" for one test
npm start                      # Electron dev
ng serve                       # web dev (or npm run startFrontend)
npm run dist                   # production build (all platforms available locally)
```

**Run the full SuperSync and WebDAV E2E suites via GitHub Actions:** manually dispatch [`E2E Tests (Scheduled)`](.github/workflows/e2e-scheduled.yml) for your branch. This should be preferred over running the full suites locally; the workflow provides dedicated WebDAV and sharded SuperSync jobs. The optional `grep` input filters the SuperSync job only.

For local SuperSync E2E (docker-compose) and the full E2E reference, see [`e2e/CLAUDE.md`](e2e/CLAUDE.md).

## Project rules

- **Translations:** UI strings go through `T` / `TranslateService`. Edit only `en.json`; never other locales.
- **Privacy:** no analytics or tracking — user data stays local unless explicitly synced.
- **Dependencies:** PRs must not add new packages to the root project's `dependencies` or `devDependencies`; use platform APIs, existing packages, or a small in-repo implementation instead. Dependencies scoped to an individual plugin are allowed when they are necessary and remain isolated to that plugin.
- **Electron:** check `IS_ELECTRON` before using Electron-specific APIs.
- **Templates:** plain HTML, minimal CSS/classes, Angular Material sparingly. See [`docs/styling-guide.md`](docs/styling-guide.md).
- **Styling review:** do not locally restyle Angular Material or shared `src/app/ui/` components for one-off context needs. This includes overriding button styles via `.mat-*`, `.mdc-*`, `button[mat-*]`, or component internals in local SCSS. Prefer existing inputs/classes/tokens; if a variant must exist, make it reusable or add it to the shared style layer.
- **Strict TypeScript:** no `any` (use `unknown` if truly unknown).
- **State:** never mutate NgRx state — return new objects in reducers. Prefer Signals to Observables.
- **Tests:** add unit tests for new services and state logic.
- **Service size cap:** no service may exceed 1200 lines (physical lines — blanks and comments count), lint-enforced via `max-lines` on `**/*.service.ts`; specs are exempt. Split by responsibility before crossing the line — extract collaborators, move pure logic to utils or `packages/` — and never grow a service past it. A new service over the cap fails lint. The pre-existing offenders (sync/op-log/plugin/task services) are grandfathered to warnings in `eslint.config.js`: that list may only shrink — never add to it — and they are debt to pay down when touched, not a precedent to extend.
- **Code review:** when reviewing new features, always double-check the potential long-term costs and risks a change introduces — maintenance burden, hard-to-reverse choices (data shapes, public/plugin APIs, sync formats), locked-in dependencies/abstractions, and footguns that only surface at scale or across synced clients — not just whether the immediate diff is correct.
- **Task component is a hot path:** every change to `src/app/features/tasks/task/task.component.*` (rendered once per task in long, scrollable lists) must be double-checked for negative performance impact — avoid function/getter calls in the template, extra change-detection work, and uncleaned subscriptions; verify against a large task list.

## Sync-correctness rules

Touched on most state-related PRs. Read the linked source/doc for full reasoning before editing. Rules 1–3 and 6 are one invariant — _one user intent = one op; replayed/remote ops must not re-trigger effects_ — fully explained in [`docs/sync-and-op-log/contributor-sync-model.md`](docs/sync-and-op-log/contributor-sync-model.md).

**Every change to the sync system is high-risk:** a subtle bug can silently corrupt or lose user data across devices and is hard to recover from. Carefully check each change for correctness and possible failure modes (replay determinism, concurrent/remote edits, vector-clock conflicts) and call out the risks before reporting work as done.

1. **Effects inject `LOCAL_ACTIONS`**, never `Actions` (`ALL_ACTIONS` only for the op-log capture effect; remote archive side effects → `ArchiveOperationHandler`, not `ALL_ACTIONS`). Lint-enforced (`no-actions-in-effects`). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `src/app/util/local-actions.token.ts`.
2. **Prefer action-based effects**; a selector-based effect needs `skipDuringSyncWindow()`. Lint-enforced (`require-hydration-guard`). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md).
3. **Multi-entity change = meta-reducer**, not an effect fan-out (one reducer pass = one op). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `src/app/root-store/meta/task-shared-meta-reducers/`.
4. **Logical clock:** route "what day is this?" through `DateService` (`getLogicalTodayDate`, `isToday`, `todayStr`). Pure reducers/selectors take `startOfNextDayDiffMs` as an arg and call `isTodayWithOffset` for replay determinism. The raw `DateService.startOfNextDayDiff` is `private`; use `getStartOfNextDayDiffMs()` at service boundaries.
5. **`TODAY_TAG` (`'TODAY'`) is virtual** — never add to `task.tagIds`; membership comes from `task.dueWithTime` or `task.dueDay`. `TODAY_TAG.taskIds` only stores ordering. → `ARCHITECTURE-DECISIONS.md` Decision #2.
6. **Bulk dispatch loop:** `await new Promise(r => setTimeout(r, 0))` after the loop (else 50+ rapid dispatches lose state). → [contributor-sync-model.md](docs/sync-and-op-log/contributor-sync-model.md), `OperationApplierService.applyOperations()`.
7. **`SYNC_IMPORT` / `BACKUP_IMPORT`** replace state and intentionally drop concurrent ops (CONCURRENT or LESS_THAN by vector clock) — by design, not a bug. → `SyncImportFilterService`.
8. **Vector clocks:** `MAX_VECTOR_CLOCK_SIZE = 20`. Server prunes after conflict detection, before storage. → `docs/sync-and-op-log/vector-clocks.md`.
9. **Logging:** `Log.log({ id: task.id })`, never `Log.log(task)` or `Log.log(title)` — log history is exportable, never log user content.

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
