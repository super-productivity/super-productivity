# Systematic Simplification Audit — Results

- **Date:** 2026-07-17
- **Frozen baseline:** `104043e2d220336d37c96623229640233093f045`
- **Complete backlog:** [Non-sync code simplification audit](../non-sync-code-simplification-audit.md)

## Outcome

The non-sync codebase audit and full portfolio review are complete. Discovery itself was read-only: no production, test, configuration, dependency, or generated source was changed during the audit. The later implementation batch is recorded separately below.

- All 116 vertical assignments completed.
- All 2,669 eligible production and test paths are accounted for: 2,665 reviewed and four semantically excluded because their only meaningful contracts cross into sync/op-log behavior.
- Twelve blind cross-cutting lenses added independent discovery.
- Discovery produced 296 vertical candidates, 53 lens candidates, and 606 documented rejected leads.
- Seven domain consolidations normalized those claims into 105 domain candidate slots. The exclusion guardian removed five whole-candidate duplicates and narrowed one overlapping candidate, leaving 100 unique canonical candidates.
- Every candidate received two independent reviews: a safety/correctness pass and a maintainability/value pass.
- Conservative reconciliation produced 26 confirmed, 47 narrowed, 12 deferred, and 15 rejected findings.
- Three independent rankers ordered the original reconciled records by risk/reward. Three focused reviewers later replaced the stale placements for 27 materially revised C06/C07 scopes; the final actionable backlog contains 33 Tier A and 40 Tier B findings.
- Cross-model corroboration was offered after the multi-agent review and skipped.

The [durable decision record](../non-sync-code-simplification-audit.md) contains the authoritative 100-item order and, under every candidate, the reconciled scope, corrected LOC categories, material corrections, primary gate, and required verification. Discovery-era estimates are retained there only as traceability and are superseded where the full review differs. Raw manifests and reviewer artifacts remain in the ignored local `.tmp` workspace, so this commit does not independently reproduce the campaign.

## Coverage proof

| Scope                                |     Files |     LOC | Result                                    |
| ------------------------------------ | --------: | ------: | ----------------------------------------- |
| Eligible production                  |     1,942 | 249,318 | Accounted for                             |
| Eligible tests                       |       727 | 193,420 | Accounted for                             |
| Hard-excluded, primarily sync/op-log |     1,049 | 364,604 | Outside audit scope                       |
| Generated                            |       362 | 100,556 | Outside manual-code audit                 |
| Non-code                             |       583 |       — | Classified, not audited for LOC reduction |
| **All tracked files**                | **4,663** |       — | Fully classified                          |

The coverage ledger contains 2,665 `reviewed` paths and four `semantic-excluded` paths, with no missing, duplicate, unexpected, or hard-excluded manifest entries. The four semantic exclusions are:

- `src/app/util/app-data-mock.ts` — persisted `AppDataComplete`/op-log validation contract.
- `src/app/util/check-fix-entity-state-consistency.ts` — persisted repair, logging, and error semantics in op-log consumers.
- `src/app/util/chunk-array.ts` — only production consumer is the excluded operation-log upload path.
- `src/app/util/debounce-during-startup.operator.ts` — contract is initial-sync timing through `SyncTriggerService`.

## Final portfolio summary

The final order keeps the original three placements for the 73 scopes that did not materially change and replaces the stale placements for the 27 revised C06/C07 scopes with three fresh independent global placements. Mean applicable placement controls within the actionable, deferred, and rejected bands; exact ties prefer lower risk, then lower effort, then higher reconciled priority, then candidate ID.

| Band   |                                        Ranks | Count | Meaning                                              |
| ------ | -------------------------------------------: | ----: | ---------------------------------------------------- |
| Tier A | 1–73, interleaved with Tier B by risk/reward |    33 | Higher-confidence, lower-risk actionable work        |
| Tier B | 1–73, interleaved with Tier A by risk/reward |    40 | Actionable with greater risk, effort, or uncertainty |
| Tier C |                                        74–85 |    12 | Deferred pending stronger evidence or value          |
| Reject |                                       86–100 |    15 | Do not implement as described                        |

The next five open findings are C01-005, C02-005, C04-001, C01-006, and C04-007. Their scopes are documented as disjoint, but each should remain its own change and verification boundary.

## First implementation batch — verified and stashed

The three recommended non-overlapping changes were implemented and verified on 2026-07-17, then stashed at the user's request. They are not present in the current worktree. The patch is stash object `11043158b95aee6a44dfcf4e69315abda4b88704` with message `codex: verified simplification implementation batch`; it was `stash@{0}` at audit time, but stash ordinals are mutable and local:

1. **C04-015 — static procrastination catalog**
2. **C01-002 — duration wrappers**
3. **C06-004 — unloaded Karma hooks**

The original forecast used file-level categories that did not consistently separate comments and blank lines, so it is not repeated as categorized evidence. The line-level actual below controls.

They have no dependency edge or file overlap. Their verified status is evidence that lowers residual uncertainty; it is not a separate LOC or reward bonus.

Minimum verification:

- **C04-015:** repeat symbol/import searches; run the plugin typecheck and production build; verify all eight translated types, stable ID order, and the two action-bearing strategies.
- **C01-002:** run `checkFile` on changed TypeScript; run focused `stringToMs`, duration-input, directive, Formly-duration, short-syntax, and Add Task Bar tests; run the frontend production build.
- **C06-004:** verify the hooks remain absent from Angular/Karma entry points; run a normal focused Karma spec and retain the configured disconnect reporter unchanged.

Actual schema-aligned implementation diff:

Deleted lines are classified individually: blank and comment-only lines take precedence, and each remaining nonblank line is assigned to production code, test code, or test-infrastructure code by file role.

| Category                 | Added | Deleted | Net reduction |
| ------------------------ | ----: | ------: | ------------: |
| Production code          |     1 |     222 |           221 |
| Test code                |     0 |     125 |           125 |
| Test-infrastructure code |     0 |      82 |            82 |
| Comment-only lines       |     0 |      34 |            34 |
| Blank lines              |     0 |      51 |            51 |
| **Physical diff total**  | **1** | **514** |       **513** |

C01-002's line-level actual is 132 production-code deletions, 125 test-code deletions, 20 comment-only deletions, and 33 blank-line deletions, plus one production-code insertion. Review confirmed that every deleted line is within the challenged dead-pipe, provider, mock, and unused-parameter scope.

Verification completed:

- `checkFile` passed for every modified TypeScript file.
- The procrastination plugin package passed typecheck and production build.
- Duration and live parser-consumer Karma runs passed 342 tests; the final normal Karma reporter smoke passed another 15 tests.
- The frontend production build passed.
- Exact reference searches, hard-fence unchanged-file checks, and `git diff --check` passed.

## Remaining implementation order

Use the final 100-item order in the [durable decision record](../non-sync-code-simplification-audit.md). It replaces the earlier top-12 and provisional follow-up lists that were recorded here before the full review.

- Apply each candidate's authoritative scope, not its broader discovery-era proposal.
- Satisfy its primary gate before editing.
- Keep one simplification per independently reviewable change unless two entries explicitly share one root cause.
- Revalidate paths, consumers, open pull requests, and LOC at implementation `HEAD`.
- Do not revive ranks 86–100 without a materially new proposal that resolves the recorded rejection.
- C02-012 is a sync/op-log boundary violation and is not eligible for implementation through this audit.

## Existing work and current GitHub gates

The audit independently confirmed or overlapped with existing work rather than rediscovering it silently:

- [#8260 — remove dead code and reduce LOC](https://github.com/super-productivity/super-productivity/issues/8260)
- [#7911 — code simplification follow-ups](https://github.com/super-productivity/super-productivity/issues/7911)
- [#7874 — frontend/platform/mechanical cleanup backlog](https://github.com/super-productivity/super-productivity/issues/7874)

Current open work changed candidate classification or requires revalidation:

- [PR #8927](https://github.com/super-productivity/super-productivity/pull/8927) supersedes/conflicts with planner visible-day simplification and would gate any materially reformulated C02-004; the reviewed candidate is rejected.
- [PR #9014](https://github.com/super-productivity/super-productivity/pull/9014) supersedes a short-syntax matcher candidate.
- [PR #8982](https://github.com/super-productivity/super-productivity/pull/8982) conflicts with `NoteComponent` cleanup.
- [PR #9077](https://github.com/super-productivity/super-productivity/pull/9077) gates PluginService and dependency/lockfile candidates.
- [PR #8865](https://github.com/super-productivity/super-productivity/pull/8865) changes calendar provider/test assumptions.
- [PR #8950](https://github.com/super-productivity/super-productivity/pull/8950) gates native iOS project-file candidates.
- [PR #8515](https://github.com/super-productivity/super-productivity/pull/8515) requires Add Task Bar timezone-test revalidation.
- [PR #7808](https://github.com/super-productivity/super-productivity/pull/7808) requires C04-004 rebase-time review and a Jira API smoke despite no current target-file overlap.
- [PR #6782](https://github.com/super-productivity/super-productivity/pull/6782) requires C03-014 checklist-adjacent revalidation despite no current target-file or symbol overlap.

GitHub state was checked on 2026-07-16. Recheck immediately before implementation.

## Cross-domain corrections

The exclusion guardian found ten overlap groups and applied 15 corrections:

- Six duplicate-count removals.
- Four path/location/ownership corrections.
- Five current-PR conflict or revalidation gates.

The principal duplicate groups were focus-overlay teardown, planner projection SCSS, global Sass cleanup, `GlobalConfigService` signal cleanup, and provider build scripts. LOC from those groups is counted once.

## Sync exclusion appendix

This audit intentionally excludes sync systems, including op-log, SuperSync, WebDAV, two-way-sync implementation/migrations, sync-conflict handling, vector clocks, sync E2E, and native sync surfaces.

Checks performed:

- No hard-excluded path entered the scout manifest.
- No coverage path exists outside the eligible manifest.
- The four eligible-but-sync-semantic utilities are documented above rather than treated as findings.
- State/effect candidates that would alter action count, replay, hydration, persisted shape, remote ordering, or logical clocks were rejected or deferred.
- Sync-named dead constants discovered incidentally in E2E helpers were not promoted.

## Method and traceability

The campaign executed:

- 116 vertical scout assignments: 84 production and 32 test overlays.
- 12 blind cross-cutting lens assignments.
- 8 consolidation/guardian assignments.
- 100 safety/correctness reviews across seven domains.
- 100 blind maintainability/value reviews across seven domains.
- 3 independent 100-item ranking passes.
- 27 final C06/C07 scope reconciliations followed by three fresh independent global-placement passes for those revised scopes.

Artifacts are stored under the ignored directory:

`.tmp/simplification-audit/104043e2d220336d37c96623229640233093f045/`

Key entries:

- `baseline.json`, `scope-manifest.csv`, `scout-manifest.csv`, `coverage.csv`
- `raw/` — 116 vertical artifacts (108 schema-v2 and eight calibration-era/pre-v2 records)
- `lenses/` — 12 blind horizontal artifacts
- `canonical/` — C01–C08 consolidation and guardian records
- `full-review/safety-C01.json` through `safety-C07.json` — safety/correctness verdicts
- `full-review/maint-C01.json` through `maint-C07.json` — blind maintainability/value verdicts
- `full-review/consensus-*.json` — conservative reconciliations
- `full-review/global-rank-R1.json` through `global-rank-R3.json` — complete independent rankings
- `full-review/manual-reconcile-C06.json` and `manual-reconcile-C07-*.json` — controlling scope and score overrides for 27 mechanically ambiguous C06/C07 records
- `full-review/manual-reconcile-rejections.json` — neutralized implementation guidance for all 15 rejected records
- `full-review/manual-reconcile-implemented-loc.json` — exact line-level category corrections for the verified implementation batch
- `full-review/final-scope-rank-*.json` — three focused replacement placement passes for those 27 records

## Known limitations

- The audit is frozen at one commit; merged/open PRs may invalidate paths or consumers.
- It is primarily static/history/test inspection. Dynamic registration checks were performed, but runtime instrumentation was not added.
- No new analyzer or dependency was installed.
- Candidate-specific tests were not run uniformly during discovery; exact implementation verification is recorded per candidate.
- LOC uses physical-line ranges and is conservative, but formatting can shift final counts.
- The 12 horizontal lenses were separate blind passes but, due to the thread allocator, were executed sequentially by one fresh lens agent. They remained blind to vertical findings.
- The full portfolio review used 14 domain reviewers rather than one new identity per candidate; safety and maintainability passes remained independent.
- Cross-model review was offered and skipped, so corroboration is multi-agent but single-model.

## Decision

The three-item first batch is verified, independently reviewed, and stored in the local stash identified above. Keep candidates independently reviewable when organizing commits or pull requests. The next five open findings are C01-005, C02-005, C04-001, C01-006, and C04-007; revalidate each against the eventual landing state before implementation so stale consumers, gates, or overlapping LOC are never missed.
