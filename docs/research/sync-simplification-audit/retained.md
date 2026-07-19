# Sync simplification audit retained and rejected hypotheses

Baseline ID: `9b4481332dd635dce29da3774d1b8601ea213467f07dfc7fb0417f36328c3135`

This register preserves necessary complexity, rejected hypotheses,
already-tracked work, compatibility constraints, and decision-required items so
future audits do not repeat unsafe suggestions.

## Records

- `A1-R01` — Retain the tracked vendored/minified
  `packages/super-sync-server/public/simplewebauthn-browser.min.js` in the
  manifest; exclude its 363 lines from simplification benefit calculations.
- `A1-R02` — Retain immutable historical SQL migrations, snapshots, and
  compatibility artifacts in the inventory. Removal needs an explicit support
  decision, not a LOC argument.
- `A1-R03` — Default ignore-aware text search is insufficient for the
  manifest because it hides tracked legacy PFAPI JavaScript. Search the Git
  universe directly.

## Compatibility and migration retirement ledger (A5)

The default disposition is **retain**. No broad compatibility deletion is safe
without an explicit minimum-version/data-retention decision.

| Key | Mechanism and current consumers | Retirement precondition | Risk / proof |
| --- | --- | --- | --- |
| A5-R01 | Shared schema v1→v4 migrations and semantic barriers. Current producers stamp v4; hydration, remote apply, conflict, repair, server replay and snapshots consume older versions. Historical deletes must remain markerless timestamp-LWW. | Prove no v1–v3 rows/snapshots/backups/caches or supported clients remain; approve a support-floor decision. Never backfill delete-wins markers blindly. | Critical divergence/data resurrection; shared-schema migration and barrier tests. |
| A5-R02 | IndexedDB `SUP_OPS` upgrades v1–v10, including downgrade barriers for archive-pending, reducer rejection, replacement LWW, and delete-wins. | Destructive profile migration/reset policy for every surviving profile and operator sign-off. | Profile-immutable; DB upgrade/store tests. |
| A5-R03 | Applied Prisma migrations including `0_init`, `entity_ids`/GIN, and `repair_base_server_seq`. | Never edit applied SQL; only superseding migrations after deployment inventory and operator approval. | Checksum/fresh-chain/existing-deployment critical. |
| A5-R04 | Pre-v17 backup detection/migration, including task archive and old improvement/obstruction shapes. Current backup writer is new-format; importer still converts old files. | Define the minimum restorable release, publish an external converter, and explicitly accept older backup loss. | Critical permanent data loss; v10 and v13–v16/idempotence tests. |
| A5-R05 | Legacy `pf` IndexedDB, meta model/client ID/migration lock, and op-log genesis migration. Sync wrapper and reminder cleanup still write it. | Migrate all reads/writes, prove supported profiles completed genesis, specify abandoned-profile recovery, and approve support cutoff. | Critical local state/identity/vector lineage loss. |
| A5-R06 | File-sync v2 main/backup and opt-in v3 split ops/state/snapshots, migration markers/tombstones, PFAPI remote detection, and old localStorage keys. Both v2/v3 have current producers. | Decide/force the v3 rollout, prove no old remote/local baselines or clients remain, and keep tombstones through the entire old-client horizon. | Critical remote overwrite/corruption; adapter migration/CAS/crash tests. |
| A5-R07 | Argon2id current envelope plus decrypt-only legacy PBKDF2 envelope without a version byte. Historical operations/files/snapshots consume fallback decrypt. | Version the envelope and re-encrypt every reachable legacy object, or explicitly end legacy-password support. | Critical unrecoverable encrypted data; legacy/mixed/missing-WebCrypto specs. |
| A5-R08 | Server aliases schema-v1 `GLOBAL_CONFIG:misc`, scalar `entityId` fallback, old-row schema migration, and markerless REPAIR restrictions. | Inventory/rewrite or expire affected rows/caches, raise client/schema floor, operations/product approval. | Critical conflict/snapshot/pruning risk; conflict/replay/repair tests. |
| A5-R09 | Android preference/action/payload contract and Electron local-file legacy-root contract. | Version and migrate native wire/storage contracts or retire the feature with upgrade coverage. | High; no dedicated Android compatibility suite found. |

A5 routing records:

- `A5-C01 investigate`: four tracked PFAPI JavaScript compatibility artifacts
  have no mechanical importer; confirm dynamic/build/release closure before any
  deletion.
- `A5-C02 decision-required`: SQLite adapter/backend migration is tested but
  not wired to a production platform; commit to native rollout or remove the
  dormant implementation as a separate decision.
- `A5-C03 conditional pursue`: remove the server `payload_bytes=0` quota
  fallback only after deployment backfill proof and operator approval.
- `A5-C04 decision-required`: verify completion and recovery need for the
  uncommanded, untested one-shot passkey migration before archiving it.
- `A5-C05 documentation`: current schema is v4 with migrations; architecture
  claims of v1/no cross-version support are stale.

## Prior-work deduplication (A6)

| Key | Local source/status | Disposition |
| --- | --- | --- |
| A6-PW-001 | Historical SuperSync client simplification, tasks 1–8 | Completed; do not re-propose unified HTTP, encryption token/cache cleanup, provider-interface cleanup, shared reupload helpers, or config-cache invalidation. |
| A6-PW-002 | Simplification roadmap Phase 1 result unions | Current, partly completed: orchestrator unions landed; transport flag bags remain; checklist is stale. |
| A6-PW-003 | Roadmap Phases 2–3 full-state seam/conflict decomposition | Current/evolved; main decomposition remains planned. Large SCC is routing evidence, not extraction proof. |
| A6-PW-004 | Roadmap Phase 4/deferred package/server work | Conditional until Phases 1–3 demonstrate measured contract cost. |
| A6-PW-005 | Historical sync-core extraction and active package boundaries/ADR 3 | Extraction completed. Repair local deep imports/facades/docs; do not create another package merely to enforce current direction. |
| A6-PW-006 | 2026-07-03 sync-engine extraction plan | Conditional; no second host or measured boundary problem found. Steps 7–8 remain deferrable. |
| A6-PW-007 | 2026-07-07 architecture review M-7–M-10/M-13 | Locally and externally reconciled below. Reuse its duplicate map and current issue states; do not re-file it as a new sweep. |
| A6-PW-008 | Architecture H-6 / SQLite follow-up | Shared-connection serialization completed; native token, device validation, migration wiring, rollout, and cleanup remain gated. |
| A6-PW-009 | Clean-slate prevention plan | Atomic destructive replacement completed; temporal preflight conditional; “no production compaction-counter callers” is superseded. |
| A6-PW-010 | Multi-client file-sync plan | LocalFile limitation accepted; opt-in split-file Level 2 landed; Level 3 remains conditional/protocol-changing. |
| A6-PW-011 | Encryption architecture metadata/AAD | Decision-required versioned authenticated-envelope migration. |
| A6-PW-012 | Secure-storage plan | Decision-required; no `LocalSecretStore`/`SecretRef`/portable-vault implementation found. |
| A6-PW-013 | Android background, entity versions, encryption-at-rest, provider-plugin plans | Conditional feature/protocol/operations work, not simplification. |
| A6-PW-014 | Conflict journal/scenario residuals | Current/conditional retain: aggregation, recreate fallback, loser-only flips, provider-scoped `syncedAt`, cross-provider encryption state. |
| A6-PW-015 | Operation-log architecture and historical docs consolidation | Current documentation correction; contributor-model consolidation already completed. |
| A6-PW-016 | Project completion plan / ADR #5 | Completed retain: preserve N+1 operations and post-loop yield. |
| A6-PW-017 | Historical server decomposition/dead-surface removals | Completed; do not re-file generic giant-split or exact removed-facade hypotheses. |

Net-new A6 routing: reconcile the partially completed Phase-1 checklist; update
the split-file plan status; reject the obsolete compaction-counter claim;
dedupe server decomposition against completed history; and correct
ADR/package/operation-architecture drift.

### Read-only GitHub issue reconciliation

The user authorized a read-only issue pass on 2026-07-16. The pass used the
GitHub connector against `super-productivity/super-productivity`; it did not
comment, label, edit, close, or create anything.

All 49 unique repository issue references admitted by the local prior-work
sources were fetched successfully: 36 were open and 13 were closed at retrieval
time. The closed set was `#7709`, `#7732`, `#7924`, `#7925`, `#8898`, `#8786`,
`#8334`, `#8306`, `#8318`, `#8633`, `#8709`, `#8205`, and `#8467`; the other 36
were open. Historical PR `#7546` was also fetched as a pull request and was
closed and merged. Current state is routing evidence only: an open issue can be
stale or partly landed, and a closed issue does not by itself prove that every
related invariant remains covered in this baseline.

The search pass used 38 repository-scoped queries covering sync
simplification/architecture, op-log and sync-core extraction, full-state and
conflict flows, schema and SQLite migrations, encryption/AAD, privacy-safe
logs, split-file/provider/native behavior, repair and CI selection, PFAPI and
legacy backup compatibility, passkey/payload-byte retirement, vector clocks,
and exact implementation/spec names. Searches included both open and closed
issues; exact candidates were then fetched before assigning a disposition.

| Audit overlap | Verified current issue state | Dedupe disposition |
| --- | --- | --- |
| Client orchestrator/full-state/conflict decomposition (`A6-PW-002/003`, `A3-R3/R5`) | `#8252`, `#8320`, `#8759`, and `#8937` open; file-snapshot extraction `#8354` closed | Already tracked in part. Wave B must validate the remaining mechanism and must not re-propose the closed extraction. |
| Package and app dependency boundaries (`A6-PW-005/006`, `A3-R1/R3/R4/R5`) | `#8836`, `#8298`, and `#8841` open; extraction PR `#7546` merged | Repair concrete local violations; do not propose another package extraction without the roadmap's second-host/measured-cost trigger. No exact issue was found for the `recover-user` deep import or Dropbox SCC. |
| Documentation/schema drift (`A2-S1`, `A5-C05`, `A6-PW-015`) | `#8760`, `#8346`, `#8962`, `#8770`, and backup-envelope `#8839` open | Already tracked. Consolidate against these issues instead of filing another generic docs-drift finding. |
| Test/CI reachability (`A4-S2/S3/S4`) | shared-schema/scheduled-path gap `#8733`, real-SQL gap `#8773`, and Android PR-gating gap `#8734` open | Partly tracked. No exact issue was found for `repair-causality.integration`, `multi-client-sync.integration`, `snapshot-skip-optimization.integration`, or provider/native runtime E2E coverage. |
| SQLite/native persistence (`A5-C02`, `A6-PW-008`) | rollout `#7931`/`#7956`, latent scan bug `#8312`, and rollout-gating serialization `#8746` open; IDB connection consolidation `#8358` closed | Keep the rollout decision and residual defects distinct from completed connection work. |
| PFAPI/legacy cleanup (`A5-C01`, `A6-PW-017`) | PFAPI/dead-surface sweep `#8326` open | Already tracked as investigation; runtime/build closure is still required before deletion. |
| Server batch upload and `payload_bytes` retirement (`A5-C03`) | gated serial-path removals `#8254` and `#8347` open | Already tracked and explicitly rollout-gated. No exact issue was found for deleting only the `payload_bytes=0` fallback. |
| Encryption metadata integrity (`A2-S5`, `A6-PW-011`) | `#8906`, `#8907`, and `#9033` open | Already tracked as security/protocol work; requires versioned migration analysis, not a local simplification-only edit. |
| File sync and conflict-journal residuals (`A6-PW-010/014`) | accepted LocalFile CAS `#8898` and backup-before-overwrite `#8786` closed; target-change invariant `#9066`, journal rendering `#8936`, and loser-only flip `#9038` open; journal profile-leak `#9046` closed | Preserve accepted protocol limits and closed work; route only distinct surviving mechanisms to B/C. |
| Privacy-safe logging (`A2-S3`, `A4-S5`, `A6-PW-012`) | exported-content issues `#7619` and `#7870` open; plugin secret store `#8633` and first-upload E2EE offer `#8709` closed; legacy E2EE migration `#8672` open | Cleanup is tracked, but no exact issue was found for the audit's system-level diagnostic-export privacy assertion. Local tests suggest `#7619` may be partly addressed, so Wave B/C must verify current code rather than trust issue state. |

Additional exact negative searches found no issue for the Dropbox dependency
cycle, the `recover-user` deep import, missing repair/snapshot-skip/multi-client
test selection, the one-shot passkey migration, transport result flag bags, or
the system-level diagnostic-log privacy test. Those remain candidate gaps, not
“already tracked” work. This resolves the Wave A external-coverage blocker.

## Wave B necessary-complexity register

### B02 — capture and meta-reducer path

- `B02-R01`: retain outermost capture registration, the bootstrap service
  bridge, capture-only `ALL_ACTIONS`, and both remote-action filters. Together
  they enforce one local intent → one op while bulk replay remains uncaptured.
- `B02-R02`: retain the synchronous pending counter, `finally` decrement,
  ordered `concatMap`, deferred identity set/queue, non-destructive snapshots,
  explicit acknowledgment, serialized drains, and failed-suffix retention.
  These are the structural `#8306/#8318` correctness fix, not incidental
  complexity.
- `B02-R03`: retain fresh clock/client-ID reads under the operation-log lock,
  the lock-held call mode, quota circuit breaker, emergency compaction,
  snackbar dedupe, and the rule that post-append bookkeeping failure never
  retries an already-durable append.
- `B02-R04`: retain the empty-but-present `entityChanges` wire field and the
  special time-tracking extraction/pending-delta snapshot projection until a
  versioned compatibility decision proves every consumer can change.
- `B02-R05`: retain the separate stream-survival regression for more than ten
  consecutive failures; it protects effect liveness rather than duplicating a
  single error-path assertion.

Open questions, not simplification candidates: whether deferred time-tracking
ops may ever use the extractor instead of historical `entityChanges: []` needs
Android/background and replay characterization; capture initialization failure
is a recovery-policy decision; and a standalone replacement of the module
bridge would compete with the already-recorded engine-extraction Step 8.

### B03 — operation conversion and bulk apply

- `B03-R01`: retain the synchronous bulk-replay failure collector. Putting
  callbacks in NgRx actions would violate action serializability and lose the
  current reducer-to-caller failure channel.
- `B03-R02`: retain failure-set handling, atomic replay groups,
  archive/delete speculative projection, and full-state rollback in the bulk
  meta-reducer. They defend known stale-update, resurrection, and partial-apply
  data-loss cases.
- `B03-R03`: retain lenient client-ID loading for replayed pending rows, both
  event-loop yields, sequential archive side effects, `failedOp` partial-success
  reporting, and `skipReducerDispatch` archive retry semantics.
- `B03-R04`: retain deferred-local ordering and the lazy-inject cycle break
  until a separately approved ownership change replaces the underlying cycle.
- `B03-R05`: retain converter legacy backfills, payload validation,
  normalization, canonical entity-ID rewrites, authenticated move footprints,
  atomic replay groups, full `moveToArchive` payloads, and the archive-handler
  port. These are compatibility or convergence mechanisms.
- `B03-R06`: retain the empty action-type-alias hook until a support-horizon
  decision, and retain the independent app apply flags until every production
  mode is characterized under A6-PW-002; do not fold a behavior-changing flag
  redesign into B03-C03.

Open questions: dynamic observers of the archive notification and out-of-tree
imports of internal hydration aliases must be closed before their candidates
advance. The sync-core base contract should remain generic while host lifecycle
extensions stay app-local. Changing the archive port to receive only matching
operations is a separate contract decision.

### B04 — archive application

- `B04-R01`: retain the split local/remote archive ordering: local task archive
  data is durable before its persistent action is dispatched, while remote
  archive side effects run after reducer commit through
  `ArchiveOperationHandler`. Merging the paths would reopen sync-before-write,
  duplicate-write, or replay-effect failures.
- `B04-R02`: retain the unconditional cross-tab `TASK_ARCHIVE` mutex,
  sequential handler execution, and both event-loop yields around bulk remote
  application. The mutex is independent of `OPERATION_LOG`; its former bypass
  option is inert and recorded separately as B04-C02.
- `B04-R03`: retain `pending → archive_pending → applied/failed`
  checkpoints, per-row retry counts, successor quarantine, startup archive
  retry with reducer dispatch disabled, and idempotent replacement of stale
  archived tasks. These prevent partial replay and double reduction.
- `B04-R04`: retain the speculative bulk archive/delete projection and
  archive-wins defenses. They protect the documented multi-client `#7330`
  resurrection cases and cannot be replaced with arrival-order assumptions.
- `B04-R05`: retain young/old archive separation, captured flush timestamps,
  deterministic sort/normalization, time-tracking placement, and full archive
  payloads. They are provider-transfer, replay, and compatibility contracts,
  not merely storage organization.
- `B04-R06`: retain legacy archive migration, malformed-read normalization,
  full-state overwrite guards, and missing-half preservation. Old backups and
  remote imports still consume those paths under A5-R02/A5-R04.
- `B04-R07`: retain the established atomic writes in remote flush,
  compression, and remote full-state replacement, including the writer locks
  completed by `#8941/#9006`. B04-C01 concerns only the remaining manual local
  flush transaction.
- `B04-R08`: retain archive/task/time-tracking cleanup semantics and the
  regression coverage for local-versus-remote handler behavior. Option-
  forwarding assertions and a utility-only timezone demo may be simplified,
  but distinct action, failure, ordering, retry, and timezone scenarios may
  not be deleted.

Already tracked: `B04-C02` is the residual inert `isIgnoreDBLock` cleanup
explicitly named by closed `#8941`; generic archive-diagram drift in B04-C05 is
covered by open `#8760`. Neither issue state is evidence that the current code
or documentation has already been corrected.

Open questions: out-of-tree consumers of the internal TaskArchiveService API
must be ruled out before B04-C03; the local atomic-flush change needs two fresh
reviewers because archive-half consistency is sync-critical; and any change to
the due-flush/action causal order is a behavior decision outside this audit.

### B01 — core contracts and entity registry

- `B01-R01`: retain immutable action/entity strings, persistent-action
  metadata, and app-narrowed operation/full-state types. They are persisted,
  replayed, and exchanged across clients; algebraically redundant private
  aliases are recorded separately in B01-C03.
- `B01-R02`: retain both `entityId` and `entityIds`, plus
  `getOpEntityIds`. Historical rows and authenticated multi-entity footprints
  require the union under A5-R08/`#8980`; server storage normalization is a
  separate B18/B29/B32 concern.
- `B01-R03`: retain `RECREATE_FALLBACK`, which protects delete/update
  recreation and disjoint merge, including the documented `#7330` cases.
- `B01-R04`: retain `CLIENT_ID_PROVIDER`; it breaks a real dependency cycle
  and preserves legacy identity migration, cached identity, and destructive-
  replacement rotation under A5-R05.
- `B01-R05`: retain `SYNC_LOGGER` and arity adaptation, package error identity
  re-exports, IndexedDB/recovery errors, and lock/retry/compaction/vector-clock
  constants with their behavioral tests.
- `B01-R06`: retain live legacy PFAPI error classes. Git-universe inspection
  found consumers invisible to ordinary ignore-aware search; B01-C02 is
  intentionally limited to seven zero-consumer classes and one test-only alias.
- `B01-R07`: retain current transport result flags and orchestrator unions
  pending A6-PW-002; do not combine a mode redesign with type cleanup.
- `B01-R08`: retain the weak `AppStateSnapshot` shape for now. Importing the
  model registry would reinforce the feature/op-log cycle tracked by `#8299`;
  canonical ownership requires that broader inversion.

Routed, not duplicated: stale operation-rules/constant comments remain under
A2-S1/A6-PW-015 and existing documentation issues. Consolidating entity-ID
helpers across app/core/server requires B18/B29/B32 semantic proof. B01-C02 is
already tracked by `#8326`; its exact residual must not expand to classes still
used by tracked legacy JavaScript.

### B06 — IndexedDB schema, upgrades, and adapter

- `B06-R01`: retain every v1–v10 `runDbUpgrade` threshold, including
  no-shape downgrade barriers at v8–v10. Retirement needs the explicit
  destructive-profile/support-floor decision in A5-R02.
- `B06-R02`: retain v7 full-state metadata scanning and both compact `o` and
  historical `opType` recognition.
- `B06-R03`: retain both current schema representations: imperative immutable
  IndexedDB deltas and the SQLite target shape. Deriving one from the other is
  a rollout/architecture decision, not a local deletion.
- `B06-R04`: retain real-IDB final-schema drift coverage, downgrade barriers,
  `ops.seq` auto-increment, unique operation IDs, sync/source/status indexes,
  all nine stores, and singleton key semantics.
- `B06-R05`: retain adapter init deduplication, failure reset, lock/non-lock
  retry budgets, error wrapping, close/versionchange listeners, constraint and
  quota error pass-through, and `adoptConnection` until A6-PW-008/`#7931`
  rollout conditions are met.
- `B06-R06`: retain synchronous cursor visitors, transaction liveness, readonly
  mutation rejection, explicit completion/abort, declared store scope,
  multi-store atomicity, and destructive rollback tests.
- `B06-R07`: retain SQLite shared-connection serialization and IDB→SQLite
  verify-before-commit migration. B06-C01 removes only four unused contract
  levels; B06-C02 may centralize identical assertions but cannot weaken any
  engine-specific case.

Open questions: direct imports of the internal persistence port need an
explicit support policy; `adoptConnection` cleanup needs B05/B07 and iOS retry
evidence; SQLite requires a versioned migration policy before native
activation; and a shared adapter contract must preserve independent engine
setup/teardown rather than introduce a leaky generic harness.

### B05 — operation-log store

- `B05-R01`: retain compact and historical full-operation decoding, database
  versions, missing-index fallbacks, and lifecycle-status values. B05-C01
  removes a superseded caller model, not compatibility reads or formats.
- `B05-R02`: retain raw-rebuild/import/state-cache recovery markers, opaque
  backup IDs, full-state metadata rebuilding, and compare-and-clear backup
  behavior. Similarly named unused wrappers in B05-C02 are not permission to
  remove their underlying storage records.
- `B05-R03`: retain transactional append+clock, snapshot, destructive
  replacement, and selective full-state cleanup boundaries; vector-clock
  caches must remain copy-on-read and reset on every relevant mutation.
- `B05-R04`: retain pre-v3 index fallbacks, legacy terminal-failure migration,
  rejection exclusion, archive-pending/failed distinctions, and current retry
  ordering. B05-C03 centralizes identical query policy without changing it.
- `B05-R05`: retain migration dialogs and lazy `MatDialog` loading, profile
  persistence ownership, provider/backend parity, commit/abort fault-injection,
  and rollback tests.
- `B05-R06`: retain connection adoption and service/archive connection paths
  until the native SQLite rollout gates in A6-PW-008 are met; B05-C05 is
  already tracked, high-risk future work.
- `B05-R07`: retain `getAppliedOpIds` despite its imprecise name. Renaming the
  broad API/comments/tests without changing the cache design has negligible
  structural benefit.

Decision-required, not simplification candidates:

- `B05-Q01`: `extract-entity-keys.ts:77-90` emits synthetic singleton keys,
  while current operations often use config sections, planner days/tasks,
  menu-tree IDs, and time-tracking context/date IDs. Exact conflict-frontier
  matching may therefore miss snapshot coverage. Route to B20 for dedicated
  multi-client characterization; B05-C04 must preserve current output.
- `B05-Q02`: `clearFullStateOpsExcept` invalidates only the unsynced cache after
  deleting rows; `getAppliedOpIds` may retain removed IDs when tail sequence is
  unchanged. Confirm intended re-download semantics before changing it.
- `B05-Q03`: `appendWithVectorClockUpdate` assigns the in-memory vector-clock
  cache inside the transaction callback, before commit. Characterize IDB and
  SQLite commit failures before moving the assignment.
- `B05-Q04`: `ProfileDataStoreEntry.data` remains `CompleteBackup<any>` and may
  intentionally admit historical profile backups; narrowing requires A5
  compatibility evidence.

### B09 — snapshots, compaction, and compact operation encoding

- `B09-R01`: retain the complete compact-operation codec, immutable action-code
  mapping, unknown-action fallback, and mixed decoding of compact and historical
  full-operation rows. These are persisted compatibility surfaces; B09-C01 is
  limited to the never-consumed whole-entry codec.
- `B09-R02`: retain snapshot-plus-tail equivalence, the operation-log lock and
  snapshot-before-delete order, meaningful-state guard, maximum vector-clock
  pruning, entity-key extraction, and snapshot schema version.
- `B09-R03`: retain compaction's pending/remote-work guard, terminal and
  reducer-rejected filters, `seq <= lastSeq` boundary, cache-before-counter-
  before-delete order, regular versus emergency retention, and failure
  propagation. Test consolidation must preserve an assertion inventory for
  each distinct branch.
- `B09-R04`: retain migration's backup → metadata/state validation → save →
  clear order, backup restore on failure, and combined primary/restore error.
- `B09-R05`: retain action-code uniqueness, length/format constraints, exact
  critical codes, and the historical `ARCHIVE_REMOTE_DATA_APPLIED` sentinel
  even if B03-C01 removes its unused runtime signal.

Already tracked: compaction state capture before `lastSeq` and the stale
`COMPACTION_TIMEOUT` lock-rationale comment belong to open `#8774`; capture
quiescence belongs to `#8469` and later prior work `#9083`. The timeout's current
behavior is decision-required rather than a behavior-preserving deletion:
commit `4d972a4445` introduced it for an expiring localStorage fallback lock, but
`a9becc2058` later removed that held-lock design. Correct the rationale under the
existing issue and characterize slow compaction before changing the timeout.

Routed, not duplicated: B05-C04 owns moving entity-key unit tests out of the
compaction spec, while B05-Q01/B20 owns the exact singleton/frontier identity
question. Compact operation entry-level helpers introduced in `e177d928f6`
never gained a production consumer, whereas operation-level encoding remains
live in IndexedDB and file-sync paths.

### B08 — hydration, migration, and recovery

- `B08-R01`: retain `HydrationStateService`'s direct-apply flag, nested hold
  counter, idempotent release, cooldown, explicit sync window, and failsafe
  timer. They coordinate effect suppression with the module-global capture
  guard.
- `B08-R02`: retain separate snapshot-plus-tail and replay-from-zero outer
  branches, status-blind replay except durable `reducerRejectedAt`, and the
  pending-row guard on full-state shortcuts.
- `B08-R03`: retain hydration lineage maps, atomic split groups,
  clock-before-terminal-status durability, pending partitioning, and fail-closed
  handling for local or full-state reducer failures.
- `B08-R04`: retain sorted failed and `archive_pending` retry batches,
  archive-only reducer skipping, successor quarantine, partial-failure blocker
  attribution, and deferred retry isolation.
- `B08-R05`: retain recovery's locked, fail-closed `SUP_OPS` emptiness check and
  atomic recovery-operation, snapshot, and clock installation. Retain legacy
  PFDB migration under A5-R05.
- `B08-R06`: retain both destructive hydration modes: `SYNC_IMPORT`
  replacement and atomic file-snapshot bootstrap, including local pending
  capture/rejection, archive locking, vector-clock semantics, tracked-time
  flush, validation, and local-only overlays.
- `B08-R07`: retain schema migrations, legacy full-state payload
  compatibility, nonfatal hydration validation, and the IndexedDB one-reload
  session guard.
- `B08-R08`: route the stale owned persistence diagram to B04-C05 and
  A6-PW-015 instead of creating another documentation candidate.

Open questions: `operation-log-migration.service.spec.ts:368-411` replaces
`_performMigration` with a copied implementation, so its client-ID cases do not
exercise production. Characterize the real path with a valid fixture or fake
clock before admitting a separate test candidate. Confirm the disposition of
non-ancestor branch `pr-8588` before B08-C03 and reuse only its narrow
placeholder deletion. Before B08-C05, mechanically map retained assertions
across persisted operation payload, snapshot, and dispatch.

### B07 — SQLite adapter and backend migration

- `B07-R01`: retain per-physical-connection FIFO serialization and
  `no-adapter-in-tx`; two adapters can share one SQLite connection.
- `B07-R02`: retain atomic multi-store transactions, declared-store scope,
  rollback, unique operation IDs, monotonic sequences, and cursor stop/delete
  semantics.
- `B07-R03`: retain JSON payload storage plus extracted indexed columns; live
  operation-store queries require those indexes.
- `B07-R04`: retain real sql.js coverage and the dual-backend store-port
  integration suite. B06-C02 may share behavior cases but must preserve
  backend-specific lifecycle, DDL, queue, error-mapping, and retry tests.
- `B07-R05`: retain `adoptConnection`, service-owned IndexedDB lifecycle,
  source-IDB retention, and verify-before-commit migration until rollout and
  support gates are resolved.

Prior-work reconciliation: unmerged branch
`origin/claude/android-sqlite-migration-fkvvcg` is 36 commits ahead and 131
commits behind its merge base relative to frozen HEAD and still declares
`DB_VERSION = 7`, while HEAD has deliberate v8–v10 downgrade barriers. It is
evidence, not a merge-ready rollout. Commits `ba6474f6f6`, `fbfc242e26`, and
`2115dae159` already implement the all-store emptiness guard, silent-index-drop
guard, and NULL-index/bounded-scan fixes; dedupe those origins rather than
reimplementing them. The branch still has the zero-rowid fallback and false
readonly callback mode represented by B07-C01/C02. Explicitly rebase and
reconcile v8–v10 or retire the branch before implementation triage.

Decision-required: define versioned SQLite schema upgrades before native
activation because baseline `init()` ignores `OpLogDbSchema.version`; prove
source quiescence or a consistent migration snapshot because stores and clock
are read separately; preserve the stale branch's per-store streaming and
all-store verification if revived; and require isolated on-device bridge tests.

### B10 — backups, import/export, and legacy compatibility

- `B10-R01`: retain `runDestructiveStateReplacement`, exact recovery-backup
  identity checks, atomic client-ID/vector-clock/cache/op/archive replacement,
  fresh `{clientId: 1}` clocks, conflict-journal clearing, and server-cursor
  reset. B10-C01 changes only how live callers express already-required
  recovery provenance.
- `B10-R02`: retain ordinary, archive-inclusive, and operation-log-projected
  snapshot variants. They represent materially different archive and pending
  task-time semantics; B10-C02 removes only an unused incomplete-backup option.
- `B10-R03`: retain every pre-v17 migration and fixture, legacy `pf` read path,
  client/meta bridge, archive migration, and migration lock until the A5
  support-horizon decision. B10-C04 consolidates one exact mapping without
  narrowing compatibility.
- `B10-R04`: retain newest-first two-generation mobile backup selection,
  corrupt-primary fallback, near-empty overwrite guard, sync-enabled prompt,
  genuinely blank startup precondition, and distinct Android/iOS read-failure
  semantics.
- `B10-R05`: retain archive normalization at the read boundary and atomic
  paired archive saves.
- `B10-R06`: keep clean-slate and backup-import orchestration separate. They
  share an atomic storage primitive but differ in snapshot source, op type,
  entity ID, reason, archive replacement, diagnostics, and recovery-slot
  handling.

Routed, not admitted: PFAPI JavaScript deletion remains A5-C01/`#8326` and
needs release/support evidence. Overlapping local-backup ring writes, the
legacy migration-lock check/put race, and malformed decoded file URLs are
correctness questions, not behavior-preserving simplifications. Android and
iOS writers retain different absent-versus-unreadable and write-error
contracts. A generic parsed-backup descriptor and merged clean-slate/backup op
builder would add concepts without demonstrated benefit. The dead Imex boolean
mirror and stale startup injection are below the standalone-candidate bar.

### B11 — structural and full-state validation

- `B11-R01`: retain Checkpoint-A structural validation and lenient persisted-op
  compatibility for arrays, multi-entity payloads, bulk IDs, task batches,
  time tracking, imports, repairs, and unknown-operation forwarding.
- `B11-R02`: retain Typia validators, legacy-board optional `projectIds`, and
  forward-compatible provider-key relaxation; these prevent compatibility
  failures and false corruption repair.
- `B11-R03`: retain lazy full-validator loading, quick-valid/full-invalid
  archive handling, non-interactive repair default, effect suppression,
  repair-before-dispatch ordering, and the event-loop yield.
- `B11-R04`: retain `hasMeaningfulStateData`, `isExampleTaskCreateOp`, shared
  `isValidEntityId`, all real relationship checks, archive/`TODAY` exceptions,
  every distinct action-validity scenario, and privacy-safe diagnostic metadata.

Rejected: replacing the synchronous first-error getter with an invocation-local
result object would force context plumbing through most of a large validator
for little simplification. Three tiny shape helpers do not justify another
module boundary. Snapshot/hydration test ideas are already B08/B09 candidates.

Routed: architecture checkpoints that still claim hydration repairs state
belong to B14/A6 documentation drift. The unreachable non-array
`entityChanges` branch and legacy-classification bypass may be correctness
issues, but changing accepted persisted input is not a behavior-preserving B11
simplification; route to B01/B03 validation and capture review.

### B12 — repair algorithms and repair operations

- `B12-R01`: retain `RepairSyncContextService`, `skipLock`, noninteractive
  notification default, current-clock increment/prune, top-level
  `repairBaseServerSeq`, suffix download, and atomic rejected-repair
  replacement. Together they protect causal repair and crash recovery for
  `#9026/#9080`; `REPAIR` is not clean-slate import.
- `B12-R02`: retain the deep clone and ordered `dataRepair()` pipeline,
  archive-old separation, virtual `TODAY` handling, stale archive references,
  re-key/order preservation, and `#8540` Set/batched transforms.
- `B12-R03`: retain `RECREATE_FALLBACK`, ordered Typia error matching, task
  number `devError`, the real non-blocking repair integration, menu-tree
  recursion/empty folders, and `isDataRepairPossible`.
- `B12-R04`: do not abstract the repeated active/young/old subtask loops without
  archive-old characterization; their order and sequential mutations are
  sync-critical. The redundant second inbox guard and disabled pseudo-test are
  lower value than admitted candidates.

Routed: stale “behave like SyncImport” repair prose and architecture pseudo-code
belong to A6-PW-015. B12-C03 is the exact missed residual of
`5772b3416c`/GHSA log hardening. B12-C05 consolidates only pure validation and
must not weaken B01-R03/B04-R04's real `#7330` convergence coverage. B08-C03
concerns a dead hydrator-spec fixture, not this live repair service.

### B14 — sync orchestration, locking, and conflict gates

- `B14-R01`: retain upload acknowledgement deferral through piggyback
  processing, cursor-after-apply ordering, initial and pre-apply full-state
  conflict gates, both deferred-capture flushes, and incomplete remote/archive
  retry barriers.
- `B14-R02`: retain snapshot hydration's remote-apply window, deferred action
  persistence/replay, archive restoration, cursor ordering, and all unique
  failure/race tests.
- `B14-R03`: retain raw-rebuild preflight before mutation, safety backup,
  atomic replacement, incomplete marker, retry/capture race handling,
  preserved local ops, durable undo, exact newer-schema refusal, local-only
  overlays, snapshot/suffix partition, and archive restoration.
- `B14-R04`: retain `SyncCycleGuardService` and
  `SyncSessionValidationService` latches across wrapper, immediate-upload,
  WebSocket, hydration, remote processing, and conflict-resolution paths.
  Their test seams are too small to justify public-surface churn.
- `B14-R05`: retain Web-Lock and Promise-fallback serialization, timeout/error
  mapping, queue recovery, same-lock reentry behavior, and the real `#7700`
  regression. B14-C01 removes only obsolete or assertion-equivalent tests.
- `B14-R06`: retain the conflict coordinator/gate and app-level dialog adapter;
  the `ConflictUiPort` boundary has distinct package and UI responsibilities.

Routed, not duplicated: the architecture document and simple flow diagram
still claim PFAPI ownership, schema v1/no migrations, localStorage fallback,
BroadcastChannel behavior, obsolete paths, field-level LWW loss, old archive
topology, and hydration repair at checkpoints B/C. Consolidate this under
A5-C05, A6-PW-015, and documentation issues `#8760/#8962`, including B11's
checkpoint evidence. Generic `OperationLogSyncService` decomposition remains
A6-PW-003. The duplicated quota-error matcher and test-only cycle-guard getter
are below the standalone-candidate threshold.

### B17 — remote-op processing and rejected/superseded recovery

- `B17-R01`: retain migration's ordered-prefix and fail-closed blocking
  semantics. Unsupported, newer, malformed, or throwing operations stop the
  suffix and prevent cursor advancement; a migration returning `null` remains
  an intentional terminal drop and split operations retain order.
- `B17-R02`: retain remote full-state upload handling, the operation-log lock,
  remote-apply/capture windows, deferred local actions, clock-before-status
  durability, and old-snapshot compaction. These are crash and race boundaries,
  not removable orchestration ceremony.
- `B17-R03`: retain delegation to `ConflictResolutionService`, the complete
  per-entity context, superseded filtering, every conflict returned for a
  multi-entity op, local-win replacement routing, and the event-loop yield.
  B17-C04 removes only the copied test implementation.
- `B17-R04`: retain permanent/transient/duplicate/quota/unsupported rejection
  classification; stale-repair download/rebase; per-entity retry caps;
  cancellation and exception rollback; normal then forced-sequence-zero
  download; and fail-closed behavior when no causal clock is available.
- `B17-R05`: retain the rejection response's `existingClock` and its explicit
  routing through handler `extraClocks`. B17-C02 removes only the resolver's
  ignored second representation. Keep global, operation, snapshot, forced, and
  rejection clock merging with no client-side pruning.
- `B17-R06`: retain the resolver's operation-log lock, grouped current-state
  LWW replacement, special move-to-archive payload replay, delete replay,
  project-move footprints, recreate flags/follow-ups, atomic append before
  original rejection, and conflict-summary notification.
- `B17-R07`: retain local-only overlay restoration, privacy-safe full-state and
  conflict diagnostics, the session-validation latch, and explicit rollback on
  remote reducer/application failure.

Compatibility and routing: do not remove `CONFLICT_STALE` without a documented
server support-floor decision. Three service type re-exports, the tiny
`markRejected` loop, and `return await` are below the standalone-candidate bar.
Route broad test-fixture work to B14-C03/B36/C6 and preserve the handler's
`existingClock` boundary regressions at `:836-919` during any resolver cleanup.

### B13 — sync wrapper, triggers, and status

- `B13-R01`: retain `getSyncErrorStr`, its provider/error taxonomy extraction,
  and the 400-character safety cap; callers need one privacy-bounded mapping.
- `B13-R02`: retain the wrapper safety banner and its fail-closed recovery
  guidance.
- `B13-R03`: retain immediate triggers, maximum-interval failsafes, the 100 ms
  debounce, and hydration-window immediate behavior. B13-C04 changes only one
  resettable delay after exact timing characterization.
- `B13-R04`: retain effect/action ordering and local-versus-remote guards; sync
  status must not trigger capture or duplicate user intent.
- `B13-R05`: retain wrapper ordering, provider switching, retries, confirmed
  versus pending status, and error/cancellation branches. B13-C05 changes only
  repeated test setup.
- `B13-R06`: retain the live direct wait observable and every
  `startWaitingForNextSync()` source; B13-C02 deletes only an unused synchronous
  facade.
- `B13-R07`: retain live legacy backup/base/archive shapes and conflict-dialog
  contracts until their support floor is explicitly retired.

Routed: broad wrapper decomposition remains A6-PW-003; data initialization is
B08-C01; placeholder effect specs belong to C6. Do not share a cold wait stream
or collapse distinct dialog/error branches merely because their control flow
looks similar.

### B15 — operation download and pagination

- `B15-R01`: retain download lock ownership, monotonic cursor advancement, and
  cursor-after-success ordering.
- `B15-R02`: retain gap detection/reset and key refresh behavior, including
  encryption fail-closed semantics.
- `B15-R03`: retain structural failure gates, incomplete/blocked outcomes, and
  memory caps; these prevent partial acknowledgement or unbounded downloads.
- `B15-R04`: retain raw-rebuild/full-state flags and their destructive-state
  preconditions.
- `B15-R05`: retain all encryption validation, refresh, wrong-key, disabled-key,
  and retry-failure paths; B15-C04 removes one strict assertion subset only.
- `B15-R06`: retain provider-mode outputs that distinguish initial, ordinary,
  and full-state downloads.
- `B15-R07`: retain cancellation/timeout scheduling and timer cleanup.
- `B15-R08`: retain server/full-state migration decisions and confirmation
  side effects; B15-C03 makes the pure plan single-owned without removing a
  branch.
- `B15-R09`: retain applied-operation IDs/counts used by acknowledgement and
  recovery. `failedFileCount` is excluded only because no nonzero producer
  exists.

### B16 — upload, immediate upload, and write flush

- `B16-R01`: retain operation-lock order, pre-callback semantics, and stable
  upload snapshots; they prevent acknowledging a different operation set than
  the one sent.
- `B16-R02`: retain encryption, sequence ranges, upload plans, and operation-type
  snapshots exactly as provider/server contracts require.
- `B16-R03`: retain piggyback download/application before upload
  acknowledgement and cursor advancement.
- `B16-R04`: retain immediate-upload queueing, sync/session guards, status
  transitions, debounce behavior, and error isolation. B16-C01 only repairs a
  test that currently never reaches the branch.
- `B16-R05`: retain pending-write flush and reentry behavior; FIFO remains owned
  and tested by the real lock rather than the vacuous B16-C04 fake.
- `B16-R06`: retain the contextual deferred-upload type alias where it documents
  a distinct lifecycle; remove only proven unused service re-exports.
- `B16-R07`: retain explicit operation-type mapping and rejection/acknowledgement
  distinctions.

Raw provider errors remain available for decisions and UI, but exportable logs
must use allowlisted metadata under B16-C05. A broad upload-service split would
add seams without removing a policy owner and is not admitted.

### B19 — conflict journal, review, and UI

- `B19-R01`: retain the standalone journal database and both never-throw
  boundaries. Classification can fail before journal-service swallowing begins;
  observe-only isolation is load-bearing.
- `B19-R02`: retain the durable localStorage clear marker plus later physical
  cleanup. It prevents profile/dataset content leakage when IndexedDB clearing
  fails; closed issue `#9046` documents the leak.
- `B19-R03`: retain startup pruning, opportunistic soft-cap pruning, and slack;
  together they bound age and long-session growth without an O(n) scan per
  record.
- `B19-R04`: retain separate `revision` and `unreviewedCount` signals, banner
  sequencing, post-await `isShown`, coalescing, and phantom-zero guards; these
  encode the recent `#8946` race fixes.
- `B19-R05`: retain flip deny-lists, missing-entity refusal, literal task-title
  replay, and asymmetric loser-only stale detection. The local-winner baseline
  gap is tracked by `#9038`, not a simplification.
- `B19-R06`: retain presence flags, opaque action diffs, multi-entity attribution
  guards, and classification precedence; they prevent discarded data from being
  hidden or unsafe flips from being offered.
- `B19-R07`: retain the distinct destructive confirmations in both conflict
  dialogs and the caller/component `disableClose` defense.
- `B19-R08`: do not advance the page's mirrored tab index/count wrappers as a
  standalone candidate; test churn roughly equals the tiny state reduction.
- `B19-R09`: do not advance internalizing isolated type/helper exports here;
  that removes no runtime owner and belongs to C1.
- `B19-R10`: do not merge the banner opener and live-refresh methods without
  separate proof. Their superficially repeated reads have intentionally
  different “may open” versus “update only if still shown” semantics.

### B20 — vector clocks and import filtering

- `B20-R01`: retain `MAX_VECTOR_CLOCK_SIZE = 20`, full incoming comparison
  before server pruning, and uploader preservation during storage pruning.
- `B20-R02`: retain the authoritative clock-store fast path plus snapshot/tail
  fallback in `getCurrentVectorClock()`; unlike B20-C01, the fallback is live
  migration/recovery behavior.
- `B20-R03`: retain atomic local append and atomic reducer-status/clock
  checkpointing.
- `B20-R04`: retain minimal full-state clock reset, import/current-client
  counters, subsequent suffix merge, and global pruning.
- `B20-R05`: retain separate snapshot vector clock and optional snapshot entity
  keys for old-cache compatibility.
- `B20-R06`: retain entity-frontier scan after snapshot, rejected-op exclusion,
  last-op-wins, and multi-entity fan-out. Optional frontier filters have no
  production caller, but removing a few lines would create disproportionate
  public/test churn.
- `B20-R07`: retain last-in-batch full-state ordering, batch-over-stored
  precedence, explicit-import clean slate, exact counter exceptions, REPAIR
  prefix/suffix ordering, and stale-local-REPAIR exclusion.
- `B20-R08`: retain the `isLocalUnsyncedImport` dialog boundary and full-state
  operations themselves always remaining valid.
- `B20-R09`: retain standalone `mergeRemoteOpClocks()`; it remains live in
  hydration/conflict paths despite the newer atomic checkpoint path.
- `B20-R10`: retain privacy-safe diagnostics limited to internal op/client IDs,
  action types, and clocks—never payloads or titles—unless logging policy is
  addressed system-wide.

### B21 — full-state metadata, snapshots, and server migration

- `B21-R01`: retain SnapshotUploadService lock/capture ordering, async
  archive-inclusive boundary snapshot, local-setting stripping, pre-delete
  security checks/encryption, configuration recovery ordering, full-delay 429
  retry, server-sequence update, and post-accept consolidation.
- `B21-R02`: retain server-migration sequence gates, pending/rejected-op
  handling, probe and double-empty checks, in-lock deduplication,
  validation/repair, archive-inclusive snapshot, merged/pruned clocks, raw-state
  payload, and locked append.
- `B21-R03`: retain distinct meaningful-state predicates, full-state `refs`
  metadata and legacy normalization/rebuild, destructive-dialog wording and
  wait state, and `SyncLocalStateService` as an extracted seam.
- `B21-R04`: reject hoisting `hasSyncedOps` before download, removing the
  application-level 429 retry, collapsing server-migration checks, or combining
  narrow and model-default meaningfulness predicates; each changes observable
  timing, recovery, or compatibility behavior.

Routing: the server-migration spec's old snapshot bridge, dead fixture, stale
archive prose, and unused capture double belong to existing B10-C03 rather than
a duplicate B21 record. Route the mandatory-encryption versus plaintext-disable
UI/scenario mismatch to B22/C7 as a product/security decision, not a
behavior-preserving simplification.

### B18 — conflict engine and convergence

- `B18-R01`: retain authenticated project-delete markers/footprints, archive and
  delete precedence, merged clocks without client pruning, and every current
  schema barrier.
- `B18-R02`: retain multi-entity fail-closed checks, explicit decomposition,
  compensating operations, and operation footprints. One user intent must not
  be partially applied or silently fanned out.
- `B18-R03`: retain atomic mixed-source persistence, durable sequence order,
  pending retries, reducer checkpoints, remote clock merge, and failure fallback.
- `B18-R04`: retain task/project/cascade recreation for subtasks, ordering,
  notes, sections, repeat configs, moves, and concurrent-delete exclusions.
- `B18-R05`: retain disjoint-merge eligibility/opaque guards, changed-field
  extraction, deterministic noise tie-break, delta-only synthesis, failure
  fallback, and two-client convergence tests.
- `B18-R06`: retain applied/snapshot frontiers, corruption escalation, additive
  time-delta exception, current-entity existence checks, multi-entity fan-out,
  and superseded/duplicate filtering.
- `B18-R07`: retain observe-only journal isolation, content-loss summary,
  privacy-safe classification, and notification ordering.
- `B18-R08`: retain the real-store persistence/restart/crash/partial-batch
  integration suite and both-client replay assertions. Its long scenarios pin
  distinct convergence failures and are not fixture-duplication targets.

Routed: `diagrams/03-conflict-resolution.md` still describes vector-clock
values as timestamps, an unconditional remote tie, obsolete op names, and old
dialog/backup behavior. Fold its bounded corrections into A6-PW-015/C7 rather
than a second docs candidate. Broad service decomposition remains issue `#8937`/
A6-PW-003 and is not justified by file size alone. Do not remove the
corruption-conflict WeakSet or merge journal/error branches without an explicit
behavior model and integration proof.

### B22 — encryption, password changes, and restore

- `B22-R01`: retain operation encryption/decryption, plaintext-downgrade guard,
  LWW/entity-footprint checks, full-state structural validation, and batch
  tests. They are recent fail-closed security work (`c6480d1cae`,
  `24318d11cc`); a tiny shared parse/integrity helper would not justify fresh
  security drift.
- `B22-R02`: retain distinct missing-password and decrypt-error dialogs. They
  represent absent/dropped credentials versus wrong key/ciphertext failure and
  drive different recovery results.
- `B22-R03`: retain file-based `_applyEncryption` enable/change/disable and app
  compression adapters; they centralize provider semantics and app logging/
  error behavior around sync-core.
- `B22-R04`: retain legacy unencrypted SuperSync restore until an explicit
  account-support cutoff. Modern encrypted accounts cannot use server restore;
  gate/hide that affordance as separate UX/deprecation work rather than deleting
  legacy recovery.
- `B22-R05`: retain the interim wire guards until a separately planned,
  versioned AES-GCM AAD/envelope migration. Payload encryption currently does
  not bind every plaintext operation metadata field.

Routing: hardcoded encryption/restore SCSS values are broad design-token debt,
not a sync simplification. Route remaining raw `SyncLog.err(error)` calls
through C8/security review. Do not implement the large secure-storage plan in
this pass; current device-local key storage and its migration need dedicated
architecture and compatibility work.

### B23 — provider host, credentials, and OAuth

- `B23-R01`: retain OAuth one-use state/TTL/provider binding, PKCE, manual code
  fallback, Electron callback handling, and synchronous iOS focus behavior.
- `B23-R02`: retain legacy credential migration and each provider's distinct
  auth-clearing semantics; typed passwords must not be destroyed like
  machine-refreshable tokens.
- `B23-R03`: retain LocalFile main-process path ownership, traversal/symlink
  defenses, and the deprecated renderer path as a reselect/migration breadcrumb.
- `B23-R04`: retain wrapped-provider encryption intent/backfill and automatic
  adapter invalidation.
- `B23-R05`: retain lazy provider-factory caching with reset on failure,
  call-time patched web fetch, persisted provider IDs/prefixes, sync-config
  token/password preservation, `_lastSettings`, and non-refcounted replay.

Routing: the generic credential-port `clear()` member has package compatibility
implications and belongs to B30/C1/C3 rather than B23. Review credential
`_save()` publishing memory before durable `put()` as a separate failure-
ordering question. Route repeated sync-config/dialog test setup to C6 only
after scenario equivalence is proved. The provider-plugin long-term plan is
stale but describes future architecture, not current runtime complexity.

Provider switching also has a correctness question, not an admitted
simplification: `provider-manager.service.ts:299-331` publishes the new ID and
clears private configuration before asynchronous provider loading finishes,
while `sync-wrapper.service.ts:432,462` reads the ID and active instance through
separate paths. A deterministic deferred-provider test must first prove whether
the new ID can be paired with the old instance; route that investigation to
B13/C3. Do not simplify the owner boundary before the race is characterized.

### B26 — Dropbox provider

- `B26-R01`: retain Dropbox add/update/overwrite modes, revision CAS behavior,
  create-if-absent handling, missing-revision failures, and post-upload byte-
  length validation.
- `B26-R02`: retain the web/native request split, native transient retry, and
  iOS fetch exception; they encode different transport behavior rather than
  cosmetic duplication.
- `B26-R03`: retain the PKCE promise cache, rejection reset, success/credential-
  clear reset, manual-code redirect policy, and one-shot auth-code exchange.
- `B26-R04`: retain credential partial updates that preserve encryption state,
  refresh-token fallback, and clearing of invalid/missing refresh credentials.
- `B26-R05`: retain bounded rate-limit delay/retry, privacy-safe path-only
  request diagnostics, sanitized error metadata, provider ID/base path, and
  token deletion when Dropbox is explicitly disabled.

Routing: `typeof +data.expires_in !== 'number'` cannot reject `NaN`; correct it
with explicit response-validation tests as a correctness fix, not a
behavior-preserving simplification. The provider's response-shaped path/auth
classifiers do not recognize the API's normalized error classes, so first pin
the intended missing-directory and final-401 behavior—especially `listFiles()`
returning `[]`—before changing error ownership. Also review
`_handleRateLimit(): Promise<never>` as a type-correctness issue; its successful
retry can resolve. Do not merge native and web request executors merely because
their setup looks similar.

### B24 — file-based adapter and envelopes

- `B24-R01`: retain both live v2 and opt-in v3 formats, fixed names,
  tombstones, pending migration markers, old PFAPI detection, and old local-
  storage migration.
- `B24-R02`: retain immutable snapshot pointers plus fixed `sync-state.json`
  dual-write for older clients, version/clock validation, and immutable → fixed
  → `.bak` fallback.
- `B24-R03`: retain backup-before-overwrite, encryption-mode checks, and exact
  migration order: pending ops, state, neutralize legacy backup, conditional
  tombstone, finalize.
- `B24-R04`: retain conditional primary/ops CAS, create-if-absent `null`, never-
  force mismatch recovery, bounded unchanged-revision retry, and force only for
  authorized restore/replace flows.
- `B24-R05`: retain Dropbox/OneDrive unchanged-revision prechecks, staged
  revision/vector/version promotion only after durable apply, and repair-base
  revision guards.
- `B24-R06`: retain whole bounded cursorless buffers with `hasMore=false`, v3
  `snapshotAppliedOpIds`, legacy missing-`sv` behavior, and LocalFile's explicit
  best-effort TOCTOU limitation.
- `B24-R07`: retain prefix/encryption fail-closed behavior, privacy-safe app
  logging, ASCII-only/fail-open upload-size verification, and
  `AUTO_MERGE_CONCURRENT_SNAPSHOT=false` until compacted-base safety has real
  multi-client proof.

Routing: post-`#9040` compaction creates immutable
`sync-state__<version>__<random>.json`, but `_deleteAllData()` removes only fixed
ops/state/main files and backups. It can report success while the referenced
full-state/archive snapshot remains remotely. Safe deletion must validate the
current reference and decide orphan guarantees across providers, including
Android SAF without listing; route to C8/B27 as a deletion/privacy correctness
fix, not simplification. Route the stale one-file/200-op/checksum/piggyback docs
to C7. Making `listFiles` mandatory breaks the published provider/FileAdapter
contract and Android SAF; treat it as a later protocol decision. Do not widen
the bounded gap-policy candidate into generic adapter decomposition.

### B30 — provider package contracts and utilities

- `B30-R01`: retain distinct `updatePartial` and `upsertPartial` semantics,
  provider `setPrivateCfg()` side effects, per-provider `clearAuthCredentials`,
  and the strict protection against deleting user-typed WebDAV secrets.
- `B30-R02`: retain the file-provider CAS contract, optional `listFiles` for
  Android SAF, operation-provider mode discrimination, snapshot-applied IDs,
  repair capability/encryption guards, and restore contracts.
- `B30-R03`: retain native code-first plus text-fallback error detection,
  bounded configurable retry, call-time fetch factories, platform flags, and
  the separate upload-error classifier; they answer distinct transport/policy
  questions.
- `B30-R04`: retain PKCE cryptographic randomness, S256, platform crypto plus
  hash-wasm fallback, injectable test seams, URL-safe encoding, and provider-
  owned verifier lifetime.
- `B30-R05`: retain safe error identity/classes, `HttpNotOkAPIError.response`,
  UI-only `.detail`, OneDrive's body parsing dependency, fixed user-facing
  network/WebDAV messages, and cross-realm class identity.
- `B30-R06`: retain `urlHostOnly` fail-closed behavior and the privacy-negative
  log tests. Do not collapse the native/upload classifiers or generic provider
  modes merely because their names overlap.

Routing: `AdditionalLogErrorBase.additionalLog` is read by the global error
handler and can enter rendered/exported diagnostics, so it is not dead. It also
retains raw constructor arguments for many provider and app sync errors despite
the package warning never to log them. C8 must inventory actual payloads and
choose a safe structured diagnostic contract before removal. Likewise,
`urlPathOnly()` returns invalid input unchanged and `errorMeta()` accepts
arbitrary caller extras that can override safe identity fields; route both to
C8 privacy review rather than changing observable logging piecemeal. The
one-line `ProviderId = string` alias and exported options types are low-value
public-surface questions; do not churn them without external-consumer evidence.

### B31 — shared schema and migrations

- `B31-R01`: retain `MIN_SUPPORTED_SCHEMA_VERSION = 1`, the sequential
  registry, strict registry validation, pure stepwise migration engine, and
  rejection of states/operations newer than this client. These are compatibility
  and downgrade gates, not incidental framework.
- `B31-R02`: retain the complete v1→v2 migration: settings field mapping and
  inversion, historical typo repair, target-wins state merge, deterministic
  split operation IDs/entity IDs, drop behavior, and multi-entity payload
  handling.
- `B31-R03`: retain the no-op v2→v3 LWW replacement barrier and v3→v4 project-
  delete-wins barrier with their dedicated tests. Each stamps a historical
  semantic boundary even when it does not rewrite every payload.
- `B31-R04`: retain the app migration adapter's preservation of full
  `Operation` metadata, order, split/drop behavior, cache metadata, current/
  minimum gates, and constructor validation.
- `B31-R05`: retain the shared entity allowlist and SuperSync HTTP boundary
  schemas: envelope validation separated from per-operation semantics, numeric
  bounds, request-ID charset, clean-slate/repair metadata, and passthrough
  response compatibility.
- `B31-R06`: retain distinct shared and app cache types while the app cache
  carries sequence, vector clock, and compaction metadata that the generic
  migration input does not own.

Routing: comments that still name “version 3” or an obsolete migration-doc path
belong to C7. Manually mirrored HTTP/provider response types currently preserve
package decoupling; do not introduce a dependency solely to deduplicate them.
The generic shared `migrateOperations()` copies result metadata from the first
operation, which would be misleading for a mixed-version batch; if C1 retains
the function, route that behavior to correctness characterization rather than
silently changing it during simplification. `MiscToTasksSettingsMigration`
uses a broad historical state input, but tightening it without compatibility
fixtures is not an audit simplification.

### B27 — OneDrive, LocalFile, and platform adapters

- `B27-R01`: retain Electron main-process folder authority, relative-only IPC,
  traversal/symlink/`userData` rejection, sanitized IPC errors, atomic temporary
  write-and-rename, and root-cache race protection.
- `B27-R02`: retain the legacy `syncFolderPath` breadcrumb used to force folder
  reselection, LocalFile revision checks, and the documented single-writer
  limitation.
- `B27-R03`: retain Android SAF permission validation, stale-URI clearing,
  idempotent deletion, and native read/write/delete behavior.
- `B27-R04`: retain OneDrive PKCE/state validation, redirect rules, refresh
  deduplication, stale-credential checks, HTTPS Graph-host allowlisting, opaque
  pagination links and cap, CAS/preconditions, byte-size validation, folder
  cache, status mapping, and diagnostic redaction boundaries.

Routing: Android advertises `listFiles` but throws at runtime; do not delete the
capability because post-`#9040` snapshot pruning reserves it. Route capability
truthfulness to C3. Raw SAF error/path logging belongs to C8. The app's
`(window as any).ea` belongs to type-safety review, not this audit's behavior-
preserving shortlist. `hasOfficialClientId` may duplicate nullable
`officialClientId`, but changing that exported contract needs C1 evidence.
Android's immediate SAF-selection persistence is already fixed on non-ancestor
commit `6da578aa8d`; do not create a duplicate candidate.

### B25 — WebDAV and Nextcloud providers

- `B25-R01`: retain strong ETag validation/`If-Match`, create-only
  `If-None-Match: *`, content-hash fallback, post-PUT GET/hash verification,
  412/404 disappearance mapping, mismatch retry, parent-directory creation
  serialization, and actionable persistent-409 errors. These are the file CAS
  and data-loss boundary.
- `B25-R02`: retain native-versus-fetch transport branches, iOS cache-disabled
  sessions, native no-cache policy, fetch `cache: 'no-store'`, CORS heuristic,
  privacy-safe host/error diagnostics, and UI-only connection messages.
- `B25-R03`: retain `PROPFIND_XML` and HTML/empty/size response validation. If
  B25-C02 is denied, retain namespace-insensitive structural XML parsing and its
  Apache/ownCloud/IIS/nginx/mixed-prefix cases as interoperability evidence.
- `B25-R04`: retain Nextcloud file-owner `userName` versus auth `loginName`,
  encoded DAV path construction, OCS user-ID discovery, and base-root
  connection probing.
- `B25-R05`: retain absence of `clearAuthCredentials` for WebDAV/Nextcloud;
  `#7616` evidence shows clearing user-entered app passwords causes irrecoverable
  loss. Retain URL encoding/space compatibility around `#5508` pending an
  explicit migration decision.
- `B25-R06`: retain the thin app factories/wrappers and WebDAV Bearer
  `accessToken` for now. The latter is a public auth shape and remains in the
  secure-storage inventory even though the app has no current producer.

Routing: Android's native WebDAV plugin logs full URLs that may contain user IDs,
folder/file names, URL userinfo, or query secrets, and the iOS plugin includes a
response preview in one decode error; route both to C8 rather than weakening the
TypeScript adapter's host-only contract piecemeal. Generic WebDAV permits
schemeless/relative roots while Nextcloud rejects non-HTTP(S); first characterize
supported same-origin reverse-proxy deployments before scheme hardening. Three
Basic-auth paths rely on browser `btoa` without Unicode credential
characterization; route interoperability tests before consolidation. C7 should
correct the secure-storage claim that Nextcloud supports a Bearer field. If
B25-C02 is rejected, fix its real-adapter 404 normalization rather than retaining
impossible mocks.

### B37 — build, CI, lint, and runtime-selection configuration

- `B37-R01`: retain separate main CI, scheduled E2E, sync PR gates, release,
  server-test, and container-publish workflows. Their triggers, permissions,
  secrets, artifacts, platform signing, sharding, and failure policies differ in
  load-bearing ways.
- `B37-R02`: retain fail-closed PR change detection, always-reporting SuperSync/
  WebDAV gate jobs, the scheduled full backstop, provider-switch coverage with
  WebDAV in SuperSync shards, bounded retry, and pinned third-party actions.
- `B37-R03`: retain `no-actions-in-effects`, hydration-guard, transaction-
  adapter, and multi-entity-effect lint rules with their RuleTester runner. Their
  documented heuristic gaps are explicit; do not mistake a clean lint run for a
  complete proof.
- `B37-R04`: retain sync-core/provider dependency-direction and dynamic-import
  bans, app no-console privacy enforcement, package-focused TypeScript aliases,
  Angular build targets, and provider subpath mappings until their individual C1
  removals land.
- `B37-R05`: retain test-only Docker credentials, service health checks,
  PostgreSQL readiness against the real database, security capability drops,
  isolated WebDAV data, and explicit SuperSync test-mode confirmation.
- `B37-R06`: retain the op-log `sync-exports.ts` facade and its live importers.
  Some exports are unused, but the file is also the intended app boundary; prune
  only exact dead symbols coordinated with B01/C1, not the facade itself.

Routing: C3 must address coverage selection rather than call it simplification:
root `packages:test` omits shared-schema tests; root ESLint ignores shared-schema
and server; the PostgreSQL command selects four of eight integration specs and
does not run `repair-causality.integration.spec.ts`; stale excluded legacy tests
need an explicit delete-or-modernize decision. `wait-for-supersync.sh` creates a
dummy user and accepts any non-404 response, while workflows use a separate
health-only loop; characterize a side-effect-free readiness contract. The
container “Image digest” step prints tags, not a digest. C7 should fix the
single-file sync diagrams and obsolete `/log` package-boundary listing. C8 should
review the Docker `npm ci || npm i` fallback and the documentation that recommends
compiling secrets into the browser bundle. Do not merge scheduled and PR E2E
workflows merely because their job shapes overlap; manual filters, path gates,
required statuses, and nightly coverage are intentionally different.

### B28 — SuperSync client transport, WebSocket, and status orchestration

- `B28-R01`: retain request IDs and device fingerprints, encrypted-response
  sentinels, snapshot operation IDs, retry/idempotency semantics, and the
  existing web/native transport split with compression and timeout behavior.
- `B28-R02`: retain package schemas, host-owned app validation, and stripping
  `snapshotState` at the app boundary. These are validation and ownership
  boundaries, not incidental forwarding.
- `B28-R03`: retain per-account `lastServerSeq` caching and invalidation,
  WebSocket generation and connect-promise guards, socket-identity checks,
  terminal close handling for 4003/4008/4009, heartbeat, and bounded backoff.
- `B28-R04`: retain high-water-mark download queuing, retry/encryption/session
  checks, local-win and recovery behavior, one-shot status expiry, and separate
  pending-local and remote-operation status signals.
- `B28-R05`: retain current privacy boundaries and the web/native error split;
  sanitizing exportable diagnostics must not erase actionable UI-only errors or
  alter retry classification.

Routing: C7 should reconcile stale scenario documentation around timers and
cached server sequence. C3 should verify runtime validation of `latestSeq`.
The `globalThis as any` test seam belongs to B36/C6. Keep the currently unread
`SuperSyncHttpStatusError.status` field until C1 proves the public/package
closure. Raw WebSocket, wrapper, and WebSocket-triggered errors and close reasons
can enter exportable logs; route their structured sanitization to C8 and do not
count that privacy repair as a simplification benefit.

### B32 — server upload, conflict detection, and operation tests

- `B32-R01`: retain both serial and batch upload paths until the default-off
  batch path satisfies its retirement gates (`#8254`, `#8347`). Preserve
  conflict detection before vector-clock pruning, the serial path's final
  recheck, repeatable-read isolation, and rollback behavior.
- `B32-R02`: retain full-state conflict bypass and history aggregation, the
  distinct scalar/entity query paths including `GLOBAL_CONFIG`'s misc-to-tasks
  alias, scalar plus `entity_ids` union semantics, divergent-scalar handling,
  the GIN-backed path, and the `#8334` regression coverage.
- `B32-R03`: retain the time-tracking delta exception only for delta/delta
  pairs, and the complete duplicate-operation identity including encrypted
  retry exemption, timestamp, user, and repair causality.
- `B32-R04`: retain occupied-ID protection across quota cleanup, clean-slate
  transactionality, privacy-safe audit metadata, generic client transaction
  failures, fresh retry piggybacking, and the deliberate absence of snapshot
  metadata in upload piggyback responses.
- `B32-R05`: retain layered unit, PGlite, and PostgreSQL coverage. Keep the
  server-side entity-versioning plan conditional; it describes a possible
  architecture, not a simplification candidate.

Routing: duplicated Prisma-emulation test setup belongs to B36/C6. The
oversized-snapshot placebo assertion belongs to B33/B36/C6, and the misleading
cascade mock to B38/B36. C7 should reconcile stale vector-clock documentation.
Telemetry query-count aliasing belongs to B34/C8, and raw Zod issue logging to
C8. None of those routed findings receives cross-cutting verification merely by
being discovered here.

### B29 — sync-core algorithms and public API

- `B29-R01`: retain remote apply/replay crash safety: durable remote clock
  advancement before the reducer window, `pending → archive_pending →
  applied/failed`, exactly-once reducer checkpoints, authoritative batch
  partitioning, ordered archive-failure prefixes, full-state fail-closed
  behavior, and `skipReducerDispatch` recovery. Commits `5624f6891d`,
  `e3093a416c`, and `bdb0fef9a9` show these are load-bearing.
- `B29-R02`: retain the two distinct apply ports and their small duplicated
  authoritative-failure checks. A configurable shared helper would add an
  abstraction while blurring intentionally different contract errors.
- `B29-R03`: retain encryption wire formats, legacy fallback, session and salt
  caches, unique-salt batching, and WebCrypto error behavior. B29-C03 is only a
  conditional convergence of the single-item implementation.
- `B29-R04`: retain vector-clock comparison-before-pruning, the 20-entry cap,
  preserved-client and deterministic tie behavior, and retry protocol.
- `B29-R05`: retain conflict/archive precedence, opt-in delete-wins, stable-
  client ties, authenticated project-move footprints, recreate-after-delete,
  and the per-entity frontier corruption guard.
- `B29-R06`: retain persisted/public contracts: `OpType` strings including the
  still-used deprecated full-state values, `TYPE:id` entity keys, sync filename
  prefixes, payload/action envelopes, the curated root barrel, and
  `isVirtualEntity`. The `087b9dd43f` pruning already removed 47 zero-consumer
  exports while preserving host-extension seams.
- `B29-R07`: retain complex planners and current compression, error, and logger
  behavior. Logger-boundary narrowing belongs to B30/C8.

Routing: B03-C01 owns the replay archive-notification callback; B03-C03 owns app
apply contracts versus core generics; B01-C04 owns the unused app
`parseEntityKey` facade; B15-C03 owns the full-state migration planner; B20-C02
owns the sync-import classifier inventory and must be coordinated with B29-C04;
B18-C01 owns conflict helper facades/copy tests. The broader planner-result and
host/package redesigns remain prior-work hypotheses, not duplicate candidates.
Out-of-tree consumers of the published-looking sync-core barrel are not proven
absent; B29-C01 and B29-C02 therefore remain public-API decisions.

### B38.1 — deployment topology, Helm, and the migration baseline

- `B38.1-R01`: retain the immutable `0_init` schema as the historical old
  database shape. Later migrations intentionally transform it; regenerating it
  from current Prisma state would break fresh installs and pre-baseline upgrade
  instructions.
- `B38.1-R02`: retain the core Helm chart and its single-replica guard, Recreate
  rollout for RWO storage, migration init container, writable public-data copy,
  secret references, bundled/external PostgreSQL modes, probes, ingress,
  NetworkPolicy, PVCs, and non-root/read-only-root security contexts.
- `B38.1-R03`: retain Docker Compose's database tuning, bounded resources,
  compatibility `db` alias, health checks, capabilities, persistent app/DB/
  Caddy volumes, and the local-build overlay. `DATA_DIR` is still consumed by
  server and administrative paths.
- `B38.1-R04`: retain Caddy's timeout ordering, security headers, compression,
  and query-token redaction. WebSocket and email-link tokens otherwise reach
  exportable container logs.
- `B38.1-R05`: retain separate production and E2E Dockerfiles. Their dependency,
  migration, test-mode, retry, security, and memory contracts differ.
- `B38.1-R06`: retain the active backup/recovery model, including accounts-only
  recovery when a surviving client can reseed and full restore only as a
  fallback. Retain encrypted backup tooling independently of the abandoned LUKS
  volume experiment.

Routing: C7 should reconcile the server diagram's removed snapshot/status
endpoints and tombstones, stale Helm image/memory commentary, and any active
testing-guide references to archived LUKS tools. C3 should establish chart
render/lint coverage and deployment/config parity; a single migration spec's
string checks are not chart validation. C8 should review monitoring exports that
contain raw operation payloads/emails, runtime global `tsx` installation, Docker
socket access, and placeholder credential guidance. The B38.2 run owns later
migrations, operational scripts, backup implementation, and recovery tooling.

### B34.1 — server API, auth, validation, and sync lifecycle

- `B34.1-R01`: retain token replacement inside its transaction until a real
  PostgreSQL characterization proves an atomic update-and-return operation
  preserves the race fix from `615188bf88`.
- `B34.1-R02`: retain explicit API and page handlers. Their status codes, safe-
  message allowlists, token escaping, and authentication failure paths differ;
  a generic wrapper would hide behavior rather than simplify it.
- `B34.1-R03`: retain the WebSocket reconnect cooldown, authentication-cache
  invalidation CAS, namespace/fingerprint request deduplication, separate rate-
  limit cache, validation defense in depth, conflict-before-prune ordering, and
  serial/batch upload split. Each protects concurrency, abuse resistance, or
  rollout compatibility.
- `B34.1-R04`: retain live `DeviceService` online-count/stale-delete behavior,
  the integrated compressed-body parser and its size/error taxonomy, production
  privacy template, and vendored SimpleWebAuthn browser bundle per A1-R01.

Routing: stale SQLite registration/API tests belong to B36/C6. The active LUKS
testing guide is deduped into B38-C02/C7; B34.1 recommends moving or clearly
archiving it rather than leaving runnable-looking paths. Unused Markdown privacy
policies and legal-text disagreements require documentation/legal review, not a
silent simplification. C1 should batch small dead surface such as
`SyncService.getMaxClockDriftMs()`, `DownloadOpsQuery`, `authCache.set()`, and an
unused validation logger import. Do not promote those cosmetic fragments as
standalone candidates.

### B33 — server download, snapshots, cleanup, and quota

- `B33-R01`: retain replay-size accounting, prototype-pollution guards,
  full-state semantics, encrypted-operation rejection, batch-delete handling,
  and the causal leading-gap exception in `op-replay`.
- `B33-R02`: retain the download service's atomic stable upper bound, three gap
  cases, causal full-state fast-forward, persisted-clock validation,
  out-of-transaction fallback aggregation, and pruning that preserves requester
  and author IDs.
- `B33-R03`: retain RepeatableRead snapshot generation, encrypted/legacy-repair
  guards, contiguous batched replay, cache race handling, quota-aware cap, and
  post-commit cache accounting.
- `B33-R04`: retain snapshot-route preflight both outside and inside the storage
  lock; the second check protects idempotency/races. Retain quota reentrant
  locking, inflight reconcile dedupe, causal cleanup markers, bounded deletion,
  optimistic decrement rollback, exact final reconciliation, independent
  cleanup-task failure handling, cancellation, budget, and stalest-first order.
- `B33-R05`: retain separate latest/historical replay loops and separate
  standalone/generation cache writes. Their cache eligibility, migration
  failure policy, transaction client, quota/race context, and processed-count
  guards differ enough that extraction would not be a safe net simplification.

Routing: historical snapshot migration failure currently preserves a
pre-migration cache while current generation throws; route that behavior choice
to B20/C3. Quota reconciliation failure deliberately falls back to a possibly
stale cached counter; fail-open versus fail-closed is an availability decision.
Stale cleanup comments, a placebo snapshot assertion, and shared Prisma test
emulators belong to B36/C6/C7. The dead
`SyncService.deleteOldestRestorePointAndOps()` facade belongs to B34/C1. Retain
the `payload_bytes=0` fallback until the recorded backfill/deployment gate is
satisfied.

### B35.1 — native platforms, Electron, and application shell

- `B35.1-R01`: retain Electron path validation, sync-folder cache/race guards,
  atomic random temporary saves, safe IPC error stripping, BrowserWindow
  navigation/window-open/permission controls, and startup/quit sequencing.
- `B35.1-R02`: retain Android encrypted credential and account storage, reminder
  pagination, quick receiver/alarm/boot/action pipeline, and fail-open scheduling.
  Its reminder cursor is not authoritative application sync progress.
- `B35.1-R03`: retain Android/iOS WebDAV wire behavior, native queue and
  foreground-startup ordering, JavaScript bridge quoting, Capacitor plugin
  registrations, and the current iOS Objective-C/Swift registration pattern.
- `B35.1-R04`: retain MainHeader's intentional cross-boundary styles, teleport
  behavior, sync accessibility, app listeners, background-image handling, and
  onboarding order.

Routing: B27 already owns the abandoned LocalFile directory-probe API and the
unused Android SAF file-existence bridge. Keep `button.isActive2` until the
Velvet theme owner removes its consumer. Route child-side removal of the
constant side-panel input to a later B35 slice, and route receiver snooze
factoring only to an Android-native owner with test coverage. Reminder-action
snooze branches, adjacent add-task-bar template duplication, and iOS plugin
registration are retained because their small LOC benefit does not justify the
runtime or build-proof risk.

### B38.2 — migrations and SuperSync operational tooling

- `B38.2-R01`: retain every applied incremental migration and the current Prisma
  schema. Migration history is forward-only; even the two distinct directories
  sharing the `20260713000000` prefix must not be renamed or rewritten after
  deployment. Prefer a new forward migration for any correction.
- `B38.2-R02`: retain the generic fail-loud migration runner, its behavioral fake-
  Prisma suite, the immutable SQL guards, payload-byte backfill, database
  connectivity/timeout policy, image-revision verification, and health-gated
  deployment. These guard partial concurrent indexes, stale images, long locks,
  and quota-accounting correctness.
- `B38.2-R03`: retain `recover-user.ts`, its gap/full-state/decryption checks and
  plaintext-output warnings. It is explicitly unverified against real encrypted
  data but is the only operator path for replaying encrypted account history.
- `B38.2-R04`: retain distinct clear-data and delete-user commands, health alerts,
  plaintext/accounts and encrypted backup formats, rotation, and their secure
  permission/atomic-write boundaries until an operator chooses one supported
  disaster-recovery policy. Their semantics and filenames are not interchangeable.
- `B38.2-R05`: retain the active monitoring commands and Docker wrapper for now.
  Recent fixes and package scripts show live ownership; source deletion cannot be
  inferred from repository call counts for operator CLIs.

Routing: C8 owns raw payload/email/credential output, unmask/export controls,
report retention, and the stale production-`tsx` guidance. C6 owns the broad
string-coupled assertions in `migration-sql.spec.ts`. The live
`tools/test-environment-setup.sh` still advertises LUKS migration/verification
tools that now exist only in the abandoned archive; dedupe its removal into
B38-C02 rather than creating another candidate. Backup-policy convergence and
external-PostgreSQL health-alert behavior require explicit operator decisions,
not a silent simplification.

### B36.1 — sync E2E documentation, fixtures, and initial scenarios

- `B36.1-R01`: retain the short SuperSync flowchart and detailed scenario
  document. They serve overview and reference roles and link to one another.
- `B36.1-R02`: retain explicit legacy-migration and backup JSON fixtures. Their
  historical schemas, IDs, clocks, and encrypted/plain variants are compatibility
  evidence; regenerating them would obscure the contract.
- `B36.1-R03`: retain separate SuperSync and WebDAV fixtures/page objects.
  Authentication, encryption, transport, health gates, and completion states
  differ enough that a shared protocol abstraction would add policy.
- `B36.1-R04`: retain scenario-specific ordering in archive conflicts,
  import-conflict gating, day-change, and divergence regressions. Operation order
  is part of each bug reproduction.
- `B36.1-R05`: retain `setupSuperSync()` for this audit. The page object has
  accumulated race-specific fixes; restructuring it needs characterization and
  the encrypted scenario matrix, not a size-based recommendation.

Routing: later B36/C6 slices own duplicate `serverHealthy` gating, remaining
backup import/export helpers, compaction and ConstraintError tests that do not
induce their named conditions, and direct fixture/locator cost. C7 owns
`e2e/README.md` versus `e2e/CLAUDE.md` and stale provider-encryption wording.
Issue lifecycle owns the known-bug divergence scenario. None of these routed
observations is cross-cutting verification.

### B34.2 — server WebSocket, pages, and test perimeter

- `B34.2-R01`: retain WebSocket authentication, validation ordering, reconnect
  cooldown and storm controls, close codes, heartbeat, per-user caps, and
  shared-NAT rate-limit key behavior.
- `B34.2-R02`: retain `testRoutes`; registration is doubly gated by non-production
  `TEST_MODE` and explicit confirmation, and its destructive endpoints support
  recovery E2E scenarios. Retain strict positive-integer environment parsing.
- `B34.2-R03`: retain active passkey, magic-link, auth-cache, token-race,
  registration-race, request-deduplication, compressed-body, quota, validation,
  op-replay, and sync-service coverage. These pin security/data-loss boundaries.
- `B34.2-R04`: retain distinct English/German terms files pending legal review;
  translation/legal equivalence is not a mechanical simplification.

Routing: B36/C6 owns 3,537 LOC of excluded legacy sync/auth/registration/
multi-client suites and the active `sync-fixes.spec.ts` umbrella/Prisma emulator.
Its unique encrypted-snapshot, piggyback, and `serverTime` assertions must move
before harness removal. Keep password-reset schema columns/index and legacy URL
redaction pending C3 compatibility review. Gzip and diagnostic-block deletions
were rejected as owner-local candidates because their test ownership is not yet
safely decomposed.

### B35.2 — core services and Android lifecycle perimeter

- `B35.2-R01`: retain live `BannerService.activeBanner$`, Log `error`/`normal`
  aliases and `withContext`, DateService/DateTimeFormat timezone and logical-day
  seams, and separate add-today/add-tomorrow orchestration.
- `B35.2-R02`: retain vector-clock size/pruning/comparison wrappers, client-ID
  legacy migration/transaction logic, and batched time-sync dispatch/flush order.
  These are sync/data-loss invariants, not local duplication.
- `B35.2-R03`: retain Local REST validation, virtual-TODAY projection, atomic
  task-update branches, and tests at the untrusted-input boundary.
- `B35.2-R04`: retain Android bridge request maps, platform capability/legacy
  WebView ABI branches, and current lifecycle flush ordering until native and
  older-client closure is proven.

Non-shortlisted routing: `B35.2-Q01` zero-operator `.pipe()` calls and
`B35.2-Q02` empty constructors/one-use pass-throughs are discovered/proposed,
unverified C1 cosmetics. `B35.2-Q03` null-seed Android focus teardown and
`B35.2-Q04` async-Promise work inside RxJS `tap` are discovered/proposed,
unverified behavior bugs and require separate debugging authority, not
simplification. `B35.2-Q05` stale native credentials from filtering null provider
config is already routed in verification.md and remains unverified. `B35.2-Q06`
is the broader 1,954-line Android foreground spec's local production
reimplementation; discovered/proposed, unverified for C6, with only B35-C07's
historically extinct subset ready for triage.

### B35.3 — config, focus/idle, calendar, and issue-provider core

- `B35.3-R01`: retain logical-day normalization across the config reducer,
  direct local changes, startup load, and bulk replay. The apparently repeated
  paths have different persistent-task-migration and replay-side-effect duties;
  collapsing them risks re-minting ops during hydration.
- `B35.3-R02`: retain focus-mode effect separation, action ordering, remote-op
  guards, break/session state, local sound/alarm ownership, and native resume
  reconciliation. These branches encode user-task and timer race fixes, not
  incidental complexity.
- `B35.3-R03`: retain CalDAV's web/native XHR adapters, DAV-header fallback,
  abort/listener contract, calendar-home matching, task UID queries, and the
  focused fake-XHR suite. They bridge a concrete third-party library/native CORS
  boundary.
- `B35.3-R04`: retain provider transition/time-entry effects and Plainspace/
  CalDAV sync adapters. Similar Jira/OpenProject/Redmine dialog flows differ in
  provider APIs and are routed to the already-authorized B23–B30 C5 evidence,
  not a new standalone provider-abstraction run.
- `B35.3-R05`: retain all six built-in-to-plugin load migrations and their legacy
  top-level fields pending C3. Reducer execution on every loaded snapshot,
  older-client compatibility, credential-bearing shapes, and idempotence make a
  generic rewrite or timed deletion unsafe without release evidence.

Non-shortlisted routing: the deprecated Domina selector is still consumed by
the voice-reminder plugin migration and remains compatibility-owned. Keyboard
mapping tests are misplaced in the effects spec but moving them alone has no
simplification benefit. Selector-driven issue polling and its error logging are
discovered/proposed, unverified sync/privacy questions for C8 or separate
debugging; they are not silently treated as verified findings. No exhaustive
provider-duplication conclusion is claimed from this slice.

### B35.4 — project, planner, metrics, and mobile reminder closure

- `B35.4-R01`: retain project completion's per-task operations and post-loop
  event-loop yield. They are mandated by the bulk-dispatch sync model and cannot
  be replaced with a synchronous loop for LOC reduction.
- `B35.4-R02`: retain logical-day offset plumbing, virtual-TODAY semantics,
  project delete/replay compatibility, and the issue push-decision engine. These
  are replay/data-shape contracts rather than owner-local duplication.
- `B35.4-R03`: retain distinct mobile reminder ownership sets, recurring-alarm
  graduation debounce, iOS background cap, and exact-alarm memoization. Their
  superficially similar loops have different cancellation and platform policies.
- `B35.4-R04`: retain planner and mobile notification async boundaries pending
  dedicated behavior work; Promise work inside RxJS `tap` dedupes to existing
  `B35.2-Q04` and is discovered/proposed, unverified rather than a simplification
  candidate.
- `B35.4-R05`: retain issue-sync sidecars and adapter boundaries; their typed
  payload, lifetime, privacy, and provider responsibilities differ.

Non-shortlisted routing: `B35.4-Q01` observes that
`poll-to-backlog.effects.ts:89-116` performs selector-driven external imports
without an explicit hydration guard. It is discovered/proposed, unverified and
requires sync-effect debugging, not an audit cleanup. No automatic
re-verification or negative-control review is authorized in fast-track mode.

### B35.5 — reminder, tag, section, simple-counter, and repeat-config state

- `B35.5-R01`: retain historical repeat action creators/reducer handlers that
  can appear in persisted operation logs or older-client traffic. In particular,
  the no-producer `syncSimpleCounterTime` remains a serialized persistent action
  with a remote-replay reducer; do not delete it from repository call counts.
- `B35.5-R02`: retain the legacy reminder reducer/state while it remains
  registered in feature state, model configuration, snapshots, validation,
  backup migration, and the entity registry. The live DB migration and backup
  migration own different ingestion paths.
- `B35.5-R03`: retain the active recurring-config selector semantics, mobile
  reminder pre-scheduling, logical-day conversion, pause/deleted-date/cursor
  rules, and task creation flow. B35-C23 is discovered/proposed, unverified and
  cannot be admitted through an omitted standalone C2 run without a covered
  owner and two fresh reviewers.
- `B35.5-R04`: retain section normalization, reminder countdown, and short-
  syntax/task-due/electron effect sequencing. Their action order and local versus
  replay responsibilities are not interchangeable simplification seams.

Non-shortlisted routing: `B35.5-Q01` observes a generated action loop in
`task-repeat-cfg.service.ts:137-148` without the mandated post-loop event-loop
yield; characterize 50+ templates and route it as sync correctness, not cleanup.
`B35.5-Q02` observes a selector-driven persistent tag update using
`skipWhileApplyingRemoteOps()` rather than `skipDuringSyncWindow()`; it is
discovered/proposed, unverified behavior work. `B35.5-Q03` observes that
`simple-counter.effects.ts:30,57-76` never resets its success map, so a counter
may celebrate only once per application lifetime; this is discovered/proposed,
unverified behavior work. Unused deadline element/style residue, Shepherd's
redundant initialization, and no-value async/await remain below the shortlist
threshold. No exhaustive cross-cutting verification is claimed.

### B35.6 — task, time-tracking, profile, and work-context effects

- `B35.6-R01`: retain `LOCAL_ACTIONS`, hydration/sync-window guards, action
  ordering, logical-day arguments, virtual-TODAY ordering, and due-day versus
  due-time exclusivity across task effects.
- `B35.6-R02`: retain local-no-op/remote-additive time synchronization,
  non-finite reducer guards, parent propagation, accumulator flush order, and
  archive locking. These are replay/data-loss boundaries.
- `B35.6-R03`: retain selector memo isolation, per-task reference stability,
  scheduling snapshots, TODAY repair, and large-list behavior; apparent helper
  duplication can alter memoization or ordering.
- `B35.6-R04`: retain profile backup/import, destructive replacement, conflict-
  journal clearing, storage migration, and reload boundaries pending explicit
  support/deprecation decisions.
- `B35.6-R05`: retain distinct task/reminder action filters, Electron/platform
  guards, attachment/task serialized fields, archive/current lookup policy, and
  work-context logical-day repair outside the bounded B35-C39–C43 proposals.

Non-shortlisted routing: `_findNextTask`, task move/drag ordering, broader time-
tracking cleanup consolidation, copied reminder-dialog race models, repeated
`TaskUiEffects` setup, work-context fixture builders, selector structural
rewrites, reducer/debug remnants, and the standalone non-finite-time
investigation remain `discovered/proposed, unverified`. Broader native-reminder
unification is also `discovered/proposed, unverified`; B35-C43 is intentionally
limited to the four behavior-identical paired cancellations. Possible one-
intent/multiple-op reminder fan-out, stale entity-ID casts, duplicate TODAY-
repair logic, and non-retried per-profile migration failures are
`discovered/proposed, unverified` correctness/compatibility work rather than
cleanup. No exhaustive cross-cutting verification is claimed.

### B35.7 — work-context, worklog, daily-summary, and plugin perimeter

- `B35.7-R01`: retain daily-summary finish sequencing, including pre-finish
  sync, archive loading, failure notification, and cleanup. Its async order
  protects user state and is covered by behavioral specs rather than being
  redundant page orchestration.
- `B35.7-R02`: retain Plugin HTTP native/fetch transport separation, OAuth
  lifecycle, allowed-host checks, and redaction. These branches enforce
  platform and untrusted-plugin security policy; similar request shapes do not
  establish interchangeable behavior.
- `B35.7-R03`: retain plugin metadata/user-data persistence keys, codec framing,
  generation checks, per-entity rate limits, and persisted action/state shapes.
  They are compatibility, privacy, and replay boundaries rather than local
  abstraction residue.
- `B35.7-R04`: retain the live lazy PluginService discovery, consent,
  activation, ZIP upload, and iframe-generation paths. B35-C28 targets only the
  separately closed pre-lazy call tree and remains discovered/proposed,
  unverified.

Non-shortlisted routing: `B35.7-Q01` observes that config-page query-parameter
validation accepts fewer tab indexes than the template exposes; it is
discovered/proposed, unverified behavior work, not simplification. `B35.7-Q02`
observes that the voice-reminder migration starts persistence without awaiting
it before returning/auto-enabling; it is discovered/proposed, unverified
correctness work. `B35.7-Q03` observes exportable debug logs of plugin-defined
header/menu/side-panel/shortcut configuration and a config-page shortcuts
array; this is discovered/proposed, unverified privacy work routed to C8.
`B35.7-Q04` observes search-navigation diagnostics containing task IDs and a
query parameter behind an opt-in localStorage flag; it is
discovered/proposed, unverified for C8, with no claim that IDs are user content.
`B35.7-Q05` observes `workingToday$: Observable<any>` and is
discovered/proposed, unverified type cleanup below the shortlist threshold. No
exhaustive cross-cutting verification is claimed from this slice.

### B35.8 — task-shared reducers and shared UI/test constants

- `B35.8-R01`: retain live `TaskSharedActions.removeTagsForAllTasks` callers,
  its legacy-named handler, persisted action types/shapes, replay handlers, and
  meta-reducer ordering. Similar names do not make serialized compatibility
  removable.
- `B35.8-R02`: retain LWW modes/authenticated footprint, virtual-TODAY and
  replay-safe date offsets, archived-project behavior, delete-wins markers,
  local-config preservation, and modified-display time semantics.
- `B35.8-R03`: retain the broad functional LWW/CRUD matrices and the four
  two-subtask batch cases for ordering, sequential, and explicit-update
  behavior. B35-C30 targets only the superseded monolith after an assertion-
  level owner map.
- `B35.8-R04`: retain `createCombinedTaskSharedMetaReducer` and the translation
  schema in `t.const.ts`; both have live integration/runtime consumers.

Non-shortlisted routing: `B35.8-Q01` observes that
`expectTaskEntityNotExists` uses `jasmine.objectContaining` with the target key
omitted, which does not prove absence; it is discovered/proposed, unverified
test-correctness work. `B35.8-Q02` observes a LWW case whose dueWithTime/dueDay
prose may disagree with OR membership under corrupt dual-field state; it is
discovered/proposed, unverified compatibility/correctness work. `B35.8-Q03`
observes that batch reduction mutates an action-payload ID map and does not use
a full dependency order; it is discovered/proposed, unverified replay/purity
work. Deadline dual-field semantics, a global-registry TODO, and positive dialog
tabindex are discovered/proposed, unverified behavior/accessibility questions,
not simplification findings. The zero-consumer legacy local task action belongs
to B35.6 and is not duplicated here. No exhaustive cross-cutting verification
is claimed.

### B35.9 — shared utilities and sync operators

- `B35.9-R01`: retain `skipDuringSyncWindow()`, canonical
  `skipWhileApplyingRemoteOps()`, `LOCAL_ACTIONS`, bulk-replay log guard, and
  replay-safe next-day/date helpers. Their timing/order and local-versus-remote
  boundaries are load-bearing.
- `B35.9-R02`: retain locale-date and short-time formatting behavior, active
  environment accessors/entity factories, platform detection/dialog fallbacks,
  UUID/deep-copy/download/parser semantics, and current error extraction.
  Superficially shorter platform or clone implementations are not equivalent.
- `B35.9-R03`: retain XSS escaping, password scoring, critical-error signaling,
  online debounce/deduplication/replay, and logical-date validation. Only the
  bounded surfaces in B35-C35–C38 are candidates.

Non-shortlisted routing: `B35.9-Q01` observes that the immediate `isOnline$`
seed can disagree with the synchronous helper when `navigator.onLine` is
`undefined`; normalizing it is discovered/proposed, unverified behavior work,
not simplification. `B35.9-Q02` covers broad avoidable `any` use across utility
and test contracts and is discovered/proposed, unverified pending bounded type-
owner slices. `B35.9-Q03` covers raw errors in download/development logging and
is discovered/proposed, unverified privacy/error-policy work. The compact
`isObject(obj) => obj === Object(obj)` predicate and deprecated test-only
`isToday()` migration are discovered/proposed, unverified because seemingly
clearer rewrites can change function/timezone semantics. Replacing the dialog's
Material-private element reference, consolidating next-day parsing, and
simplifying the MIME parser are discovered/proposed, unverified pending browser-
focus, replay, and attacker-controlled-input evidence respectively.
The stale documentation import of nonexistent `getEnvOrDefault` was outside
the clean slice's substantive evidence and is discovered/proposed, unverified.
No exhaustive cross-cutting verification is claimed.

### B36.2 — remaining SuperSync scenario perimeter

- `B36.2-R01`: retain explicit regression and state-machine cases for #7330
  counter resurrection, #8331 transient rejected-op download, USE_REMOTE crash
  resume, concurrent time-delta snapshot hydration, clean-slate/last-sequence
  preservation, encryption password transitions, guarded token expiry, and
  import/archive conflicts. Their order and intermediate states encode the bug
  reproductions.
- `B36.2-R02`: retain the high-volume stress flow itself while routing only its
  non-gating probes to B36-C07. Its operation count, syncs, scrolling, and final
  assertions exercise server sequence/piggyback and bulk-yield behavior.
- `B36.2-R03`: retain one assertion-backed future-day planner propagation case,
  the distinct TODAY/dueDay case, the real no-op flow, injected duplicate-op
  error scenario, and injected transient-failure regression. These are the
  stronger owners against which B36-C09 and B36-C10 must be mapped.
- `B36.2-R04`: retain snapshot-plus-tail convergence and the large-estimate
  precision question as separate concepts. B36-C06 proposes deleting only
  historical diagnostics; B36-C08 must record that estimate precision remains
  uncovered if its title-only false oracle is removed.

Non-shortlisted routing: several error/network scenarios use a narrower
`**/api/sync/ops/**` route and sometimes install it after initial setup; this is
discovered/proposed, unverified test-correctness work, not deletion evidence.
The two repeat-task E2Es appear to create scheduled ordinary tasks and require
closure against the actual integration suite. The legacy “keep remote” migration
case accepts either state and remains discovered/proposed, unverified for C3/C6.
The other-client import-pruning setup adds only twelve historical clock entries
against the twenty-entry limit, so runtime clock-width coverage remains
discovered/proposed, unverified. No exhaustive scenario verification is claimed.

### B36.3 — late E2E utilities and op-log integration perimeter

- `B36.3-R01`: retain vector-clock max-size/pruning coverage and route any
  implementation simplification to its existing B20 owner. The browser cases
  cross the client/server storage boundary and are not duplicates merely because
  shared-core unit tests also exist.
- `B36.3-R02`: retain encryption migration/restore, wrong-password, provider-
  switch, clean-slate interruption, archive repair, real compaction guards,
  cross-entity convergence, task ordering, and WebDAV full-flow regressions.
  Their intermediate states or provider boundaries are distinct.
- `B36.3-R03`: retain the generic helpers still advertised by
  `e2e/CLAUDE.md`, and retain live SuperSync helpers with scenario consumers.
  B36-C11 is restricted to exact definition-only closure.
- `B36.3-R04`: retain archive/worklog helper reuse under B36-C03 and server
  Prisma setup under its existing B33/B36 ownership rather than creating
  duplicate candidates from this slice.

Non-shortlisted routing: `B36.3-Q01` observes optional wrong-password branches
and weak WebDAV tag/TODAY-removal assertions; these are discovered/proposed,
unverified oracle-repair work, not deletion evidence. `B36.3-Q02` observes that
`day-change-sync-conflict.integration.spec.ts` locally recreates LWW and store
application rather than invoking `ConflictResolutionService`; deletion or
relocation is discovered/proposed, unverified until the still-live action-
metadata assertion has a canonical owner. `B36.3-Q03` covers broader bulk-
hydration, cross-entity, WebDAV, and server-test setup consolidation and is
discovered/proposed, unverified pending complete scenario/compatibility maps.
No exhaustive cross-cutting verification is claimed.

### B36.4 — remaining op-log integration inventory

- `B36.4-R01`: retain #9040 immutable split-compaction snapshots and #9023
  repair/convergence, plus file encryption/cache/conditional-write and WebDAV
  import-reset regressions. Their state transitions cross real production
  boundaries.
- `B36.4-R02`: retain example-task import gating, migration handling, dual
  IndexedDB/sql.js remote application, archive/hydration races, local-only
  hydration, and real service-level encryption/import filters.
- `B36.4-R03`: retain #8944 round-time convergence, #7330 simple-counter repair,
  TODAY and task-done replay, the task-time state machine, and
  `lww-update-store-application.integration.spec.ts`; these execute reducers,
  conversion, or service behavior rather than echoing fixtures.
- `B36.4-R04`: retain vector-clock import/reset cases that invoke
  `SyncImportFilterService`. Any local pruning-predicate consolidation requires
  narrower compatibility closure.

Non-shortlisted routing: `B36.4-Q01` covers two IndexedDB recovery tests that
induce neither an error nor retry and is discovered/proposed, unverified for C6.
`B36.4-Q02` covers a post-sync latch test that calls a private validator while
acknowledging the latch is unchanged; it is discovered/proposed, unverified.
`B36.4-Q03` covers edge cases that call the provider directly or never reach the
named trim threshold; it is discovered/proposed, unverified. Broad repeat-task,
repair, race, performance, non-piggyback, empty-file, server-migration, and
copied pruning-predicate consolidation remains discovered/proposed, unverified
because complete assertion-owner mapping was not established. No exhaustive
cross-cutting verification is claimed.

## Fast-track Wave C retain register

- **C1:** retain atomic deduplicating append, persisted/historical codecs and
  formats, backup/migration fallbacks, live adapter transaction semantics,
  vector-clock snapshot/tail and pruning behavior, snapshot generation/cache
  writes, sync-window guards, archive locking, and every harness helper with a
  live scenario consumer. Public/deep-import and dynamic consumers remain
  `discovered/proposed, unverified` until explicitly closed.
- **C3:** retain schema v1–v4 migrations and semantic barriers; file v2/v3
  readers, tombstones, pending markers, backups, old keys, and fixed-state dual
  writes; legacy PF reads/meta/client-ID/locks; IndexedDB ownership/fallback;
  serial server upload and payload-size fallback; and native/public/operator
  compatibility surfaces until their support gates close. Every retirement
  hypothesis remains `discovered/proposed, unverified`.
- **C6:** retain provider/backend boundaries, backend-specific database tests,
  injected failure/recovery regressions, lock/race/error branches, migration
  and replay barriers, scenario-specific ordering, separate SuperSync/WebDAV
  fixtures, one assertion-backed future-day planner case, the distinct virtual-
  TODAY case, real no-op coverage, and #8331 recovery. Blanket wait, locator,
  fixture, or large-suite cleanup remains `discovered/proposed, unverified`.
- **C7:** retain the contributor sync model as the canonical effects/replay
  contract; capture-only `ALL_ACTIONS`; active POST snapshot, GET status,
  restore-point, and restore routes; file-sync compatibility tombstones; unique
  package-only architecture detail; current storage/migration invariants;
  explicit uncovered test scenarios; encrypted-backup tooling; failed-LUKS
  decision history; and monitoring privacy warnings. All non-shortlisted drift
  remains `discovered/proposed, unverified`.
- **C8:** retain structured `SyncLogMeta`/`toSyncLogError()` boundaries, raw
  exceptions and details required only for control flow or recovery, bounded
  sync-error taxonomy, missing-password/decrypt/integrity identities, OAuth
  state/PKCE checks, provider retry classification, Electron callbacks, manual
  native OAuth entry, platform-specific focus/cache/retry/error behavior, paired
  Android cancellation, and passkey repair pending deployment closure. Broader
  privacy/platform observations remain `discovered/proposed, unverified`.

These are bounded fast-track dispositions. They do not establish exhaustive
cross-cutting verification.

## Fast-track Wave D non-admission register

The combined D2–D4 review admitted eight low-risk groups. The other 206
origins / 204 stable groups remain exactly `discovered/proposed, unverified`;
none gains verification or implementation authority by appearing here.

- Capacity reserves are B03-C02, B09-C01, B29-C04, and the related but
  separately bounded B22-C01/B36-C05 pair.
- B07-C03 remains compatibility-gated. The B23-C03/B30-C01 stable group lacks
  one immutable combined packet and public/out-of-tree closure. The
  B01-C01/B37-C01 pair needs an atomic replacement-enforcement plan. B20-C02
  needs a complete assertion-owner inventory and decomposition. C8-N01 needs
  runtime-reachability and focused alert/issue characterization. B35-C15
  changes persisted-operation/plugin-event provenance and needs a maintainer
  decision plus two sync reviewers. These are decision-required or materially
  challenged, not fast-track admissions.
- B08-C04, B07-C02, and B10-C02 are correctness/hardening behavior changes,
  not behavior-preserving simplifications; route them through the appropriate
  bugfix or hardening process.
- All remaining sync-critical, persisted-format, migration, transaction,
  conflict, vector-clock, encryption, import, repair, and broad test-deletion
  proposals retain their current mechanisms until complete consumer/format/
  scenario evidence exists.

D1 also kept related mechanisms separate when their files or invariants differ,
including B29-C04/B20-C02, B37-C01/B01-C01, B36-C05/B22-C01,
B28-C03/C8-N01, B35-C24/B35-C22, B15-C03/B29-C01,
B06-C01/B06-C02, B06-C01/B07-C01, B17-C01/B17-C04,
B13-C02/B13-C04, B18-C01/B18-C03, and B25-C01/B25-C03. Similarity is not
evidence that one owner can safely replace the other.

This is a bounded fast-track triage result and makes no exhaustive
cross-cutting-verification claim.

## Wave E/F terminal non-verified register

Wave E verified SSA-0009, SSA-0025, SSA-0042, SSA-0202, and SSA-0211.
Their evidence, constraints, and dependency ordering live in verification.md;
audit verification is not implementation authorization.

- **Rejected — SSA-0167 / B35-C14:** the immutable packet removes one
  exportable calendar-content log but misses the same effect's
  taskForEvent/allEvsToShow object log. The wider two-sink removal and privacy
  sentinel are discovered/proposed, unverified. Do not implement the rejected
  packet.
- **Decision-required — SSA-0043 / B12-C01:** static evidence found only
  direct tests, but the verifier did not complete the mandatory after-baseline
  reproduction. No automatic retry was authorized.
- **Decision-required — SSA-0188 / B35-C35:** the fresh session returned no
  terminal report or after-baseline reproduction. Apparent dead-code evidence
  is insufficient for promotion without separately authorized verification.

F1 excludes all three from its verified graph. It also retains these constraints
for the five verified nodes: real IndexedDB descriptor/threshold coverage;
JsonParseError identity, recovery and overwrite routing; every legacy PF key,
read, lock and migration path; all live SuperSync E2E helpers; call-history
storage for getCallsTo; and the awaited zero-latency harness boundary.

The remaining 206 origins / 204 stable groups retain the exact status
`discovered/proposed, unverified`. The six already-tracked routing records
(B05-C05, B01-C02, B20-C04, and B37-C01–C03) remain evidence links rather
than verified dispositions. No exhaustive cross-cutting verification is
claimed.
