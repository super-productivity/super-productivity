# Sync System Simplification Audit Plan

**Status:** Proposed

**Date:** 2026-07-16

**Scope:** Evaluation first; this plan does not authorize source changes.

## Goal

Systematically inspect the entire sync system for opportunities to reduce
maintenance cost, cognitive load, duplication, unnecessary abstractions, and
maintained lines of code without weakening behavior, compatibility, privacy, or
data-safety guarantees.

The output is a verified, deduplicated backlog of small simplification
candidates. “Verified” means that an independent reviewer reproduced the
evidence at the frozen baseline; it does not mean that a deletion is safe until
the implementation tests pass. This is not a commitment to hit a percentage
LOC target. Fewer lines are useful only when the result is easier to understand
and preserves the same inputs, outputs, side effects, ordering, errors, wire
formats, replay behavior, and recovery paths.

## Leanest starting point

Reuse and fact-check the existing
[`sync-core-simplification-roadmap.md`](../long-term-plans/sync-core-simplification-roadmap.md)
instead of starting with a new architecture. Treat the larger
[`2026-07-03-sync-engine-extraction-plan.md`](2026-07-03-sync-engine-extraction-plan.md)
as a conditional hypothesis: extraction into another package is justified only
if a real second host or measured boundary problem warrants its additional API,
migration, and compatibility surface.

Also deduplicate against
[`2026-07-07-complete-architecture-review.md`](2026-07-07-complete-architecture-review.md)
and existing issues before recording new work.

## Working baseline

These counts are deliberately approximate because existing reports use slightly
different source filters. Wave A must produce one reproducible scope manifest
and replace them with exact figures.

| Surface | Approximate production size | Approximate test size |
| --- | ---: | ---: |
| Client op-log | 44.7k TS LOC | 100.6k TS LOC |
| Client sync shell | 7.0k TS LOC | 10.6k TS LOC |
| `@sp/sync-core` | 3.9k TS LOC | 4.7k TS LOC |
| `@sp/sync-providers` | 7.3k TS LOC | 6.7k TS LOC |
| Shared schema | 1.0k TS LOC | 1.1k TS LOC |
| SuperSync server | 12.4k TS LOC | 30.4k TS LOC |
| Sync E2E | n/a | 90 specs, 253 tests, about 33k LOC |
| Main E2E sync harness | n/a | about 5k LOC |
| Sync documentation | about 8.2k Markdown LOC | n/a |

The production surface is therefore roughly 76k TS LOC, with well over twice
that amount in automated tests. Test LOC is tracked separately and must not be
reduced by deleting distinct failure scenarios.

Current investigation signals include several multi-state-machine files:

- `conflict-resolution.service.ts`: about 3,934 LOC
- `file-based-sync-adapter.service.ts`: about 3,042 LOC
- `operation-log-store.service.ts`: about 2,918 LOC
- `operation-log-sync.service.ts`: about 2,491 LOC
- `sync-wrapper.service.ts`: about 1,704 LOC
- `data-repair.ts`: about 1,586 LOC

File size is a routing signal, not evidence that a split or deletion is safe.

## Scope

### In scope

- `src/app/op-log/**`
- `src/app/imex/sync/**`
- `packages/sync-core/**`
- `packages/sync-providers/**`
- Sync-related `packages/shared-schema/**`
- Sync, storage, quota, snapshot, WebSocket, validation, and lifecycle code in
  `packages/super-sync-server/**`
- Root-store meta-reducers, persistent actions, logical-day handling, hydration
  guards, platform bridges, and feature effects that participate in op capture
  or replay correctness
- Sync settings, conflict review, encryption/restore UX, and provider wiring
- Unit, integration, PostgreSQL, browser, WebDAV, and SuperSync E2E tests
- Sync docs, diagrams, ADRs, lint rules, and CI path/test selection
- Historical compatibility and migration code, for retention analysis only

### Perimeter-only review

- Calendar, issue-provider, plugin, Android, Electron, and Capacitor “sync” code
  is included only where it observes persistent actions, reacts to replay, or
  crosses a sync provider/platform boundary.
- Server authentication and account lifecycle are included only where they
  affect sync authorization, credential preservation, reset, restore, account
  deletion, or storage ownership.

### Out of scope

- Unrelated feature refactors
- Product behavior changes disguised as cleanup
- New sync features or providers
- New dependencies or custom audit infrastructure
- Generated code, vendored/minified assets, immutable historical SQL migrations,
  and snapshots as LOC-reduction targets
- Automatic issue creation, source edits, commits, pushes, or PRs during audit

## Non-negotiable invariants

Every agent brief must link findings to the applicable invariant ledger. At a
minimum it must preserve:

1. One atomic persistent state transition produces one operation, and
   replayed/remote operations do not re-trigger local effects. Deliberately
   sequenced workflows documented by an ADR remain separate operations; in
   particular, project completion must retain the ADR #5 `N + 1` sequence.
2. Persistent operation contents are append-only; only lifecycle metadata may
   advance in place.
3. Snapshot plus tail replay is equivalent to the current state.
4. Replay is deterministic, idempotent where required, and preserves operation
   and side-effect ordering.
5. Multi-entity actions remain atomic where the domain requires atomicity.
6. Vector-clock comparison, corruption handling, and pruning semantics remain
   client/server compatible.
7. Full-state imports, backups, repairs, provider switches, and clean-slate
   operations retain their intentionally destructive filtering semantics.
8. Conflict resolution converges across clients, including delete-wins,
   disjoint merge, archive, and partial/multi-entity cases.
9. File-based conditional-write, revision, migration, and crash-recovery
   behavior remains provider-compatible.
10. Encryption remains fail-closed; keys, payloads, credentials, and user
    content never leak to logs.
11. Server sequence allocation, conflict detection, quota, cleanup, snapshots,
    and repair bases retain their transaction/causality guarantees.
12. Old backups, wire formats, schema barriers, and migrations remain supported
    until an explicit version-support decision says otherwise.
13. Core tracking and sync continue to work offline; online providers degrade
    gracefully.
14. The audit and any resulting implementation add no analytics or tracking.
15. User data remains local unless the user explicitly configures it to sync;
    logs, audit artifacts, and diagnostics contain no user content.
16. Effects that react to user intent consume `LOCAL_ACTIONS`; selector-based
    effects use `skipDuringSyncWindow()`. `ALL_ACTIONS` remains restricted to
    op-log capture, and remote archive side effects stay in
    `ArchiveOperationHandler`.
17. Bulk operation dispatch retains the post-loop event-loop yield that prevents
    rapid dispatches from losing state.
18. Logical-day decisions flow through `DateService` or replay-safe offset
    arguments, and virtual `TODAY_TAG` membership is never persisted in task
    `tagIds`.
19. Vector clocks retain the 20-entry limit and server-side ordering: detect
    conflicts before pruning and storage.

The canonical starting references are `docs/sync-and-op-log/`,
`ARCHITECTURE-DECISIONS.md`, and `e2e/CLAUDE.md`. Documentation claims must be
verified against code and tests rather than assumed true.

## Operating model: at least 67 agent runs

This is a minimum of 67 bounded agent runs, not 67 simultaneous editors. The
actual count grows within frozen phase budgets with the number of candidates
that pass triage: every such candidate gets its own independent verification
run, and every sync-critical candidate gets two. Run each phase in batches that
fit the available concurrency.

Discovery agents are read-only and return reports to one coordinator. Only the
coordinator may update the local audit ledger; synthesis agents also return
reports rather than editing shared files. The audit does not edit source,
tests, configuration, or existing documentation.

The ledger lives under `docs/research/sync-simplification-audit/` and has five
coordinator-owned files: `baseline.md`, `ownership.tsv`, `findings.md`,
`verification.md`, and `retained.md`. This plain-text layout avoids custom
infrastructure. Creating these audit artifacts requires separate authorization
to execute this plan; this plan alone does not authorize any writes.

| Phase | Seed runs | Purpose |
| --- | ---: | --- |
| A. Baseline scouts | 7 | Freeze and independently reproduce scope, invariants, dependencies, tests, history, and prior work |
| B. Domain audits | 38 | Inspect every owned subsystem with minimal overlap |
| C. Cross-cutting audits | 8 | Find duplication and lifecycle issues that domain ownership can miss |
| D. Triage and synthesis | 4 | Deduplicate, test-map, risk-classify, and admit candidates to verification |
| E. Fresh-context verification | 8 | Initial capacity; expand to one run per admitted candidate and a second for sync-critical work |
| F. Final synthesis | 2 | Sequence the independently verified register and challenge completeness |

### Baseline and run contract

A1 records a baseline ID containing the commit SHA, `git status --porcelain=v1`,
a hash of the tracked diff, hashes of in-scope untracked files, and a hash of
the scope manifest. A clean dedicated worktree at the pinned commit is
preferred. If intentional uncommitted changes are included, they are part of
the baseline and must remain byte-for-byte unchanged. Drift checks exclude only
the coordinator-owned audit-artifact directory; that exclusion is recorded in
the manifest and never applies to source, tests, configuration, or existing
documentation.

Immediately after A1, the coordinator records explicit numeric ceilings for
Wave A continuation runs and Wave B/C continuation runs based on the manifest.
After Wave C, the coordinator freezes D1 slice capacity from immutable origin
records; after D1 deduplication it freezes D2–D4 capacity from the deduplicated
records. After Wave D, it freezes the Wave E budget from the admitted-candidate
count, additional sync-critical reviewers, the eight-run minimum, and at most
one re-verification allowance per candidate. After Wave E, it freezes any
manifest-derived Wave F slice budget. Exceeding a frozen budget stops for
explicit user approval; agent count never expands silently.

Every run except the A1 bootstrap must:

1. Confirm the baseline ID before reading evidence and return `STALE_BASELINE`
   if it differs.
2. Have one primary assignment, inspect the contents of at most 60 total files,
   and return at most five candidates. A larger assignment returns
   `SPLIT_REQUIRED` with proposed child slices; each slice becomes an additional
   agent run.
3. Cite reproducible search/test/history commands and their relevant results.
4. Stop after 45 minutes and return a partial report plus `SPLIT_REQUIRED`.
5. Return at most 4,000 words total, including candidate records and evidence
   excerpts.
6. Make no source, test, config, documentation, GitHub, CI, branch, or remote
   changes.

The file cap includes production, tests, scripts, schemas, and docs that are
substantively opened or examined. Any agent may mechanically enumerate, hash,
count, and search repository-wide paths without loading their contents; its
content inspection still has the same cap. Finding a sixth viable candidate
also returns `SPLIT_REQUIRED`. Slices use stable sorted path ranges or explicit
subsystem boundaries, never agent discretion alone. Agents may not omit files,
behavior, or candidates because of a limit; they must request a split within
the frozen budget.

### Command isolation

Audit agents default to read-only searches and history inspection. A test or
other command that writes caches, reports, snapshots, databases, ports, or temp
state may run only in an isolated worktree with a unique temp/database/port
namespace and disposable local services. External endpoints are never used
without separate explicit authorization; local services that cannot be
isolated are serialized. Otherwise the agent inspects the test and records the
future command without executing it. Every executing agent compares the
baseline before and after its run; any unexpected audited-file or local-service
drift invalidates its evidence.

## Wave A: baseline scouts

| ID | Assignment | Required artifact |
| --- | --- | --- |
| A1 | Scope and metric manifest | Baseline ID; reproducible file list and exclusions; source/test/docs LOC and file counts |
| A1R | Independent baseline reproduction | Re-run A1’s recorded procedure, challenge exclusions/search closure, and either reproduce both hashes or stop the audit |
| A2 | Invariant ledger | Invariant, canonical source, enforcing code/lint, proving tests, known residuals |
| A3 | Dependency/API map | Package direction, app deep imports, cycles, public exports, registries, DI/providers, high fan-in/out |
| A4 | Scenario/test map | Unit/integration/E2E coverage mapped to documented sync scenarios and providers |
| A5 | History/compatibility ledger | Legacy path origin, last producer/consumer, rollout/support horizon, removal precondition |
| A6 | Prior-work dedupe | Local plans/ADRs/completed work plus existing issues only when execution authorization includes read-only issue retrieval; otherwise record external issue coverage as a blocking gap |

### Wave A exit criteria

- A1 records its complete query lexicon, seed paths, forward/reverse import and
  registration-closure algorithm, terminal inclusion rules, and exclusions.
  Discovery follows DI/provider registrations, entity/action registries,
  serialized action/format strings, package exports, build scripts, lint rules,
  workflows, and the recorded sync-related search terms until a full pass adds
  no files. The resulting manifest—not the seed path list—is the denominator.
- A1R runs independent negative searches for missed sync terms, registrations,
  serialized strings, and importers before Waves B–F may start.
- Every in-scope file has exactly one primary domain owner.
- Every load-bearing invariant has at least one enforcing code path and test, or
  is explicitly recorded as a gap.
- Existing findings and plans are mapped before new findings are accepted.
- Metrics can be regenerated without adding a dependency.
- The baseline ID and scope-manifest hash can be reproduced by another agent.

## Wave B: domain audits

Each numbered ID is one independent read-only agent assignment. Within a range,
the semicolon-separated domains map left-to-right to the numbered IDs; for
example, B01 owns core contracts/entity registry and B04 owns archive
application.

| IDs | Domain assignments |
| --- | --- |
| B01–B04 | Core contracts/entity registry; capture/meta-reducer path; operation conversion/bulk apply; archive application |
| B05–B09 | Operation-log store; IndexedDB/schema/upgrades; SQLite/backend migration; hydration/recovery; snapshots/compaction |
| B10–B12 | Backup/legacy migration/clean slate; structural validation; repair algorithms/orchestration |
| B13–B17 | Sync wrapper/triggers/status; main orchestrator/session guards; download/pagination; upload/write flush; remote/rejected/superseded ops |
| B18–B22 | Conflict engine; conflict journal/review UI; vector clocks/import filtering; full-state/server migration; encryption/password/restore |
| B23–B28 | Provider host/credentials/OAuth; file-based adapter/envelope; WebDAV/Nextcloud; Dropbox; OneDrive/LocalFile/platform; SuperSync client/WebSocket |
| B29–B31 | `sync-core` algorithms/public API; `sync-providers` shared infrastructure; shared-schema HTTP contracts/migrations |
| B32–B34 | Server upload/conflict transaction; server download/snapshot/cleanup/quota; server WebSocket/rate/dedup/validation/sync lifecycle |
| B35 | Platform/perimeter sync correctness: root store, feature effects, logical day, Android/Electron/Capacitor bridges |
| B36 | Unit/integration/E2E harness ownership and execution topology |
| B37 | Sync lint rules, build scripts, package exports, CI selection, and scheduled-workflow reachability |
| B38 | Prisma schema/indexes, database bootstrap/upgrade tooling, operational backup/recovery, and immutable migration inventory |

Each domain agent must:

1. Read the governing docs and neighboring implementation.
2. Identify responsibilities, entry points, callers, outputs, persistent/wire
   shapes, platform branches, and error paths.
3. Inspect matching unit/integration/E2E tests.
4. Check relevant git history before proposing removal or consolidation.
5. Return no more than five evidence-backed candidates plus an explicit “retain”
   list for complexity that is necessary.
6. Avoid proposing a new abstraction unless it demonstrably removes more
   concepts, branches, or duplication than it adds.

### Wave B exit criteria

- Every manifest entry has one completed primary-domain report, including all
  required child slices. A recorded but unfinished `SPLIT_REQUIRED` run blocks
  the phase; if the frozen budget cannot cover it, stop for approval.
- Each report covers callers, runtime registrations, persisted strings/formats,
  tests, history, and necessary complexity—not just static imports.
- Every candidate satisfies the finding contract; unsupported observations are
  retained as questions, not promoted.

## Wave C: cross-cutting audits

| ID | Pattern audit |
| --- | --- |
| C1 | Dead exports, unused methods, deprecated aliases, no-value wrappers, and pass-through facades |
| C2 | Duplicate result types, optional-field flag bags, state-machine branches, and status ownership |
| C3 | Compatibility paths, migrations, format versions, feature flags, and rollout completion conditions |
| C4 | Dependency cycles, facade bypasses, package ownership, deep imports, and public surface area |
| C5 | Provider HTTP/auth/retry/error/logging duplication, separating genuinely shared behavior from protocol quirks |
| C6 | Unit/integration/E2E duplication, fixtures, fixed waits, direct locators, flakiness, and runtime cost |
| C7 | Documentation/diagram/ADR/scenario drift and opportunities for one canonical source plus generated links |
| C8 | Privacy-safe logging, constants/configuration drift, error taxonomies, and platform branching |

Cross-cutting agents reference the primary domain owner instead of filing a
second finding. The dedupe key is the same invariant, same mechanism, and
overlapping files—not merely similar wording.

### Wave C exit criteria

- All eight pattern reports and all required child slices cover the complete A1
  manifest. An unfinished slice blocks the phase; if the frozen budget cannot
  cover it, stop for approval.
- Cross-domain observations are linked to immutable origin IDs/dedupe keys or
  recorded in the retain register; no duplicate candidate advances
  independently.

## Finding contract

Every candidate uses this record:

```text
Immutable origin ID / stable ID assigned by D1 / dedupe key / status
Baseline ID / origin run / candidate-record revision hash
Primary domain / related domains
Title and category
Exact paths and lines
Current responsibility and why it may exist
Callers, consumers, exports, and persisted/wire-format impact
Duplicate or unnecessary mechanism
Smallest proposed simplification
Behavioral-equivalence argument
Protected invariants and failure modes
Evidence commands and relevant results
Git/history/rollout/support evidence
Existing issue/plan overlap
Required characterization and verification tests
Estimated production/test/docs LOC delta
Maintenance/cognitive-load reduction
Blast radius and reversibility
Risk: low / medium / high / sync-critical
Evidence confidence: weak / supported / reproduced
Verifier IDs / challenges / disposition / decision rationale
Recommendation: pursue / investigate / retain / already tracked / decision required
```

A stable dedupe key combines the protected invariant, current mechanism, and
overlapping files. Discovery assigns origin IDs such as `B13-C03`; Wave C uses
origin IDs and dedupe keys, and D1 maps them to stable IDs without overwriting
their provenance. Candidate states are:

```text
proposed → triaged → verification-ready → verified
                                      ↘ rejected / decision-required
proposed or triaged → already-tracked / retained
```

The audit may label a hypothesis `verified`; it never labels a deletion
“proven.” Static call-site search can miss dynamic lookup, dependency injection,
serialized action names, persisted formats, plugin consumers, older clients,
and behavior absent from tests. A deletion is safe only after those consumers
are checked, compatibility is decided, and the eventual implementation passes
the behavior-preserving verification ladder. “Large file,” “many branches,” or
“high LOC” alone is not a finding.

## Wave D: triage before verification

Triage happens after discovery and before any verifier is assigned.

| ID | Responsibility |
| --- | --- |
| D1 | Finding librarian: assign stable IDs, merge dedupe keys, and link prior work |
| D2 | Invariant/risk classifier: reject behavioral changes disguised as simplification |
| D3 | Evidence and test mapper: require reproducible commands and characterization paths |
| D4 | Benefit/cost classifier: apply the rubric and admit verification-ready candidates |

The coordinator applies D1–D4 reports in that order. An admitted candidate has
one immutable revision hash. Any material edit after admission creates a new
revision that must be verified again. D3 must decompose a proposal into smaller
independently safe candidates, or mark it `decision-required`, when its complete
consumer/registration/format/test verification closure cannot fit within one
verifier’s 60-file and time limits.

### Candidate classification rubric

Do not calculate a synthetic numerical score. Record four independent bands:

| Dimension | Bands |
| --- | --- |
| Maintenance benefit | High: removes a policy/state owner or repeated lifecycle; medium: removes meaningful duplication/branching; low: mostly cosmetic |
| Evidence confidence | Reproduced: commands/results independently repeat; supported: multiple code/test/history sources agree; weak: inference or missing consumer evidence |
| Behavioral risk | Sync-critical: convergence/data loss/security/format/transaction risk; high: broad lifecycle or compatibility impact; medium: bounded behavior surface; low: no runtime contract change |
| Validation cost | Small: focused unit/static checks; medium: subsystem integration or provider matrix; large: multi-client/provider/PostgreSQL/migration/soak evidence |

Unknown evidence blocks admission. Rank verified candidates first by lower
behavioral risk, then higher maintenance benefit, stronger evidence, lower
validation cost, and greater reversibility. Estimated production LOC is a
secondary tie-breaker only; test and safety coverage are never counted as
negative benefit merely because they add lines.

### Wave D exit criteria

- Every proposed record has one terminal triage state or an immutable
  verification-ready revision.
- Duplicate keys, prior plans, and existing issues are linked before admission.
- Each admitted candidate has explicit invariants, consumer/format checks, a
  behavioral-equivalence claim, and commands a verifier can reproduce.

## Wave E: fresh-context verification

Assign exactly one verification-ready candidate revision to each fresh-context
reviewer. A verifier must be a new session that held no discovery, triage,
coordination, or earlier verification role in the audit. Every required
reviewer receives the same immutable hashed candidate packet without verifier
conclusions; their reports remain separate and hidden from one another until
all required reviews finish.

The eight seed runs are only initial capacity; create another run within the
frozen budget for every admitted candidate above eight. A sync-critical
candidate receives two reviewers. If fewer than eight candidates pass triage,
unused seed runs challenge the highest-risk retained or decision-required
records as negative controls; they cannot promote those records without
returning them through triage.

Each verifier must independently reopen the cited files at the matching
baseline, repeat the evidence commands, inspect dynamic/DI/serialized/plugin and
old-client consumers where applicable, challenge the test map, and try to
disprove behavioral equivalence. A report based only on the candidate author’s
summary does not count.

Classify each challenge as contract misread, valid/actionable, valid trade-off,
or noise. The coordinator revises, rejects, or marks the candidate
decision-required rather than averaging opinions. A material revision returns
to `verification-ready`; a cleanly reproduced candidate becomes `verified`.
Sync-critical candidates additionally require explicit maintainer approval in a
future implementation-planning turn.

### Wave E exit criteria

- Every admitted revision has an independent report tied to its baseline and
  revision hash; every sync-critical revision has two.
- Every material evidence command is reproduced. A failure blocks verification
  unless the verifier independently reproduces equivalent evidence and records
  why it is equivalent; non-material failures are recorded.
- No unresolved valid/actionable challenge is labeled `verified`.

## Wave F: final synthesis

| ID | Responsibility |
| --- | --- |
| F1 | Build a dependency graph from verified candidates and all file, invariant, persisted-format, public-contract, test-harness, and transitive-consumer overlaps |
| F2 | Fresh completeness challenge against the A1 manifest, then return accepted, rejected, retained, already-tracked, and decision-required summaries |

F1 and F2 are the bounded lead aggregators for any manifest-derived slice runs
and return reports. The coordinator is the only final editor and applies them
sequentially after all Wave E reports are reconciled. If the frozen F budget
cannot cover the complete manifest and ledger, the audit stops rather than
claiming completeness.

### Wave F exit criteria

- Every A1 manifest entry maps to an audit report and every report maps to a
  terminal finding state.
- Every verified candidate maps to its independent verification evidence and a
  dependency-graph node.
- Any coverage, evidence, compatibility, or maintainer decision gap is explicit
  rather than silently omitted from the roadmap.

### Required final outputs

1. Exact scope manifest and reproducible baseline.
2. Invariant-to-code-to-test traceability matrix.
3. Dependency and state-machine ownership map.
4. Verified candidate register with evidence and classification bands.
5. Retain/rejected-hypothesis register, so future audits do not repeat unsafe
   suggestions.
6. Compatibility/migration retirement ledger with human decision points.
7. Scenario-to-test matrix and verification commands.
8. Small, dependency-ordered implementation roadmap.
9. Documentation corrections separated from behavior changes.

All outputs remain local. Reading or changing GitHub issues, dispatching CI,
committing, pushing, opening a PR, or publishing results requires explicit
authorization for that exact action.

## Verification ladder for eventual implementation

The audit itself is read-only apart from its coordinator-owned local research
artifacts. The following section is reference material, not permission to
implement. Source/test/config/doc edits and external actions require a separate
user request. For every later-approved implementation candidate:

1. Freeze the behavior with focused characterization tests before refactoring.
2. Make one behavior-preserving simplification at a time; do not combine it
   with a feature or protocol change.
3. Run `npm run checkFile <filepath>` for every modified `.ts` or `.scss` file.
4. Run the narrow affected unit/package/contract tests.
5. Run the applicable subsystem integration tests:
   capture → persist → hydrate → replay, remote apply, compaction, migration,
   import, conflict, repair, encryption, or adapter parity.
6. For shared boundaries, verify client/server HTTP contracts, shared-schema
   compatibility, IndexedDB/SQLite parity, and timezone behavior where relevant.
7. Run the smallest relevant E2E with `--retries=0`, including two-client
   convergence and both provider families when shared code changes.
8. For server/storage changes, run the real-PostgreSQL integration suites.
9. For sync-critical work, after explicit authorization, manually dispatch the
   scheduled SuperSync and WebDAV suites for the branch and run the relevant
   failure/soak scenarios.
10. Re-review the final diff; behavior tests should normally remain unchanged,
    and production code plus its safety coverage must not be deleted together.

## Implementation ordering after the audit

Audit high-risk areas early, but implement in this order:

1. Verified dead declarations, deprecated aliases after call-site migration,
   no-value wrappers, stale docs, and test-harness cleanup.
2. Pure duplicated helpers and narrow result/type simplifications.
3. Provider-local duplication with no wire-format or credential behavior change.
4. Orchestration ownership and result-state simplification, one service seam at
   a time.
5. Persistence/backend migration cleanup after rollout preconditions are met.
6. Conflict, vector-clock, encryption, full-state, schema, and server transaction
   changes only with their dedicated plans and safety gates.

Keep implementation candidates to one reviewable behavior-preserving purpose,
normally no more than five production files. F1 may recommend parallel coding
only when no known overlap exists in files, protected invariants, public or
persisted contracts, wire formats, schemas, migrations, tests/fixtures/harnesses,
or transitive consumers. Parallel work uses isolated branches/worktrees; it is
integrated sequentially, with affected contract, convergence, migration, and
recovery tests rerun on each combined state before the next candidate is
integrated. Any known overlap serializes even the coding. This rule includes,
but is not limited to, vector clocks versus server conflict logic, uploads
versus Prisma indexes, full-state versus snapshots, encryption formats versus
guards, shared HTTP contracts versus validators, file envelopes versus
provider CAS, and production behavior versus the tests that prove it.

## Audit completion measures

- 100% of the scope manifest has a primary owner and an audit result.
- 100% of verified candidates cite the baseline, code, callers/registrations,
  relevant formats, history, invariants, tests, evidence commands, and verifier.
- Every admitted finding has an independent verifier; sync-critical findings
  have two, and unresolved items have explicit states.
- Every manifest entry and candidate revision is traceable through the ledger;
  the totals reconcile without orphaned or duplicate records.
- No candidate is admitted because of LOC or file size alone.
- F2 records coverage gaps and retained complexity, so the audit does not claim
  completeness by silently excluding difficult areas.

## Later implementation outcome measures

These measures apply only after separately authorized implementations:

- Replay determinism, multi-client convergence, provider parity, recovery,
  migration, privacy, and encryption coverage do not decrease.
- Dependency edges/cycles, public exports, duplicated policy locations, flag
  combinations, and state-machine ownership decrease where proven useful.
- Fixed waits, E2E flake rate, and CI runtime/cost improve without losing
  distinct scenarios.
- Documentation claims link to current code/tests and stale duplications are
  removed.
- Maintained production LOC decreases across completed candidates when that is
  the clearest solution; neutral or increased LOC is acceptable when safety and
  comprehension measurably improve.

## Stop conditions

Stop and request a maintainer decision when:

- deleting code requires ending support for a backup, schema, provider, or wire
  format;
- a candidate changes conflict, import, repair, delete-wins, encryption, or
  transaction semantics rather than preserving behavior;
- existing or feasible characterization tests cannot describe the protected
  behavior, or a representative mutation would not make them fail;
- the simpler design adds a new public API/package without a demonstrated user;
- three adversarial passes still find substantive unresolved risks; or
- the total maintenance and comprehension benefit is small relative to
  migration and verification cost, regardless of the LOC estimate.
