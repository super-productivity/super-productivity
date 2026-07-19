# Non-Sync Code Simplification Audit and Backlog

- **Audit date:** 2026-07-16 to 2026-07-17
- **Frozen baseline:** `104043e2d220336d37c96623229640233093f045`
- **Scope:** Manually maintained code outside sync, op-log, WebDAV, SuperSync, vector-clock, conflict, and sync-E2E systems
- **Status:** Discovery, two-pass review, reconciliation, and global risk/reward ranking complete; first implementation batch verified and stashed locally
- **Companion implementation record:** [Audit results and implementation record](plans/2026-07-16-systematic-simplification-audit-results.md)

This is the durable decision record for the audit. The full-review result under each candidate supersedes its preserved discovery-era record whenever they differ. Estimates remain leads for current-`HEAD` revalidation, not implementation promises. Raw manifests and reviewer artifacts remain in the local ignored `.tmp` workspace and are not independently reproducible from this commit.

## Executive summary

- 4,663 tracked files were classified.
- 2,669 eligible paths were accounted for: 2,665 reviewed and four semantically excluded at the sync boundary.
- 116 vertical scouts and 12 blind cross-cutting lenses produced 349 candidate claims and 606 raw rejected leads.
- Seven domain consolidations produced 105 candidate slots. Five whole-candidate duplicates were removed and one overlap was narrowed, leaving **100 unique candidate slots**.
- Every candidate then received two independent reviews: one safety/correctness pass and one maintainability/value pass. Conservative reconciliation produced **26 confirmed, 47 narrowed, 12 deferred, and 15 rejected** findings.
- Three independent rankers globally ordered the original reconciled results. After 27 C06/C07 scopes were materially revised, three fresh reviewers replaced their stale placements against the full final catalog; the other 73 candidates retain their original placements. The actionable backlog is **33 Tier A plus 40 Tier B** findings; ranks 74–85 are deferred Tier C, and ranks 86–100 are rejected.
- The first three implemented findings were verified and stashed at the user's request as stash object `11043158b95aee6a44dfcf4e69315abda4b88704` (message `codex: verified simplification implementation batch`; it was `stash@{0}` at audit time, but stash ordinals are mutable and local).
- Cross-model review was offered after the single-model multi-agent pass and skipped. The result is independently reviewed and ranked, but not cross-model corroborated.

The stashed implementation contains 14 files with one production-code insertion and 514 deletions: 222 production-code lines, 125 test-code lines, 82 test-infrastructure-code lines, 34 comment-only lines, and 51 blank lines. Its net physical reduction is 513 lines. It changes no sync/state code, configuration, dependency, or lockfile.

## How to use this backlog

- **Tier A:** Higher-confidence, lower-risk actionable simplification; a small recorded verification step may still remain.
- **Tier B:** Actionable simplification with greater risk, effort, or uncertainty; an external gate may or may not remain.
- **Tier C:** Deferred; the idea may be valid, but current evidence or value does not justify implementation.
- **Reject:** Do not implement as described. A new proposal must address the recorded failure, and C02-012 must remain outside this non-sync audit.
- **Implemented and stashed:** A verified patch exists locally but is not present in the worktree.
- **Discovery-era record:** Preserved for traceability only. The full-review result, authoritative scope, corrections, and gate control.
- LOC categories remain separate. Production code, test code, test-infrastructure code, comment-only lines, blank lines, configuration, generated code, and moved code must never be combined into one headline number.

## Verification and ranking method

| Stage                           |           Coverage | Independence and decision rule                                                                                                                                            |
| ------------------------------- | -----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and consolidation     |     100 candidates | Scouts, cross-cutting lenses, seven domain consolidations, then cross-domain deduplication                                                                                |
| Safety/correctness review       |     100 candidates | Seven domain reviewers checked behavior, boundaries, paths, tests, and sync exclusion                                                                                     |
| Maintainability/value review    |     100 candidates | Seven different domain reviewers independently checked KISS/YAGNI, abstraction cost, and real LOC value without seeing safety verdicts                                    |
| Conservative reconciliation     |     100 candidates | Material verdict precedence: reject, defer, narrow, confirm; lower validity/reward/confidence and higher risk/effort control                                              |
| Original global ranking         | 3 × 100 placements | Three independent rankers used the original reconciled records; those placements still control the 73 materially unchanged candidates                                     |
| Final-scope replacement ranking |  3 × 27 placements | Three fresh reviewers placed each revised C06/C07 scope against the full final catalog; unknown combined test/test-infrastructure envelopes received no direct LOC credit |

The final order is mean applicable placement within the actionable, deferred, and rejected bands. For 73 unchanged candidates, the applicable placements are R1/R2/R3; for the 27 revised candidates, F1/F2/F3 replace the stale positions. Exact ties prefer lower risk, then lower effort, then higher reconciled priority, then candidate ID. Production/concept removal receives more credit than tests, test infrastructure, configuration, generated code, or comments. This is a relative implementation order, not a promise that adjacent ranks have equal value.

### Placement uncertainty

Controlling placements still disagree by at least 30 positions for four actionable candidates. Their bands remain unchanged; treat their exact rank as lower-confidence and follow the recorded gate:

| Rank | ID      | P1/P2/P3 | Spread | Main source of disagreement                                 |
| ---: | ------- | -------: | -----: | ----------------------------------------------------------- |
|   22 | C02-007 | 13/43/18 |     30 | Exact but very small production deletion                    |
|   42 | C01-010 | 33/64/37 |     31 | Mechanical breadth and list-identity review cost            |
|   44 | C05-012 | 31/66/40 |     35 | Native shared-service breadth versus modest concept removal |
|   45 | C03-008 | 30/65/43 |     35 | Mixed UI scaffolding reward versus scope-splitting cost     |

## Recommended next open batch

These are the first five open findings in the final global order and have disjoint documented scopes. Keep them as separate changes so each proof and rollback boundary stays small.

| Global rank | ID      | Tier | Finding                                                           | Immediate gate                                                          |
| ----------: | ------- | ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
|           3 | C01-005 | A    | Delete the remaining unbound animation triggers and registrations | None.                                                                   |
|           4 | C02-005 | A    | Delete obsolete combined task-change placeholder remnants         | None.                                                                   |
|           5 | C04-001 | A    | Delete the permanently hidden issue-panel intro component         | Capture or add one issue-panel render characterization before deletion. |
|           6 | C01-006 | B    | Prune orphaned optional capabilities from chip-list-input         | Add focused live-contract characterization for both consumers.          |
|           7 | C04-007 | A    | Delete the unused path-based plugin translation loader            | None.                                                                   |

## Final global risk/reward order

All 100 reviewed candidate slots are shown. `P1/P2/P3` are the controlling placements: original R1/R2/R3 for unchanged scopes and focused F1/F2/F3 for revised scopes. `Prior` preserves the stale original positions for revised scopes and shows `same` otherwise.

| Rank | ID      | Verdict | Tier   | Status              |    P1/P2/P3 |   Mean | Pass     |       Prior | Candidate                                                                                |
| ---: | ------- | ------- | ------ | ------------------- | ----------: | -----: | -------- | ----------: | ---------------------------------------------------------------------------------------- |
|    1 | C01-002 | confirm | A      | implemented-stashed |       1/1/1 |   1.00 | original |        same | Delete obsolete duration pipes and parser-migration wrappers                             |
|    2 | C04-015 | confirm | A      | implemented-stashed |       2/2/2 |   2.00 | original |        same | Delete the superseded static procrastination-type catalog                                |
|    3 | C01-005 | narrow  | A      | open                |       3/3/5 |   3.67 | original |        same | Delete the remaining unbound animation triggers and registrations                        |
|    4 | C02-005 | confirm | A      | open                |       4/4/4 |   4.00 | original |        same | Delete obsolete combined task-change placeholder remnants                                |
|    5 | C04-001 | confirm | A      | open                |       6/5/6 |   5.67 | original |        same | Delete the permanently hidden issue-panel intro component                                |
|    6 | C01-006 | confirm | B      | open                |      10/6/3 |   6.33 | original |        same | Prune orphaned optional capabilities from chip-list-input                                |
|    7 | C04-007 | narrow  | A      | open                |      5/7/12 |   8.00 | original |        same | Delete the unused path-based plugin translation loader                                   |
|    8 | C03-009 | confirm | A      | open                |       9/8/8 |   8.33 | original |        same | Trim the obsolete MenuTreeService reactive facade                                        |
|    9 | C03-014 | narrow  | A      | open                |     7/14/11 |  10.67 | original |        same | Delete the orphaned Markdown checklist parser and model                                  |
|   10 | C03-002 | narrow  | A      | open                |      8/15/9 |  10.67 | original |        same | Remove retired Focus Mode overlay navigation and banner scaffolding                      |
|   11 | C01-014 | narrow  | B      | open                |     21/10/7 |  12.67 | original |        same | Delete unused global Sass modules, mixins, placeholders, and theme utilities             |
|   12 | C01-004 | narrow  | B      | open                |    20/11/10 |  13.67 | original |        same | Remove stale tree-DnD preview/state surface and reuse the ancestor utility               |
|   13 | C04-011 | confirm | A      | open                |    11/16/17 |  14.67 | original |        same | Remove obsolete route and breakpoint subscriptions from plugin side-panel buttons        |
|   14 | C02-010 | confirm | A      | open                |    12/18/16 |  15.33 | original |        same | Delete the superseded daily-state calculator                                             |
|   15 | C03-007 | narrow  | A      | open                |    16/19/15 |  16.67 | original |        same | Trim unused Observable/Signal half-pairs from GlobalConfigService                        |
|   16 | C01-007 | narrow  | A      | open                |    19/13/19 |  17.00 | original |        same | Remove the two zero-consumer DialogConfirm modes                                         |
|   17 | C03-010 | narrow  | A      | open                |    14/20/20 |  18.00 | original |        same | Remove dead scaffolding from tag display and quick-menu components                       |
|   18 | C03-011 | narrow  | A      | open                |    15/21/21 |  19.00 | original |        same | Prune displaced worklog presentation scaffolding                                         |
|   19 | C04-004 | narrow  | B      | open                |    22/23/13 |  19.33 | original |        same | Delete the orphaned Jira wonky-cookie authentication path                                |
|   20 | C04-008 | confirm | A      | open                |    17/22/23 |  20.67 | original |        same | Delete the inert custom plugin initializer provider                                      |
|   21 | C02-013 | narrow  | B      | open                |    26/24/14 |  21.33 | original |        same | Remove abandoned estimate UI from PlanTasksTomorrow                                      |
|   22 | C02-007 | confirm | A      | open                |    13/43/18 |  24.67 | original |        same | Remove the unused drag-event time wrapper                                                |
|   23 | C03-015 | confirm | B      | open                |    29/29/22 |  26.67 | original |        same | Remove the test-only keyboard-layout compatibility implementation                        |
|   24 | C04-005 | narrow  | B      | open                |    24/31/25 |  26.67 | original |        same | Replace Redmine ParamsBuilder with request-local parameter objects                       |
|   25 | C05-006 | narrow  | B      | open                |    25/33/26 |  28.00 | original |        same | Delete the orphaned Android process-lifecycle observer and dependency                    |
|   26 | C04-013 | narrow  | B      | open                |    23/34/39 |  32.00 | original |        same | Delete the unreachable Brain Dump line-by-line fallback                                  |
|   27 | C01-008 | narrow  | B      | open                |    27/35/38 |  33.33 | original |        same | Delete verified dead component-scoped selectors and empty style resources                |
|   28 | C01-011 | narrow  | B      | open                |    28/37/36 |  33.67 | original |        same | Replace manual component subscription plumbing with Angular lifecycle bridges            |
|   29 | C03-012 | confirm | A      | open                |    39/41/27 |  35.67 | original |        same | Delete the empty NoteEffects class and registration                                      |
|   30 | C03-001 | narrow  | B      | open                |    35/30/42 |  35.67 | original |        same | Make PanelContentService the single signal-based panel-open authority                    |
|   31 | C03-004 | narrow  | A      | open                |    40/40/28 |  36.00 | original |        same | Finish retiring FocusModeService compatibility members                                   |
|   32 | C02-009 | confirm | A      | open                |    41/42/30 |  37.67 | original |        same | Delete orphaned repeat configurations-with-start-time selector                           |
|   33 | C02-002 | confirm | B      | open                |    37/38/41 |  38.67 | original |        same | Delete orphaned ScheduleService.hasEventsForDay                                          |
|   34 | C01-009 | narrow  | B      | open                |    34/36/46 |  38.67 | original |        same | Prune stale state, selectors, and an unreachable branch from the task row                |
|   35 | C03-005 | narrow  | A      | open                |    38/50/29 |  39.00 | original |        same | Prune obsolete WorkContextService members and dormant pipeline sketches                  |
|   36 | C04-003 | confirm | A      | open                |    42/45/31 |  39.33 | original |        same | Delete the unused calendar-provider-by-id selector                                       |
|   37 | C02-003 | confirm | A      | open                |    43/44/33 |  40.00 | original |        same | Use the iCal loading promise as the sole module cache                                    |
|   38 | C05-013 | confirm | A      | open                |    45/46/32 |  41.00 | original |        same | Remove obsolete StartupService migration-era injections                                  |
|   39 | C06-015 | narrow  | B      | open                |    43/35/48 |  42.00 | focused  |    32/70/45 | Remove unused palettes and glow presets from the Rainbow theme                           |
|   40 | C03-006 | narrow  | A      | open                |    44/51/34 |  43.00 | original |        same | Remove WorkContextService's plain isTodayList mirror                                     |
|   41 | C05-015 | confirm | A      | open                |    46/49/35 |  43.33 | original |        same | Collapse CORS_SKIP_EXTRA_HEADERS identical platform branches                             |
|   42 | C01-010 | narrow  | B      | open                |    33/64/37 |  44.67 | original |        same | Replace legacy @for tracking wrappers with direct identity expressions                   |
|   43 | C04-010 | narrow  | B      | open                |    36/53/47 |  45.33 | original |        same | Delete the disconnected eager PluginService loading subsystem                            |
|   44 | C05-012 | narrow  | B      | open                |    31/66/40 |  45.67 | original |        same | Trim duplicate predicates and unused surface from CapacitorPlatformService               |
|   45 | C03-008 | narrow  | B      | open                |    30/65/43 |  46.00 | original |        same | Delete obsolete create-project theme and issue-provider scaffolding                      |
|   46 | C05-008 | narrow  | B      | open                |    50/32/58 |  46.67 | original |        same | Delete unreferenced legacy Android vectors and empty value resources                     |
|   47 | C07-005 | narrow  | B      | open                |    51/56/39 |  48.67 | focused  |    60/12/24 | Delete the work-context shadow implementation after preserving its unique boundary       |
|   48 | C02-001 | confirm | B      | open                |    52/39/57 |  49.33 | original |        same | Prune unused mirrored schedule layout constants                                          |
|   49 | C05-001 | narrow  | A      | open                |    56/47/55 |  52.67 | original |        same | Delete noncompiled Electron updater, Pomodoro/DBus, and pseudo-API remnants              |
|   50 | C07-013 | narrow  | B      | open                |    52/59/49 |  53.33 | focused  |    62/25/50 | Delete unused non-sync E2E fixture, page, helper, overlay, and barrel surface            |
|   51 | C02-006 | narrow  | B      | open                |    48/72/44 |  54.67 | original |        same | Use running cursors for sequential schedule entries                                      |
|   52 | C06-001 | confirm | A      | open                |    68/46/54 |  56.00 | focused  |    54/26/52 | Delete the superseded commented Snap release pipeline                                    |
|   53 | C01-015 | narrow  | B      | open                |    49/71/48 |  56.00 | original |        same | Trim stale custom-Formly/config boilerplate                                              |
|   54 | C07-008 | narrow  | B      | open                |    60/48/61 |  56.33 | focused  |    68/63/65 | Run shared repeat-config projector cases from one typed matrix                           |
|   55 | C06-004 | confirm | B      | implemented-stashed |    58/61/51 |  56.67 | focused  |     18/9/49 | Delete two browser-side Karma hooks that are no longer loaded                            |
|   56 | C07-004 | narrow  | B      | open                |    55/60/55 |  56.67 | focused  |    64/55/62 | Replace worklog shadow algorithms with focused production calls                          |
|   57 | C07-002 | narrow  | B      | open                |    54/66/52 |  57.33 | focused  |    63/54/60 | Replace the copied planner calendar-selector algorithm with real projector coverage      |
|   58 | C07-015 | narrow  | B      | open                |    56/55/66 |  59.00 | focused  |    72/60/66 | Consolidate plugin upload and API-test smokes into explicit lifecycle journeys           |
|   59 | C07-010 | narrow  | B      | open                |    62/57/59 |  59.33 | focused  |    67/57/61 | Centralize iCalendar envelopes while preserving every raw parser case                    |
|   60 | C06-003 | confirm | A      | open                |    69/51/62 |  60.67 | focused  |    55/48/71 | Remove superseded desktop and MAS alternatives from electron-builder configuration       |
|   61 | C07-014 | narrow  | B      | open                |    57/58/67 |  60.67 | focused  |    71/59/67 | Delete only strict-prefix planner E2E smokes after preserving isolated behaviors         |
|   62 | C07-009 | narrow  | B      | open                |    61/65/58 |  61.33 | focused  |    61/17/51 | Route next/newest recurrence boundary cases through their existing scenario runners      |
|   63 | C06-009 | confirm | B      | open                |    65/64/56 |  61.67 | focused  |    59/27/54 | Delete the never-wired single-test wrapper                                               |
|   64 | C07-011 | narrow  | B      | open                |    63/62/60 |  61.67 | focused  |    66/56/63 | Build simple-counter streak cases from DST-safe offset fixtures                          |
|   65 | C05-002 | confirm | A      | open                |    57/73/56 |  62.00 | original |        same | Delete the unreachable commented Android WebView OPTIONS implementation                  |
|   66 | C07-003 | narrow  | B      | open                |    53/71/65 |  63.00 | focused  |    65/58/64 | Delete reminder-dialog suites that assert only local simulations                         |
|   67 | C06-006 | narrow  | A      | open                |    66/67/57 |  63.33 | focused  |    58/28/53 | Delete the formatter for retired CI performance-metric uploads                           |
|   68 | C07-001 | narrow  | B      | open                |    59/68/63 |  63.33 | focused  |    69/62/68 | Replace PlannerService's copied tomorrow$ implementation with production-connected cases |
|   69 | C06-011 | narrow  | B      | open                |    70/52/70 |  64.00 | focused  |    73/69/73 | Delete unread copyToAssets flags from bundled-plugin metadata                            |
|   70 | C06-002 | confirm | A      | open                |    71/54/68 |  64.33 | focused  |    53/52/70 | Remove the duplicate Node setup from the web release job                                 |
|   71 | C06-007 | confirm | A      | open                |    72/63/71 |  68.67 | focused  |    47/67/72 | Remove ineffective options from the solution-style root tsconfig                         |
|   72 | C07-006 | narrow  | B      | open                |    64/73/73 |  70.00 | focused  |    70/61/69 | Replace the self-testing task-delete unit spec with three real E2E outcomes              |
|   73 | C06-008 | narrow  | B      | open                |    67/72/72 |  70.33 | focused  |    51/68/59 | Remove the unused direct file-saver dependency pair                                      |
|   74 | C01-003 | defer   | C      | deferred            |    77/77/75 |  76.33 | original |        same | Delete the obsolete custom min/max validation layer                                      |
|   75 | C01-001 | defer   | C      | deferred            |    76/76/78 |  76.67 | original |        same | Collapse mentions to its actual text-input contract and one styling owner                |
|   76 | C04-009 | defer   | C      | deferred            |    79/78/76 |  77.67 | original |        same | Remove dormant cached-asset fields from PluginState                                      |
|   77 | C03-013 | defer   | C      | deferred            |    78/79/79 |  78.67 | original |        same | Remove stale NoteComponent inline-editor and input-lifecycle remnants                    |
|   78 | C07-007 | defer   | C      | deferred            |    83/78/76 |  79.00 | focused  |    75/75/80 | Delete superseded and non-discovered Add Task Bar timezone artifacts                     |
|   79 | C02-008 | defer   | C      | deferred            |    81/80/77 |  79.33 | original |        same | Delete unmatched schedule-view stylesheet remnants                                       |
|   80 | C05-005 | defer   | C      | deferred            |    80/81/81 |  80.67 | original |        same | Remove redundant main-window guards after protocol readiness                             |
|   81 | C05-014 | defer   | C      | deferred            |    82/82/83 |  82.33 | original |        same | Conditionally register ElectronEffects instead of creating a false effect field          |
|   82 | C05-011 | defer   | C      | deferred            |    83/83/82 |  82.67 | original |        same | Remove five empty UIApplicationDelegate lifecycle stubs                                  |
|   83 | C06-005 | defer   | C      | deferred            |    85/84/83 |  84.00 | focused  |    74/74/74 | Remove the never-enabled custom macOS notarizer and private shell helper                 |
|   84 | C04-006 | defer   | C      | deferred            |    84/84/84 |  84.00 | original |        same | Resolve the inert PluginCleanupService registry against the sandbox lifecycle plan       |
|   85 | C05-009 | defer   | C      | deferred            |    85/85/85 |  85.00 | original |        same | Re-evaluate the duplicate Objective-C StoreReview plugin shim after iOS widget work      |
|   86 | C02-004 | reject  | reject | rejected            |    86/86/86 |  86.00 | original |        same | Remove disabled schedule-placement debug instrumentation                                 |
|   87 | C01-013 | reject  | reject | rejected            |    88/87/90 |  88.33 | original |        same | Extract the shared planner projection-item SCSS base                                     |
|   88 | C03-003 | reject  | reject | rejected            |    87/88/91 |  88.67 | original |        same | Use one computed signal per Focus Mode main UI state                                     |
|   89 | C02-011 | reject  | reject | rejected            |    91/90/88 |  89.67 | original |        same | Consolidate duplicate simple-counter chart selectors                                     |
|   90 | C05-003 | reject  | reject | rejected            |    89/89/93 |  90.33 | original |        same | Delete obsolete Electron DBus and shell-command store keys                               |
|   91 | C04-002 | reject  | reject | rejected            |    92/91/89 |  90.67 | original |        same | Centralize duplicated issue-field value resolution                                       |
|   92 | C04-012 | reject  | reject | rejected            |    93/92/87 |  90.67 | original |        same | Share the provider build recipe across six issue and two calendar plugins                |
|   93 | C02-014 | reject  | reject | rejected            |    90/93/92 |  91.67 | original |        same | Trim DailySummary dead state/styles and bind focus metrics once                          |
|   94 | C07-012 | reject  | reject | rejected            |    92/91/93 |  92.00 | focused  |    97/97/98 | Keep standalone PluginService and PluginLoader cases in their focused harnesses          |
|   95 | C04-014 | reject  | reject | rejected            |    94/94/94 |  94.00 | original |        same | Delete unreferenced API-test dashboard helpers and write-only sample IDs                 |
|   96 | C05-010 | reject  | reject | rejected            |    95/96/95 |  95.33 | original |        same | Remove only proven-default iOS Capacitor flags; retain the documented keyboard flag      |
|   97 | C05-007 | reject  | reject | rejected            |    96/95/96 |  95.67 | original |        same | Centralize focus-notification activity PendingIntent construction                        |
|   98 | C05-004 | reject  | reject | rejected            |    98/98/97 |  97.67 | original |        same | Consolidate duplicated Electron tray message and cache synchronization                   |
|   99 | C02-012 | reject  | reject | rejected            |    99/99/99 |  99.00 | original |        same | Remove the superseded all-state tag cleanup method                                       |
|  100 | C06-010 | reject  | reject | rejected            | 100/100/100 | 100.00 | focused  | 100/100/100 | Do not retire the still-active hard-coded translation cleanup script                     |

## Complete canonical candidate catalog

Each entry starts with the authoritative full-review result. The subsequent discovery-era record and original evidence are retained to explain how the lead arose; they do not override the reconciled scope, LOC, corrections, gate, or verification.

The following seven domain sections contain all 100 reviewed canonical candidate slots: 73 actionable, 12 deferred, and 15 rejected. Five superseded duplicate slots are recorded separately under cross-domain corrections.

## C01 — Frontend UI, shared components, and global styles (14 candidates)

### C01-001 — Collapse mentions to its actual text-input contract and one styling owner

- **Full-review result:** Rank 75/100; controlling original placements 76/76/78. Safety: defer; maintainability: narrow; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Defer the interaction rewrite. If revived, isolate a textarea-only contract for both live consumers, prove each non-input/config branch unreachable, and keep style ownership as a separate change.
- **Corrected LOC:** production re-estimate after characterization and scope split; comments re-estimate; tests added re-estimate after the textarea behavior matrix is defined; moved exclude the style move from this candidate
- **Material corrections:** There are two live textarea consumers, not one.; Static reachability does not establish caret, focus, IME, input-event, or popup-position equivalence.; The style consolidation is a separate root cause.
- **Primary gate:** Characterize the complete live textarea interaction contract before estimating or editing.
- **Required verification:** Cover keyboard selection, escape, blur, caret insertion, IME, empty results, scrolling, clipping, and both consumers.; Run focused mention/consumer tests, a production build, and real-browser mouse/keyboard checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/ui/mentions/mention.directive.ts` — MentionDirective input/textarea insertion, search, and event surface; `src/app/ui/mentions/mention-utils.ts` — input-only caret coordinate utilities; `src/app/ui/mentions/mention-config.ts` — currently consumed MentionConfig fields; `src/app/ui/mentions/mention-list.component.ts` — current filtering and selection contract; `src/app/ui/mentions/mention-list.component.scss` — owned mention-list styles; `src/styles/components/mentions.scss` — duplicate global overrides.
- **Why it exists:** A generic upstream mentions implementation retained iframe, contenteditable, configurable-mode, output, and global-style surfaces even though every application consumer is an input or textarea using one fixed configuration service.
- **Smallest change:** Characterize textarea insertion, caret/scroll popup placement, substring ranking, keyboard navigation, listShownChange, and contrast; then remove only unreachable iframe/contenteditable and unused configuration/event branches and move the still-required contrast declarations into the owning component.
- **Preserve:** Input/textarea value insertion, selectionStart/setSelectionRange behavior, focus and input-event timing, filtering/ranking, nested triggers, keyboard routing, custom item templates, accessibility, popup placement, and light/dark contrast remain unchanged.
- **Evidence:** The input type excludes iframe/contenteditable, no setIframe caller exists, only MentionConfigService constructs configurations, no template binds the removable outputs, and current contrast tests identify the declarations that must survive.
- **Estimated net change:** production 270–340; comments 0–5; tests -60–0; moved 0–10
- **Gates and overlaps:** task-hot-path-adjacent; internal-export-surface; caret-and-focus-timing; visual-regression; Preserve behavior merged in PRs #7376 and #7504.
- **Verify:** Add focused textarea caret, replacement, scroll, and popup-position characterization tests; Run the mentions unit and contrast specs; Run checkFile on each modified TypeScript/SCSS file and visually smoke-test task-title mentions in light/dark themes.
- **Source findings:** F01-C01; F01-C02; F12-01-C03.

### C01-002 — Delete obsolete duration pipes and parser-migration wrappers

- **Full-review result:** Rank 1/100; controlling original placements 1/1/1. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** implemented-stashed.
- **Authoritative scope:** Use the verified stashed scope: delete the two obsolete duration pipes and specs plus only the unused StringToMs Angular wrapper, injection, helper, and previousMsValue parameter; retain stringToMs, its path, parser tests, and directive duplicate suppression.
- **Corrected LOC:** Production code: 132 lines deleted and 1 line added, for a net reduction of 131. Test code: 125 lines deleted. Comment-only lines: 20 deleted. Blank lines: 33 deleted. Total physical diff for this candidate: 1 insertion and 310 deletions.
- **Material corrections:** The live plain stringToMs parser is explicitly outside the deletion.; Do not apply unrelated paths from any broader stash.
- **Primary gate:** None.
- **Required verification:** Repeat class, pipe-name, template, provider, and path searches.; Re-run focused duration/parser tests, changed-file checks, and the production frontend build.
- **Discovery-era record (superseded):** Implemented, verified, and stashed. **Tier:** Final A. **Classification:** net-new. Rank 2; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/app/ui/duration/duration-from-string.pipe.ts` — DurationFromStringPipe; `src/app/ui/duration/duration-to-string.pipe.ts` — DurationToStringPipe; `src/app/ui/duration/string-to-ms.pipe.ts` — StringToMsPipe wrapper only; `src/app/ui/duration/input-duration.directive.ts` — unused StringToMsPipe injection; `src/app/ui/duration/duration-input.util.ts` — unused previousMsValue parameter.
- **Why it exists:** Legacy Angular pipe and parser-migration adapters remained after consumers moved to the duration functions and directive-local duplicate suppression.
- **Smallest change:** Delete the two zero-consumer pipe files/specs, remove only the StringToMs Angular wrapper and unused directive injection/parameter, and retain the stringToMs function and its file path.
- **Preserve:** Live duration parsing, formatting, seconds support, duplicate suppression, templates, Formly registration, and persisted duration values remain unchanged.
- **Evidence:** Exact class, pipe-name, path, DI, template, registration, build, native, IPC, and plugin searches found no consumers of the deleted pipes; private migration fields are declaration-only.
- **Estimated net change:** production 148–151; tests 126–133
- **Stashed actual and completed verification:** 132 production-code lines, 125 test-code lines, 20 comment-only lines, and 33 blank lines were deleted; one production-code formatting line was added. All modified TypeScript files passed `checkFile`; 342 focused duration/parser Karma tests and the production frontend build passed.
- **Gates and overlaps:** parser-contract.
- **Verify:** Re-run symbol, pipe-name, template, and registration searches; Run duration directive/function specs and checkFile on modified TypeScript files; Compile the frontend.
- **Source findings:** F02-01-C01; F02-01-C03.

### C01-003 — Delete the obsolete custom min/max validation layer

- **Full-review result:** Rank 74/100; controlling original placements 77/77/75. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Do not delete the active directives until a pre-change host/Formly test proves selector activation, error keys/messages, coercion, zero-bound, and dynamic-bound equivalence.
- **Corrected LOC:** production 131; configuration 11; comments 2; tests added 30-45
- **Material corrections:** Module-only usage does not make an Angular directive dead.; The custom validators differ from built-ins for zero bounds and error-object shape.
- **Primary gate:** Prove runtime equivalence for representative Formly fields before deletion.
- **Required verification:** Cover empty, zero, equality, below/above, numeric-string, non-number, and changing-bound cases.; Assert rendered messages and submission validity; run Formly/config tests and a production build.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/ui/validation/max.directive.ts` — MAX_VALIDATOR, MaxDirective; `src/app/ui/validation/max.validator.ts` — maxValidator; `src/app/ui/validation/min.directive.ts` — MIN_VALIDATOR, MinDirective; `src/app/ui/validation/min.validator.ts` — minValidator; `src/app/ui/validation/validation.module.ts` — ValidationModule; `src/app/ui/formly-config.module.ts` — ValidationModule wiring.
- **Why it exists:** An Angular-era custom numeric validator module remained wired into Formly after current forms adopted native/Formly validation paths.
- **Smallest change:** First characterize representative min/max Formly fields, then delete the two directives, two factories, module, and only its Formly import/export wiring.
- **Preserve:** Current numeric min/max acceptance, invalid-state messages, coercion behavior, and form submission gating must match before and after removal.
- **Evidence:** The custom declarations have no direct consumers beyond ValidationModule and its Formly root wiring; the raw audit identified the need for behavioral characterization rather than assuming framework equivalence.
- **Estimated net change:** production 131; configuration 11; comments 2; tests -45–-30
- **Gates and overlaps:** form-validation-semantics; characterization-required.
- **Verify:** Add boundary tests for empty, equal, below/above, numeric-string, and non-numeric Formly values; Run Formly/config and repeat-config specs; Run checkFile and a frontend build.
- **Source findings:** F02-02-C01.

### C01-004 — Remove stale tree-DnD preview/state surface and reuse the ancestor utility

- **Full-review result:** Rank 12/100; controlling original placements 20/11/10. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Split the stale preview/types/state-style deletion from ancestor delegation. Include nav-list-tree.component.ts and tree.utils.spec.ts, and preserve equal-ID false semantics with an explicit guard.
- **Corrected LOC:** production 165-170 across both atomic slices; comments 1; tests added 0-2; tests deleted 1
- **Material corrections:** The canonical file list omitted a production component and utility spec.; Shared isAncestor returns true for identical IDs, unlike the private descendant check.; The two historical roots should land independently.
- **Primary gate:** Refresh paths after the merged tree work and preserve the equal-ID guard.
- **Required verification:** Test self, child, deep descendant, sibling, missing-node, and all drop-position cases.; Run tree/nav tests, changed-file checks, a build, and desktop/touch drag smoke tests.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/ui/tree-dnd/tree.types.ts` — preview-only and obsolete tree types/fields; `src/app/ui/tree-dnd/tree-guards.ts` — isTreeNode; `src/app/ui/tree-dnd/tree.component.ts` — \_traverseNodes, \_isNodeAncestor; `src/app/ui/tree-dnd/tree.utils.ts` — getPath, isAncestor; `src/app/core-ui/magic-side-nav/nav-list/nav-list-tree.component.html` — disconnected treeDragPreview; `src/app/core-ui/magic-side-nav/nav-list/nav-list-tree.component.scss` — obsolete pre-tree-dnd state selectors.
- **Why it exists:** The navigation tree migration left a disconnected custom preview, old state/type/style hooks, and a second ancestor traversal beside a tested utility.
- **Smallest change:** Delete only the disconnected preview and proven-unused types/styles, then delegate the component ancestor check to the existing tested utility without changing live drag/drop event shapes.
- **Preserve:** Tree rendering, drag labels, allowed drop positions, ancestor rejection, node ordering, navigation, keyboard behavior, and emitted move/update events remain unchanged.
- **Evidence:** Consumer searches isolate the preview/state fields to the stale path, current DOM produces none of the obsolete classes, and the utility already implements the same ancestor traversal.
- **Estimated net change:** production 165–170; comments 1; tests -2–1
- **Gates and overlaps:** drag-and-drop-interaction; current-master-path-drift; Rebase/refresh after merged PR #8889.
- **Verify:** Refresh paths against master after merged PR #8889; Run tree-dnd and nav-list specs, including ancestor, invalid-drop, reorder, and nested-folder cases; Run checkFile and browser-smoke drag labels/drop indicators.
- **Source findings:** F03-C01; F03-C02; F05-01-C02.

### C01-005 — Delete the remaining unbound animation triggers and registrations

- **Full-review result:** Rank 3/100; controlling original placements 3/3/5. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete swirlAnimation, slideInFromTopAni, expandFastAnimation, expandAnimationAllowOverflow, and only their imports and registrations, using the actual current symbol names.
- **Corrected LOC:** production 72; tests 0
- **Material corrections:** Two canonical symbol names were stale.; Merged neighboring animation cleanup does not overlap these symbols.
- **Primary gate:** None.
- **Required verification:** Repeat exact symbol and Angular trigger-binding searches.; Run affected tests and changed-file checks; smoke retained neighboring animations.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/ui/animations/swirl-in-out.ani.ts` — swirlAnimation; `src/app/ui/animations/slide-in-from-top.ani.ts` — slideInFromTopAnimation; `src/app/ui/animations/expand.ani.ts` — expandFastAnimation, expandAllowOverflowAnimation; `src/app/features/tasks/task-detail-panel/task-detail-panel.component.ts` — dead swirl registration; `src/app/features/right-panel/right-panel-content.component.ts` — dead slide-in-from-top registration.
- **Why it exists:** Animation variants survived after their template bindings were removed; a current cleanup issue and merged PR independently identify the same category in neighboring animation files.
- **Smallest change:** Delete the two zero-binding files, their two component registrations, and only the two zero-consumer exports in expand.ani.ts; retain shared timing constants and live variants.
- **Preserve:** Every currently bound task-detail, right-panel, and expand animation keeps its trigger name, timing, registration, and visual behavior.
- **Evidence:** Repository-wide trigger and symbol searches find zero @swirl, @slideInFromTop, @expandFast, or @expandAllowOverflow consumers; issue #7874 and PR #8892 independently validate animation-export dead-code cleanup.
- **Estimated net change:** production 72
- **Gates and overlaps:** dynamic Angular animation binding; merged PR #8892 had no current same-file overlap with the retained symbols, but repeat exact-symbol/binding searches at implementation `HEAD`.
- **Verify:** Repeat symbol and Angular trigger-binding searches on current master; Run task-detail/right-panel specs and checkFile; Smoke-test live slide-in-right, task-detail, and expand transitions.
- **Source findings:** F04-01-C03; F04-01-C04; F04-01-C05.

### C01-006 — Prune orphaned optional capabilities from chip-list-input

- **Full-review result:** Rank 6/100; controlling original placements 10/6/3. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Remove the unused additional-action UI, Ctrl+Enter output branch, and host-autofocus timer while retaining the keydown handler and all Cyrillic separator behavior.
- **Corrected LOC:** production 70-78; comments 0-4; tests added 35-55
- **Material corrections:** The key handler is live for Cyrillic separator variants and cannot be deleted wholesale.; The shared component lacks focused characterization.
- **Primary gate:** Add focused live-contract characterization for both consumers.
- **Required verification:** Cover filtering, duplicates, add/remove, focus, separators, and absence of Ctrl+Enter emission.; Run both consumer tests, changed-file checks, a build, and a two-consumer keyboard smoke test.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 6; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/app/ui/chip-list-input/chip-list-input.component.ts` — additional action/toggle inputs, ctrlEnterSubmit, autoFocus timer lifecycle; `src/app/ui/chip-list-input/chip-list-input.component.html` — additional-action and autofocus branches; `src/app/ui/chip-list-input/chip-list-input.component.scss` — additional-action styles.
- **Why it exists:** A reusable component retained optional action, Ctrl+Enter, and host-autofocus modes that neither of its two application consumers binds.
- **Smallest change:** Remove only those unbound inputs, output, button block, helper/imports, timer/cleanup, and matching styles while retaining separator-key handling and all used chip behaviors.
- **Preserve:** Suggestion sorting/filtering, tag rendering, model derivation, add/remove events, keyboard separators including Cyrillic input, and both current call sites remain unchanged.
- **Evidence:** Every optional-surface symbol is self-referential and selector tracing finds two templates, neither of which binds the removable modes.
- **Estimated net change:** production 70–78; comments 0–4; tests -55–-35
- **Gates and overlaps:** shared-component-contract; re-run the closed selector/binding search at implementation head.
- **Verify:** Run both consumer/component specs and add characterization for current keyboard/add/remove behavior; Re-run binding and symbol searches; Run checkFile and visually smoke-test both consumers.
- **Source findings:** F04-01-C01.

### C01-007 — Remove the two zero-consumer DialogConfirm modes

- **Full-review result:** Rank 16/100; controlling original placements 19/13/19. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** After auditing all 45 untyped dialog callers, delete only the unused mode keys, checkbox/forms imports and state, template branches, and mode-only tests; retain the default primitive result/focus contract.
- **Corrected LOC:** production 18-22; tests deleted 135-141
- **Material corrections:** Current HEAD has 45 call sites, not 30.; Untyped MAT_DIALOG_DATA makes the exhaustive caller audit part of the safety proof.
- **Primary gate:** None.
- **Required verification:** Repeat the complete caller/data-key search at implementation HEAD.; Run dialog and representative caller tests plus keyboard, focus, cancel, and result smoke checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/ui/dialog-confirm/dialog-confirm.component.ts` — hideCancelButton, showDontShowAgain, alternate close result; `src/app/ui/dialog-confirm/dialog-confirm.component.html` — hidden-cancel and checkbox branches; `src/app/ui/dialog-confirm/dialog-confirm.component.spec.ts` — unreachable-mode tests.
- **Why it exists:** Two one-off dialog modes and their object-shaped result survived after all production callers converged on the normal cancel/result contract.
- **Smallest change:** Delete the two mode branches and their forms state/imports, always render/focus the existing cancel button, and return the supplied primitive result directly.
- **Preserve:** All 30 production callers keep the existing default button, cancel, title/icon, result, focus, keyboard, translation, and E2E-selector behavior.
- **Evidence:** The mode keys occur only in DialogConfirm and its own tests; none of the production construction sites supplies either key.
- **Estimated net change:** production 18–22; tests 135–141
- **Gates and overlaps:** widely-shared-dialog; focus-and-return-contract.
- **Verify:** Re-run all DialogConfirm call-site key searches; Run DialogConfirm and representative caller specs; Run checkFile and keyboard/focus smoke tests.
- **Source findings:** F04-01-C02.

### C01-008 — Delete verified dead component-scoped selectors and empty style resources

- **Full-review result:** Rank 27/100; controlling original placements 27/35/38. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Keep this record only for the 62-line main-header encapsulation/extraction cleanup. Split every other component/page into its own candidate and defer file-imex behind PR #8456.
- **Corrected LOC:** production 62; comments 0; tests 0
- **Material corrections:** The catalog batch combines unrelated CSS histories and rollback surfaces.; PR #8456 invalidates the file-imex slice until rebase and re-audit.; The omitted plugin-config comment-only stylesheet, if retained, needs its own candidate.
- **Primary gate:** Implement only an atomic component-owned slice; re-audit file-imex after PR #8456.
- **Required verification:** For the retained header slice compare computed styles in light/dark and both action-bar modes, including Electron drag regions.; Run the SCSS check, production build, and focused visual/browser smoke checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `src/app/core-ui/main-header/main-header.component.scss` — stranded child-component selectors; `src/app/core-ui/magic-side-nav/magic-side-nav.component.html` — disabled mobile opener; `src/app/core-ui/magic-side-nav/magic-side-nav.component.scss` — .mobile-menu-open; `src/app/core-ui/folder-context-menu/folder-context-menu.component.ts` — empty styleUrls resource; `src/app/app.component.scss` — obsolete Material drawer/right-panel selectors; `src/app/pages/scheduled-list-page/scheduled-list-page.component.scss` — old scheduled-list selectors; `src/app/imex/file-imex/file-imex.component.scss` — retired paste-import selectors; `src/app/pages/search-page/search-page.component.scss` — unreachable narrow-screen result branch.
- **Why it exists:** Markup/component extractions and workflow replacements removed DOM producers, but encapsulated selectors, a disabled prototype, and comment-only style resources remained.
- **Smallest change:** Delete only selectors with no reachable DOM producer, the disabled opener/comment-only files, and FolderContextMenu's no-op style reference; do not restyle live Material/shared UI.
- **Preserve:** Compiled CSS for reachable markup, component encapsulation, current mobile navigation, scheduled/search layouts, import controls, themes, and breakpoints remain unchanged.
- **Evidence:** Exact class/template searches, emulated-encapsulation boundaries, and file-content checks prove the targets are unreachable or emit no CSS; the grouping is implementation-batchable by component rather than a global rewrite.
- **Estimated net change:** production 163; comments 23
- **Gates and overlaps:** visual-regression; material-internal-dom; responsive-layout; scheduling-page; Classify the batch conflicting/B pending PR #8456 revalidation; split out file-imex styling if new attachment markup revives a selector.
- **Verify:** Diff compiled CSS and require changes only to unreachable selectors; Run checkFile for every changed TS/SCSS file and a production build; Visually smoke-test header, mobile side nav, scheduled/search pages, and file import across narrow/wide and light/dark modes.
- **Source findings:** F05-01-C01; F05-01-C03; F06-folder-menu-empty-style-resource; L08-C02; F10-01-C01; F10-01-C02; F10-01-C03; F10-02-C02.

### C01-009 — Prune stale state, selectors, and an unreachable branch from the task row

- **Full-review result:** Rank 34/100; controlling original placements 34/36/46. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Retain only the unused task-row computed and exact dead component-scoped selector members. Review the independently evolved hover-icon branch separately and preserve live time-badge/global theme rules.
- **Corrected LOC:** production re-estimate for the stale-state/style-only slice; comments re-estimate; reviewer counts differ because their corrected scopes differ; tests added re-estimate after the hot-path slice is isolated
- **Material corrections:** The state/styles and hover branch have different root causes.; Only the repeat-date-badge selector member is dead inside a grouped live rule.; Task-row large-list performance review is mandatory.
- **Primary gate:** Isolate the hot-path state/style slice and verify exact selector members before editing.
- **Required verification:** Run task/list tests, changed-file checks, and representative row-state visuals.; Inspect a large task list for change-detection, scrolling, and hover regressions.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/tasks/task/task.component.ts` — isRepeatTaskCreatedToday; `src/app/features/tasks/task/_task-controls.scss` — seven obsolete task-row selectors; `src/app/features/tasks/task/task-hover-controls/task-hover-controls.component.html` — unreachable issue-updated icon branch.
- **Why it exists:** Task controls moved to child components and icon conditions evolved, leaving an unread computed signal, encapsulated selectors without DOM producers, and a boolean-impossible inner branch.
- **Smallest change:** Delete the unread signal and enumerated selectors, and collapse only the inner icon conditional whose outer guard already proves the same state.
- **Preserve:** Task-row rendering, hover controls, issue-update affordances, schedule/time badges, themes, focus, and change-detection cost for live behavior remain unchanged.
- **Evidence:** Exact symbol/class searches prove no consumers under emulated encapsulation, while the outer template guard logically makes the alternate icon branch unreachable.
- **Estimated net change:** production 61–68; comments 2–4; tests -35–0
- **Gates and overlaps:** task-hot-path; large-list-performance; visual-regression.
- **Verify:** Run task and hover-control specs plus checkFile; Test a large task list for render/hover regressions and inspect change-detection behavior; Smoke-test issue-updated and normal detail-panel icons.
- **Source findings:** P01-C01; P01-C02.

### C01-010 — Replace legacy @for tracking wrappers with direct identity expressions

- **Full-review result:** Rank 42/100; controlling original placements 33/64/37. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete orphan wrappers first, then convert live wrappers in small owning-component batches using exact identity expressions; review task.component alone and keep icon-input/select-project ownership here.
- **Corrected LOC:** production 69-93 aggregate; re-estimate each implementation batch; comments 0-1; tests re-estimate by batch because one reviewer found deletion and the other required additions
- **Material corrections:** The reconciled inventory is 23 wrappers across 22 units.; A focus-mode spec directly tests one wrapper.; The task-row wrapper requires separate hot-path verification.; A repository-wide mechanical batch is not the smallest clean change.
- **Primary gate:** Maintain a per-loop identity table and land small component-owned batches.
- **Required verification:** Compare every direct expression to its helper body and run affected tests.; Run changed-file checks, a production build, reorder/insert/delete smoke tests, and large-task-list verification.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** 23 unique wrappers across the following 22 component units. Each live wrapper affects the named TypeScript file and its adjacent template; the two wholly orphaned units are TypeScript-only:
  - `src/app/features/config/config-section/config-section.component.{ts,html}` — `trackByIndex`
  - `src/app/features/config/icon-input/icon-input.component.{ts,html}` — `trackByIndex`
  - `src/app/features/config/repeat-section-type/repeat-section-type.component.{ts,html}` — `trackByFn`
  - `src/app/features/config/select-project/select-project.component.{ts,html}` — `trackById`
  - `src/app/features/focus-mode/focus-mode-main/focus-mode-main.component.{ts,html}` — `trackById`
  - `src/app/features/issue/issue-content/issue-content.component.{ts,html}` — `trackByIndex`
  - `src/app/features/issue/providers/jira/jira-view-components/dialog-jira-transition/dialog-jira-transition.component.{ts,html}` — `trackByIndex`
  - `src/app/features/issue/providers/jira/jira-view-components/jira-cfg/jira-additional-cfg.component.{ts,html}` — `trackByCustomFieldId` and orphaned `trackByIssueId`
  - `src/app/features/issue/providers/open-project/open-project-view-components/dialog-openproject-transition/dialog-open-project-transition.component.{ts,html}` — `trackByIndex`
  - `src/app/features/metric/impact-stars/impact-stars.component.{ts,html}` — `track`
  - `src/app/features/note/note/note.component.{ts,html}` — `trackByProjectId`
  - `src/app/features/schedule/schedule-week/schedule-week.component.{ts,html}` — `trackEventKey`
  - `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.{ts,html}` — `trackByIndex`
  - `src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.{ts,html}` — `trackById`
  - `src/app/features/tasks/select-task/select-task.component.{ts,html}` — `trackById`
  - `src/app/features/tasks/task-attachment/dialog-edit-attachment/dialog-edit-task-attachment.component.{ts,html}` — `trackByIndex`
  - `src/app/features/tasks/task-attachment/task-attachment-list/task-attachment-list.component.{ts,html}` — `trackByFn`
  - `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.{ts,html}` — `trackByProjectId`
  - `src/app/features/tasks/task-list/task-list.component.{ts,html}` — `trackByFn`
  - `src/app/features/tasks/task/task.component.{ts,html}` — `trackByProjectId`
  - `src/app/features/tasks/tasks-by-tag/tasks-by-tag.component.ts` — orphaned `trackById`
  - `src/app/features/work-view/backlog/backlog.component.ts` — orphaned `trackByFn`
- **Why it exists:** The control-flow migration retained class methods whose sole purpose is returning the same id, index, or id/index fallback now accepted directly by Angular @for.
- **Smallest change:** Substitute each exact method body in its track clause, delete only the now-unreferenced helper/import, and review the guarded task-row change separately.
- **Preserve:** DOM identity, row reuse, ordering, insertion/deletion behavior, fallback-to-index semantics, and rendering performance remain identical.
- **Evidence:** Every eligible helper is a one-expression wrapper with one template consumer or no consumer. L04-C02 identified 22 wrappers after excluding `TaskComponent`; P01-C04 repeated `TaskListComponent.trackByFn` and added only `TaskComponent.trackByProjectId`, producing a 23-wrapper unique union rather than the mechanically summed 24.
- **Estimated net change:** production 69–93; comments 0–1
- **Gates and overlaps:** multi-file mechanical edit; list identity; task hot path; this candidate exclusively owns the `icon-input` and `select-project` tracking-wrapper slices formerly bundled into C01-015; review the guarded `task.component` edit separately.
- **Verify:** Compare every replacement expression with its helper body one by one; Run affected component specs and focused reorder/insert/delete smoke tests; Run checkFile per file and test a large task list.
- **Source findings:** L04-C02; P01-C04.

### C01-011 — Replace manual component subscription plumbing with Angular lifecycle bridges

- **Full-review result:** Rank 28/100; controlling original placements 28/37/36. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Limit this record to teardown-only conversions in DialogUnsplash, DialogTrackTime, SelectTaskMinimal, FormlyTranslated, and SnackCustom. Exclude PluginPanelContainer, PlayButton, and intentionally non-lifecycle subscriptions.
- **Corrected LOC:** production 25-40; comments 0; tests added 0-30 for the retained slice; re-estimate per component
- **Material corrections:** The catalog combines teardown substitution, plugin store-to-signal mirroring, and derived-state conversion.; PluginPanelContainer crosses a plugin boundary and PlayButton changes update ordering.; The Unsplash download subscription is intentional and remains.
- **Primary gate:** Prove post-destroy behavior for each retained component; route excluded semantic rewrites to independent reviews.
- **Required verification:** Destroy fixtures with streams active and assert no later callback or side effect.; Run focused tests, changed-file checks, and a production build.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/ui/dialog-unsplash-picker/dialog-unsplash-picker.component.ts` — \_destroy$; `src/app/features/issue/shared/dialog-track-time/dialog-track-time.component.ts` — _onDestroy$; `src/app/features/tasks/select-task/select-task-minimal/select-task-minimal.component.ts` — \_destroy$; `src/app/ui/formly-translated-template/formly-translated-template.component.ts` — single-entry \_subs; `src/app/core/snack/snack-custom/snack-custom.component.ts` — single-entry \_subs; `src/app/plugins/ui/plugin-panel-container/plugin-panel-container.component.ts` — store-to-signal mirror subscription; `src/app/core-ui/main-header/play-button/play-button.component.ts` — derived visibility subscription.
- **Why it exists:** Components predate takeUntilDestroyed/toSignal or mirror values already present as signal inputs, so they manually allocate Subjects, Subscription containers, and derived-state subscriptions.
- **Smallest change:** Use injected DestroyRef with takeUntilDestroyed for imperative subscriptions, toSignal for the filtered store bridge, and computed for currentTask-derived visibility; preserve operator order and leave intentionally non-lifecycle subscriptions alone.
- **Preserve:** Debounce, filtering, callbacks, logging, last-non-null plugin id, Formly translation, snack dismissal, task-estimate visibility, and destruction timing remain unchanged.
- **Evidence:** The notifier Subjects have no observers beyond takeUntil, each Subscription container stores one entry, the store bridge is a direct mirror, and the play button already receives the value from which its extra subscription derives state.
- **Estimated net change:** production 42–65; comments 2–4; tests -70–0
- **Gates and overlaps:** subscription-teardown; plugin-ui-boundary; formly-dynamic-lifecycle; C01-012 touches a different dead notifier in FocusModeOverlay.
- **Verify:** Destroy fixtures with streams active and assert no later callback/output; Test plugin id open/close/switch semantics and play-button task changes; Run focused specs and checkFile on all modified TypeScript files.
- **Source findings:** L05-C02; L05-C03; L05-C04; F05-02-C02-derived-time-estimate-signal.

### C01-013 — Extract the shared planner projection-item SCSS base

- **Full-review result:** Rank 87/100; controlling original placements 88/87/90. Safety: confirm; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Leave the two component-local copies and reconsider only if a third projection component needs the same styling contract.
- **Corrected LOC:** accepted production 0; accepted moved 0; proposed production net removed 38-47; proposed moved 45-49; tests 0
- **Material corrections:** This is duplication extraction, not removal of an obsolete concept.; It adds a new partial/mixin and moves live styles for only two consumers.; C02-015 remains a superseded duplicate and contributes no LOC.
- **Primary gate:** None.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/planner/planner-deadline-task/planner-deadline-task.component.scss` — host/item/title base rules; `src/app/features/planner/planner-repeat-projection/planner-repeat-projection.component.scss` — host/item/title base rules; `src/app/features/planner/_planner-projection-item.scss` — proposed narrowly scoped projection-item mixin.
- **Why it exists:** Deadline and repeat projection components independently carry the same 49-line encapsulated style prefix.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** The complete first 49 lines are textually identical; the styling guide and local shared-SCSS patterns support a component-local mixin rather than a global override.
- **Rejected historical estimate:** Zero LOC is authorized. production 38–47; moved 45–49
- **Gates and overlaps:** visual-regression; scss-encapsulation; C02-015 is superseded by this candidate and its speculative calendar-row extension is excluded.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** L08-C01.

### C01-014 — Delete unused global Sass modules, mixins, placeholders, and theme utilities

- **Full-review result:** Rank 11/100; controlling original placements 21/10/7. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Land five exact Sass-graph deletions separately. Retain src/\_common.scss and src/styles/mixins/\_mixins.scss, removing only the named use/forward lines, and keep runtime utility selectors in a separately browser-verified slice.
- **Corrected LOC:** production 171; configuration replaced 1; comments re-estimate; reviewers count 1 versus 28 under different category boundaries; tests 0; moved 0
- **Material corrections:** Two live Sass facade files must remain.; The catalog combines five risk-distinct graphs.; C06-013 and C06-014 are superseded subsets and must not be double-counted.
- **Primary gate:** Repeat the Sass graph/dynamic-class search and review the compiled-CSS delta for each atomic slice.
- **Required verification:** Confirm only intended module edges and selectors disappear from production CSS.; Run changed-SCSS checks, a production build, and representative built-in/custom theme smoke tests.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 8; challenges: refuter narrowed, maintainer confirmed.
- **Scope:** `src/styles/components/fab-wrapper.scss` and its forward in `src/styles/components/_components.scss`; `src/_common.scss` and `src/styles/extends/_extends.scss`, `_clearfix.scss`, and `_list-reset.scss`; `src/styles/utilities/_css-migration-helpers.scss`; `src/styles/mixins/_mixins.scss`, `_pseudo.scss`, `_responsive-ratio.scss`, plus `standardThemeTextColor`, `standardThemeTextColorLessIntense`, `standardThemeTextColorMostIntense`, `layerTextAndBgHigher`, `layerTextAndBgHighest`, `dividerBorderColor`, and `flatBox` in `_theming.scss`; the `.bg-card`, `.bg-200`, `.bg-400`, `.bgc-400`, `.bg-600`, `.cc-600`, `.bg-600i`, `.bgc-800`, `.mat-lighter`, `.mat-darker`, and `.color-contrast` blocks in `src/styles/themes.scss`; and the obsolete fab-wrapper inventory entry in `docs/styling-guide.md`.
- **Why it exists:** Successive styling migrations left unreferenced Sass entry points and exported helpers plus global utility classes whose DOM consumers disappeared.
- **Smallest change:** Delete only zero-import/zero-include modules, their forwarding lines, and exact zero-consumer selectors; update the styling-guide inventory for the removed fab wrapper.
- **Preserve:** Compiled CSS for reachable classes, theme token generation, Material theming, light/dark custom themes, breakpoints, and all live mixins remain unchanged.
- **Evidence:** Sass import/forward/include/extend searches prove the modules and helpers are unwired, while exact class searches find no DOM producers for the selected theme utilities.
- **Estimated net change:** production 171; comments 1
- **Gates and overlaps:** global-style-graph; runtime-custom-themes; dynamic-class-consumers; C06-013 and C06-014 are superseded subsets; repeat dynamic-class and Sass-graph searches at implementation head.
- **Verify:** Repeat Sass graph and DOM/class searches on current master; Compare production compiled CSS before/after and run the frontend production build; Run checkFile on every changed SCSS file and smoke-test representative built-in/custom themes.
- **Source findings:** F12-01-C01; F12-01-C02; F12-02-C1; F12-02-C2; F12-02-C3.

### C01-015 — Trim stale custom-Formly/config boilerplate

- **Full-review result:** Rank 53/100; controlling original placements 49/71/48. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** After PRs #9092 and #6748 are rebased, retain only proven-dead Formly getters, the empty constructor, and obsolete comments. Exclude callback/options extraction, tracking wrappers, and GlobalConfigService.
- **Corrected LOC:** production 12; comments 23-27; configuration 0; tests added re-estimate after rebase; current reviewer range is 0-30
- **Material corrections:** Open PRs make the bundled sound/repeat/icon slices stale.; Shared validator and patch-option constants add low-value indirection and are excluded.; C01-010 owns tracking wrappers and C03-007 owns GlobalConfigService.; The aggregate LOC estimate is no longer valid.
- **Primary gate:** Rebase the overlapping PRs and re-audit the remaining exact dead declarations.
- **Required verification:** Repeat exact getter, constructor, and comment consumer searches after rebase.; Compile and run the affected Formly/config tests and changed-file checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `src/app/features/config/config-sound-form/config-sound-form.component.ts` — typed patch controls and repeated silent options; `src/app/features/config/form-cfgs/schedule-form.const.ts` — repeated time validator callback; `src/app/features/config/icon-input/icon-input.component.ts` — stale non-tracking Formly type/comment boilerplate; `src/app/features/config/keyboard-input/keyboard-input.component.ts` — stale Formly boilerplate; `src/app/features/config/select-project/select-project.component.ts` — stale non-tracking Formly type/comment boilerplate; `src/app/features/config/repeat-section-type/repeat-section-type.component.ts` — empty constructor.
- **Why it exists:** Migration-era Formly/component wrappers and repeated local configuration patterns remained after consumers adopted newer template and control patterns.
- **Smallest change:** Share the exact validator and silent-patch constants locally, then delete only proven-stale getters, comments, and the empty constructor. Leave tracking-wrapper removal to C01-010.
- **Preserve:** Sound patching without events, validation messages and results, Formly field behavior, project identity, defaults, and persistence remain unchanged.
- **Evidence:** Config-plan scouts found the exact repeated callbacks/options and self-only Formly wrappers. The guardian assigned the separate `GlobalConfigService` reactive-facade slice exclusively to C03-007.
- **Estimated net change:** Re-audit after rebasing the current Formly work; the original 52–75 production, 13–14 configuration, 23–27 comment, and 64–116 test-line estimates included the now-removed `GlobalConfigService` overlap and must not be reused.
- **Gates and overlaps:** formly-dynamic-components; config-persistence-boundary; C01-010 exclusively owns the `icon-input` and `select-project` tracking-wrapper slices; C03-007 exclusively owns `GlobalConfigService`; rebase PRs #9092 and #6748 and re-audit the remaining targets before implementation.
- **Verify:** Re-run exact consumer searches after rebasing the Formly work; run config, sound-form, schedule-validator, and custom Formly component specs; run `checkFile` on all modified TypeScript files and smoke-test config forms.
- **Source findings:** P13-01-C1; P13-01-C2; P13-02-C2.

## C02 — Tasks, planner, schedule, repeat, time, and counters (14 candidates)

### C02-001 — Prune unused mirrored schedule layout constants

- **Full-review result:** Rank 48/100; controlling original placements 52/39/57. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete only the unused TypeScript layout keys, three unused Sass breakpoint declarations, and comments made obsolete by those declarations, including the false keep-in-sync instruction.
- **Corrected LOC:** configuration 14; comments 16; production 0; tests 0
- **Material corrections:** The catalog misclassified declarations and omitted 16 comment lines.; Responsive manual verification remains required.; The recorded PR #9058 gate was not revalidated.
- **Primary gate:** Revalidate PR #9058 and repeat exact TS/Sass consumer searches after rebase.
- **Required verification:** Run checks for both constants files and the focused ScheduleComponent spec.; Manually resize week/month views across compact, tablet, and desktop widths, including horizontal scrolling.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/schedule.constants.ts` — SCHEDULE_CONSTANTS.BREAKPOINTS.MOBILE, SCHEDULE_CONSTANTS.COLUMN_WIDTHS, SCHEDULE_CONSTANTS.SCROLLBAR; `src/app/features/schedule/schedule-constants.scss` — $schedule-horizontal-scroll-threshold, $schedule-tablet-breakpoint, $schedule-mobile-breakpoint
- **Why it exists:** A cross-language constants extraction copied every value into both TypeScript and Sass even though each runtime consumes only its native half.
- **Smallest change:** Delete the zero-consumer TypeScript keys, zero-consumer Sass variables, and obsolete keep-in-sync comment; retain every referenced value in place.
- **Preserve:** All imported names, responsive thresholds, emitted CSS, resize behavior, and platform layouts remain unchanged.
- **Evidence:** Exact TS/Sass searches and introduction history show the targeted declarations have never had consumers.
- **Estimated net change:** configuration 13–20
- **Gates and overlaps:** responsive layout; Sass compilation; PR #9058 changes nearby schedule presentation and should be rebased first.
- **Verify:** npm run checkFile src/app/features/schedule/schedule.constants.ts; npm run checkFile src/app/features/schedule/schedule-constants.scss; npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
- **Source findings:** P11-C1

### C02-002 — Delete orphaned ScheduleService.hasEventsForDay

- **Full-review result:** Rank 33/100; controlling original placements 37/38/41. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete the service method, its dedicated describe block, and the two spy-name/default pairs; retain getEventDayStr and getEventsForDay.
- **Corrected LOC:** production 9; tests 39
- **Material corrections:** All three modified specs, including the locale spec, must be checked.; The stale spy names and return values must be removed together.; The recorded PR #8927 gate was not revalidated.
- **Primary gate:** Revalidate PR #8927 before implementation.
- **Required verification:** Run changed-file checks on the service and all three specs.; Run the service, ScheduleComponent, and locale-focused specs.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/schedule.service.ts` — hasEventsForDay; `src/app/features/schedule/schedule.service.spec.ts` — hasEventsForDay specs; `src/app/features/schedule/schedule/schedule.component.spec.ts` — ScheduleService mock; `src/app/features/schedule/schedule/schedule-locale-ng0701.spec.ts` — ScheduleService mock
- **Why it exists:** A month-component wrapper was removed, leaving its service method, focused tests, and mock slots behind.
- **Smallest change:** Delete only hasEventsForDay, its dedicated tests, and unused spy entries; retain getEventDayStr and getEventsForDay.
- **Preserve:** Live event filtering, locale handling, schedule rendering, and all production service callers remain unchanged.
- **Evidence:** Production search finds only the declaration; all other references are its own tests or unused test doubles, and history records removal of the sole caller.
- **Estimated net change:** production 9; tests 39
- **Gates and overlaps:** timezone-sensitive schedule tests; same-file open PR; PR #8927 modifies ScheduleService visible-day generation but not this method.
- **Verify:** npm run checkFile src/app/features/schedule/schedule.service.ts; npm run test:file src/app/features/schedule/schedule.service.spec.ts; npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
- **Source findings:** P11-C2

### C02-003 — Use the iCal loading promise as the sole module cache

- **Full-review result:** Rank 37/100; controlling original placements 43/44/33. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Keep loadingPromise as the sole module state and return the identically normalized module directly from its never-cleared import callback.
- **Corrected LOC:** production 4-5; tests 0; comments 0
- **Material corrections:** Preserve ESM/CommonJS normalization and sticky rejection.; Verification includes two live CalDAV consumers, not only calendar integration.; The paired LOC counts differ by one line; the conservative range is retained.
- **Primary gate:** None.
- **Required verification:** Run the lazy-loader, iCal event parser, and CalDAV client specs.; Check the changed loader file and preserve the never-reset promise exactly.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/ical/ical-lazy-loader.ts` — icalModule, loadingPromise, loadIcalModule
- **Why it exists:** The concurrency-fix promise cache was added beside the original resolved-module cache, leaving two states for the same one-time import.
- **Smallest change:** Remove the resolved object cache and return the normalized module from the single never-cleared promise.
- **Preserve:** One import, shared concurrent and subsequent calls, ESM/CommonJS normalization, async resolution, and sticky rejection behavior remain identical.
- **Evidence:** The promise is assigned once, never reset, and resolves to exactly the object held by the redundant cache; focused tests cover identity and concurrency.
- **Estimated net change:** production 4
- **Gates and overlaps:** lazy import; calendar parser interoperability
- **Verify:** npm run checkFile src/app/features/schedule/ical/ical-lazy-loader.ts; npm run test:file src/app/features/schedule/ical/ical-lazy-loader.spec.ts; npm run test:file src/app/features/schedule/ical/get-relevant-events-from-ical.spec.ts
- **Source findings:** P11-C3

### C02-004 — Remove disabled schedule-placement debug instrumentation

- **Full-review result:** Rank 86/100; controlling original placements 86/86/86. Safety: reject; maintainability: confirm; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No behavior-preserving deletion is accepted. Reformulate as an intentional performance/error-semantics change for valid plain schedule DTOs, or explicitly preserve eager argument evaluation before deleting the disabled sink.
- **Corrected LOC:** accepted production 0; accepted comments 0; proposed production re-estimate after deciding whether eager evaluation remains; proposed comments 1
- **Material corrections:** No-op call arguments are eagerly evaluated and can throw or invoke getters/toJSON.; Deleting them changes unexpected-input failure and side-effect behavior.; The catalog cites a nonexistent focused spec.; Real schedule mapping and timezone suites are required.
- **Primary gate:** Obtain explicit acceptance of the intentional error-semantics change and restate the candidate contract.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 7; challenges: refuter narrowed, maintainer confirmed.
- **Scope:** `src/app/features/schedule/map-schedule-data/insert-blocked-blocks-view-entries-for-schedule.ts` — debug, insertBlockedBlocksViewEntriesForSchedule, moveAllEntriesAfterTime, moveEntries
- **Why it exists:** A permanently disabled local debug function remained wired through many schedule-placement paths, forcing string construction and cloned diagnostic data with no output.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** The local sink always returns undefined and has no side effects; every targeted caller exists only to feed it.
- **Rejected historical estimate:** Zero LOC is authorized. production 57–67; comments 1
- **Gates and overlaps:** schedule-placement algorithm; timezone-sensitive tests; PR #8927 changes a sibling schedule helper but not the target file, so revalidate the exact file and timezone suite after any rebase.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P12-01-C1

### C02-005 — Delete obsolete combined task-change placeholder remnants

- **Full-review result:** Rank 4/100; controlling original placements 4/4/4. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only onTaskChange and the nested task-type-indicator style block; leave live selection/text handlers, state signals, and the template untouched.
- **Corrected LOC:** production 56; comments 2; tests 0
- **Material corrections:** The catalog cites a nonexistent component spec.; Comment lines must not be double-counted as production.; The focused proof is build/static search plus manual interaction because no component harness exists.
- **Primary gate:** None.
- **Required verification:** Run checks on the changed TypeScript and SCSS and a production/template build.; Manually create a text task and select an existing task in timed and plan-for-day modes.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/create-task-placeholder/create-task-placeholder.component.ts` — CreateTaskPlaceholderComponent.onTaskChange; `src/app/features/schedule/create-task-placeholder/create-task-placeholder.component.scss` — .task-type-indicator, .task-type-indicator.create, .task-type-indicator.select
- **Why it exists:** A prior combined create/select placeholder UI was replaced, but its unreachable change handler and unmatched indicator styles remained.
- **Smallest change:** Delete the zero-consumer handler, obsolete styles, and stale comments while retaining the live create/select outputs and template.
- **Preserve:** Placeholder creation, existing-task selection, emitted payloads, focus, keyboard behavior, and visible styles remain unchanged.
- **Evidence:** Template and repository searches find no binding to the method or target classes; history identifies them as remnants of the replaced UI.
- **Estimated net change:** production 52–58; comments 2
- **Gates and overlaps:** schedule UI; visual regression
- **Verify:** npm run checkFile src/app/features/schedule/create-task-placeholder/create-task-placeholder.component.ts; npm run checkFile src/app/features/schedule/create-task-placeholder/create-task-placeholder.component.scss; npm run test:file src/app/features/schedule/create-task-placeholder/create-task-placeholder.component.spec.ts
- **Source findings:** P12-01-C2

### C02-006 — Use running cursors for sequential schedule entries

- **Full-review result:** Rank 51/100; controlling original placements 48/72/44. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Limit the cursor rewrite to createScheduleViewEntriesForNormalTasks. Defer the repeat-projection loop until its startTime=0 behavior is explicitly preserved or intentionally changed.
- **Corrected LOC:** production 10-15; comments 0; tests added re-estimate after edge-case characterization
- **Material corrections:** The repeat loop is not equivalent for startTime=0 because its current truthy guard keeps later entries at zero.; The catalog cites a nonexistent spec and omits the direct normal-task test.; Computing each duration once must retain current pure helper semantics.
- **Primary gate:** Keep the repeat builder out of scope and characterize zero/NaN/Infinity and zero-duration behavior.
- **Required verification:** Add exact empty, startTime=0, zero-duration, NaN/Infinity-policy, and mixed-duration cases.; Run the direct normal-task builder and map-to-schedule-days specs plus changed-file checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/map-schedule-data/create-schedule-view-entries-for-normal-tasks.ts` — createScheduleViewEntriesForNormalTasks; `src/app/features/schedule/map-schedule-data/create-view-entries-for-day.ts` — createViewEntriesForNonScheduledRepeatProjections
- **Why it exists:** Two sequential-entry loops repeatedly rediscover the immediately previous entry instead of carrying the already-known end-time cursor.
- **Smallest change:** Replace predecessor bookkeeping in each local loop with an initialized running cursor; do not introduce a shared abstraction.
- **Preserve:** Task/projection order, start/end times, minimum duration, overflow, IDs, and generated view-entry shapes remain identical.
- **Evidence:** Both algorithms process ordered entries sequentially and use only the preceding end time; focused mapping tests cover placement and overflow cases.
- **Estimated net change:** production 24–42; comments 1
- **Gates and overlaps:** schedule ordering; time arithmetic; repeat projections; Adjacent to PR #8927 schedule mapping work but not in its changed files.
- **Verify:** npm run checkFile src/app/features/schedule/map-schedule-data/create-schedule-view-entries-for-normal-tasks.ts; npm run checkFile src/app/features/schedule/map-schedule-data/create-view-entries-for-day.ts; npm run test:file src/app/features/schedule/map-schedule-data/create-view-entries-for-day.spec.ts
- **Source findings:** P12-01-C3

### C02-007 — Remove the unused drag-event time wrapper

- **Full-review result:** Rank 22/100; controlling original placements 13/43/18. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only calculateDropTimeFromEvent and its exclusive documentation/comments; retain calculateTimeFromYPosition byte-for-byte.
- **Corrected LOC:** production 12; comments 9; tests 0
- **Material corrections:** The catalog cites a nonexistent schedule-utils spec; the live drag path is covered by ScheduleWeekDragService.; The reviewers count executable lines differently; the smaller defensible production count is used.
- **Primary gate:** None.
- **Required verification:** Repeat the exact symbol search and check the utility file.; Run schedule-week-drag.service.spec.ts.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/schedule-utils.ts` — calculateDropTimeFromEvent
- **Why it exists:** A drag-event adapter survived after all callers moved to the lower-level time calculation utility.
- **Smallest change:** Delete the exported wrapper and its JSDoc; retain every live schedule utility.
- **Preserve:** All current drag/drop calculations and public callers remain unchanged because no consumer references the wrapper.
- **Evidence:** Exact symbol and dynamic-string searches find only the declaration, with no template, test, or platform registration consumer.
- **Estimated net change:** production 13–17; comments 7
- **Gates and overlaps:** drag-and-drop schedule UI
- **Verify:** npm run checkFile src/app/features/schedule/schedule-utils.ts; npm run test:file src/app/features/schedule/schedule-utils.spec.ts
- **Source findings:** P12-02-C1

### C02-008 — Delete unmatched schedule-view stylesheet remnants

- **Full-review result:** Rank 79/100; controlling original placements 81/80/77. Safety: defer; maintainability: narrow; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** After schedule presentation branches are resolved, retain only the 32-line parent ScheduleComponent pre-split header block here; review drop-label, drag-preview, and month pseudo-element slices independently.
- **Corrected LOC:** production 32; comments 0; tests 0
- **Material corrections:** The original three-component style batch has multiple roots.; Dynamic drag classes and the data-more-events producer require fresh runtime searches.; PRs #9058 and #7813 were not revalidated.
- **Primary gate:** Resolve/rebase the named presentation work and repeat DOM/runtime producer searches.
- **Required verification:** Run checks and focused tests for only the actually modified component slice.; Perform responsive week/month and normal/shift-drag visual comparisons.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary defer. **Classification:** conflicting.
- **Scope:** `src/app/features/schedule/schedule-week/schedule-week.component.scss` — .drop-label, .drag-time-preview, .drag-time-preview .time-badge; `src/app/features/schedule/schedule/schedule.component.scss` — .main-controls, .days, .day, .day-num, .day-day; `src/app/features/schedule/schedule-month/schedule-month.component.scss` — .month-day-events::after
- **Why it exists:** Several prior schedule layouts and drag previews were removed from templates without pruning their component-scoped selectors.
- **Smallest change:** After rebasing open schedule UI work, delete only selectors still unmatched by component templates and runtime classes.
- **Preserve:** All selectors used by current or newly merged templates, drag states, month events, accessibility markup, and responsive layouts must remain.
- **Evidence:** Baseline template/class searches show the listed selectors unmatched, but open PR #9058 changes ScheduleComponent HTML and SCSS, so the consumer proof is time-sensitive.
- **Estimated net change:** production 70–82
- **Gates and overlaps:** visual regression; responsive schedule layout; dynamic drag classes; PR #9058 changes `ScheduleComponent` HTML/SCSS and PR #7813 changes nearby presentation, so resolve or rebase both before repeating consumer proof.
- **Verify:** Re-run exact class searches after PR #9058 resolution; npm run checkFile src/app/features/schedule/schedule-week/schedule-week.component.scss; npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts; Manual week/day/month drag and responsive visual pass
- **Source findings:** P12-02-C2

### C02-009 — Delete orphaned repeat configurations-with-start-time selector

- **Full-review result:** Rank 32/100; controlling original placements 41/42/30. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete exactly selectTaskRepeatCfgsWithStartTime, its spec import, and dedicated describe block; retain the WithAndWithout selector and every shared state/op-log export.
- **Corrected LOC:** production 6; tests 19; comments 0
- **Material corrections:** The shared selector file also exports live reducer/op-log symbols and must not be reorganized.; ScheduleService tests join the selector spec as the live replacement boundary.
- **Primary gate:** None.
- **Required verification:** Repeat exact symbol, barrel, and dynamic searches.; Run selector and ScheduleService specs plus changed-file checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.ts` — selectTaskRepeatCfgsWithStartTime; `src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts` — selectTaskRepeatCfgsWithStartTime spec suite
- **Why it exists:** The timeline consumer was removed in 2025, but the selector and its self-only test suite survived later file extraction.
- **Smallest change:** Delete the selector export, its spec import, and only its dedicated tests; retain all other repeat selectors.
- **Preserve:** No production recurrence selection, ordering, state shape, repeat creation, or projection behavior changes.
- **Evidence:** Repository search finds no production caller; history identifies the removed TaskRepeatCfgService stream as its sole former consumer.
- **Estimated net change:** production 6; tests 19
- **Gates and overlaps:** repeat configuration; exported selector; P15-C2 touches the same file but was lower-ranked; issue #7913 targets different recurrence engines.
- **Verify:** npm run checkFile src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.ts; npm run checkFile src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts; npm run test:file src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts
- **Source findings:** P15-C1

### C02-010 — Delete the superseded daily-state calculator

- **Full-review result:** Rank 14/100; controlling original placements 12/18/16. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete DailyState, calculateDailyState, and their documentation; retain DAILY_STATE.THRESHOLD, getDailyStateInfo, and unrelated translation keys.
- **Corrected LOC:** production 19; comments 14; tests 0
- **Material corrections:** Broad DAILY_STATE searches include unrelated translation noise.; The live threshold constant must remain.; The smaller 19-line production count is used.
- **Primary gate:** None.
- **Required verification:** Repeat exact TypeScript symbol searches.; Check the metric utility, run its spec, and compile the evaluation sheet path.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/metric/metric-scoring.util.ts` — DailyState, calculateDailyState
- **Why it exists:** The evaluation UI migrated to getDailyStateInfo with additional states, leaving the original four-state type and calculator exported but unused.
- **Smallest change:** Delete DailyState, calculateDailyState, and their documentation while retaining DAILY_STATE.THRESHOLD for the live implementation.
- **Preserve:** Current metric scoring, evaluation labels, thresholds, chart data, and every reachable caller remain unchanged.
- **Evidence:** Exact searches show no consumer; history shows the newer classifier superseded rather than wrapped the old implementation.
- **Estimated net change:** production 18–20; comments 14
- **Gates and overlaps:** metric scoring terminology
- **Verify:** npm run checkFile src/app/features/metric/metric-scoring.util.ts; npm run test:file src/app/features/metric/metric-scoring.util.spec.ts
- **Source findings:** P17-C1

### C02-011 — Consolidate duplicate simple-counter chart selectors

- **Full-review result:** Rank 89/100; controlling original placements 91/90/88. Safety: confirm; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Keep the two explicit side-by-side selectors and reconsider only if a third chart variant or independently complex shared policy appears.
- **Corrected LOC:** accepted production 0; proposed production net removed 16-26; proposed rewritten or added 31-37; tests 0; comments 0
- **Material corrections:** Net LOC hides a substantial mapper/helper rewrite.; The selectors differ at visible policy points and encode non-obvious zero/NaN/empty-placeholder behavior.; Two uses do not justify the added abstraction under KISS/YAGNI.
- **Primary gate:** None.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/metric/store/metric.selectors.ts` — selectSimpleCounterClickCounterLineChartData, selectSimpleCounterStopWatchLineChartData
- **Why it exists:** Click and stopwatch chart selectors were copied together and have received parallel fixes for five years; only type filtering and numeric conversion differ.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Both selectors share filtering, date collection/sort, placeholder construction, slicing, and dataset assembly; their history shows fixes applied in parallel.
- **Rejected historical estimate:** Zero LOC is authorized. production 16–26
- **Gates and overlaps:** NgRx selectors; chart dataset identity; habit metrics; PR #8191 changes simple-counter behavior but not these metric selectors.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P17-C2

### C02-012 — Remove the superseded all-state tag cleanup method

- **Full-review result:** Rank 99/100; controlling original placements 99/99/99. Safety: reject; maintainability: confirm; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** Remove this candidate from the non-sync C02 campaign. Any deletion must be reconsidered in a dedicated sync/op-log review covering local and remote tag deletion, the shared meta-reducer, ArchiveOperationHandler, locks, and replay.
- **Corrected LOC:** eligible production 0; eligible comments 0; sync review estimate re-estimate in the authorized sync domain
- **Material corrections:** The method imports op-log locking and dispatches whole time-tracking state.; Its replacement proof crosses one-intent/one-op, archive persistence, and remote replay.; Non-sync unit/manual verification cannot establish the required contract.
- **Primary gate:** Route to an authorized sync/op-log review; it is excluded from this domain.
- **Required verification:** No implementation verification is authorized in this non-sync audit.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/time-tracking/time-tracking.service.ts` — cleanupDataEverywhereForTag
- **Why it exists:** Atomic current-state tag cleanup moved into a shared reducer, but the deprecated service method that duplicated current and archive cleanup remained with zero callers.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Consumer search finds no caller, and the retained replacement split is documented and exercised by the live deletion path.
- **Rejected historical estimate:** Zero LOC is authorized. production 27–31; comments 4
- **Gates and overlaps:** archive persistence; tag deletion; sync-adjacent state cleanup
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P21-C1

### C02-013 — Remove abandoned estimate UI from PlanTasksTomorrow

- **Full-review result:** Rank 21/100; controlling original placements 26/24/14. Safety: confirm; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete only the estimate markup/comments, estimate-total SCSS, WorkContextService injection/import, and expandAnimation registration. Leave TaskService and the separate add-scheduled comment out of this root.
- **Corrected LOC:** production 24; comments 15; tests 0
- **Material corrections:** The full catalog scope overbundled unrelated TaskService and comment residue.; Unused DI can affect instantiation timing; current AppComponent coverage is an explicit dependency.; No focused PlanTasksTomorrow spec exists.; PR #8038 was not revalidated.
- **Primary gate:** Revalidate PR #8038 and rely on compilation plus a manual planning smoke unless a focused harness is added separately.
- **Required verification:** Run checks on the changed component files and a production/template build.; Manually add a tomorrow task and plan leftovers, including a due-today subtask and dispatch order.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/pages/daily-summary/plan-tasks-tomorrow/plan-tasks-tomorrow.component.ts` — WorkContextService, TaskService, expandAnimation; `src/app/pages/daily-summary/plan-tasks-tomorrow/plan-tasks-tomorrow.component.html` — commented estimate-total, commented add-scheduled control; `src/app/pages/daily-summary/plan-tasks-tomorrow/plan-tasks-tomorrow.component.scss` — .estimate-total
- **Why it exists:** A disabled estimate presentation left active injections, animation metadata, styles, and a second legacy control comment after the planner redesign.
- **Smallest change:** Delete only the commented blocks and their unused imports, injections, animation registration, and unmatched style.
- **Preserve:** Tomorrow/leftover selection, parent-subtask ordering, action payloads, AddTaskBar, PlannerDay, and logical-day date calculation remain unchanged.
- **Evidence:** Every targeted dependency and selector is referenced only by commented markup or its own declaration; history ties them to the abandoned feature.
- **Estimated net change:** production 24–30; comments 19–23
- **Gates and overlaps:** planner actions; logical-day scheduling; daily summary UI; PR #8038 modifies the component TypeScript and requires a rebase, but does not restore the commented estimate UI.
- **Verify:** npm run checkFile src/app/pages/daily-summary/plan-tasks-tomorrow/plan-tasks-tomorrow.component.ts; npm run checkFile src/app/pages/daily-summary/plan-tasks-tomorrow/plan-tasks-tomorrow.component.scss; npm run test:file src/app/pages/daily-summary/daily-summary.component.spec.ts; Manual Plan Tomorrow smoke test
- **Source findings:** P22-C1

### C02-014 — Trim DailySummary dead state/styles and bind focus metrics once

- **Full-review result:** Rank 93/100; controlling original placements 90/93/92. Safety: narrow; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** Reject the bundle. If desired, propose the two-line dead Action/actionsToExecuteBeforeFinishDay field deletion separately; review focus subscription changes, styles, HTML comments, and other dead fields as independent candidates.
- **Corrected LOC:** accepted production 0; smallest separate dead field production 2; catalog production 15-26; catalog comments 29-36; catalog tests added 8-16
- **Material corrections:** The bundle combines multiple unrelated histories and a behaviorally observable subscription-count change.; A one-binding rewrite must retain zero-count suppression.; The current spec does not instantiate the component or cover focus rendering.; PRs #7808 and #8038 were not revalidated.
- **Primary gate:** None.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/pages/daily-summary/daily-summary.component.ts` — Action, hasTasksForToday$, focusSessionCount$, focusSessionDuration$, actionsToExecuteBeforeFinishDay; `src/app/pages/daily-summary/daily-summary.component.html` — focus session bindings, commented inline-markdown; `src/app/pages/daily-summary/daily-summary.component.scss` — .full-width, .back-btn, .tomorrows-note, commented declarations
- **Why it exists:** Successive summary redesigns left zero-consumer fields, unmatched styles/comments, and two template subscriptions that project one already-grouped focus summary.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Exact searches prove the fields and selectors dead; the two displayed focus values come from the same adjacent summary object.
- **Rejected historical estimate:** Zero LOC is authorized. production 15–26; comments 29–36; tests -16–-8
- **Gates and overlaps:** finish-day lifecycle; archive persistence; final sync sequencing; Electron close flow; PR #7808 and PR #8038 modify DailySummary files; rebase without touching finish-day code.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P22-C2

## C03 — Projects, tags, notes, focus, settings, worklog, and shared utilities (15 candidates)

### C03-001 — Make PanelContentService the single signal-based panel-open authority

- **Full-review result:** Rank 30/100; controlling original placements 35/30/42. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Centralize panelType/hasContent/canOpen and direct consumer reads while preserving bottom-sheet overrides, close timing, navigation effects, and plugin lifecycle. Inventory zero-read RightPanel mirrors separately to avoid overlapping LOC.
- **Corrected LOC:** production re-estimate after one non-overlapping consumer inventory; comments re-estimate; reviewer scopes/counts differ; tests added 35-55
- **Material corrections:** The canonical scope omitted four zero-read RightPanel fields while claiming complete mirror removal.; The LOC estimate overlaps service centralization and consumer getter/mirror slices.; Route, responsive, selected-task, and plugin-panel transitions are timing-sensitive.
- **Primary gate:** Inventory every consumer field once and characterize the panel truth table and close transition before editing.
- **Required verification:** Cover every flag, priority, initial state, DONT_OPEN_PANEL, and one true-to-false close.; Run focused panel tests/build and desktop/xs task, plugin, issue, schedule, and close smoke flows.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/panels/panel-content.service.ts` — panelType, hasContent, canOpen, getCurrentPanelType, getHasContent, getCanOpen; `src/app/features/right-panel/right-panel-content.component.ts` — isOpen, \_taskDetailPanelTargetPanel, \_layoutFeatureState, \_isShowPluginPanel; `src/app/features/right-panel/right-panel.component.ts` — isOpen; `src/app/features/bottom-panel/bottom-panel-container.component.ts` — panelType
- **Why it exists:** Panel type centralization was only partially completed, leaving a duplicate open predicate in the component and getter pass-throughs around already-public Signals.
- **Smallest change:** Derive hasContent/canOpen once in PanelContentService, consume its Signals directly from the right and bottom panel components, and remove only the redundant selector mirrors, alias, no-op route branch, and signal getters.
- **Preserve:** Panel priority, DONT_OPEN_PANEL handling, delayed task/content timers, navigation-close behavior, focus restoration, plugin recreation, and desktop/mobile panel selection remain identical.
- **Evidence:** The raw component audit and reactive-facade lens independently traced the same central service. RightPanelContentComponent reconstructs the same flag truth table, while three methods merely return existing Signals.
- **Estimated net change:** production 59–80; comments 6–9; tests -55–-35
- **Gates and overlaps:** characterization-required; responsive-ui; plugin-panel-branch
- **Verify:** Add a PanelContentService truth-table spec for every content flag, priority, and DONT_OPEN_PANEL; Retain a component assertion that a true-to-false open transition closes exactly once; Run checkFile on all changed TypeScript files and the focused panel specs; smoke-check desktop and xs panel flows.
- **Source findings:** P25-01-C1; L03-C03

### C03-002 — Remove retired Focus Mode overlay navigation and banner scaffolding

- **Full-review result:** Rank 10/100; controlling original placements 8/15/9. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete dead injections/aliases, back/cancel methods, inert destroy Subject, unused animations, stale comments/styles, and mode-only mocks/tests. Retain ngOnDestroy with document-listener removal, warpIn, BannerComponent/template use, safe areas, and drag region.
- **Corrected LOC:** production 29-45; comments 5-7; tests re-estimate while replacing implementation-detail teardown assertions; reviewer net range 23-47 removed
- **Material corrections:** The canonical target list omitted dead task/config injections and session aliases.; BannerComponent and the live banner host are not residue.; The real document-listener teardown remains and must be tested behaviorally.
- **Primary gate:** None.
- **Required verification:** Replace the Subject spy with an Escape-after-destroy assertion.; Run focused overlay tests, changed-file checks/build, and web/Electron Escape/input/dialog smoke checks.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/focus-mode/focus-mode-overlay/focus-mode-overlay.component.ts` — \_onDestroy$, ngOnDestroy, back, cancelFocusSession, animations; `src/app/features/focus-mode/focus-mode-overlay/focus-mode-overlay.component.html` — retired navigation and banner comments; `src/app/features/focus-mode/focus-mode-overlay/focus-mode-overlay.component.scss` — unmatched selectors and retired token
- **Why it exists:** The Focus Mode overlay was reworked but its old navigation/banner layer, unused animation registration, and inert destroy Subject/test remained.
- **Smallest change:** Delete only the unused imports, fields, methods, Subject, stale markup comments, unmatched styles, and implementation-detail test; retain the document listener and its explicit teardown.
- **Preserve:** All three screens, close-button and guarded Escape dispatches, animation that is actually used, Electron drag region, mobile safe area, and listener teardown remain unchanged.
- **Evidence:** The component audit found the full retired layer; the lifecycle lens independently proved that \_onDestroy$ has no subscription and that its test observes an implementation detail rather than teardown behavior.
- **Estimated net change:** production 29–45; comments 5–7; tests 23–47
- **Gates and overlaps:** focus-overlay; electron-ui; listener-lifecycle; Mark C01-012 superseded by C03-002 and merge its source evidence without summing LOC.
- **Verify:** Replace the Subject assertion with a test that Escape no longer dispatches after destroy; Run checkFile for the component and SCSS plus the focused overlay spec; Smoke-check open/close and Escape with inputs/dialogs on web and Electron.
- **Source findings:** P14-01-C1; L05-C01

### C03-003 — Use one computed signal per Focus Mode main UI state

- **Full-review result:** Rank 88/100; controlling original placements 87/88/91. Safety: confirm; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Retain the semantic isShow presentation vocabulary; consider only the exact redundant inner gate or one-line tracking helper opportunistically and separately.
- **Corrected LOC:** accepted production 0; accepted tests 0; proposed production 11-20; proposed tests added 7-12
- **Material corrections:** The aliases document UI intent and are cheap cached signals.; The proposal combines a naming-policy rewrite, nested-template deduplication, and a tracking helper.; Direct state coupling is less expressive for negligible node savings.
- **Primary gate:** None.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/focus-mode/focus-mode-main/focus-mode-main.component.ts` — isPreparation, isCountdown, isInProgress, state-derived visibility computeds, trackById; `src/app/features/focus-mode/focus-mode-main/focus-mode-main.component.html` — duplicated state gates, simple-counter tracking
- **Why it exists:** Six reactive aliases and repeated nested template gates encode only three mutually exclusive main UI states.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** The component spec already covers Preparation, Countdown, and InProgress visibility; the removed nodes are pass-through computeds or redundant gates over those states.
- **Rejected historical estimate:** Zero LOC is authorized. production 11–20; tests 7–12
- **Gates and overlaps:** template-visibility
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P14-01-C2

### C03-004 — Finish retiring FocusModeService compatibility members

- **Full-review result:** Rank 31/100; controlling original placements 40/40/28. Safety: confirm; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete isSessionCompleted, isBreakLong, sessionProgress$, and timeToGo$; rename the one break consumer/mock to isLongBreak. Retain currentSessionTime$, last-session members, and the reducer State export.
- **Corrected LOC:** production 4; comments 2; tests deleted 20-30
- **Material corrections:** The reducer type alias is a distinct compatibility contract and is excluded.; currentSessionTime$ and last-session members have live Electron/effect consumers.
- **Primary gate:** None.
- **Required verification:** Repeat exact symbol/public-surface searches.; Run focus service/break/overlay and task-electron effect tests; smoke short/long/Flowtime labels and Electron tracking.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/focus-mode/focus-mode.service.ts` — isSessionCompleted, isBreakLong, sessionProgress$, timeToGo$; `src/app/features/focus-mode/focus-mode-break/focus-mode-break.component.ts` — breakLabelKey, isLongBreak; `src/app/features/focus-mode/store/focus-mode.reducer.ts` — State compatibility alias
- **Why it exists:** The signal migration retained compatibility aliases and zero-subscriber selector Observables after consumers moved to canonical signal names.
- **Smallest change:** Delete the proven zero-consumer members and reducer alias, rename the one break consumer to isLongBreak, and remove only API-existence tests and mocks.
- **Preserve:** Every live Signal and selector remains; currentSessionTime$ is explicitly retained for the Electron effect, and short/long break labels and timer dispatches are unchanged.
- **Evidence:** One primary scout and two independent lenses converge on the same members and separately identify currentSessionTime$ as the platform-sensitive observable that must remain.
- **Estimated net change:** production 4–6; comments 2–4; tests 20–30
- **Gates and overlaps:** electron-consumer-must-remain; service-surface
- **Verify:** Repeat exact TypeScript/template/public-surface searches for each removed member; Run checkFile on the service and break component plus their focused specs and task-electron.effects.spec.ts; Smoke-check short/long break labeling and Electron tracked focus time.
- **Source findings:** P14-01-C3; L03-C05; L12-C04

### C03-005 — Prune obsolete WorkContextService members and dormant pipeline sketches

- **Full-review result:** Rank 35/100; controlling original placements 38/50/29. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Remove only activeWorkContextIdIfProject$ and its now-unused imports. Route the empty load method and unrelated dormant/debug comments to separate candidates.
- **Corrected LOC:** production 9; comments 0; tests 0
- **Material corrections:** The observable, 2020 load stub, and pipeline sketches have unrelated histories.; The catalog's production/comment totals therefore overstate one concept removal.
- **Primary gate:** None.
- **Required verification:** Repeat receiver-aware, plugin/platform/bootstrap, and exact symbol searches.; Run the WorkContextService spec/build and confirm no selector, action, effect, hydration, or op-log diff.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/work-context/work-context.service.ts` — activeWorkContextIdIfProject$, load, mainListTasks$ dormant sketches
- **Why it exists:** The complete-state initialization and related-data migrations removed the last consumers but left one lazy project-id observable, an empty load API, and commented pipeline drafts.
- **Smallest change:** Delete the orphan observable, empty load method, and adjacent dormant pipeline comments while retaining every live context selector, signal, synchronous mirror, route initialization, and allDataWasLoaded gate.
- **Preserve:** No live caller, subscription, bootstrap await, dispatch, persisted shape, route, task-list, plugin, Electron, or native behavior changes.
- **Evidence:** The raw audit reconstructs the exact former consumers and their deletion commits; the comment-debt lens independently finds the empty load API and dormant pipelines in the same service.
- **Estimated net change:** production 11; comments 18–24
- **Gates and overlaps:** work-context-core; public-looking-internal-api; GitHub issue #8299
- **Verify:** Repeat receiver-aware, template, plugin/public, Electron/native, bootstrap, and string searches for the removed members; Run checkFile and work-context.service.spec.ts; Do not alter selectors, actions, reducers, hydration, or the current complete-state initialization path.
- **Source findings:** P19-02-C1; L11-C02

### C03-006 — Remove WorkContextService's plain isTodayList mirror

- **Full-review result:** Rank 40/100; controlling original placements 44/51/34. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Change HistoryComponent.projectColorFor to isTodayListSignal(), then delete only the mutable boolean mirror and its assignment subscription; retain isTodayList$ and isTodayListSignal and do not edit TaskComponent.
- **Corrected LOC:** production 2; comments 3-4; tests 0
- **Material corrections:** The #8843/task-component dependency is stale because TaskComponent already uses the Signal.; Both reactive APIs remain live and are explicitly retained.
- **Primary gate:** None.
- **Required verification:** Run WorkContextService and History tests/checks.; Switch Today/project/tag while History is mounted and verify reactive project colors; confirm TaskComponent is unchanged.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/work-context/work-context.service.ts` — isTodayList, isTodayList$, isTodayListSignal, constructor mirror subscription; `src/app/features/history/history.component.ts` — projectColorFor
- **Why it exists:** An earlier migration added a Signal but retained a mutable boolean mirror and subscription, allowing consumers to bypass reactive invalidation.
- **Smallest change:** Move the remaining History consumer to the existing reactive source and remove only the plain mirror and its assignment subscription; keep the Observable and Signal forms that still have consumers.
- **Preserve:** TODAY membership, task ordering, history color selection, state shape, selector timing, and all synchronized data remain unchanged.
- **Evidence:** The architecture review and open issue #8843 independently identify computed-over-isTodayList as a stale-signal hazard; the lens isolates the mirror and the remaining non-task consumer.
- **Estimated net change:** production 2–3; comments 3–5
- **Gates and overlaps:** task-hot-path-consumer; signal-migration; today-virtual-tag; Coordinate implementation order with GitHub issue #8843; GitHub issues #8299 and #8843
- **Verify:** Coordinate with the #8843 task hot-path fix so task components consume a real Signal rather than the plain mirror; Run checkFile on WorkContextService and HistoryComponent plus their focused specs; Verify History and detail-panel task lists across TODAY/project/tag context changes.
- **Source findings:** L11-C01

### C03-007 — Trim unused Observable/Signal half-pairs from GlobalConfigService

- **Full-review result:** Rank 15/100; controlling original placements 16/19/15. Safety: confirm; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the wholly unused timelineCfg$/timelineCfg pair, evaluation and takeABreak Signals, and exclusive imports. Retain live one-subscriber Observable-to-Signal bridges and the evaluation$/takeABreak$ Observables.
- **Corrected LOC:** production 14-16; comments 0; tests 0
- **Material corrections:** Collapsing four live bridges changes construction paths for modest reward and is excluded.; evaluation$ and takeABreak$ have live consumers; only their Signal halves are dead.; C01-015 must not duplicate this service slice.
- **Primary gate:** None.
- **Required verification:** Repeat exact property searches including templates and tests.; Run changed-file checks, relevant config-consumer tests, and a frontend build.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/features/config/global-config.service.ts` — zero-consumer Observable declarations, zero-consumer Signal declarations, direct-signal consumers
- **Why it exists:** The staged config migration created Observable/Signal twins uniformly even where only one half ever acquired a consumer.
- **Smallest change:** Delete only five zero-consumer Observable declarations and three dead Signals, replace four internal wrappers with direct existing Signals, and retain every externally consumed property and selector.
- **Preserve:** Config values, initial values, reducer/selectors, persistence, emissions, errors, settings UI, and external service property names remain unchanged.
- **Evidence:** Repository-wide consumer tracing identifies the unused halves, while architecture review M-2 independently documents GlobalConfigService as the genuine dual-API migration hotspot.
- **Estimated net change:** production 26–40; tests -30–-16
- **Gates and overlaps:** broad-config-service; reactive-lifecycle; characterization-required; Architecture review M-2; Narrow C01-015 by removing P13-02-C1, GlobalConfigService, and its LOC; retain C03-007 as the sole owner of that slice.
- **Verify:** Repeat TypeScript/template/test/public searches for every removed declaration; Add focused equivalence assertions only where direct-signal replacement lacks existing coverage; Run checkFile and relevant config service/consumer specs.
- **Source findings:** P13-02-C1

### C03-008 — Delete obsolete create-project theme and issue-provider scaffolding

- **Full-review result:** Rank 45/100; controlling original placements 30/65/43. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Retain only the declaration-only issue-provider fields/type imports and empty subscription/OnDestroy lifecycle. Defer the separate theme-form binding and validation cleanup until focused create-project characterization exists.
- **Corrected LOC:** production 14-17; comments 0; tests 0
- **Material corrections:** The catalog bundles separate 2019 theme-form and 2024 provider/lifecycle residue.; Changing the outer form binding is behavior-bearing and under-characterized.; Live afterClosed, session, Plainspace, and provider side effects remain.
- **Primary gate:** Keep form binding/validation out of this declaration-only slice; characterize it separately before any future change.
- **Required verification:** Repeat exact member searches, run the component check and frontend build.; Smoke create, edit, cancel, and Plainspace creation without changing payload or form code.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/project/dialogs/create-project/dialog-create-project.component.ts` — formTheme, formOptionsTheme, themeFormCfg, issue-provider fields, \_subs, ngOnDestroy; `src/app/features/project/dialogs/create-project/dialog-create-project.component.html` — outer formGroup binding
- **Why it exists:** Theme controls and initial issue-provider dialogs were removed in 2019 and 2024, but their form state, provider fields, and now-empty subscription lifecycle survived.
- **Smallest change:** Bind the outer form to formBasic and delete only the unrendered theme/provider state, obsolete imports, empty Subscription/OnDestroy, and redundant theme validation entries.
- **Preserve:** Visible basic fields, validation, create/edit payloads, temporary session persistence, Plainspace sharing and transient-flag stripping, afterClosed behavior, and dialog close ordering remain identical.
- **Evidence:** Template tracing and deletion-history commits prove the former consumers; current exact member, provider, dynamic, plugin, Electron, and native searches find no successor consumer.
- **Estimated net change:** production 23–31; tests -80–-45
- **Gates and overlaps:** user-facing-dialog; session-storage; external-sharing; characterization-required
- **Verify:** First add focused create/edit/invalid/cancel-session/Plainspace characterization for the currently untested dialog; Run checkFile on component and new spec plus the focused test file; Manually smoke-check Create Project and Edit Project validation, Save, Cancel, and Plainspace behavior.
- **Source findings:** P19-01-C1

### C03-009 — Trim the obsolete MenuTreeService reactive facade

- **Full-review result:** Rank 8/100; controlling original placements 9/8/8. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Expose the existing toSignal fields directly as projectTree/tagTree and delete the one-hop computed wrappers, projectFolders$, \_collectFolders, and the exclusive map import; retain all actions, state, algorithms, and persistence.
- **Corrected LOC:** production 18-24; comments 0; tests added 4-8
- **Material corrections:** Rename/expose the existing signals instead of recreating them so identity and subscription timing remain unchanged.
- **Primary gate:** None.
- **Required verification:** Run MenuTreeService tests with a selector-to-public-Signal assertion and the changed-file check.; Compile and smoke tree initialization, folder movement, persistence, and duplicate-title paths.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/menu-tree/menu-tree.service.ts` — \_projectTree, \_tagTree, projectTree, tagTree, projectFolders$, \_collectFolders
- **Why it exists:** Signal adoption left two computed pass-throughs plus a zero-subscriber Observable folder collector beside the live tree Signals.
- **Smallest change:** Expose the existing toSignal fields under the public names and delete only the pass-through computeds, projectFolders$, \_collectFolders, and their exclusive import.
- **Preserve:** Tree Signal values and initialization, folder maps, tree actions, dispatch order, persistence, sidebar ordering, and all live service method signatures remain unchanged.
- **Evidence:** Repository tracing found no subscriber to projectFolders$ and service tests already cover tree order, folder maps, insertion, and persistence.
- **Estimated net change:** production 18–24; tests -8–-4
- **Gates and overlaps:** synced-state-read-boundary; persistent-menu-tree
- **Verify:** Run checkFile and menu-tree.service.spec.ts; Confirm compilation finds no projectFolders$ consumer; Smoke-check project/tag tree initialization, folder movement, and duplicate-title paths.
- **Source findings:** P20-C1

### C03-010 — Remove dead scaffolding from tag display and quick-menu components

- **Full-review result:** Rank 17/100; controlling original placements 14/20/20. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Limit to TagToggleMenuList: remove the dead addNewTag output, class menuEl query, unused event parameter, redundant tagFolderMap wrapper, dead styleUrl, and unreachable SCSS. Keep the live template reference; leave TagList and TagEdit separate.
- **Corrected LOC:** production 22-25; comments 0-1; tests 0
- **Material corrections:** The umbrella spans three unrelated component histories.; Open PR #8437 touches the excluded TagEdit slice, not the retained quick-menu slice.; TaskComponent is only a consumer and remains unchanged.
- **Primary gate:** None.
- **Required verification:** Run quick-menu checks, template compilation, TaskComponent tests, and a production build.; Smoke mouse/keyboard open, Space toggle, add-tag, folder paths, and icons.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `src/app/features/tag/tag-list/tag-list.component.ts` — unused animations; `src/app/features/tag/tag-toggle-menu-list/tag-toggle-menu-list.component.ts` — addNewTag, menuEl, tagFolderMap wrapper, openMenu event; `src/app/features/tag/tag-toggle-menu-list/tag-toggle-menu-list.component.scss` — unmatched tag icon selectors; `src/app/features/tag/tag-edit/tag-edit.component.ts` — index signature, onkeydown, cleanTitle
- **Why it exists:** Component extractions and markup changes left unreachable animation metadata, outputs, queries, styles, a computed wrapper, and permissive editor scaffolding.
- **Smallest change:** Remove only the unused metadata, fields, output/parameter, dead SCSS/styleUrl, index signature/onkeydown, and single-use cleanup helper; directly alias the existing folder-map Signal.
- **Preserve:** Tag rendering, filtering, creation, toggling, Space-key handling, menu focus, dialog/task updates, chips, autocomplete, actions, and persisted tag/task state remain unchanged.
- **Evidence:** Template and consumer tracing shows the fields/styles have no reachable binding; the live tag-list spec and task component tests fence the retained state and quick-menu entry point.
- **Estimated net change:** production 29–43; comments 4–8
- **Gates and overlaps:** task-hot-path-adjacent; keyboard-menu-flow; template-contract; open PR #8437 changes the included `tag-edit` component, so rebase and repeat exact-symbol/template searches before implementation.
- **Verify:** Run checkFile on the four changed TypeScript/SCSS files and focused tag-list/task component specs; Compile templates to prove removed outputs and styles have no bindings; Manually open the tag menu, toggle with Space, add a tag, and edit chips/autocomplete.
- **Source findings:** P20-C3

### C03-011 — Prune displaced worklog presentation scaffolding

- **Full-review result:** Rank 18/100; controlling original placements 15/21/21. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Limit to DialogWorklogExport extraction residue: remove the unused options/imports, two legacy comments, dead styleUrl, and unmatched wrapper SCSS file. Leave WorklogWeek changes separate and preserve child styles/export logic.
- **Corrected LOC:** production 18-20; comments 2; tests 0
- **Material corrections:** Export-dialog extraction residue and WorklogWeek residue have different histories.; Matching row/column/textarea styles remain live in the extracted child.
- **Primary gate:** None.
- **Required verification:** Run the changed dialog check, export/timezone tests, and production build.; Open and close the export dialog at desktop and narrow widths and verify child layout.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/worklog/dialog-worklog-export/dialog-worklog-export.component.ts` — options, legacy export comments, dead styleUrl; `src/app/features/worklog/dialog-worklog-export/dialog-worklog-export.component.scss` — unmatched wrapper selectors; `src/app/features/worklog/worklog-week/worklog-week.component.ts` — expandAnimation, keys; `src/app/features/worklog/worklog-week/worklog-week.component.html` — legacy debug and counter comments; `src/app/features/worklog/worklog-week/worklog-week.component.scss` — legacy wrapper comments
- **Why it exists:** Worklog component extraction and presentation migrations displaced fields, animation metadata, selectors, and commented old markup without removing them.
- **Smallest change:** Delete only the unbound wrapper field/imports, unused animation and key alias, dead style file/styleUrl, unmatched selectors, and commented legacy blocks.
- **Preserve:** Current child export form, week rows, date labels, fade/expandFade animations, keyboard toggles, ARIA state, task updates, metric reads, and timezone-sensitive range calculations remain unchanged.
- **Evidence:** Current templates own none of the removed selectors/fields, while live animation triggers and range logic are explicitly excluded from the proposed deletion.
- **Estimated net change:** production 19–27; comments 18–23
- **Gates and overlaps:** worklog-ui; timezone-display; animation-metadata
- **Verify:** Run checkFile on changed TS/HTML/SCSS files and a production build; Open History, expand/collapse a week by mouse and keyboard, and open/close CSV export; Compare desktop and narrow-width export layout.
- **Source findings:** P21-C2

### C03-012 — Delete the empty NoteEffects class and registration

- **Full-review result:** Rank 29/100; controlling original placements 39/41/27. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete note.effects.ts and exactly its import and EffectsModule registration; retain the note reducer registration and all other effect ordering.
- **Corrected LOC:** production 6; comments 0; tests 0
- **Material corrections:** C05-014 touches the same module at distinct symbols and must land or rebase independently.; The note reducer remains registered exactly once.
- **Primary gate:** None.
- **Required verification:** Run the feature-stores module check and a production build.; Confirm NoteEffects has no references and noteReducer remains registered once.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/note/store/note.effects.ts` — NoteEffects; `src/app/root-store/feature-stores.module.ts` — NoteEffects import, EffectsModule.forFeature registration
- **Why it exists:** Former note persistence effects were removed, leaving an empty injectable and an empty NgRx effect-source registration.
- **Smallest change:** Delete note.effects.ts and remove exactly its import and EffectsModule registration; retain the note reducer registration.
- **Preserve:** No action stream, effect, side effect, reducer ordering, persistence operation, lifecycle hook, UI behavior, or platform behavior changes because the class has no behavior.
- **Evidence:** The class declares no createEffect stream or members, and exhaustive registration tracing finds only the two module wiring references.
- **Estimated net change:** production 6
- **Gates and overlaps:** root-store-wiring
- **Verify:** Run checkFile on feature-stores.module.ts; Run the production build to catch stale imports or registrations; Verify the note reducer remains registered exactly once.
- **Source findings:** P24-C1

### C03-013 — Remove stale NoteComponent inline-editor and input-lifecycle remnants

- **Full-review result:** Rank 77/100; controlling original placements 78/79/79. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Do not implement before PR #8982 resolves. After rebase, audit inline-editor/style residue separately from the aliased-input ngOnChanges path against the new draft lifecycle and tests; retain image-safety and all persistence behavior.
- **Corrected LOC:** production re-estimate after PR #8982; comments re-estimate after PR #8982; tests re-estimate after PR #8982
- **Material corrections:** PR #8982 substantially changes the exact component and adds draft behavior/tests.; The catalog combines two different migrations.; The baseline lacks a focused NoteComponent spec.; safeImgUrl/isPathSafeToOpen are security boundaries and remain.
- **Primary gate:** Wait for PR #8982, rebase, and re-audit symbols, LOC, and the draft/input contract.
- **Required verification:** Use the post-PR focused spec to characterize replacement inputs, safe/unsafe images, fullscreen editing, and draft recovery/conflict/checkpoint/save order.; Run focused note/draft tests, changed-file checks, and desktop/mobile visual smoke tests.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `src/app/features/note/note/note.component.ts` — markdownEl, ngOnChanges, updateContent, OnChanges, SimpleChanges; `src/app/features/note/note/note.component.scss` — .controls, .content inline-markdown
- **Why it exists:** The inline note editor and an older input-reset lifecycle were removed, but their view query, update method, duplicate OnChanges assignment, and unmatched styles remained.
- **Smallest change:** After rebasing on PR #8982, delete only the unused query/import, updateContent, redundant OnChanges implementation, and unmatched selectors; preserve the fullscreen editor and all new draft-recovery behavior.
- **Preserve:** Note rendering, pin/remove/edit actions, fullscreen editing, link safety, clipboard image behavior, project/tag context, and—after #8982—draft loading, checkpointing, conflict prompts, discard confirmation, and durable-save order remain unchanged.
- **Evidence:** Template and selector tracing proves the inline-editor remnants are unreachable. Open PR #8982 edits NoteComponent and adds its first focused spec but leaves these exact remnants, creating a source conflict rather than supersession.
- **Estimated net change:** production 54–60; comments 1; tests -50–-30
- **Gates and overlaps:** open PR conflict; user content; draft persistence; characterization required; rebase and re-audit after PR #8982, which changes `NoteComponent` and its draft behavior.
- **Verify:** Re-audit symbols and LOC after PR #8982 lands or changes; do not implement against the pre-PR shape; Use the new NoteComponent spec to characterize ngOnChanges and fullscreen draft flows before deleting lifecycle code; Run checkFile on NoteComponent/SCSS and the focused note/draft/fullscreen tests.
- **Source findings:** P24-C2

### C03-014 — Delete the orphaned Markdown checklist parser and model

- **Full-review result:** Rank 9/100; controlling original placements 7/14/11. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete the two converter files/specs and markdown-checklist.model.ts from src/app/features/markdown-checklist. Retain checklist operations, detection, progress, editors, and task/note behavior.
- **Corrected LOC:** production 20; tests deleted 47; comments 0
- **Material corrections:** All three canonical production paths were wrong.; The model is markdown-checklist.model.ts, not markdown-checklist-task.model.ts.; PR #6782 is adjacent but does not overlap the corrected files/symbols.
- **Primary gate:** None.
- **Required verification:** Repeat exact static, dynamic, public, plugin, and platform searches at implementation HEAD.; Run live checklist operation/detection/progress and Markdown editor tests plus a frontend build.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 5; challenges: refuter narrowed, maintainer narrowed.
- **Scope:** `src/app/util/markdown-to-checklist.ts` — markdownToChecklist; `src/app/util/checklist-to-markdown.ts` — checklistToMarkdown; `src/app/util/markdown-checklist-task.model.ts` — MarkdownChecklistTask
- **Why it exists:** A superseded Markdown checklist conversion experiment remains as isolated exports, a transient model, and self-only specs with no production consumer.
- **Smallest change:** Delete the two conversion utilities, transient model, their self-only specs, and any now-empty export references; retain all live Markdown rendering/editor utilities.
- **Preserve:** No production import, template, plugin/public API, dynamic registry, Electron/native surface, or live behavioral assertion changes.
- **Evidence:** Repository-wide import and dynamic/public-surface tracing found only the utility declarations and their own tests; the entire concept is disconnected from live Markdown editing.
- **Estimated net change:** production 20; tests 47
- **Gates and overlaps:** public-looking utility exports; checklist-adjacent PR #6782 had no target-file or symbol overlap during the audit but must be rechecked at implementation `HEAD`.
- **Verify:** Repeat exact export/import, template, plugin, registry, and string searches before deletion; Run checkFile on any touched barrel and a production build; Confirm live Markdown editor/rendering specs remain unchanged.
- **Source findings:** P27-001

### C03-015 — Remove the test-only keyboard-layout compatibility implementation

- **Full-review result:** Rank 23/100; controlling original placements 29/29/22. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete userKbLayout, saveUserKbLayout, and unused compatibility type re-exports; keep service connection and raw fallback, and update utility tests to install isolated KeyboardLayoutService instances.
- **Corrected LOC:** production 18-28; comments 10-16; tests deleted net 11-27
- **Material corrections:** Keyboard normalization is a global shortcut hot path with medium risk.; Tests need fresh service instances to avoid module-global leakage.; macOS Electron startup/global-shortcut behavior requires explicit coverage.; C07 owns overlapping focused tests and must coordinate edits.
- **Primary gate:** Coordinate overlapping keyboard test ownership and preserve null-service startup fallback.
- **Required verification:** Run both keyboard utility/service specs with per-test isolation and GlobalConfig effects startup coverage.; Build and smoke a non-QWERTY Chromium shortcut plus initial macOS Electron global-shortcut registration.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/util/check-key-combo.ts` — KeyboardLayout type re-exports, userKbLayout, saveUserKbLayout, prepareKeyCode; `src/app/util/check-key-combo.spec.ts` — duplicated layout-loader setup
- **Why it exists:** KeyboardLayoutService became the production authority, but the low-level shortcut utility retained a second browser loader, global map, and compatibility types used only by its test.
- **Smallest change:** Delete the deprecated map, loader, and type re-exports; have prepareKeyCode read the optional service layout directly and update the spec to install the existing service.
- **Preserve:** All shortcut inputs/outputs, modifier and plus/minus handling, QWERTY/QWERTZ mapping, raw-code fallback before initialization, browser API error handling, and macOS Electron eager loading remain unchanged.
- **Evidence:** Exact searches find no production importer of the compatibility exports; the utility and service suites together already cover layouts, fallback, browser API presence/absence, mapping, and errors.
- **Estimated net change:** production 18–28; comments 10–16; tests 11–27
- **Gates and overlaps:** keyboard-shortcuts; task-hot-path-adjacent; electron-startup; C07 owns the two focused test files
- **Verify:** Run checkFile and both check-key-combo and keyboard-layout service specs; Verify one non-QWERTY shortcut in Chromium with navigator.keyboard support; Verify initial macOS Electron global shortcut registration still uses the eagerly loaded service layout.
- **Source findings:** F11-01-C1

## C04 — Issue providers, plugins, and plugin API/runtime (15 candidates)

### C04-001 — Delete the permanently hidden issue-panel intro component

- **Full-review result:** Rank 5/100; controlling original placements 6/5/6. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete the intro TS, HTML, and SCSS files and remove only its component import/import entry, false signal, and guarded template block.
- **Corrected LOC:** production 54–56; configuration 0; comments 0; test infrastructure 0; tests -35–-15; generated 0; moved 0
- **Material corrections:** Use the exact unreachable UI fence only; do not alter adjacent provider setup UI.; The characterization spec is a prudent gate, not evidence that the component is reachable.
- **Primary gate:** Capture or add one issue-panel render characterization before deletion.
- **Required verification:** Run checkFile and the focused issue-panel component spec.; Repeat exact class, selector, and signal searches.; Render the issue panel with zero and configured providers after rebasing nearby setup work.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/issue-panel/issue-panel.component.ts` — IssuePanelIntroComponent, isShowIntro; `src/app/features/issue-panel/issue-panel.component.html` — issue-panel-intro conditional; `src/app/features/issue-panel/issue-panel-intro/issue-panel-intro.component.ts` — IssuePanelIntroComponent; `src/app/features/issue-panel/issue-panel-intro/issue-panel-intro.component.html` — issue panel intro template; `src/app/features/issue-panel/issue-panel-intro/issue-panel-intro.component.scss` — host styles
- **Why it exists:** An unfinished issue-panel draft introduced an intro behind a signal that has always been false and has no writer; its Hide button is also inert.
- **Smallest change:** Delete the intro component files and remove its import, imports entry, false signal, and guarded template block.
- **Preserve:** Provider tabs, setup overview, configured-provider behavior, DOM/accessibility output, and all provider state remain unchanged; do not add a replacement setting or intro.
- **Evidence:** Class, selector, path, signal, route, dynamic-registration, platform, and history searches find no reachable construction path.
- **Estimated net change:** production 54–59; tests -35–-15
- **Gates and overlaps:** issue-provider setup UI; same-area open PR; uncovered component; Pre-change render characterization; PR #8160 changes issue-provider setup surfaces.
- **Verify:** Add a focused pre-change IssuePanel render characterization; npm run checkFile src/app/features/issue-panel/issue-panel.component.ts; npm run test:file src/app/features/issue-panel/issue-panel.component.spec.ts; Re-run exact class/selector/signal searches after rebasing PR #8160.
- **Source findings:** P06-01-C1

### C04-002 — Centralize duplicated issue-field value resolution

- **Full-review result:** Rank 91/100; controlling original placements 92/91/89. Safety: narrow; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change under this candidate. CalDAV's function-valued branch and the parent-only error boundary prevent one behavior-identical four-site resolver, and the review contract excludes the proposed new abstraction.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** CaldavTimeComponent returns function values without date formatting but formats path values; the proposed shared policy is false evidence of semantic identity.; Sharing only three copies still introduces an abstraction explicitly excluded by the review contract and leaves the highest-risk special case local.
- **Primary gate:** None; the candidate is excluded unless the abstraction contract changes.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/issue/issue-content/issue-content.component.ts` — IssueContentComponent.getFieldValue; `src/app/features/issue/issue-content/issue-content-custom/issue-content-custom.component.ts` — IssueContentCustomComponent.getFieldValue; `src/app/features/issue/issue-content/issue-content-custom/caldav-time/caldav-time.component.ts` — CaldavTimeComponent.fieldValue; `src/app/features/issue/issue-content/issue-content-custom/jira-link/jira-link.component.ts` — JiraLinkComponent.fieldValue; `src/app/features/issue/issue-content/get-issue-field-value.util.ts` — resolveIssueFieldValue
- **Why it exists:** Four issue renderers copied the same function-or-dot-path resolution policy during component extraction.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Two independent route scans identify the same four implementations and the same policy boundary. LOC uses the overlapping envelope rather than summing both estimates.
- **Rejected historical estimate:** Zero LOC is authorized. production 20–32; comments 0–3; tests -70–-20
- **Gates and overlaps:** public plugin display-field syntax; dynamic callback execution; error-boundary drift; calendar value formatting; Pre-change resolver characterization; P06-01-C3 and P06-02-C1 are exact corroborations; their LOC was not summed.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** P06-01-C3; P06-02-C1

### C04-003 — Delete the unused calendar-provider-by-id selector

- **Full-review result:** Rank 36/100; controlling original placements 42/45/31. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only selectCalendarProviderById.
- **Corrected LOC:** production 5; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Low reward does not override the mechanical Tier A rule because the deletion has no blocker and satisfies the validity, risk, and confidence thresholds.
- **Primary gate:** None.
- **Required verification:** Run checkFile on issue-provider.selectors.ts.; Repeat the exact symbol search and type-check consumers.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/issue/store/issue-provider.selectors.ts` — selectCalendarProviderById
- **Why it exists:** A pure selector export remained after every calendar integration consumer converged on the provider-list selector.
- **Smallest change:** Delete only selectCalendarProviderById.
- **Preserve:** selectCalendarProviders, IssueProviderCalendar typing, NgRx state shape, action flow, persistence, and sync behavior remain untouched.
- **Evidence:** Exact TypeScript, template, string, public-barrel, plugin, native, and build searches find only the declaration.
- **Estimated net change:** production 5
- **Gates and overlaps:** NgRx selector surface
- **Verify:** npm run checkFile src/app/features/issue/store/issue-provider.selectors.ts; Run exact symbol search after deletion.
- **Source findings:** P06-02-C2

### C04-004 — Delete the orphaned Jira wonky-cookie authentication path

- **Full-review result:** Rank 19/100; controlling original placements 22/23/13. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete \_checkSetWonkyCookie and its exclusive dialog imports/injection, and remove the now-exclusive MatDialog import/provider from the Jira API spec; retain live SS.JIRA_WONKY_COOKIE cleanup in \_blockAccess.
- **Corrected LOC:** production 34–40; configuration 0; comments 1; test infrastructure 0; tests 2; generated 0; moved 0
- **Material corrections:** The audit scope omitted exclusive test DI residue.; The retained unauthorized-access cleanup is live security behavior and is outside deletion scope.
- **Primary gate:** Recheck the focused scope after nearby Jira changes are rebased.
- **Required verification:** Run checkFile and the focused Jira API suite.; Repeat exact method and exclusive-dependency searches.; Smoke successful and unauthorized Jira requests in Electron.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 9; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/app/features/issue/providers/jira/jira-api.service.ts` — \_checkSetWonkyCookie, MatDialog, DialogPromptComponent, \_matDialog
- **Why it exists:** The sole caller of an experimental cookie-auth prompt was removed, leaving a secret-handling method and exclusive dialog dependency unreachable.
- **Smallest change:** Delete the private method and exclusive imports/injection while retaining legacy-key cleanup in \_blockAccess.
- **Preserve:** Basic/PAT credentials, fetch/extension/Electron transports, request headers, error mapping, blocked-access UI, and SS.JIRA_WONKY_COOKIE cleanup remain unchanged.
- **Evidence:** Exact dependency and history tracing proves the auth branch has no caller; current credential and transport paths are separate.
- **Estimated net change:** production 36–40; comments 1; tests 2
- **Gates and overlaps:** authentication; credential cleanup; Electron transport; PR #7808 changes nearby Jira behavior but not the target file, so perform rebase-time review and an active Jira API smoke test.
- **Verify:** npm run checkFile src/app/features/issue/providers/jira/jira-api.service.ts; npm run test:file src/app/features/issue/providers/jira/jira-api.service.spec.ts; Electron smoke: successful and unauthorized Jira requests after rebasing PR #7808.
- **Source findings:** P07-C1

### C04-005 — Replace Redmine ParamsBuilder with request-local parameter objects

- **Full-review result:** Rank 24/100; controlling original placements 24/31/25. Safety: confirm; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Replace the five builder chains with typed request-local parameter records in the same insertion order and delete ParamsBuilder; inline the two scope variants and add no helper abstraction.
- **Corrected LOC:** production 24–38; configuration 0; comments 0; test infrastructure 0; tests -18–-10; generated 0; moved 0
- **Material corrections:** The upper LOC estimate depended on an unnecessary scope helper; direct records are the smaller design.; HttpParams key order and exact Redmine request serialization require characterization before replacement.
- **Primary gate:** Add exact request assertions for all five request sites before refactoring.
- **Required verification:** Run checkFile and the focused Redmine service suite.; Compare global, created-by-me, assigned-to-me, time-entry, ASCII, numeric, and non-Latin requests.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/issue/providers/redmine/redmine-api.service.ts` — ParamsBuilder, \_getIssueByIdInProject$, getLast100IssuesForCurrentRedmineProject$, getTimeEntriesForCurrentUser$, _searchTextIssuesInProject$, \_searchIssuesBySubjectInProject$
- **Why it exists:** Five small HTTP requests share a mutable any-typed mini-language that is larger and less explicit than their parameter contracts.
- **Smallest change:** Use typed request-local parameter records in the existing key order and, only if needed, one pure scope-param helper; delete ParamsBuilder.
- **Preserve:** Every URL, bracketed Redmine filter key, value conversion, query encoding, scope, request option, response mapping, and error path remains byte-for-byte equivalent.
- **Evidence:** Endpoint-level comparison shows the builder contributes no behavior beyond record construction; exact request tests can characterize the boundary.
- **Estimated net change:** production 36–55; tests -12–-4
- **Gates and overlaps:** HTTP query serialization; provider scoping; non-Latin search; Exact request characterization
- **Verify:** Add/confirm exact request assertions for assigned/created scopes and time-entry user_id/issue_id; npm run checkFile src/app/features/issue/providers/redmine/redmine-api.service.ts; npm run test:file src/app/features/issue/providers/redmine/redmine-api.service.spec.ts; Smoke numeric, ASCII, and non-Latin searches in project/global modes.
- **Source findings:** P08-C1

### C04-006 — Resolve the inert PluginCleanupService registry against the sandbox lifecycle plan

- **Full-review result:** Rank 84/100; controlling original placements 84/84/84. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Make no code change until sandbox lifecycle ownership is decided; create a deletion candidate only if issue #8226 rejects PluginCleanupService as the lifecycle owner.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The registry is not effect-free: it retains and releases strong iframe references even though no reader exists.; The candidate is presently an unresolved security-lifecycle architecture choice, not a behavior-preserving simplification.
- **Primary gate:** Resolve issue #8226 lifecycle ownership.
- **Required verification:** If deletion later wins, characterize iframe mount, remount, unload, listeners, hooks, callbacks, caches, and node grants on web and Electron.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary defer. **Classification:** conflicting.
- **Scope:** `src/app/plugins/plugin-cleanup.service.ts` — PluginCleanupService, registerIframe, cleanupPlugin, cleanupAll; `src/app/plugins/plugin-runner.ts` — PluginCleanupService integration, unloadPlugin; `src/app/plugins/plugin.service.ts` — PluginCleanupService integration, ngOnDestroy; `src/app/plugins/ui/plugin-index/plugin-index.component.ts` — PluginCleanupService integration, \_cleanupIframeCommunication, onIframeLoad; `src/app/plugins/ui/plugin-index/plugin-index.component.html` — iframe load binding
- **Why it exists:** The service stores iframe references but its cleanup methods only delete Map entries; real listener, iframe, hook, API, callback, and cache teardown is owned elsewhere.
- **Smallest change:** Do not delete yet. First decide issue #8226: either make this the real sandbox lifecycle owner, or close that design and then delete the registry and only its write-only integrations.
- **Preserve:** In either resolution, retain message-listener removal, srcdoc reset, iframe detachment, onUnload idempotence/failure isolation, API/callback/hook teardown order, cache clearing, node consent, and public bridge behavior.
- **Evidence:** Two independent audits confirm current inertness, but current GitHub design work explicitly names this service for future lifecycle ownership. Overlapping LOC is represented by one envelope, not summed.
- **Estimated net change:** production 28–38; comments 15–27; tests 41–65
- **Gates and overlaps:** plugin lifecycle; iframe teardown; security boundary; Electron; future sandbox design; Architecture decision for issue #8226; I02-C01 and L03-C01 are corroborating scans; LOC was not summed; Issue #8226 proposes reusing this service and conflicts with immediate deletion.
- **Verify:** Resolve #8226 lifecycle ownership before implementation; Characterize iframe mount/unmount/remount and listener removal in web and packaged Electron; Retain PluginRunner and PluginService teardown tests; If deletion wins, run checks/specs for every integration file and a production frontend build.
- **Source findings:** I02-C01; L03-C01

### C04-007 — Delete the unused path-based plugin translation loader

- **Full-review result:** Rank 7/100; controlling original placements 5/7/12. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete the path loader and exclusive HttpClient/firstValueFrom dependencies, remove the now-obsolete HttpClientTestingModule from the i18n spec, and remove the stale runner mock key.
- **Corrected LOC:** production 31; configuration 0; comments 4; test infrastructure 0; tests 3; generated 0; moved 0
- **Material corrections:** The original scope omitted HttpClientTestingModule residue in plugin-i18n.service.spec.ts.
- **Primary gate:** None.
- **Required verification:** Run checkFile on the service and both affected specs.; Run the focused i18n and plugin-runner suites.; Repeat method, manifest, and dynamic-string searches.
- **Discovery-era record (superseded):** Open. **Tier:** Final A. **Classification:** net-new. Rank 4; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/app/plugins/plugin-i18n.service.ts` — loadPluginTranslationsFromPath, \_http; `src/app/plugins/plugin-runner.spec.ts` — mockI18nService.loadPluginTranslationsFromPath
- **Why it exists:** Translation loading moved to content supplied by PluginLoaderService, leaving the former HTTP path method and dependency unreachable.
- **Smallest change:** Delete the path method, exclusive HttpClient/firstValueFrom dependencies, obsolete test module, and stale mock key.
- **Preserve:** PluginLoaderService, loadPluginTranslationsFromContent, bundled/uploaded translation behavior, language switching, manifest paths, and plugin public APIs remain unchanged.
- **Evidence:** Production, test, manifest, dynamic, and platform searches find no caller; all live paths use content loading.
- **Estimated net change:** production 31; comments 4; tests 3
- **Gates and overlaps:** plugin translations; uploaded plugin assets; the Microsoft 365 provider plan relies on the retained content-based loader; PR #7158 had no direct target-file or symbol overlap as of 2026-07-16 but must be rechecked at implementation `HEAD`.
- **Verify:** npm run checkFile src/app/plugins/plugin-i18n.service.ts; npm run checkFile src/app/plugins/plugin-i18n.service.spec.ts; npm run checkFile src/app/plugins/plugin-runner.spec.ts; npm run test:file src/app/plugins/plugin-i18n.service.spec.ts; npm run test:file src/app/plugins/plugin-runner.spec.ts
- **Source findings:** I03-01-C01

### C04-008 — Delete the inert custom plugin initializer provider

- **Full-review result:** Rank 20/100; controlling original placements 17/22/23. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Remove the custom provider import and registration from main.ts and delete plugin-initializer.ts only.
- **Corrected LOC:** production 13; configuration 0; comments 7; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The string-token provider is lazy and is never resolved; StartupService independently owns live initialization.
- **Primary gate:** Keep the root-bootstrap diff isolated from adjacent providers.
- **Required verification:** Run checkFile on main.ts and the focused StartupService suite.; Run a production frontend build and one web/Electron cold start.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/plugins/plugin-initializer.ts` — initializePlugins, PLUGIN_INITIALIZER_PROVIDER; `src/main.ts` — PLUGIN_INITIALIZER_PROVIDER registration
- **Why it exists:** A custom multi-provider token is registered at bootstrap but no consumer resolves it, while StartupService independently performs the live initialization.
- **Smallest change:** Remove the main.ts import/provider entry and delete plugin-initializer.ts.
- **Preserve:** StartupService remains the sole live call to PluginService.initializePlugins; startup, hydration/sync gating, initialization order, error behavior, and platform behavior remain unchanged.
- **Evidence:** Token-resolution searches show no consumer and startup tests identify the independent live initialization path.
- **Estimated net change:** production 13; comments 7
- **Gates and overlaps:** application bootstrap; plugin initialization ordering; sync/hydration boundary; src/main.ts is a cross-domain bootstrap file; make no adjacent provider changes.
- **Verify:** npm run checkFile src/main.ts; npm run test:file src/app/core/startup/startup.service.spec.ts; npm run buildFrontend:prod:es6; Cold-start web and Electron and confirm one plugin initialization.
- **Source findings:** I03-01-C02

### C04-009 — Remove dormant cached-asset fields from PluginState

- **Full-review result:** Rank 76/100; controlling original placements 79/78/76. Safety: defer; maintainability: confirm; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** After PluginService security and persistence work is rebased, remove code/indexHtml/icon from PluginState, the unused PluginLoadResult type, and only duplicate state.icon writes; preserve dedicated icon/index registries and sanitization.
- **Corrected LOC:** production 10–12; configuration 0; comments 1; test infrastructure 0; tests -8–-2; generated 0; moved 0
- **Material corrections:** PluginState is exposed through a public signal/service method even though current consumers do not read these fields.; Active security and persistence changes invalidate implementation-time reachability proof until rebased.; The smaller defensible production estimate is 10-12, not 14.
- **Primary gate:** Rebase overlapping PluginService security/persistence work and repeat field-level tracing.
- **Required verification:** Characterize built-in and uploaded icons through the dedicated signal and sanitizer.; Run plugin service and ZIP-loading suites.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/plugins/plugin-state.model.ts` — PluginState.code, PluginState.indexHtml, PluginState.icon, PluginLoadResult; `src/app/plugins/plugin.service.ts` — PluginState icon writes
- **Why it exists:** PluginState retained optional asset caches and an unused load-result type after icons and HTML moved to dedicated registries.
- **Smallest change:** Delete the three optional fields, unused interface, and duplicate state.icon writes only.
- **Preserve:** Dedicated \_pluginIcons, \_pluginIconsSignal, \_pluginIndexHtml, manifest/state identity, persistence shapes, PluginState public consumers, sanitized icon handling, and UI output remain unchanged.
- **Evidence:** Field-level reference tracing finds only writes and object-literal scaffolding; reads use the dedicated registries.
- **Estimated net change:** production 14; comments 1; tests -8–-2
- **Gates and overlaps:** plugin state model; uploaded assets; SVG security hardening; icon-registry characterization; rebase PR #9077 while preserving its `PluginService` sanitization helper/registry writes, and recheck nearby persistence changes from PR #8067.
- **Verify:** Before deletion, characterize built-in and uploaded icons through getPluginIconsSignal; Rebase PR #9077 and retain \_sanitizePluginIconSvg and its tests; npm run checkFile src/app/plugins/plugin-state.model.ts; npm run checkFile src/app/plugins/plugin.service.ts; npm run test:file src/app/plugins/plugin.service.spec.ts; npm run test:file src/app/plugins/plugin.service.load-from-zip.spec.ts
- **Source findings:** I03-01-C03

### C04-010 — Delete the disconnected eager PluginService loading subsystem

- **Full-review result:** Rank 43/100; controlling original placements 36/53/47. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete only private \_loadBuiltInPlugins, \_loadUploadedPlugins, \_loadPluginsFromPaths, and \_loadUploadedPlugin after rebase-time tracing; preserve public getAllPluginsLegacy and loadPluginFromPath, which keep \_loadPlugin and \_ensurePluginEnabledInMemory live.
- **Corrected LOC:** production 115–125; configuration 0; comments 17–23; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The original 258-line scope falsely called the whole chain disconnected despite public loadPluginFromPath reaching \_loadPlugin.; Public TypeScript service methods are preserved under the contract; getAllPluginsLegacy is also a separate root cause.; The original estimate omitted substantial comment/JSDoc LOC.
- **Primary gate:** Rebase same-file security/persistence work and reproduce the private dependency trace.
- **Required verification:** Run checkFile, plugin service and ZIP-loading suites, and a production frontend build.; Smoke discovery, activation, ZIP install, reload, consent, and bundled/uploaded plugins on web and Electron.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/plugins/plugin.service.ts` — \_loadBuiltInPlugins, \_loadUploadedPlugins, \_loadPluginsFromPaths, \_loadPlugin, getAllPluginsLegacy, loadPluginFromPath, \_loadUploadedPlugin, \_ensurePluginEnabledInMemory
- **Why it exists:** The foundational plugin API retained an older eager loader chain beside the manifest-discovery/lazy-activation route, but never connected that chain to initialization or any runtime entry point.
- **Smallest change:** Delete only the eight disconnected methods and the isolated legacy-enumeration test/setup.
- **Preserve:** Discovery, \_loadPluginLazy, activatePlugin, ZIP install, reload, enabled-state persistence, security analysis, consent, hooks, bridge methods, public/plugin contracts, native/node execution, and error behavior remain unchanged.
- **Evidence:** A complete private dependency trace ends inside the chain; initializePlugins, imports, UI activation, ZIP, reload, IPC/native, manifest, and dynamic searches enter other live methods.
- **Estimated net change:** production 258; tests 15–17
- **Gates and overlaps:** large deletion; plugin loading; security/consent; persistence reads; Electron node execution; same-file open PRs; Post-rebase reachability reproduction; PRs #9077 and #8067 change PluginService; retain all newly live public, persistence, and security paths.
- **Verify:** Rebase PRs #9077 and #8067 and re-run the dependency trace; npm run checkFile src/app/plugins/plugin.service.ts; npm run checkFile src/app/plugins/plugin.service.spec.ts; npm run test:file src/app/plugins/plugin.service.spec.ts; npm run test:file src/app/plugins/plugin.service.load-from-zip.spec.ts; npm run buildFrontend:prod:es6; Smoke bundled, uploaded, reload, and nodeExecution flows on web/Electron.
- **Source findings:** I03-02-C1

### C04-011 — Remove obsolete route and breakpoint subscriptions from plugin side-panel buttons

- **Full-review result:** Rank 13/100; controlling original placements 11/16/17. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the unread router/breakpoint injections, pipelines, signals, computed fields, and their exclusive imports.
- **Corrected LOC:** production 20; configuration 0; comments 0; test infrastructure 0; tests -40–-25; generated 0; moved 0
- **Material corrections:** Parent MainHeader visibility remains the only responsive policy; no local replacement is needed.
- **Primary gate:** None.
- **Required verification:** Run checkFile and compile through the main-header spec.; Render and click on a non-work route, then check desktop and narrow widths.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/plugins/ui/plugin-side-panel-btns.component.ts` — \_router, \_breakpointObserver, \_isXs$, isXs, currentRoute, isWorkView
- **Why it exists:** Plugin panels were intentionally enabled on all routes, but their backing route pipeline remained; a breakpoint signal was dead from introduction.
- **Smallest change:** Delete only unused imports, injections, subscriptions, signals, and computed fields.
- **Preserve:** Public side-panel registration, bridge signal, responsive parent visibility, rendering, tooltip, active state, layout dispatch payload/order, plugin callback, and all-route availability remain unchanged.
- **Evidence:** Current template/handler tracing finds no read, the responsive parent owns narrow-screen visibility, and history identifies removal of the route restriction.
- **Estimated net change:** production 20; tests -40–-25
- **Gates and overlaps:** public plugin side-panel surface; responsive UI; layout action; untested leaf component; Pre-change component characterization
- **Verify:** Add a pre-change render/click characterization on a non-work route; npm run checkFile src/app/plugins/ui/plugin-side-panel-btns.component.ts; npm run test:file src/app/plugins/ui/plugin-side-panel-btns.component.spec.ts; npm run test:file src/app/core-ui/main-header/main-header.component.spec.ts; Manual desktop/narrow-width checks.
- **Source findings:** I03-02-C2

### C04-012 — Share the provider build recipe across six issue and two calendar plugins

- **Full-review result:** Rank 92/100; controlling original placements 93/92/87. Safety: defer; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Keep straightforward package-local build recipes rather than adding a shared monorepo-relative helper across eight independently executable package roots.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The review contract excludes new abstractions and bundled roots.; The helper creates package-portability and CI-invalidation coupling; only four packages currently share build-all orchestration.; Byte-identical output at one revision does not prove ongoing standalone build compatibility.
- **Primary gate:** None; the abstraction is excluded unless package-portability policy and the review contract change.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** proposed `packages/plugin-dev/scripts/build-issue-provider.js` shared helper; `packages/plugin-dev/azure-devops-issue-provider/scripts/build.js`, `clickup-issue-provider/scripts/build.js`, `gitea-issue-provider/scripts/build.js`, `github-issue-provider/scripts/build.js`, `linear-issue-provider/scripts/build.js`, `trello-issue-provider/scripts/build.js`, `caldav-calendar-provider/scripts/build.js`, and `google-calendar-provider/scripts/build.js` package-local wrappers.
- **Why it exists:** Eight independently executable package scripts duplicate one esbuild-and-asset-copy recipe, with calendar plugins differing only by absence of i18n copying.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Independent package audits identify the same recipe and the exact calendar variant. The LOC range is a conservative combined envelope and does not double-count the shared helper addition.
- **Rejected historical estimate:** Zero LOC is authorized. configuration 220–301; comments 13–21
- **Gates and overlaps:** build-output reproducibility; package-local dependency resolution; plugin manifests/assets; translation assets; pre-change artifact inventory and hash characterization; I07-C01, I08-01-C03, and L10-C03 share the helper direction without additive helper LOC; C06-012 is a superseded duplicate; the Microsoft 365 provider plan may consume the helper only after output characterization.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I07-C01; I08-01-C03; L10-C03

### C04-013 — Delete the unreachable Brain Dump line-by-line fallback

- **Full-review result:** Rank 26/100; controlling original placements 23/34/39. Safety: confirm; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** After the trimmed-text guard, remove the fallback and unconditionalize the structured path in the package source, then update the byte-identical shipped bundled asset; retain final draft clearing and ordered side effects.
- **Corrected LOC:** production 22–24; configuration 0; comments 1; test infrastructure 0; tests 0; generated 23–25; moved 35–50
- **Material corrections:** The audit omitted the live bundled asset copy.; Unindentation churn is moved/reindented LOC, not extra savings.; The one-off ordered-effect trace must cover warning snacks as well as task creation and persistence.
- **Primary gate:** Prove every accepted nonempty input produces at least one parsed main task with the same ordered side effects.
- **Required verification:** Trace empty, plain, bullet, orphan-indented, mixed, deep, project, and due-date inputs.; Run a JavaScript syntax check and compare package source with the bundled asset.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `packages/plugin-dev/brain-dump/plugin.js` — submitTasks line-by-line fallback, parseTasksWithSubTasks
- **Why it exists:** After the empty-text guard, the parser always returns a nonempty array, making a second task-creation implementation unreachable.
- **Smallest change:** Remove the truthiness/length conditional and fallback branch; execute the current structured path unconditionally after the existing guard.
- **Preserve:** Parsing, task and subtask order, addTask call order, project assignment, due-day inheritance, persisted draft clearing, snack timing, and plugin API payloads remain identical.
- **Evidence:** Control-flow analysis proves parser totality for every accepted input; a VM/DOM stub can compare ordered effects across representative fixtures.
- **Estimated net change:** production 21; comments 1
- **Gates and overlaps:** plugin task creation; synced plugin draft persistence; due-day semantics; side-effect ordering; Ordered-effect characterization
- **Verify:** Capture ordered addTask/showSnack/persistDataSynced calls for plain, bullet, nested, mixed, project, and due-date fixtures; Repeat fixture snapshots after deletion; Run a JavaScript syntax check and manually submit plain/nested tasks.
- **Source findings:** I08-01-C01

### C04-014 — Delete unreferenced API-test dashboard helpers and write-only sample IDs

- **Full-review result:** Rank 95/100; controlling original placements 94/94/94. Safety: narrow; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No candidate change. Retain testThemeInfo and testDeleteCounter as developer-console API exercises; the separate six authored sample-ID lines and bundled copy are below the audit value threshold.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Static caller absence is false evidence of deadness in an intentionally interactive classic-script developer dashboard.; Deleting testDeleteCounter removes the only executable dashboard exercise for a listed API and weakens tests.; The audit omitted the byte-identical shipped asset and bundled unrelated sample-ID residue.
- **Primary gate:** None; preserve the manual dashboard contract.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `packages/plugin-dev/api-test-plugin/index.html` — testThemeInfo, testDeleteCounter, lastProjectId, lastTagId
- **Why it exists:** Developer dashboard experiments remained as globally scoped functions and sample IDs after their buttons/run-all callers were removed.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Markup, script, exact-string, browser-global, and repository searches find no read/call, but the dynamic developer page merits a snapshot first.
- **Rejected historical estimate:** Zero LOC is authorized. production 86; comments 1
- **Gates and overlaps:** dynamic browser globals; developer test surface; public PluginAPI exercise; Dashboard inventory and run-all characterization
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I08-01-C02

### C04-015 — Delete the superseded static procrastination-type catalog

- **Full-review result:** Rank 2/100; controlling original placements 2/2/2. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** implemented-stashed.
- **Authoritative scope:** Delete only the deprecated JSDoc and the unreferenced procrastinationTypes export; retain the translated live factory.
- **Corrected LOC:** Production code: 90 lines deleted. Comment-only lines: 6 deleted. Blank lines: 1 deleted. Total physical deletion: 97 lines.
- **Material corrections:** The canonical record omitted six deleted JSDoc comment lines; the completed stash deletes 97 physical lines in total.
- **Primary gate:** None.
- **Required verification:** Repeat exact symbol/import searches and run the plugin typecheck/build.; Confirm the live factory retains translated IDs, order, labels, and action positions.
- **Discovery-era record (superseded):** Implemented, verified, and stashed. **Tier:** Final A. **Classification:** net-new. Rank 1; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `packages/plugin-dev/procrastination-buster/src/types.ts` — procrastinationTypes
- **Why it exists:** A static catalog remained after UI consumers moved to the translated factory, duplicating the same domain data without a reference.
- **Smallest change:** Delete only the deprecated documentation block and procrastinationTypes array.
- **Preserve:** Shared interfaces, IDs, enums, translated factory, displayed catalog, persistence identifiers, and plugin behavior remain unchanged.
- **Evidence:** Exact symbol/import tracing finds no consumer and confirms App.tsx uses the translated factory.
- **Estimated net change:** production 90; comments 6
- **Stashed actual and completed verification:** The physical deletion was exact: 90 production-code lines, 6 comment-only lines, and 1 blank line. Exact reference checks, the plugin package typecheck/build, and the production frontend build passed; translated IDs, order, and action positions were preserved.
- **Gates and overlaps:** plugin domain identifiers; translated UI catalog
- **Verify:** Run exact reference search; Run the package typecheck and build; Confirm catalog IDs and labels still come from the translated factory.
- **Source findings:** I08-02-C01

## C05 — Electron, native, and platform (15 candidates)

### C05-001 — Delete noncompiled Electron updater, Pomodoro/DBus, and pseudo-API remnants

- **Full-review result:** Rank 49/100; controlling original placements 56/47/55. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Keep only the coherent auto-updater concept: delete its 20-line noncompiled block and factually reword the durable packElevateHelper rationale without changing the builder value; do not bundle Pomodoro/DBus, extension, API, or pseudo-IPC comments.
- **Corrected LOC:** production 0; configuration 0; comments 20; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The original 48-line sweep combines at least five unrelated histories and violates one-root-cause scope.; The builder rationale must continue to explain why elevate.exe is intentionally excluded.
- **Primary gate:** Require a comment-only/source-policy diff with no builder value change.
- **Required verification:** Parse electron-builder.yaml, compile Electron, and repeat updater dependency/symbol searches.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `electron/start-app.ts` — commented auto-updater registration; `electron/indicator.ts` — commented POMODORO_UPDATE/DBus listener; `electron/debug.ts` — commented addExtensionIfInstalled; `electron/electronAPI.d.ts` — commented legacy checkDirExists signature; `electron/shared-with-frontend/ipc-events.const.ts` — commented pseudo-IPC members; `electron-builder.yaml` — durable no-updater rationale
- **Why it exists:** Removed updater, GNOME DBus/Pomodoro, extension, directory, and maybe-\* IPC experiments remained as executable-looking comments beside live security and IPC boundaries.
- **Smallest change:** Delete only the noncompiled blocks and overlapping commented enum members, and reword the packElevateHelper comment to the durable fact that no in-app updater is registered; do not change builder values or live IPC registrations.
- **Preserve:** Packaging, update policy, CURRENT_TASK_UPDATED, SET_PROGRESS_BAR, ElectronAPI declarations, IPC enum values, DBus absence, tray behavior, and security settings remain unchanged.
- **Evidence:** Every target is a comment, referenced symbols/channels do not exist, electron-updater is absent, and builder configuration explicitly says the application ships no in-app updater. The shared POMODORO enum line is counted once across overlapping findings.
- **Estimated net change:** comments 48
- **Gates and overlaps:** electron-main-process; ipc-adjacent; security-rationale-comment; I09-002 and I10-01-C02 both include the same commented POMODORO_UPDATE enum line; its LOC is not double-counted.
- **Verify:** Parse electron-builder.yaml and compile/typecheck Electron; Repeat live IPC enum/channel, updater dependency, DBus symbol, and ElectronAPI searches; Run Electron main-process tests and git diff --check.
- **Source findings:** I09-001; I09-002; I10-01-C02

### C05-002 — Delete the unreachable commented Android WebView OPTIONS implementation

- **Full-review result:** Rank 65/100; controlling original placements 57/73/56. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the twelve nonblank commented alternative OPTIONS lines; retain the adjacent live synthetic OPTIONS response and WebView bridge boundary byte-identical.
- **Corrected LOC:** production 0; configuration 0; comments 12; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The target is comments, not production LOC, and the live OPTIONS short-circuit immediately above it is excluded.
- **Primary gate:** None.
- **Required verification:** Require zero executable Kotlin statement changes.; Run Kotlin checks and compile both Android debug flavors after generated Gradle files exist.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `android/app/src/main/java/com/superproductivity/superproductivity/webview/WebViewRequestHandler.kt` — commented OPTIONS request branch
- **Why it exists:** A discarded OPTIONS-request experiment remained as noncompiled Kotlin inside a security-sensitive remote WebView request handler.
- **Smallest change:** Delete only the commented branch and separators; do not alter live request interception, origins, headers, methods, response construction, or bridge registration.
- **Preserve:** Remote WebView networking, request methods, CORS/header behavior, origin handling, error behavior, and the JavaScript bridge remain byte-for-byte unchanged.
- **Evidence:** The block is wholly commented and therefore unreachable; retaining it creates misleading apparent WebView behavior at a high-risk boundary.
- **Estimated net change:** comments 12
- **Gates and overlaps:** remote-webview-boundary; security-sensitive-file
- **Verify:** Run Android compilation and WebView request-handler tests if available; Diff executable Kotlin and require no live statement changes; Re-check the MODE_ONLINE/remote bridge fences described in issue #8832.
- **Source findings:** I11-02-C03

### C05-003 — Delete obsolete Electron DBus and shell-command store keys

- **Full-review result:** Rank 90/100; controlling original placements 89/89/93. Safety: narrow; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No combined change. D_BUS_ID and ALLOWED_COMMANDS are unrelated residues, and the latter's persisted-key/security rationale requires disproportionate compatibility proof for a four-line cleanup.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The two keys do not share one root cause.; The audit misclassified executable TypeScript enum/constant lines as configuration.; Unknown legacy store keys can survive without enum membership, but proving that boundary costs at least as much as this candidate.
- **Primary gate:** None; reassess each key independently only when its containing file is already changing.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `electron/CONFIG.ts` — CONFIG.D_BUS_ID; `electron/shared-with-frontend/simple-store.const.ts` — SimpleStoreKey.ALLOWED_COMMANDS
- **Why it exists:** Identifiers for the abandoned DBus integration and removed shell-exec allow-list survived after their only runtime consumers were deleted.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Repository-wide references find no live consumer or dynamic/native registration. Unknown persisted simple-store keys load independently of the enum, and electron/exec.test.cjs remains the security regression guard.
- **Rejected historical estimate:** Zero LOC is authorized. production 1; configuration 1; comments 3
- **Gates and overlaps:** legacy-persisted-key; removed-shell-exec-security-boundary
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I10-01-C01; I10-02-C1

### C05-004 — Consolidate duplicated Electron tray message and cache synchronization

- **Full-review result:** Rank 98/100; controlling original placements 98/98/97. Safety: defer; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Preserve the three explicit tray paths until a behavior-driven change warrants characterization; do not introduce derivation, cache, title, or tooltip helpers solely to reduce repeated lines.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** SET_PROGRESS_BAR, CURRENT_TASK_UPDATED, and syncTray have different null-task, title, icon, cache-forcing, and menu-rebuild semantics.; The proposed extraction can change the next event's rebuild decision and cross-platform tray behavior.; This is a negative-value abstraction with no presently defensible LOC credit.
- **Primary gate:** None; future behavior work must first characterize each event sequence and tray recreation path.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `electron/indicator.ts` — SET_PROGRESS_BAR listener, CURRENT_TASK_UPDATED listener, syncTray, tray/menu message derivation and cache updates
- **Why it exists:** Two IPC listeners and the forced tray refresh independently derive the same messages, serialize today tasks, compare five cache fields, rebuild context menus, and branch title/tooltip behavior.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** The same seven-argument createIndicatorMessage calls, today-task projection, cache comparisons, context-menu mutation, and platform title/tooltip branches occur three times in one module.
- **Rejected historical estimate:** Zero LOC is authorized. production 25–55; tests -90–-40
- **Gates and overlaps:** ipc-payload-ordering; platform-tray-timing; cache-coherence; security-sensitive-main-process
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I09-003

### C05-005 — Remove redundant main-window guards after protocol readiness

- **Full-review result:** Rank 80/100; controlling original placements 80/81/81. Safety: confirm; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** When protocol-handler.ts is already changing and coverage exists, remove only the four post-readiness mainWin/webContents guards and braces; retain parsing, readiness, deferral, focus, OAuth, IPC, and ordering behavior.
- **Corrected LOC:** production 8; configuration 0; comments 0; test infrastructure 0; tests -24–-10; generated 0; moved 0
- **Material corrections:** The control-flow proof is sound, but current tests omit OAuth, plainspace-connect, null/destroyed windows, and deferred URL draining.; Eight removed lines do not justify standalone public-protocol test and installed-app smoke cost.
- **Primary gate:** Add missing protocol action/readiness cases and wait until the containing file has a behavior-driven change.
- **Required verification:** Run protocol-handler and Electron main-window tests.; Exercise an installed custom-protocol action on one desktop platform.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `electron/protocol-handler.ts` — processProtocolUrl repeated mainWin guards
- **Why it exists:** processProtocolUrl rechecks mainWin around action branches after its readiness path already establishes a usable window.
- **Smallest change:** Characterize every public protocol action and cold/warm startup path, then remove only the four repeated guards and braces; retain readiness establishment, parsing, validation, focus, IPC sends, and error handling.
- **Preserve:** Custom URL scheme actions, OAuth callback transport, cold-start queue/readiness, invalid URLs, main-window creation/focus, IPC channel names/payloads, and action ordering remain unchanged.
- **Evidence:** Control-flow proof in the raw audit establishes mainWin before the guarded actions; the public/native boundary makes explicit cold-start tests mandatory despite the local redundancy.
- **Estimated net change:** production 8; tests -24–-12
- **Gates and overlaps:** public-custom-protocol; oauth-callback; cold-start-ordering; ipc-boundary
- **Verify:** Extend electron/protocol-handler.test.cjs for every action before/after readiness, invalid URLs, OAuth callback, and missing-window initialization; Run all Electron protocol/main-window tests; Exercise installed custom-protocol links on at least one desktop platform.
- **Source findings:** I10-01-C03

### C05-006 — Delete the orphaned Android process-lifecycle observer and dependency

- **Full-review result:** Rank 25/100; controlling original placements 25/33/26. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Phase 1 deletes AppLifecycleObserver.kt and its App.kt import/registration only. Retain lifecycle-process until dependencyInsight and merged-manifest comparisons prove the direct dependency has no runtime initializer/version effect; remove it separately if proven redundant.
- **Corrected LOC:** production 28–31; configuration 0; comments 2; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Source reachability proves the observer is orphaned but does not prove the direct dependency has no manifest initializer or version-selection effect.; The one configuration line is deferred and receives no current LOC credit.
- **Primary gate:** Generate/sync missing Capacitor Gradle files before dependency proof; this does not block the code-only first phase.
- **Required verification:** Build playDebug and fdroidDebug and smoke launch, background/resume, and focus/tracking notifications.; Before a dependency follow-up, compare dependencyInsight and merged manifests for both flavors.
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 11; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `android/app/src/main/java/com/superproductivity/superproductivity/app/AppLifecycleObserver.kt` — AppLifecycleObserver, isInForeground; `android/app/src/main/java/com/superproductivity/superproductivity/App.kt` — orphan observer registration; `android/app/build.gradle` — androidx.lifecycle:lifecycle-process
- **Why it exists:** A process-lifecycle foreground mirror, application registration, and dedicated dependency remained even though no runtime/security/native path reads the flag.
- **Smallest change:** Delete the observer file, its App.onCreate registration/imports, and the now-unused lifecycle-process dependency only.
- **Preserve:** Application startup, activity lifecycle, Capacitor and legacy WebView activities, notifications, background tracking, bridge registration, and persistence remain unchanged.
- **Evidence:** Exact class/field searches show no readers; the flag is memory-only and no exported component, permission, notification, or bridge decision depends on it.
- **Estimated net change:** production 27–31; configuration 1; comments 2
- **Gates and overlaps:** android-process-lifecycle; dependency-removal; Android-adjacent PRs #8875 and #8950 had no direct target overlap as of the audit but must be rechecked before implementation.
- **Verify:** Repeat source/manifest/reflection searches for the observer and foreground flag; Run Android unit tests and assembleDebug; Launch, background, resume, and exercise focus/tracking notifications on a device or emulator.
- **Source findings:** I11-01-C1

### C05-007 — Centralize focus-notification activity PendingIntent construction

- **Full-review result:** Rank 97/100; controlling original placements 96/95/96. Safety: narrow; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change. Keep the six explicit PendingIntent action blocks rather than parameterizing component, action, request code, flags, and identity at a native security boundary.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Two similar content PendingIntents are intentionally outside the six action blocks and use different identity semantics.; A parameterized helper weakens auditability and can silently alias actions through one request-code or flag error.; The abstraction and locked/background device matrix are negative value relative to the readability gain.
- **Primary gate:** None; reconsider only for a behavior-driven notification change with focused identity tests.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `android/app/src/main/java/com/superproductivity/superproductivity/service/FocusModeNotificationHelper.kt` — six duplicated action PendingIntent blocks in buildNotification and showCompletionNotification
- **Why it exists:** Focus notification action branches repeat explicit activity Intent and immutable PendingIntent construction with only request code, action, and label varying.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Six 11-line blocks are structurally identical. The current Android widget plan independently establishes explicit-component and correct mutability flags as security invariants, so the helper must make them mandatory rather than implicit.
- **Rejected historical estimate:** Zero LOC is authorized. production 36–42
- **Gates and overlaps:** android-pendingintent-identity; explicit-component-security; notification-action-timing
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I11-01-C3

### C05-008 — Delete unreferenced legacy Android vectors and empty value resources

- **Full-review result:** Rank 46/100; controlling original placements 50/32/58. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete only the cohesive four-vector family ic_add, ic_done, ic_pause, and ic_stat_play; leave attrs.xml and dimens.xml for a separate template-resource cleanup.
- **Corrected LOC:** production 0; configuration 64; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The original 87-line estimate is arithmetically wrong: all six files contain 77 nonblank or 81 physical lines.; The smaller coherent vector-only scope is 64 configuration LOC and excludes unrelated resource kinds.; Static searches still require resource-link proof against dynamic lookup and both flavors.
- **Primary gate:** Regenerate missing Capacitor Gradle files before resource merge/link and flavor builds.
- **Required verification:** Repeat bare-name, @drawable, R.drawable, manifest, copy, and getIdentifier searches.; Run resource merge/link and assemble for playDebug and fdroidDebug; inspect packaged resources.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `android/app/src/main/res/drawable-anydpi-v24` — ic_add, ic_done, ic_pause, ic_stat_play; `android/app/src/main/res/values/attrs.xml` — unused ButtonBar template attributes; `android/app/src/main/res/values/dimens.xml` — empty resource file
- **Why it exists:** Legacy Android notification/action and template resources remained after their layouts/styles/native consumers were removed.
- **Smallest change:** Delete only the four zero-reference vector files and the two zero-consumer/empty value-resource files; do not rename or consolidate live notification/widget drawables or attributes.
- **Preserve:** Resource IDs used by manifests, layouts, notifications, widgets, themes, dynamic lookups, generated R classes, and native actions remain unchanged.
- **Evidence:** Exact @drawable/@styleable/name searches across Kotlin, Java, XML, manifests, tests, plugins, and build scripts find no consumer; dimens.xml provides no values.
- **Estimated net change:** configuration 87
- **Gates and overlaps:** android-resource-packaging; dynamic-resource-lookup
- **Verify:** Repeat aapt/resource-name and getIdentifier-style dynamic lookup searches; Run Android resource merge, lint, unit tests, and assembleDebug; Smoke-test focus/tracking/reminder notifications and the home-screen widget icons.
- **Source findings:** I11-02-C01; I11-02-C02

### C05-009 — Re-evaluate the duplicate Objective-C StoreReview plugin shim after iOS widget work

- **Full-review result:** Rank 85/100; controlling original placements 85/85/85. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Make no deletion at this HEAD. After iOS widget work and lock reconciliation, compare clean builds and runtime bridge registration with and without StoreReviewPlugin.m and its four project entries while retaining Swift metadata and manual registration.
- **Corrected LOC:** production 4; configuration 4; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Source references cannot prove which dynamic Capacitor metadata path the linked iOS runtime uses.; npm and Pod locks describe inconsistent Capacitor major versions.; Open widget work directly overlaps project.pbxproj and deliberately repeats the same shim pattern.
- **Primary gate:** Resolve iOS widget overlap and pin a consistent Capacitor npm/pod state.
- **Required verification:** Perform clean simulator/device builds with and without the shim.; Invoke StoreReview.requestReview from JavaScript and inspect bridge registration/method export.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary defer. **Classification:** conflicting.
- **Scope:** `ios/App/App/StoreReviewPlugin.m` — CAP_PLUGIN StoreReview registration; `ios/App/App/StoreReviewPlugin.swift` — CAPBridgedPlugin metadata; `ios/App/App/CustomViewController.swift` — manual StoreReviewPlugin registration; `ios/App/App.xcodeproj/project.pbxproj` — StoreReviewPlugin.m project membership
- **Why it exists:** The raw audit found three apparent registration mechanisms for StoreReview, but current iOS plans and open PR #8950 deliberately use Swift-plus-Objective-C shims as the local Capacitor plugin pattern and concurrently rewrite project.pbxproj.
- **Smallest change:** Do not delete at the baseline. After PR #8950 resolves, prove with a clean generated/native build and runtime bridge test whether manual Swift registration alone exposes StoreReview; only then delete the .m file and its four project entries if genuinely redundant.
- **Preserve:** The JavaScript name StoreReview, requestReview method, manual registration timing, Capacitor bridge discovery, App Store build, and new WidgetBridge plugin registration must all remain functional.
- **Evidence:** Source tracing suggests duplication, but the architecture plan and active iOS widget PR treat the ObjC shim as the established plugin bridge pattern and touch the same project file; this is a real current-state conflict, not a safe Tier A deletion.
- **Estimated net change:** production 4; configuration 4
- **Gates and overlaps:** Capacitor native registration; iOS linking; App Store build; resolve or rebase PR #8950, which changes `project.pbxproj` and adds another Swift-plus-Objective-C local plugin.
- **Verify:** Wait for/rebase after PR #8950 and validate project.pbxproj with both OpenStep and xcode parsers; Build a clean iOS simulator/device target with the shim present and absent; Invoke StoreReview from JavaScript and verify plugin discovery/method resolution before accepting deletion.
- **Source findings:** I12-C01

### C05-010 — Remove only proven-default iOS Capacitor flags; retain the documented keyboard flag

- **Full-review result:** Rank 96/100; controlling original placements 95/96/95. Safety: reject; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** Keep all three explicit flags. Correct the inaccurate keyboard/link-preview rationale only when the file is otherwise changing; do not delete configuration based on current defaults.
- **Corrected LOC:** production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Removing explicit true values couples repository policy to version-sensitive Capacitor defaults for two lines of reward.; The audit's retained resizeOnFullScreen rationale is false at this HEAD: installed code makes it Android-only, Android excludes the keyboard plugin, and iOS does not read it.; The npm/pod Capacitor version mismatch prevents meaningful generated-config equivalence proof.
- **Primary gate:** None; re-evaluate defaults only during a planned Capacitor upgrade.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary defer. **Classification:** conflicting.
- **Scope:** `capacitor.config.ts` — ios.allowsLinkPreview, ios.scrollEnabled, Keyboard.resizeOnFullScreen
- **Why it exists:** Initial iOS support copied true framework defaults, while resizeOnFullScreen:false is source-traced as a no-op for the currently excluded Android Keyboard plugin but is also explicitly documented as part of the load-bearing keyboard/system-bars stack.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Installed Capacitor sources support removing the two iOS defaults, but repository architecture plans name resizeOnFullScreen:false among deliberate coupled configuration. The original three-flag deletion is therefore narrowed and deferred.
- **Rejected historical estimate:** Zero LOC is authorized. configuration 2; comments 2–4
- **Gates and overlaps:** version-sensitive-capacitor-default; android-keyboard-insets; ios-native-config; device-matrix-required; Reconcile docs/plans/2026-06-22-android-keyboard-and-systembars-handover.md before changing resizeOnFullScreen.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** I12-C02

### C05-011 — Remove five empty UIApplicationDelegate lifecycle stubs

- **Full-review result:** Rank 82/100; controlling original placements 83/83/82. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** After overlapping AppDelegate work and native lock reconciliation, delete only the five empty lifecycle methods and their stock comments; retain launch and all proxy forwarding methods.
- **Corrected LOC:** production 10; configuration 0; comments 7; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Deleting optional selectors changes respondsToSelector and may affect plugin swizzling despite empty bodies.; The canonical LOC omitted seven stock comment lines.; Open AppDelegate work and inconsistent native locks make standalone cleanup negative value now.
- **Primary gate:** Resolve overlapping AppDelegate work and the Capacitor npm/pod version mismatch.
- **Required verification:** Run a clean iOS build and inspect runtime selector/plugin registration.; Smoke active/inactive/background/foreground/termination, deep-link, and notification flows.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary defer. **Classification:** conflicting.
- **Scope:** `ios/App/App/AppDelegate.swift` — applicationWillResignActive, applicationDidEnterBackground, applicationWillEnterForeground, applicationDidBecomeActive, applicationWillTerminate
- **Why it exists:** The stock AppDelegate template retained five optional lifecycle callbacks with empty bodies and no forwarding or state mutation.
- **Smallest change:** After confirming Capacitor/plugin callbacks are not selector-presence-sensitive for the pinned version, delete only the five empty methods; retain launch, URL/open, continuation, remote-notification, and other proxy methods.
- **Preserve:** Capacitor lifecycle proxying, plugin registration, deep links, notifications, background/resume behavior, persistence flushing, widget bridge behavior, and application startup remain unchanged.
- **Evidence:** Each method is empty and issue #7874 independently identifies the no-op AppDelegate callbacks as removable, but UIKit selector presence changes warrant native characterization.
- **Estimated net change:** production 10
- **Gates and overlaps:** ios-lifecycle-selector-presence; capacitor-proxy; open-ios-widget-work; Revalidate against open PR #8950; Change classification to conflicting and tier to defer because open PR #6748 changes AppDelegate native lifecycle code.
- **Verify:** Build and run the iOS app and inspect delegate/proxy registration for the pinned Capacitor version; Exercise foreground, resign-active, background, foreground, termination/relaunch, deep-link, and notification flows; Revalidate after open PR #8950 because it adds iOS lifecycle/widget behavior.
- **Source findings:** I12-C03

### C05-012 — Trim duplicate predicates and unused surface from CapacitorPlatformService

- **Full-review result:** Rank 44/100; controlling original placements 31/66/40. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete only the \_isIOSBrowser helper and its no-op branch because both paths return web; do not combine token injection, public convenience-method removal, method-only spec edits, or the unrelated barrel.
- **Corrected LOC:** production 10; configuration 0; comments 7; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** The original candidate bundles four separate root causes and overstates net executable reduction.; Module-level Electron token timing is not equivalent to reading navigator.userAgent at service construction in mutable-UA tests.; Deleting the no-op iOS branch preserves behavior but exposes a documentation defect that should not be hidden by bundling other cleanup.
- **Primary gate:** None.
- **Required verification:** Run checkFile and the focused platform spec with representative iPhone/iPad web inputs.; Require Electron-first, native, legacy WebView, capabilities, and isIPad behavior to remain unchanged.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/core/platform/capacitor-platform.service.ts` — duplicate Electron UA predicate, no-op iOS-browser branch, hasCapability, isElectron, isWeb; `src/app/core/platform/capacitor-platform.service.spec.ts` — method-only assertions and token overrides; `src/app/core/platform/index.ts` — unreferenced internal barrel
- **Why it exists:** The platform service duplicated the central Electron predicate, retained an iOS-browser test whose result equals the web fallback, exposed three zero-consumer wrappers, and had an unimported barrel.
- **Smallest change:** Inject IS_ELECTRON_TOKEN, delete only the duplicate predicate/no-op iOS helper/branch/three uncalled methods, update specs to canonical properties and token overrides, and delete the zero-import barrel.
- **Preserve:** Electron-first detection, native Capacitor and legacy Android WebView routing, web/iPhone/iPad classification, capabilities, isNative/isIOS/isAndroid/isIPad, reminders/notifications, and every public consumed property remain unchanged.
- **Evidence:** F08 and L07 independently identify the identical iOS branch; the Electron predicate matches the central token factory; production/plugin/library searches find no calls or public export path for the removed methods/barrel. Issue #8841 independently confirms platform-predicate drift.
- **Estimated net change:** production 38–52; comments 14–23; tests 8–15
- **Gates and overlaps:** platform-routing; reminder-notification-consumers; versioned-token-injection; F08-C02-no-op-ios-browser-detection and L07-C03 describe the same branch; their LOC is counted once.
- **Verify:** Run focused platform/reminder/notification specs with token overrides and representative Electron, iPhone/iPad web, Android WebView, and native Capacitor cases; Repeat method/barrel/public-export and dynamic-registration searches; Run checkFile, web/Electron/mobile builds, and verify capability values remain identical.
- **Source findings:** F08-C01-dead-platform-barrel; F08-C02-no-op-ios-browser-detection; L07-C02; L07-C03; L07-C05

### C05-013 — Remove obsolete StartupService migration-era injections

- **Full-review result:** Rank 38/100; controlling original placements 45/46/32. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete exactly the two imports, two unread injected fields, two spec imports, two unused spies, and two providers; do not alter startup ordering or any persistence, IPC, native, or sync path.
- **Corrected LOC:** production 4; configuration 0; comments 0; test infrastructure 0; tests 6; generated 0; moved 0
- **Material corrections:** Removing inject() changes eager construction in isolation, but current AppComponent/TaskService construction already provides both dependencies before StartupService.
- **Primary gate:** Keep the diff fenced from StartupService orchestration.
- **Required verification:** Run checkFile on the service/spec, the focused StartupService suite, and the frontend production build.; Require no other startup, persistence, recovery, native, or sync diff.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/core/startup/startup.service.ts` — unused ImexViewService and TranslateService injections; `src/app/core/startup/startup.service.spec.ts` — obsolete spies and providers
- **Why it exists:** Two private dependencies and their TestBed setup remained after their legacy startup/migration call sites were removed.
- **Smallest change:** Delete only the two imports/injected fields and their test spies/providers; leave init ordering, timers, banners, persistence/recovery, security capabilities, IPC/native routing, and sync fences untouched.
- **Preserve:** StartupService.init API, construction timing, hydration/recovery, Jira/security setup, banners, backup/import behavior, Electron/mobile routing, and all action/order semantics remain unchanged.
- **Evidence:** Both private fields are unread, reflection/dynamic searches find no access, and their only remaining footprint is test setup. The containing startup orchestrator is high-risk, so scope is intentionally four production lines.
- **Estimated net change:** production 4; tests 6
- **Gates and overlaps:** startup-ordering; persistence-and-recovery-containing-file; sync-fence-containing-file
- **Verify:** Run StartupService specs and checkFile; Compile web, Electron, and mobile targets; Review the diff to require no constructor/field-initialization order or startup call changes beyond removing unread inject() expressions.
- **Source findings:** F08-C03-obsolete-startup-injections

### C05-014 — Conditionally register ElectronEffects instead of creating a false effect field

- **Full-review result:** Rank 81/100; controlling original placements 82/82/83. Safety: narrow; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Defer the candidate. If electron.effects.ts is already changing, use the safer one-file alternative: keep EffectsModule registration unchanged and remove only the class-level boolean guard/type/imports, relying on the existing platform-gated EMPTY source.
- **Corrected LOC:** production 4; configuration 0; comments 0; test infrastructure 0; tests -12–-4; generated 0; moved 0
- **Material corrections:** SnackService has constructor subscription side effects, so conditional effect registration is not proven construction-equivalent.; The existing IPC source is already EMPTY off Electron, making registration relocation unnecessary.; The one-file alternative removes the false field without the cross-file platform-registration change, but is too low-value for standalone work.
- **Primary gate:** Wait for a behavior-driven edit to electron.effects.ts; do not move root registration under this candidate.
- **Required verification:** Run checkFile and the focused ElectronEffects spec and assert malformed payloads do not snack.; Build web and Electron and smoke one completed download/action.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** independently-confirmed-existing.
- **Scope:** `src/app/root-store/feature-stores.module.ts` — ElectronEffects registration; `src/app/core/electron/electron.effects.ts` — fileDownloadedSnack$
- **Why it exists:** ElectronEffects is instantiated on every platform and expresses its sole effect as IS_ELECTRON && createEffect, producing an Observable-or-false field despite existing conditional effect-registration patterns.
- **Smallest change:** Conditionally register the class in the existing root effect list, remove only the class-level boolean guard/type/import, and retain the same dispatch:false effect and IPC subscription.
- **Preserve:** Electron download IPC subscription, payload handling, snack timing/content, non-dispatch behavior, root effect ordering, and zero web/mobile behavior remain unchanged.
- **Evidence:** The class has one effect and no constructor side effects; the root module already conditionally registers TaskElectronEffects and Android/iOS effects. Issue #7874 independently records the exact unconditional-registration problem.
- **Estimated net change:** production 2–5
- **Gates and overlaps:** ngrx-effect-registration; electron-ipc-listener; platform-build-matrix
- **Verify:** Run Electron effect specs and add registration tests with Electron true/false; Compile web, Electron, Android, and iOS builds; Verify the download snack still opens once for the same IPC payload and no listener exists off Electron.
- **Source findings:** L07-C01

### C05-015 — Collapse CORS_SKIP_EXTRA_HEADERS identical platform branches

- **Full-review result:** Rank 41/100; controlling original placements 46/49/35. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Replace the identical Android-WebView ternary with one explicitly typed empty object and delete only the seven stale TODO/commented implementation lines.
- **Corrected LOC:** production 2; configuration 0; comments 7; test infrastructure 0; tests 0; generated 0; moved 0
- **Material corrections:** Retain an explicit string-map type so spread consumers and future assignments remain type-compatible.
- **Primary gate:** None.
- **Required verification:** Run checkFile and focused calendar integration request tests.; Assert deeply equal headers with Android WebView detection true and false and repeat mutation/reference searches.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/app.constants.ts` — CORS_SKIP_EXTRA_HEADERS
- **Why it exists:** An Android-WebView ternary and stale TODO survived after both branches converged on the same empty headers object.
- **Smallest change:** Replace the ternary with one typed empty object and delete only the obsolete commented header implementation/TODO.
- **Preserve:** HTTP headers, object contents, request construction, CORS behavior, calendar integration, and all Android WebView/Electron/iOS/web network behavior remain byte-for-byte unchanged.
- **Evidence:** Both live branches return {}, all spread consumers were inspected, and no code depends on identity or mutation.
- **Estimated net change:** production 2–3; comments 6–9
- **Gates and overlaps:** network-header-boundary
- **Verify:** Run app.constants checkFile and calendar/integration request tests; Assert request headers with Android-WebView true and false are deeply equal before/after; Search for mutation or reference-equality use of the exported object.
- **Source findings:** L07-C04

## C06 — Build, tools, dependencies, CI, and configuration (12 candidates)

### C06-001 — Delete the superseded commented Snap release pipeline

- **Full-review result:** Rank 52/100; controlling focused placements 68/46/54; superseded original ranks 54/26/52. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete exactly the fully commented legacy block at baseline lines 63-120 of .github/workflows/build-publish-to-snap-on-release.yml. Retain every active line, including the adjacent Canonical-container rationale, SNAPCRAFT_HAS_TTY workaround, triggers, permissions, inputs, credentials, artifact checks, retries, and channel selection.
- **Corrected LOC:** 0 production, 0 configuration, and exactly 58 comment lines removed; the earlier 58-64 estimate must not be used because its upper bound reaches active/container-adjacent lines.
- **Material corrections:** The canonical 58-64 comment estimate is not exact: only lines 63-120 are the retired block; the 64-line upper bound reaches six active/container-adjacent lines.; Accidentally deleting active container upload lines 55-61 would change release behavior.
- **Primary gate:** No external gate; require parsed executable-YAML equality and an Actions-aware validation before accepting the deletion.
- **Required verification:** Parse/actionlint the result; Require executable YAML equality; git diff --check; Parse the pre/post YAML and compare normalized active objects and ordered active steps.; Run an Actions-aware validator, formatting check, and git diff --check.; Inspect the diff for zero executable trigger, permission, input, secret, artifact, retry, image, or channel changes.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `.github/workflows/build-publish-to-snap-on-release.yml` — commented legacy Node/Electron/Snapcraft build-and-publish steps
- **Why it exists:** The Snap workflow moved from runner-side rebuilding to exact release-asset publication through Canonical's container, but the older executable design remained as a large commented tail.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** A raw workflow audit and an independent comment-debt lens identify the same inert block. History shows the active release-asset path replaced the retired rebuild path to fix a publishing race.
- **Superseded historical estimate:** comments 58–64
- **Gates and overlaps:** release-workflow; snap-store-credentials; artifact-cardinality
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-01-C01; L12-C03

### C06-002 — Remove the duplicate Node setup from the web release job

- **Full-review result:** Rank 70/100; controlling focused placements 71/54/68; superseded original ranks 53/52/70. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the later four-line 'Install Node.js, NPM and Yarn' setup-node step at baseline lines 40-43 of .github/workflows/build-update-web-app-on-release.yml. Retain the pinned setup-node step at lines 27-29 and every downstream build and deploy step unchanged.
- **Corrected LOC:** 0 production, exactly 4 configuration lines, and 0 comment lines removed.
- **Material corrections:** The current workflow has no safe smoke dispatch: workflow_dispatch reaches the production SSH deploy, so the proposed optional manual run must not be used for this cleanup.; A mistaken removal of the first setup step would leave checkout/build without the declared Node 22 setup.
- **Primary gate:** No external gate; validate the ordered step list structurally and do not dispatch this production-deploy workflow solely to test the cleanup.
- **Required verification:** Actionlint/parse; Ordered-step structural diff allowing one deletion; Do not dispatch the production deploy workflow solely for verification; Assert the remaining setup-node SHA and node-version are unchanged and no setup-node id/output is referenced.; Compare the ordered pre/post step list allowing exactly the duplicate block to disappear.; Validate and format-check the workflow; use a non-deploying safe run only if one exists.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `.github/workflows/build-update-web-app-on-release.yml` — duplicate actions/setup-node invocation, Install Node.js, NPM and Yarn
- **Why it exists:** A bulk Node-version migration added an early setup-node step without removing the workflow's original identical invocation; later updates kept both copies aligned.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The two action SHA/version blocks are identical, have no ids/outputs, and no intervening step mutates Node, PATH, npm, or tool-cache state.
- **Superseded historical estimate:** configuration 4
- **Gates and overlaps:** web-release; ssh-deployment; supply-chain-action-pin
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-01-C02

### C06-003 — Remove superseded desktop and MAS alternatives from electron-builder configuration

- **Full-review result:** Rank 60/100; controlling focused placements 69/51/62; superseded original ranks 55/48/71. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the two commented alternatives at baseline lines 100-108 and 213-222 of electron-builder.yaml. Do not move or modify any active package, target, rpm, snap, pkg, macOS, MAS, signing, notarization, publish, hook, or artifact setting.
- **Corrected LOC:** 0 production, 0 active configuration, and exactly 19 comment lines removed.
- **Material corrections:** Adjacent active rpm, snap, pkg, and mac configuration must not move.
- **Primary gate:** No external gate; require normalized active electron-builder configuration equality for the main, MAS, and MAS-development config paths.
- **Required verification:** YAML parse and normalized active-object equality; Diff inspection around rpm/snap/pkg/mac; Parse and compare normalized active electron-builder.yaml before and after.; Resolve the main, MAS, and MAS-dev config paths used by current package scripts and confirm targets/signing keys are unchanged.; Run config formatting checks and inspect that no active key moved.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `electron-builder.yaml` — commented legacy linux.desktop mapping, commented legacy inline mas mapping
- **Why it exists:** Linux desktop schema changes and separate MAS production/development configs superseded two inline alternatives, which remained as misleading comments beside active release settings.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** History ties each comment to a rejected schema or superseded inline MAS copy; package scripts resolve the current dedicated configs and no parser executes comments.
- **Superseded historical estimate:** comments 19
- **Gates and overlaps:** multi-platform-packaging; signing-configuration
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-02-C02

### C06-004 — Delete two browser-side Karma hooks that are no longer loaded

- **Full-review result:** Rank 55/100; controlling focused placements 58/61/51; superseded original ranks 18/9/49. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** implemented-stashed.
- **Authoritative scope:** Delete only src/test-helpers/jasmine-spec-reporter-hook.js and src/test-helpers/spec-start-broadcast.js. Treat angular.json and Karma configuration only as reachability evidence; keep src/test-helpers/karma-running-spec-on-disconnect.js, src/karma.conf.js, and the empty Angular test scripts array unchanged.
- **Corrected LOC:** The two files contain 107 physical lines: 82 test-infrastructure-code lines, 8 comment-only lines, and 17 blank lines. Keep all three categories separate and do not double-count these deletions in C07.
- **Material corrections:** The 107-line test-infrastructure count double-counts comments under the contract's separate comment category.; Broad test-helper globs or a reintroduced angular.json scripts entry at implementation HEAD would invalidate reachability proof.
- **Primary gate:** Repeat entry-point and broad-glob reachability checks at implementation HEAD, run a focused Karma smoke, and coordinate C07 accounting to avoid duplicate reward.
- **Required verification:** Repeat filename and entry-point search; Run one focused Karma spec; Assert active disconnect reporter/config unchanged; Repeat exact filename, symbol, Angular scripts-entry, Karma files/plugin, and import/require searches.; Run a focused Karma spec and confirm normal startup and reporting.; Verify src/test-helpers/karma-running-spec-on-disconnect.js and its Karma registration are unchanged.
- **Discovery-era record (superseded):** Implemented, verified, and stashed. **Tier:** Final A. **Classification:** net-new. Rank 3; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/test-helpers/jasmine-spec-reporter-hook.js` — waitForJasmine, installHooks; `src/test-helpers/spec-start-broadcast.js` — browser hook IIFE; `angular.json` — projects.sp2.architect.test.options.scripts consumer proof
- **Why it exists:** Short-lived diagnostics for hanging Karma specs were removed from angular.json one day after introduction, while both hook files remained; one hook was never configured at all.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** No import, path, Karma file-list, or angular.json scripts entry reaches either file; history reconstructs the removed and never-wired registrations.
- **Superseded historical estimate:** 107 physical lines: 82 test-infrastructure code, 8 comments, and 17 blank lines
- **Stashed actual and completed verification:** The physical estimate was exact: 82 test-infrastructure code lines, 8 comment lines, and 17 blank lines were deleted. Entry-point searches confirmed both hooks remain unloaded, a separate 15-test Karma reporter smoke passed, and the active disconnect reporter and Karma configuration were left unchanged. The full implementation batch ran 357 focused Karma tests.
- **Gates and overlaps:** test-harness; reporter-contract; C07 test-infrastructure ownership
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-04-01-dead-karma-browser-hooks

### C06-005 — Remove the never-enabled custom macOS notarizer and private shell helper

- **Full-review result:** Rank 83/100; controlling focused placements 85/84/83; superseded original ranks 74/74/74. Safety: defer; maintainability: defer; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Deferred: make no deletion while PR #9077 overlaps package metadata or until an authorized signed macOS artifact proves the active Electron Builder notarization path still notarizes and staples correctly. If both gates pass, reassess only deletion of tools/notarizeMacApp.js, tools/execCommand.js, the commented afterSign line, and the direct @electron/notarize declaration; preserve mac.notarize: true, all release secrets, and Electron Builder's transitive notarizer.
- **Corrected LOC:** 0 LOC is currently authorized. The bounded deferred proposal comprises 69 release-tool/configuration code lines (68 JS plus 1 package declaration), 39 comment lines (38 JS plus the commented afterSign line), 23 blank JS lines, and an estimated 14-18 generated lockfile lines; it removes 0 production LOC.
- **Material corrections:** The two tools are release tooling/configuration, not production LOC; the canonical production count also includes their comments and blanks.; Open PR #9077 still changes package.json/package-lock.json, so the stated rebase gate is live.; Static proof is insufficient for the active mac.notarize path: electron-builder uses nested @electron/notarize 2.5.0 while the dead hook imports direct 3.1.1, and the release artifact must prove the nested path still signs/notarizes.; macOS release signing/notarization; lockfile hoisting/version selection; secret-bearing release workflow; The hook has said CURRENTLY NOT USED since introduction, afterSign is commented, and the only helper import is inside that dead hook. Current npm explain shows the root @electron/notarize 3.1.1 is direct-only while app-builder-lib retains its own 2.5.0 dependency. Those facts justify the concept deletion, but release-platform verification and the live lockfile conflict prohibit Tier A.
- **Primary gate:** PR #9077 must resolve first, followed by npm 11.18.0 lockfile regeneration, npm explain proof that app-builder-lib retains its notarizer, and an authorized signed DMG notarization/stapling check.
- **Required verification:** Rebase and regenerate with npm 11.18.0; npm explain must retain app-builder-lib notarizer 2.5.0; Electron build/tests; Authorized signed DMG build plus notarization/stapling assessment; After rebase, repeat path/import/require/hook searches and confirm both tools remain private to the dead path.; Regenerate the lockfile with the repository-pinned npm version and inspect only the intended direct/unreachable nodes.; Run npm explain @electron/notarize and confirm Electron Builder's transitive notarizer remains resolvable.; Run Electron checks/build and an authorized macOS DMG job; verify the artifact is notarized without printing secrets.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `tools/notarizeMacApp.js` — myNotarize, isDesktopAppTag; `tools/execCommand.js` — execCommand; `electron-builder.yaml` — commented afterSign, mac.notarize; `package.json` — @electron/notarize direct devDependency; `package-lock.json` — root direct dependency and unreachable lock entries
- **Why it exists:** An experimental custom afterSign notarizer was marked unused and never enabled; Electron Builder's active mac.notarize path replaced it, leaving the hook, its private shell wrapper, comment, and direct dependency.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The raw platform audit proves the hook was never registered from its first revision; an independent lens finds execCommand has no other consumer. Open PR #9077 changes the root lockfile, creating a rebase conflict but not superseding the cleanup.
- **Superseded historical estimate:** production 130–132; configuration 1; comments 1; generated 1–20
- **Gates and overlaps:** open PR conflict; macOS notarization; release signing; lockfile regeneration; secrets; rebase package metadata after PR #9077 before regenerating the lockfile.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-04-02-retired-custom-macos-notarizer; L01-C02

### C06-006 — Delete the formatter for retired CI performance-metric uploads

- **Full-review result:** Rank 67/100; controlling focused placements 66/67/57; superseded original ranks 58/28/53. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete tools/gen-perf-metrics.js only. Retain the two perf-metrics .gitignore patterns and their surrounding ignore-file structure because removing them would change git-status behavior for manually produced or residual metric files; do not touch current performance coverage.
- **Corrected LOC:** 0 production, exactly 25 nonblank test-infrastructure code lines, 0 comment lines, and 8 blank lines removed; remove 0 configuration lines.
- **Material corrections:** Removing the .gitignore patterns is behavior-changing for existing or manually produced perf-metrics files: they would become untracked even though no current producer remains.; The exact formatter split is 25 test-infrastructure code lines, not a 25-33 range.; Developer worktrees containing old .tmp/perf-metrics files; The only current metric filename occurrences are the formatter reads and .gitignore. Commit e22fa4ac5f explicitly removed the artifact upload and PR-comment workflow, and no current producer writes these files. The corrected LOC uses nonblank formatter lines and separates the .gitignore comment marker from configuration.
- **Primary gate:** No external gate; repeat producer/consumer searches and require package, workflow, current performance-test, and .gitignore behavior to remain unchanged.
- **Required verification:** Repeat formatter/input searches; Assert package/workflow files unchanged; git diff --check; Search workflows, scripts, docs, tests, and tools for the formatter path and both metric filenames.; List current Playwright tests and confirm discovery is unchanged without running sync E2E.; Inspect the diff to ensure current Lighthouse, timing, report, and failure-artifact paths are untouched.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `tools/gen-perf-metrics.js` — legacy performance metric Markdown formatter; `.gitignore` — obsolete perf-metrics input patterns
- **Why it exists:** The PR performance-upload/comment workflow and its Nightwatch JSON producers were retired, but their formatter and ignored input filenames remained.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The raw history audit and independent dead-file lens converge on the file; the removal commit for the old CI upload path and current producer searches explain why it became unreachable.
- **Superseded historical estimate:** configuration 2–3; test infrastructure 25–33
- **Gates and overlaps:** ci-tooling; performance-observability
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-04-03-retired-performance-metrics-formatter; L01-C05

### C06-007 — Remove ineffective options from the solution-style root tsconfig

- **Full-review result:** Rank 71/100; controlling focused placements 72/63/71; superseded original ranks 47/67/72. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** A. **Status:** open.
- **Authoritative scope:** Delete only the four-line compilerOptions object from the solution-style root tsconfig.json. Preserve its explanatory comment, files: [], and all references to the app, worker, and spec projects.
- **Corrected LOC:** 0 production, exactly 4 configuration lines, and 0 comment lines removed.
- **Material corrections:** Root --showConfig will intentionally lose outDir-derived exclude and esModuleInterop, so verification must compare referenced child configs, not claim root config equality.; Untracked editor/tool consumers of the root project; reference discovery
- **Primary gate:** No external gate; compare every referenced child --showConfig output, run tsc -b --dry and the production frontend build, and smoke editor project discovery. Root --showConfig itself is expected to change.
- **Required verification:** Compare every referenced child --showConfig; tsc -b --dry; production frontend build; editor project-discovery smoke; Capture root/app/worker/spec --showConfig before and after and require every child object to match.; Run the production frontend build.; Confirm an editor still discovers app, worker, and spec projects from the root references.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `tsconfig.json` — compilerOptions.esModuleInterop, compilerOptions.outDir
- **Why it exists:** Build experiments added compiler options to the empty solution root, but Angular compiles child configs that extend tsconfig.base.json rather than the root.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** TypeScript --showConfig, child extends chains, Angular tsConfig entries, and script searches prove the two options apply only to an empty root program.
- **Superseded historical estimate:** configuration 4
- **Gates and overlaps:** typescript-solution-config; editor-project-discovery
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-05-C1

### C06-008 — Remove the unused direct file-saver dependency pair

- **Full-review result:** Rank 73/100; controlling focused placements 67/72/72; superseded original ranks 51/68/59. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** After PR #9077 is resolved and the dependency proof is refreshed, remove only the direct root declarations for file-saver and @types/file-saver and regenerate their direct-only lockfile nodes. Exclude clipboard, retain the transitive top-level fs-extra node, and reassess the other originally bundled packages as separate candidates rather than authorizing a nine-package batch.
- **Corrected LOC:** At the frozen baseline, the narrowed pair removes 0 production, exactly 2 configuration lines, 0 comments, and 16 generated lockfile lines. Regenerate with npm 11.18.0 after PR #9077 and remeasure; accept only the two root declarations and direct-only file-saver nodes disappearing.
- **Material corrections:** clipboard is not root-only: npm explain shows it satisfies ngx-markdown's optional peer dependency. The app currently does not enable ngx-markdown clipboard scripts/directives, but deleting it without an explicit feature-contract decision overstates no-consumer proof.; fs-extra is also not a root-only package: multiple platform/build dependencies consume the top-level node; only its direct root declaration is unused, so that lock node must remain.; The 100-260 generated deletion estimate is unsupported after excluding clipboard and retaining transitive fs-extra.; Optional peer provisioning; platform build dependency hoisting; lockfile supply-chain drift; Current search finds file-saver only in package metadata, and history records its replacement with native browser APIs; @types/file-saver has no independent consumer. That proof supports one pair, not a nine-root batch. The open security PR makes even the narrowed lockfile change a Tier B follow-up.
- **Primary gate:** Open PR #9077; after rebase, repeat consumer and optional-peer searches, regenerate with npm 11.18.0, and inspect every lockfile and peer-resolution change.
- **Required verification:** Rebase after #9077; Regenerate with npm 11.18.0; Inspect every lock node/peer change; lint, test:once, frontend and Electron builds; Relevant native/plugin builds; After rebase, search imports, requires, type references, scripts, workflows, binaries, plugins, Electron, and native tooling for file-saver and @types/file-saver.; Regenerate package-lock.json with npm 11.18.0 and verify exactly the two root declarations and two direct-only nodes disappear.; Run lint/type checks, the production frontend build, and representative browser/Electron export-download tests.; Confirm package scripts, exports, overrides, and every other dependency are unchanged.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `package.json` — @dotenv-run/cli, @types/file-saver, @types/jasminewd2, @types/object-path, clipboard, file-saver, fs-extra, karma-cli, start-server-and-test; `package-lock.json` — root declarations and now-unreachable package nodes
- **Why it exists:** Past runtime, Protractor/Karma CLI, environment, and file/clipboard migrations removed all entry-point consumers while direct root declarations and lock nodes remained.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** Manifest/script/import/bin tracing found no current entry point for the nine direct declarations. PR #9077 concurrently edits root package metadata, requiring rebase and fresh lockfile reachability checks.
- **Superseded historical estimate:** configuration 9; generated 100–260
- **Gates and overlaps:** open PR conflict; dependency contract; lockfile regeneration; developer tooling; platform builds; rebase package metadata after PR #9077 and recheck adjacent dead-dependency work in issue #8843.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** L01-C01

### C06-009 — Delete the never-wired single-test wrapper

- **Full-review result:** Rank 63/100; controlling focused placements 65/64/56; superseded original ranks 59/27/54. Safety: confirm; maintainability: confirm; consensus: **confirm**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Delete tools/test-file.js only, with no replacement and no edit to package.json or the documented npm run test:file command.
- **Corrected LOC:** The file contains 59 physical lines: exactly 47 test-infrastructure-code lines, 6 comment-only lines, and 6 blank lines. Keep all three categories separate and do not double-count this deletion in C07.
- **Material corrections:** The canonical 47-59 test-infrastructure range plus 6-9 comments double-counts comments; exact separated counts are available.; A hidden personal invocation is unsupported but cannot affect tracked commands.
- **Primary gate:** Repeat path, import, bin, script, workflow, and documentation searches and run npm run test:file against a small existing spec.
- **Required verification:** Repeat path/reference search; Run npm run test:file on a small spec; Assert package.json unchanged; Repeat exact path, basename, import/require, bin, script, workflow, and documentation searches.; Run npm run test:file against one small existing spec.; Verify package.json and contributor documentation are unchanged.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** independently-confirmed-existing.
- **Scope:** `tools/test-file.js` — legacy single-file Karma wrapper; `package.json` — working scripts.test:file consumer proof
- **Why it exists:** A bespoke timeout/output-parsing wrapper was added but never connected; the supported test:file command independently invokes the Angular/Karma path.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** Two independent tooling lenses identify the same unreachable helper and distinguish it from the live package script.
- **Superseded historical estimate:** comments 6–9; test infrastructure 47–59
- **Gates and overlaps:** developer-test-tooling; C07 test-tooling ownership
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** L01-C04; L10-C04

### C06-010 — Do not retire the still-active hard-coded translation cleanup script

- **Full-review result:** Rank 100/100; controlling focused placements 100/100/100; superseded original ranks 100/100/100. Safety: reject; maintainability: confirm; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** Rejected: delete nothing. The hard-coded translation cleanup is not completed or idempotent, still has 1,276 pending removals across 28 locales, remains prescribed by documentation, and includes sync keys outside this audit's boundary. Resolve or abandon that cleanup in a separate translation-owner-reviewed task before considering any future retirement.
- **Corrected LOC:** 0 LOC is authorized for deletion. The rejected target is a 370-physical-line tool containing 306 tooling-code lines, 34 comment lines, and 30 blank lines, but those figures are not realizable simplification reward while the cleanup remains pending.
- **Material corrections:** The earlier completed-cleanup premise is false: a current dry run still proposes 1,276 removals across 28 locales.; The script remains documented and crosses into sync-owned translation keys, so this non-sync audit cannot authorize its retirement.; The rejected tool size receives zero reward and no deletion recipe is retained.
- **Primary gate:** Hard rejection under the current facts: 1,276 pending removals, translation-owner approval, non-sync boundary violation, and a future zero-change dry run must all be resolved before a new candidate can be proposed.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `tools/cleanup-unused-translations.js` — SECTIONS_TO_REMOVE, NESTED_PATHS_TO_REMOVE, processJsonFiles; `docs/unused-translations-analysis.md` — Recommended Cleanup Script; `package.json` — maintained int:unused and clean:translations commands
- **Why it exists:** A one-time translation cleanup encoded a fixed list of already-removed keys and remained after ongoing detection/cleanup moved to maintained generic commands.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Exact reference and history checks find no current entry point for the fixed-list script; maintained generic commands own the ongoing workflow.
- **Rejected historical estimate:** Zero LOC is authorized. configuration 370; comments 4–12
- **Gates and overlaps:** manual-contributor-tool; translation-workflow
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** L12-C02

### C06-011 — Delete unread copyToAssets flags from bundled-plugin metadata

- **Full-review result:** Rank 69/100; controlling focused placements 70/52/70; superseded original ranks 73/69/73. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** After PR #8067 is resolved, remove only each copyToAssets: true property that is still proven unread in packages/plugin-dev/scripts/build-all.js. Do not introduce a helper or derive paths, and preserve needsInstall, every buildCommand, copyRecursive call, ordering, parallelism, working directory, failure aggregation, special allowlist, and bundled output unchanged.
- **Corrected LOC:** Exactly 13 configuration lines are removable at the frozen baseline, with 0 production, comment, generated, or moved LOC. Recheck the post-#8067 file and count one line per still-unread property (expected 13-14); do not claim the discarded 80-110-line helper estimate as reward.
- **Material corrections:** The candidate combines three changes with different proofs: extracting six build/copy bodies, deriving all 13 paths, and deleting all 13 unread copyToAssets fields. That violates the one-coherent-root-cause/smallest-change contract.; The 115-155 LOC estimate cannot be exact until a concrete helper diff exists and currently mixes optional metadata cleanup into the helper reward.; Open PR #8067 still adds a special Markdown-notes entry to this file.; Bundled artifact allowlists; stale target files masking copy omissions; parallel failure aggregation; shell working directories; At the frozen HEAD copyToAssets appears thirteen times and is never read. By contrast, the proposed helper would move repeated, release-relevant file-copy behavior behind a new parameterized abstraction and require expensive artifact proof. KISS favors the tiny dead-field deletion, opportunistically after the overlapping PR.
- **Primary gate:** Open PR #8067; after rebase, prove the property has no read site and reject any diff that changes build/copy behavior rather than deleting only dead fields.
- **Required verification:** Rebase after #8067; Build from clean source and empty target directories before/after; Compare inventories and content hashes; Force one failure and test --silent; Verify all special allowlists; After rebase, prove copyToAssets has no read site and delete only the field assignments.; Run node --check and the normal bundled-plugin build without changing install/failure behavior.; Compare bundled file inventories/hashes if any line beyond the dead properties changes; otherwise reject the expanded diff.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `packages/plugin-dev/scripts/build-all.js` — plugins, copyRecursive, buildPlugin, routine build-and-copy entries
- **Why it exists:** Six routine bundled plugins repeat the same build-and-copy command bodies while one unread metadata flag duplicates information already encoded in buildCommand.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The build-duplication lens isolated exact routine cases and explicit special cases. Open PR #8067 adds another special allowlisted entry in the same file, so the cleanup must rebase rather than absorb it into the helper.
- **Superseded historical estimate:** configuration 115–155; comments 0–6
- **Gates and overlaps:** open PR conflict; plugin packaging; manifest copy; byte equivalence required; rebase `packages/plugin-dev/scripts/build-all.js` after PR #8067 and retain its new special-case entry.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** L10-C02

### C06-015 — Remove unused palettes and glow presets from the Rainbow theme

- **Full-review result:** Rank 39/100; controlling focused placements 43/35/48; superseded original ranks 32/70/45. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Only consider deleting the five neon-rewrite definitions with no in-repository consumer: --neon-magenta, the multiline --rainbow-gradient declaration and its comment, --glow-violet, --glow-pink, and --glow-green. Keep all twelve older --rainbow-\* palette variables and --glow-cyan unless an explicit public/custom-style compatibility decision permits their removal.
- **Corrected LOC:** The narrowed scope removes exactly 14 production CSS lines and 1 comment line, with 0 configuration LOC. The original 18-token/26-production-line estimate is invalid; there are 17 zero-use definitions and only these five share the defensible neon-era root cause.
- **Material corrections:** There are 17 zero-use definitions, not 18.; The twelve original --rainbow-\* palette variables are explicitly described in-file as kept for identity and predate the neon rewrite; they do not share the same root cause as neon-only dead presets.; Repository search cannot prove absence of runtime consumers in user styles or plugins; CSS custom properties are observable and shipped themes are documented as starting templates.; User styles/plugin CSS dynamic consumption; runtime theme asset output; visual regression; issue #8835 adjacent theming contract; Internal search confirms all 18 cataloged names are definition-only today, but the original twelve palette names were live before the neon rewrite and the project explicitly supports an Electron styles.css that overrides or extends app styles. That dynamic boundary makes the broad removal overconfident. The five newly introduced, never-consumed presets are the defensible bounded scope.
- **Primary gate:** Reconcile Issue #8835 and the public/custom-style compatibility boundary, then repeat exact-name searches and perform browser and Electron Rainbow visual checks before implementation.
- **Required verification:** Confirm undeclared built-in variables are non-public; Capture retained custom-property/computed-style inventory; Browser and Electron Rainbow visual smoke; Search implementation HEAD for all five names; Repeat exact definition/reference searches for the corrected five names across source, packages, docs, tools, and tests.; Parse/normalize CSS and prove every retained selector/declaration and referenced computed property is unchanged.; Smoke Rainbow in browser and Electron across task list, navigation, cards, buttons, chips, selected/current task, and focus states.; Document why the five never-used names are private; do not claim the older palette is safe without a compatibility decision.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/assets/themes/rainbow.css` — legacy --rainbow-_ palette, --neon-magenta, --rainbow-gradient, unused --glow-_ presets
- **Why it exists:** The 2026 neon rewrite stopped consuming the original Rainbow palette and introduced several presets that never acquired a var() use, while retaining all definitions.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** A complete private-token definition/use inventory, repository-wide exact searches, blame, and the pre-neon parent revision prove the proposed tokens have definition-only occurrences.
- **Superseded historical estimate:** production 26; comments 4
- **Gates and overlaps:** runtime-theme-asset; task-hot-path-appearance; visual-regression; GitHub issue #8835 defines adjacent live theming work
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** I13-03-C01

## C07 — Tests and non-sync E2E (15 candidates)

### C07-001 — Replace PlannerService's copied tomorrow$ implementation with production-connected cases

- **Full-review result:** Rank 68/100; controlling focused placements 59/68/63; superseded original ranks 69/62/68. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Before deleting the copied tomorrow$ pipeline, build a production-connected PlannerService harness that drives the real days$ -> tomorrow$ initialization. Install the fake clock before TestBed.inject; cover found, absent, 03:59:59.999, the exact 04:00 boundary, post-boundary re-emission, and concurrent subscribers; prove replay/refCount through upstream subscription counts rather than object identity; then delete only copied cases mapped by a tuple ledger.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. Tests: unknown; test infrastructure: unknown. The reviewers' 155-220 combined test-side reduction is a planning envelope only and is not used as a categorized LOC total or ranking reward; measure both categories independently from the implementation diff.
- **Material corrections:** Every existing case replaces tomorrow$ with a copied map/find/shareReplay pipeline, so it cannot detect a regression in PlannerService's actual initializer or days$ wiring.; The service is injected in beforeEach before per-test clock installation, contrary to the proposed construction-time clock contract.; Object identity from find() does not by itself prove shareReplay behavior; the same days array yields the same object even without shareReplay.; logical-day rollover; timezone/DST; RxJS replay/refCount; service initialization order; The false coverage is certain, but building a faithful production harness is the work; a compact copied observable is not an acceptable replacement.
- **Primary gate:** The replacement must exercise the service's real construction-time days$ dependency; assigning service.days$ or tomorrow$ after construction does not satisfy the gate.
- **Required verification:** npm run checkFile src/app/features/planner/planner.service.spec.ts; npm run test:file src/app/features/planner/planner.service.spec.ts; npx cross-env TZ=America/Los_Angeles ng test --watch=false --include=src/app/features/planner/planner.service.spec.ts; checkFile and focused spec; Europe/Berlin and America/Los_Angeles; tuple ledger plus subscription cleanup
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/planner/planner.service.spec.ts` — PlannerService test provider factory, tomorrow$ suite
- **Why it exists:** The spec replaces tomorrow$ with a test-owned copy of the production map/find/shareReplay pipeline, so fifteen passing cases do not exercise PlannerService and have already drifted with date changes.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The spec explicitly acknowledges that production tomorrow$ is bypassed, and its copied lines match the production implementation. This is false coverage, not ordinary duplicate assertions, so characterization is a prerequisite.
- **Superseded historical estimate:** test infrastructure -25–0; tests 255–315
- **Gates and overlaps:** false-coverage-replacement; timezone-logical-day; rxjs-replay-timing; characterization-required; Land production-connected characterization before deleting the copied implementation.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-01-C1

### C07-002 — Replace the copied planner calendar-selector algorithm with real projector coverage

- **Full-review result:** Rank 57/100; controlling focused placements 54/66/52; superseded original ranks 63/54/60. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Add typed selectPlannerDays.projector cases for previous-civil-day offset bucketing, same-day inclusion and exclusion, provider grouping and order, timed/all-day classification, duration, and full property preservation. Keep the production helper private. Delete the local algorithm and its direct-only cases only after a tuple-by-tuple ledger maps every unique case to a production-projector execution.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. Tests: unknown; test infrastructure: unknown. The reviewers' 175-200 combined test-side reduction is a planning envelope only and is not used as a categorized LOC total or ranking reward; measure both categories independently from the implementation diff.
- **Material corrections:** The first large block defines a local getIcalEventsForDay algorithm and never invokes the production selector projector.; Existing projector tests cover important all-day/timed behavior but do not fully replace the shadow suite's provider, offset, property-preservation, and exclusion matrix.; Provider separation in flat local outputs is not equivalent to asserting the production grouping/order shape.; calendar provider grouping; all-day normalization; logical-day offset; timezone/DST; Production uses getDbDateStr with an offset and isAllDayCalendarEvent while the copy does not, so preserving the copy has negative maintenance value.
- **Primary gate:** The production-projector characterization and provider/order/property ledger must be green before the shadow algorithm is deleted.
- **Required verification:** npm run checkFile src/app/features/planner/store/planner.selectors.spec.ts; npm run test:file src/app/features/planner/store/planner.selectors.spec.ts; Run the same focused spec with TZ=America/Los_Angeles and compare the case count.; checkFile and focused spec; two timezone jobs; compare event/order/property ledger
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/features/planner/store/planner.selectors.spec.ts` — test-owned calendar-event helper, selectPlannerDays projector cases
- **Why it exists:** A private helper is claimed to be tested directly but is actually reimplemented in the spec, and the copy already omits production offset and all-day semantics.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The copied implementation uses local Date components while production uses getDbDateStr(start - offset) and isAllDayCalendarEvent, proving that green tests can disagree with runtime behavior.
- **Superseded historical estimate:** test infrastructure 45–60; tests 140–190
- **Gates and overlaps:** false-coverage-replacement; timezone-scheduling; calendar-all-day-semantics; characterization-required; Production-projector characterization must land first.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-02-C1

### C07-003 — Delete reminder-dialog suites that assert only local simulations

- **Full-review result:** Rank 66/100; controlling focused placements 53/71/65; superseded original ranks 65/58/64. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** After rechecking and rebasing the reminder-adjacent PR gate, add TestBed-backed component cases for the current planForTomorrow clear dispatch, remindAt clearing before the store read, a dismissed reminder re-emitted by the worker, and late worker/store emissions during close, including eager unsubscribe/double-close behavior. Preserve the future-day/04:00 boundary and pure hint tests; only then delete the four local simulations.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. Tests: unknown; test infrastructure: unknown. The reviewers' 270-365 combined test-side reduction is a planning envelope only and is not used as a categorized LOC total or ranking reward; measure both categories independently from the implementation diff.
- **Material corrections:** Four describes assert local task-pipeline, action-props, dismissed-set, and close-animation simulations instead of DialogViewTaskRemindersComponent.; The plan-for-tomorrow shadow encodes obsolete behavior: production now dispatches clearDeadlineReminder({taskId}), not the copied deadline-preserving action.; Later TestBed suites cover store reconciliation generally but do not prove cleared remindAt races, dismissed-worker stale emissions, or late emissions during close against the real component.; reminder loss/duplication; worker/store race; close/unsubscribe behavior; logical-day rollover; task state; The simulations do not cover production, but their unique races are important enough that deleting them without real characterization weakens the behavioral contract.
- **Primary gate:** Recheck PR #8369 and land the production-connected race and teardown characterizations before deleting any simulation.
- **Required verification:** npm run checkFile src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.spec.ts; npm run test:file src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.spec.ts; Run focused reminder tests in Europe/Berlin and America/Los_Angeles with the clock installed before component creation.; checkFile and focused spec; assert real store actions and MatDialogRef state; stale-emission and teardown race tests
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 12; challenges: refuter narrowed, maintainer narrowed.
- **Scope:** `src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.spec.ts` — buildTasksPipeline, actionProps, removeReminderFromList, handleRemindersActive simulation suites
- **Why it exists:** Four component-labeled suites define and test their own pipelines, action shapes, removal helpers, and component-like object instead of executing the Angular component.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The blocks repeatedly say 'Simulate the component' and every expectation targets a local function or object. Their 480 lines create coverage metrics without production coverage.
- **Superseded historical estimate:** tests 360–420
- **Gates and overlaps:** false-coverage deletion; reminder scheduling; large test deletion; PRs #8369 and #8598 were reminder-adjacent without an exact-file overlap and did not provide the missing component-path coverage, but must be rechecked before implementation.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-06-C01

### C07-004 — Replace worklog shadow algorithms with focused production calls

- **Full-review result:** Rank 56/100; controlling focused placements 55/60/55; superseded original ranks 64/55/62. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Implement as separate test-only changes: add WorklogService inclusive first/last and outside-range coverage before deleting the range shadow; add formatRows START/END rounding coverage before deleting the Math.round shadow; and add a real WorklogExportComponent ngOnInit filename assertion before deleting the component-named pseudo-test. Preserve archive-read, project/day filtering, ordering, and completion inputs; do not edit persistence code.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. The reviewers' aggregate ranges do not overlap because one omitted the safety-required real component filename case. For the controlling safety-complete scope, budget 40-80 added test-infrastructure LOC and 130-190 removed test LOC, for 50-150 net LOC removed; remeasure each independent change before combining totals.
- **Material corrections:** The timezone range spec filters a local array, the export component spec reconstructs the filename, the formatter block performs Math.round directly, and the legacy service case only parses a date string.; A service range test plus a formatter test does not preserve the filename contract because WorklogExportComponent.ngOnInit remains unexecuted.; The ordinary test:file script pins Europe/Berlin; the conditional negative-offset branch needs an explicit Los Angeles run.; worklog export correctness; inclusive date range; timezone/DST; archive/persistence adjacency; The finding is valid, but bundling three root causes inflates cohesion and makes rollback/diagnosis worse.
- **Primary gate:** Each production-path characterization, including the real component filename assertion, must land before its corresponding shadow is deleted.
- **Required verification:** Run checkFile on every modified worklog spec; Run each focused worklog spec in Europe/Berlin; Run the timezone-sensitive service/export specs with TZ=America/Los_Angeles; checkFile for each touched spec; focused service and export specs; both timezone jobs with inclusive endpoints and exact rounding
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/worklog/worklog-export/worklog-export.util.spec.ts` — moment-based shadow blocks; `src/app/features/worklog/worklog.service.timezone.spec.ts` — local mockTasks range filtering; `src/app/features/worklog/worklog-export/worklog-export.component.tz.spec.ts` — component-name timezone pseudo-tests; `src/app/features/worklog/worklog.service.spec.ts` — getTaskListForRange$ production characterization
- **Why it exists:** Timezone and rounding suites recalculate expected worklog behavior with moment/local arrays without importing the production formatter, component, or service path.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The shadow suites instantiate no production target, while adjacent service/utility specs already expose the correct seams. The replacement retains any unique range and rounding equivalence class before deletion.
- **Superseded historical estimate:** test infrastructure -18–-8; tests 205–238
- **Gates and overlaps:** false-coverage-replacement; timezone-scheduling; export-rounding; characterization-required; Production WorklogService range characterization must pass before deleting the shadow suite.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T03-08-C2

### C07-005 — Delete the work-context shadow implementation after preserving its unique boundary

- **Full-review result:** Rank 47/100; controlling focused placements 51/56/39; superseded original ranks 60/12/24. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Add the yesterday dueWithTime row to work-context.service.spec.ts, verify that earlier/later, exact-now, tomorrow, dueDay, non-Today, and parent/subtask rows still execute the real WorkContextService method, then delete work-context-filter.spec.ts. Keep this test-only and do not claim or introduce new 04:00 logical-day semantics.
- **Corrected LOC:** Production/configuration/comments/test infrastructure/generated/moved: 0. Remove 180-184 net test LOC after adding the mandatory yesterday production-path row.
- **Material corrections:** work-context-filter.spec.ts is a complete local copy and imports only the Task type.; The real WorkContextService suite already covers later, earlier, unscheduled, done, tomorrow, dueDay, non-Today, exact-now, and parent/subtask cases, but not the shadow suite's explicit yesterday case.; Calling the preserved behavior 'logical-today' overstates the production method, which currently compares scheduled timestamps through civil end-of-day.; TODAY virtual-list semantics; scheduled boundary; task filtering; The existing service suite already calls the real filter and covers the envelope; yesterday is the only material missing row.
- **Primary gate:** Map every deleted shadow row to the retained production-method matrix, with yesterday represented explicitly.
- **Required verification:** npm run checkFile src/app/features/work-context/work-context.service.spec.ts; npm run test:file src/app/features/work-context/work-context.service.spec.ts; Confirm the discovered Jasmine case count drops only by the shadow suite minus the new yesterday case.; checkFile and focused service spec; two timezone jobs; deleted-row mapping
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/work-context/work-context-filter.spec.ts` — spec-local task filter implementation; `src/app/features/work-context/work-context.service.spec.ts` — production Today-context filter cases
- **Why it exists:** A standalone file imports only the Task type and tests a locally written filter, while WorkContextService already owns the production behavior and nearly the same boundary matrix.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The target file imports no production function. The service suite covers the same envelope through the real method, with yesterday the only possible distinct row.
- **Superseded historical estimate:** tests 180–194
- **Gates and overlaps:** false-coverage-deletion; logical-today; synced-task-state-adjacent; Preserve the yesterday equivalence class if it is not already exercised by the real service.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T03-08-C1

### C07-006 — Replace the self-testing task-delete unit spec with three real E2E outcomes

- **Full-review result:** Rank 72/100; controlling focused placements 64/73/73; superseded original ranks 70/61/69. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Keep the work test-only and split it into two changes. First, replace the stale wrong-key self-test with production-path true/false/default characterization of tasks.isConfirmBeforeDelete, without editing TaskComponent. Separately retain three isolated E2E outcomes: context cancel keeps the task, context confirm removes it and exposes Undo, and keyboard confirm removes the focused task. Replace fixed waits with focus/locator state, use clean state per test, and add reload only if persistence is claimed.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. Tests: unknown; test infrastructure: unknown. The reviewers' 90-170 combined test-side reduction is a planning envelope only and is not used as a categorized LOC total or ranking reward; measure both categories independently after the two required changes.
- **Material corrections:** The unit spec is a self-test and uses the obsolete misc.isConfirmBeforeTaskDelete key; production reads tasks.isConfirmBeforeDelete.; The proposed three E2E outcomes can preserve cancel/context-confirm/keyboard-confirm, but existing keyboard coverage uses forbidden fixed 200 ms waits.; The preserved contract claims persistence although the target E2E file does not reload after deletion.; destructive task action; persistence; keyboard focus; hot-path task UI; E2E flakiness; Deleting the self-test is correct, but the canonical scope overstates preserved setting coverage and bundles two different maintenance jobs.
- **Primary gate:** No TaskComponent production edit is authorized; real config-path coverage, deterministic keyboard focus, and explicit task-preserved/task-removed assertions are required before claiming the old contract is replaced.
- **Required verification:** npm run checkFile e2e/tests/task-basic/task-delete-confirmation.spec.ts; npm run e2e:file e2e/tests/task-basic/task-delete-confirmation.spec.ts -- --retries=0; npm run e2e:file e2e/tests/task-basic/task-crud.spec.ts -- --retries=0; checkFile; focused E2E with --retries=0; clean state per test and real task-preserved/task-removed assertions
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/tasks/task/task-delete-confirmation.spec.ts` — spec-local delete confirmation branch; `e2e/tests/task-basic/task-delete-confirmation.spec.ts` — cancel, confirm plus undo, keyboard-confirm outcomes
- **Why it exists:** The unit file copies TaskComponent's if/else and asserts its own spies, while five E2E cases repeat prefixes around only three distinct user-visible outcomes.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** Every unit assertion observes behavior executed inside the spec. The E2E show-dialog case is a prefix of accept/cancel and the snackbar case repeats the accepted path, so three outcomes preserve the complete external contract.
- **Superseded historical estimate:** test infrastructure -24–-12; tests 230–267
- **Gates and overlaps:** false-coverage-deletion; e2e-journey-consolidation; task-hot-path; persistence; dialog-timing; The two source findings describe complementary unit false-coverage removal and real-browser outcome consolidation for the same contract; LOC is summed without duplicate lines.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-08-C01; T05-05-C2

### C07-007 — Delete superseded and non-discovered Add Task Bar timezone artifacts

- **Full-review result:** Rank 78/100; controlling focused placements 83/78/76; superseded original ranks 75/75/80. Safety: defer; maintainability: narrow; consensus: **defer**. **Tier:** C. **Status:** deferred.
- **Authoritative scope:** Deferred in full: do not delete either artifact now. After PR #8515 resolves, rebase and obtain a fresh candidate review. That review may separately consider the non-discovered .bak deletion after discovery/reference checks, and may consider the active integration spec only after mapping all eleven executions to production-connected payload-builder/component coverage and passing explicit Europe/Berlin and America/Los_Angeles runs.
- **Corrected LOC:** Current authorized LOC reduction: 0. Conditional future scope is 364 inactive test-artifact LOC for the .bak file and up to 548 total test LOC only if the additional 184-line active suite independently clears its coverage gate; none of that conditional total counts as currently actionable savings.
- **Material corrections:** add-task-bar.component.tz.spec.ts.bak is tracked but excluded by the `**/*.spec.ts` discovery pattern, so its deletion is safe and saves no active coverage.; add-task-bar-timezone.integration.spec.ts is also self-testing, but its exact provider/property cases are not all demonstrated by the retained timezone-logic suite.; Several US-DST-labeled dates are not made DST transitions merely by running the default Europe/Berlin test job.; add-task parsing; scheduled timestamps; timezone/DST; test discovery; active PR overlap; Both deletions are worthwhile, but their safety proofs differ and the canonical LOC narrative originally hid active case removal.
- **Primary gate:** PR #8515 must resolve, the branch must be rebased, and the candidate must receive a fresh approval before either deletion.
- **Required verification:** Re-run exact discovery after deleting the .bak file; After #8515 rebase, run checkFile on changed active specs; After #8515 rebase, run the focused production-connected suite in Europe/Berlin and America/Los_Angeles; git/test-glob/reference searches; active Add Task Bar and getDbDateStr specs in both timezones; confirm exactly eleven active specs are intentionally removed
- **Discovery-era record (superseded):** Open. **Tier:** Final B. **Classification:** net-new. Rank 10; challenges: refuter confirmed, maintainer confirmed.
- **Scope:** `src/app/features/tasks/add-task-bar/add-task-bar-timezone.integration.spec.ts` — superseded timezone integration suite; `src/app/features/tasks/add-task-bar/add-task-bar-timezone-logic.spec.ts` — retained active timezone logic suite; `src/app/features/tasks/add-task-bar/add-task-bar.component.tz.spec.ts.bak` — tracked non-discovered backup suite
- **Why it exists:** Timezone work left both an older utility-only integration suite and a tracked .bak Jasmine file that Karma never discovers; their names imply active component coverage that does not exist.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** Angular/Karma globs exclude .bak and no file references it; the older active suite has only one production import and overlaps the later logic suite. Both artifacts create misleading coverage surface.
- **Superseded historical estimate:** tests 548
- **Gates and overlaps:** stale test artifact; timezone scheduling; large test deletion; L12 independently found the non-discovered backup and T01-05 found the separate superseded suite; PR #8515 substantially refactors Add Task Bar payload construction and PR #8927 changes `getDbDateStr` and its direct spec, so rebase and remap retained production-connected coverage after either lands.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-05-C01; L12-C01

### C07-008 — Run shared repeat-config projector cases from one typed matrix

- **Full-review result:** Rank 54/100; controlling focused placements 60/48/61; superseded original ranks 68/63/65. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Limit sharing to a typed matrix for the three exactly duplicated paused rows. Create a fresh repeat config per projector execution, retain explicit projector/case names and all six Jasmine executions, and leave DAILY/WEEKLY/MONTHLY/YEARLY and other selector-specific recurrence cases explicit. Remove the two inert console logs and the 42-line commented block, and record exact case counts before and after.
- **Corrected LOC:** Production/configuration/generated/moved: 0. Remove 42 comment LOC and 60-85 test LOC while adding 12-20 test-infrastructure LOC, for 82-115 net LOC removed under the narrowed paused-only abstraction.
- **Material corrections:** The common selector matrices are similar but not identical: DAILY negative cases, timestamp representation, weekly coverage, and lastTaskCreationDay values differ.; Shared mutable repeat-config objects would make projector execution order observable and can leak mutations between generated cases.; The candidate misclassifies 42 commented WEEKLY lines as test LOC and reports comments as zero.; recurrence matrix drift; projector-specific semantics; mutable fixture leakage; timezone; The broad matrix optimizes LOC at the expense of test readability; only the exact paused twins earn a shared table.
- **Primary gate:** Land or rebase after C02-009, require fresh fixture objects, and preserve six independently named paused executions plus every existing recurrence-cycle case.
- **Required verification:** npm run checkFile src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts; npm run test:file src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts; Run with TZ=America/Los_Angeles and compare exact Jasmine case names/counts; checkFile and focused spec; both timezone jobs; require six paused cases and unchanged named boundary cases
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.spec.ts` — getRepeatableTasksForExactDay projector suite, getRepeatableTasksForWeekday projector suite, paused-filter cases
- **Why it exists:** Two projector suites duplicate the same DAILY/WEEKLY/MONTHLY/YEARLY and paused-case setup, while obsolete commented tests and console logging obscure the active boundary-specific cases.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** MONTHLY/YEARLY and paused blocks are executable twins with identical IDs, config, day, and expected arrays. The proposal shares fixtures and registration, not production selectors or executions.
- **Superseded historical estimate:** test infrastructure -55–-30; tests 245–451
- **Gates and overlaps:** fixture-table-refactor; recurrence-timezone; synced-state-adjacent; case-count-fence; All three findings affect disjoint regions of one spec; C1 and C2 share the proposed runner but no test rows are double-counted.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-04-C1; T01-04-C2; T01-04-C3

### C07-009 — Route next/newest recurrence boundary cases through their existing scenario runners

- **Full-review result:** Rank 62/100; controlling focused placements 61/65/58; superseded original ranks 61/17/51. Safety: narrow; maintainability: confirm; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Within each file, route equality-shaped boundary cases through the existing file-local runner without changing titles, comments, inputs, or expected timestamps. Keep the International Date Line non-equality assertion explicit, preserve the issue #7355 first-occurrence exclusion, retain the clearest Feb-29-to-Feb-28 case, and delete the other two executable-identical copies. Keep the two files independently reviewable and add no cross-file helper.
- **Corrected LOC:** Production/configuration/comments/generated/moved: 0. Tests: unknown; test infrastructure: unknown. The reviewers' 95-150 combined test-side reduction is a planning envelope only and is not used as a categorized LOC total or ranking reward; measure both categories independently, including the two duplicate Feb-29 executions, from the final diff.
- **Material corrections:** Both existing scenario helpers already call production; the opportunity is repetitive assertion shells, not false coverage.; There are three executable-identical YEARLY Feb-29-to-Feb-28 cases in get-next-repeat-occurrence.util.spec.ts, not the candidate's claimed pair.; Removing only one leaves a duplicate execution and makes the LOC estimate short by roughly one case.; recurrence boundary tuples; timezone/date mutation; issue #7355 contract fence; This reuses an already-understood local seam and preserves diagnostic test titles, so the abstraction cost is near zero.
- **Primary gate:** The before/after tuple ledger must differ only by the two documented duplicate executions, and the change must not expand into issue #7355 first-occurrence behavior.
- **Required verification:** Run checkFile on both modified recurrence specs; Run both focused specs in Europe/Berlin and America/Los_Angeles; Diff exact case-name and tuple counts, accounting for exactly two removed duplicate executions; checkFile and both focused specs; two timezone jobs; tuple/case ledger equal except one documented duplicate
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/task-repeat-cfg/store/get-next-repeat-occurrence.util.spec.ts` — testCase runner, boundary cases, duplicate February-29 yearly case; `src/app/features/task-repeat-cfg/store/get-newest-possible-due-date.util.spec.ts` — testCase runner, boundary cases
- **Why it exists:** Large recurrence sections manually repeat the same expected-date normalization, production call, and equality shell despite already having file-local scenario runners; one February-29 case is exactly duplicated.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The inline calls have the same shaping and assertion as testCase, and the two leap-year blocks have identical executable inputs/outputs. First-occurrence tables are deliberately excluded because issue #7355 may change that contract.
- **Superseded historical estimate:** test infrastructure -6–0; tests 83–195
- **Gates and overlaps:** fixture-table-refactor; recurrence-timezone; leap-year-boundary; case-ledger-required; T01-03-C2 removes one exact duplicate inside the T01-03-C1 refactor region; the duplicate's LOC is included once in the summed estimate.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-03-C1; T01-03-C2

### C07-010 — Centralize iCalendar envelopes while preserving every raw parser case

- **Full-review result:** Rank 59/100; controlling focused placements 62/57/59; superseded original ranks 67/57/61. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Add one lossless spec-local default-calendar helper for ordinary VEVENT cases only; keep malformed calendars, custom headers/ranges, Office365/VTIMEZONE, orphan, and cancelled fixtures inline, preserve the eager ical.js import and all 36 named cases, compare rendered full strings for representative ordinary and every exceptional fixture, and replace both synchronous not-to-throw wrappers around async calls with awaited rejection-sensitive result assertions.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure -24 to -12; tests 120 to 180; generated 0; moved 0.
- **Material corrections:** Envelope extraction is viable, but parser fixtures are untrusted raw text: line endings, blank/malformed continuations, header order, VTIMEZONE metadata, and orphan/custom-range exceptions must remain byte-equivalent.; Two async parser tests use expect(() => asyncCall()).not.toThrow(), which only observes Promise creation and cannot detect rejection.; The candidate explicitly proposes keeping those ineffective synchronous assertions, violating the behavioral-protection contract.; untrusted iCalendar parsing; raw byte fidelity; VTIMEZONE/provider quirks; async false positives; timezone/DST; One default helper earns its keep; a wrapper plus invocation/options framework would merely move complexity.
- **Primary gate:** Repair the two async false-positive assertions and prove raw-calendar byte fidelity before applying the helper conversion.
- **Required verification:** npm run checkFile src/app/features/schedule/ical/get-relevant-events-from-ical.spec.ts; npm run test:file src/app/features/schedule/ical/get-relevant-events-from-ical.spec.ts; Run with TZ=America/Los_Angeles and compare exact discovered case count and rendered fixture snapshots; checkFile and focused spec; both timezone jobs; compare full emitted calendar strings for representative and malformed fixtures; keep 36 cases
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/schedule/ical/get-relevant-events-from-ical.spec.ts` — VCALENDAR envelope, getRelevantEventsFromIcal invocation
- **Why it exists:** Thirty-six parser cases wrap a small VEVENT/VTIMEZONE payload in the same calendar envelope and date-range invocation, burying malformed lines and boundary inputs in boilerplate.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** A typical case spends nine invariant lines around five to ten meaningful lines; all 36 calls share the same production seam, making this a fixture extraction rather than assertion deletion.
- **Superseded historical estimate:** test infrastructure -20–-12; tests 195–265
- **Gates and overlaps:** fixture-table-refactor; ical-parser-boundary; timezone-scheduling; raw-fixture-byte-fidelity
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T01-02-C2

### C07-011 — Build simple-counter streak cases from DST-safe offset fixtures

- **Full-review result:** Rank 64/100; controlling focused placements 63/62/60; superseded original ranks 66/56/63. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Introduce only a DST-safe countOnDay-from-offsets helper and one fresh counter factory; store immutable offset/value descriptions, construct dates, maps, and counters inside each test after clock installation, and retain every zero entry, disabled weekday, explicit mode/expectation, all 23 executions, and both mutation sequences; add pinned spring-forward and fall-back equivalence cases only if DST-transition protection remains claimed.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure -45 to -25; tests 90 to 150; generated 0; moved 0.
- **Material corrections:** Several specific-day fixtures are created at describe/module evaluation time from the real current date, while generated cases mutate counter objects.; A table of prebuilt Date/counter objects would preserve shared-state leakage instead of fixing it; builders must execute after each test's fake clock is installed.; Running under two timezone names does not prove 'across both DST transitions' because current dates and the fixed January date are not transition boundaries.; DST date arithmetic; clock installation order; shared mutable fixtures; streak case-count drift; Two focused builders improve auditability; the canonical four-builder design overstates the net simplification.
- **Primary gate:** Fixture freshness and exact case/mutation parity are mandatory; pinned transition dates are required for any DST-transition claim.
- **Required verification:** npm run checkFile src/app/features/simple-counter/get-simple-counter-streak-duration.spec.ts; Run the focused spec in Europe/Berlin and America/Los_Angeles; Compare generated concrete date/count maps and Jasmine execution count before/after at pinned spring and fall transitions; checkFile and focused spec; Europe/Berlin and America/Los_Angeles including DST dates; compare 23 case names, concrete date maps and mutations
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary A. **Classification:** net-new.
- **Scope:** `src/app/features/simple-counter/get-simple-counter-streak-duration.spec.ts` — weekday maps, day-offset count fixtures, specific-days and weekly counter fixtures
- **Why it exists:** Long streak fixtures repeatedly spell the same weekday/counter envelope, making the meaningful day offsets, values, disabled weekdays, and mutation steps difficult to audit.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The suite already has a DST-safe daysAgo primitive and repeated fixtures differ primarily by small offset/value maps. Builders expose the behavioral matrix without changing it.
- **Superseded historical estimate:** test infrastructure -46–-23; tests 160–310
- **Gates and overlaps:** fixture-table-refactor; dst-boundary; calendar-day-arithmetic; case-count-fence
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T03-06-C2

### C07-012 — Keep standalone PluginService and PluginLoader cases in their focused harnesses

- **Full-review result:** Rank 94/100; controlling focused placements 92/91/93; superseded original ranks 97/97/98. Safety: defer; maintainability: reject; consensus: **reject**. **Tier:** reject. **Status:** rejected.
- **Authoritative scope:** No change: keep both focused standalone specs and their current harnesses; do not relocate the ten cases or introduce a shared provider factory under this candidate, and require a new feature-driven audit that counts relocation as moved LOC before any future redesign.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure 0; tests 0; generated 0; moved 0.
- **Material corrections:** The standalone files contain exactly five ZIP and five iframe-loader cases, and their harnesses are duplicative.; The canonical PluginService harness defaults isPluginEnabled to false and does not provide the standalone runner fake, so naive relocation changes the enabled-state assertions.; The canonical HttpTestingController harness can strengthen request order, but must reproduce 404 versus 500 bodies and verify no unexpected requests.; These cases do not assert iframe sandbox attributes; the preserved contract overstates them as sandbox coverage.; plugin public API; nodeExecution consent boundary; plugin enabled persistence; HTTP error ordering; test harness default drift; Focused harnesses isolate security/error behavior; moving ten tests into two already broad files worsens maintainability.
- **Primary gate:** None; reconsider only for a future feature-driven harness redesign with explicit behavior and moved-LOC accounting.
- **Required verification:** No implementation verification is recommended for this rejected proposal.
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `src/app/plugins/plugin.service.load-from-zip.spec.ts` — ZIP-loading standalone TestBed; `src/app/plugins/plugin.service.spec.ts` — loadPluginFromZip canonical describe; `src/app/plugins/plugin-loader.iframe-only.spec.ts` — iframe-only standalone HTTP harness; `src/app/plugins/plugin-loader.service.spec.ts` — canonical HttpTestingController harness
- **Why it exists:** ZIP and iframe-only behavior live in standalone specs that reproduce dependency and HTTP routing harnesses already present in each service's canonical spec.
- **Rejected historical proposal:** Superseded; no implementation is authorized. Follow the authoritative rejection above.
- **Rejected historical preservation notes:** Superseded by the authoritative rejection; no implementation is authorized.
- **Evidence:** Provider-by-provider comparison found that the canonical harnesses already supply every required dependency and response seam. This is fixture ownership consolidation, not merging the production services.
- **Rejected historical estimate:** Zero LOC is authorized. test infrastructure 100–168; tests 0–25
- **Gates and overlaps:** test-harness-consolidation; plugin-public-api; iframe-security; plugin-persistence; http-error-ordering; The findings apply the same canonical-harness pattern to two different plugin services; their files and LOC do not overlap.
- **Historical verification recipe:** Not applicable because the proposal is rejected.
- **Source findings:** T02-04-C1; T02-04-C2

### C07-013 — Delete unused non-sync E2E fixture, page, helper, overlay, and barrel surface

- **Full-review result:** Rank 50/100; controlling focused placements 52/59/49; superseded original ranks 62/25/50. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Ship independent zero-consumer deletions for SideNavPage plus fixture/page-barrel/docs registration, logPluginState/robustClick/robustWaitFor, attachDragGhost/fadeTransition with exclusively owned support code, and generic assertion helpers except expectNoGlobalError plus the unused utils barrel; retain safeIsVisible, ensureGlobalAddTaskBarOpen, showCaption, smoothMouseMove, every consumed video helper, and all sync-specific utilities, while deferring safeIsEnabled alone.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure 325 to 350; tests 0; generated 0; moved 0; safeIsEnabled and excluded overlay helpers receive no LOC credit.
- **Material corrections:** Exact searches confirm SideNavPage/fixture, three plugin helpers, safeIsEnabled, the utils barrel, five assertion helpers, and four exported video helpers have no scenario consumers.; expectNoGlobalError is consumed by both non-sync and sync E2E and must remain; safeIsVisible, ensureGlobalAddTaskBarOpen, wait utilities, and all consumed video choreography must remain.; The canonical 337-358 LOC estimate appears low once the four unused overlay functions and all disjoint zero-consumer surfaces are counted.; PR #8214 is an explicit element-helpers gate even though the available local ref's current diff did not touch that file.; fixture type surface; store-video choreography; sync E2E exclusion; stale barrel/docs; current PR gate; The dead-code evidence is strong, but four unrelated concepts should not be one maintenance change.
- **Primary gate:** Refresh exact consumer searches per independent slice; safeIsEnabled remains excluded until PR #8214 is verified after landing or rebase.
- **Required verification:** Repeat exact symbol/import/fixture-key/barrel searches; Run checkFile on every modified E2E TypeScript file and npm run check; Run representative non-sync plugin/navigation E2E with --retries=0; do not run or modify sync suites for this deletion; exact symbol/import/fixture-key searches per slice; checkFile and E2E TypeScript check; Playwright --list; store-video --list for overlays; do not edit or run sync E2E
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** conflicting.
- **Scope:** `e2e/pages/side-nav.page.ts` — SideNavPage; `e2e/fixtures/test.fixture.ts` — sideNavPage fixture registration; `e2e/helpers/plugin-test.helpers.ts` — logPluginState, robustClick, robustWaitFor; `e2e/store-video/overlays.ts` — unused overlay helpers; `e2e/utils/assertions.ts` — unused assertion helpers; `e2e/utils/element-helpers.ts` — safeIsEnabled; `e2e/utils/index.ts` — unused barrel
- **Why it exists:** E2E infrastructure accumulated fixture/page registrations, generic retries, video overlays, assertions, and a barrel with no scenario consumers, expanding the apparent supported test API.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** Repository-wide exact symbol/import searches found only declarations, registrations, barrels, or stale docs for the targets, while neighboring retained helpers have concrete consumers.
- **Superseded historical estimate:** test infrastructure 337–358
- **Gates and overlaps:** dead-test-infrastructure; playwright-fixture-registration; store-video-choreography-fence; sync-e2e-excluded; All four sources describe disjoint zero-consumer pieces of the non-sync E2E support API; estimates are additive; Classify conflicting/B until PR #8214 lands or is rebased and element-helpers.ts is proven unused again; keep sync E2E paths excluded.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T05-01-C01; T05-01-C02; T05-02-C01; T05-06-C1

### C07-014 — Delete only strict-prefix planner E2E smokes after preserving isolated behaviors

- **Full-review result:** Rank 61/100; controlling focused placements 57/58/67; superseded original ranks 71/59/67. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Use an exact outcome ledger, retain isolated navigation/deep-link/refresh tests, both planner-content tests, and explicit estimate-syntax/route-return tests, and delete only cases whose planner assertion is a strict URL/router-wrapper/task-count prefix; do not create one broad planner journey, treat multiple-day/scheduled behavior as currently untested and characterize real scheduling plus day/slot placement separately if that contract is required, and do not claim or consolidate estimate persistence until the displayed/stored estimate survives reload.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure 15; tests 180 to 185; generated 0; moved 0.
- **Material corrections:** planner-multiple-days and planner-scheduled-tasks create tasks whose titles imply dates/times but never schedule them or assert a planner day/slot.; Most basic/multiple/scheduled outcomes are URL/router-wrapper or task-count checks duplicated by navigation and visibility suites.; The time-estimate suite mostly asserts titles and navigation; it does not directly prove parsed estimate values, and its 'persistence' case does not reload.; planner logical day; task placement; estimate parsing; persistence; task-list rendering; E2E isolation; Straight deletion of strict prefixes is valuable; journey bundling is unnecessary and less diagnosable.
- **Primary gate:** Required scheduled/multiple-day placement and estimate persistence must receive isolated behavior characterizations before deletion is credited as preserving those contracts.
- **Required verification:** Run checkFile on every modified planner E2E spec; Run every retained planner spec with npm run e2e:file <path> -- --retries=0; Use locator/state assertions for task/day/estimate output and no fixed waits; checkFile all modified specs; each retained spec with --retries=0; locator/state assertions, isolated state, no fixed waits
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `e2e/tests/planner/planner-basic.spec.ts` — route-only smoke; `e2e/tests/planner/planner-multiple-days.spec.ts` — route-only smoke; `e2e/tests/planner/planner-navigation.spec.ts` — canonical navigation/deep-link/refresh journey; `e2e/tests/planner/planner-scheduled-tasks.spec.ts` — route-only smoke; `e2e/tests/planner/planner-time-estimates.spec.ts` — time-estimate syntax and persistence journeys; `e2e/tests/planner/planner-task-visibility.spec.ts` — planner content assertions
- **Why it exists:** Six planner files repeatedly drive the same page-object route and URL check; several names promise multiple-day or scheduled-task behavior without asserting planner content.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** The route-only files execute the same page-object path and assert no named domain behavior. Neighboring visibility/estimate suites already carry the real assertions; labels are not treated as coverage.
- **Superseded historical estimate:** test infrastructure 15–33; tests 175–265
- **Gates and overlaps:** e2e-journey-consolidation; planner-logical-day; task-hot-path; persistence; state-isolation; Strengthen a retained behavior journey before deleting any route-only case whose title encodes a still-required scheduled/multiple-day contract.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T05-03-C1

### C07-015 — Consolidate plugin upload and API-test smokes into explicit lifecycle journeys

- **Full-review result:** Rank 58/100; controlling focused placements 56/55/66; superseded original ranks 72/60/66. Safety: narrow; maintainability: narrow; consensus: **narrow**. **Tier:** B. **Status:** open.
- **Authoritative scope:** Use two staged changes: first make SettingsPage upload/enable/disable operations state-based and keep an isolated uploaded-plugin lifecycle covering absent, upload-disabled, enable, reload-persisted, disable, re-enable, remove, and reload-absent; then retain two isolated API-plugin tests for activation/menu/exact-route/iframe-heading/reload persistence and disable/menu-removal/reload/re-enable restoration before deleting strict prefix smokes; keep catalog/install-control, metadata, sandbox/nodeExecution coverage, and plugin-simple-enable reconciliation separate, with the latter excluded from LOC credit.
- **Corrected LOC:** Accepted LOC: production 0; configuration 0; comments 0; test infrastructure -25 to 20; tests 570 to 680; generated 0; moved 0.
- **Material corrections:** The six API Test Plugin files repeat card/enable/menu/route/iframe setup, and plugin-upload reimplements SettingsPage operations.; SettingsPage enable/disable/upload methods use fixed 500/1000 ms waits and return success before asserting the final toggle/card state, so they are not yet safe canonical primitives.; Neither uploaded nor bundled lifecycle currently reloads to prove the persistence contract claimed by the candidate.; Existing iframe smokes do not assert sandbox attributes; sandbox/elevated-permission protection is owned by separate unit/security suites and must not be credited as an E2E outcome.; plugin-simple-enable.spec.ts overlaps the uploaded journey but is outside the listed candidate and contains only a comment, not an assertion, for no-menu behavior.; plugin public API; iframe rendering/security boundary; enabled-state persistence; uploaded-plugin cleanup; E2E state isolation; fixed-wait flakiness; The duplication is real, but two focused lifecycle contracts are maintainable; a single mega-journey is not.
- **Primary gate:** Replace SettingsPage fixed waits and boolean-only success returns with final-state assertions before reuse, while preserving isolated reload, cleanup, exact-route, menu, and iframe checks.
- **Required verification:** Run checkFile on modified plugin E2E specs and SettingsPage; Run each retained plugin journey with npm run e2e:file <path> -- --retries=0; Assert exact route, iframe heading, menu removal/restoration, toggle state, reload persistence, and best-effort cleanup directly; checkFile modified E2E/page objects; each retained journey with --retries=0; assert exact route, iframe heading, switch/menu absence/restoration and cleanup on failure
- **Discovery-era record (superseded):** Open. **Tier:** Preliminary B. **Classification:** net-new.
- **Scope:** `e2e/tests/plugins/plugin-upload.spec.ts` — uploaded-plugin lifecycle; `e2e/tests/plugins/enable-plugin-test.spec.ts` — API Test Plugin smoke; `e2e/tests/plugins/plugin-enable-verify.spec.ts` — API Test Plugin smoke; `e2e/tests/plugins/plugin-iframe.spec.ts` — API Test Plugin iframe smoke; `e2e/tests/plugins/plugin-lifecycle.spec.ts` — API Test Plugin disable lifecycle; `e2e/tests/plugins/plugin-loading.spec.ts` — canonical settings/menu/route/iframe lifecycle; `e2e/tests/plugins/test-plugin-visibility.spec.ts` — API Test Plugin visibility smoke; `e2e/pages/settings.page.ts` — existing plugin settings methods
- **Why it exists:** The upload spec reimplements SettingsPage operations, while six API Test Plugin specs repeat the same card, enable, menu, route, and iframe prefixes across smoke-level assertions.
- **Superseded historical proposal:** Do not implement this broader recipe; follow the authoritative scope above.
- **Superseded historical preservation notes:** Follow the authoritative scope, gate, and verification above.
- **Evidence:** SettingsPage already exposes all repeated upload operations except one-consumer removal, and plugin-loading plus plugin-lifecycle contain the union of six smoke files' distinct outcomes.
- **Superseded historical estimate:** test infrastructure 5–55; tests 670–800
- **Gates and overlaps:** e2e-journey-consolidation; plugin-public-api; iframe-security; plugin-persistence; test-state-isolation; T05-04-C1 covers uploaded-plugin lifecycle reuse; T05-04-C2 covers bundled API Test Plugin smoke collapse. They share SettingsPage conventions but no test LOC.
- **Superseded historical verification recipe:** Follow the required verification above.
- **Source findings:** T05-04-C1; T05-04-C2

## Cross-domain corrections and duplicate resolutions

This section preserves discovery and consolidation decisions. The full-review result under each candidate supersedes any implementation wording below. In particular, C01-013, C04-012, and C07-012 remain canonical slots for deduplication traceability but are now rejected.

### Cross-domain overlap groups

| Group     | Candidates                         | Type                                 | Resolution                                                                                                                                                                                      |
| --------- | ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C08-OV-01 | C01-012, C03-002                   | exact-duplicate                      | Keep C03-002 as the Focus Mode owner; merge all source evidence and do not sum LOC.                                                                                                             |
| C08-OV-02 | C01-013, C02-015                   | same-root-cause-and-primary-files    | Keep only C01-013 as the canonical slot and do not double-count C02-015; the full review rejects the retained extraction as negative-value abstraction.                                         |
| C08-OV-03 | C01-014, C06-013, C06-014          | whole-candidate-with-subsets         | Keep C01-014 as the complete global Sass graph deletion; C06-013 and C06-014 are duplicate subsets.                                                                                             |
| C08-OV-04 | C01-015, C03-007                   | source-and-file-subset               | Keep C03-007 as the GlobalConfigService authority; remove P13-02-C1, its path, and its LOC from C01-015 while retaining that candidate's separate Formly/config cleanup.                        |
| C08-OV-05 | C04-012, C06-012                   | same-provider-build-helper           | Keep only C04-012 as the canonical slot and merge L10-C03 evidence without double-counting; the full review rejects the shared-helper proposal.                                                 |
| C08-OV-06 | C03-012, C05-014                   | same-file-distinct-symbols           | Not duplicates: both change feature-stores.module.ts. If C05-014 clears deferral, land it separately from C03-012 and preserve effect registration and sync/hydration ordering.                 |
| C08-OV-07 | C04-006, C04-009, C04-010, C07-012 | plugin-runtime-and-test-staging      | Not duplicates. C04-006 and C04-009 are deferred, C04-010 is independently actionable, and C07-012 is rejected; do not use this group to revive the rejected test consolidation.                |
| C08-OV-08 | C03-005, C03-006, C07-005          | production-and-test-contract-overlap | Preserve the unique yesterday/logical-today boundary in production-connected tests before pruning separate WorkContextService compatibility members.                                            |
| C08-OV-09 | C02-009, C07-008                   | same-spec-distinct-changes           | Delete the orphan selector/spec slice independently, then rebase the typed-matrix test refactor and preserve exact recurrence case counts.                                                      |
| C08-OV-10 | C04-012, C06-011                   | build-ecosystem-ordering             | Not duplicates: package-local bundle scripts and build-all orchestration are separate. C04-012 is rejected; C06-011 remains independently actionable after its own artifact and PR #8067 gates. |

### Applied canonical corrections

| Correction | Candidates       | Category                | Action                                                                                                                                                                                                 |
| ---------- | ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C08-COR-01 | C01-012, C03-002 | duplicate-count-removal | Mark C01-012 superseded by C03-002 and merge its source evidence without summing LOC.                                                                                                                  |
| C08-COR-02 | C02-015, C01-013 | duplicate-count-removal | Mark C02-015 superseded by C01-013; exclude its speculative calendar-row extension.                                                                                                                    |
| C08-COR-03 | C06-013, C01-014 | duplicate-count-removal | Mark C06-013 superseded by the global Sass candidate C01-014.                                                                                                                                          |
| C08-COR-04 | C06-014, C01-014 | duplicate-count-removal | Mark C06-014 superseded by the global Sass candidate C01-014.                                                                                                                                          |
| C08-COR-05 | C01-015, C03-007 | duplicate-count-removal | Narrow C01-015 by removing P13-02-C1, GlobalConfigService, and its LOC; retain C03-007 as the sole owner of that slice.                                                                                |
| C08-COR-06 | C06-012, C04-012 | duplicate-count-removal | Mark C06-012 superseded by C04-012 and merge L10-C03 evidence without summing the shared-helper estimate.                                                                                              |
| C08-COR-07 | C01-010          | location-precision      | Replace the directory-wide src/app/features location with exact component/template files. Post-consolidation reconciliation corrected the mechanically summed 24 wrappers to 23 unique wrappers.       |
| C08-COR-08 | C01-013          | location-precision      | Replace the broad src/app/features/planner location with the exact proposed planner-local partial path; do not imply every planner file is touched.                                                    |
| C08-COR-09 | C04-012          | location-precision      | Name the exact new provider-build helper file instead of packages/plugin-dev/scripts, preventing a false overlap with build-all.js.                                                                    |
| C08-COR-10 | C01-014          | location-precision      | Enumerate the exact Sass modules/forwards to delete instead of whole extends/mixins directories.                                                                                                       |
| C08-COR-11 | C01-005, C03-010 | current-pr-gate         | PR #8892 leaves no current same-file overlap for C01-005 but still requires exact-symbol revalidation; PR #8437 overlaps C03-010's `tag-edit` file, so that candidate is conflicting/B pending rebase. |
| C08-COR-12 | C01-008          | current-pr-gate         | Classify the batch conflicting/B pending PR #8456 revalidation; split out file-imex styling if new attachment markup revives a selector.                                                               |
| C08-COR-13 | C01-015          | current-pr-gate         | After overlap narrowing, classify conflicting/B until PRs #9092 and #6748 are rebased and the remaining Formly/config targets are re-audited.                                                          |
| C08-COR-14 | C05-011          | current-pr-gate         | Change classification to conflicting and tier to defer because open PR #6748 changes AppDelegate native lifecycle code.                                                                                |
| C08-COR-15 | C07-013          | current-pr-gate         | Classify conflicting/B until PR #8214 lands or is rebased and element-helpers.ts is proven unused again; keep sync E2E paths excluded.                                                                 |

### Post-consolidation documentation reconciliation

| Item       | Candidates       | Resolution                                                                                                                                                                                                                                                 |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOC-REC-01 | C01-010          | L04-C02 already contained `TaskListComponent.trackByFn`; P01-C04 repeated it and added only `TaskComponent.trackByProjectId`. The unique union is 23 wrappers across 22 component units, and the production estimate is corrected from 72–97 to 69–93 LOC. |
| DOC-REC-02 | C01-010, C01-015 | Assign the `icon-input` and `select-project` tracking-wrapper slices exclusively to C01-010. C01-015 retains only its separate Formly/config cleanup and must be re-estimated after its current-PR gates clear.                                            |

### Sampled scope-boundary decisions

| Color | Source                         | Decision                         | Finding                                                       | Discovery guardian result; full review controls                                                                                                                                                     |
| ----- | ------------------------------ | -------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| green | P06-02-C2 / C04-003            | retain                           | Unused calendar-provider selector                             | Exact TS/template/string/public/plugin/native/build searches find only the declaration; deleting it changes no state, action, persistence, or sync contract.                                        |
| green | I03-01-C01 / C04-007           | retain                           | Unused path-based plugin translation loader                   | Dynamic plugin and manifest paths were checked; all live translation loading uses content, so the dead HTTP route can be removed while keeping the public/plugin contract.                          |
| green | T01-05-C01 + L12-C01 / C07-007 | retain                           | Superseded and non-discovered Add Task Bar timezone artifacts | Configured behavior coverage remains elsewhere and the .bak file is never discovered; test deletion is reported separately from production LOC.                                                     |
| amber | I03-02-C1 / C04-010            | retain with revalidation         | Disconnected eager PluginService loader chain                 | High-value dead subsystem, but public/plugin, persistence, security, consent, hooks, native nodeExecution, and open PluginService PRs require a fresh reachability challenge before implementation. |
| amber | P01-C01 + P01-C02 / C01-009    | keep out of preliminary top pool | Task-row stale state and branch                               | The task component is a hot path with many current PRs; large-list change-detection and exact-symbol revalidation are mandatory despite supported evidence.                                         |
| amber | I12-C03 / C05-011              | correct to conflicting/defer     | Empty UIApplicationDelegate stubs                             | Native registration/history proof was initially adequate, but open PR #6748 changes AppDelegate, so current platform behavior must win over baseline zero-body evidence.                            |
| red   | F11-01-R1                      | semantic exclusion               | App-data mock simplification                                  | The apparent fixture is a persisted AppDataComplete envelope consumed by op-log validation/import tests; no non-sync scout may simplify its shape.                                                  |
| red   | F11-01-R3                      | semantic exclusion               | Startup debounce operator                                     | Zero production imports do not override that the operator's complete behavior is sync-start timing through a hard-excluded service.                                                                 |
| red   | scope-manifest hard fence      | hard exclusion                   | src/app/op-log/sync/operation-log-upload.service.ts           | Direct sync/op-log implementation is absent from the eligible and scout manifests; related generic helpers were also semantically fenced.                                                           |

## Consolidation non-selection and routing decisions

The 606 raw leads that were not selected by their original domain consolidator were normalized and grouped into the following decisions. This is not a second global status ledger: some source IDs also support retained candidates because the guardian routed evidence across domains, split a bundled claim, or merged corroborating scans. The canonical candidate catalog above controls final status. Source IDs remain here so each domain decision can be traced back to the scout artifacts if they are still available.

The seven consolidators recorded **136 normalized rejection decisions**. A decision can group several of the 606 raw rejected leads.

### C01 — Frontend UI, shared components, and global styles (4 decisions)

- **F07-01-C1 — superseded:** The raw finding records sibling commit a169bf8ffe4e92a3899c7a878bf2fb2fad996a61 as already implementing the exact Electron clipboard fallback deletion; revalidate that branch instead of creating a duplicate candidate.
- **L04-C01 — superseded:** Open issue #7874 already explicitly tracks redundant standalone:true removal as its own Angular-modernization PR; the 103-file mechanical edit is also less cohesive than the retained top 15.
- **P20-C2 — excluded:** This is a tag-state reducer algorithm change, not a frontend UI/shared-style simplification; because tag state is synced, it also requires the state/sync correctness review intentionally outside C01.
- **F01-C03, F02-01-C02, F03-C03, F04-02-C01, F04-02-C02, F04-03-C01, F04-03-C02, F04-03-C03, F05-02-C01-stale-project-settings-css, F06-mobile-bottom-nav-dead-residue, F06-shortcut-orphaned-ctrl-stream, F07-01-C2, F08-C01-dead-platform-barrel, F08-C02-no-op-ios-browser-detection, F08-C03-obsolete-startup-injections, F09-01-C1, F09-01-C2, F09-01-C3, F09-02-C01, F10-02-C01, F11-01-C1, F11-01-C2, F11-01-C3, F11-02-C01, F11-02-C02, F11-02-C03, F11-03-C1, F11-03-C2, F11-03-C3, F11-04-C01, P01-C03, P03-C01, P03-C02, P03-C03, P04-C01, P04-C02, P05-01-C1, P05-01-C2, P05-01-C3, P05-02-C1, P14-01-C2, P14-01-C3, P20-C1, P20-C3, L04-C03, L08-C03, L08-C04 — lower-ranked:** These are supported, in-domain cleanups, but rank below the retained 15 on concept removal, production reduction, cohesion, validation readiness, or risk-adjusted value. Several are one-to-three-line wrappers/comment cleanup, duplicate styling that would add almost as much mixin surface as it removes, or already represented at a stronger subsystem root. Issue #7874 already tracks the share-target and time-left-helper themes, so they should not displace net-new higher-value candidates here.

### C02 — Tasks, planner, schedule, repeat, time, and counters (44 decisions)

- **P02-01-C1 — lower-ranked:** Useful formatter deduplication, but lower deletion value and same-component churn from open PRs #8515 and #8437 place it below the domain cutoff.
- **P02-01-C2 — lower-ranked:** Baseline searches support the style cleanup, but visual proof and active add-task-bar PR churn make it less certain than the retained dead schedule UI slices.
- **P02-01-C3 — lower-ranked:** The string registry is removable, but characterization for eight menu paths plus open add-task-bar work lowers its priority.
- **P02-02-C1 — superseded:** Open PR #9014 already extracts the project matcher/build-result policy while extending the same function for sections; do not count a parallel refactor.
- **P02-02-C2 — lower-ranked:** Open PR #6511 rewrites the same URL attachment/removal paths; reconsider normalization only after that behavior-heavy branch resolves.
- **P02-02-C3 — lower-ranked:** Valid redundant cache deletion, but only 5-6 lines and the shared file is under active PR #9014 churn.
- **P15-C2 — lower-ranked:** The selector prefilter duplication is real, but recurrence eligibility is DST/deleted-instance sensitive and adjacent broader work is already tracked in #7913.
- **P16-01-C1 — lower-ranked:** Identical branches are safe to collapse, but the schedule dialog is concurrently modified by PRs #8413 and #7246 and the saving is modest.
- **P16-01-C2 — superseded:** PR #8927 deliberately replaces the loop with shared getVisibleDaySequence while retaining optional includedWeekDays; deleting that concept in parallel conflicts with the open direction.
- **P16-01-C3 — lower-ranked:** Accurate type unification but only five production lines and no runtime simplification.
- **P17-C3 — lower-ranked:** Promise-owned Chart.js registration is sound, but rejected-promise and registration timing need new tests and yield less value than retained metric candidates.
- **P18-01-C1 — lower-ranked:** Strong dead-control evidence, but open PR #8191 actively changes SimpleCounterButton behavior and must settle before pruning its fields/styles.
- **P18-01-C2 — lower-ranked:** Required-input alignment is small and touches the same component under PR #8191.
- **P18-01-C3 — lower-ranked:** Orphaned board API remnants are supported but are peripheral to this domain and only eight lines.
- **P18-02-C1 — lower-ranked:** Large dead legacy config stream, but PR #8191 changes SimpleCounterService and the deleted utility ownership overlaps another raw candidate; re-evaluate after rebase.
- **P18-02-C2 — lower-ranked:** Zero-consumer service facades are removable, but rank below clearer Tier-A deletions and share the service under PR #8191.
- **P18-02-C3 — lower-ranked:** Four orphaned selector exports are supported but save only five production lines.
- **P21-C2 — excluded:** Worklog presentation scaffolding is more naturally owned by C03; it is mapped here to prevent double-counting.
- **P21-C3 — excluded:** Worklog export lifecycle cleanup is routed to C03 and has lower value than the retained C02 time-tracking deletion.
- **P22-C3 — lower-ranked:** One-pass preview computation is independent of #8843's atomic-write quick win, but archive persistence risk and lower score put it below the cutoff.
- **P25-01-C1 — lower-ranked:** Single panel-open authority is valuable but cross-cuts shared panel UI and task customizer code under active PRs, with higher behavioral surface than retained candidates.
- **P25-01-C2 — lower-ranked:** Copied imports/state can be pruned, but PRs #8502 and #8134 actively change the same customizer component.
- **P25-01-C3 — lower-ranked:** One-shot subscription inlining is modest and the service is actively modified by PRs #8502, #8437, and #8134.
- **P25-02-C1 — lower-ranked:** Five persistence effects share policy, but consolidating them is config-persistence behavior rather than dead-code deletion and WorkView has substantial open-PR churn.
- **P25-02-C2 — lower-ranked:** The permanently true flag is dead but saves only four lines and is in an actively modified hot view.
- **P25-02-C3 — lower-ranked:** Short-circuit predicates reduce traversal code, but parent/subtask semantics are under large open task PRs #8038 and #7146.
- **P26-C1 — lower-ranked:** The cancellation loops duplicate behavior, but mobile notification effects are side-effectful and PR #8214 changes the same file.
- **L02-C01 — excluded:** Wallpaper/Formly configuration belongs to frontend/theme consolidation, not C02.
- **L02-C02 — excluded:** The shared parser spans PluginBridge and untrusted plugin task creation; C04 is the safer canonical owner.
- **L02-C03 — excluded:** Issue-provider completion effects belong to C04 and carry LOCAL_ACTIONS/external-side-effect risk.
- **L06-C01 — excluded:** Cross-feature commented effect implementations are owned by project/task state consolidation outside this domain cutoff.
- **L06-C02 — excluded:** Layout reducer syntax belongs to shared frontend/app-shell consolidation.
- **L06-C03 — excluded:** The candidate spans 21 effects across work-context, counters, projects, tags, and issue providers; it is cross-domain and mostly type annotation churn.
- **L06-C04 — excluded:** ProjectEffects ofType cleanup belongs to C03 project consolidation.
- **L06-C05 — lower-ranked:** The never-dispatched layout action relates to the customizer but saves little and is better reconciled with shared layout ownership.
- **L11-C01 — excluded:** WorkContextService/history legacy mirror belongs to C03's work-context consolidation.
- **L11-C02 — excluded:** The empty WorkContextService API and sketches belong to C03.
- **L11-C03 — lower-ranked:** Short-syntax comments/debug residue is valid but lower value and the file is actively changed by PRs #9014 and #6511.
- **L11-C04 — excluded:** Forced-theme/import-timer experiments belong to theme/shared-utility consolidation.
- **L12-C01 — excluded:** The tracked .bak timezone spec is test-only and belongs to C07.
- **L12-C02 — excluded:** Translation cleanup tooling and documentation belong to build/tools C06.
- **L12-C03 — excluded:** The commented Snap workflow belongs to CI/config C06.
- **L12-C04 — excluded:** Focus-mode compatibility migration belongs to C03.
- **L12-C05 — excluded:** Windows Store packaging script/workflow belongs to C06.

### C03 — Projects, tags, notes, focus, settings, worklog, and shared utilities (13 decisions)

- **P19-01-C2, P19-01-C3, P19-02-C2 — lower-ranked:** Valid small project/work-context wrapper and reduce/some simplifications, but each removes fewer concepts than the retained service/dialog candidates and falls below the 15-item cutoff.
- **P20-C2 — lower-ranked:** The sparse tag-order reconstruction rewrite is supported but reads potentially divergent synchronized state; its modest gain and boundary risk rank below the pure facade/UI deletions. No reducer, op-log, or sync implementation change is approved here.
- **P21-C1, P21-C3 — lower-ranked:** Supported time-tracking/worklog cleanup, but smaller or lifecycle-adjacent compared with the retained coherent worklog presentation residue.
- **P24-C3 — lower-ranked:** The unused profile storage helper is valid dead code, but the empty effects class and larger NoteComponent residue remove more domain concepts.
- **P25-01-C2, P25-01-C3, P25-02-C1, P25-02-C2, P25-02-C3 — lower-ranked:** Supported customizer/settings cleanups remain independently shippable, but copied imports, one-shot subscriptions, persistence-effect folding, a constant flag, and predicate spelling provide less leverage than the retained single-authority panel change.
- **P27-002, P27-003 — lower-ranked:** The one-use before-finish model and one-field UI helper are supported but narrower than deleting the entire orphan Markdown checklist concept.
- **P13-01-C1, P13-01-C2, P13-02-C2 — lower-ranked:** Typed sound options, shared validator callback, and stale Formly boilerplate are reasonable local deduplication, but do not match the concept or reactive-node reduction of C03-007.
- **F10-01-C01, F10-01-C02, F10-01-C03, F10-02-C01, F10-02-C02 — lower-ranked:** All five stale style/search-field findings are supported, but they are page/app-shell residue with lower C03 domain leverage than the retained project/tag/note/focus candidates.
- **F11-01-C2, F11-01-C3, F11-02-C01, F11-02-C02, F11-02-C03, F11-03-C1, F11-03-C2, F11-03-C3, F11-04-C01 — lower-ranked:** These shared-utility cleanups are supported, but the cutoff retains the keyboard-layout candidate because it removes the only duplicate platform implementation. The roundDuration removal and roundTime consolidation should be reconsidered together to avoid competing edits.
- **L03-C01, L03-C02, L03-C04 — excluded:** Primary ownership lies outside C03: plugin cleanup belongs to C04, the imex mirror to its owning app/tool domain, and chart-loader promise cleanup to the task/time UI domain.
- **L05-C02, L05-C03, L05-C04 — excluded:** These lifecycle findings primarily target Unsplash/shared UI/task-select/issue/plugin panels owned by C01, C02, or C04 rather than this domain.
- **L11-C03, L11-C04 — excluded:** Short-syntax parser/debug comments belong to C02; global theme experiments belong to C01.
- **L12-C01, L12-C02, L12-C03, L12-C05 — excluded:** The tracked backup spec belongs to C07, while translation, Snap workflow, and Windows Store script debris belongs to C06.

### C04 — Issue providers, plugins, and plugin API/runtime (45 decisions)

- **P06-01-C2 — lower-ranked:** Copied setup-tab styles are supported but save only a small local CSS fragment and carry visual risk; lower value than the retained unreachable intro unit.
- **P07-C2 — lower-ranked:** Flattening the Jira enabled-state wrapper is a small readability cleanup near active provider behavior and ranks below the callerless auth deletion.
- **P07-C3 — lower-ranked:** Jira mapping consolidation is behavior-sensitive across issue/worklog payloads and offers less certain leverage than the retained local provider candidates.
- **P08-C2 — lower-ranked:** OpenProject config scaffolding cleanup is supported but smaller and more churn-prone than deleting the Redmine mini-language.
- **P09-C1 — lower-ranked:** The Nextcloud board subject cleanup is a small provider-local state simplification with lower savings.
- **P09-C2 — lower-ranked:** Dead GitLab styling is supported but is a tiny presentation deletion below the domain cutoff.
- **P09-C3 — lower-ranked:** GitLab comment-path simplification touches remote issue semantics and has lower confidence/value than retained candidates.
- **P10-C1 — lower-ranked:** The legacy CalDAV enabled branch is small and adjacent to evolving calendar-plugin/provider work.
- **P10-C2 — lower-ranked:** The unused poll-delay declaration is a trivial deletion below the 15-candidate cutoff.
- **I01-dead-local-plugin-type-reexports — lower-ranked:** Local type re-export pruning is supported but low-value and close to a public/plugin type boundary.
- **I01-unused-clear-all-hooks — lower-ranked:** Unused clear-all hook pruning is smaller than the retained runtime deletions and would need the same lifecycle caution.
- **I01-standardize-dialog-observable-promise — lower-ranked:** Standardizing dialog return shapes would change an adapter/public async interface; it is not a minimal dead-code simplification.
- **I02-C02 — lower-ranked:** Permission-description normalization is small and security-sensitive; existing wording/consent behavior should remain stable.
- **I02-C03 — lower-ranked:** Permission-helper consolidation is supported but touches the trust boundary and ranks below provable dead runtime paths.
- **I03-02-C3 — lower-ranked:** The plugin language helper is a small consolidation and provides less leverage than the retained loader/state deletions.
- **I04-C01 — lower-ranked:** The impossible copy false branch is supported but belongs primarily to build/file tooling and is smaller than retained C04 work.
- **I04-C02 — lower-ranked:** Replacing recursive copy code is tooling-focused and lower-ranked here; any platform filesystem behavior requires separate C06 treatment.
- **I05-01-C01 — lower-ranked:** Prompt script cleanup is AI-plugin-local and lower-value than retained plugin runtime candidates.
- **I05-01-C02 — lower-ranked:** AI date-helper consolidation is behavior-sensitive and outside the core provider/runtime simplification cutoff.
- **I05-01-C03 — lower-ranked:** Automation cache/action cleanup needs stronger behavioral characterization and ranks below proven dead code.
- **I06-C1 — lower-ranked:** Unused TipTap dependency pruning is principally a dependency/build candidate for C06, not a C04 runtime candidate.
- **I07-C02 — lower-ranked:** tsconfig base consolidation is build configuration owned by C06 and below this domain cutoff.
- **I08-02-C02 — lower-ranked:** Build descriptor field cleanup is small and configuration-focused.
- **I08-02-C03 — lower-ranked:** Build-and-copy workflow consolidation is supported but broader tooling work belongs with C06 and ranks below the exact provider-script merge.
- **L02-C01 — excluded:** Theme helper consolidation is a frontend/shared-style concern outside C04.
- **L02-C02 — lower-ranked:** Short-syntax plugin/provider consolidation touches the evolving bridge and public surface; lower-ranked under current open plugin work.
- **L02-C03 — lower-ranked:** Provider completion-effect resolution is smaller and must preserve LOCAL_ACTIONS and replay fences; no sync-state implementation is admitted here.
- **L02-C04 — excluded:** Planner style cleanup belongs to the task/planner UI domain, not C04.
- **L03-C02 — excluded:** Import/export mirror cleanup touches persistence and sync/import boundaries excluded from this domain.
- **L03-C03 — excluded:** Panel consolidation is a shared frontend UI concern outside C04.
- **L03-C04 — excluded:** Chart loading consolidation belongs to another feature domain.
- **L03-C05 — excluded:** Focus-mode consolidation belongs to C03.
- **L09-C01 — lower-ranked:** Standardizing firstValueFrom wrappers is a broad async-style refactor with little net simplification and potential error-timing drift.
- **L09-C02 — lower-ranked:** Adapter config/HTTP resolution directly overlaps open PR #8865's token scoping and bridge changes; defer rather than competing with active OAuth work.
- **L09-C03 — lower-ranked:** URL stripping is a small provider utility consolidation with user-data parsing risk.
- **L09-C04 — lower-ranked:** Issue-service comment consolidation changes remote comment/error behavior and ranks below dead-code candidates.
- **L11-C01 — excluded:** Work-context selector cleanup belongs to C03/C02, not provider/plugin runtime.
- **L11-C02 — excluded:** Work-context service consolidation belongs to C03/C02.
- **L11-C03 — lower-ranked:** Short-syntax cleanup crosses plugin/public bridge behavior and is lower-ranked under active plugin PRs.
- **L11-C04 — excluded:** Theme consolidation belongs to shared frontend styling.
- **L12-C01 — excluded:** A test backup artifact is owned by the tests/E2E domain C07.
- **L12-C02 — excluded:** Tooling duplication belongs to C06.
- **L12-C03 — excluded:** Workflow duplication belongs to C06.
- **L12-C04 — excluded:** Focus-mode duplication belongs to C03.
- **L12-C05 — excluded:** Windows build-script duplication belongs to C06/native tooling.

### C05 — Electron, native, and platform (7 decisions)

- **I11-01-C2, I11-03-C01 — excluded:** Tracked IDE metadata and a global Gradle repository are build/developer configuration owned by C06, not runtime native/platform behavior.
- **F09-01-C1, F09-01-C2, F09-01-C3, F09-02-C01 — excluded:** These core/UI findings explicitly do not cross IPC or native contracts: dead clipboard-to-attachment code, an in-memory banner compatibility method, snackbar control flow, and an Unsplash UI pass-through belong to frontend/shared-utility/plugin consolidation rather than C05.
- **L11-C01, L11-C02, L11-C04 — excluded:** Work-context reactive state and theme/import comment cleanup are C03 frontend/domain concerns. GlobalThemeService contains platform code, but L11-C04 deliberately touches only unrelated commented experiments and must not broaden into native platform work.
- **L11-C03 — excluded:** Short-syntax due/debug commented scaffolding belongs to C02 task/schedule parsing and is excluded from platform consolidation.
- **L12-C01 — excluded:** The tracked .bak timezone spec is test-only and belongs to C07.
- **L12-C02, L12-C03, L12-C05 — excluded:** The one-shot translation tool, commented Snap pipeline, and broken Windows Store script are build/tooling/release configuration owned by C06, even where they name a platform.
- **L12-C04 — excluded:** Focus-mode compatibility aliases belong to C03. The live Electron currentSessionTime$ consumer is explicitly preserved and does not make the alias cleanup platform-owned.

### C06 — Build, tools, dependencies, CI, and configuration (12 decisions)

- **I13-01-C03 — lower-ranked:** Bare workflow_dispatch is schema-equivalent today, but the nine-file churn offers little concept reduction and build-ios is expected to gain real dispatch inputs, artifact routing, secrets, and concurrency under the TestFlight plan; preserve active platform workflow work instead.
- **I13-02-C01, I13-02-C03 — lower-ranked:** The commented Glass overrides and speculative Arc light block are supported inert cleanup, but rank below removal of active zero-use Rainbow tokens and build-graph concepts.
- **I13-03-C02, I13-03-C03 — lower-ranked:** Seven unused Liquid Glass tokens and a zero-byte Hammer placeholder are valid, but provide less reduction than the retained theme/Sass candidates.
- **I04-C01, I04-C02 — lower-ranked:** Both build-plugin copy simplifications are supported, but the first saves eight lines and the second changes a public Vite-plugin copy primitive with symlink/overlay characterization costs; they fall below the 15-item cutoff.
- **F12-01-C01, F12-01-C02, F12-01-C03 — lower-ranked:** The orphan fab stylesheet, unused placeholder bundle, and mention override consolidation remain viable. They rank below the larger unwired Sass modules; mention consolidation also crosses component/test ownership and requires cascade characterization.
- **F12-02-C3 — lower-ranked:** Eleven global utility selectors have no known DOM consumer, but global/dynamic class surface uncertainty makes this less certain than zero-import Sass modules and private theme tokens.
- **L01-C03 — lower-ranked:** The broken pre-Material-Symbols generator is a supported ten-line dead tool, but its concept/LOC value falls below the retained tooling candidates.
- **L10-C01 — refuted:** Manifest-derived discovery would change plugin-test matrix membership by adding two currently omitted suites. That may be a worthwhile CI feature, but it is not behavior-preserving simplification and is excluded under the explicit matrix-preservation constraint.
- **L10-C05 — lower-ranked:** The duplicate electronBuilderOnly npm alias has no tracked caller, but a one-line saving does not outweigh unobservable external maintainer CLI usage.
- **L12-C01 — excluded:** The tracked backup timezone spec is test-only and belongs to C07; deletion must not be represented as active coverage removal or production simplification.
- **L12-C04 — excluded:** Focus-mode compatibility belongs to C03 and was canonicalized there; it is outside C06 build/tooling ownership.
- **L12-C05 — lower-ranked:** The broken one-line Windows Store alias is distinct from the live workflow, but undocumented external maintainer usage cannot be disproved and the saving is negligible.

### C07 — Tests and non-sync E2E (11 decisions)

- **T01-01-C2, T02-01-C2 — lower-ranked:** CalendarIntegrationService TestBed reconstruction and the Google HTTP mock factory are supported, but open PR #8865 changes both provider assumptions and the exact Google spec. Rebase and re-evaluate after that PR rather than refactoring a moving harness in the top 15.
- **T01-03-C3 — conflicting:** The first-occurrence matrix is mechanically valid, but open issue #7355 proposes changing its anchoring contract and caller expectations. Do not encode the baseline matrix more deeply until the behavior decision lands.
- **T03-01-C03 — lower-ranked:** DateTimeFormat tables are sound, but open PR #8598 is actively changing locale-aware scheduling tests and consumes current date/time formatting assumptions; this local readability refactor can wait and be rebased.
- **T05-03-C2 — conflicting:** The Flowtime countdown journey is duplicative, but open PR #7745 changes Flowtime break behavior and focus-mode specs. Preserve current regression coverage until that feature work resolves, then reassess the exact journey.
- **T01-02-C3, T01-05-C02, T01-06-C02, T01-06-C03, T01-07-C01, T02-02-C1, T03-04-C01, T03-12-C1, T04-01-C01, T05-02-C02 — lower-ranked:** These are supported false-coverage, exact-duplicate, inert-comment, template-test, or redundant-smoke deletions, but each removes a smaller or less misleading concept than C07-001 through C07-007. Keep them in the backlog as independent deletions; do not bundle them merely to inflate test LOC savings.
- **T01-01-C3, T01-05-C03, T01-07-C02, T01-07-C03, T01-08-C02, T01-08-C03 — lower-ranked:** The task/calendar boundary tables and parser/task fixture factories preserve case coverage, but they are narrower readability wins than the shortlisted production-reconnection, recurrence, iCalendar, and DST fixture work.
- **T02-01-C1, T02-01-C3, T02-02-C2, T02-02-C3, T02-03-C1, T02-03-C2, T02-03-C3, T02-04-C3 — lower-ranked:** These provider/plugin fixture factories, registry defaults, bridge harness consolidation, and date-format tables are supported. C07-012 ranks higher because it removes two complete duplicate harness files while preserving security/error paths; these should remain separate follow-ups.
- **T03-01-C01, T03-01-C02, T03-02-C01, T03-02-C02, T03-02-C03, T03-03-C01, T03-03-C02, T03-03-C03, T03-04-C02, T03-04-C03 — lower-ranked:** These core/config/focus table and fixture refactors keep all behavior, but offer smaller local readability gains. Default-start-page cases span guard and pure utility layers and must not be collapsed across those distinct responsibilities.
- **T03-05-C1, T03-05-C2, T03-05-C3, T03-06-C1, T03-06-C3, T03-07-C1, T03-07-C2, T03-07-C3, T03-08-C3 — lower-ranked:** These focus, metric, reminder, task-view, tracking, tag-list, and privacy-export fixtures are supported but lower-ranked. Their async settling, worker-call, hot-path rendering, and sensitive-field fences require separate focused PRs and must not be generalized into a shared cross-feature test abstraction.
- **T03-09-C1, T03-09-C2, T03-09-C3, T03-10-C1, T03-10-C2, T03-10-C3, T03-11-C1, T03-11-C2, T03-11-C3, T03-12-C2, T03-12-C3, T04-01-C02, T04-01-C03, T04-02-C01 — lower-ranked:** These UI/util/Electron/tooling case-table and DOM-fixture refactors are valid, deterministic local cleanups, but none removes false coverage or a full harness/journey concept. Keep each table scoped to its file and retain platform/security edge cases if implemented later.
- **T05-01-C03, T05-02-C03, T05-03-C3, T05-04-C3, T05-05-C1, T05-05-C3 — lower-ranked:** The runner-default extraction, regression diagnostic cleanup, Pomodoro pattern, deadline helper, settings journeys, and scheduled-list journey are supported non-sync E2E improvements. They rank below C07-014/C07-015 and must preserve store-video timing, exact eight-session boundaries, reminder arming/rollover, navigation outcomes, state isolation, and --retries=0 when implemented independently.

## Deduplication and architecture references

These references were used during consolidation to distinguish net-new work, existing plans, conflicts, and load-bearing boundaries. GitHub state must be refreshed before implementation.

### GitHub issues and pull requests

| Reference                                                                           | Domains            | Relationship to backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [pr #5396](https://github.com/super-productivity/super-productivity/pull/5396)      | C01                | Merged control-flow migration that left the wrapper-style @for tracking helpers targeted by C01-010.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [pr #6511](https://github.com/super-productivity/super-productivity/pull/6511)      | C02                | Open URL-parsing PR rewrites the URL attachment/removal area targeted by P02-02-C2; the simplification must be reconsidered against that branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [pr #6748](https://github.com/super-productivity/super-productivity/pull/6748)      | C08                | Open older iOS widget branch changes AppDelegate and several config/component targets; C05-011 cannot remain implementation-ready without revalidation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [issue #7355](https://github.com/super-productivity/super-productivity/issues/7355) | C07                | Conflicts with a baseline-only rewrite of getFirstRepeatOccurrence tests because the issue proposes changing the documented anchoring contract; T01-03-C3 is deferred rather than table-driving assumptions that may soon change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [pr #7376](https://github.com/super-productivity/super-productivity/pull/7376)      | C01                | Recent merged mentions substring-ranking behavior that C01-001 must preserve.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [pr #7504](https://github.com/super-productivity/super-productivity/pull/7504)      | C01                | Recent merged mentions contrast fix and regression coverage that C01-001 must preserve while relocating duplicate styles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [pr #7745](https://github.com/super-productivity/super-productivity/pull/7745)      | C07                | Changes Flowtime break behavior and focus-mode specs, so the lower-ranked Flowtime E2E consolidation T05-03-C2 must wait for the intended behavior to settle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [pr #7808](https://github.com/super-productivity/super-productivity/pull/7808)      | C04                | Open Jira worklog/effects PR changes nearby Jira behavior. The wonky-cookie deletion is limited to a callerless legacy auth branch and preserves all live request/effect paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [issue #7873](https://github.com/super-productivity/super-productivity/issues/7873) | C07                | Owns SuperSync/WebDAV E2E maintenance. Those paths and their serial/timing semantics remain excluded from C07; only non-sync Playwright findings are ranked here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [issue #7874](https://github.com/super-productivity/super-productivity/issues/7874) | C01, C05           | Open code-quality backlog independently tracks redundant standalone metadata, dual Observable/Signal APIs, time-left helpers, share targets, and animation-export cleanup; Open code-quality backlog independently records unconditional ElectronEffects registration and empty iOS AppDelegate callbacks; it also lists larger platform candidates that are intentionally not folded into these small changes.                                                                                                                                                                                                                                                                                                               |
| [issue #7913](https://github.com/super-productivity/super-productivity/issues/7913) | C02                | Open recurrence-engine consolidation issue confirms broader repeat-code duplication but is higher-risk and distinct from the retained orphan-selector deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [issue #7915](https://github.com/super-productivity/super-productivity/issues/7915) | C02                | Tracking issue closed by PR #8927 for logical-day bucketing and visible-day generation; used to avoid double-counting that work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [pr #8067](https://github.com/super-productivity/super-productivity/pull/8067)      | C04, C06, C08      | Open Markdown Notes plugin PR changes PluginService, the bridge, build-all tooling, and synced plugin data. PluginService candidates require a rebase and must preserve its public/persistence additions; Open Markdown-notes plugin PR adds a special build entry to packages/plugin-dev/scripts/build-all.js. C06-011 is classified conflicting and must preserve that allowlisted special entry after rebase; Open Markdown Notes plugin work changes PluginService tests and build-all orchestration; plugin runtime/test/build candidates must be sequenced around it.                                                                                                                                                   |
| [pr #8160](https://github.com/super-productivity/super-productivity/pull/8160)      | C04                | Open Forgejo provider PR changes issue-provider setup surfaces, so the hidden intro deletion requires a post-rebase static and render check but remains behaviorally separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [pr #8191](https://github.com/super-productivity/super-productivity/pull/8191)      | C02                | Open audio-feedback work touches SimpleCounterButton and SimpleCounterService, lowering the rank of the P18 cleanup set until rebased.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [issue #8209](https://github.com/super-productivity/super-productivity/issues/8209) | C04                | Open plugin sandbox issue confirms that plugin execution and permissions are security-sensitive; no retained viable candidate weakens execution, consent, or bridge boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [pr #8214](https://github.com/super-productivity/super-productivity/pull/8214)      | C08                | Open subtask-mode work changes an E2E helper listed by C07-013, requiring a fresh zero-consumer check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [issue #8226](https://github.com/super-productivity/super-productivity/issues/8226) | C04                | The background-plugin sandbox design explicitly proposes reusing PluginCleanupService for lifecycle management, so C04-006 is classified conflicting and deferred despite current inertness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [issue #8260](https://github.com/super-productivity/super-productivity/issues/8260) | C01, C06, C07      | Open dead-code and consolidation umbrella; adjacent Tier A UI removals landed in PRs #8889 and #8892, but it does not enumerate most retained C01 targets; Open broad dead-code issue explicitly treats tools and plugin-dev paths as knip false positives unless independently proven. C06 retains only tool deletions with direct history, entry-point, and replacement-path evidence; it does not claim the issue's unrelated source findings; Independently establishes the repository-wide dead-code/consolidation campaign, but does not enumerate C07's false-coverage specs or non-sync journey reductions; no finding is classified as already implemented from this umbrella alone.                                 |
| [issue #8299](https://github.com/super-productivity/super-productivity/issues/8299) | C03                | Open broader task/work-context/project/tag decoupling plan confirms WorkContextService debt but does not supersede the two narrow dead-surface cleanups C03-005 and C03-006.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [pr #8369](https://github.com/super-productivity/super-productivity/pull/8369)      | C07                | Adds future-day reminder rollover E2E coverage. Reminder helpers and journeys must preserve its real-clock/day-rollover boundary; its WebDAV changes remain outside C07.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [pr #8437](https://github.com/super-productivity/super-productivity/pull/8437)      | C08                | Open tag-order work changes tag-edit code included in C03-010.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [pr #8456](https://github.com/super-productivity/super-productivity/pull/8456)      | C08                | Open import/export attachment work changes file-imex component styling inside C01-008, so that batch must be revalidated and split if necessary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [issue #8476](https://github.com/super-productivity/super-productivity/issues/8476) | C04                | Open Plainspace integration discussion illustrates the unresolved built-in-provider versus plugin decision; provider candidates remain implementation-local.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [issue #8736](https://github.com/super-productivity/super-productivity/issues/8736) | C04                | Open plugin compatibility issue covers minSupVersion and DTO validation; retained dead-code and build-script candidates do not change manifests, DTOs, or version gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [issue #8832](https://github.com/super-productivity/super-productivity/issues/8832) | C05                | Open security issue for the dual Android runtime and remote WebView bridge. C05 candidates must not weaken origin, bridge, credential, database, or MODE_ONLINE fences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [issue #8833](https://github.com/super-productivity/super-productivity/issues/8833) | C02                | Open architecture finding covers scheduling sources of truth; none of the retained schedule-view cleanups changes those state invariants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [issue #8835](https://github.com/super-productivity/super-productivity/issues/8835) | C06                | Open Material M2/runtime-theming migration issue defines the live theme contract. C06-013 through C06-015 remove only unwired or unreferenced Sass/theme internals and deliberately do not attempt that migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [issue #8836](https://github.com/super-productivity/super-productivity/issues/8836) | C03                | Open app-wide dependency-direction issue corroborates the architectural pressure around work-context and feature facades; none of the C03 candidates attempts its broader boundary redesign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [issue #8837](https://github.com/super-productivity/super-productivity/issues/8837) | C04                | Open provider-to-plugin migration issue confirms the strategic boundary: retained provider-local cleanups must not redesign provider contracts or pre-empt the migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [issue #8841](https://github.com/super-productivity/super-productivity/issues/8841) | C05                | Open platform-capability adoption issue independently confirms predicate drift and scattered Electron/native routing; C05-012 is a narrowly behavior-equivalent cleanup, not the issue's larger facade migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [issue #8842](https://github.com/super-productivity/super-productivity/issues/8842) | C04                | Open credential-migration issue reserves local credential keys; all retained candidates leave OAuth secrets, MIGRATED_KEYS, persistence keys, and sync exclusion unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [issue #8843](https://github.com/super-productivity/super-productivity/issues/8843) | C01, C02, C03, C06 | Open architecture quick-wins issue establishes the task-row signal hot-path caution; adjacent to, but not duplicative of, C01-009; Open quick-wins issue touches archive-compression persistence in the same file as P22-C3 but proposes a different atomic-write correction; Open architecture-review quick win independently confirms that the plain isTodayList mirror is unsafe beside the signal path; C03-006 keeps the reactive contract and removes the legacy mirror; Open architecture quick-wins issue independently emphasizes dead dependency configuration and SHA-pinned workflows. The C06 dependency/workflow candidates are adjacent but target different exact declarations, so none is marked superseded. |
| [pr #8865](https://github.com/super-productivity/super-productivity/pull/8865)      | C04, C07           | Open multiple-Google-calendar-accounts PR changes the plugin adapter, bridge, OAuth token scoping, and cleanup. OAuth/adapter findings are lower-ranked and retained candidates do not touch these contracts; Actively changes Google Calendar provider tests and CalendarIntegrationService provider assumptions. T01-01-C2 and T02-01-C2 are therefore not shortlisted until rebased on that work.                                                                                                                                                                                                                                                                                                                          |
| [pr #8889](https://github.com/super-productivity/super-productivity/pull/8889)      | C01                | Merged after the audit baseline and removes other dead UI/tree-dnd files; refresh C01-004 paths against current master before implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [pr #8892](https://github.com/super-productivity/super-productivity/pull/8892)      | C01                | Merged after the audit baseline and removes four different dead animation files, independently validating the cleanup pattern used by C01-005.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [pr #8927](https://github.com/super-productivity/super-productivity/pull/8927)      | C02                | Open refactor directly replaces PlannerService visible-day generation and therefore supersedes/conflicts with P16-01-C2; it also creates same-file rebase risk for P11-C2 but does not remove hasEventsForDay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [pr #8928](https://github.com/super-productivity/super-productivity/pull/8928)      | C03                | Merged config-boilerplate cleanup predates and is contained in the baseline; its file set does not touch GlobalConfigService, so it neither supersedes nor conflicts with C03-007.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [pr #8950](https://github.com/super-productivity/super-productivity/pull/8950)      | C05, C06, C08      | Open iOS WidgetKit port changes project.pbxproj and deliberately follows the Swift-plus-Objective-C Capacitor plugin pattern, so C05-009 is conflicting/deferred pending rebase and native registration proof; Open iOS-widget PR edits build-ios.yml and package.json. It reinforces rejecting the nine-workflow dispatch normalization as low-value churn while active platform workflow work is in flight; Open iOS widget work confirms native project-file and feature-store churn and the C05 native defer fences.                                                                                                                                                                                                      |
| [pr #8982](https://github.com/super-productivity/super-productivity/pull/8982)      | C03, C08           | Open crash-safe project-note drafts PR modifies NoteComponent and adds its first focused spec without removing the stale inline-editor lifecycle members. C03-013 remains valid but is classified conflicting and must be rebased/re-audited after that PR; Open note-draft work confirms C03-013 is correctly conflicting.                                                                                                                                                                                                                                                                                                                                                                                                   |
| [pr #9014](https://github.com/super-productivity/super-productivity/pull/9014)      | C02                | Open short-syntax sections PR extracts the project-prefix matcher and build-result helper, materially superseding P02-02-C1 and creating churn for other short-syntax findings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [pr #9058](https://github.com/super-productivity/super-productivity/pull/9058)      | C02                | Open single-day schedule view changes ScheduleComponent HTML/SCSS; P12-02-C2 remains ranked only with a post-rebase usage and visual check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [issue #9069](https://github.com/super-productivity/super-productivity/issues/9069) | C07                | Confirms that retries=0 is a deliberate determinism policy and that gesture/assertion timing must be fixed rather than hidden. Every C07 E2E consolidation retains retries=0 and state-based readiness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [pr #9077](https://github.com/super-productivity/super-productivity/pull/9077)      | C04, C06, C08      | Open plugin SVG-sanitization PR modifies PluginService and its tests. C04-009/C04-010 must rebase while preserving its sanitization helper, dedicated icon registry, and security assertions; Open SVG-sanitization hardening PR changes root package.json and package-lock.json. C06-005 and C06-008 remain valid but are classified conflicting because their dependency/lockfile edits must be regenerated after this security change; Open plugin SVG hardening changes PluginService, its tests, package.json, and package-lock.json; existing C04/C06 conflict gates remain valid.                                                                                                                                      |
| [pr #9092](https://github.com/super-productivity/super-productivity/pull/9092)      | C08                | Open Formly fix changes a C01-015 target and requires that bundled candidate to be narrowed and revalidated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Repository plans and architectural references

| Path                                                                                                                                                    | Domains                      | Relationship to backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARCHITECTURE-DECISIONS.md`                                                                                                                             | C01, C03, C05, C07, C08      | Reviewed for load-bearing contracts; the retained UI cleanups do not alter any active scheduling, sync-boundary, transaction, project-completion, passkey, or delete-wins decision; Decisions #2 and #5 constrain TODAY ordering and project completion; the shortlisted project, tag, and work-context changes remain read/UI-facade cleanups and do not change either contract; Reviewed for active data/sync contracts; no retained platform cleanup may alter the documented scheduling, sync boundary, transaction, project-completion, passkey, or delete-wins decisions; Load-bearing sync, persistence, archive, virtual TODAY_TAG, and native decisions are verification fences; no C07 candidate changes production contracts or persisted shapes; Load-bearing scheduling, TODAY_TAG, persistence, and sync decisions remain outside candidate simplification scope.                                                                                                                                                                                                                                                                           |
| `ARCHITECTURE-DECISIONS.md#1-duedayduewithtime-mutual-exclusivity-pattern`                                                                              | C02                          | Scheduling work must preserve dueDay/dueWithTime precedence and exclusivity; retained candidates do not alter either field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ARCHITECTURE-DECISIONS.md#2-today_tag-virtual-tag-pattern`                                                                                             | C02                          | The TODAY_TAG remains ordering-only; retained schedule and daily-summary candidates preserve all task/planner actions and membership derivation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/add-new-integration.md`                                                                                                                           | C04                          | Current contributor guidance still describes built-in issue-provider implementation, reinforcing that provider-to-plugin migration cannot be assumed by a simplification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/apple-release-automation.md`                                                                                                                      | C06                          | Defines final-tag versus prerelease/manual submission behavior, Apple API-key handling, artifact routes, and failure recovery; C06 release cleanups preserve those active paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/build-and-publish-notes.md`                                                                                                                       | C06                          | Defines iOS, Windows SignPath, and release secret/artifact contracts; no canonical candidate removes or renames an active gate, secret, artifact, target, or handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/plainspace-integration-plan.md#risks-and-mitigations`                                                                                             | C04                          | Highlights credential, sync, and integration-boundary risks; retained provider changes avoid persistence and transport redesign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/plans/2026-06-05-project-completion.md`                                                                                                           | C03                          | The accepted project-completion plan was reviewed to ensure the create-project cleanup preserves project add/update payloads and does not re-couple completion behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/plans/2026-06-22-android-keyboard-and-systembars-handover.md`                                                                                     | C05                          | Documents Keyboard.resizeOnFullScreen:false as part of the deliberate keyboard/system-bars configuration stack, creating a conflict with part of I12-C02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/plans/2026-06-22-android-systembars-migration-corrected.md`                                                                                       | C05                          | Establishes device-gated inset/keyboard behavior, native-release rollback cost, and the rule against blind platform configuration changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/plans/2026-07-03-android-home-screen-widget.md`                                                                                                   | C05                          | Provides the current explicit-component and immutable/mutable PendingIntent security patterns that C05-007 must preserve.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/plans/2026-07-07-complete-architecture-review.md`                                                                                                 | C01, C03, C05, C06, C07, C08 | Establishes that the UI layer is generally modern, the task row is a guarded hot path, the Signals migration is incomplete, and component/global style drift is a verified concern; Sections M-2 and M-6 independently document the stalled Observable/Signal migration and leaky WorkContextService facade that C03-005 through C03-007 trim without redesigning state; Rates Electron isolation as strong, identifies the Android remote-bridge security risk, and documents under-adopted platform capabilities and untyped IPC as load-bearing context; Quick wins #4 and #10 and finding H-8 establish the dependency, workflow supply-chain, and runtime-theme contracts used to rank C06; the candidates do not weaken the documented enforcement layer; Shows that test weight intentionally follows risk, with exceptional op-log/server coverage and 195 Playwright specs; C07 does not generalize cleanup into those protected high-risk suites; Used to distinguish simplification candidates from already-tracked architectural migrations and to preserve sync, plugin trust, native, persistence, task-hot-path, and runtime-theme fences. |
| `docs/plans/2026-07-07-complete-architecture-review.md#h-2-scheduling-state-has-three-parallel-sources-of-truth-reconciled-by-hand-in-every-write-path` | C02                          | Defines the high-risk scheduling invariants intentionally left untouched by the retained view, utility, and dead-code cleanups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/plans/2026-07-07-complete-architecture-review.md#h-3-built-in-issue-providers-and-the-plugin-system-are-converging-but-the-migration-is-stalled`  | C04                          | Defines provider/plugin convergence as unfinished architecture; retained cleanups remove local duplication or dead code without choosing the migration shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/plans/2026-07-07-complete-architecture-review.md#h-4-the-plugin-system-has-no-real-trust-boundary`                                                | C04                          | Requires treating plugin execution and permissions as a security boundary; execution, consent, node access, and bridge APIs are explicit preservation fences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/plans/2026-07-07-complete-architecture-review.md#m-5-two-near-duplicate-recurrence-engines`                                                       | C02                          | Confirms repeat-domain duplication but supports deferring behavior-sensitive recurrence consolidation while retaining the zero-consumer selector deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/plans/2026-07-07-ios-home-screen-widget-port.md`                                                                                                  | C05                          | Treats StoreReviewPlugin.swift/.m as the local Capacitor plugin pattern and is implemented by open PR #8950, directly qualifying C05-009.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/plans/2026-07-14-ios-testflight-master-builds.md`                                                                                                 | C06                          | The planned iOS routing table, explicit dispatch inputs, secrets, artifact cardinality, retention, and concurrency gates must remain intact; this directly lowers the rank of generic dispatch normalization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/plans/2026-07-14-microsoft-365-calendar-provider.md#plugin-host-and-public-api-checkpoint`                                                        | C04                          | Records additive public plugin API and host gaps; public types, adapter semantics, manifests, DTOs, and bridge methods are held stable by this consolidation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/plans/2026-07-14-microsoft-365-calendar-provider.md#security-and-privacy`                                                                         | C04                          | Requires local-only OAuth secrets, redacted diagnostics, explicit native redirect handling, and no sync of credentials; no retained candidate changes those paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/non-sync-code-simplification-audit.md`                                                                                                            | C01, C05, C07, C08           | This durable audit record now owns the scope, proof requirements, ranking, LOC accounting, semantic fence, and one-simplification-per-PR implementation rule that were defined by the deleted working plan. It also preserves the domain ownership, test-coverage, characterization, and sync-exclusion constraints used by the consolidators and guardian.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/plugin-development.md#data-persistence`                                                                                                           | C04                          | Distinguishes synced plugin data from local secret storage; candidates preserve keys, shapes, storage selection, and read/write order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/plugin-development.md#plugin-security`                                                                                                            | C04                          | Documents that plugins are not sandboxed and can run through iframe or node execution; cleanup candidates must preserve permission prompts, unload hooks, listener removal, and iframe teardown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/styling-guide.md`                                                                                                                                 | C01, C06                     | Requires minimal component SCSS, shared mixins for reusable styles, global placement for overlay rules, and avoidance of one-off Material overrides; Defines the live global-style, theme-token, component-style, and Sass-mixin surfaces. Styling candidates retain all documented utilities and remove only zero-consumer private internals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/sync-and-op-log/contributor-sync-model.md`                                                                                                        | C07                          | Preserves one-user-intent/one-operation, LOCAL_ACTIONS, hydration guards, meta-reducer atomicity, replay determinism, and bulk-dispatch yield assertions in every test touched near synced state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `e2e/CLAUDE.md`                                                                                                                                         | C07                          | Requires isolated tests, fixtures/page objects, state-driven waits instead of waitForTimeout, focused --retries=0 runs, and serial execution for sync tests; C07 preserves each fence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Coverage and sync boundary

The audit classified all 4,663 tracked files:

| Scope                                |     Files |     LOC | Result                                    |
| ------------------------------------ | --------: | ------: | ----------------------------------------- |
| Eligible production                  |     1,942 | 249,318 | Accounted for                             |
| Eligible tests                       |       727 | 193,420 | Accounted for                             |
| Hard-excluded, primarily sync/op-log |     1,049 | 364,604 | Outside audit scope                       |
| Generated                            |       362 | 100,556 | Outside manual-code audit                 |
| Non-code                             |       583 |       — | Classified, not audited for LOC reduction |
| **All tracked files**                | **4,663** |       — | Fully classified                          |

Four otherwise eligible utilities were semantically excluded because their meaningful contracts cross into sync/op-log behavior:

- `src/app/util/app-data-mock.ts` — persisted `AppDataComplete` and op-log validation contract.
- `src/app/util/check-fix-entity-state-consistency.ts` — persisted repair, logging, and error semantics in op-log consumers.
- `src/app/util/chunk-array.ts` — only production consumer is the excluded operation-log upload path.
- `src/app/util/debounce-during-startup.operator.ts` — contract is initial-sync timing through `SyncTriggerService`.

No candidate in this document authorizes changes to action count/order, reducers or meta-reducers, hydration/replay, persisted shapes, imports/backups, logical clocks, vector clocks, remote operations, conflict handling, compaction, operation capture, sync providers, or sync-specific native/E2E surfaces.

## Current GitHub revalidation gates

GitHub state was checked on 2026-07-16 and is inherently time-sensitive. Recheck immediately before implementation.

- [PR #8927](https://github.com/super-productivity/super-productivity/pull/8927) affects planner visible-day work and would gate any materially reformulated C02-004; the reviewed candidate is rejected.
- [PR #9014](https://github.com/super-productivity/super-productivity/pull/9014) supersedes a short-syntax matcher candidate and touches a retained `stringToMs` consumer.
- [PR #8982](https://github.com/super-productivity/super-productivity/pull/8982) conflicts with `NoteComponent` cleanup.
- [PR #9077](https://github.com/super-productivity/super-productivity/pull/9077) gates PluginService and dependency/lockfile candidates.
- [PR #8865](https://github.com/super-productivity/super-productivity/pull/8865) changes calendar provider/test assumptions.
- [PR #8950](https://github.com/super-productivity/super-productivity/pull/8950) gates native iOS project-file candidates.
- [PR #8515](https://github.com/super-productivity/super-productivity/pull/8515) requires Add Task Bar timezone-test revalidation.
- [PR #7808](https://github.com/super-productivity/super-productivity/pull/7808) requires C04-004 Jira rebase review and API smoke.
- [PR #6782](https://github.com/super-productivity/super-productivity/pull/6782) requires C03-014 checklist-adjacent revalidation.

## Evidence and limitations

The ignored evidence directory is `.tmp/simplification-audit/104043e2d220336d37c96623229640233093f045/`. It contains manifests, coverage, 116 vertical artifacts, 12 lens artifacts, eight consolidation/guardian records, 100 safety reviews, 100 independent maintainability reviews, three reconciliation records, three complete original rankings, and three focused final-scope replacement rankings. This document is designed to remain useful if those ignored files disappear, but the committed record alone cannot reproduce the campaign; the source IDs are supplemental traceability.

Limitations:

- Findings are frozen at one commit and can become stale as code and pull requests change.
- Discovery was primarily static, history, configuration, and test inspection; runtime instrumentation was not added.
- Candidate-specific tests were not run uniformly during discovery.
- LOC estimates are conservative physical-line ranges; actual formatting and required characterization can change them.
- Cross-model review was offered and skipped; the independent review and ranking are multi-agent but single-model.
- Dynamic Angular, native, Electron, plugin, build, and string-based entry points must always be searched again before deletion.
