# Sync simplification audit verification

Baseline ID: `9b4481332dd635dce29da3774d1b8601ea213467f07dfc7fb0417f36328c3135`

## Execution amendment — fast-track authorization

On 2026-07-16, the user explicitly authorized a reduced execution budget
without modifying the frozen plan or invalidating its baseline hash. The
amended execution scope is:

- finish every Wave B domain audit;
- run only C1, C3, C6, C7, and C8;
- treat B23–B30 evidence as the C5 provider-duplication review, with no
  standalone C2, C4, or C5 run;
- run D1 separately, then combine D2–D4 into one admission review;
- admit at most ten candidates and use at most fourteen Wave E verification
  runs, retaining two fresh reviewers for each sync-critical candidate and
  shrinking the shortlist when needed;
- omit negative-control reviews and automatic re-verification; a materially
  challenged candidate becomes rejected or decision-required;
- retain F1 and F2; and
- label every non-shortlisted finding `discovered/proposed, unverified` and do
  not claim exhaustive cross-cutting verification.

All frozen-baseline, read-only, coordinator-ownership, substantive-file-cap,
privacy, and no-source-change constraints remain in force. This amendment
changes execution coverage only; it does not alter the frozen plan.

## Baseline reproduction

A1R reproduced revision 4 and found two material omissions:
`src/app/core/ipc-events.spec.ts` and
`src/app/features/tag/store/tag.reducer.spec.ts`. Revision 5 added both.
A1R2 reproduced revision 5 and found five additional same-stem tests. Revision
6 added them. The user explicitly raised the Wave A continuation ceiling from
25 to 26 for one fresh A1R3 confirmation run.

A1R3 passed revision 6: M1 733 / `e9b8d804…`, M2 512 /
`e42c80ba…`, M3 197 / `d7209692…`, merged 1,442 /
`7d38cfa9…`, and baseline ID `9b448133…`. It mechanically found 154
same-stem test pairs and 24 Angular resource pairs with zero omissions, then
reproduced DI/registration, serialized/native/provider/schema/wire negative
closure and all seven lexical exclusions.

## Manifest-validation run log

The initial A1 run returned `SPLIT_REQUIRED`. A1-M1 and A1-M3 reproduced
their complete deterministic slices. A1-M2 first produced a 461-path candidate
set. Two initial range runs and a third independent run rejected it because
default `rg` returned 218 primary paths while the origin returned 222. The
difference was four tracked PFAPI JavaScript files hidden by
`.gitignore:76`. A repaired Git-universe recipe reproduced all 222.

One replacement V02 session self-invalidated after a quoting error searched
outside its 60-file range. Its evidence is discarded. The following successful
content inspections drove four manifest revisions:

| Run | Exact inspected cohort | Disposition |
| --- | --- | --- |
| A1-M2-V01 | Original M2 records 1–60 | Validated unchanged files; added iOS build registration, Electron frontend contract, and date-format proving spec |
| A1-M2-V02R | Original records 61–120 | Validated with routing challenges; no closure additions |
| A1-M2-V03 | Original records 121–180 | Added calendar sidecar, menu-tree tests, and task-service spec |
| A1-M2-V04 | Original records 181–233 plus seven revision-2 additions | Added seven same-stem proving tests; removed locale-only lexical false positive |
| A1-M2-V05 | Original records 234–293 | Added six direct consumers/serialized-shape dependencies and their complete companion/resource closure; removed idle-only break-service pair |
| A1-M2-V06 | Original records 294–353 | Added work-context/worklog tests; removed three non-sync plugin OAuth bridge/storage files |
| A1-M2-V07 | Original records 354–413 | Added app-state action and plugin metadata persistence pair; removed local-only plugin secret store |
| A1-M2-V08 | Original records 414–461 plus 12 revision-3 additions | Added 14 same-stem UI/util tests and Angular resources |
| A1-M2-V09 | Remaining ten revision-3 additions | Added deadline component/resource/spec closure and task-selector logical-day spec |

Across these runs, 51 omissions were added and seven independently reproduced
lexical false positives were removed. Each unchanged original M2 path was
content-inspected once; every revision-2 and revision-3 addition was inspected
in a later validation run. Revision-4 additions are assigned to A1R's bounded
challenge sample and later primary domain owners.

Important routing signals, not yet triaged candidates:

- native credential fail-open storage and privacy-unsafe Android/iOS logging;
- stale Android credentials when null provider config is filtered;
- nondeterministic board-ID repair during replay;
- possible dead Electron IPC/revision parameters and preload contract drift;
- hand-rolled calendar sync-window gating with race tests;
- duplicate task-repeat reducer handler;
- possible op-capture gaps in dispatch loops;
- plugin metadata persistence and logical-day/virtual-`TODAY_TAG` boundaries;
- missing native sync contract tests.

## Invariant-to-code-to-test traceability (A2)

| # | Invariant and enforcement | Representative proof | Residual / risk |
| ---: | --- | --- | --- |
| 1 | One persistent intent produces one op; replay uses bulk remote dispatch and effects consume `LOCAL_ACTIONS`. Capture is the sole `ALL_ACTIONS` consumer; project N+1 is ADR #5. | `local-actions.token.spec.ts`, `operation-capture.meta-reducer.spec.ts`, `operation-log.effects.spec.ts`, `task-done-replay.integration.spec.ts` | No universal intent→op property; lint/review guard common forms. Sync-critical. |
| 2 | Store appends operation contents with `add`; lifecycle paths may update only sync/rejection/application/retry metadata. | `operation-log-store.service.spec.ts` append, duplicate, synced/rejected/failed cases | No full-field immutability snapshot across every lifecycle mutation. High. |
| 3 | Hydrator restores snapshot cache then replays tail and falls back to full replay when invalid. | `operation-log-hydrator.service.spec.ts`, `compaction.integration.spec.ts`, `state-consistency.integration.spec.ts` | Equality depends on reducer/migration coverage; no state-space property test. Critical. |
| 4 | Replay coordinator preserves operation order and dispatch→yield→result→archive/checkpoint order; duplicate IDs skip. Server replay requires contiguous `serverSeq`. | `replay-coordinator.spec.ts`, applier/hydrator specs, server `op-replay.spec.ts` | Idempotence remains operation/reducer-specific. Critical. |
| 5 | Multi-entity changes execute in ordered meta-reducers and capture as one persistent action; server carries `entityIds`. | `multi-entity-atomicity.integration.spec.ts`, `meta-reducer-ordering.integration.spec.ts`, server issue-8334 tests | `no-multi-entity-effect` is a narrow warning heuristic. Critical. |
| 6 | Client/server share `@sp/sync-core` compare/merge/prune; server compares unpruned clocks before pruning/storage. | Core vector-clock tests, server conflict/SQL tests, max-size/pruning E2E | Pre-2026-06-13 rows may lack later `entityIds`. Critical compatibility residual. |
| 7 | Explicit import/backup/repair/provider-switch/clean-slate flows use causal filtering or atomic destructive replacement as specified. | import filter, import-sync, clean-slate interruption, provider-switch tests/E2E | Imports intentionally discard CONCURRENT/LESS_THAN ops. Retain product semantics. |
| 8 | Core conflict planning implements delete-wins classifier, disjoint merge, LWW fallback, archive handling, and multi-entity lookup. | Core conflict tests, disjoint/LWW integrations, archive/project-delete E2E | Opaque/partial/multi-entity cases fail closed; historical missing `entityIds`. Critical. |
| 9 | File providers use CAS/revision/hash contracts, migration markers, backup-before-overwrite, and atomic local baselines. | file adapter/provider specs; concurrency, migration, crash, WebDAV E2E | Weak/missing ETags are best-effort; LocalFile is single-writer/backup-only. High accepted limitation. |
| 10 | AES-GCM gates fail closed; provider error metadata is sanitized. | encryption/integrity specs and E2E; provider privacy and error-meta specs | Plaintext metadata is not universally AAD; generic `Log` accepts arbitrary content/error text. Critical privacy residual. |
| 11 | Server transaction serializes `lastSeq`, conflict rechecks, quota/snapshot/repair base checks, prune, and insert. | real-PostgreSQL repair-causality/conflict/clean-slate/snapshot tests | Guarantees depend on real database path; mocks are insufficient. Critical retain. |
| 12 | Schema v1–v4 migrates sequentially; newer schema blocks; backups and remote ops migrate. | shared-schema migrations, remote-processing and legacy backup/provider E2E | Architecture doc still claims v1/no migrations and future auto-merge. High documentation hazard. |
| 13 | Local capture/persistence is provider-independent; offline ops remain pending and providers retry after reconnect. | disabled trigger, network-failure integration/E2E | “Offline sync” means durable pending work, not transport without a network. Expected. |
| 14 | No analytics dependency/runtime integration found. | Negative repository search for common analytics/telemetry SDKs | No lint/test prevents later introduction. Low current, medium regression risk. |
| 15 | Providers require explicit enabled configuration; local op log is independent and structured error metadata is sanitized. | provider manager/trigger/privacy specs | Generic logger has no mandatory redaction boundary. High privacy gap. |
| 16 | Lints ban raw NgRx `Actions` in effects and require selector hydration guards; search confirms capture-only `ALL_ACTIONS`. | three local RuleTester specs and token/effect specs | Lint does not filename-allowlist `ALL_ACTIONS`; `operation-rules.md` contains an obsolete raw-Actions exception. Critical regression/docs risk. |
| 17 | Replay and project bulk loops yield after dispatch before dependent work. | replay coordinator/applier ordering specs | Project specs do not directly pin the yield; no lint. High. |
| 18 | Logical day flows through `DateService`/captured offset; reducers strip virtual `TODAY_TAG` from `task.tagIds`. | date/TODAY/planner/deadline/LWW specs and day-change integrations | No lint bans raw wall-clock use in replay-sensitive code. High replay risk. |
| 19 | `MAX_VECTOR_CLOCK_SIZE=20`; upload service checks conflicts, then prunes, then inserts. | Core boundary/tie tests, server conflict tests, max-size/pruning E2E | Docs still route pruning to older facade. Critical behavior, stale routing docs. |

A2 routed five bounded follow-ups: canonical documentation drift; append-only
lifecycle characterization; enforceable log privacy; yield/fan-out regression
coverage; and versioned encryption-metadata integrity. Destructive imports,
conflict/repair transactions, sequence allocation, delete-wins/LWW fallbacks,
provider capability differences, event-loop yields, migrations, and historical
multi-entity handling are retained complexity.

## Scenario-to-test matrix (A4)

Static inventory: 90 tagged sync E2E specs and 255 tests (73 SuperSync files /
208 tests; 17 WebDAV files / 47 tests), plus 47 client op-log integration specs,
eight server integration specs, five real-PostgreSQL-gated specs, and one
PGlite spec. No skip/fixme/only markers were found.

| Scenario family | Representative coverage | Lane / confidence / gap |
| --- | --- | --- |
| Capture→persist→hydrate→replay | capture meta-reducer, op-log effects/store/hydrator/applier; Core replay and remote-apply specs | Focused client/package unit/integration. High; no broad browser startup-crash campaign. |
| File CAS/migration/recovery | file adapter; WebDAV strong/weak ETag and conditional headers; Dropbox/OneDrive/LocalFile revision specs; WebDAV full/rapid/conflict/legacy E2E | High WebDAV/contract confidence; no real Dropbox/OneDrive/LocalFile/Android/Electron E2E. |
| SuperSync upload/download/conflict | client upload/download/orchestrator/rejected/remote specs; server conflict/download; PostgreSQL conflict cases; network/error/LWW E2E | High layered coverage; one browser “remote wins” assertion proves convergence but not winning payload. |
| Snapshot/repair/quota | server snapshot/replay/download/quota/cleanup specs; PostgreSQL snapshot clock; snapshot/compaction/backup/quota E2E | High snapshot/quota; repair-causality PostgreSQL spec is not selected by current lanes. |
| WebSocket/realtime | client WebSocket/download trigger; server connection/routes/storm; realtime-push E2E | High Chromium/server; no native suspend/reconnect runtime. |
| Encryption/integrity | Core crypto/KDF/integrity; plaintext gates; upload key gates; import/password specs; SuperSync/WebDAV encryption E2E | High contracts/Chromium; no mobile secure-storage runtime E2E. |
| Imports/backups/clean slate | Core/app import filters, backup/clean-slate specs, interruption/vector-reset integrations, PostgreSQL atomicity, provider E2E | High including interruption and replacement. |
| Convergence/delete-wins/disjoint/archive/multi-entity | Core disjoint planner, app conflict/archive/partial compensation, atomicity/cross-entity integrations, delete/archive/tag E2E | High; compatibility barriers rely on shared-schema tests not selected by root package CI. |
| Provider switching | provider-switch integration, wrapper clock bridge, WebDAV↔SuperSync and re-enable/account-switch E2E | High for WebDAV/SuperSync; no other-provider switching E2E. |
| Logical day/virtual TODAY | plan/day-change/config hydration/TODAY reducer integrations; overdue/planner/WebDAV E2E | High for replay/Chromium timezone boundaries. |
| Native/background | trigger, Android bridge, native HTTP retry, Android SAF and LocalFile unit specs | Medium-low runtime confidence; no Android/iOS/Electron sync E2E. |
| Privacy/logging | provider error-meta, action logger, validation log, logger adapter, credential store specs | High sanitizer-level, medium system-level; no E2E exports and scans diagnostics. |

Commands remain non-executed audit references:

```sh
npm run test:file <client-spec>
npm --prefix packages/<package> test -- <spec>
npm --prefix packages/super-sync-server run test:integration:postgres
npm run e2e:supersync:file -- e2e/tests/sync/<spec> --retries=0 --grep "<name>"
npm run e2e:webdav:file -- e2e/tests/sync/<spec> --retries=0 --grep "<name>"
```

A4 routing gaps: three server integration specs lack an explicit lane;
`packages:test` omits shared-schema tests; runtime/provider E2E is narrow; and
privacy has no system-level exported-diagnostics assertion.

## A6 external issue reconciliation

After explicit user authorization, the coordinator performed a connector-first,
read-only pass against `super-productivity/super-productivity`. All 49 unique
issue references admitted by the local prior-work sources resolved: 36 were
open and 13 closed at retrieval time. Historical extraction PR `#7546` was
verified closed and merged. A further 38 repository-scoped searches covered the
local signals and exact implementation/spec terms. Exact matches, adjacent
issues, closed/completed work, and negative searches are recorded separately in
[`retained.md`](retained.md); issue state was not treated as proof of current
code behavior. No issue, PR, label, comment, workflow, branch, or remote state
was changed.

This closes the only external-coverage blocker from Wave A. Exact searches did
not find issue matches for the Dropbox SCC, the `recover-user` deep import,
three unselected server integration specs, the one-shot passkey migration,
transport result flag bags, or a system-level diagnostic-export privacy test.
Those remain audit candidates rather than being mislabeled as already tracked.

## Wave B run ledger

Wave B uses 51 primary runs. Owners B01–B33 and B37 each fit one run. Four
larger owners are split below by owner-local bytewise row number from the frozen
`ownership.tsv`; path hashes are SHA-256 over `path + LF`. These 17 slices
replace the four unsplit owner runs, so all primary cohorts remain at or below
60 files.

| Run | Owner-local rows | Files | First path | Last path | Path-list SHA-256 |
| --- | ---: | ---: | --- | --- | --- |
| B34.1 | 1–43 | 43 | `packages/super-sync-server/.gitignore` | `packages/super-sync-server/src/sync/sync.types.ts` | `1ef64037efb43ee8b7411fafe821f6cef2e49eca0ed6dce3aeeb7a3d7b981328` |
| B34.2 | 44–85 | 42 | `packages/super-sync-server/src/sync/websocket.routes.ts` | `packages/super-sync-server/tests/websocket.routes.spec.ts` | `3c632e0172e262d5251cc67af9cb170426e741d33cb80dfb92a48b36d292242e` |
| B35.1 | 1–54 | 54 | `ARCHITECTURE-DECISIONS.md` | `src/app/core-ui/shortcut/shortcut.service.spec.ts` | `5436936501a56cd75c03b65051486d354a52797320b18746276a0d00493f1cda` |
| B35.2 | 55–108 | 54 | `src/app/core-ui/shortcut/shortcut.service.ts` | `src/app/features/android/store/android-widget.effects.spec.ts` | `a887e32c65b90867786abc149c75dc682403cf6cba5643be3ce62d0e0ce598d2` |
| B35.3 | 109–162 | 54 | `src/app/features/android/store/android-widget.effects.ts` | `src/app/features/issue/store/poll-to-backlog.effects.spec.ts` | `c4a8f3c1e73937d288d892da22dcd53869429114eacb577a0e0f29dda91ab550` |
| B35.4 | 163–216 | 54 | `src/app/features/issue/store/poll-to-backlog.effects.ts` | `src/app/features/project/store/project.selectors.ts` | `1711eb2fd1ebabd6a1511d573e6c0fd6718a1038befb8aac951530eba4387fd3` |
| B35.5 | 217–269 | 53 | `src/app/features/reminder/migrate-legacy-task-reminders.util.spec.ts` | `src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.html` | `ce6fb539598fd7d5d0f3dca6a7a52e08aee613b9e32b4670e14c348e2e137bfe` |
| B35.6 | 270–322 | 53 | `src/app/features/tasks/dialog-view-task-reminders/dialog-view-task-reminders.component.scss` | `src/app/features/work-context/store/work-context.selectors.spec.ts` | `5ff2d0d896a4d089f4cc799606d1efeb7934a06b52a7dc1a50680c6853498407` |
| B35.7 | 323–375 | 53 | `src/app/features/work-context/store/work-context.selectors.ts` | `src/app/root-store/meta/action-logger.reducer.spec.ts` | `ea8838b492ea6af1481fcbc4f66c7ce3c475039bf1fd75e024ed5bcebf28f14f` |
| B35.8 | 376–428 | 53 | `src/app/root-store/meta/action-logger.reducer.ts` | `src/app/ui/dialog-confirm/dialog-confirm.component.html` | `8436daec7b4439a855e17d4c2cc0527e88a7aeaef4b4d20e5dd34553a94ecb04` |
| B35.9 | 429–481 | 53 | `src/app/ui/dialog-confirm/dialog-confirm.component.scss` | `src/app/util/wait-for-sync-window.operator.ts` | `48a8011021d7da82a1b15535dc9528a64a31edc5a1f4fed272841f31c58e4925` |
| B36.1 | 1–47 | 47 | `docs/sync-and-op-log/supersync-scenarios-flowchart.md` | `e2e/tests/sync/supersync-encryption-conflict.spec.ts` | `ea18b4830747db0f661e444155dddf580f91e04f19d446b0df6440ae261596d6` |
| B36.2 | 48–93 | 46 | `e2e/tests/sync/supersync-encryption-password-change.spec.ts` | `e2e/tests/sync/supersync-use-remote-crash-resume.spec.ts` | `77a3a3eaaaeb29113e65690bf1cb7804c16a455e2e07b5874fe07f14265f516b` |
| B36.3 | 94–139 | 46 | `e2e/tests/sync/supersync-vector-clock-max-size.spec.ts` | `src/app/op-log/testing/integration/day-change-sync-conflict.integration.spec.ts` | `6340f63f5ae0d9035a6744673eb9192f2084cb6261d7250fa65f453c37a8fae3` |
| B36.4 | 140–185 | 46 | `src/app/op-log/testing/integration/example-task-import-gate.integration.spec.ts` | `src/app/op-log/testing/integration/vector-clock-sync.integration.spec.ts` | `0aecb8e7febc7ec2cc05a3494d69dae984dfd567be388eac5d48676d469adc9a` |
| B38.1 | 1–42 | 42 | `docs/long-term-plans/supersync-encryption-at-rest.md` | `packages/super-sync-server/prisma/migrations/0_init/migration.sql` | `79c4c603596316c513c1159097c9bbddfd221b30f0405844cf44376dfb9d2f83` |
| B38.2 | 43–84 | 42 | `packages/super-sync-server/prisma/migrations/20251212000000_add_is_payload_encrypted/migration.sql` | `packages/super-sync-server/tools/test-environment-setup.sh` | `ddabf9fbf73e7b9b93d68a8995cbe13f792b43576ae3f97302d4e7b374990e5e` |

The first B35.6 attempt is invalid and does not satisfy Wave B. Although it
read all 53 owned paths, it substantively opened 67 distinct files: the 53
owned paths, two governing documents, and twelve support/control files. This
exceeded the immutable 60-file cap. Its provisional observations remain
`discovered/proposed, unverified`; they received no origin IDs or completion
credit from that attempt.

A separate clean B35.6 replacement reproduced the baseline and the ordered
53-path slice hash, then completed at exactly 60 substantive files: 53 owned
paths, three required references, and four support files. It independently
produced B35-C39–C43 and B35.6-R01–R05, with the remaining observations routed
as `discovered/proposed, unverified`. The conflicting five-record block from
the invalid first pass was removed rather than granted origin IDs. The
replacement performed no writes, tests, services, network calls, or Git
mutations, and its after-baseline matched, so all 53 B35.6 ownership rows are
`wave-b-complete` on that clean run only.

B35.9 had two invalid attempts. An interrupted attempt left four provisional
origin records but no terminal baseline/file-count report. A subsequent run
stopped at 63 substantive files (53 owned, three mandated references, three
audit/control documents, and four caller/lint supports), exceeding the cap
before its after-baseline check. The four records remain
`discovered/proposed, unverified` from those attempts; their premature
completion markers were reverted.

A stricter clean B35.9 replacement reproduced the baseline and ordered slice
hash and completed at 57 substantive files: 53 owned paths, two governing
documents, and two skill instruction files, with no adjacent proof or audit-
artifact content files. It independently produced B35-C35–C38 and
B35.9-R01–R03 and routed all other observations as `discovered/proposed,
unverified`. It performed no writes, tests, services, network calls, or Git
mutations. The after-baseline matched, so all 53 B35.9 ownership rows are
`wave-b-complete` on the replacement run only.

## Wave B exit gate

Wave B passed on the clean primary-run ledger. All 1,442 manifest paths have
exactly one owner and status `wave-b-complete`; owner totals reproduce the
frozen A3 allocation and the header-excluded path-list hash reproduces
`7d38cfa9f7a06d9f4da3be822c715ee01e418956a71251798cede66fbb1144bb`.
The repository fingerprint also reproduces HEAD `104043e2d220336d37c96623229640233093f045`,
the empty tracked-diff hash, the frozen-plan hash, and the sole in-scope
untracked plan path. All 213 origin candidate packets have non-placeholder
revision hashes, and direct self-normalized recomputation reported 213 matches
and zero mismatches.

This gate establishes complete primary-domain coverage only. Under the fast-
track amendment, it does not establish exhaustive cross-cutting verification;
only C1, C3, C6, C7, and C8 follow, while B23–B30 supply the bounded C5
provider-duplication evidence.

## Fast-track C5 substitution — B23–B30 provider evidence

Per the execution amendment, the completed B23–B30 primary-domain reports are
the provider-duplication review; no standalone C5 run is authorized. Together
they cover provider host/credentials/OAuth, file envelopes and conditional
writes, WebDAV/Nextcloud, Dropbox, OneDrive/LocalFile/platform bridges,
SuperSync/WebSocket, sync-core algorithms, and shared provider infrastructure.

The evidence supports narrow ownership consolidation only: examples include a
single Dropbox refresh owner, removal of app-local forwarding/cache-header
residue, canonical retry-classifier tests, and deletion of behavior-identical
OneDrive error branches. It does not support a generic provider request/auth
facade. Native versus web transport, OAuth and refresh lifecycles, WebDAV
conditional-write/disappearance semantics, Dropbox throttling and metadata,
OneDrive Graph/PKCE constraints, LocalFile/Android SAF capabilities,
SuperSync WebSocket/session rules, encryption, and provider-specific error
classification remain explicit protocol/platform policy.

The origin records are B23-C01–C05, B24-C01–C02, B25-C01–C03,
B26-C01–C04, B27-C01–C05, B28-C01–C04, B29-C01–C05, and B30-C01–C04,
with the matching B23–B30 retain sections. This substitution links those
records; it does not duplicate or independently verify them, and it makes no
claim of exhaustive cross-cutting provider verification.

## Fast-track Wave C reports

All five authorized reports reproduced baseline `9b448133…` before and after,
made no source or audit edits, ran no tests or services, and stayed within the
60-file cap. They mechanically enumerated the complete origin register before
reopening bounded evidence; their results are evidence-led cross-links, not a
claim of exhaustive A1 cross-cutting verification.

### C1 — dead and no-value surfaces

C1 inspected 35 substantive files, recomputed all 213 then-current origin
hashes with zero mismatches, linked 65 explicitly tagged and 18 mechanically
matched records, and created no new packet. Its strongest D-review signals are
B35-C35, B09-C01, B33-C01, the coordinated B05-C01/B05-C02/B06-C01 store-port
bundle, and the separately bounded B36-C02/B36-C11/B36-C20 harness slices.
B13-C01, B20-C01, and B35-C40 remain reserves pending external/deep-import,
sync-review, or compatibility closure.

C1 rejected monorepo zero-use as sufficient evidence for public package
exports, passkey repair, plugin loading, packaged Electron IPC, archive timing,
native reminder behavior, destructive encryption paths, and persisted formats.
Those and every other non-shortlisted C1 observation remain
`discovered/proposed, unverified`.

### C3 — compatibility and rollout closure

C3 used exactly 60 substantive files and linked a 94-origin compatibility net
without creating a new packet. Its strongest bounded D-review signals are
B13-C01, B35-C40, B24-C01, B10-C05, and the narrowed B31-C01 surface. It
confirmed that B24-C01 may stop emitting an unread snapshot revision only while
retaining optional read tolerance and historical fixtures, and that B31-C01
must preserve live `getCurrentVersion()`.

C3 blocked native SQLite activation, file-format retirement, schema migration
retirement, passkey-repair deletion, password-reset URL removal, Android bridge
ABI removal, package-export pruning, Helm API removal, and serial-upload
retirement without their explicit fleet/deployment/version/operator gates.
Every blocked or non-shortlisted C3 observation remains
`discovered/proposed, unverified`.

### C6 — test and harness duplication

C6 inspected 18 substantive files, linked 70 explicitly tagged plus five
additional test-focused origins, and created no new packet. Its strongest
D-review signals are B15-C04, B06-C03, B16-C01, B36-C09, and B35-C17, with
B36-C13 conditional on recording deterministic same-second WebDAV concurrency
as uncovered.

C6 materially challenged B36-C10's replacement owner and rejected wholesale
deletion of B35-C30, B36-C16, B36-C17, broad B20-C02 consolidation, and generic
fixed-wait/direct-locator cleanup. B34-C06 requires a real WebSocket-boundary
prototype; B35-C39 requires packaged Electron coverage; B35-C42 must not be
represented as owner-level timezone coverage. Every challenged or non-
shortlisted C6 observation remains `discovered/proposed, unverified`.

### C7 — canonical documentation ownership

C7 inspected 54 substantive files, linked 17 explicitly tagged origins plus
B02-C01, and created no new packet. It reproduced the stale raw-`Actions` and
generic entity-change prose in `operation-rules.md`; the contributor sync model
is canonical. It also reproduced removed server-database tombstones and the
obsolete `lastKnownSeq` name in the indexed server diagram, while correcting an
over-broad hypothesis: GET snapshot is removed, but POST snapshot, GET status,
restore-point, and restore routes remain active. File-sync compatibility
tombstones are a distinct retained mechanism.

Its strongest bounded D-review signals are B06-C04, B04-C05, B36-C01,
B36-C08, and B36-C09. B35-C01 and B20-C04 require two sync-aware reviewers;
B34-C07/B23-C05 require canonical-diagram correction and unique-content
inventory first; B07-C03, B38-C02, and B38-C05 retain rollout, ops/security, or
operator/privacy gates. All non-shortlisted C7 observations remain
`discovered/proposed, unverified`.

### C8 — privacy, errors, configuration, and platforms

C8 used exactly 60 substantive files, manually triaged the then-current 213
origins, and added the independently bounded C8-N01 packet. It links the shared
JSON content-retention mechanism under B01-C05 with B22-C03, while keeping the
non-overlapping B16-C05, B23-C04, B28-C03, B35-C14, B35-C20, and B35-C37 sinks
separate. Strong D-review signals are C8-N01, B23-C04, the bounded content-log
packets B12-C03/B35-C14/B35-C20, the structured-metadata packets
B16-C05/B28-C03/B35-C37, B35-C05, and B23-C01.

C8 did not promote native WebDAV URL/body-preview logging, `errorMeta` override
behavior, `urlPathOnly()` invalid-input fallback, plugin-defined log values, or
passkey-repair deletion without complete caller/deployment evidence. Raw error
messages used for retry/recovery and real Electron/Android/iOS/native/fetch
behavior differences remain retained. All such non-shortlisted observations
remain `discovered/proposed, unverified`.

## Fast-track Wave C exit gate

Wave C passed the amended scope: C1, C3, C6, C7, and C8 completed within their
caps, and the B23–B30 substitution supplies the authorized bounded C5 evidence.
Standalone C2, C4, and C5 were not run. The origin register now contains 214
unique IDs including C8-N01; D1 must recompute every revision hash and assign
stable IDs before admission. This gate makes no exhaustive cross-cutting claim.

## D1 — stable-ID and prior-work normalization

D1 ran separately, as required by the execution amendment. Its read-only pass
reproduced the baseline and authoritative findings SHA
`83acd393736396f8b9de33b961dbab82347443fd8fa9e9f410cb5fc5aab0c8e9`
before and after, opened six substantive files (the frozen plan and five
coordinator artifacts), and ran no tests, services, network calls, source
writes, or Git mutations. All 214 stored candidate revision hashes recomputed
against the self-normalized packet bytes.

Exact document order defines the stable-ID sequence. A first-seen canonical
origin receives the next gapless ID; a strict alias reuses its canonical
origin's ID. D1 found 212 stable groups and only two strict aliases:

- `B22-C03 → B01-C05` under `SSA-0025`;
- `B30-C01 → B23-C03` under `SSA-0091`.

Related or dependent records were deliberately not merged, including
`B29-C04/B20-C02`, `B37-C01/B01-C01`,
`B36-C05/B22-C01`, `B28-C03/C8-N01`,
`B35-C24/B35-C22`, `B15-C03/B29-C01`,
`B06-C01/B06-C02`, `B06-C01/B07-C01`,
`B17-C01/B17-C04`, `B13-C02/B13-C04`,
`B18-C01/B18-C03`, and `B25-C01/B25-C03`.
They retain separate evidence, invariants, and implementation boundaries.

The frozen mapping below has 214 rows, 212 distinct stable IDs, and 66 rows
with prior-work or related-record links. Its exact no-header, final-LF TSV is
19,322 bytes with SHA-256
`4904a4cbf41d6b1c328e5f63e27f0d12242f1fa10c31edf654b617833cf4aa2a`.
Columns are `stable_id`, `origin_id`, `canonical_origin`, `dedupe_key`,
and `prior_work_or_dash`. The mapping assigns stable IDs without rewriting
the immutable origin packets or their revision hashes.

```tsv
SSA-0001	B02-C01	B02-C01	capture-docs::state-diff-and-order-rationale	#8760,#8962,A6-PW-006
SSA-0002	B05-C01	B05-C01	oplog-store::superseded-two-phase-dedup-api	-
SSA-0003	B05-C02	B05-C02	oplog-store::orphaned-convenience-wrappers	-
SSA-0004	B05-C03	B05-C03	oplog-store::remote-status-query-fallback	-
SSA-0005	B05-C04	B05-C04	snapshot-entity-keys::focused-utility-tests	-
SSA-0006	B05-C05	B05-C05	oplog-idb-lifecycle::adopt-connection-rollout	A6-PW-008,#7931,#7956,#8358,#8746
SSA-0007	B06-C01	B06-C01	oplog-db-port::unused-convenience-methods	A6-PW-008,#7931
SSA-0008	B06-C02	B06-C02	oplog-db-tests::shared-idb-sqlite-contract	A6-PW-008,#7931
SSA-0009	B06-C03	B06-C03	db-upgrade-tests::duplicate-final-shape	-
SSA-0010	B06-C04	B06-C04	oplog-schema-docs::indexeddb-descriptor-consumption	A6-PW-015
SSA-0011	B02-C02	B02-C02	capture-meta::get-operation-capture-service	-
SSA-0012	B02-C03	B02-C03	capture-tests::effects-unused-scaffolding-single-deferred	-
SSA-0013	B03-C01	B03-C01	remote-archive-postpass::remoteArchiveDataApplied::no-active-consumer	-
SSA-0014	B03-C02	B03-C02	bulk-replay-naming::deprecated-hydration-aliases::internal-test-only	-
SSA-0015	B03-C03	B03-C03	operation-apply-contract::duplicated-app-core-result-options::single-type-owner	A6-PW-002,A6-PW-005
SSA-0016	B04-C01	B04-C01	archive-flush::local-young-old-write::atomic-adapter	#8843
SSA-0017	B04-C02	B04-C02	archive-mutex::is-ignore-db-lock::inert-flag-threading	#8941
SSA-0018	B04-C03	B04-C03	task-archive-api::get-by-id-batch::test-only	-
SSA-0019	B04-C04	B04-C04	archive-tests::timezone-demo::get-db-date-str-owner	-
SSA-0020	B04-C05	B04-C05	archive-docs::separate-indexeddb-claim::sup-ops-stores	#8760
SSA-0021	B01-C01	B01-C01	entity-registry::complete-regular-keyset::app-registry	#8752,#8299
SSA-0022	B01-C02	B01-C02	error-surface::unreferenced-app-sync-errors	#8326,#8325,#8510
SSA-0023	B01-C03	B01-C03	model-types::unknown-json-union-and-duplicate-map	#8326,A6-PW-005
SSA-0024	B01-C04	B01-C04	entity-key::unused-app-parser-and-duplicate-tests	#7546,A6-PW-005
SSA-0025	B01-C05	B01-C05	privacy::json-parse-error::plaintext-data-sample	#7619,#7870
SSA-0026	B09-C01	B09-C01	compact-codec::operation-log-entry-half::test-only	-
SSA-0027	B09-C02	B09-C02	action-code-tests::duplicate-count-inverse-roundtrip	-
SSA-0028	B09-C03	B09-C03	compaction-tests::duplicate-lock-race-timeout-orchestration	-
SSA-0029	B09-C04	B09-C04	snapshot-tests::repeated-validation-and-migration-happy-path	-
SSA-0030	B08-C01	B08-C01	hydration-api::dead-data-init-hydrator-facades	A6-PW-003
SSA-0031	B08-C02	B08-C02	hydrator::last-full-state-direct-load	A6-PW-003
SSA-0032	B08-C03	B08-C03	hydrator::inert-startup-hooks-and-di	pr-8588
SSA-0033	B08-C04	B08-C04	snapshot-anchor::append-returned-sequence	-
SSA-0034	B08-C05	B08-C05	sync-hydration-tests::local-only-round-trip-matrix	-
SSA-0035	B07-C01	B07-C01	oplog-db-port::unused-readonly-transaction-mode	-
SSA-0036	B07-C02	B07-C02	sqlite-adapter::missing-insert-rowid-fallback	-
SSA-0037	B07-C03	B07-C03	sqlite-migration-docs::duplicate-stale-status	A6-PW-015,#8760,#8962
SSA-0038	B10-C01	B10-C01	backup-import::verified-recovery-id-without-legacy-flags	A5-R04,#7709,#8107
SSA-0039	B10-C02	B10-C02	complete-backup::mandatory-archive-inclusive-snapshot	-
SSA-0040	B10-C03	B10-C03	state-snapshot::pfapi-era-method-and-class-aliases	A5-C01,#8326
SSA-0041	B10-C04	B10-C04	legacy-backup-v10::work-context-time-tracking-extractor	A5-R04
SSA-0042	B10-C05	B10-C05	legacy-pf-db::orphan-save-archive-and-clear-all	A5-R05,#8326
SSA-0043	B12-C01	B12-C01	entity-state-util::fix-or-error::test-only	-
SSA-0044	B12-C02	B12-C02	repair-service::empty-summary::test-only-static-api	A6-PW-015
SSA-0045	B12-C03	B12-C03	repair-logging::orphan-task-arrays::exportable-history	5772b3416c,GHSA,#7619,#7870
SSA-0046	B12-C04	B12-C04	auto-fix-tests::time-number-probe::canonical-owner	-
SSA-0047	B12-C05	B12-C05	validation-tests::hibernate-repro::canonical-cross-model-suite	-
SSA-0048	B14-C01	B14-C01	lock-service-tests::current-web-lock-and-fallback-matrix	#7700
SSA-0049	B14-C02	B14-C02	operation-sync-util-tests::exhaustive-classification-and-conversion-matrix	-
SSA-0050	B14-C03	B14-C03	operation-log-sync-spec::typed-operation-download-provider-fixtures	A6-PW-003
SSA-0051	B11-C01	B11-C01	cross-model-validation::dead-legacy-scaffolding	-
SSA-0052	B11-C02	B11-C02	state-validity-tests::repeated-validity-assertion-boilerplate	B08-C05
SSA-0053	B17-C01	B17-C01	remote-op-migration::dead-dropped-entity-tracking	-
SSA-0054	B17-C02	B17-C02	superseded-resolver::redundant-per-item-existing-clock	-
SSA-0055	B17-C03	B17-C03	rejected-ops-handler-spec::retry-budget-state-matrix	B14-C03
SSA-0056	B17-C04	B17-C04	remote-processor-spec::collaborator-conflict-algorithm-copy	-
SSA-0057	B17-C05	B17-C05	superseded-resolver-spec::actual-batch-port-and-object-matrix	B14-C03
SSA-0058	B13-C01	B13-C01	sync-shell-contracts::orphan-pfapi-constants-and-types	-
SSA-0059	B13-C02	B13-C02	sync-wrapper::dead-wait-facade-and-status-getter	A6-PW-003
SSA-0060	B13-C03	B13-C03	sync-wrapper-di::unused-reminder-service	-
SSA-0061	B13-C04	B13-C04	sync-trigger::resettable-delay-subject-audittime	-
SSA-0062	B13-C05	B13-C05	sync-wrapper-spec::provider-status-testbed-copies	-
SSA-0063	B15-C01	B15-C01	op-download-result::dead-failed-file-count	-
SSA-0064	B15-C02	B15-C02	op-download::single-use-api-wrapper	-
SSA-0065	B15-C03	B15-C03	initial-download::duplicate-full-state-migration-plan	-
SSA-0066	B15-C04	B15-C04	op-download-spec::duplicate-gap-key-refresh-case	-
SSA-0067	B15-C05	B15-C05	op-download-spec::repeated-server-operation-literals	B14-C03
SSA-0068	B16-C01	B16-C01	immediate-upload-spec::wall-clock-debounce-failure	-
SSA-0069	B16-C02	B16-C02	op-upload-service::unused-result-reexports	-
SSA-0070	B16-C03	B16-C03	op-upload-spec::full-state-retry-case-copies	-
SSA-0071	B16-C04	B16-C04	write-flush-spec::vacuous-fifo-case	B14-C01
SSA-0072	B16-C05	B16-C05	upload-logging::raw-provider-error-content	-
SSA-0073	B19-C01	B19-C01	journal-outcome-emission::parallel-lww-and-merged-hooks	#8937
SSA-0074	B19-C02	B19-C02	journal-review-lifecycle::reserved-expired-never-emitted	-
SSA-0075	B19-C03	B19-C03	journal-test-data::five-inline-entry-builders	-
SSA-0076	B19-C04	B19-C04	mobile-conflict-dialog-layout::copied-local-ng-deep-overrides	#8936
SSA-0077	B20-C01	B20-C01	vector-clock-service::unused-get-full-vector-clock	pr-8588,ebd612200f
SSA-0078	B20-C02	B20-C02	sync-import-filter-tests::classifier-vs-orchestration-ownership	B14-C03
SSA-0079	B20-C03	B20-C03	vector-clock-pruning-tests::removed-heuristic-replica	B20-C02
SSA-0080	B20-C04	B20-C04	vector-clock-docs::current-atomic-reset-and-filter-lifecycle	A5-C05,A6-PW-015,#8760,#8962
SSA-0081	B21-C01	B21-C01	full-state-meta::derived-latest-after-status-aware-reader	B06-R02,B05-R02,B05-R03
SSA-0082	B21-C02	B21-C02	snapshot-upload::obsolete-low-level-public-facade	A6-PW-003
SSA-0083	B18-C01	B18-C01	conflict-service::post-extraction-helper-facades-and-copy-tests	B17-C04,#8937
SSA-0084	B18-C02	B18-C02	conflict-service-spec::duplicate-archive-wins-block	-
SSA-0085	B18-C03	B18-C03	conflict-service-spec::generic-entity-smokes-vs-registry-branches	-
SSA-0086	B18-C04	B18-C04	conflict-service-spec::clock-skew-case-copies	-
SSA-0087	B22-C01	B22-C01	supersync-encryption::ui-hidden-disable-rejected-by-mandatory-guard	-
SSA-0088	B22-C02	B22-C02	import-encryption::generic-bidirectional-state-for-one-way-enable	-
SSA-0025	B22-C03	B01-C05	sync-json-errors::raw-decrypted-data-sample	B16-C05,B01-C05,#7619,#7870
SSA-0089	B23-C01	B23-C01	oauth-dialog::reverted-native-ui-branch	-
SSA-0090	B23-C02	B23-C02	wrapped-provider-cache::dead-manual-clear	pr-8588,ebd612200f
SSA-0091	B23-C03	B23-C03	credential-store::unused-app-change-callback	-
SSA-0092	B23-C04	B23-C04	provider-host-logging::credential-and-callback-values	B16-C05,B23-C03
SSA-0093	B23-C05	B23-C05	sync-docs::duplicated-stale-provider-comparison	-
SSA-0094	B26-C01	B26-C01	dropbox-token-refresh::duplicated-provider-wrapper	-
SSA-0095	B26-C02	B26-C02	dropbox-metadata::unused-sdk-contract	-
SSA-0096	B26-C03	B26-C03	dropbox-dead-code::check-user-and-file-path-constants	-
SSA-0097	B26-C04	B26-C04	dropbox-oauth::impossible-null-result	-
SSA-0098	B24-C01	B24-C01	file-envelope::snapshot-ref-rev::write-only-best-effort-pointer	A5-R06,A6-PW-010
SSA-0099	B24-C02	B24-C02	file-download-gap::v2-v3-copied-causal-policy	A6-PW-007,#8759
SSA-0091	B30-C01	B23-C03	credential-store::unused-clear-and-change-hooks	B23-C03
SSA-0100	B30-C02	B30-C02	sync-providers-exports::test-only-log-subpath	6797e9eed2
SSA-0101	B30-C03	B30-C03	provider-auth-helper::redundant-code-verifier-output	B23-C01,B26-C04
SSA-0102	B30-C04	B30-C04	provider-tests::retry-classifier-case-tables	087b9dd43f
SSA-0103	B31-C01	B31-C01	schema-migration-app::dead-alias-and-inspection-api	-
SSA-0104	B31-C02	B31-C02	shared-schema-api::unused-batch-inspection-exports	6797e9eed2
SSA-0105	B31-C03	B31-C03	shared-schema-tests::vacuous-mock-and-duplicate-cases	-
SSA-0106	B27-C01	B27-C01	local-file::dead-directory-probe-ipc	#8228
SSA-0107	B27-C02	B27-C02	android-saf::unused-check-file-exists-bridge	-
SSA-0108	B27-C03	B27-C03	onedrive-deps::unused-platform-info	-
SSA-0109	B27-C04	B27-C04	onedrive-app::type-forwarding-shim	-
SSA-0110	B27-C05	B27-C05	onedrive-errors::unreachable-and-pass-through-branches	-
SSA-0111	B25-C01	B25-C01	webdav-upload-verify::caller-cache-header-duplicates-platform-adapter	-
SSA-0112	B25-C02	B25-C02	webdav-read-surface::unused-listing-metadata-dom-parser	B30-R02
SSA-0113	B25-C03	B25-C03	webdav-http-status::reintroduced-conditional-download-304-path	-
SSA-0114	B37-C01	B37-C01	entity-registry-lint::unreachable-registry-check	#8752,B01-C01
SSA-0115	B37-C02	B37-C02	root-dependencies::orphaned-patch-package	#8843
SSA-0116	B37-C03	B37-C03	root-dependencies::ignored-yarn-resolutions	#8843
SSA-0117	B37-C04	B37-C04	ci-e2e-setup::main-job-copy	-
SSA-0118	B28-C01	B28-C01	supersync-validation::double-validator-adapter	A6-PW-001
SSA-0119	B28-C02	B28-C02	supersync-websocket::intentional-close-duplicate-state	-
SSA-0120	B28-C03	B28-C03	sync-diagnostics::raw-websocket-error-and-reason	B16-C05,C8-N01
SSA-0121	B28-C04	B28-C04	supersync-status-tests::repeated-truth-table-and-expiry-setup	-
SSA-0122	B32-C01	B32-C01	server-upload-conflict-code::three-path-wire-mapping	-
SSA-0123	B32-C02	B32-C02	server-upload-prune::serial-inline-vs-shared-helper	-
SSA-0124	B32-C03	B32-C03	server-conflict-entry::duplicate-full-state-and-entity-normalization	-
SSA-0125	B32-C04	B32-C04	server-upload-piggyback::cached-normal-result-fetch-duplication	-
SSA-0126	B29-C01	B29-C01	download-planning::single-boolean-wrapper::gap-and-encryption-state	-
SSA-0127	B29-C02	B29-C02	upload-sequence-plan::duplicate-derived-fields::single-seq-reason	-
SSA-0128	B29-C03	B29-C03	encryption-decrypt::duplicated-single-vs-batch-state-machine::one-batch-path	-
SSA-0129	B29-C04	B29-C04	sync-import-filter-spec::exact-boundary-case-duplicates::single-core-owner	B20-C02
SSA-0130	B29-C05	B29-C05	vector-clock-spec::scale-only-and-no-flip-duplicates::algebra-contract	-
SSA-0131	B38-C01	B38-C01	server-env-example::dotfile-vs-production-example::single-authoritative-file	-
SSA-0132	B38-C02	B38-C02	server-encryption-at-rest::abandoned-live-and-archive-snapshots::decision-record	A6-PW-013
SSA-0133	B38-C03	B38-C03	helm-single-replica::noop-hpa-pdb-controls::fixed-replica-contract	-
SSA-0134	B38-C04	B38-C04	helm-database-env::migrator-app-exact-duplication::single-template	-
SSA-0135	B34-C01	B34-C01	gzip-boundary::dead-standalone-decompress-helper::compressed-body-parser	-
SSA-0136	B34-C02	B34-C02	device-lifecycle::test-only-owner-and-user-list-queries::device-service	#8498
SSA-0137	B34-C03	B34-C03	auth-email::repeated-transport-send-log-fallback::email-ts	-
SSA-0138	B34-C04	B34-C04	cors-policy::duplicate-origin-map-catch-branches::config-ts	-
SSA-0139	B33-C01	B33-C01	server-snapshot::dead-cached-read	A6-PW-017
SSA-0140	B33-C02	B33-C02	storage-quota::single-reconcile-body	-
SSA-0141	B33-C03	B33-C03	server-download-tests::snapshot-fast-forward-owners	-
SSA-0142	B33-C04	B33-C04	server-download-tests::production-sql-path	-
SSA-0143	B35-C01	B35-C01	android-background-roadmap::unsafe-reminder-cursor-as-state-cursor::rejection-note	-
SSA-0144	B35-C02	B35-C02	android-background-sync::single-implementation-provider-interface::direct-concrete-class	-
SSA-0145	B35-C03	B35-C03	main-header::post-extraction-dead-state-and-constant-route-stream	-
SSA-0146	B35-C04	B35-C04	component-styles::parent-scoped-child-selector-residue::emulated-encapsulation	-
SSA-0147	B35-C05	B35-C05	perimeter-contracts::zero-consumer-and-no-op-constants::remove-zombies	-
SSA-0148	B38-C05	B38-C05	supersync-monitoring-docs::docker-and-script-manuals::single-canonical-runbook	-
SSA-0149	B38-C06	B38-C06	supersync-image-provenance::deploy-and-publish-duplicate-shell-guards::shared-owner	-
SSA-0150	B38-C07	B38-C07	passkey-storage-migration::manual-double-encoding-repair::retire-after-data-gate	-
SSA-0151	B36-C01	B36-C01	e2e-docs::orphaned-encryption-failure-memo	-
SSA-0152	B36-C02	B36-C02	e2e-fixture::unused-describe-and-client-tracking-apis	-
SSA-0153	B36-C03	B36-C03	e2e-helpers::duplicate-archive-worklog-spec-functions	-
SSA-0154	B36-C04	B36-C04	e2e-scenarios::sequential-concurrent-import-duplicates	-
SSA-0155	B36-C05	B36-C05	e2e-page-object::orphaned-supersync-encryption-controls	B22-C01
SSA-0156	B34-C05	B34-C05	retired-password-auth::orphaned-page-asset-and-tests::password-reset-remnants	-
SSA-0157	B34-C06	B34-C06	websocket-auth::copied-handler-test-double::websocket-routes-spec	-
SSA-0158	B34-C07	B34-C07	sync-architecture::parallel-mermaid-sources::package-and-canonical-diagrams	-
SSA-0159	B35-C06	B35-C06	banner-singleton::redundant-dismiss-all-and-debug-tombstone::banner-service-startup	-
SSA-0160	B35-C07	B35-C07	android-foreground-tests::removed-pfapi-immediate-save-replicas::obsolete-spec-blocks	-
SSA-0161	B35-C08	B35-C08	core-log::unused-global-context-and-x-helper::direct-log-surface	-
SSA-0162	B35-C09	B35-C09	snack-render::vacuous-type-switch::single-open-from-component	-
SSA-0163	B35-C10	B35-C10	boards-panel-update::unconsumed-full-panel-action-and-commented-reducer::task-id-update-path	-
SSA-0164	B35-C11	B35-C11	focus-break-effects::unused-config-with-latest-from::complete-and-skip-break	-
SSA-0165	B35-C12	B35-C12	focus-effects-spec::duplicate-scenarios-and-tautological-sync-test::real-effect-contract	-
SSA-0166	B35-C13	B35-C13	idle-core::redundant-selector-wrapper-fake-async-and-debug-tombstone::idle-services	-
SSA-0167	B35-C14	B35-C14	calendar-banner::event-object-debug-log::exportable-log-history	-
SSA-0168	B35-C15	B35-C15	project-backlog-disable::effect-generated-second-persistent-op::project-update-and-legacy-move-action	-
SSA-0169	B35-C16	B35-C16	project-lookup::identical-catch-error-alias-after-selector-contract-change::project-service-and-note-consumer	-
SSA-0170	B35-C17	B35-C17	planner-today::mockstore-post-dispatch-state-invention::planner-today-sync-spec	-
SSA-0171	B35-C18	B35-C18	planner-calendar::copied-private-event-partitioner-tests::planner-selectors-spec-and-source	-
SSA-0172	B35-C19	B35-C19	metric-chart::parallel-click-and-stopwatch-chart-builders::metric-selectors	-
SSA-0173	B35-C20	B35-C20	privacy-safe-logging::raw-task-reminder-payloads::reminder-tag-repeat-effects	-
SSA-0174	B35-C21	B35-C21	unused-tag-read-surface::zero-runtime-consumers::tag-service-and-selector	-
SSA-0175	B35-C22	B35-C22	unused-repeat-mutation-surface::zero-runtime-producers-preserve-persisted-actions	-
SSA-0176	B35-C23	B35-C23	repeat-eligibility-invariant::duplicated-selector-prefilter::repeat-selectors	-
SSA-0177	B35-C24	B35-C24	repeat-delete-semantics::duplicate-reducer-registration-and-debug-tombstones	-
SSA-0178	B35-C25	B35-C25	dead-page-scaffolding::zero-consumer-fields-and-no-op-load::work-context-work-view-daily-summary	-
SSA-0179	B35-C26	B35-C26	date-test-oracles::copied-native-date-and-range-logic::worklog-daily-summary	-
SSA-0180	B35-C27	B35-C27	plugin-test-harness::repeated-testbed-provider-inventory::plugin-bridge-specs	-
SSA-0181	B35-C28	B35-C28	plugin-runtime::unreachable-pre-lazy-loader-subtree::plugin-service	-
SSA-0182	B35-C29	B35-C29	plugin-runtime::legacy-and-zero-consumer-read-accessors::plugin-service	-
SSA-0183	B35-C30	B35-C30	task-shared-meta-reducer-coverage::superseded-monolithic-plus-split-owner-suites::task-shared.reducer.spec.ts+task-shared-meta-reducers/*-shared.reducer.spec.ts	-
SSA-0184	B35-C31	B35-C31	task-shared-crud-coverage::spy-only-concurrency-plus-wall-clock-smoke::task-shared-crud.reducer.spec.ts:2346-2389	-
SSA-0185	B35-C32	B35-C32	tag-delete-cascade-coverage::four-nontiming-large-fixture-replicas::tag-shared.reducer.spec.ts:1004-1234	-
SSA-0186	B35-C33	B35-C33	deadline-input-validation::copy-pasted-nonfinite-case-matrix::task-shared-deadline.reducer.spec.ts:131-187	-
SSA-0187	B35-C34	B35-C34	batch-consistency-invariants::repeated-six-argument-test-invocations::validate-and-fix-data-consistency-after-batch-update.spec.ts	-
SSA-0188	B35-C35	B35-C35	debounce-during-startup::remove-unused-operator	-
SSA-0189	B35-C36	B35-C36	skip-during-sync::remove-deprecated-alias	-
SSA-0190	B35-C37	B35-C37	generic-utility-logs::redact-values	-
SSA-0191	B35-C38	B35-C38	owned-utilities::remove-unreferenced-exports	-
SSA-0192	B35-C39	B35-C39	electron-add-task::duplicate-effect-validation-and-fake-spec::ipc-parser-boundary	-
SSA-0193	B35-C40	B35-C40	time-tracking-tag-cleanup::deprecated-zero-caller-current-plus-archive-path	-
SSA-0194	B35-C41	B35-C41	task-service-archive-reads::repeated-id-materialization-and-orphan-filter::getArchivedTasks	-
SSA-0195	B35-C42	B35-C42	timezone-tests::utility-diagnostics-without-component-or-effect::reminder-short-syntax	-
SSA-0196	B35-C43	B35-C43	android-reminder-cancel::paired-base-and-deadline-try-block::delete-bulk-archive	-
SSA-0197	B36-C06	B36-C06	e2e-diagnostics::snapshot-7810-full-body-and-idb-capture	-
SSA-0198	B36-C07	B36-C07	e2e-diagnostics::stress-unasserted-idb-and-store-probes	-
SSA-0199	B36-C08	B36-C08	e2e-scenarios::large-time-estimate-unobserved-property	-
SSA-0200	B36-C09	B36-C09	e2e-scenarios::planner-future-day-visibility-triplicate	-
SSA-0201	B36-C10	B36-C10	e2e-scenarios::error-recovery-and-retry-without-fault	-
SSA-0202	B36-C11	B36-C11	e2e-helpers::unused-supersync-assertion-and-time-display-apis	-
SSA-0203	B36-C12	B36-C12	e2e-scenarios::worklog-tracked-time-unobserved-property	-
SSA-0204	B36-C13	B36-C13	e2e-scenarios::webdav-same-second-burst-accepts-failures	-
SSA-0205	B36-C14	B36-C14	archive-subtask-tests::payload-echo-does-not-exercise-orphan-cleanup	-
SSA-0206	B36-C15	B36-C15	compaction-tests::unsynced-and-rejected-without-compaction-call	-
SSA-0207	B36-C16	B36-C16	lww-tests::store-and-utility-self-tests-without-conflict-service	B36.3-Q02
SSA-0208	B36-C17	B36-C17	sync-scenario-tests::shared-db-mock-protocol-without-sync-service	-
SSA-0209	B36-C18	B36-C18	legacy-archive-tests::opaque-payload-cache-echo-without-import-export	B36-C14
SSA-0210	B36-C19	B36-C19	provider-switch-tests::no-provider-transition-before-after-identity	-
SSA-0211	B36-C20	B36-C20	integration-harness::definition-only-helper-surface	-
SSA-0212	C8-N01	C8-N01	error-diagnostics::additional-log::crash-alert-and-github-issue	B01-C05,B16-C05,B22-C03,B23-C04
```

D1 is complete. Stable-ID assignment is a normalization result, not admission:
all records remain `discovered/proposed, unverified` until the combined
D2–D4 review explicitly shortlists an immutable revision. No exhaustive
cross-cutting verification is claimed.

## Combined D2–D4 admission review

The authorized combined admission run reproduced the baseline, frozen plan,
1,442-path manifest, authoritative findings SHA, all 214 origins, the 212-group
D1 mapping, and all eight admitted revision hashes before and after. It
substantively opened 40 of the allowed 60 files and made no edits, test or
service runs, network calls, or Git mutations. The review applied maintenance
benefit, evidence confidence, behavioral risk, and validation cost as
independent bands; it did not calculate a synthetic score.

The admission budget is frozen at eight candidates and exactly eight Wave E
runs. Every admission is low behavioral risk and non-sync-critical, so no
second reviewer is required. This stays below the user-authorized limits of ten
admissions and fourteen runs. Negative controls and automatic re-verification
are not authorized.

| Stable ID | Origin | Maintenance | Evidence | Risk | Validation |
| --- | --- | --- | --- | --- | --- |
| SSA-0009 | B06-C03 | medium | reproduced | low | small |
| SSA-0025 | B01-C05 | medium | reproduced | low | medium |
| SSA-0042 | B10-C05 | medium | reproduced | low | medium |
| SSA-0043 | B12-C01 | medium | reproduced | low | small |
| SSA-0167 | B35-C14 | low | reproduced | low | small |
| SSA-0188 | B35-C35 | high | reproduced | low | small |
| SSA-0202 | B36-C11 | medium | reproduced | low | small |
| SSA-0211 | B36-C20 | medium | reproduced | low | medium |

The other 206 origins, representing 204 D1 groups, are collectively and
exactly classified as discovered/proposed, unverified. This review neither
verifies nor silently rejects them. Named reserves include B03-C02, B09-C01,
B29-C04, and the related B22-C01/B36-C05 pair. B07-C03, the uncombined
B23-C03/B30-C01 group, the B01-C01/B37-C01 enforcement pair, B20-C02,
C8-N01, and B35-C15 are decision-required or materially challenged at this
scope. B08-C04, B07-C02, and B10-C02 are behavior changes to route through
bugfix or hardening work rather than simplification admission. These overlays
do not change their exact discovered/proposed, unverified status.

This is a bounded fast-track shortlist. It does not claim exhaustive
cross-cutting verification.

## Candidate packets and verifier reports

Every Wave E reviewer receives the same frozen baseline ID, findings SHA,
stable-ID mapping, exact origin section, and revision hash stated below. The
origin section in findings.md is the immutable verification-ready packet;
classification here does not rewrite its bytes. Test commands are validation
requirements for eventual implementation and are not audit test executions.

### SSA-0009 / B06-C03 — duplicate final-upgrade mock assertions

- Revision: 1dd864b5c919289ea9624bb3547d6332f23a48cf9b5f3621aee7f4623c914ff9.
- Dedupe key: db-upgrade-tests::duplicate-final-shape.
- Bounded proposal: delete only the mocked full-upgrade-from-v0 block; retain
  every threshold test, v7 seed, v10 downgrade barrier, and the real IndexedDB
  descriptor drift guard.
- Invariants and equivalence: production/schema/persisted formats do not
  change. All stores, indexes, key paths, uniqueness, auto-increment, and
  downgrade behavior remain covered by the retained real-v0 and threshold
  tests.
- Reproduce: inspect db-upgrade.spec.ts:325-400 and
  op-log-db-schema.spec.ts:25-76 plus history 53685eb3a7/4c239e5691.
  Eventual validation is checkFile on the touched spec and both focused specs,
  including a mutation check of one store/index.
- D2–D4 state: verification-ready. E01 fresh verdict: **verified** against the
  exact revision and baseline. The reviewer independently reproduced the real
  v0 upgrade, threshold ownership, descriptors, runtime consumers, candidate
  hash, and baseline after. One valid trade-off remains: deleting hard-coded
  aggregate 9/3 call counts removes a shallow coordinated-addition alarm, but
  the real descriptor guard and threshold tests retain the behavioral proof.
  The alleged unique orchestration/order coverage was a contract misread; the
  block asserts no order and the real schema spec performs the one-shot v0
  upgrade. No valid/actionable challenge remains. No tests were executed.

### SSA-0025 / B01-C05 — stop retaining decrypted JSON samples

- Revision: 79a3da4fd738460559d70b974ef52eb8093cc3c9cfc07b7145fe5a8f32a98ff4.
- Dedupe key: privacy::json-parse-error::plaintext-data-sample.
- Bounded proposal: remove JsonParseError.dataSample, its dataStr constructor
  input, and substring extraction; replace sample assertions with sentinel-
  absence assertions.
- Invariants and equivalence: preserve error identity/name, safe message,
  numeric position, fail-closed decrypt/decompress behavior, recovery, backup
  fallback, UI routing, and overwrite policy. No wire or persisted shape is
  involved; consumers use error identity, not the sample.
- Reproduce: close all dataSample and JsonParseError constructors and inspect
  wrapper/file-adapter recovery and core/log.ts. Eventual validation covers
  sync-errors, encryption/compression, wrapper and file-adapter recovery, plus
  a sentinel proving plaintext is absent from enumeration/stringification/log
  export.
- D2–D4 state: verification-ready. E02 fresh verdict: **verified** against the
  exact revision and baseline. Complete constructor/field closure found no DI,
  dynamic, plugin/API, old-client, persisted, or wire consumer. File recovery,
  wrapper routing, overwrite behavior, error formatting, and log export depend
  only on safe identity/message/position fields. Losing the ad hoc plaintext
  debugging snippet is a valid trade-off in favor of privacy; the packet's
  “byte position” wording is imprecise but immaterial. No valid/actionable
  challenge remains. Sentinel and recovery cases stay required for eventual
  implementation; no tests were executed.

### SSA-0042 / B10-C05 — remove two unused legacy DB writers

- Revision: 68dff22a1f2ee21c97156cfb977ff5adb4209cd20bbad3f75d6f414d73f3b902.
- Dedupe key: legacy-pf-db::orphan-save-archive-and-clear-all.
- Bounded proposal: remove LegacyPfDbService.saveArchive, clearAll, and their
  isolated tests; retain generic save, reads, metadata/client access, locks,
  existence and recovery paths.
- Invariants and equivalence: no legacy DB version, key, or shape changes. All
  production injectors use other methods, so migration, archive reads,
  reminders, recovery, and client-ID fallback are unchanged.
- Reproduce: enumerate every LegacyPfDbService injector and exact/computed
  calls, then inspect the direct tests and history db990b7018. Eventual
  validation covers the service, archive migration, operation-log
  migration/recovery, startup and reminder flows.
- D2–D4 state: verification-ready. E03 fresh verdict: **verified** against the
  exact revision and baseline after inspecting 21 substantive files. Every
  production injector and test override was enumerated; none uses either
  target method. Computed/reflective access, escaped instances, dynamic or
  generated exports, plugins, serialized names, and historical receiver calls
  were absent. Active archive writes use the SUP_OPS archive adapter/store,
  while legacy migration only reads the old database. Name-only clearAll and
  saveArchiveYoung/saveArchiveOld matches are different APIs; the stale reset
  comment is not a caller. No valid/actionable or trade-off challenge remains,
  and no tests were executed.

### SSA-0043 / B12-C01 — remove unused repair variant

- Revision: 7ffe233fd65fc0d5430c930fe6301cbbd8d0760641c17f6f6c8c1db25970f270.
- Dedupe key: entity-state-util::fix-or-error::test-only.
- Bounded proposal: delete fixEntityStateConsistencyOrError and its two direct
  tests; retain isEntityStateConsistent and fixEntityStateConsistency.
- Invariants and equivalence: the deleted helper has no non-test consumer and
  changes no action, DI, persistence, replay, validation, or wire contract.
- Reproduce: exact/all-ref, barrel, plugin, bracket and string closure plus
  history 1e88740dd1/557412586d. Eventual validation is checkFile and the
  focused entity-state consistency spec.
- D2–D4 state: verification-ready. E04 independently reproduced the candidate
  hash and found only the declaration, one spec import/label, and two direct
  test calls; all production module importers select the two retained helpers,
  with no barrel, package, plugin, computed, DI, action, persistence, replay,
  validation-format, or wire consumer. However, the coordinator's immediate-
  return instruction pre-empted the required final baseline/hash re-execution.
  That is a valid/actionable procedural challenge under the frozen run
  contract. With automatic re-verification disallowed, the terminal Wave E
  disposition is **decision-required**, not verified, despite no discovered
  code-equivalence challenge. Nine files were inspected and no tests or writes
  occurred.

### SSA-0167 / B35-C14 — remove calendar-event content logs

- Revision: 3e01545b28d8b6ca57d9a770eaa6113c50721fda117d59fc47838094cd18d799.
- Dedupe key: calendar-banner::event-object-debug-log::exportable-log-history.
- Bounded proposal: delete the addEvToShow event-object log and adjacent typo-
  only marker, adding no replacement payload log.
- Invariants and equivalence: banner filtering, ID dedupe, ordering, provider
  reconciliation, task import, and display are untouched. Only diagnostics
  disappear; title, description, URL, and provider IDs stop entering
  exportable log history.
- Reproduce: inspect the effect, event model, core/log.ts record/export path,
  and history 97f96f2393/bb337cc422. Eventual validation includes the focused
  effect spec and a sentinel export-history assertion.
- D2–D4 state: verification-ready. E05 terminal verdict: **rejected** after a
  valid/actionable material challenge. The exact revision deletes one content-
  bearing log but leaves Log.log({ taskForEvent, allEvsToShow }) in the same
  effect. allEvsToShow still embeds calendar events/providers, and object-first
  Log.log arguments are serialized into exportable history. Both logs share
  the cited introduction history, and existing effects specs have no privacy
  sentinel. The verifier reproduced the candidate and baseline before and
  after. A broader packet removing the second sink plus adding the sentinel is
  discovered/proposed, unverified; automatic revision/re-verification is not
  authorized. No tests or writes occurred.

### SSA-0188 / B35-C35 — delete unused startup debounce operator

- Revision: ac55d6c7dc2eff9cceed262aebe1c99acf7a8d5328fba06a30effb6d3fae9c3b.
- Dedupe key: debounce-during-startup::remove-unused-operator.
- Bounded proposal: delete the 408-line operator/spec pair and empty export
  residue; do not alter live skipDuringSyncWindow behavior.
- Invariants and equivalence: no effect, barrel, package, plugin, dynamic, or
  documentation consumer exists. Hydration, replay suppression, selector
  guards, timing, and persisted/wire behavior are unchanged.
- Reproduce: exact/bracket/barrel/dynamic closure and history 06e3136dd7.
  Eventual validation includes checkFile/build/lint and confirmation that
  skipDuringSyncWindow and guard-lint references are unchanged.
- D2–D4 state: verification-ready. E06 did not return a terminal evidence
  report or the required after-baseline reproduction before its fresh session
  ended. That procedural gap prevents verification under the frozen run
  contract. Automatic re-verification is disallowed by the execution
  amendment, so the terminal Wave E disposition is **decision-required**. No
  source or audit write from the verifier was observed; the candidate's code
  equivalence remains unverified.

### SSA-0202 / B36-C11 — delete unused SuperSync E2E APIs

- Revision: 1a69b3ad2f75e847a37ac3cfdaea416cf9ca0c37cd00a087000e214b28ea6d5a.
- Dedupe key: e2e-helpers::unused-supersync-assertion-and-time-display-apis.
- Bounded proposal: remove exactly the 13 named packet exports and imports made
  unused in supersync-assertions.ts/supersync-helpers.ts; retain every helper
  with a live scenario consumer.
- Invariants and equivalence: production and selected E2E scenarios are
  unchanged; these unpublished utilities have no barrel/package/dynamic
  consumer. The time-display helper is used only by its equally dead chain.
- Reproduce: per-symbol tracked/all-ref, bracket, barrel and dynamic closure.
  Eventual validation is checkFile on both files, E2E TypeScript compilation,
  and Playwright test listing.
- D2–D4 state: verification-ready. E07 fresh verdict: **verified** against the
  exact revision and baseline before/after. Twelve symbols were declaration-
  only; getTaskTimeDisplay appeared only in its declaration and two calls from
  the equally dead wait helper. Seventy-six helper importers and seventeen
  assertion importers contained no namespace, barrel, dynamic, require, or
  candidate-symbol use. E2E docs/config and root release metadata expose no
  external utility API. The stated now-unused imports may be removed; all live
  helpers remain. No valid/actionable challenge remains and no tests ran.

### SSA-0211 / B36-C20 — remove definition-only integration APIs

- Revision: d75667b114fd1b86c1661d888f6dd672b64c480601f6b8a2b6c022ea38fc312a.
- Dedupe key: integration-harness::definition-only-helper-surface.
- Bounded proposal: delete the packet's exact 17 APIs and stale example; fold
  zero-consumer latency/readiness state to the existing zero-latency/ready
  defaults while preserving live helpers and provider conditional-write/error
  behavior.
- Invariants and equivalence: production is untouched. Live file-sync tests
  retain CAS, errors, reset, storage, calls-by-method and client operations;
  no package, barrel, string or dynamic consumer exists.
- Reproduce: per-symbol definition-only closure and the five direct harness
  consumers. Eventual validation is checkFile on the five helper files,
  TypeScript discovery, and the five direct file-based-sync integration specs.
- D2–D4 state: verification-ready. E08 fresh verdict: **verified** against the
  exact revision and baseline before/after after inspecting 14 files. All
  seventeen APIs were definition-only (plus one stale JSDoc example), with no
  bracket/string/computed, namespace/barrel, package, dynamic, reflection, or
  subclass consumer. The five direct harness specs and live getCallsTo
  assertions were reproduced. Implementation must retain call-history storage
  for getCallsTo and preserve the awaited zero-latency asynchronous boundary;
  those are valid/actionable constraints already inside the packet's behavior-
  preservation requirement, not a material scope change. No unresolved
  challenge remains and no tests ran.

## Fast-track Wave E exit gate

All eight admitted immutable revisions received exactly one fresh-context
review. None was sync-critical, so no second reviewer was required. The fixed
budget was eight runs: no negative controls, automatic re-verification, or
extra runs were used.

| Disposition | Stable IDs |
| --- | --- |
| Verified | SSA-0009, SSA-0025, SSA-0042, SSA-0202, SSA-0211 |
| Rejected | SSA-0167 |
| Decision-required | SSA-0043, SSA-0188 |

SSA-0167 failed on a material missed privacy sink. SSA-0043 lacked its required
after-baseline re-execution, and SSA-0188's verifier session ended without a
terminal report or after-baseline reproduction. The amendment forbids
automatic re-verification, so neither procedural gap was retried. Every clean
verdict is tied to the frozen baseline, origin revision hash, independent
consumer/history inspection, and explicit before/after reproduction. No tests
were executed and no source, test, configuration, plan, Git, service, network,
or remote state changed.

Wave E verifies five bounded hypotheses only. It does not prove a deletion and
does not establish exhaustive cross-cutting verification.

## F1 — verified-candidate dependency graph

F1 reproduced the full baseline before and after, inspected 32 substantive
files (31 repository files plus its planning instruction), and made no edits,
test/service runs, network calls, or Git mutations. The graph contains only the
five independently verified Wave E revisions; rejected and decision-required
revisions are terminal non-nodes.

| Node | Stable ID | Implementation closure | Protected boundary |
| --- | --- | --- | --- |
| N09 | SSA-0009 | db-upgrade.spec.ts only | IndexedDB v1–v10 thresholds, real v0 descriptor, v7 seed, v10 downgrade |
| N25 | SSA-0025 | sync error/encryption source and focused specs | parse/decrypt failure identity, backup recovery, overwrite routing, diagnostic privacy |
| N42 | SSA-0042 | legacy-pf-db service/spec only | legacy pf keys/schema, archive/entity/meta/client reads, locks and recovery |
| N202 | SSA-0202 | two SuperSync E2E utility files | unpublished helper surface; all live scenarios/helpers retained |
| N211 | SSA-0211 | five op-log integration helper files | provider CAS/errors, call history for getCallsTo, ready default and awaited zero-latency boundary |

There are no direct touched-file overlaps or compile dependencies. These
serialization edges capture shared invariants and transitive consumers:

    N09  -- persistence compatibility --> N42
    N25  -- SyncWrapperService/spec ----> N42
    N25  -- file-adapter/harness -------> N211
    N202 -- isolated

- N09 and N42 span the destination-schema/source-migration compatibility
  continuum, so migration evidence must be rerun after their combined state.
- N25 and N42 both close through SyncWrapperService and its tests.
- N25 changes the error identity constructed by the file adapter; N211's
  harness constructs that adapter and owns conditional-write/error scenarios.
- N202's Playwright utility layer and N211's Jasmine application-integration
  harness share no file, importer, fixture, scenario, public contract, or
  runtime and are genuinely independent.

After separate implementation authorization, the smallest roadmap is five
separate reviewable slices:

1. Develop N25, N09, and N202 independently in isolated worktrees.
2. Integrate them sequentially in that order, rerunning each focused check on
   every combined state.
3. Then develop N42 and N211 independently.
4. Integrate N42 and rerun legacy migration/recovery coverage; integrate N211
   last and rerun its five file-adapter integration suites.

Every modified TypeScript file still requires checkFile. N09 additionally
requires both upgrade specs and a store/index mutation check. N25 requires the
error, encryption, wrapper and file-adapter recovery specs plus the plaintext
sentinel. N42 requires legacy service, startup, reminder, archive migration and
operation-log migration/recovery coverage. N202 requires E2E TypeScript/list
discovery. N211 requires its five direct integration consumers while retaining
getCallsTo storage and the awaited no-latency ordering boundary.

SSA-0167 is rejected and must not be implemented under its packet. SSA-0043
and SSA-0188 are decision-required and must not be opportunistically bundled
into this graph. A broader two-sink calendar privacy packet and both incomplete
verification hypotheses remain discovered/proposed, unverified.

This is a bounded five-node graph, not exhaustive cross-cutting verification
or implementation authorization.

## F2 — fresh completeness challenge

F2 accepted the explicitly amended fast-track scope with no material
completeness failure. Its fresh read-only pass inspected seven substantive
files (the frozen plan, five coordinator artifacts, and its review
instruction), mechanically enumerated the full manifest without loading source
contents, and reproduced the baseline before and after. It ran no tests,
services, network calls, edits, or Git mutations.

Mechanical reconciliation:

- ownership.tsv contains 1,442 unique manifest paths, all wave-b-complete,
  across 38 owners; owner totals and the path-list SHA
  7d38cfa9f7a06d9f4da3be822c715ee01e418956a71251798cede66fbb1144bb
  match the baseline;
- retained.md contains the expected 51 unique Wave B reports: B01–B33 and B37
  plus the seventeen authorized B34/B35/B36/B38 slices;
- findings.md contains 214 unique origins and 214 unique stored revision
  hashes, all of which self-normalize and recompute;
- D1 contains 214 rows, 212 gapless stable groups, exactly the two recorded
  aliases, and no orphan origin/canonical ID or extra duplicate group;
- D2 admits exactly eight origins; Wave E reconciles exactly five verified, one
  rejected, and two decision-required outcomes; and
- F1 contains exactly five nodes for the five verified stable IDs, with every
  rejected/decision-required ID excluded.

The immutable origin text “stable ID pending D1” is not an unresolved
placeholder: the external D1 mapping resolves every origin without rewriting
the hashed packets. Historical SPLIT_REQUIRED text describes replaced or
invalidated runs, not active work.

Terminal register:

| Class | Records |
| --- | --- |
| Accepted/verified | SSA-0009, SSA-0025, SSA-0042, SSA-0202, SSA-0211 |
| Rejected | SSA-0167 |
| Decision-required | SSA-0043, SSA-0188 |
| Retained/non-shortlisted | 206 origins / 204 stable groups, all discovered/proposed, unverified |
| Already-tracked routing | B05-C05, B01-C02, B20-C04, B37-C01, B37-C02, B37-C03 |

The already-tracked metadata is backed by the A6 ledger, 49 reconciled issue
references (36 open and 13 closed at retrieval time), and merged extraction PR
#7546. It is routing evidence, not current-code proof or implementation
authority.

All nine required output classes are present across baseline/ownership, the A2
traceability matrix, A3 ownership, the Wave E register, retained/rejected
records, A5 compatibility ledger, A4 scenario matrix, F1 roadmap, and the C7
documentation category. Explicit remaining gaps include compatibility gates,
the diagnostic-export sentinel, provider/native runtime E2E coverage, three
server integration lane omissions, and shared-schema CI selection.

F2's input snapshot reproduced artifact hashes baseline
5d02ec86…2651, findings 83acd393…c8e9, ownership 667bf607…d798,
retained 284e297c…eb93, and verification 0e6277e8…ade3. Coordinator insertion
of this F2 report intentionally changes only verification.md (and the terminal
retain summary recorded afterward); final hashes are recorded by the closing
integrity check.

The completeness verdict is limited to primary-domain coverage and the
authorized fast-track phases. Standalone C2, C4, and C5 were not run; B23–B30
is only a bounded C5 substitute. Therefore this audit makes no exhaustive
cross-cutting-verification claim and grants no source-change authorization.

## Closing integrity check

The coordinator's final local check on 2026-07-17 reproduced:

- HEAD 104043e2d220336d37c96623229640233093f045;
- empty tracked-diff SHA-256
  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855;
- frozen-plan SHA-256
  bbed7c26e71036abab0bbe984f99669094a0731eb3fb47b512e833176f3a9393;
- baseline.md SHA-256
  5d02ec8688ce34811049acd5d1e2bffbc43114144a3980caa8617b27a8c42651;
- ownership.tsv SHA-256
  667bf607325caeaf06dde3189d51ec3a98aaf45a13cb5f1f80b7b4c69600d798;
- findings.md SHA-256
  83acd393736396f8b9de33b961dbab82347443fd8fa9e9f410cb5fc5aab0c8e9;
- retained.md SHA-256
  ac42fde4d895e1993561039e0a7169696f9db796124dbc40f5704907da9dee4d;
- D1 TSV SHA-256
  4904a4cbf41d6b1c328e5f63e27f0d12242f1fa10c31edf654b617833cf4aa2a.

Verification self-normalized SHA-256: ab64e60bf993c432fdc05ecc3b6171c87fb521e9ca264fb61e4b5261edd51ac4.
This digest is calculated over the exact UTF-8 verification.md bytes after
replacing only the preceding 64-hex value with the literal <self>.

The closing mechanics found 1,442 unique ownership paths, 38 owners, one
coverage status, 51 Wave B report sections, 214 unique origin records with
214 matching self-normalized revision hashes, and a 214-row/212-group D1 map.
Wave E and F reconcile five verified, one rejected, and two decision-required
admissions. No active pending verifier packet, orphan, duplicate path, source
change, frozen-plan change, service, network action, or Git mutation remains.
No TypeScript or SCSS file changed, so checkFile is not applicable. Tests were
not run under the read-only audit contract.
