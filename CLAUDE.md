# CLAUDE.md

Guidance for Claude Code working in this repository. Super Productivity is a todo and time-tracking app on Angular + Electron + Capacitor.

## Required reading per task

- Styling changes → [`docs/styling-guide.md`](docs/styling-guide.md)
- User-facing functionality changes → [`docs/documentation-guide.md`](docs/documentation-guide.md)
- Sync, op-log, vector clocks → [`docs/sync-and-op-log/`](docs/sync-and-op-log/)
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

For SuperSync E2E (docker-compose) and the full E2E reference, see [`e2e/CLAUDE.md`](e2e/CLAUDE.md).

## Project rules

- **Translations:** UI strings go through `T` / `TranslateService`. Edit only `en.json`; never other locales.
- **Privacy:** no analytics or tracking — user data stays local unless explicitly synced.
- **Electron:** check `IS_ELECTRON` before using Electron-specific APIs.
- **Templates:** plain HTML, minimal CSS/classes, Angular Material sparingly. See [`docs/styling-guide.md`](docs/styling-guide.md).
- **Strict TypeScript:** no `any` (use `unknown` if truly unknown).
- **State:** never mutate NgRx state — return new objects in reducers. Prefer Signals to Observables.
- **Tests:** add unit tests for new services and state logic.

## Sync-correctness rules

Touched on most state-related PRs. Read the linked source/doc for full reasoning before editing.

1. **Effects use `inject(LOCAL_ACTIONS)`**, never `inject(Actions)` — effects must not run for remote sync ops. For archive-specific side effects on remote clients (writing/deleting from IndexedDB), use `ArchiveOperationHandler` (called by `OperationApplierService`). → `src/app/util/local-actions.token.ts`, `docs/sync-and-op-log/operation-log-architecture-diagrams.md` §8.
2. **Action-based effects only.** Selector-based effects fire on every store change (including hydration/sync replay) and bypass `LOCAL_ACTIONS` filtering; if unavoidable, wrap with the `skipDuringSyncWindow()` operator (or guard with `HydrationStateService.isApplyingRemoteOps()`). → `src/app/features/tag/store/tag.effects.ts`.
3. **Multi-entity changes use meta-reducers**, not effects — one reducer pass = one sync op (e.g. deleting a tag also removes it from every task). → `src/app/root-store/meta/task-shared-meta-reducers/`.
4. **Logical clock:** route "what day is this?" through `DateService` (`getLogicalTodayDate`, `isToday`, `todayStr`). Pure reducers/selectors take `startOfNextDayDiffMs` as an arg and call `isTodayWithOffset` for replay determinism. The raw `DateService.startOfNextDayDiff` is `private`; use `getStartOfNextDayDiffMs()` at service boundaries.
5. **`TODAY_TAG` (`'TODAY'`) is virtual** — never add to `task.tagIds`; membership comes from `task.dueWithTime` or `task.dueDay`. `TODAY_TAG.taskIds` only stores ordering. → `ARCHITECTURE-DECISIONS.md` Decision #2.
6. **Bulk dispatches:** add `await new Promise(r => setTimeout(r, 0))` after the loop — `store.dispatch()` is non-blocking, and without yielding, 50+ rapid dispatches lose state updates. → `OperationApplierService.applyOperations()`.
7. **`SYNC_IMPORT` / `BACKUP_IMPORT`** replace state and intentionally drop concurrent ops (CONCURRENT or LESS_THAN by vector clock) — by design, not a bug. → `SyncImportFilterService`.
8. **Vector clocks:** `MAX_VECTOR_CLOCK_SIZE = 20`. Server prunes after conflict detection, before storage. → `docs/sync-and-op-log/vector-clocks.md`.
9. **Logging:** `Log.log({ id: task.id })`, never `Log.log(task)` or `Log.log(title)` — log history is exportable, never log user content.

## Commit messages

Angular format `type(scope): description`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. Examples: `feat(tasks): add recurring task support`, `fix(sync): handle network timeout`. **Never** `fix(test):` or `fix(e2e):` — test changes use `test:`.

## Anti-patterns

| Avoid                              | Do instead                               |
| ---------------------------------- | ---------------------------------------- |
| `any` type                         | proper types, `unknown` if truly unknown |
| Direct DOM access                  | Angular bindings, `viewChild()`          |
| Side effects in constructors       | `async` pipe or `toSignal`               |
| Subscribing without cleanup        | `takeUntilDestroyed()` or async pipe     |
| `NgModules` for new code           | standalone components                    |
| Re-declaring Material theme styles | existing theme variables                 |
