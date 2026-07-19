# Sync simplification audit findings

Baseline ID: `9b4481332dd635dce29da3774d1b8601ea213467f07dfc7fb0417f36328c3135`

This coordinator-owned register receives immutable discovery origin records,
then D1-assigned stable IDs. No candidate is implementation authorization.

## Origin records

Candidate revision hashes are SHA-256 over the exact UTF-8 bytes of the
candidate section, from its `###` heading through the byte before the next
`###` heading, after replacing the hash value with the literal `<self>`.

### B02-C01 — Correct the obsolete state-diff and capture-order narrative

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `capture-docs::state-diff-and-order-rationale`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B02;
  `be3e7cf7dd2cfe9aff0e4aa5870d44c8a35b6beac56eb319b2ddba9ee0216a84`.
- **Domains / category:** B02 primary; B01, B14, B35 related;
  documentation and architecture drift.
- **Exact evidence:**
  `docs/sync-and-op-log/diagrams/05-meta-reducers.md:17,27,30-31,76-114,126-183`
  describes before-state capture, `StateChangeCaptureService`, broad
  state-diff-derived `entityChanges`, and per-operation store dispatch.
  `operation-capture.meta-reducer.ts:223-236` correctly says state diffing is
  gone but incorrectly says capture may occupy any meta-reducer position.
  `meta-reducer-registry.ts:29-32,79-83,145-162` retains the first-position
  assertion with the obsolete before-state rationale. The current reason is
  replay exclusion: `bulk-hydration.meta-reducer.ts:37-40` internally reduces
  replayed actions, so capture must remain outermost. The current counter path
  is described at `operation-log-architecture.md:2150-2160`.
- **Current responsibility / consumers / formats:** these docs and comments
  govern capture registration, multi-entity serialization, and replay
  exclusion. Runtime writes one action-payload operation with optional
  special-case `entityChanges`; there is no general before/after state diff.
- **Unnecessary mechanism / smallest change:** remove the obsolete state-diff
  diagram and contradictory rationale; show one `bulkApplyOperations` dispatch
  with its internal reducer loop; document optional `entityChanges`; preserve
  and correctly explain the outermost-position assertion.
- **Equivalence / invariants / failure modes:** documentation/comments only.
  Runtime and wire data are unchanged. One intent remains one operation and
  replayed actions remain uncaptured. Mistaking the “any position” comment for
  truth could remove the guard and capture replayed actions as phantom ops.
- **Evidence and history:** repository inspection and blame reproduce the
  contradiction. Commit `85bedb1` removed expensive state diffing on
  2025-12-22; `9f0adbb` introduced the diagram already stale. `#8306/#8318`
  document the later pending-counter path.
- **Existing work:** adjacent to open docs-drift issues `#8760` and `#8962`,
  but their verified scopes do not name this diagram/order contradiction. The
  July 3 extraction plan Step 8 is future boundary work, not this correction.
- **Required verification:** Prettier-check the touched Markdown; run
  `checkFile` on capture/registry TypeScript comments if changed; run the
  capture, bulk-hydration, and meta-reducer-ordering specs. Commands were not
  executed by the audit.
- **Estimated delta / benefit:** production behavior 0 LOC; source comments
  about −10; tests 0; docs about −35 to −55. Removes a false architecture
  model and lowers the chance of reintroducing state diffing or breaking replay
  exclusion.
- **Blast radius / reversibility / risk / confidence:** documentation-wide but
  runtime-neutral; immediately reversible; low implementation risk, while the
  protected ordering invariant is sync-critical; supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B05-C01 — Retire the superseded duplicate-ingestion APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-store::superseded-two-phase-dedup-api`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B05; `a21ee57393756742748ade8d994826239756cd72b48069d904c1a94f8b7a324b`.
- **Domains / category:** B05 primary; B12 and B15 related; dead production
  surface and obsolete retry model.
- **Exact evidence:** `operation-log-store.service.ts:742-775` defines
  non-deduplicating `appendBatch`; `:1311-1330` defines `hasOp` and two-phase
  `filterNewOps`. Atomic canonical ingestion is `:782-787,950-1043`.
  Obsolete direct tests are in its spec `:410-462,1335-1468`; remaining
  consumers are test helpers/integrations at
  `simulated-client.helper.ts:92-116,250-324` and
  `indexeddb-error-recovery.integration.spec.ts:76-103`. A SuperSync recovery
  spec and `sqlite-migration-followup.md:107-122` still describe old behavior.
- **Current responsibility / consumers / formats:** production remote apply
  uses `appendBatchSkipDuplicates` through `RemoteOperationApplyStorePort`
  (`sync-core/src/remote-apply.ts:19-35,100-112`) and another live call at
  `operation-log-sync.service.ts:2188`. Exact production search finds no caller
  for the three old APIs and no dynamic/package/plugin/serialized consumer.
- **Unnecessary mechanism / smallest change:** migrate test setup/helpers to
  `appendBatchSkipDuplicates` or `getOpById`; delete obsolete spies/retry tests,
  the three methods, and stale current docs. Keep historical changelog text.
- **Equivalence / invariants / failure modes:** runtime already uses the atomic
  path. Preserve clock merging, conversion, compact encoding, full-state
  metadata, source/sync/application fields, quota mapping, returned written
  rows, and one transaction. Never replace batch ingestion with independent
  appends or silently reinterpret a duplicate-rejection test.
- **Evidence and history:** exact call closure; commit `da71917019` explicitly
  replaced `filterNewOps() + appendBatch()` with atomic duplicate skipping and
  removed retry logic but left these APIs.
- **Existing work:** no exact current issue or ledger item; native batching
  rollout remains separate.
- **Required verification:** Git-universe/computed-call closure; `checkFile` all
  touched TS; store, simulated-client, IDB recovery, remote-apply/conflict,
  targeted SuperSync, and scheduled sync suites. Not run by the audit.
- **Estimated delta / benefit:** production about −50 LOC; tests/docs −140
  to −220. Removes a known-racy alternative ingestion model.
- **Blast radius / reversibility / risk / confidence:** one runtime service plus
  test scaffolding/docs; reversible; medium test-helper risk but no production
  caller changes; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  first among B05 records.

### B05-C02 — Prune four orphaned store convenience methods

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-store::orphaned-convenience-wrappers`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B05; `92f08d879da35bd60a19e409c2ecec9717cd2fcab89580fd7b415fda05258a35`.
- **Domains / category:** B05 primary; C1 related; dead internal service API.
- **Exact evidence:** `getLatestFullStateOp` is at
  `operation-log-store.service.ts:1355-1369`, `clearFullStateOps` at
  `:1447-1459`, `loadStateCacheBackup` at `:1932-1943`, and
  `hasImportBackup` at `:2169-2176`. Direct wrapper assertions remain at its
  spec `:992,2711-2720`; other occurrences are stale spy members.
- **Current responsibility / consumers / formats:** exact production search is
  empty. Live siblings are distinct: `getLatestFullStateOpEntry` serves upload
  and import filters; `clearFullStateOpsExcept` is in the remote-apply port;
  hydrator uses `hasStateCacheBackup` plus restore; import flows use
  save/load/clear import backup. The four candidates have no dynamic/export,
  schema, persisted-key, backup-shape, or wire consumer.
- **Unnecessary mechanism / smallest change:** delete only the four wrappers,
  wrapper assertions, and stale mock members. Preserve every storage slot/key,
  loader/restorer, opaque backup-ID compare-and-clear, and full-state metadata.
- **Equivalence / invariants / failure modes:** no runtime invocation changes.
  Similar live names are safety-critical: do not delete state-cache backup,
  import-backup APIs, `getLatestFullStateOpEntry`, or replace selective
  full-state clearing with unconditional deletion.
- **Evidence and history:** exact/computed reference closure. The entry-returning
  API superseded the op-only wrapper; raw rebuild removed pre-clearing;
  `loadStateCacheBackup` never gained a consumer; `4cbe605b35` removed the sole
  `hasImportBackup` UX consumer while retaining recovery storage.
- **Existing work:** no exact issue or plan overlap found.
- **Required verification:** repeat closure; `checkFile`; store, hydrator,
  import-filter, remote-apply, sync, backup recovery, and piggyback specs.
- **Estimated delta / benefit:** production −45 to −50 LOC; tests −30 to
  −70. Shrinks a broad persistence facade and mock contracts.
- **Blast radius / reversibility / risk / confidence:** internal API/specs,
  mechanical revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  after B05-C01 so shared mocks change once.

### B05-C03 — Share remote lifecycle-status indexed and fallback reads

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-store::remote-status-query-fallback`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B05; `978f8b57be8844475ddbcf004f33676dd2bb155adb04474746ce3e68f06b8bdd`.
- **Domains / category:** B05 primary; B08 and B12 related; duplicated
  compatibility query policy.
- **Exact evidence:** `getPendingRemoteOps` at
  `operation-log-store.service.ts:1279-1309` and `getFailedRemoteOps` at
  `:1744-1785` independently implement compound-index reads, broad catch/warn,
  pre-v3 full-store fallback, rejected-row exclusion, and decoding. Normal and
  fallback tests are in its spec `:2185-2218,2334-2390,4285-4398`.
- **Current responsibility / consumers / formats:** pending rows gate
  compaction/recovery/sync; archive-pending and failed rows drive archive retry.
  Callers include compaction, hydrator `:760-790`, and sync `:2118-2119`. This
  is read policy only; no lifecycle value, index, or persisted shape changes.
- **Unnecessary mechanism / smallest change:** one private helper accepts an
  ordered status list, issues one exact compound-index request per status,
  flattens in status order, retains the full-scan fallback/rejected filter, and
  backs both public methods.
- **Equivalence / invariants / failure modes:** preserve pending versus
  archive-pending+failed selection, remote source, exact key ranges, broad
  fallback/warning, rejection exclusion, decoding, and current fast-path
  concatenation order. Do not use an imprecise compound range, narrow the
  compatibility catch, or make rejected rows retryable. Hydrator sorting by
  seq remains necessary.
- **Evidence and history:** both fallbacks came from `66bdf69607`;
  `f38342eeb9` expanded failed retrieval to archive-pending, while
  `f9610530c9` later repaired rejected-row parity in the other method,
  demonstrating policy drift.
- **Existing work:** no exact issue or prior-plan overlap found.
- **Required verification:** `checkFile`; both normal/fallback store paths,
  remote-apply port, hydrator retry, recovery/sync, and IDB/SQLite parity specs.
- **Estimated delta / benefit:** production −20 to −30 LOC; tests unchanged.
  Gives lifecycle compatibility policy one owner.
- **Blast radius / reversibility / risk / confidence:** private helper in a
  sync-critical read path; reversible; medium risk, supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue only
  with exact characterization retained.

### B05-C04 — Put entity-key extraction tests beside the utility

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `snapshot-entity-keys::focused-utility-tests`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B05, independently
  corroborated by B09; `ebb09e37fe77c8adbeffe26d416f1449fdc26423924c6d198c6af2ada7b2226c`.
- **Domains / category:** B05 primary; B09, B20, and C6 related; misplaced and
  over-integrated tests.
- **Exact evidence:** standalone `extract-entity-keys.ts:10-106` has no
  co-located spec; direct behavior coverage lives behind compaction DI/mocks at
  `operation-log-compaction.service.spec.ts:611-887`. Cases repeatedly bypass
  the empty-state guard, call `compact`, and inspect spy arguments. The block
  duplicates a `MODEL_CONFIGS` map at `:764-850` and names a removed private
  method at `:847-849`.
- **Current responsibility / consumers / formats:** backup, clean slate,
  compaction, snapshot, and sync rebuild all consume the utility. This proposal
  moves tests only and intentionally preserves current exact key output.
- **Unnecessary mechanism / smallest change:** add one focused, table-driven
  utility spec for adapter states, arrays, boards, archives, partial state,
  current singleton behavior, and independent model completeness. Retain a
  thin compaction wiring assertion and genuine empty-overwrite guards; remove
  only indirect utility cases and unused fixture imports.
- **Equivalence / invariants / failure modes:** production/persisted/wire data
  are untouched. Keep an independent expected inventory and one assertion that
  keys reach `saveStateCache`. Do not change entity identities while moving
  tests; the B20 question is separate.
- **Evidence and history:** `9bf27073c9` extracted production logic from
  compaction for five consumers but left its direct tests behind; B05 and B09
  independently reproduced the ownership issue.
- **Existing work:** no duplicate origin; B09 explicitly deferred it to B05.
- **Required verification:** `checkFile` both specs; utility, compaction,
  snapshot, backup, and clean-slate tests; compare model and empty-state
  inventories. Not run.
- **Estimated delta / benefit:** production 0; tests about −90 to −150 net.
  Faster failures and one direct behavior owner for five callers.
- **Blast radius / reversibility / risk / confidence:** tests only, trivial
  revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  independently before entity-identity changes.

### B05-C05 — Gate transitional IndexedDB connection ownership cleanup

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-idb-lifecycle::adopt-connection-rollout`; already-tracked.
- **Baseline / origin / revision hash:** `9b448133…`; B05; `2dd9d7d40d2321c10c136ab92ef9270a6c4ad5ccc80c1a836be8efdbc09c4558`.
- **Domains / category:** B05 primary; B06 and B07 related; transitional
  lifecycle duplication gated by backend rollout.
- **Exact evidence:** `operation-log-store.service.ts:227-310,328-471`
  retains service-owned schema/connection/open retry and a private database
  getter; `indexed-db-op-log-adapter.ts:135-224` owns another open path;
  `archive-store.service.ts:55-184` repeats borrowed-connection lifecycle.
  Tests dynamically access the private connection for fault injection.
- **Current responsibility / consumers / formats:** the bridge lets current
  backends share/adopt the existing IDB connection while SQLite migration and
  native selection remain transitional. Removing it now could strand existing
  stores or erase interruption seams.
- **Unnecessary mechanism / smallest eventual change:** only after no backend
  borrows a connection, make adapters sole initialization owners and delete
  `adoptConnection`, service/archive open paths, private getter, and duplicated
  schema types. Schema derivation is a separate decision.
- **Equivalence / invariants / failure modes:** preserve v8–v10 barriers,
  historical upgrades, close/versionchange/iOS retry, atomic migration, native
  selection, and fault injection. No current behavior-preserving closure fits
  before rollout gates.
- **Evidence and history:** exactly covered by
  `sqlite-migration-followup.md:203-216` Tracks D1/D2, A6-PW-008, and reconciled
  rollout issues.
- **Existing work:** already tracked and support-gated; no new issue.
- **Required verification:** eventual real IDB/SQLite, native-device,
  interruption, migration, rollback, and provider suites; not currently
  admissible.
- **Estimated delta / benefit:** eventual production reduction likely exceeds
  100 LOC; validation cost large. Benefit is real but conditional.
- **Blast radius / reversibility / risk / confidence:** persistence lifecycle
  and profile migration; difficult recovery; high/sync-critical risk;
  supported evidence for the gate, not for removal today.
- **Verifiers / disposition / recommendation:** none; already tracked; retain
  until native-default and migration preconditions are met.

### B06-C01 — Narrow the persistence port to operations actually consumed

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-db-port::unused-convenience-methods`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B06; `b4dc9a0f015675badd37fb8cecdcf744437c8f06ecfcaaac22b48987e23d773f`.
- **Domains / category:** B06 primary; B05 and B07 related; dead internal port
  surface and dual-adapter duplication.
- **Exact evidence:** unused top-level methods are
  `indexed-db-op-log-adapter.ts:278-280,296-304,318-324`; unused transactional
  `getAllFromIndex` is at `:419-427`. Their contracts are in
  `op-log-db-adapter.ts:97-128,175-215` and SQLite copies in
  `sqlite-op-log-adapter.ts:654-699,824-826`. Remaining calls are tests at
  `indexed-db-op-log-adapter.spec.ts:217-230,267-274`,
  `sqlite-op-log-adapter.spec.ts:289-294,332-386`, and migration mocks at
  `op-log-backend-migration.spec.ts:28-70`.
- **Current responsibility / consumers / formats:** computed-access and
  repository searches find no production call to top-level `clear`, top-level
  `getKeyFromIndex`, adapter `countFromIndex`, or transaction
  `getAllFromIndex`. Similarly named conflict-journal calls use raw IDB. The
  internal port is not a package/plugin/barrel or serialized contract.
- **Unnecessary mechanism / smallest change:** remove these four methods from
  only their unused contract levels, both implementations, mocks, and direct
  tests. Change migration-test cleanup to an explicit transaction. Retain
  transactional `clear`/`getKeyFromIndex`, top-level `getAllFromIndex`, normal
  `count`, and their underlying primitives.
- **Equivalence / invariants / failure modes:** no production call, schema,
  ordering, error mapping, or wire shape changes. Confusing top-level with
  transactional variants could remove live atomic cleanup; declared-store
  scope and rollback tests must remain.
- **Evidence and history:** static and computed-property closure. All methods
  arrived in persistence extraction `4c239e5691`/`#7902`; these four never
  acquired a production consumer.
- **Existing work:** narrower than A6-PW-008 and SQLite rollout `#7931`; it
  changes neither backend selection nor migration.
- **Required verification:** repeat Git-universe/computed-access closure;
  `checkFile` port, both adapters, and specs; IndexedDB, SQLite, migration, and
  operation-store suites plus app typecheck. No tests ran during the audit.
- **Estimated delta / benefit:** production −55 to −70 LOC; tests −25 to
  −45. Removes four cross-engine implementation and parity obligations.
- **Blast radius / reversibility / risk / confidence:** internal port plus two
  adapters; mechanically reversible; low-medium risk, supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B06-C02 — Share one behavioral adapter contract across IndexedDB and SQLite

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-db-tests::shared-idb-sqlite-contract`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B06; `7a2a52729b0ed35909ec97cc98c710ba0d4bf0232476ad44975be17a1eab4e3f`.
- **Domains / category:** B06 primary; B07 and C6 related; duplicated parity
  test harness.
- **Exact evidence:** `indexed-db-op-log-adapter.spec.ts:52-440` and
  `sqlite-op-log-adapter.spec.ts:267-660` independently spell roughly 18 common
  CRUD, unique-index, range/index read, cursor ordering/deletion, transaction,
  scope, commit, and rollback cases. B07 independently reproduced this overlap.
  SQLite-specific translation/queue cases remain at `:671-767`; IDB lifecycle
  and retry cases remain at its spec `:442-565`.
- **Current responsibility / consumers / formats:** these test-only suites
  validate the same internal `OpLogDbAdapter` contract on fake IndexedDB and
  real sql.js. A roughly 210-line `FakeSqliteDb` additionally emulates enough
  SQL semantics to duplicate the behavioral engine. None has a runtime or
  persistent representation.
- **Unnecessary mechanism / smallest change:** extract only identical public
  port assertions into one adapter-factory/teardown helper and run it against
  fake IndexedDB and real sql.js. Reduce `FakeSqliteDb` to a recording stub for
  SQL emission, parameter translation, queue, and failure-injection cases; do
  not use that hand-built emulator as a third conformance engine. Keep all
  engine-specific assertions and exact error/rollback expectations rather than
  lowering them to a common denominator.
- **Equivalence / invariants / failure modes:** the same engines and behaviors
  must execute. Preserve `ConstraintError`, readonly rejection, test isolation,
  atomic rollback, SQLite sequence materialization/scope/queue/DDL, and IDB
  retry/error/close/versionchange/adoption coverage.
- **Evidence and history:** both suites originated with
  `4c239e5691`/`#7902`; rollout docs treat parity as a gate. B07 corroborated the
  duplicate scenarios and challenged the original three-engine proposal:
  sql.js, not a growing fake interpreter, is the meaningful SQLite behavior
  target.
- **Existing work:** supports A6-PW-008 and `#7931`; no exact test-dedupe issue.
- **Required verification:** `checkFile` specs/helper; run both adapter suites,
  backend migration and dual-backend remote-apply integrations; compare test
  scenario counts before/after. Not run by the audit.
- **Estimated delta / benefit:** production 0; tests about −250 to −380 net,
  depending on how far the fake can shrink. One owner makes parity drift
  visible and removes duplicated behavior policy and emulator maintenance.
- **Blast radius / reversibility / risk / confidence:** test harness only,
  reversible; low-medium risk from async factory/isolation; supported.
- **Verifiers / disposition / recommendation:** B07 corroborated and materially
  refined the target; proposed; pursue after B06-C01 so the shared contract
  reflects the final port.

### B06-C03 — Delete duplicate mock assertions for the final upgrade shape

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `db-upgrade-tests::duplicate-final-shape`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B06; `1dd864b5c919289ea9624bb3547d6332f23a48cf9b5f3621aee7f4623c914ff9`.
- **Domains / category:** B06 primary; C6 related; redundant tests.
- **Exact evidence:** `db-upgrade.spec.ts:325-400` reasserts all nine stores and
  three indexes through mocks. Individual threshold tests at `:55-250` already
  cover each historical delta, while `op-log-db-schema.spec.ts:25-76` validates
  the complete final descriptors against real fake IndexedDB, including
  uniqueness and auto-increment metadata.
- **Current responsibility / consumers / formats:** tests only; the immutable
  upgrade path remains untouched. The block is a third representation of the
  target shape, weaker than the real-IDB drift guard.
- **Unnecessary mechanism / smallest change:** delete only the `full upgrade
  path` mock describe block. Retain every version threshold, v7 metadata cursor
  seeding, v10 downgrade barrier, and real final-shape guard.
- **Equivalence / invariants / failure modes:** production and scenario
  coverage remain. Removing threshold or downgrade tests instead would erase
  compatibility barriers and is explicitly outside the candidate.
- **Evidence and history:** mock coverage came from `53685eb3a7`; redundancy
  arose when `4c239e5691` added the stronger descriptor test.
- **Existing work:** no exact issue or prior-plan overlap found.
- **Required verification:** `checkFile`; DB-upgrade and schema specs; compare
  retained threshold inventory. Commands were not run.
- **Estimated delta / benefit:** production 0; tests −77 LOC. Future schema
  entries need one target-shape assertion rather than two.
- **Blast radius / reversibility / risk / confidence:** one spec, trivial
  revert; very low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  opportunistically.

### B06-C04 — Correct the schema descriptor's contradictory ownership comment

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-schema-docs::indexeddb-descriptor-consumption`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B06; `c1b7762aef121df8c266925fe26785f8d42c022477d8fa838736abc445e5c440`.
- **Domains / category:** B06 primary; B07 and C7 related; source-comment drift.
- **Exact evidence:** `op-log-db-schema.ts:4-12` says the descriptor replaces
  `runDbUpgrade` and creates IDB stores/indexes, while its own `:43-53` says it
  is only a target shape. `indexed-db-op-log-adapter.ts:194-199` still calls
  `runDbUpgrade` and consumes only descriptor name/version. The schema spec
  `:6-13` accurately explains this; `sqlite-migration-followup.md:210-216`
  leaves derivation as future work.
- **Current responsibility / consumers / formats:** SQLite consumes structural
  store entries; IndexedDB consumes imperative version deltas plus descriptor
  name/version. The contradiction is maintainer guidance only.
- **Unnecessary mechanism / smallest change:** rewrite the opening JSDoc to
  state current ownership and retain both representations and all code.
- **Equivalence / invariants / failure modes:** comment-only. Historical IDB
  deltas and SQLite target parity remain. Trusting the current comment could
  cause an unsafe edit that silently skips upgrade history.
- **Evidence and history:** stale wording originated with `4c239e5691`; later
  clarifying text did not replace it.
- **Existing work:** adjacent to A6-PW-015/generic docs drift, without an exact
  source-comment item.
- **Required verification:** cross-check adapter initialization and schema
  constants; `checkFile op-log-db-schema.ts`; schema drift spec if code moves.
- **Estimated delta / benefit:** runtime/tests 0; comments −3 to −8 LOC.
  Low direct benefit but removes a high-risk false ownership claim.
- **Blast radius / reversibility / risk / confidence:** one comment, trivial
  revert; very low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B02-C02 — Remove the test-only capture-service getter

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `capture-meta::get-operation-capture-service`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B02;
  `12e4b1b5cc79a9206bbd4a0ef5c53dc47ec48d1120d36addc2f91f07583634db`.
- **Domains / category:** B02; dead exported API and implementation-detail test
  seam.
- **Exact evidence:** `getOperationCaptureService()` is defined at
  `operation-capture.meta-reducer.ts:110-115`. Its only tracked reverse
  references are its import/assertions in
  `operation-capture.meta-reducer.spec.ts:5,76-92`; it is not barrel-exported.
- **Current responsibility / consumers / formats:** it exposes private
  module-global DI state only so a spec can inspect setter assignment. It has no
  runtime, serialized, persisted, plugin, or compatibility consumer.
- **Unnecessary mechanism / smallest change:** delete the getter, its JSDoc,
  and direct setter/getter tests. Retain `setOperationCaptureService` and the
  behavioral test proving that a persistent local action reaches the installed
  service. Do not remove the separately consumed `getIsApplyingRemoteOps()`.
- **Equivalence / invariants / failure modes:** bootstrap injection and capture
  behavior remain unchanged. A hidden untracked deep import is the only
  plausible failure; tracked search and the barrel surface close that path.
- **Evidence and history:** repo-wide reverse-reference and export searches;
  getter originated in `11375db` on 2025-12-08 and never acquired a production
  consumer.
- **Existing work:** no exact local plan or fetched issue overlap found.
- **Required verification:** `checkFile` and the focused
  `operation-capture.meta-reducer.spec.ts`; commands not run.
- **Estimated delta / benefit:** production −6 LOC; tests about −17; docs 0.
  Shrinks exported surface and tests behavior instead of private state.
- **Blast radius / reversibility / risk / confidence:** one module/spec,
  trivial revert, low risk, supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B02-C03 — Trim stale effects-spec scaffolding and one duplicate example

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `capture-tests::effects-unused-scaffolding-single-deferred`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B02;
  `2ee82fc7f933849add075814623b9cb3084d87223bd7ffb245f77623da6d1652`.
- **Domains / category:** B02; test clarity and redundancy.
- **Exact evidence:** `operation-log.effects.spec.ts:3,35,72,96,111`
  constructs/provides a `Store` spy although `OperationLogEffects` does not
  inject `Store`; lines `57-62,88` include an unused `append` spy although
  production uses `appendWithVectorClockUpdate`. The port-contract happy-path
  test at lines `805-819` and single-deferred-action test at `827-840` exercise
  the same action, method, and append assertion.
- **Current responsibility / consumers / formats:** the spec protects ordered
  persistence, quota recovery, compaction, and deferred-drain behavior. The
  unused mocks and duplicate example have no production or wire consumer.
- **Unnecessary mechanism / smallest change:** remove unused Store/`append`
  fixture setup and only the duplicate single-action example. Retain the
  interface-typed port test plus distinct ordering, acknowledgment, retained
  suffix, concurrency, failure, lock, fresh-clock, and stream-survival cases.
- **Equivalence / invariants / failure modes:** production is untouched and
  unique behavior coverage remains. A future Store injection would make
  TestBed fail explicitly instead of relying on unrelated setup.
- **Evidence and history:** spec/production dependency comparison and test-body
  comparison; scaffolding predates the December 2025 reorganization. The
  standalone `#8306` stream-survival regression remains necessary.
- **Existing work:** no exact plan or fetched issue overlap found.
- **Required verification:** `checkFile` and the focused effects plus
  stream-survival specs; commands not run.
- **Estimated delta / benefit:** production 0; tests about −20 LOC; docs 0.
  Reduces fixture noise in the largest B02 spec.
- **Blast radius / reversibility / risk / confidence:** one spec, trivial
  revert, very low risk, supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  opportunistically.

### B03-C01 — Remove the inactive remote-archive notification signal

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `remote-archive-postpass::remoteArchiveDataApplied::no-active-consumer`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B03, independently
  corroborated by B04;
  `ebb061b94f886cd06adfa5c6ecf3867eb51456832ff8793369103813b6bbd792`.
- **Domains / category:** B03 primary; B04, B29, C1 related; dead lifecycle
  notification and cross-package callback.
- **Exact evidence:** `operation-applier.service.ts:18,147-152` imports and
  dispatches `remoteArchiveDataApplied`; `sync-core/src/replay-coordinator.ts:43,55-61,107,159-161,230,238,263-266`
  carries a callback plus `hadArchiveAffectingOp` solely for that notification;
  `archive.actions.ts:5-14` declares it. Its only application consumer is the
  fully commented block at `archive-operation-handler.effects.ts:100-124`,
  disabled because immediate worklog reloads froze the UI. The historical
  action-type sentinel is at `action-types.enum.ts:15-20`.
- **Current responsibility / consumers / formats:** static Git-universe search
  finds the declaration, app dispatch, commented consumer, specs, and sync-core
  callback tests only. The action is reducer-less and non-persistent. The enum
  string may still describe historical logs and is excluded from deletion.
- **Unnecessary mechanism / smallest change:** remove app import/dispatch,
  action creator, sync-core callback, `hadArchiveAffectingOp`, and disabled
  effect block. Keep archive predicates, post-pass handling, sequential side
  effects, partial-success/retry semantics, both event-loop yields, and the enum
  compatibility sentinel.
- **Equivalence / invariants / failure modes:** no active code observes the
  signal, so navigation/manual worklog refresh remains current behavior. Before
  deletion, close dynamic plugin/devtool observers of the literal action type;
  never remove the archive post-pass itself or change `skipReducerDispatch`.
- **Evidence and history:** B03 and B04 independently reproduced the consumer
  closure. `96a5a0d818` introduced the signal to break a WorklogService cycle;
  `92ed8322f5` disabled its consumer after freezes; `298928e6d2` moved the
  surviving dispatch behind sync-core callback plumbing.
- **Existing work:** no dedicated fetched issue or prior-plan record found.
- **Required verification:** repeat Git-universe and dynamic-registration
  searches; `checkFile` all touched TS; run sync-core, operation-applier, and
  archive-handler-effect specs; targeted archive/worklog browser
  characterization. Commands not run by the audit.
- **Estimated delta / benefit:** production −35 to −55 LOC; tests −70 to −100;
  docs negligible. Medium-high maintenance benefit: removes a false lifecycle
  signal and app↔package callback.
- **Blast radius / reversibility / risk / confidence:** app/sync-core replay
  boundary, mechanically reversible, medium risk, supported confidence pending
  dynamic-consumer closure.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue after
  characterization.

### B03-C02 — Remove deprecated, test-only hydration aliases

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `bulk-replay-naming::deprecated-hydration-aliases::internal-test-only`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B03;
  `9cb8eb1d5a35f85608f27337797daf23d398ddeed46d31af16c8b247adfd67f9`.
- **Domains / category:** B03 primary; C1 and C7 related; internal API/naming
  cleanup.
- **Exact evidence:** `bulk-hydration.action.ts:40-43` aliases
  `bulkApplyHydrationOperations` to `bulkApplyOperations`, and
  `bulk-hydration.meta-reducer.ts:211-214` aliases `bulkHydrationMetaReducer` to
  `bulkOperationsMetaReducer`. Searches excluding tests/specs/docs find no
  consumer beyond the alias definitions; remaining uses are tests and two
  comments.
- **Current responsibility / consumers / formats:** the aliases preserve old
  compile-time vocabulary for internal tests. They are not package exports,
  serialized action strings, wire fields, or persisted symbols.
- **Unnecessary mechanism / smallest change:** mechanically rename tests and
  comments to canonical bulk-replay names, then delete both aliases.
- **Equivalence / invariants / failure modes:** the aliases are exact references
  to the same action creator and reducer, so emitted runtime behavior is
  identical. Confirm that direct out-of-tree imports from internal app paths are
  not a supported API.
- **Evidence and history:** production/test/export reverse searches; aliases
  entered in `edb164eb78`, while broader remote/bulk vocabulary is now
  canonical.
- **Existing work:** no dedicated issue; minor overlap with C7 docs naming.
- **Required verification:** Git-universe alias search; `checkFile` production
  files and touched specs; bulk meta-reducer, hydrator, and integration specs.
  Commands not run.
- **Estimated delta / benefit:** production −8 LOC; tests near-neutral renames;
  comments −2. Low-medium benefit from one canonical vocabulary.
- **Blast radius / reversibility / risk / confidence:** compile-time-only,
  readily reversible, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue at
  low priority.

### B03-C03 — Derive app apply contracts from sync-core generics

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `operation-apply-contract::duplicated-app-core-result-options::single-type-owner`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B03;
  `8cb963a3977f8a4543338c53a9d44fc960b97018e154e4790b69eaf671c44dcc`.
- **Domains / category:** B03 primary; B29, C2, C4 related; duplicated type
  contract and module-boundary cleanup.
- **Exact evidence:** `src/app/op-log/core/types/apply.types.ts:1-65`
  duplicates the result and base option fields in
  `packages/sync-core/src/apply.types.ts:1-48`; the package port is at
  `sync-core/src/ports.ts:21-55`. `operation-applier.service.ts:22-32,82-85`
  imports/re-exports the app copies. App callers mostly infer service method
  types; only a hydrator retry integration spec directly consumes the app type.
- **Current responsibility / consumers / formats:** app types narrow the
  generic package contract to app `Operation` and add host lifecycle flags.
  They have no emitted runtime or persisted/wire representation.
- **Unnecessary mechanism / smallest change:** alias app
  `ApplyOperationsResult` to `CoreApplyOperationsResult<Operation>`; extend the
  core base options and retain only app fields `skipDeferredLocalActions`,
  `remoteApplyWindowAlreadyOpen`, and `onReducersCommitted`. Preserve app
  `Operation`, callback signatures, and every call site.
- **Equivalence / invariants / failure modes:** type-only change. Do not combine
  it with the roadmap's discriminated mode/result redesign, and keep every
  app-specific lifecycle flag local.
- **Evidence and history:** package extraction `5fc9fe0411` / merged PR `#7546`
  created the split; `79f91e36fe` and `5624f6891d` changed both copies in
  lockstep, reproducing the drift cost.
- **Existing work:** narrower than A6-PW-002 and A6-PW-005; adjacent to their
  type/boundary goals but not a behavior-changing roadmap phase.
- **Required verification:** `checkFile` app types/service, sync-core tests,
  operation-applier and hydrator retry specs, package/app typecheck. Commands
  not run.
- **Estimated delta / benefit:** production −14 to −20 LOC; tests/docs
  unchanged. Medium maintenance benefit through one owner for the common
  contract.
- **Blast radius / reversibility / risk / confidence:** public TypeScript
  boundary but no runtime change; reversible; low-medium risk; supported
  confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue as a
  standalone type-only slice.

### B04-C01 — Use the existing atomic archive write for the local flush

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `archive-flush::local-young-old-write::atomic-adapter`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B04;
  `9c73ffbd75d62e96c9b0ecc3b6c2ab20b5661877207af91823e5480bcaa213b8`.
- **Domains / category:** B04 primary; B06 and B09 related; duplicated
  persistence transaction and recovery policy.
- **Exact evidence:** `archive.service.ts:279-330` saves young and old
  separately, then implements a four-write best-effort rollback. The already
  injected `ArchiveDbAdapter` exposes `saveArchivesAtomic` at
  `archive-db-adapter.service.ts:78-90`, backed by one transaction at
  `archive-store.service.ts:257-289`; the remote flush uses it at
  `archive-operation-handler.service.ts:312-350`. Six rollback-oriented tests
  occupy `archive.service.spec.ts:283-423`.
- **Current responsibility / consumers / formats:** the local archive path
  first persists newly archived tasks to young, then conditionally moves old
  task/time-tracking data from young to old before dispatching the persistent
  flush action. The two archive store values and action timestamp remain the
  same persisted inputs and outputs.
- **Unnecessary mechanism / smallest change:** replace only the two flush
  saves and manual rollback block with `saveArchivesAtomic(newYoung, newOld)`.
  Keep the earlier task-to-young save, pre-dispatch ordering, mutex, sorting,
  timestamps, error propagation, and no-dispatch-on-failure behavior.
- **Equivalence / invariants / failure modes:** on success both versions are
  identical. On failure the transaction leaves the earlier task write in
  young and the pre-flush old value intact, exactly the state the manual
  rollback attempts to restore, without a rollback that can itself fail.
  Invariants 3, 4, 8, and 17 remain protected; dispatching after a failed
  transaction or accidentally rolling back the initial archive insertion are
  the critical regressions to test.
- **Evidence and history:** call-site, adapter, and transaction searches
  reproduce the duplicate mechanism. `52c8237fa42` added manual rollback;
  `cddbcd8a64` and later `#8843`/`5edb659a65` established the atomic API for
  remote flush and compression. Open issue `#8843` names compression, not this
  remaining local path.
- **Existing work:** adjacent to completed atomic-write work in `#8843`; no
  fetched issue or local plan exactly tracks the local-flush residual.
- **Required verification:** characterize the pre-flush young write, atomic
  arguments, transaction rejection, absence of flush dispatch, and preserved
  original old value. Run `checkFile` on touched TypeScript plus the focused
  archive service, adapter/store transaction, handler, and archive replay
  tests; no command was executed by the audit.
- **Estimated delta / benefit:** production about −35 to −45 LOC; tests about
  −70 to −100 LOC after replacing rollback-internals with atomic behavior
  assertions; docs 0. Removes a second, weaker transaction implementation and
  an unrecoverable rollback-failure state.
- **Blast radius / reversibility / risk / confidence:** one local persistence
  path using an established API; easily reversible; sync-critical because a
  mistake can split archive halves, but supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue as
  an isolated persistence change with two independent reviewers.

### B04-C02 — Remove the inert `isIgnoreDBLock` option threading

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `archive-mutex::is-ignore-db-lock::inert-flag-threading`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B04;
  `8ae6c2f26cf23da82ebdd333b50f113cbb25739708e602b1fe4d095ff3512aca`.
- **Domains / category:** B04 primary; B35 and C2 related; obsolete option bag
  and duplicated local/remote branches.
- **Exact evidence:** `task-archive.service.ts:112-127` states that every
  mutation unconditionally takes `TASK_ARCHIVE`, yet seven public signatures
  still accept `isIgnoreDBLock` at lines `253-357,408-507` without reading it.
  `archive-operation-handler.service.ts:231-302,383-463` still computes and
  passes the flag. Its spec contains option-specific assertions throughout
  `:285-835,1557-1588`, including comments that now incorrectly say remote
  calls need the bypass.
- **Current responsibility / consumers / formats:** the option formerly
  bypassed a database lock when sync already held the op-log lock. Since
  `TASK_ARCHIVE` is an independent mutex, every path now takes it. Tracked
  Git-universe search finds only the service, handler, and their tests; the
  flag has no serialized, persisted, wire, plugin, or provider representation.
- **Unnecessary mechanism / smallest change:** remove only the inert field,
  now-empty option parameters, remote/local ternaries, and tests of flag
  forwarding. Preserve `isSkipDispatch`, all handler calls, the unconditional
  mutex, and behavioral local/remote archive assertions.
- **Equivalence / invariants / failure modes:** the callee does not inspect the
  field, so runtime locking and archive results are unchanged. Accidentally
  removing or conditionally bypassing `TASK_ARCHIVE`, or dropping
  `isSkipDispatch` on remote update calls, would reopen lost-write or duplicate
  op-capture failures and must be rejected.
- **Evidence and history:** repository search and blame reproduce the inert
  surface. Commit `867d84a3d1` made the mutex unconditional and explicitly
  retained the flag only for a follow-up. Closed issue `#8941` says to remove
  this threading; merged PR `#9006` completed the remaining writer locks but
  left the flag in place.
- **Existing work:** already named by `#8941` and its implementing history,
  although that issue is closed with this cleanup still present. D1 should
  preserve that overlap rather than create a new issue-shaped record.
- **Required verification:** repeat tracked dynamic/export searches; prove
  every mutation still requests `TASK_ARCHIVE` for both local and remote
  actions; run `checkFile`, TaskArchiveService lock tests, and archive handler
  tests. No audit command executed tests.
- **Estimated delta / benefit:** production about −25 to −40 LOC; tests about
  −90 to −140 LOC of flag-only branches/assertions; docs/comments about −10.
  Removes a misleading escape hatch from a data-safety boundary.
- **Blast radius / reversibility / risk / confidence:** two production modules
  and specs; reversible; medium implementation risk around a sync-critical
  lock invariant; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; classify
  as already tracked by `#8941`, then pursue only as a separate cleanup.

### B04-C03 — Remove the unused batch archive getter

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `task-archive-api::get-by-id-batch::test-only`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B04;
  `e556ccae25d4ea7388db292b239fc0f73ff3ab907152ad86db3b11512c1dd8b5`.
- **Domains / category:** B04 primary; C1 related; dead internal API.
- **Exact evidence:** `TaskArchiveService.getByIdBatch` and its example occupy
  `task-archive.service.ts:219-251`; its four direct tests are
  `task-archive.service.spec.ts:1195-1262`. Tracked Git-universe reverse search
  finds no other reference. The neighboring `hasTasksBatch` is consumed by
  `ArchiveOperationHandler` and is explicitly excluded.
- **Current responsibility / consumers / formats:** the method loads both
  archive halves once and returns found tasks with young taking precedence.
  Only its own spec observes it; it is not barrel-exported, serialized,
  persisted, injected through a token, or part of a package/plugin contract.
- **Unnecessary mechanism / smallest change:** delete the method, JSDoc/example,
  and its four tests. Do not consolidate it with or alter `getById`,
  `hasTask`, `hasTasksBatch`, or merged archive loading.
- **Equivalence / invariants / failure modes:** no tracked runtime caller means
  application behavior and formats remain unchanged. The only plausible
  regression is an unsupported out-of-tree deep consumer, which verification
  must explicitly close before deletion.
- **Evidence and history:** reverse reference, barrel/export, DI, string, and
  plugin-surface searches; commit `e43adba618` added both batch methods, but
  only `hasTasksBatch` acquired a production consumer.
- **Existing work:** no exact fetched issue or local-plan overlap found.
- **Required verification:** repeat Git-universe/static-string and public
  surface searches, then run `checkFile` and the focused TaskArchiveService and
  archive-handler specs. Commands were not executed by the audit.
- **Estimated delta / benefit:** production −33 LOC; tests −68 LOC; docs 0.
  Removes an unused archive read API and a full test block.
- **Blast radius / reversibility / risk / confidence:** one internal
  service/spec, trivial revert, low risk, reproduced static confidence pending
  explicit out-of-tree API policy closure.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B04-C04 — Move archive's utility-only timezone assertion to its owner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `archive-tests::timezone-demo::get-db-date-str-owner`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B04;
  `5868738df5350de21667f7ab329a11c3510969b194ee93a7226eb37777a462fc`.
- **Domains / category:** B04 primary; B35, B36, and C6 related; misplaced and
  partly tautological test coverage.
- **Exact evidence:** `archive.service.tz.spec.ts:1-83` never constructs or
  calls `ArchiveService`; it only calls `getDbDateStr`, logs environment data,
  manually repeats local date formatting, and asserts that an object key it
  just created is present. Its fixed-instant case branches on the current
  offset rather than exercising archive sorting. The utility already owns
  focused coverage in `src/app/util/get-db-date-str.spec.ts:1-16`, and the
  timezone npm lanes include every `**/*.spec.ts`, not only `.tz.spec.ts`.
- **Current responsibility / consumers / formats:** the useful intent is that
  a UTC instant maps to the local calendar day used to retain today's tracking
  data. The production call remains in `archive.service.ts:229-233`; no format
  or runtime consumer depends on the test file name.
- **Unnecessary mechanism / smallest change:** move one fixed-instant,
  timezone-lane-safe assertion to `get-db-date-str.spec.ts`, then delete the
  archive-named demo spec and its console logging. Keep archive sorting tests
  that actually exercise today's-data placement.
- **Equivalence / invariants / failure modes:** production is untouched and the
  meaningful local-day behavior still runs in Berlin, Los Angeles, Tokyo,
  Sydney, and UTC lanes. Do not replace it with a host-dependent assertion or
  reduce the timezone lane matrix.
- **Evidence and history:** test-body comparison plus `package.json` timezone
  script inspection. The file began in `c346694055`; later fixes made it
  host-independent, but it never became an ArchiveService test. Existing
  utility and timezone integration suites cover the same primitive more
  directly.
- **Existing work:** overlaps the broad test-deduplication remit of C6, not a
  fetched issue or behavior roadmap.
- **Required verification:** `checkFile` the destination spec; run it in all
  five timezone scripts and run archive sorting/service specs. Commands were
  not executed during the audit.
- **Estimated delta / benefit:** production 0; tests about −70 to −78 LOC net;
  docs 0. Restores test ownership and removes logs/tautologies without losing a
  distinct timezone scenario.
- **Blast radius / reversibility / risk / confidence:** tests only, trivial
  revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B04-C05 — Correct the archive storage topology diagram

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `archive-docs::separate-indexeddb-claim::sup-ops-stores`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B04;
  `7b13fb2ddda7f71cac976a60b6084a0e2c99ae32ef7a963761befb4db3bff5bf`.
- **Domains / category:** B04 primary; B06, B37, and C7 related;
  documentation/diagram drift.
- **Exact evidence:** `diagrams/06-archive-operations.md:31-70,100-108`
  repeatedly depicts a separate Archive IndexedDB and a dual-database
  architecture; `diagrams/README.md:16` repeats the label. Current code says
  and implements the opposite: `archive-db-adapter.service.ts:27-35,50-89`
  delegates archive stores to `ArchiveStoreService`, whose
  `archive-store.service.ts:233-289` reads/writes `archiveYoung` and
  `archiveOld` through the same persistence adapter/transaction as `SUP_OPS`.
- **Current responsibility / consumers / formats:** the diagram explains why
  archive side effects are outside NgRx and operation payloads. That special
  handling remains true, but it is store/data ownership, not a second physical
  database. Runtime database names, stores, schemas, and wire formats are
  unchanged.
- **Unnecessary mechanism / smallest change:** redraw only the storage portion
  as one `SUP_OPS` persistence database/backend with separate ops, state-cache,
  archive-young, and archive-old stores; change “dual database” references to
  “separate archive stores.” Preserve all local/remote ordering and archive
  resurrection material.
- **Equivalence / invariants / failure modes:** documentation-only. The danger
  is deleting or bypassing the archive transaction because a maintainer trusts
  a false physical boundary, or incorrectly designing backend migrations
  around a nonexistent database.
- **Evidence and history:** code/doc cross-check and blame. Commit `9f0adbb95c`
  introduced the diagram wording in January 2026; archive persistence was
  already routed through the op-log adapter, and later refactors
  `09d1c76d9d`, `4c239e5691`, and `db990b7018` make the single backend explicit.
- **Existing work:** generic documentation drift is already tracked by open
  `#8760`; that issue does not identify this exact archive topology claim.
- **Required verification:** compare the diagram against store constants and
  IndexedDB/SQLite adapter initialization, render Mermaid, and run Markdown
  formatting/link checks. No runtime tests are required unless adjacent source
  comments change.
- **Estimated delta / benefit:** production/test 0; docs near-neutral or about
  −10 LOC. Replaces a false storage model with the actual transaction boundary.
- **Blast radius / reversibility / risk / confidence:** documentation only,
  immediately reversible, low implementation risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; link to
  `#8760` and pursue as a documentation correction separate from behavior.

### B01-C01 — Enforce app entity-registry completeness at compile time

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `entity-registry::complete-regular-keyset::app-registry`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B01; `47604c6f23c2b5484828c67155dd619688b018cc19f8253ade3001b942dedd9a`.
- **Domains / category:** B01 primary; B18, B29, and B37 related; type-safety
  and duplicated test inventory.
- **Exact evidence:** `packages/shared-schema/src/entity-types.ts:15-43`,
  `packages/sync-core/src/entity-registry.types.ts:43-51`, and
  `src/app/op-log/core/entity-registry.ts:33-36,157-166,347-401` define the
  regular and special entity set, but the generic registry type is partial.
  `entity-registry.spec.ts:15-97,381-426` manually duplicates inventories and
  a hard-coded count. Validation, LWW replay, and conflict consumers include
  `validate-operation-payload.ts:92,146`,
  `lww-update.meta-reducer.ts:463`, and
  `conflict-resolution.service.ts:383`.
- **Current responsibility / consumers / formats:** 18 regular entity entries
  map immutable entity strings to payload keys, storage patterns, selectors,
  and adapters. The generic core registry correctly supports partial hosts, but
  the application host requires every regular entity and currently proves that
  only with synchronized runtime lists.
- **Unnecessary mechanism / smallest change:** define an app-local regular
  entity type excluding `ALL`, `RECOVERY`, and `MIGRATION`; require the built
  object to satisfy `Record<RegularEntityType, HostEntityConfig>`. Keep the
  injected generic registry partial. Remove only the manual completeness/count
  canary, retaining storage-pattern, selector, unique-key, and special-type
  behavior tests.
- **Equivalence / invariants / failure modes:** type-only enforcement; runtime
  object order, strings, payload keys, DI value, operations, and stored data do
  not change. A missing normal entity must become a compiler failure, while
  special operation types remain absent. Do not replace behavioral tests with
  the type check.
- **Evidence and history:** inspection reproduces a prior real failure in
  `206ebc5306`: `SECTION` existed in entity types but not the registry, silently
  disabling validation/LWW/conflict handling. The registry originated in
  `58372626f1`; the generic package boundary changed in `b56c997874`.
- **Existing work:** adjacent to dead lint-rule issue `#8752` and broader model
  registration work `#8299`, but neither tracks exact app-host completeness.
- **Required verification:** `checkFile` on registry/spec; application
  typecheck; entity-registry, payload validation, LWW, and conflict unit and
  integration specs. Commands were not executed by the audit.
- **Estimated delta / benefit:** production +3 to +6 LOC; tests about −55 to
  −75; docs 0. Replaces two manual inventories and a count with compiler-owned
  exhaustiveness.
- **Blast radius / reversibility / risk / confidence:** two primary files,
  reversible; medium risk in a sync-critical registry; supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B01-C02 — Finish the zero-consumer app error cleanup

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `error-surface::unreferenced-app-sync-errors`; already-tracked.
- **Baseline / origin / revision hash:** `9b448133…`; B01; `6f1cadce7b21aa031d20f46de9f3b3a47751364b40e884f12e1b32a7e6fc2e42`.
- **Domains / category:** B01 primary; A5, C1, and C8 related; dead error
  taxonomy and test-only facade.
- **Exact evidence:** the seven classes are in
  `sync-errors.ts:4-6,31,113-115,275-331`; the app `extractErrorMessage` alias
  is at `:370-372`. Their only remaining checks are
  `sync-errors.spec.ts:1-10,63-83` and
  `encrypt-and-compress-handler.service.spec.ts:1-6,296-304`.
- **Current responsibility / consumers / formats:** Git-universe searches find
  no producer, importer, `instanceof`, name-string, serialized, or wire
  consumer for `UnknownSyncStateError`, `DBNotInitializedError`,
  `ModelMigrationError`, `ModelRepairError`, `InvalidModelCfgError`,
  `ModelVersionToImportNewerThanLocalError`, or `ModelValidationError`; the
  alias has only a duplicate test.
- **Unnecessary mechanism / smallest change:** delete exactly those seven
  classes, the alias, and their tests. Retain every class referenced by current
  TypeScript or tracked legacy PFAPI JavaScript and preserve canonical package
  error identity.
- **Equivalence / invariants / failure modes:** no tracked runtime behavior or
  format changes. Ordinary ignore-aware `rg` is insufficient: it hides tracked
  PFAPI JS and would wrongly admit additional live classes. Verification must
  use the Git universe and retain all current catch branches.
- **Evidence and history:** the tracked-universe pass rejected a broader
  deletion by finding live legacy references to client-ID, invalid-meta,
  model-ID, provider, validation, repair, and backup-import errors. Commit
  `8171bb05d0` completed phase-one cleanup and left this exact residual.
- **Existing work:** exact direction is already covered by `#8326` and prior
  `#8325/#8510`; do not file a duplicate.
- **Required verification:** repeat exact symbol searches over `git ls-files`,
  run `checkFile`, error/identity/encryption-handler specs, and app typecheck.
  No audit tests were run.
- **Estimated delta / benefit:** production −45 to −50 LOC; tests −30 to
  −32; docs 0. Removes seven inert concepts and one duplicate facade.
- **Blast radius / reversibility / risk / confidence:** local and reversible;
  low risk with supported confidence, subject to external deep-import policy.
- **Verifiers / disposition / recommendation:** none; already tracked; feed
  the exact residual list into `#8326`.

### B01-C03 — Remove algebraically no-op model types

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `model-types::unknown-json-union-and-duplicate-map`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B01; `4e5d62db54a1e3903aba1d686cd21a1f594a3f771dbbc99561b9ba690e4f8867`.
- **Domains / category:** B01 primary; C1 and C2 related; redundant type
  contracts.
- **Exact evidence:** `src/app/op-log/core/types/sync.types.ts:20-29,49-62,139`
  defines `ModelBase` as `SerializableObject | SerializableArray | unknown`
  and defines `AllSyncModels<T>` identically to `AllModelData<T>`.
  `sync-exports.ts:4-20` exports the latter; the only other reference is
  pseudocode at `operation-log-architecture.md:178`.
- **Current responsibility / consumers / formats:** the first type appears to
  constrain model values to JSON, but union with `unknown` accepts every value.
  The second appears to name another model map but has no code consumer beyond
  its barrel export. Both erase at runtime.
- **Unnecessary mechanism / smallest change:** express `ModelBase` directly as
  `unknown`; delete `AllSyncModels` and its barrel export; change the one doc
  reference to the canonical map. Do not tighten malformed-data inputs.
- **Equivalence / invariants / failure modes:** TypeScript accepts the same set
  and `AllModelData` inference stays intact; persisted and wire shapes do not
  change. An untracked external type importer is the only identified risk.
- **Evidence and history:** exact tracked symbol searches find only definition,
  barrel, and doc. Both constructs arrived unchanged in `db990b7018`.
- **Existing work:** adjacent to `#8326` and A6-PW-005, with no exact tracked
  item for these aliases.
- **Required verification:** repeat public/deep import search; `checkFile` both
  TS files; app typecheck/build and model-config/backup validation compilation.
- **Estimated delta / benefit:** production −13 LOC; tests 0; docs neutral.
  Removes a false serializability signal and a duplicate semantic name.
- **Blast radius / reversibility / risk / confidence:** type-only, two code
  files and one doc reference; trivial revert; low risk, supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B01-C04 — Remove the unused app parser half of the entity-key facade

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `entity-key::unused-app-parser-and-duplicate-tests`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B01; `e69f1c1e93feaecb8121120d10bfefe2dfa2b21431fa4904b1698b473bdce5ab`.
- **Domains / category:** B01 primary; B29, C1, and C4 related; dead wrapper and
  duplicate format tests.
- **Exact evidence:** app `entity-key.util.ts:1-18` wraps the package utility;
  app `entity-key.util.spec.ts:1-119` tests both wrappers. The canonical parser
  is `packages/sync-core/src/entity-key.util.ts:9-27` and is publicly exported
  at `sync-core/src/index.ts:168`. Tracked search finds the app
  `parseEntityKey` only in its definition and spec, while app `toEntityKey` has
  conflict, rejection, clock, and store consumers.
- **Current responsibility / consumers / formats:** the used app encoder
  usefully narrows the generic package argument to `EntityType`; the unused
  parser only casts arbitrary package output to that type. The `TYPE:id`
  format, first-colon parsing, and colon-containing IDs are persisted contract
  details owned by sync-core.
- **Unnecessary mechanism / smallest change:** retain the typed app encoder;
  delete only the app parser and replace the repetitive app suite with a small
  package-level contract spec for exact format, first-colon behavior,
  colon-containing IDs, and malformed keys.
- **Equivalence / invariants / failure modes:** production callers and bytes are
  unchanged. Preserve encoder narrowing and canonical parser behavior; do not
  delete the whole app facade or weaken malformed-key assertions.
- **Evidence and history:** tracked reference closure; package extraction
  `5fc9fe0411` created the generic implementation and deliberately retained
  app-narrowed seams.
- **Existing work:** concrete cleanup after merged `#7546`/A6-PW-005; no exact
  open issue found.
- **Required verification:** `checkFile`; sync-core entity-key spec/package
  typecheck; app consumer typecheck. Commands were not run.
- **Estimated delta / benefit:** production about −10 LOC; tests −75 to −90
  net; docs 0. Leaves one parser contract and one concise test owner.
- **Blast radius / reversibility / risk / confidence:** two primary files and
  one package test; reversible; low but format-sensitive risk; supported.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B01-C05 — Stop retaining decrypted JSON content on parse errors

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `privacy::json-parse-error::plaintext-data-sample`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B01; `79a3da4fd738460559d70b974ef52eb8093cc3c9cfc07b7145fe5a8f32a98ff4`.
- **Domains / category:** B01 primary; B22, B24, and C8 related; data
  minimization and unused diagnostic field.
- **Exact evidence:** `sync-errors.ts:241-267` stores about 100 characters of
  decrypted sync JSON in `JsonParseError.dataSample`.
  `encrypt-and-compress-handler.service.ts:140-145` passes the full output;
  sample-specific tests are at its spec `:129-145,205-294`. Recovery consumers
  at `sync-wrapper.service.ts:797-809` and the file adapter `:2851-2874` do not
  read the field; `core/log.ts:54-70` does not serialize Error own-properties.
- **Current responsibility / consumers / formats:** the exception's class,
  safe message, and byte position route corrupt/truncated files to recovery.
  The plaintext sample has no production reader or supported diagnostic
  output and has no wire/persisted role.
- **Unnecessary mechanism / smallest change:** stop passing decrypted output;
  remove the constructor parameter, property, substring extraction, and
  sample-specific tests. Preserve error identity, position, generic message,
  recovery routing, backup handling, and force-overwrite behavior.
- **Equivalence / invariants / failure modes:** supported behavior remains the
  same while the Error object retains less user content. Corrupt JSON must
  still throw `JsonParseError` and expose an actionable position; sanitization
  must not bypass fail-closed decryption or recovery UI.
- **Evidence and history:** `git grep dataSample` finds only the class/tests.
  Commit `7496b2dd604` added the sample for debugging `#5771`;
  `8171bb05d0` later removed constructor logging because of privacy risk.
- **Existing work:** adjacent to exported-content issues `#7619/#7870`, but no
  exact fetched issue covers this retained in-memory diagnostic data.
- **Required verification:** `checkFile`; error, encryption-handler, wrapper,
  and file-adapter corruption/recovery specs; add an assertion that the thrown
  error exposes no plaintext sample. No audit test ran.
- **Estimated delta / benefit:** production −7 to −9 LOC; tests −40 to −50;
  docs 0. Removes unsupported diagnostic surface and shortens plaintext
  lifetime/retention.
- **Blast radius / reversibility / risk / confidence:** two production blocks
  and focused tests; reversible; low, privacy-positive risk; supported.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B09-C01 — Remove the unused compact log-entry codec half

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `compact-codec::operation-log-entry-half::test-only`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B09; `219cf80e1322d1fa422d9d86ee3aa0c2681e37f37551ee183046313cb0308ae7`.
- **Domains / category:** B09 primary; B05, B24, and C1 related; dead internal
  type/functions and test-only compatibility surface.
- **Exact evidence:** `CompactOperationLogEntry` occupies
  `compact-operation.types.ts:61-73`; `encodeOperationLogEntry`,
  `decodeOperationLogEntry`, and `isCompactOperationLogEntry` occupy
  `operation-codec.service.ts:79-135,152-164`. Their only tracked consumers are
  codec tests at `operation-codec.service.spec.ts:5-8,99-153,173-194`.
  Production store and file-sync paths consume only `CompactOperation`,
  `encodeOperation`, `decodeOperation`, and `isCompactOperation`.
- **Current responsibility / consumers / formats:** current persisted entries
  retain normal lifecycle fields around a compact `op`; only the operation
  payload is encoded. The entry-level interface/functions model an alternative
  whole-entry codec that was never adopted. They are not barrel/package/plugin,
  reflection, wire, or database-schema APIs.
- **Unnecessary mechanism / smallest change:** delete the entry interface,
  three functions, imports, and their direct tests. Keep the complete operation
  codec, action-code table/fallback, mixed old/full row decoding, and every
  lifecycle field on actual stored entries.
- **Equivalence / invariants / failure modes:** no runtime call or stored byte
  changes. Verification must distinguish historical rows whose `op` is full
  from the never-used whole-entry codec and must retain compact operation
  compatibility for IndexedDB and file-sync envelopes.
- **Evidence and history:** Git-universe and dynamic string/export closure.
  Commit `e177d928f6` introduced the entry codec and its tests together, but the
  store in that same commit used only the operation codec; no later commit
  added a production consumer.
- **Existing work:** authorized exact issue search for
  `CompactOperationLogEntry` returned no match; no local plan names it.
- **Required verification:** repeat tracked/export/dynamic closure; `checkFile`
  codec/types/spec; store codec, mixed historical-row, file adapter, and compact
  operation tests. No tests ran during the audit.
- **Estimated delta / benefit:** production about −80 to −85 LOC; tests about
  −80 to −95. Removes a false persisted format and its maintenance burden.
- **Blast radius / reversibility / risk / confidence:** three internal files,
  trivial revert; low format-sensitive risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B09-C02 — Remove redundant action-code canaries

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `action-code-tests::duplicate-count-inverse-roundtrip`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B09; `164bb88960d2bd01555aed43540f207f2b0665458add257068b5241e7c2de3be`.
- **Domains / category:** B09 primary; B01 and C6 related; duplicate and brittle
  format tests.
- **Exact evidence:** `action-type-codes.spec.ts:27-37,67-75` separately proves
  inverse mapping and then the same all-entry round trip. The core enum spec
  `action-types.enum.spec.ts:15-31` adds a manually maintained member count,
  map-set correspondence, and another direct round trip. Compile-time
  `Record<ActionType,string>` completeness is at `action-type-codes.ts:35`.
- **Current responsibility / consumers / formats:** immutable action strings
  and short codes are persisted and must remain byte-stable. Unique codes,
  two-to-three-character limits, exhaustive enum↔map correspondence, unknown
  fallback, format pattern, and critical exact values each have distinct
  value; the exact count and repeated inverse loops do not.
- **Unnecessary mechanism / smallest change:** keep one exhaustive inverse/
  round-trip assertion in the codec spec and one enum↔map completeness
  assertion in the enum spec; remove the hard-coded count and duplicate loops.
  Retain unique/length/fallback and exact critical-string checks.
- **Equivalence / invariants / failure modes:** tests only. A code reassignment,
  missing enum entry, duplicate code, malformed format, or fallback regression
  must still fail. Do not regenerate or reorder codes and do not remove the
  historical `ARCHIVE_REMOTE_DATA_APPLIED` sentinel with B03-C01.
- **Evidence and history:** body comparison; mapping/specs originated in
  `e177d928f6`, while repeated enum canaries accumulated after
  `170db8ab81`. Feature commits repeatedly update both mapping and the manual
  count, demonstrating the drift cost without additional coverage.
- **Existing work:** broad C6 test-deduplication overlap; no exact issue found.
- **Required verification:** `checkFile` both specs; focused enum/code and
  operation codec suites; mutation-check a missing mapping and duplicate code.
- **Estimated delta / benefit:** production 0; tests about −15 to −30 LOC.
  Low-medium benefit: one source of exhaustiveness truth and fewer manual
  feature-update chores.
- **Blast radius / reversibility / risk / confidence:** tests only, trivial
  revert; very low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue at
  low priority.

### B09-C03 — Trim duplicated and non-serializing compaction tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `compaction-tests::duplicate-lock-race-timeout-orchestration`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B09; `f2717bba63760eea5934fce8cf6a81ff605eb0d9b52a06db34cd56055e51273c`.
- **Domains / category:** B09 primary; B05, B36, and C6 related; redundant or
  misleading unit orchestration.
- **Exact evidence:** `operation-log-compaction.service.spec.ts:93-227,409-460`
  splits one happy-path call into many spy micro-tests and then records its
  ordered lock path. Lock-name assertions at `:93-100` and `:918-925` are
  identical. Last-sequence filtering is repeated at `:349-368,927-967,997-1047`.
  The “concurrent” case at `:969-995` uses an inline callback mock that does not
  serialize. Save-failure coverage repeats at `:462-468,1049-1089`; timeout
  error content repeats at `:1099-1123,1132-1151`, with a normal happy path at
  `:1125-1130`.
- **Current responsibility / consumers / formats:** the 1,154-line spec protects
  snapshot-before-delete, pending/terminal filters, retention differences,
  clock pruning, meaningful-state guards, ordering, errors, and timeout
  behavior. Those distinct scenarios remain necessary; repeated spy plumbing
  and a mock that cannot prove serialization do not.
- **Unnecessary mechanism / smallest change:** retain one ordered happy-path
  case, one rich seq-boundary filter case, one save-failure short-circuit case,
  and one timeout-message case; delete exact duplicates and the false
  serialization test. Keep real LockService serialization coverage and every
  unique compaction/integration scenario.
- **Equivalence / invariants / failure modes:** production untouched. Preserve
  cache-before-counter-before-delete ordering, `seq <= lastSeq`, pending and
  rejected semantics, regular/emergency cutoffs, error propagation, lock name,
  and timeout branch. A future ordering mutation must still fail.
- **Evidence and history:** test-body/call-order comparison. Coverage accumulated
  across `11d0fef9ac`, `526afbafef`, `3930526f77`, and later race fixes without
  retiring superseded micro-tests.
- **Existing work:** C6 owns broad harness dedupe; no exact fetched issue.
- **Required verification:** `checkFile`; focused compaction unit/integration,
  capture quota recovery, remote processing, and LockService suites; compare
  named scenario inventory and use a representative ordering mutation.
- **Estimated delta / benefit:** production 0; tests about −150 to −220 LOC.
  Medium benefit from a smaller, more truthful safety suite.
- **Blast radius / reversibility / risk / confidence:** one spec, reversible;
  low implementation risk but sync-critical assertions; supported confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue only
  with an assertion-by-assertion preservation map.

### B09-C04 — Table-drive snapshot validation and consolidate its happy path

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `snapshot-tests::repeated-validation-and-migration-happy-path`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B09; `877fd682a351d478a3e5569b61f75e52be13c188efc4a88874802b7b24a06f2d`.
- **Domains / category:** B09 primary; B08, B11, and C6 related; repetitive
  unit-test setup.
- **Exact evidence:** `operation-log-snapshot.service.spec.ts:98-169` uses 13
  near-identical tests for required metadata/core models; `:409-462` repeats
  identical migration setup four times to assert backup, save, clear, and
  return separately. Failure/rollback/validation cases at `:464-582` are
  distinct and excluded.
- **Current responsibility / consumers / formats:** validation rejects malformed
  state-cache metadata before hydration/migration; backup→validate→save→clear
  ordering protects recovery. Only the test representation changes.
- **Unnecessary mechanism / smallest change:** use a named invalid-case table
  plus explicit valid/additional-model cases; combine successful migration
  assertions and order into one happy-path test. Keep each failure injection,
  restore failure, no-clear, metadata-before-state-validation, and lock/order
  regression test.
- **Equivalence / invariants / failure modes:** production untouched and every
  invalid input and migration phase remains asserted. Each table row must retain
  a descriptive case name, and the combined happy path must assert order rather
  than merely call counts.
- **Evidence and history:** direct body comparison. Migration validation and
  rollback hardening accumulated after the original broad snapshot suite,
  leaving repeated happy-path fixture blocks.
- **Existing work:** generic C6 overlap; no exact issue or plan item.
- **Required verification:** `checkFile`; snapshot, schema migration, hydrator,
  state-consistency, and legacy migration specs; compare case inventory.
- **Estimated delta / benefit:** production 0; tests about −50 to −80 LOC.
  Low-medium maintenance benefit without deleting a recovery scenario.
- **Blast radius / reversibility / risk / confidence:** one spec, trivial
  revert; low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  opportunistically.

### B08-C01 — Remove the dead remote-rehydration facade chain

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `hydration-api::dead-data-init-hydrator-facades`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B08; `a360c8019486e74642c0fb45072dba3b448f211888832191f5727c8564fa6528`.
- **Domains / category:** B08 primary; B11 related; dead internal API and test
  scaffolding.
- **Exact evidence:** `data-init.service.ts:55-72` exposes
  `reInitFromRemoteSync()`, which only calls
  `operation-log-hydrator.service.ts:701-709`; that method delegates to
  `SyncHydrationService`. Its import/injection are at
  `operation-log-hydrator.service.ts:14,82`. Repository-wide search finds no
  production caller. Active sync calls `SyncHydrationService` directly at
  `operation-log-sync.service.ts:1327,1923`. Dead fixtures remain across the
  hydrator, retry-integration, and sync-wrapper specs.
- **Current responsibility / consumers / formats:** two app-internal forwarding
  methods and DI fixtures; neither is a package, plugin, wire, or serialized
  contract.
- **Unnecessary mechanism / smallest change:** delete both forwarding methods,
  the hydrator dependency, their direct tests, and stale `DataInitService`
  fixtures in sync-wrapper tests. Leave direct `SyncHydrationService` callers
  unchanged.
- **Equivalence / invariants / failure modes:** no runtime caller, state
  transition, archive behavior, clock, snapshot, or replay path changes.
  Residual risk is an untracked out-of-tree consumer of an app-internal
  injectable surface.
- **Evidence and history:** call/export closure and history. The chain arrived
  in `c77e34c7a0`; `3ef23354e4` removed its last production call and injection
  from `SyncWrapperService` but left the downstream facade and spec fixtures.
- **Existing work:** no matching candidate found; A6-PW-003 is a broader
  full-state decomposition roadmap.
- **Required verification:** repeat static method-name closure; `checkFile` all
  changed TypeScript; hydrator, DataInit, retry-integration, and sync-wrapper
  specs. No tests ran during the audit.
- **Estimated delta / benefit:** production about −30 to −40 LOC; tests about
  −35 to −55. Removes misleading ownership and redundant DI.
- **Blast radius / reversibility / risk / confidence:** app-internal startup and
  sync surface; easy revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B08-C02 — Centralize only the duplicated safe full-state hydration shortcut

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `hydrator::last-full-state-direct-load`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B08; `7894006eaf433207decd29208248c317f40546398c7be08fa1ae5d0961052054`.
- **Domains / category:** B08 primary; B03 and B10 related; sync-critical
  duplication.
- **Exact evidence:** near-identical direct-load blocks occur in the
  snapshot-tail branch at `operation-log-hydrator.service.ts:253-293` and full
  replay at `:359-387`. Both reject the shortcut when any row is pending,
  extract the last full-state payload, validate non-fatally, merge its clock
  before `loadAllData`, and dispatch replacement state. Regression coverage is
  duplicated around `operation-log-hydrator.service.spec.ts:731-876,1572-1636`.
- **Current responsibility / consumers / formats:** the optimization loads a
  terminal `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR` without replay while
  preserving pending-row checkpointing and clock order.
- **Unnecessary mechanism / smallest change:** introduce one private helper
  accepting entries plus validation/log context and returning whether it
  direct-loaded. It owns only the identical pending guard, extraction,
  validation, clock merge, and dispatch. Keep snapshot loading, replay
  migration, partitioning, checkpointing, validation gates, and snapshot-save
  thresholds in their existing branches.
- **Equivalence / invariants / failure modes:** preserve clock-before-dispatch,
  full-state payload normalization, nonfatal validation, and the rule that any
  pending row forces reducer replay. Over-factoring the outer branches could
  break snapshot-plus-tail equivalence or checkpoint policy.
- **Evidence and history:** body and dual-edit history. `431290c170` patched
  clock-before-load in both branches; `5624f6891d` added the pending-work guard
  to both. Repeated paired edits demonstrate drift cost.
- **Existing work:** adjacent to A6-PW-003, but this is a bounded private helper
  rather than orchestrator decomposition.
- **Required verification:** parameterized snapshot/no-snapshot tests for every
  full-state type, pending predecessor/current row, wrapped and legacy payloads,
  validation failure, and clock-before-dispatch; retain branch-specific tests.
- **Estimated delta / benefit:** production about −20 to −35 LOC; tests may
  lose −30 to −60 through cautious parameterization.
- **Blast radius / reversibility / risk / confidence:** startup replay hot path;
  easy revert; medium sync risk; supported-high confidence.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue as an isolated change.

### B08-C03 — Remove inert hydrator startup placeholders and unused DI

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `hydrator::inert-startup-hooks-and-di`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B08; `0f387e495d1e38027385f14b8d362c0dafcc40d4e4519da25f4f4e1a61e716b1`.
- **Domains / category:** B08 primary; dead code, unused DI, and test fixtures.
- **Exact evidence:** no-op hooks are called at
  `operation-log-hydrator.service.ts:98,432` and defined at `:756-758,869-871`.
  `VectorClockService` is imported/injected at `:33,73` but never read.
  `RepairOperationService` and `VectorClockService` are hydrator-spec-only dead
  fixtures.
- **Current responsibility / consumers / formats:** the hooks resolve
  immediately; the injection and fixtures only satisfy construction. Real
  migration, archive migration, recovery, retry, and clock persistence use
  separate services.
- **Unnecessary mechanism / smallest change:** delete the two calls/methods,
  unused injection/import, and corresponding fixtures. Do not touch
  `OperationLogMigrationService`, `ArchiveMigrationService`,
  `OperationLogRecoveryService`, or `OperationLogEffects`.
- **Equivalence / invariants / failure modes:** removes two resolved-Promise
  microtasks and unused objects. No migration version, recovery, retry, archive,
  clock, or replay behavior changes.
- **Evidence and history:** hooks and injection arrived in `082d363b55`.
  Non-ancestor branch `pr-8588`, commit `ebd612200f`, already removes both
  placeholder hooks, confirming prior work, but leaves unused vector/repair
  scaffolding.
- **Existing work:** partially implemented by `pr-8588`; do not import its
  wider unrelated refactor.
- **Required verification:** confirm branch disposition; `checkFile` service and
  spec; hydrator and retry-integration specs plus DI construction.
- **Estimated delta / benefit:** production about −20 LOC; tests about −15.
- **Blast radius / reversibility / risk / confidence:** startup construction
  only; trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; reuse or
  dedupe the narrow prior work, then remove remaining dead DI.

### B08-C04 — Anchor replacement snapshots to the sequence returned by append

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `snapshot-anchor::append-returned-sequence`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B08; `ce5f722ecfc04b5122ef52059ca279d6707d30b7b21bd0f89e47906d5f01dd5d`.
- **Domains / category:** B08 primary; B06 related; snapshot-tail correctness
  plus a redundant persistence read.
- **Exact evidence:** `OperationLogStoreService.append()` returns the exact
  inserted sequence at `operation-log-store.service.ts:666-688`, but
  `SyncHydrationService` discards it and queries the global tail at
  `sync-hydration.service.ts:238-243`; migration repeats this at
  `operation-log-migration.service.ts:278-284`.
- **Current responsibility / consumers / formats:** `lastAppliedOpSeq` defines
  which operations a snapshot includes and which tail must replay.
- **Unnecessary mechanism / smallest change:** assign `lastSeq` directly from
  `append()` in the `createSyncImportOp` branch and migration. Keep
  `getLastSeq()` at `sync-hydration.service.ts:259` for file bootstrap, where no
  operation was appended.
- **Equivalence / invariants / failure modes:** single-writer behavior is
  identical and one DB read disappears. Under concurrency, the exact appended
  sequence prevents a later row from being skipped by a snapshot that does not
  contain it. No wire, schema, or vector-clock change.
- **Evidence and history:** both callers predate the return contract. `append()`
  began returning its assigned key in `cabf266574c` and retained exact
  transactional return for full-state ops in `807d3bf5e5`; the older callers
  were not updated.
- **Existing work:** no matching finding or prior branch located.
- **Required verification:** regression with `append() → 7` and
  `getLastSeq() → 8`, asserting anchor 7 and replayable tail row 8; migration,
  destructive hydration, and file-bootstrap suites.
- **Estimated delta / benefit:** production about −4 LOC and one IndexedDB read
  per destructive import or migration; one focused regression.
- **Blast radius / reversibility / risk / confidence:** tiny persistence seam
  but data-loss-sensitive; easy revert; medium risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue before broader hydration refactors.

### B08-C05 — Collapse superseded local-only hydration test permutations

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-hydration-tests::local-only-round-trip-matrix`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B08; `18392a332fc8db1f618aae3ac128dd8348e1e52a71e957c2b68b76c0d6916371`.
- **Domains / category:** B08 primary; B11 and C6 related; test duplication.
- **Exact evidence:** manual permutations occupy
  `sync-hydration.service.spec.ts:851-1089,1141-1187`. The self-expanding
  `LOCAL_ONLY_SYNC_KEYS` round trip at `:1091-1139` already checks every key in
  dispatch and snapshot. `:291-320` separately checks the persisted
  `SYNC_IMPORT` payload and preservation of non-local properties. Utility edge
  cases live in `local-only-sync-settings.util.spec.ts:81-116`.
- **Current responsibility / consumers / formats:** tests protect device-local
  sync settings across destructive hydration, persisted replacement operation,
  snapshot, and NgRx dispatch.
- **Unnecessary mechanism / smallest change:** retain the dynamic round trip,
  payload/non-local-property test, and structural absent-config cases; remove
  verbose enabled/disabled/provider permutations and the purported “full
  reload” test, which never constructs a fresh hydrator. Keep file-bootstrap
  and destructive-import tests unrelated to local-only settings.
- **Equivalence / invariants / failure modes:** test only. Persisted-operation
  payload coverage must remain alongside snapshot and dispatch coverage; all
  three surfaces matter.
- **Evidence and history:** manual tests accumulated in `4a3155b887`,
  `d401e6169e`, and `c19365908a`; dynamic coverage added later in `1bfa6028de`
  explicitly grows with the key list and supersedes most permutations.
- **Existing work:** no matching audit candidate found.
- **Required verification:** hydration and local-only utility specs; mutation-
  check each `LOCAL_ONLY_SYNC_KEYS` member across operation payload, snapshot,
  and dispatch; preserve a mechanical assertion map.
- **Estimated delta / benefit:** production 0; tests about −180 to −240 LOC.
- **Blast radius / reversibility / risk / confidence:** test only; easy revert;
  low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue.

### B07-C01 — Delete the unused readonly callback-transaction mode

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oplog-db-port::unused-readonly-transaction-mode`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B07; `80ee63bb5d8b2ad2f7ebe6425614e2890a53f3ef2c448185f81e3b8345cacf76`.
- **Domains / category:** B07 primary; B05 and B06 related; dead internal API
  branch and backend-parity hazard.
- **Exact evidence:** `op-log-db-adapter.ts:34,79-87,206-215` offers
  readonly/readwrite callback transactions. SQLite maps readonly to
  `BEGIN DEFERRED` at `sqlite-op-log-adapter.ts:719-726`, but transaction
  mutators at `:784-806` never inspect `_mode`; SQLite deferred transactions
  remain writable. `tx.iterate` at `:828-841` also lets `options.mode` override
  the enclosing mode, contradicting the port's “ignored; enclosing transaction
  governs” contract. IndexedDB naturally rejects readonly writes.
- **Current responsibility / consumers / formats:** all typed production
  callback transactions in the baseline and stale Android rollout branch pass
  `readwrite`; only an IndexedDB adapter test exercises readonly callback
  transactions. Standalone readonly `iterate` is live and must remain. No wire,
  package, or persisted-format impact.
- **Unnecessary mechanism / smallest change:** make
  `transaction(stores, fn)` readwrite-only; remove its mode argument, SQLite
  `DEFERRED` branch, `_mode`, and repeated `'readwrite'` arguments. Keep
  `DbIterateOptions.mode` for standalone scans.
- **Equivalence / invariants / failure modes:** current production behavior is
  unchanged. Preserve declared-store scope, whole-callback FIFO exclusion,
  commit/rollback, constraint mapping, and standalone readonly cursor behavior.
  If migration wiring needs an atomic readonly source snapshot, reject this
  deletion and instead enforce readonly on every mutator.
- **Evidence and history:** caller and history closure. The mode arrived in
  `4c239e5691`; `39755a3503` guarded only cursor deletion. The stale Android
  rollout branch retains the defect and has no production readonly callback.
- **Existing work:** no exact prior finding; depends on the B07 rollout decision
  and B06 adapter-contract refinement.
- **Required verification:** repeat computed/dynamic caller closure; shared
  fake-IDB/sql.js transaction contract; store, archive, and migration suites;
  app typecheck. No tests ran during the audit.
- **Estimated delta / benefit:** production about −35 to −45 LOC; tests/docs
  about −5 to −20. Removes a false capability and backend branch.
- **Blast radius / reversibility / risk / confidence:** internal persistence
  port; reversible; medium sync-critical implementation risk; supported.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue only
  after deciding whether migration needs a consistent readonly transaction.

### B07-C02 — Fail closed when SQLite insert rowid is absent

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sqlite-adapter::missing-insert-rowid-fallback`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B07; `c1274764ffb08b02936230507e167684669f8b734b6cbade4677e7fd54de7cb9`.
- **Domains / category:** B07 primary; B05 related; fail-closed persistence
  correctness.
- **Exact evidence:** `SqliteDb.run` makes `lastId` optional at
  `sqlite-op-log-adapter.ts:94-99`, and `sqlAdd` returns `res.lastId ?? 0` at
  `:326-340`. SQLite auto-increment operation sequences begin above zero.
  Operation-store callers immediately use this result as durable snapshot,
  frontier, or full-state metadata at
  `operation-log-store.service.ts:666-765,1006-1035`.
- **Current responsibility / consumers / formats:** every SQLite operation
  append depends on the returned sequence. Zero can make an existing row
  unreachable by its reported key and persist a false cache frontier.
- **Unnecessary mechanism / smallest change:** replace the zero fallback with
  one explicit positive-safe-integer assertion and throw when absent or
  invalid. Keep `lastId` optional on generic non-insert `run` responses.
- **Equivalence / invariants / failure modes:** current fake, sql.js helper, and
  intended native plugin return valid row IDs, so successful behavior is
  unchanged. Bridge regressions fail before an impossible sequence escapes.
- **Evidence and history:** present since `4c239e5691`. The unmerged Android
  wrapper forwards optional plugin `lastId`, and branch tip `ba6474f6f6`
  retains the zero fallback without an omission test.
- **Existing work:** rollout docs require forwarding the plugin row ID but do
  not require adapter validation; no exact issue or audit record found.
- **Required verification:** fake `run` returning `{changes: 1}` must reject;
  valid fake, sql.js, and native-wrapper appends remain positive; append, batch,
  recovery-snapshot, full-state-metadata, and rollback suites.
- **Estimated delta / benefit:** production about +3 to +6 LOC and tests +10 to
  +20; removes an invalid fallback state rather than reducing LOC.
- **Blast radius / reversibility / risk / confidence:** SQLite append path;
  trivial revert; low implementation complexity but sync-critical failure;
  supported.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue before any native rollout is revived.

### B07-C03 — Establish one canonical SQLite migration status document

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sqlite-migration-docs::duplicate-stale-status`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B07; `6bf42cd7457bac533297481a53dfa67d5d83a8ef6abc6db547e1c98cae6fcc08`.
- **Domains / category:** B07 primary; C7 and A6-PW-015 related; duplicated and
  stale architecture/rollout documentation.
- **Exact evidence:** `sqlite-migration.md:3-65` duplicates live progress;
  `:44-45` says backend-aware initialization remains while `:93` says no seam
  exists, both contradicted by code and
  `sqlite-migration-followup.md:8-35,146-179`. The follow-up calls A1 shipped at
  `:91-92` while retaining todo prose at `:55-67`, and calls transaction
  reentrancy lint future at `:175-179` although `610ca64894` enabled
  `no-adapter-in-tx`. It also overstates any-source/any-destination migration;
  only IDB-to-SQLite is implemented and tested.
- **Current responsibility / consumers / formats:** two documents compete as a
  live status source; neither affects runtime or persisted formats.
- **Unnecessary mechanism / smallest change:** keep `sqlite-migration.md` as
  stable rationale/invariants, make the follow-up the sole current rollout
  ledger, remove duplicate progress/resolved Track A prose, and accurately
  scope migration to IDB-to-SQLite.
- **Equivalence / invariants / failure modes:** documentation only. Preserve
  schema, quiescence, verification, source-retention, native-testing, and
  rollback gates; do not present the stale branch as safely mergeable.
- **Evidence and history:** document/code comparison. The unmerged Android
  branch makes the same documents more contradictory by combining early
  “unwired” bullets with later default-on claims.
- **Existing work:** route through A6-PW-015 and documentation issues
  `#8760/#8962`; avoid another generic docs-drift issue until their exact scope
  is checked.
- **Required verification:** link/reference check, Markdown formatting, and
  cross-check against token/init/lint plus the rollout-branch disposition.
- **Estimated delta / benefit:** documentation about −80 to −140 LOC; one
  canonical rollout narrative.
- **Blast radius / reversibility / risk / confidence:** documentation only;
  trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** none yet; proposed; pursue
  after the stale rollout branch is explicitly rebased or retired.

### B10-C01 — Encode backup restore provenance directly and remove dead positional flags

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `backup-import::verified-recovery-id-without-legacy-flags`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B10; `461c208ba1bd86d3fbf2d2d6cb7e0017975af1ed05324c06434d1acbf2b51047`.
- **Domains / category:** B10 primary; B18, B20, C1, and C2 related; internal
  API simplification and impossible-state removal.
- **Exact evidence:** `backup.service.ts:75-100` accepts backup data plus five
  positional controls. `isSkipLegacyWarnings` is never read. `isSkipReload`
  and `isForceConflict` are read only at `:209-211`, while all six production
  invocations pass `isSkipReload=true`: file import, local backup, SuperSync
  restore, recovery-slot restore, and both profile-switch branches.
  `isSkipPreImportBackup` and `requiredImportBackupId` must have identical
  presence at `:96-100` and then travel together to `:269-334`.
- **Current responsibility / consumers / formats:** six internal paths funnel
  full-state replacement through this method. The verified recovery-backup ID
  protects the single recovery slot; imported state, `BACKUP_IMPORT` wire
  shape, archives, fresh client ID, and vector clock are unaffected.
- **Unnecessary mechanism / smallest change:** make the signature
  `importCompleteBackup(data, requiredRecoveryBackupId?)`; ID presence alone
  skips the pre-import snapshot and is passed to
  `runDestructiveStateReplacement`. Remove the three obsolete flags, the
  redundant skip boolean, the impossible-pair guard, and positional booleans
  at callers.
- **Equivalence / invariants / failure modes:** all normal calls remain
  non-reloading. Recovery-slot restore still passes the exact loaded ID and
  compare-and-clears it only after success. Preserve flush-before-lock,
  pre-import-backup failure abort, atomic operation/cache/clock/client-ID/
  archive replacement, conflict-journal and task-time clearing,
  `lastServerSeq` reset, fresh `{clientId: 1}` clock, and import filtering.
- **Evidence and history:** caller closure found no package, plugin, global,
  computed-property, or serialized consumer. `2387d8b15e` records that an
  omitted positional boolean previously reused a clock and caused stale-client
  identity growth; `435018719f` later made fresh-clock generation
  unconditional, and `ffca0f1397` added exact backup-ID pairing.
- **Existing work:** no exact current issue or ledger item covers this API. It
  preserves A5-R04 and the `#7709/#8107` atomic-recovery work.
- **Required verification:** backup, file import, local backup, SuperSync
  restore, and profile-switch suites; retain mismatch, supersession, and failed
  restore characterization at the storage boundary; targeted import/export
  and archive-persistence E2E; `checkFile` every touched TypeScript file.
- **Estimated delta / benefit:** production about −30 to −45 LOC; tests about
  −35 to −60. Removes boolean blindness, four obsolete states, and a call-shape
  footgun with prior sync-bug history.
- **Blast radius / reversibility / risk / confidence:** one internal service
  and six callers; mechanical revert; medium sync-critical risk; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue first.

### B10-C02 — Make every complete backup archive-inclusive

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `complete-backup::mandatory-archive-inclusive-snapshot`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B10; `a09b63098dde754ffecc7014954453eafb35e09d409e22ec63faf8c975d4ba37`.
- **Domains / category:** B10 primary; B04, B09, C1, and C2 related; dead
  branch and data-completeness guard.
- **Exact evidence:** `backup.service.ts:53-72` names its result
  `CompleteBackup` but defaults `includeArchives=false`; that branch calls
  `getAllSyncModelDataFromStore()`, whose
  `state-snapshot.service.ts:117-124` substitutes empty archives. Every
  production call explicitly passes `true`: the global error handler, two
  profile snapshots, manual JSON export, and privacy export. No false or
  omitted production call or direct method test was found.
- **Current responsibility / consumers / formats:** error reports, profile
  snapshots, manual exports, and privacy exports serialize `CompleteBackup`.
  Archives are already part of `AppDataComplete` and the backup wire shape;
  omitting them can lose archived tasks and time tracking on restore.
- **Unnecessary mechanism / smallest change:** remove `includeArchives` and
  the empty-archive branch; always await canonical `getStateSnapshotAsync()`;
  remove explicit `true` arguments and add one focused archive-inclusion test.
- **Equivalence / invariants / failure modes:** behavior is identical for all
  live calls and the envelope is unchanged. Preserve the synchronous NgRx
  cutoff before archive awaits, both archive halves, timestamp/version fields,
  and failure propagation. Do not substitute the operation-log-projected
  snapshot; user backups capture full live state.
- **Evidence and history:** closed five-call production set. The option arrived
  with op-log integration in `db990b7018`; no current caller uses its default.
  Archive persistence fixes `6c3f183fb7` and architecture require both archive
  halves in full-state backups.
- **Existing work:** adjacent archive-loss fixes are complete; no exact current
  simplification item was found.
- **Required verification:** distinct young/old archive coverage in
  `BackupService`; global-error, profile, file-export, privacy-export, archive
  import/persistence suites; targeted import/export E2E and `checkFile`.
- **Estimated delta / benefit:** production about −8 to −12 LOC plus one small
  test; makes an incomplete “complete” backup unrepresentable.
- **Blast radius / reversibility / risk / confidence:** five internal callers;
  reversible; low code risk but data-loss-critical semantics; reproduced.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue.

### B10-C03 — Retire StateSnapshotService migration aliases

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `state-snapshot::pfapi-era-method-and-class-aliases`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B10; `9504c00bdc5ace4400d5a51376d8488f96320a5ca2eca2b08e541579a676b835`.
- **Domains / category:** B10 primary; B09, C1, and C7 related; deprecated
  internal API and documentation drift.
- **Exact evidence:** `state-snapshot.service.ts:138-144,182-188` wraps
  `getStateSnapshot()` and `getStateSnapshotAsync()` under old names, and
  `:234-235` re-exports the class as `PfapiStoreDelegateService`. Live alias
  calls remain in backup, local-backup, and sync-hydration services. No tracked
  TypeScript import of the class alias exists; architecture prose, specs,
  spies, and one obsolete E2E debug-log filter retain the old vocabulary.
- **Current responsibility / consumers / formats:** canonical snapshot APIs
  already serve hydration, validation, clean slate, compaction, upload, repair,
  and file sync. These aliases add no behavior or persisted/wire shape. The
  separately consumed `AppStateSnapshot` type re-export remains.
- **Unnecessary mechanism / smallest change:** migrate live calls and spies to
  canonical names, delete both wrappers and the class alias, correct current
  architecture examples, and remove the stale console filter. Keep
  operation-log-projected snapshot variants distinct.
- **Equivalence / invariants / failure modes:** wrappers delegate exactly.
  Preserve empty archive placeholders in the sync API, real paired archives
  and synchronous reducer-state cutoff in the async API, live-reference
  warning, task normalization, and operation-boundary task-time projection.
- **Evidence and history:** whole-tree exact and computed-name closure found no
  dynamic/package/plugin export. All aliases came from `db990b7018` during the
  PFAPI-to-op-log transition; canonical APIs now have broad direct use.
- **Existing work:** PFAPI artifact retirement remains A5-C01/`#8326`; this
  candidate removes only unused TypeScript transition names.
- **Required verification:** repeat export closure; snapshot, backup,
  local-backup, hydration, validation, compaction, clean-slate, integration,
  and archive round-trip suites; `checkFile` all touched TypeScript.
- **Estimated delta / benefit:** production/docs about −18 to −25 LOC; tests
  and mocks about −20 to −40. Leaves one snapshot vocabulary.
- **Blast radius / reversibility / risk / confidence:** internal renames only;
  immediately reversible; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue with B10-C02 so callers change once.

### B10-C04 — Share legacy project/tag time-tracking extraction

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `legacy-backup-v10::work-context-time-tracking-extractor`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B10; `b70d3355c9ecfed8bdcf65280d82cd0eb93df23e30c589ddc5749c11010cac2c`.
- **Domains / category:** B10 primary; C3 related; duplicated compatibility
  transformation.
- **Exact evidence:** `migrate-legacy-backup.ts:140-189,191-229` independently
  iterates project and tag entities, initializes the same session-map entry,
  overlays `workStart/workEnd/breakNr/breakTime` into `s/e/b/bt` by date, and
  deletes the same four fields. Existing coverage tests only project
  extraction/removal; the tracked v10 fixture has no tag work fields.
- **Current responsibility / consumers / formats:** legacy migration converts
  pre-v17 backups before validation. The historical entity fields and two
  time-tracking dictionaries are permanent compatibility inputs and outputs.
- **Unnecessary mechanism / smallest change:** add one narrowly named private
  extractor accepting an entity dictionary and returning a session map; call
  it once for projects and once for tags. Keep the four-field mapping explicit
  at this compatibility boundary and do not generalize other migrations.
- **Equivalence / invariants / failure modes:** preserve entity and overlay
  order, empty per-entity maps, absent/falsy handling, exact compact keys,
  in-place deletion, archive/time-tracking shape, idempotence guards, and
  unknown-key stripping. Add tag parity characterization before refactoring.
- **Evidence and history:** both blocks arrived together in `78699d278e`, whose
  history explicitly names project/tag extraction and real v10 preservation;
  blame shows no intentional divergence.
- **Existing work:** A5-R04 requires retaining pre-v17 migration; this only
  consolidates its implementation.
- **Required verification:** first characterize a tag with all four fields on
  overlapping and distinct dates, output, and field removal; retain project,
  real-fixture, v13–v16, idempotence, reminder, section, archive, Typia, and
  backup-service coverage; `checkFile` and targeted specs.
- **Estimated delta / benefit:** production about −40 to −60 LOC; tests +10 to
  +25. Gives one owner to a byte-for-byte duplicated historical mapping.
- **Blast radius / reversibility / risk / confidence:** one pure migration
  module; reversible; medium data-loss-sensitive risk; supported pending the
  characterization test.
- **Verifiers / disposition / recommendation:** two fresh compatibility
  reviewers required; proposed; pursue test-first.

### B10-C05 — Delete two never-consumed LegacyPfDbService writers

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `legacy-pf-db::orphan-save-archive-and-clear-all`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B10; `68dff22a1f2ee21c97156cfb977ff5adb4209cd20bbad3f75d6f414d73f3b902`.
- **Domains / category:** B10 primary; C1 and C3 related; dead internal service
  surface.
- **Exact evidence:** `legacy-pf-db.service.ts:312-320` defines `saveArchive`
  and `:382-397` defines `clearAll`. Whole-tree closure finds calls only in
  their direct spec blocks; no production, computed-property, package, plugin,
  or dynamic consumer exists. Active consumers use existence/data checks,
  entity and archive reads, meta/client-ID access, migration locks, and generic
  load/save for reminder cleanup.
- **Current responsibility / consumers / formats:** the service remains the
  critical read bridge for pre-op-log profiles. These two methods do not
  currently produce any legacy key or reset behavior.
- **Unnecessary mechanism / smallest change:** remove only `saveArchive`,
  `clearAll`, and their isolated specs. Retain generic `save`, which still
  clears the legacy reminders key, and every migration/read path.
- **Equivalence / invariants / failure modes:** no runtime call or IndexedDB
  shape/version changes. Do not broaden this to legacy DB retirement,
  archive-read deletion, or migration-lock cleanup; those could strand old
  profiles and require the A5 support decision.
- **Evidence and history:** exact/computed-name closure reproduces zero live
  consumers. Both methods were added in `db990b7018` and never acquired a
  production caller or later revision.
- **Existing work:** A5-R05 retains the legacy database and `#8326` tracks
  broader PFAPI artifacts. This narrow deletion is compatible with both and
  does not authorize legacy-support retirement.
- **Required verification:** repeat source/generated export closure; legacy DB,
  migration/recovery, archive migration, client-ID fallback, reminder
  migration, and blank-startup suites; `checkFile` service and spec.
- **Estimated delta / benefit:** production −24 LOC; tests about −35 LOC.
  Shrinks a high-risk compatibility surface without touching its active API.
- **Blast radius / reversibility / risk / confidence:** one service/spec;
  trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue.

### B12-C01 — Remove the unused entity-state repair variant

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `entity-state-util::fix-or-error::test-only`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B12; `7ffe233fd65fc0d5430c930fe6301cbbd8d0760641c17f6f6c8c1db25970f270`.
- **Domains / category:** B12 primary; dead production export and direct tests.
- **Exact evidence:** `check-fix-entity-state-consistency.ts:46-67` exports
  `fixEntityStateConsistencyOrError`; only its spec import and two direct tests
  at `:147-181` reference it. Current-tree and all-Git-ref exact, string,
  barrel, plugin, and package closure found no runtime consumer.
- **Current responsibility / consumers / formats:** it regenerates `ids` for
  inconsistent entity state but throws when state is already consistent,
  duplicating live `fixEntityStateConsistency` behind an inverted contract.
- **Unnecessary mechanism / smallest change:** delete the function, its spec
  import, and its two tests. Retain `isEntityStateConsistent` and
  `fixEntityStateConsistency`.
- **Equivalence / invariants / failure modes:** no action, DI, persistence,
  replay, or wire impact; there is no non-test call path.
- **Evidence and history:** added in `1e88740dd1`, with direct coverage in
  `557412586d`; it never acquired a production consumer.
- **Existing work:** no exact current item found.
- **Required verification:** repeat tracked/all-ref symbol and export closure;
  utility, model-config, and validation specs; `checkFile` both files.
- **Estimated delta / benefit:** production about −22 LOC; tests about −35.
  Removes a misleading second repair contract.
- **Blast radius / reversibility / risk / confidence:** one utility/spec;
  trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue.

### B12-C02 — Remove the test-only empty repair-summary API

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `repair-service::empty-summary::test-only-static-api`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B12; `29aaec6be139374644742f8d0dfe7ea4569af31432d72764a8237451999c7104`.
- **Domains / category:** B12 primary; A6-PW-015 and C7 related; dead public
  method and stale pseudo-code.
- **Exact evidence:** `RepairOperationService.createEmptyRepairSummary()` at
  `repair-operation.service.ts:239-251` is referenced only by its direct spec
  at `:360-371`. The similarly named integration helper is file-local and
  independent. Production `dataRepair()` constructs the real summary.
- **Current responsibility / consumers / formats:** the static method returns
  six zero counters; it never participates in a `REPAIR` payload, notification,
  vector clock, or persisted operation.
- **Unnecessary mechanism / smallest change:** delete the method and direct
  test. Correct or remove its architecture pseudo-code through A6-PW-015,
  without expanding this into another docs rewrite.
- **Equivalence / invariants / failure modes:** runtime repair, summary shape,
  lock ownership, notification, clock, and persistence remain unchanged.
- **Evidence and history:** method added in `d22fbe28b2a`, direct test in
  `1ed936ab235`; qualified-symbol closure found no runtime use.
- **Existing work:** coordinate stale architecture prose under A6-PW-015.
- **Required verification:** qualified symbol and public-surface closure;
  repair service/integration suites; `checkFile` service and spec; documentation
  reconciliation.
- **Estimated delta / benefit:** production about −13 LOC, tests about −12,
  docs about −10. Removes a false service capability.
- **Blast radius / reversibility / risk / confidence:** one service/spec and a
  routed doc snippet; easy revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue after doc ownership reconciliation.

### B12-C03 — Stop exporting full task objects from repair diagnostics

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `repair-logging::orphan-task-arrays::exportable-history`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B12; `5ce3f82462290e2557c246139d24342aacc82d3ea0ed1d942107cc3351eabbc9`.
- **Domains / category:** B12 primary; security/privacy hardening and diagnostic
  surface reduction.
- **Exact evidence:** `data-repair.ts:497,564,631` passes three `TaskCopy[]`
  collections to `OpLog.log`; those objects include titles and other user
  content. `core/log.ts:1-3,123-164,238-268,365-368` retains trailing arguments
  in exportable log history.
- **Current responsibility / consumers / formats:** the messages diagnose
  orphaned young, old, and active subtasks. The arrays are diagnostic only and
  do not feed repair behavior.
- **Unnecessary mechanism / smallest change:** keep labels and privacy-safe
  structure such as count and internal IDs, but never pass task objects. Add a
  sentinel-title regression against exported history.
- **Equivalence / invariants / failure modes:** repaired state, summary counts,
  ordering, replay, and wire data are unchanged; only unsupported sensitive
  diagnostic content is removed.
- **Evidence and history:** security commit `5772b3416c` redacted exportable
  user content and changed nearby data-repair logging, but missed these exact
  three arrays. This is a bounded residual, not a new generic sweep.
- **Existing work:** dedupe to the `5772b3416c`/GHSA hardening lineage and A6
  privacy issue record.
- **Required verification:** focused data-repair privacy regression with a
  sentinel title, core log-export coverage, full data-repair spec, and
  `checkFile`.
- **Estimated delta / benefit:** production roughly neutral plus a small test;
  eliminates three exportable user-content paths.
- **Blast radius / reversibility / risk / confidence:** diagnostics only;
  easy revert; low behavioral risk and privacy-positive; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh privacy/sync
  reviewers required; proposed; pursue first.

### B12-C04 — Move the time-loss probe into the canonical auto-fix suite

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `auto-fix-tests::time-number-probe::canonical-owner`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B12; `e7688adbcc100561b13593feda2417968f13d046823fce032acdceb2e1bd5026`.
- **Domains / category:** B12 primary; C6 related; diagnostic test duplication.
- **Exact evidence:** `auto-fix-time-spent-investigation.spec.ts:1-142` labels
  itself `PROBE`/`CONFIRM`, repeats the setup/helper owned by
  `auto-fix-typia-errors.spec.ts:1-28`, logs to console, and uses four tests for
  the same task-number fallback.
- **Current responsibility / consumers / formats:** the probe protects
  destructive invalid-number fallback for `timeSpentOnDay`, `timeSpent`, and
  `timeEstimate`, including multiple errors and a valid day bucket.
- **Unnecessary mechanism / smallest change:** preserve those inputs and the
  valid-value survivor in one table-driven or composite canonical test, then
  delete the probe file and console logging. Keep production fallback and its
  `devError` release valve unchanged.
- **Equivalence / invariants / failure modes:** test representation only; every
  unique numeric field and survivor assertion remains.
- **Evidence and history:** introduced as exploratory safeguards in
  `87bfb606e2`; later changes were lint maintenance only.
- **Existing work:** generic C6 consolidation overlap only.
- **Required verification:** mechanical scenario inventory; canonical auto-fix
  and non-finite time-tracking regression suites; `checkFile` canonical spec.
- **Estimated delta / benefit:** tests about −90 to −120 LOC net and removal of
  diagnostic console noise.
- **Blast radius / reversibility / risk / confidence:** test-only; trivial
  revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue.

### B12-C05 — Consolidate the #7330 diagnostic validator harness

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `validation-tests::hibernate-repro::canonical-cross-model-suite`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B12; `f01857a7d6a305ecd82c5b538c86410a63df1d04af786978454f30929155423b`.
- **Domains / category:** B12 primary; B01, B04, B11, and C6 related; duplicate
  diagnostic harness.
- **Exact evidence:** `hibernate-repro.integration.spec.ts:1-295` calls one pure
  validator, manually builds complete state, mutates global production mode,
  and logs five scenarios despite its integration label. Its missing-project
  task, TODAY, and valid controls already exist in the canonical relationship
  spec. Five corruptions remain unique: stale task tag, stale task project,
  orphaned task ID, contextless task, and regular-tag orphan.
- **Current responsibility / consumers / formats:** the unique scenarios pin
  pure cross-model rejection relevant to `#7330`; real recreate and
  multi-client convergence coverage exists elsewhere and remains.
- **Unnecessary mechanism / smallest change:** table-drive the five unique
  corruptions in `is-related-model-data-valid.spec.ts`, preserving expected
  validity/error and `#7330` rationale; delete the duplicate harness, logs, and
  environment mutation.
- **Equivalence / invariants / failure modes:** no production change. Preserve
  all five unique corruptions and do not weaken real B01-R03/B04-R04 replay and
  convergence tests.
- **Evidence and history:** exploratory harness added in `c590447d00`;
  `a57323277b` later had to repair stale message assertions in this second
  owner, demonstrating drift cost.
- **Existing work:** generic C6 overlap; exact pure-validator cases do not
  duplicate the retained real sync coverage.
- **Required verification:** assertion-by-assertion scenario map; canonical
  validator, `ValidateState`, and real `#7330` replay/convergence suites;
  `checkFile`.
- **Estimated delta / benefit:** tests about −170 to −230 LOC net; one owner for
  pure relationship validation.
- **Blast radius / reversibility / risk / confidence:** test-only but
  sync-related assertions; trivial revert; low implementation risk;
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh validation/sync
  reviewers required; proposed; pursue.

### B14-C01 — Replace obsolete and overlapping LockService tests with a behavior matrix

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `lock-service-tests::current-web-lock-and-fallback-matrix`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B14; `f8d7dcc5afbfc49de0f538837ae538070dc258b38c903d432327e7dc60a44edb`.
- **Domains / category:** B14 primary; B09 and C6 related; obsolete tests and
  duplicated concurrency coverage.
- **Exact evidence:** the 979-line `lock.service.spec.ts` tests a 130-line
  service. `:103-162` contains four localStorage stale/corrupt-value tests, but
  current fallback state is only `_fallbackLocks: Map<string, Promise<void>>`
  at `lock.service.ts:29-30,88-129` and never reads localStorage. Basic,
  concurrency, async/error, platform-fallback, Web-Lock, and contention success
  cases repeat across spec ranges `:21-101,164-230,373-676,678-764`.
- **Current responsibility / consumers / formats:** tests protect cross-tab Web
  Locks, same-tab Promise-chain fallback, per-name independence, callback
  results/errors, acquisition timeout, queue integrity, and recovery. No
  persisted or wire shape is involved.
- **Unnecessary mechanism / smallest change:** delete the four impossible
  localStorage cases and express the overlapping success/error/async/
  contention assertions as a small Web-Lock-versus-fallback behavior matrix.
  Preserve separate tests for Web-Lock abort mapping, fallback waiter timeout,
  no-overlap after timeout, queue cleanup, same-name reentry, and distinct
  lock-name nesting.
- **Equivalence / invariants / failure modes:** test-only. Retain real/fallback
  serialization, independent names, returned values, callback-error release,
  FIFO/no-starvation intent, timeout error properties, post-timeout recovery,
  and the separate real `#7700` regression proving clock-before-deferred
  persistence under actual `LockService`.
- **Evidence and history:** `a9becc2058` deleted the localStorage two-phase
  fallback but left its specs. Early breadth accumulated in
  `a18fc9d3ad, e498acc020, 615188bf88, 526afbafef`; newer
  `cc2c1a8162, 37cb791053, 753e5714fb` added distinct queue/reentry correctness
  regressions that must not be folded away.
- **Existing work:** keep the `#7700` regression and B09 lock/compaction
  invariants; generic C6 overlap only.
- **Required verification:** mechanical case-to-assertion inventory before
  deletion; focused lock spec plus real reentry regression; force both
  `navigator.locks` branches; fake-time timeout/queue mutation checks; `checkFile`.
- **Estimated delta / benefit:** tests about −300 to −450 LOC; one explicit
  matrix aligned with the two current implementations.
- **Blast radius / reversibility / risk / confidence:** test-only, one spec;
  trivial revert; medium verification risk because concurrency regressions are
  subtle; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh sync/concurrency
  reviewers required; proposed; pursue with an assertion inventory.

### B14-C02 — Table-drive operation-sync utility coverage

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `operation-sync-util-tests::exhaustive-classification-and-conversion-matrix`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B14; `c28106b37dc8c0c893df8742250e5f9298566e671079b9e930c8713d0a95eae8`.
- **Domains / category:** B14 primary; C6 related; test-only duplication and
  missing edge characterization.
- **Exact evidence:** `operation-sync.util.spec.ts:17-50` individually checks
  four file providers and SuperSync, although `:56-85` already exhaustively
  partitions every `SyncProviderId`; `:89-102` repeats provider/id agreement.
  `:106-147` has five nearly identical capability fixtures. `:166-298` copies
  one field or operation type per test and uses forbidden `any` at `:286-287`,
  while optional `syncImportReason`, `repairBaseServerSeq`, and invalid
  `opType` behavior lack direct coverage.
- **Current responsibility / consumers / formats:** the utility classifies
  file versus operation-sync providers and converts server operations into the
  local in-memory shape, including two optional causal fields.
- **Unnecessary mechanism / smallest change:** retain one exhaustive enum
  partition that checks both provider APIs; table-drive capability cases; use
  one whole-object conversion equality test plus focused `entityIds`, optional
  fields, and invalid-op-type cases. Remove one-field/type permutations and
  inspect nested payload with a typed shape.
- **Equivalence / invariants / failure modes:** test-only. Preserve explicit
  classification of every enum member and every converted field; strengthen
  rejection and optional-field coverage without changing production.
- **Evidence and history:** baseline utility tests began in `11d0fef9ac`;
  `7df43358ab`/`bac801faf3` added the missing-provider regression,
  `4eaa7da06a` introduced provider modes, and `10a47888a6` added the ID sibling.
  Later additions accumulated instead of consolidating the exhaustive seam.
- **Existing work:** generic C6 overlap only; no matching candidate found.
- **Required verification:** assertion inventory over every `SyncProviderId`,
  provider mode, `Operation` field, optional causal field, and all `OpType`
  acceptance/rejection semantics; focused spec and `checkFile`.
- **Estimated delta / benefit:** tests about −140 to −190 LOC while adding
  three missing boundary cases and removing `any`.
- **Blast radius / reversibility / risk / confidence:** one pure utility spec;
  trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue.

### B14-C03 — Give the sync orchestrator spec typed canonical fixtures

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `operation-log-sync-spec::typed-operation-download-provider-fixtures`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B14; `d93fb835aeb31c3e942f08fb6ce939ee9bbedbb541aa3cf12198c11bf62c6ff3`.
- **Domains / category:** B14 primary; B15, B16, B20, B36, and C6 related;
  test-fixture duplication and exact duplicate assertions.
- **Exact evidence:** the 7,087-line orchestrator spec contains 63 inline
  `downloadRemoteOps().resolveTo({...})` results, 128 `mockProvider` literals,
  and 121 `as any` casts. A typed `makeRemoteOp` exists only inside the
  force-download block at `:4359`; earlier sections repeat full operation
  objects. `:5070-5109` and `:5252-5290` assert the same forced-processing call.
  Cursor tests at `:4788-4835,5111-5144` separately assert final value and the
  stronger replacement-before-acknowledgement order.
- **Current responsibility / consumers / formats:** this suite pins upload
  piggybacking, cursor crash safety, snapshots/suffixes, full-state conflict
  gates, recovery markers/backups, deferred capture, repair context, provider
  modes, and user conflict choices. It is the primary orchestration safety net.
- **Unnecessary mechanism / smallest change:** add file-local typed factories
  for `Operation`, `DownloadResult`, and an operation-capable provider; replace
  repeated defaults with explicit overrides. Move `makeRemoteOp` to shared
  spec scope. Delete the exact forced-processing duplicate and combine final
  cursor value/count with the existing order test. Do not table-drive unrelated
  race or failure scenarios.
- **Equivalence / invariants / failure modes:** test-only. Every non-default
  field must remain explicit at its scenario. Preserve all unique crash-window,
  failure, cancellation, migration, identity, clock, suffix, archive, recovery,
  full-state, and deferred-action assertions; factories must not hide ordering.
- **Evidence and history:** the force-download cluster entered in
  `1f8fe61c84`; `44e0762fba` later added an exact delegation duplicate for a
  moved validation-latch rationale. July 2026 fixes repeatedly edited inline
  result/provider shapes across the file, demonstrating the fixture drift cost.
- **Existing work:** this is a bounded spec-only seam, not the generic service
  decomposition already tracked by A6-PW-003. Coordinate assertion inventories
  with B15/B16 and C6.
- **Required verification:** machine-readable before/after inventory of every
  `it` title and expectation; focused orchestrator spec; mutation-check factory
  defaults for provider mode, cursor, snapshot, success, and failed-file count;
  relevant upload/download/rebuild integrations; `checkFile`.
- **Estimated delta / benefit:** tests about −500 to −900 LOC, removal of most
  unsafe fixture casts, and one canonical shape owner; production 0.
- **Blast radius / reversibility / risk / confidence:** one high-value but
  sync-critical spec; easy revert; high verification burden; supported-high
  confidence.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue in small fixture-first slices.

### B11-C01 — Remove dead legacy scaffolding from relationship validation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `cross-model-validation::dead-legacy-scaffolding`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B11; `5ed98eecf14085e6ba7ebdab85bfe8c427ca87c7ce9a63fe279edada7109a7b0`.
- **Domains / category:** B11 primary; B08, B09, and B12 related; dead code and
  obsolete compatibility scaffolding.
- **Exact evidence:** `is-related-model-data-valid.ts:13-20,91-93,135,149-152,
  167-184,262-278,390-394,553-557` contains four inert mechanisms. `errorCount`
  resets per call, while all 32 `_validityError()` sites immediately exit, so
  its `>3` path is unreachable. `projectTaskMap` is populated but never read;
  `projectIds` is passed to `validateNotes()` but unused; and
  `validateReminders()` unconditionally returns true.
- **Current responsibility / consumers / formats:** this module short-circuits
  on the first invalid relationship, emits privacy-safe metadata plus
  `devError`, and exposes that first error synchronously to `validateFull()`.
  Consumers include backup import, legacy migration, hydration/recovery,
  snapshot validation, and post-sync repair; no format change is proposed.
- **Unnecessary mechanism / smallest change:** delete only the counter/throttle,
  unused map/set write, unused argument, and no-op reminder call/function.
  Preserve the boolean API, synchronous first-error side channel, all real
  checks, exact error text, logging, and `devError`.
- **Equivalence / invariants / failure modes:** every present failure still
  performs the same error work once and returns false; valid state still
  reaches true. Preserve repair/refusal routing, archive and virtual `TODAY`
  exceptions, menu-tree checks, provider references, and privacy-safe logs.
- **Evidence and history:** exact symbol closure proves the dead paths.
  `b03cfcdd9b6` added a multi-error throttle when an older reminder validator
  could report repeatedly; `6839c20c272` removed `reminderId` validation and
  left the no-op; the project map survives from the PFAPI-era validator.
- **Existing work:** no exact local roadmap, finding, retained item, or issue
  was located.
- **Required verification:** relationship, validation-fn/state, migration,
  backup, and hibernate characterization suites; mutation-check every real
  relationship failure for false plus identical first error; `checkFile`.
- **Estimated delta / benefit:** production about −20 to −25 LOC. Removes
  misleading compatibility state from a sync-critical validator.
- **Blast radius / reversibility / risk / confidence:** one production file;
  easy revert; medium gate-path risk despite mechanically dead code;
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh validation reviewers
  required; proposed; pursue as an isolated cleanup.

### B11-C02 — Centralize repeated detailed validity assertions

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `state-validity-tests::repeated-validity-assertion-boilerplate`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B11; `123a496e503f2fb4621d6c54322a92cab7349171e0a894685b898be6d3f68566`.
- **Domains / category:** B11 primary; B36 and C6 related; test-only
  duplication.
- **Exact evidence:** `state-validity-after-actions.spec.ts:165-865` contains
  26 `validationResult` blocks and three `result` blocks repeating the same
  expectation, invalid-result branch, and scenario-specific `fail()` call.
- **Current responsibility / consumers / formats:** 29 distinct reducer and
  meta-reducer scenarios assert Typia and relationship validity while surfacing
  detailed scenario failures.
- **Unnecessary mechanism / smallest change:** add one file-local
  `expectValid(result, message)` helper near `:134-163` and replace only the 29
  repeated assertion blocks. Do not table-drive or remove scenarios.
- **Equivalence / invariants / failure modes:** preserve every fixture, action,
  validation call, expected boolean, and detailed message. Both the Jasmine
  expectation and conditional `fail()` behavior must remain.
- **Evidence and history:** exact counts are 26 + 3 branches and 29 `fail()`
  calls. The suite began in `c93714bd0e1`; `196e50b906` strengthened note
  assertions without creating a shared assertion seam.
- **Existing work:** generic C6 overlap only; distinct from B08-C05 and B09
  snapshot/compaction test candidates.
- **Required verification:** focused spec and `checkFile`; deliberately force
  one invalid result to confirm its scenario-specific detail still appears.
- **Estimated delta / benefit:** production 0; tests about −80 to −85 LOC with
  no scenario loss.
- **Blast radius / reversibility / risk / confidence:** one spec file; trivial
  revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer required;
  proposed; pursue.

### B17-C01 — Remove inert dropped-entity bookkeeping from remote migration

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `remote-op-migration::dead-dropped-entity-tracking`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B17; `52d3680d6801c6423e8a85b9eacc88b1707c599c17be18ca37cbeacbdad5daff`.
- **Domains / category:** B17 primary; B03 and B36 related; dead production
  state and a misleading duplicate test.
- **Exact evidence:** `remote-ops-processing.service.ts:149,184-190` allocates
  and fills `droppedEntityIds`, but the set is never read or returned.
  `remote-ops-processing.service.spec.ts:519-555` says the tracking supports
  possible future dependency warnings, yet it can only reassert the same
  terminal-null migration behavior already covered at `:430-458`.
- **Current responsibility / consumers / formats:** migration returning `null`
  intentionally drops that operation without blocking the batch. The useful
  behavior is the remaining verbose op-ID diagnostic and the filtered batch;
  no consumer, result field, persisted shape, or wire format observes the set.
- **Unnecessary mechanism / smallest change:** delete the set, its entity-ID
  writes, and the future-looking duplicate test. Keep the earlier null-migration
  characterization and every blocking case for malformed, unsupported, newer,
  or throwing migrations.
- **Equivalence / invariants / failure modes:** the same migrated prefix reaches
  conflict detection and application, a `null` result remains a terminal drop,
  and cursor blocking remains restricted to incompatible or failed migrations.
  Do not change split-operation ordering or the blocked-op result.
- **Evidence and history:** exact symbol closure finds writes only.
  `c27a07df4c` introduced the set during service extraction; the later
  affected-entity work in `0893a86162` was reverted by `9540593d60`, leaving
  this bookkeeping inert.
- **Existing work:** no exact candidate or issue was found; generic B36/C6 test
  consolidation is related only.
- **Required verification:** focused remote-processing spec; mutation-check
  null, split, throwing, too-old, too-new, and malformed-version paths; verify
  filtered order and `blockedByIncompatibleOp`; `checkFile` on both files.
- **Estimated delta / benefit:** production about −8 LOC and tests about −35
  LOC; removes a false promise of dependency analysis.
- **Blast radius / reversibility / risk / confidence:** one sync-critical
  service and its spec; trivial revert; low implementation risk; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** two fresh migration/sync
  reviewers required; proposed; pursue as a mechanical deletion.

### B17-C02 — Remove the resolver's ignored per-item rejection clock

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `superseded-resolver::redundant-per-item-existing-clock`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B17; `c1777bbd3795797d540b32f69d395a6134135516ee708d34365388f3d06a2d1e`.
- **Domains / category:** B17 primary; B18 and B20 related; redundant internal
  contract and tests that do not exercise it.
- **Exact evidence:** `superseded-operation-resolver.service.ts:89-93,142-180`
  repeats `existingClock` in its input and internal item types, but never reads
  it. The only runtime caller, `rejected-ops-handler.service.ts:445-545`, first
  extracts those clocks and passes them through `extraClocks` in all three
  resolution branches. Resolver specs at `:1478-1570` claim to exercise the
  per-item value, but also place `serverEntityClient` in `globalClock`, so they
  pass even though the item property is ignored.
- **Current responsibility / consumers / formats:** the server rejection's
  `existingClock` remains required. `RejectedOpsHandlerService` carries it
  until the op is confirmed pending and combines it with force-download clocks
  or the snapshot clock; resolver inputs then merge that explicit clock list,
  the global clock, and each operation clock.
- **Unnecessary mechanism / smallest change:** remove `existingClock` only from
  the resolver's public item shape and its repeated local aliases; delete the
  two false resolver tests. Keep the rejection-response type, handler
  extraction, `extraClocks`, and handler boundary tests at
  `rejected-ops-handler.service.spec.ts:836-919` unchanged.
- **Equivalence / invariants / failure modes:** replacement clocks still
  dominate the server entity clock and remain unpruned client-side. Preserve
  force-from-zero fallback, snapshot merging, fail-closed no-clock behavior,
  current-client increment, and atomic replacement-before-rejection ordering.
- **Evidence and history:** `405812e7b3` added the per-item property when the
  resolver used it for client-side pruning. `fdc942babb` removed that pruning
  and its read to prevent an infinite conflict loop, but left the property and
  tests behind. Exact reference closure confirms no hidden read.
- **Existing work:** no exact candidate was found. This narrows only an
  internal app service contract; it does not alter server compatibility or the
  B20 vector-clock format.
- **Required verification:** focused resolver and rejected-handler specs;
  type-check every resolver caller; mutation-check rejection-only,
  force-download-plus-rejection, snapshot-plus-rejection, and no-clock paths;
  `checkFile` on all touched files.
- **Estimated delta / benefit:** production/types about −4 to −8 LOC and tests
  about −90 LOC; one canonical route for server rejection clocks.
- **Blast radius / reversibility / risk / confidence:** internal clock
  contract, readily reversible; medium verification risk because lost clocks
  cause repeated conflicts; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh sync/vector-clock
  reviewers required; proposed; pursue only with the handler boundary tests
  retained.

### B17-C03 — Express rejected-op retry budgeting as a compact state matrix

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `rejected-ops-handler-spec::retry-budget-state-matrix`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B17; `94829bfef4a8169ab492416cba82434fb40c6bae93d6edc0ff0e232c62975fd0`.
- **Domains / category:** B17 primary; B14, B36, and C6 related; duplicated
  sync-critical test setup.
- **Exact evidence:** the 1,407-line
  `rejected-ops-handler.service.spec.ts:610-771,943-1404` repeats operation
  loops, untyped `mockEntry()` values, download callbacks, and resolver setup to
  reach adjacent retry-counter states. The reset cases at `:1281-1348` and
  `:1350-1404` overlap, while distinct same-batch, cross-call, mixed-entity,
  cancellation, and transient-failure assertions are spread through the same
  fixture boilerplate.
- **Current responsibility / consumers / formats:** the suite protects a
  per-entity retry budget that prevents infinite conflict resolution without
  discarding edits after cancellations or transient downloads. It also proves
  a whole clean sync resets accumulated entity counters.
- **Unnecessary mechanism / smallest change:** add one typed
  `OperationLogEntry` factory and one typed completed-download callback, then
  table-drive only retry-state transitions. Preserve separate named regressions
  for nested/forced cancellation rollback and thrown-download rollback.
- **Equivalence / invariants / failure modes:** retain the exact max versus
  max-plus-one boundary, one increment per entity per batch, independent mixed
  entities, accumulation across calls, terminal-at-limit behavior even when a
  sibling cancels, and all-counter reset only for an empty rejection set. Never
  weaken `#8331`'s no-terminal-rejection assertions.
- **Evidence and history:** the state machine accumulated across
  `fdc942babb`, `c112b65d64`, `13dc7a988a`, `217796b742`, and
  `55d3490e19`; later changes copied full setup to pin each newly discovered
  boundary instead of sharing a scenario harness.
- **Existing work:** generic C6 consolidation and B14-C03 fixture cleanup
  overlap; this candidate is limited to the rejected-handler retry state
  machine.
- **Required verification:** mechanical before/after inventory of every retry,
  cancel, exception, and terminal assertion; focused spec; mutation-check each
  counter boundary and rollback edge; `checkFile`.
- **Estimated delta / benefit:** tests about −300 to −450 LOC and removal of
  the file's `mockEntry(): any`, with no production change.
- **Blast radius / reversibility / risk / confidence:** test-only and easy to
  revert, but high verification burden because the cases protect data-loss
  failures; supported-high confidence.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers
  required; proposed; pursue with an assertion inventory.

### B17-C04 — Stop copying conflict resolution into the remote-processor spec

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `remote-processor-spec::collaborator-conflict-algorithm-copy`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B17; `8191b978f3574c9439c725ba429837a19a515d7adf2f719d01e8920e76da2db8`.
- **Domains / category:** B17 primary; B18, B36, and C6 related; copied
  production logic and false-confidence tests.
- **Exact evidence:** `remote-ops-processing.service.spec.ts:144-226`
  reimplements vector-clock comparison and conflict construction for the
  `ConflictResolutionService` spy. Its own comment admits it omits the current
  entity-existence branch. Tests at `:1470-1549,1587-1613` then assert those
  collaborator semantics through the copy. Production
  `remote-ops-processing.service.ts:749-791` only builds context, delegates per
  operation, accumulates every reported conflict, filters superseded results,
  and yields in batches.
- **Current responsibility / consumers / formats:** this spec should prove the
  remote processor's orchestration contract. Canonical vector-clock and entity
  conflict semantics belong to `conflict-resolution.service.spec.ts`, while
  the `#8956` multi-entity case at remote-spec `:1551-1585` uniquely proves all
  collaborator conflicts are retained.
- **Unnecessary mechanism / smallest change:** make the default spy return no
  conflicts and not-superseded; configure explicit results per orchestration
  test. Delete only cases that test the copied algorithm, retaining context
  forwarding, superseded filtering, non-conflicting routing, multi-conflict
  accumulation, batching/yield, and failure behavior.
- **Equivalence / invariants / failure modes:** production is unchanged. The
  canonical conflict suite must still cover empty frontiers, snapshots,
  duplicate/greater/concurrent clocks, pending ops, archived/deleted entities,
  and multi-entity operations; the remote suite must still prove it does not
  drop a second conflict for one op.
- **Evidence and history:** `c27a07df4c` introduced the copied fake during
  service extraction. `6a2b7e3b9b` later documented its semantic omission, and
  `51bf689bd56` had to extend its result shape for multi-conflict support,
  demonstrating drift across two owners.
- **Existing work:** coordinate with B18's canonical conflict coverage and the
  generic C6 test pass; no exact candidate was found.
- **Required verification:** map every deleted expectation to the canonical
  conflict suite; focused remote-processor and conflict-resolution specs;
  mutation-check per-op delegation, superseded filtering, multi-conflict
  accumulation, and the 100-op yield boundary; `checkFile`.
- **Estimated delta / benefit:** tests about −150 to −220 LOC; removes an
  incomplete second implementation of the conflict algorithm.
- **Blast radius / reversibility / risk / confidence:** test-only and readily
  reversible; medium verification risk from cross-suite ownership; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** two fresh conflict/sync
  reviewers required; proposed; pursue after the assertion map is complete.

### B17-C05 — Make resolver tests observe the real atomic batch port

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `superseded-resolver-spec::actual-batch-port-and-object-matrix`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B17; `cdf4ab2b5b87b443d61f09df4e71dd578db4b99f21920b696067708099460c6c`.
- **Domains / category:** B17 primary; B14, B18, B36, and C6 related;
  test-double indirection and one-field assertion duplication.
- **Exact evidence:** the 1,574-line resolver spec tests a 351-line service.
  Its setup at `superseded-operation-resolver.service.spec.ts:50-87` makes the
  real `appendMixedSourceBatchSkipDuplicates` spy call the obsolete
  `appendWithVectorClockUpdate` spy, after which most assertions inspect the
  latter. Production only calls the batch port at
  `superseded-operation-resolver.service.ts:309-322`. One-field permutations
  for move-to-archive (`:829-1101`), delete replay (`:1124-1315`), and
  no-client-pruning (`:1331-1476`) repeatedly reconstruct the same operations.
- **Current responsibility / consumers / formats:** the suite protects atomic
  durable replacement before rejection, exact archive/delete payload replay,
  LWW grouping, vector-clock dominance without client pruning, project-move
  entity footprints, recreate flags/follow-ups, current-client identity, and
  conflict-summary notification.
- **Unnecessary mechanism / smallest change:** replace the nested fake with a
  typed helper that captures and returns rows from the actual batch argument;
  assert whole replacement objects with explicit generated-field matchers.
  Consolidate only one-field permutations into small tables or whole-object
  cases. Remove the false `existingClock` cases under B17-C02, not here.
- **Equivalence / invariants / failure modes:** preserve payload, entity and
  bulk IDs, action/op/entity types, client, timestamp, schema version, vector
  clock, source, ordering, and written-row behavior. Keep distinct tests for
  no-current-state archive handling, mixed/multiple groups, append failure,
  rejection failure, append-before-reject, task recreation follow-ups, and the
  authenticated project-delete footprint regression.
- **Evidence and history:** much of the suite descends from
  `61b8d82ad6`; `7e273a0e5c` introduced the atomic batch port and its
  compatibility fake, leaving assertions coupled to a method production no
  longer calls. The repeated field cases accumulated around correctness fixes
  instead of being reconciled against the new port.
- **Existing work:** coordinate typed fixtures with B14-C03 and generic C6;
  keep the candidate local to this resolver spec.
- **Required verification:** machine-readable inventory of test titles and
  assertions; focused resolver and operation-store specs; mutation-check batch
  source/order, append failure, mark-rejected failure, all preserved operation
  fields, and every clock entry; `checkFile`.
- **Estimated delta / benefit:** tests about −450 to −700 LOC; assertions bind
  to the real atomic API and repeated operation construction shrinks.
- **Blast radius / reversibility / risk / confidence:** test-only and easy to
  revert, but high review burden in a data-recovery path; supported-high
  confidence.
- **Verifiers / disposition / recommendation:** two fresh sync/store reviewers
  required; proposed; pursue in port-first then consolidation slices.

### B13-C01 — Delete orphaned PFAPI constants and legacy-only type aliases

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-shell-contracts::orphan-pfapi-constants-and-types`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B13; `df039e9b1843346331007c282396a26886943c8c44c51f6ed0fd4bf75bc4cbfc`.
- **Domains / category:** B13 primary; B10, B23, C1, and C3 related; dead
  declarations left after provider and legacy-sync migrations.
- **Exact evidence:** `sync.const.ts:38-42,53-96` has no consumers for
  `SYNC_REINIT_DELAY_MS`, `DEFAULT_APP_BASE_DATA`,
  `PREPEND_STR_ENCRYPTION`, `PREPEND_STR_COMPRESSION`, or the empty
  `GLOBAL_CONFIG_LOCAL_ONLY_FIELDS`. `sync.model.ts:37-44,54-69,85-95` has no
  consumers for `AppMainFileNoRevsData`, `AppMainFileData`,
  `LocalSyncMetaForProvider`, `LocalSyncMetaModel`,
  `DialogPermissionResolutionResult`, `SyncGetRevResult`, or
  `SyncResultLegacy`.
- **Current responsibility / consumers / formats:** the symbols once described
  PFAPI-era envelopes, delays, and dialog results. Exact repository-wide symbol
  closure finds no import, dynamic registry, serialized-name lookup, or public
  package export. Live legacy compatibility still uses `AppDataCompleteLegacy`,
  base/archive shapes, `AppBaseDataEntityLikeStates`, and
  `DialogConflictResolutionResult`.
- **Unnecessary mechanism / smallest change:** delete only the unreferenced
  constants, aliases, and now-unused imports. Do not consolidate or rename live
  backup/provider contracts.
- **Equivalence / invariants / failure modes:** there is no runtime or emitted
  wire-format change. Preserve every live legacy backup shape, encryption/file
  prefix owned by its current package, provider metadata, and conflict-dialog
  contract; a missed external consumer would turn this into an API removal.
- **Evidence and history:** `rg` closure is empty outside the declarations.
  Origins span `c06f0a2867`, `490018db81`, `a081ee3fb0`, `1059eeea04`, and
  `3ef23354e4`; later migrations removed their producers/consumers without
  deleting the declarations.
- **Existing work:** coordinate with A5 compatibility retirement and the
  PFAPI-removal trail; no exact live candidate was found.
- **Required verification:** repeat static/export/serialized-name closure;
  focused TypeScript build plus sync shell and backup compatibility specs;
  `checkFile` for both files.
- **Estimated delta / benefit:** production about −90 to −105 LOC; removes
  misleading legacy surface without touching compatibility behavior.
- **Blast radius / reversibility / risk / confidence:** two contract files;
  trivial revert; low risk if export closure remains empty; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** one fresh contract reviewer;
  proposed; pursue as a declaration-only deletion.

### B13-C02 — Remove the unused synchronous sync-wait facade

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-wrapper::dead-wait-facade-and-status-getter`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B13; `eab9dbdd8c7eea13b8f8cc93e968de69775c6533b421021244afa3878b392a3b`.
- **Domains / category:** B13 primary; B14 and C1 related; dead pass-through
  wrapper and stale tests.
- **Exact evidence:** `sync-wrapper.service.ts:237-238` exposes a wait facade
  with no runtime caller, while the direct observable timeout path at
  `:240-264` is live. `sync-trigger.service.ts:42-47` exposes the corresponding
  getter only to that facade. Stale trigger-spec setup/assertions occur at
  `sync-trigger.service.spec.ts:36-39,140-143,163-203,247-252,372-380`.
- **Current responsibility / consumers / formats:** live wait state comes from
  `startWaitingForNextSync()` sources and is consumed through the wrapper's
  observable/timeout behavior. The synchronous facade adds no policy, state,
  persistence, or wire format.
- **Unnecessary mechanism / smallest change:** delete the unused wrapper method,
  trigger getter, and tests that exist solely for them. Keep the direct waiting
  observable, timeout/cancellation semantics, and all wait-state producers.
- **Equivalence / invariants / failure modes:** sync start, stop, timeout, retry,
  provider switching, and UI status remain unchanged. Verify no template,
  injection, reflective, or test-only consumer relies on the public methods.
- **Evidence and history:** exact symbol closure reaches only the facade and its
  tests. `f24e73302b`, `fe75a05127`, and `3d1430b56a` show the older polling
  seam surviving after the observable path became authoritative.
- **Existing work:** overlaps generic wrapper decomposition A6-PW-003 only;
  this is a bounded dead-surface deletion.
- **Required verification:** repeat call/export/template closure; focused
  wrapper and trigger specs; mutation-check timeout, cancellation, provider
  switch, and each `startWaitingForNextSync()` source; `checkFile` on all touched
  TypeScript files.
- **Estimated delta / benefit:** production about −8 LOC and tests about −20
  to −30 LOC; removes a second way to observe one wait state.
- **Blast radius / reversibility / risk / confidence:** two services and their
  specs; easy revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh sync-shell reviewer;
  proposed; pursue.

### B13-C03 — Remove the wrapper's obsolete ReminderService dependency

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-wrapper-di::unused-reminder-service`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B13; `6727927f31adaf4522b70b90b0b274d0bf5a7e05ce4a7535101ad425652b3999`.
- **Domains / category:** B13 primary; B35 and C1 related; unused DI edge and
  test fixture.
- **Exact evidence:** `sync-wrapper.service.ts:60,119` imports and injects
  `ReminderService` but never reads the field. Its spec repeats the unused spy
  at `:16,65,183,230,2448,2576`. The real initialization owner is
  `features/reminder/reminder.module.ts:53,68`.
- **Current responsibility / consumers / formats:** `ReminderModule` owns
  reminder initialization and active-reminder behavior. The wrapper dependency
  has no call, side effect, status role, persistent representation, or provider
  contract.
- **Unnecessary mechanism / smallest change:** remove only the import,
  injection, and corresponding test providers/spies. Keep reminder-module
  ownership unchanged.
- **Equivalence / invariants / failure modes:** Angular construction and sync
  behavior are identical because `inject()` merely obtains an already-provided
  service here. Confirm there is no constructor-time effect or provider-lifetime
  dependency hidden behind injection.
- **Evidence and history:** field-reference closure finds only the declaration.
  `b2f5ee820d` and `3ef23354e4` trace the stale dependency across reminder and
  sync reorganizations.
- **Existing work:** no exact issue or plan candidate found; C1 may deduplicate
  the dead injection.
- **Required verification:** repeat field/DI closure; focused wrapper and
  reminder-module specs; instantiate the wrapper with the dependency absent;
  `checkFile` on service/spec.
- **Estimated delta / benefit:** production −2 LOC and tests about −8 to −12
  LOC; removes a false ownership edge.
- **Blast radius / reversibility / risk / confidence:** one service/spec and DI
  setup; trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh Angular/DI reviewer;
  proposed; pursue.

### B13-C04 — Express the resettable sync delay with one timer stream

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-trigger::resettable-delay-subject-audittime`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B13; `ac205f602375f4fc7b562c69b64c86f99b60879d9a42e7467b1d4ddfda34d0c0`.
- **Domains / category:** B13 primary; C1 and C2 related; redundant RxJS
  mechanism.
- **Exact evidence:** `sync-trigger.service.ts:81-84,288-303` creates a private
  subject, pushes once per source subscription, and uses `auditTime(delay)` to
  emit `null`. `sync-trigger.service.spec.ts:294-333` checks delayed emission
  but does not pin unsubscribe/reset timing precisely.
- **Current responsibility / consumers / formats:** the stream supplies a
  cancellable one-shot delay used in trigger scheduling. It must emit exactly
  `null`, restart for each subscription, and not alter the separate 100 ms
  debounce, maximum interval, or hydration-window immediate path.
- **Unnecessary mechanism / smallest change:** replace only that subject plus
  `auditTime` construction with `timer(delay).pipe(mapTo(null))` (or the
  repository's equivalent typed mapping). Add characterization before changing
  it; do not unify other trigger clocks.
- **Equivalence / invariants / failure modes:** preserve cold-per-subscription
  timing, cancellation on unsubscribe, reset behavior, scheduler semantics, and
  the exact `null` value. A shared/hot timer or changed leading/trailing behavior
  is not equivalent.
- **Evidence and history:** symbol/data-flow closure finds one write and one
  operator chain. `db990b7018` introduced the current subject form; no later
  consumer acquired multi-event semantics.
- **Existing work:** generic trigger simplification only; no exact tracked item.
- **Required verification:** first add fake-time tests for emission at the exact
  boundary, early unsubscribe, and two independent subscriptions; run trigger
  spec and `checkFile`.
- **Estimated delta / benefit:** production about −8 to −14 LOC; removes one
  subject and imperative kick while preserving behavior.
- **Blast radius / reversibility / risk / confidence:** one private stream;
  trivial revert; medium timing risk; supported confidence.
- **Verifiers / disposition / recommendation:** one fresh RxJS reviewer;
  proposed; pursue test-first.

### B13-C05 — Table-drive the wrapper's provider-status signal matrix

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-wrapper-spec::provider-status-testbed-copies`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B13; `2b6537b01216c2d8c2b33c2f82cfd08eea208719af30659b00cc7672d64f6962`.
- **Domains / category:** B13 primary; B23, B36, and C6 related; test fixture
  duplication.
- **Exact evidence:** `sync-wrapper.service.ts:195-202` derives status signals
  from provider kind and confirmed/pending state. The spec rebuilds nearly the
  same 13-provider TestBed and assertions across
  `sync-wrapper.service.spec.ts:2405-2602` for SuperSync, WebDAV, Dropbox, and
  LocalFile.
- **Current responsibility / consumers / formats:** the tests protect the
  provider-by-boolean matrix and the distinction between pending and confirmed
  sync status. Production signals are UI state only; no persisted/wire shape is
  changed.
- **Unnecessary mechanism / smallest change:** introduce one typed local case
  table and one setup/assert helper for this matrix. Keep provider-specific
  values explicit and do not share the wrapper's cold runtime stream.
- **Equivalence / invariants / failure modes:** preserve all provider rows,
  boolean expectations, pending-versus-confirmed transitions, initial state,
  and signal recomputation. Do not collapse distinct provider capabilities into
  one assumed family.
- **Evidence and history:** the repeated TestBeds descend from `77d09796d8` and
  `40def4a576f`; later cases copied setup rather than extending a case table.
- **Existing work:** coordinate with B23 provider-host coverage and generic C6;
  candidate is local to wrapper status tests.
- **Required verification:** before/after inventory of the full provider × state
  matrix; focused wrapper spec; mutation-check each row and pending/confirmed
  polarity; `checkFile`.
- **Estimated delta / benefit:** tests about −140 to −180 LOC; no production
  change and no scenario loss.
- **Blast radius / reversibility / risk / confidence:** test-only; easy revert;
  low behavioral risk but medium assertion-inventory burden; supported-high
  confidence.
- **Verifiers / disposition / recommendation:** one fresh provider-test
  reviewer; proposed; pursue.

### B15-C01 — Remove the download result's always-zero failed-file count

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-download-result::dead-failed-file-count`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B15; `918d7338d06cd8acfe6ca81867486054ad644d1a399a35a10c23edee32cb6c02`.
- **Domains / category:** B15 primary; B14, C1, and C2 related; inert result
  field plus tests coupled to it.
- **Exact evidence:** `core/types/sync-results.types.ts:21-29` declares
  `failedFileCount`; `operation-log-download.service.ts:89-93,476-503` only
  returns zero; `operation-log-sync.service.ts:565-572,1703-1707` forwards or
  inspects it without any producer of a nonzero value. The download spec's
  assertions are at `:78-81,894-899`; the orchestrator spec contains 96 textual
  occurrences, with the only nonzero value being a synthetic fixture at
  `:4860-4866`.
- **Current responsibility / consumers / formats:** download success/failure is
  actually represented by thrown structural errors, blocked/incomplete states,
  applied operation counts, and cursor/ack gates. The count is an internal
  TypeScript result field, not a server response or persisted value.
- **Unnecessary mechanism / smallest change:** remove the field and assertions
  that merely copy/default it. Rewrite the one synthetic nonzero orchestrator
  case to exercise the real failure signal it intends to protect; do not weaken
  any `#6571` failure gate.
- **Equivalence / invariants / failure modes:** successful downloads still
  report their applied counts and failures still abort before cursor advance or
  acknowledgement. Preserve thrown errors, partial/incomplete status, and all
  reducer/application failure paths.
- **Evidence and history:** assignment closure proves production writes only
  zero. `a70273597f` introduced the result shape and `c12900329c` retained it
  through download extraction without adding a failure producer.
- **Existing work:** related to result-state consolidation C2; no exact prior
  candidate found.
- **Required verification:** repeat write/value closure; focused download and
  orchestrator specs; mutation-check structural failure, reducer/application
  failure, incomplete download, success, cursor, and acknowledgement gates;
  `checkFile` on touched files.
- **Estimated delta / benefit:** production about −8 to −12 LOC and tests
  about −98 LOC; removes a misleading impossible state.
- **Blast radius / reversibility / risk / confidence:** internal result contract
  across two services/specs; easy revert; medium sync-orchestration risk;
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh download/orchestration
  reviewers; proposed; pursue after mapping the synthetic test to a real error.

### B15-C02 — Inline the single-use download API pass-through

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-download::single-use-api-wrapper`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B15; `c304c773c961988bdb8a70c5c7fa8a7f580999b765310c7d03caed23741be989`.
- **Domains / category:** B15 primary; C1 related; no-value private wrapper.
- **Exact evidence:** `operation-log-download.service.ts:35-44,85-105` defines
  `_downloadRemoteOpsViaApi()` and calls it once; the method only forwards the
  same provider arguments and returns the same result.
- **Current responsibility / consumers / formats:** the provider port owns API
  request, response, pagination, error, and cursor semantics. This private
  method adds no validation, conversion, instrumentation, retry, or stable test
  seam.
- **Unnecessary mechanism / smallest change:** call the provider API directly
  at the one site and delete the method/comment. Do not move provider-specific
  behavior into the orchestrator.
- **Equivalence / invariants / failure modes:** preserve exact arguments,
  awaited rejection behavior, response identity, pagination order, and error
  propagation.
- **Evidence and history:** exact reference closure finds one caller.
  `c12900329c` introduced the wrapper during service extraction; it never gained
  independent behavior.
- **Existing work:** generic C1 facade pass only; no exact tracked item.
- **Required verification:** repeat reference closure; focused download spec;
  mutation-check argument forwarding and rejection propagation; `checkFile`.
- **Estimated delta / benefit:** production about −7 to −10 LOC; removes one
  navigation hop.
- **Blast radius / reversibility / risk / confidence:** one private method;
  trivial revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh reviewer; proposed;
  pursue as a mechanical inline.

### B15-C03 — Reuse the canonical full-state migration planner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `initial-download::duplicate-full-state-migration-plan`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B15; `87e1a7e5becf56ffc02c42fa4404a6574fd5c0770ab1a03dc1f84f96f45dd291`.
- **Domains / category:** B15 primary; B21, B29, and C4 related; duplicate
  package policy.
- **Exact evidence:** `operation-log-download.service.ts:393-448` reconstructs
  the same initial/full-state migration decision encoded by
  `packages/sync-core/src/download-planning.ts:23-99` and covered by
  `packages/sync-core/tests/download-planning.spec.ts:23-89`.
- **Current responsibility / consumers / formats:** the planner decides whether
  an initial download can apply, needs server migration confirmation, or must
  stop. The app remains responsible for UI confirmation, provider calls, and
  local persistence.
- **Unnecessary mechanism / smallest change:** invoke the existing pure planner
  for the decision and keep app-specific side effects around its typed result.
  Do not add a new abstraction or widen the package API.
- **Equivalence / invariants / failure modes:** preserve initial-versus-existing
  state, schema compatibility, cancel/decline, destructive migration gates,
  download order, and error mapping. Every old branch must map one-to-one to a
  planner outcome before deletion.
- **Evidence and history:** branch comparison shows matching inputs/outcomes.
  `610fbc1c75` extracted the canonical planner but left this small app copy.
- **Existing work:** coordinate with B21 server-migration audit and B29 public
  API; dedupe rather than introducing another helper.
- **Required verification:** branch/outcome truth table before and after;
  package planner spec, focused download/server-migration specs, initial-client
  integration scenarios, and `checkFile`.
- **Estimated delta / benefit:** production about −7 LOC; more importantly,
  one owner for migration policy.
- **Blast radius / reversibility / risk / confidence:** client/package boundary
  in a destructive migration gate; easy code revert but sync-critical behavior;
  supported-high confidence.
- **Verifiers / disposition / recommendation:** two fresh client/package
  reviewers; proposed; pursue only with the explicit branch map.

### B15-C04 — Delete the weaker duplicate gap-key refresh test

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-download-spec::duplicate-gap-key-refresh-case`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B15; `f672d40f8a0a056bb1d24de50f996df8875644cb2fba703f56447b3e4217d673`.
- **Domains / category:** B15 primary; B22, B36, and C6 related; exact test
  duplication.
- **Exact evidence:** `operation-log-download.service.spec.ts:1522-1604`
  thoroughly proves refresh/retry for an encryption-key gap. The case at
  `:1606-1660` repeats the same branch with fewer assertions. The distinct
  disabled-to-enabled transition at `:1710-1772` covers another state and must
  remain.
- **Current responsibility / consumers / formats:** the stronger case protects
  key refresh, retry, order, and success after a gap; encryption remains
  fail-closed.
- **Unnecessary mechanism / smallest change:** delete only the weaker duplicate
  case. Keep the stronger case and every distinct missing/wrong/disabled key,
  retry failure, and transition scenario.
- **Equivalence / invariants / failure modes:** no production change and no
  assertion unique to the weaker case may disappear. The test inventory must
  show identical stimulus and a strict assertion subset.
- **Evidence and history:** side-by-side fixture/assertion comparison establishes
  the subset. The stronger test arrived in `035fe0a95f`; the weaker lineage is
  `68a268c18d`.
- **Existing work:** coordinate with B22 encryption coverage and C6; no distinct
  product candidate.
- **Required verification:** assertion-set diff; run the focused download spec;
  mutation-check refresh call, retry, key application, and fail-closed errors;
  `checkFile`.
- **Estimated delta / benefit:** tests about −55 LOC; removes redundant runtime
  with no coverage loss.
- **Blast radius / reversibility / risk / confidence:** test-only; trivial
  revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh encryption-test
  reviewer; proposed; pursue.

### B15-C05 — Build server-operation fixtures through one typed factory

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-download-spec::repeated-server-operation-literals`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B15; `c6bba020fb15f9048a08cf71bf26f517356aba2f2bf2a671560034e7c5cc295c`.
- **Domains / category:** B15 primary; B14, B36, and C6 related; test-fixture
  duplication.
- **Exact evidence:** `operation-log-download.service.spec.ts:119-1758`
  repeats server-operation literals with 38 `serverSeq`, 37 task-shaped
  payloads, and 38 `schemaVersion` assignments around the same required base
  fields.
- **Current responsibility / consumers / formats:** the suite covers pagination,
  gaps, migration, encryption, ordering, download failures, and cursor behavior.
  Several tests intentionally vary sensitive server fields and must keep those
  fields visible.
- **Unnecessary mechanism / smallest change:** add one file-local typed factory
  with valid defaults and explicit overrides. Convert only routine fixtures;
  keep sequence, schema, encryption, op type, payload, and gap-sensitive fields
  explicit where they are the subject of a test.
- **Equivalence / invariants / failure modes:** preserve every test title,
  operation ordering, IDs, clocks, sequences, schemas, payloads, encryption
  flags, and assertions. Defaults must not hide the value under test or make
  invalid fixtures accidentally valid.
- **Evidence and history:** mechanical literal counts show the repetition;
  cases accumulated with download regressions rather than through one fixture
  boundary.
- **Existing work:** coordinate with B14-C03 and generic C6; keep the helper
  local to this spec unless another suite proves an identical contract.
- **Required verification:** before/after fixture-value inventory; focused spec;
  mutation-check sequence gaps, schema versions, encryption flags, payload
  shapes, and operation types; `checkFile`.
- **Estimated delta / benefit:** tests about −250 to −400 LOC; fewer malformed
  copy/paste fixtures with no scenario deletion.
- **Blast radius / reversibility / risk / confidence:** one test file; easy
  revert; low runtime risk but high review burden; supported confidence.
- **Verifiers / disposition / recommendation:** one fresh download-test
  reviewer; proposed; pursue in small mechanical batches.

### B16-C01 — Make the immediate-upload debounce failure test deterministic

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `immediate-upload-spec::wall-clock-debounce-failure`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B16; `6df55bc133102b81dddc43f69604cd8cac330b8779f0c2c9123755409c68a6dd`.
- **Domains / category:** B16 primary; B36 and C6 related; stale/vacuous timing
  test.
- **Exact evidence:** `immediate-upload.service.ts:22` defines a 2,000 ms
  debounce. `immediate-upload.service.spec.ts:325-338` waits only 150 ms before
  asserting failure behavior, so the upload branch cannot have run under the
  production delay.
- **Current responsibility / consumers / formats:** the case intends to prove an
  immediate upload failure does not escape or corrupt queue/status state after
  the debounce. It has no persisted or wire-format effect itself.
- **Unnecessary mechanism / smallest change:** use Jasmine fake time and advance
  through the real debounce boundary, then assert the failure outcome and queue
  state. Do not shorten production timing or add arbitrary real waits.
- **Equivalence / invariants / failure modes:** production remains unchanged;
  the repaired test must fail if the upload call, catch path, or status cleanup
  is removed. Flush microtasks in the same order as the service.
- **Evidence and history:** timing comparison reproduces the unreachable branch.
  The relevant evolution spans `c379a8a2ab`, `b38f38098a`, and `77f83c56878`.
- **Existing work:** overlaps C6 fixed-wait/flakiness audit; this is the exact
  immediate-upload case.
- **Required verification:** focused fake-time spec; mutation-check upload not
  called before 2,000 ms, called at the boundary, rejected promise handled, and
  status/queue restored; `checkFile`.
- **Estimated delta / benefit:** roughly neutral test LOC; converts false
  confidence into deterministic coverage and removes 150 ms wall time.
- **Blast radius / reversibility / risk / confidence:** one test; trivial
  revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh timing-test reviewer;
  proposed; pursue.

### B16-C02 — Delete unused upload result type re-exports

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-upload-service::unused-result-reexports`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B16; `ee4049d19a6a387d8cf7da47c7cfcf9d0eb67e3602fa212df33d6f37a1c55db8`.
- **Domains / category:** B16 primary; B14 and C1 related; dead export aliases.
- **Exact evidence:** `operation-log-upload.service.ts:48-53` re-exports upload
  result types whose canonical declarations/exports are
  `core/types/sync-results.types.ts:7-15,112-188`. Repository-wide import and
  export closure finds no consumer through the service file.
- **Current responsibility / consumers / formats:** the canonical types remain
  public at the core result module. Removing the unused forwarding exports does
  not change runtime code, serialized responses, or provider contracts.
- **Unnecessary mechanism / smallest change:** delete only the six unused
  service-level type re-exports and any now-empty export clause; retain the
  canonical declarations unchanged.
- **Equivalence / invariants / failure modes:** TypeScript consumers must all
  import canonical paths already. Check aliases, barrels, tests, plugins, and
  generated references before deletion; external deep import would make this a
  public API decision.
- **Evidence and history:** exact path/symbol closure is empty. `ea04ee5f81`
  left the compatibility re-exports during type consolidation.
- **Existing work:** generic C1 dead exports; no exact issue found.
- **Required verification:** repeat repository/barrel/package-export closure;
  TypeScript build, focused upload specs, and `checkFile`.
- **Estimated delta / benefit:** production −6 LOC; one canonical type owner.
- **Blast radius / reversibility / risk / confidence:** type-only service
  surface; trivial revert; low risk for in-repo consumers, supported-high
  confidence pending external-surface confirmation.
- **Verifiers / disposition / recommendation:** one fresh API/export reviewer;
  proposed; pursue if external support policy permits deep-path cleanup.

### B16-C03 — Table-drive full-state upload retry classification

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `op-upload-spec::full-state-retry-case-copies`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B16; `d9472214d3b31328574d3aa852c3a370d4d7c419629a52bcdce8ebddb6fdf9e2`.
- **Domains / category:** B16 primary; B21, B30, B36, and C6 related; repeated
  classifier scenarios.
- **Exact evidence:** `operation-log-upload.service.spec.ts:1124-1214` repeats
  near-identical setup for full-state retryable/non-retryable failures. The
  canonical provider classifier matrix already exists at
  `packages/sync-providers/tests/retryable-upload-error.spec.ts:4-160`.
- **Current responsibility / consumers / formats:** the app suite must prove the
  upload service delegates classification into the correct retry/stop behavior;
  provider tests own exhaustive error taxonomy.
- **Unnecessary mechanism / smallest change:** use a small typed app-level case
  table for representative retryable and terminal classes. Keep exhaustive
  classification in the provider package and retain distinct app tests for
  retry count/order, eventual success, and terminal propagation.
- **Equivalence / invariants / failure modes:** preserve fail-closed full-state
  behavior, attempt limits, delay/order, original error propagation, and no
  acknowledgement on failure. Do not delete the only app integration test for a
  classifier family.
- **Evidence and history:** cases accumulated across `bf7db5515e`,
  `e03a4d41bd`, and `8005b4ec52`; the package now has the canonical matrix.
- **Existing work:** coordinate with B30 provider taxonomy and C6; do not copy
  the provider's exhaustive table into the app helper.
- **Required verification:** map each current case to package or app ownership;
  run both focused specs; mutation-check representative transient, permanent,
  retry exhaustion, and success-after-retry paths; `checkFile`.
- **Estimated delta / benefit:** tests about −55 to −75 LOC; clearer package
  versus orchestration ownership.
- **Blast radius / reversibility / risk / confidence:** test-only across two
  ownership layers; easy revert; medium verification burden; supported-high
  confidence.
- **Verifiers / disposition / recommendation:** one fresh app/provider reviewer;
  proposed; pursue after the coverage map.

### B16-C04 — Delete the write-flush test that never exercises queueing

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `write-flush-spec::vacuous-fifo-case`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B16; `926944df713c38399b849e0d2f870a020cc977d90d73375b2e8852e88268f346`.
- **Domains / category:** B16 primary; B05, B14, B36, and C6 related; vacuous
  duplicate test.
- **Exact evidence:** `operation-write-flush.service.spec.ts:184-214` labels a
  FIFO scenario, but its lock spy runs callbacks immediately, so no competing
  call is queued and the assertion cannot distinguish FIFO from arbitrary
  order. Real service cases at `:39-61,94-116,119-181` and operation-lock specs
  at `:164-188,435-456,737-757` cover flush behavior and actual lock queueing.
- **Current responsibility / consumers / formats:** the flush service waits for
  pending writes and delegates serialization to the lock owner. FIFO policy
  belongs to the lock, not the immediate callback fake.
- **Unnecessary mechanism / smallest change:** delete this false FIFO case.
  Keep all real pending-write, reentry, failure, timeout, and lock-order tests.
- **Equivalence / invariants / failure modes:** no production change. Before
  deletion, verify the lock suite exercises overlapping callbacks rather than
  sequential awaits and that the flush suite retains its integration with the
  lock.
- **Evidence and history:** control-flow inspection proves the test has no
  queued interval. `ef40c7ba6a` introduced the service case despite FIFO already
  belonging to the lock.
- **Existing work:** coordinate with B14-C01 and C6; avoid deleting distinct
  lock backend/reentry scenarios.
- **Required verification:** focused write-flush and operation-lock specs;
  mutation-check queued order in the real lock suite and pending-write flush in
  the service suite; `checkFile`.
- **Estimated delta / benefit:** tests −31 LOC; removes a misleading policy
  assertion.
- **Blast radius / reversibility / risk / confidence:** test-only; trivial
  revert; low risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh lock/flush reviewer;
  proposed; pursue.

### B16-C05 — Keep raw upload errors out of exportable logs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `upload-logging::raw-provider-error-content`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B16; `466640e8678c7b432f94cc5ffb95d847d734288ff16bd234a7e1e9db6c6b2075`.
- **Domains / category:** B16 primary; B30, C5, and C8 related; privacy-safe
  logging simplification/hardening.
- **Exact evidence:** `operation-log-upload.service.ts:318,333` logs
  `result.error`, `:444,789` logs `err.message`, and `:566` logs a raw rejection;
  `immediate-upload.service.ts:380-384` logs the caught object. `core/log.ts:1-3,
  54-71,123-158,238-280` shows app logs are retained/exportable. Provider
  contracts allow arbitrary error text at
  `packages/sync-providers/src/provider.types.ts:112-119,152-160`.
- **Current responsibility / consumers / formats:** raw error objects/messages
  remain available in control flow and user-facing error handling. Logs need
  only safe error category/code, operation count/IDs where permitted, provider
  kind, and boolean retry context—never provider response bodies or user
  content.
- **Unnecessary mechanism / smallest change:** replace raw object/message logging
  at these upload boundaries with structured, allowlisted primitives using the
  established `packages/sync-providers/src/log/error-meta.ts:34-48` pattern.
  Do not alter thrown errors or UI messages.
- **Equivalence / invariants / failure modes:** retry, classification, error
  propagation, UI feedback, and provider behavior are unchanged. Preserve
  enough safe metadata to diagnose class/status while preventing payload,
  credential, path, title, or server-body leakage.
- **Evidence and history:** `526afbaf`, `016e680c`, `8bf0568f`, and `ec2d2057`
  introduced raw logging; `faa9434a6a` and `dc66b235a6` establish the newer
  allowlisted metadata precedent.
- **Existing work:** related to C8 privacy audit and B30 error taxonomy; this is
  the bounded upload boundary.
- **Required verification:** add sentinel secrets/user-content to representative
  provider errors, export logs, and assert absence while safe category/status
  remains; focused upload/immediate-upload and error-meta specs; `checkFile`.
- **Estimated delta / benefit:** production neutral to +10 LOC and tests +25 to
  +50 LOC; reduces privacy risk and standardizes diagnostics rather than
  pursuing LOC reduction.
- **Blast radius / reversibility / risk / confidence:** upload diagnostics only;
  behavior-reversible but security/privacy-sensitive; medium implementation
  risk; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh privacy/provider
  reviewers; proposed; pursue as a hardening candidate.

### B19-C01 — Consolidate duplicate conflict-journal emission hooks

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `journal-outcome-emission::parallel-lww-and-merged-hooks`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B19; `347137abaa4e681acbd7ffedf6e869cb880a8bd59804372ea1eff1da8708b22b`.
- **Domains / category:** B19 primary; B18 and C1 related; duplicate private
  lifecycle.
- **Exact evidence:** `conflict-resolution.service.ts:1723-1729,2287-2314,
  2467-2495` uses `_journalResolution` for ordinary LWW outcomes and
  `_journalMergedResolution` for successful disjoint merges. Both build the same
  classification input, call the same journal service, and contain the same
  observe-only failure swallowing. Direct hook tests occur at
  `conflict-resolution.service.spec.ts:4802-4887,4900-4909`.
- **Current responsibility / consumers / formats:** the two private hooks write
  device-local v1 journal records after resolution. No wire, backup, plugin, or
  exported API observes the method split.
- **Unnecessary mechanism / smallest change:** retain one
  `_journalResolution(plan, winnerOverride?)`; ordinary calls use
  `plan.winner`, successful merges pass `'merged'`. Keep each call at its
  existing post-persist/post-reducer location and one generic never-throw catch.
- **Equivalence / invariants / failure modes:** preserve classifier inputs,
  record count/order, ordinary winner values, and `merged/disjoint-merge/info`
  output. Failed append/apply/merge paths must never be recorded as successful,
  and journal failures must never change conflict resolution.
- **Evidence and history:** `rg` finds two production call sites and private-test
  spies only. `git log -L` traces both hooks to `962c5bbeb1`, where they were
  introduced together.
- **Existing work:** broad conflict decomposition is tracked by issue `#8937`;
  no exact hook-deduplication candidate exists.
- **Required verification:** conflict-journal hook integration, disjoint-merge
  success/failure, ordinary LWW fallback, one-record/no-record mutation checks,
  and `checkFile` on modified TypeScript.
- **Estimated delta / benefit:** production about −20 to −25 LOC and tests
  about −4 to −8 LOC; one owner for journal timing/error containment.
- **Blast radius / reversibility / risk / confidence:** one sync-critical
  service/spec seam; easy revert; high policy risk if timing moves, medium
  validation cost; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh conflict/journal
  reviewers; proposed; pursue without moving call sites.

### B19-C02 — Remove the journal status that no lifecycle emits

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `journal-review-lifecycle::reserved-expired-never-emitted`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B19; `6325c39d8d11179863d4ca5089211064381e0e91ed3f22ceb389b9bb545f8fe7`.
- **Domains / category:** B19 primary; C2 and C3 related; dormant state-machine
  branch.
- **Exact evidence:** `conflict-journal.model.ts:46-59` reserves `expired` in
  `ConflictJournalStatus`; `sync-conflict-review.util.ts:149-158` maps it to an
  informational label. Exact repository search finds no constructor,
  transition, write, fixture, documentation contract, or translation that
  emits the value; retention physically deletes old records.
- **Current responsibility / consumers / formats:** live statuses are
  `unreviewed`, `kept`, `flipped`, and `info`. Records are device-local
  IndexedDB v1 values; status is not synced or exported as an app data format.
- **Unnecessary mechanism / smallest change:** remove `expired` from the union
  and `STATUS_KEYS`; retain age/count pruning and the mapper's runtime fallback
  for an unexpected persisted string.
- **Equivalence / invariants / failure modes:** no live path changes. Preserve
  all four emitted statuses, existing record reads, physical retention deletion,
  and store version/indexes. Confirm there is no historical released writer
  before treating the type closure as sufficient.
- **Evidence and history:** `rg "expired|status: 'expired'|markExpired"` closes
  on the model and mapper only. `aaad592c46`, `2d8343fb64`, and the squash
  `962c5bbeb1` show it began as speculative reserved state without a transition.
- **Existing work:** no exact issue or prior candidate found.
- **Required verification:** static and history/release closure; journal service
  and review-util specs; fixture-read test with an unknown status fallback;
  `checkFile` on both files.
- **Estimated delta / benefit:** production about −2 to −4 LOC and one
  impossible lifecycle concept.
- **Blast radius / reversibility / risk / confidence:** local persisted type;
  trivial code revert; medium compatibility risk, small validation; reproduced
  repository evidence.
- **Verifiers / disposition / recommendation:** one fresh journal/compatibility
  reviewer; proposed; pursue only after released-writer history is confirmed.

### B19-C03 — Share copied conflict-journal entry test factories

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `journal-test-data::five-inline-entry-builders`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B19; `12062b44ba39db345d4f80a4bd447ad2e6b6fae28a27f1fa849295b1bc9bab89`.
- **Domains / category:** B19 primary; B36 and C6 related; duplicated test
  fixtures.
- **Exact evidence:** the same required journal shape is reconstructed at
  `conflict-journal.service.spec.ts:16-31`,
  `sync-conflict-banner.service.spec.ts:15-30`,
  `sync-conflict-review.util.spec.ts:14-29`,
  `sync-conflict-ui.service.spec.ts:18-41`, and
  `pages/sync-conflicts-page/sync-conflicts-page.component.spec.ts:12-34`.
- **Current responsibility / consumers / formats:** each helper supplies valid
  v1 journal records, varying IDs, timestamps, display values, status, or field
  diffs for service and UI tests.
- **Unnecessary mechanism / smallest change:** add one neutral file-local-domain
  fixture under `src/app/op-log/testing/` with explicit overrides. Keep thin
  local wrappers only where a component's defaults carry meaning.
- **Equivalence / invariants / failure modes:** preserve unique IDs, deterministic
  UI values, status defaults, explicit diffs, and time overrides in retention
  cases. A shared default must not make two records accidentally identical or
  hide the property under test.
- **Evidence and history:** exact structural search finds five copies; all were
  introduced in `962c5bbeb1`, and no shared journal fixture exists.
- **Existing work:** route/deduplicate with B36/C6; no exact record exists.
- **Required verification:** before/after fixture-value inventory; all five
  affected specs; mutation-check ID uniqueness, retention timestamps, status,
  UI labels, and diffs; `checkFile` on helper/specs.
- **Estimated delta / benefit:** production 0; tests about −30 to −45 LOC
  after adding the helper.
- **Blast radius / reversibility / risk / confidence:** test-only across five
  specs; easy revert; low risk/small validation; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh journal-test reviewer;
  proposed; pursue.

### B19-C04 — Move copied mobile conflict-dialog overrides to one shared rule

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `mobile-conflict-dialog-layout::copied-local-ng-deep-overrides`; proposed,
  investigate before admission.
- **Baseline / origin / revision hash:** `9b448133…`; B19; `1699fb0e75c5a58e8c432145d0a7ab2212f530ca5c5577bfdf391f65a9e94632`.
- **Domains / category:** B19 primary; B35, frontend UI, and C6 related;
  duplicated styling and local shared-component override.
- **Exact evidence:**
  `imex/sync/dialog-sync-conflict/dialog-sync-conflict.component.scss:74-90`
  and
  `op-log/sync/dialog-sync-import-conflict/dialog-sync-import-conflict.component.scss:87-102`
  contain the same mobile padding/max-width/overflow block. Their
  `mat-dialog-content` elements are at HTML lines 3 and 10; shared Material
  rules already live in `src/styles/components/_overwrite-material.scss:89-124`.
- **Current responsibility / consumers / formats:** the effective content rule
  keeps narrow-screen dialog tables/actions readable. The container selector
  is written as a `:host` descendant even though the Material container is an
  ancestor; the content selector is the effective portion.
- **Unnecessary mechanism / smallest change:** add one semantic class to both
  `mat-dialog-content` elements, put its xs-only rule in the shared Material
  style layer, and delete the two local `::ng-deep` blocks. Reuse the existing
  global overlay-panel width rule.
- **Equivalence / invariants / failure modes:** preserve mobile content padding,
  width, horizontal overflow, safe-area/keyboard behavior, and desktop layout;
  do not affect unrelated dialogs, focus, or destructive choices.
- **Evidence and history:** the blocks are textually identical. The styling
  guide requires overlay/shared Material styling in the shared layer. History
  shows `b0cb36eebb`, copy `f9620d4f37`, and token conversion `114e5067a1`.
- **Existing work:** reconcile with open rendering issue `#8936`; it may cover
  older non-journal dialog behavior but not necessarily this duplication.
- **Required verification:** both component specs; real-browser xs screenshots
  for both dialogs; keyboard/safe-area and desktop checks; `checkFile` for every
  modified HTML/SCSS file.
- **Estimated delta / benefit:** production about −18 to −22 SCSS/HTML LOC;
  removes two deep overrides and centralizes a semantic variant.
- **Blast radius / reversibility / risk / confidence:** shared styling plus two
  dialogs; easy revert; low-to-medium visual risk, medium validation; supported
  but not visually reproduced.
- **Verifiers / disposition / recommendation:** one fresh UI reviewer after
  issue reconciliation; proposed; investigate, then pursue only with equivalent
  screenshots.

### B20-C01 — Remove the unused full-vector-clock reconstruction method

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `vector-clock-service::unused-get-full-vector-clock`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B20; `4b249c444af44656f30e6f3352732b86bfcb3b61d4a0f042e4c56ced29aa8f8b`.
- **Domains / category:** B20 primary; B14 and C1 related; dead production
  method and direct tests.
- **Exact evidence:** `vector-clock.service.ts:84-109` defines
  `getFullVectorClock()`. Exact repository, DI-string, integration, and
  serialized-name closure finds only its four direct tests at
  `vector-clock.service.spec.ts:301-378`. The live `getCurrentVectorClock()` at
  `:58-82` owns authoritative-store lookup with snapshot-plus-tail fallback.
- **Current responsibility / consumers / formats:** the dead method reconstructs
  a clock by scanning the full log. Force-from-sequence-zero recovery instead
  passes downloaded `allOpClocks` through `OperationLogSyncService`. The method
  is an internal Angular service API, not a plugin, package, persisted, or wire
  contract.
- **Unnecessary mechanism / smallest change:** delete only
  `getFullVectorClock()` and its four direct tests.
- **Equivalence / invariants / failure modes:** preserve current-clock fallback,
  snapshot clock/entity keys, entity frontiers, force-download `allOpClocks`,
  authoritative persistence, pruning, and every serialized clock shape. Repeat
  external/deep-path closure before implementation.
- **Evidence and history:** exact symbol closure is test-only. `ef0a84f290`
  introduced it during sequence-zero recovery, but no call followed. Unmerged
  branch `pr-8588`, commit `ebd612200f`, independently deletes the same method
  and tests; it is not an ancestor of frozen HEAD.
- **Existing work:** link the unmerged prior implementation as evidence, not as
  a merge-ready change.
- **Required verification:** repeat exact-symbol/export/DI closure; focused
  vector-clock spec; orchestrator force-download/recovery spec; TypeScript
  build/check and `checkFile` on both files.
- **Estimated delta / benefit:** exactly about −104 LOC: −26 production and
  −78 tests; removes a misleading recovery API and full-log scan concept.
- **Blast radius / reversibility / risk / confidence:** two files; trivial
  revert; low implementation risk but production sync policy requires two
  reviewers; reproduced-high confidence.
- **Verifiers / disposition / recommendation:** two fresh vector/recovery
  reviewers; proposed; pursue first.

### B20-C02 — Make sync-core the canonical import-clock classifier test owner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-import-filter-tests::classifier-vs-orchestration-ownership`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B20; `48799add0f5569e1909f8ad2cc6491c29f2fe3c1c785d04a2653c47bf398224c`.
- **Domains / category:** B20 primary; B29, B36, and C6 related; copied policy
  tests and stale pruning narratives.
- **Exact evidence:** the 2,863-line app spec has repeated classifier regions at
  `sync-import-filter.service.spec.ts:442-1004,1441-2305,2314-2860` and an unused
  `getLatestFullStateOp` spy at `:35-40`; production calls only
  `getLatestFullStateOpEntry`. Canonical classification is
  `packages/sync-core/src/sync-import-filter.ts:1-67`, with 16 focused cases in
  `packages/sync-core/tests/sync-import-filter.spec.ts`; the app delegates once
  at `sync-import-filter.service.ts:177`.
- **Current responsibility / consumers / formats:** sync-core owns clock
  relation/counter classification. The app uniquely owns selection and order:
  no-import pass-through, all full-state ops retained, last in-batch server
  order, batch-over-stored precedence, metadata/flags, REPAIR prefix/suffix,
  groups, and dialog state.
- **Unnecessary mechanism / smallest change:** first inventory every title and
  assertion. Retain one app boundary case per classifier reason plus every
  unique selection/metadata/REPAIR case; remove package-owned clock-shape
  permutations, obsolete protected-client/pruning prose, fake ten-entry
  pipelines, and the dead spy. Do not mock away the classifier boundary.
- **Equivalence / invariants / failure modes:** production is unchanged.
  Preserve explicit-import clean-slate invalidation, same-client strict `>`,
  different-client import-counter `>=`, zero/empty edges, causal REPAIR prefix,
  legacy concurrent prefix replay, suffix order, and local conflict-dialog
  semantics.
- **Evidence and history:** `ba838eccf6` extracted and tested the pure
  classifier without consolidating the app suite. `cfc6749197` removed the old
  pruning heuristic; `e92eb79db7` and `329da9b9f3` define current counter and
  REPAIR behavior.
- **Existing work:** overlaps generic C6/B14-C03; no exact inventory-driven
  candidate was found.
- **Required verification:** machine-readable before/after title/assertion map;
  package and app specs; import-reset/import-sync/file-sync/remote-processing
  integrations; mutation-check every classifier reason and REPAIR segment;
  `checkFile`.
- **Estimated delta / benefit:** production 0; app tests about −1,300 to
  −1,800 LOC while retaining roughly 25–32 app cases and all 16 core cases.
- **Blast radius / reversibility / risk / confidence:** primarily one test file;
  easy revert but high sync-critical coverage risk/large review burden;
  supported-high confidence.
- **Verifiers / disposition / recommendation:** two fresh import/replay
  reviewers; proposed; pursue only with the complete assertion inventory.

### B20-C03 — Delete tests of a pruning heuristic production removed

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `vector-clock-pruning-tests::removed-heuristic-replica`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B20; `914ebbc98922f2b1fd51bd7d6a1447b5a95342eee3acca42888908e3c9bf0b64`.
- **Domains / category:** B20 primary; B36 and C6 related; tests of copied dead
  logic plus misleading E2E metadata.
- **Exact evidence:**
  `testing/integration/vector-clock-import-reset.integration.spec.ts:24-39`
  locally reimplements removed `isLikelyPruningArtifact`; `:492-602` tests only
  that copy. Production deleted the heuristic in `cfc6749197`. Actual client
  scenarios at `:280-490,604-887` cover current reset/counter/MAX/lifecycle and
  second-round convergence. `e2e/tests/sync/supersync-vector-clock-pruning.spec.ts:13-35`
  says import-client IDs are protected while acknowledging it cannot trigger
  pruning; the executable cases actually cover post-import convergence.
- **Current responsibility / consumers / formats:** current behavior is minimal
  full-state clock reset plus import-counter exceptions; real server pruning is
  owned by sync-core/server tests at the 20-entry boundary.
- **Unnecessary mechanism / smallest change:** delete the local helper and its
  three self-tests; retain all real simulated-client blocks. Rename/reword the
  E2E suite description to post-import convergence without changing its body.
- **Equivalence / invariants / failure modes:** no runtime/persisted change.
  Preserve concurrent-op rejection, counter proof, minimal reset, uploader
  preservation, MAX=20, compare-before-prune, and multi-client convergence.
- **Evidence and history:** copied helper/tests entered in `791022b2dd`; current
  mechanism arrived in `e92eb79db7`, and `cfc6749197` removed production's old
  heuristic without its test copy.
- **Existing work:** route through B36/C6 and coordinate with B20-C02; no second
  classifier copy should be created.
- **Required verification:** focused import-reset integration; sync-core clock
  and classifier specs; static search for the helper; `checkFile` on both specs.
  E2E execution is optional because only its description changes.
- **Estimated delta / benefit:** about −127 test LOC plus a small comment/name
  correction; removes false coverage of nonexistent behavior.
- **Blast radius / reversibility / risk / confidence:** tests/docs only; easy
  revert; low implementation risk, medium coverage-perception risk;
  reproduced-high confidence.
- **Verifiers / disposition / recommendation:** one fresh test-topology reviewer;
  proposed; pursue under B36/C6.

### B20-C04 — Correct the bounded vector-clock lifecycle documentation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `vector-clock-docs::current-atomic-reset-and-filter-lifecycle`;
  already-tracked.
- **Baseline / origin / revision hash:** `9b448133…`; B20; `559f53cd669a0af4cde6ae57e9b6babc0d100d19124d63f015ca51a26eb8f117`.
- **Domains / category:** B20 primary; A6-PW-015 and C7 related; documentation
  drift, not runtime behavior.
- **Exact evidence:** `docs/sync-and-op-log/vector-clocks.md:80` describes a
  separate remote clock write although
  `operation-log-store.service.ts:1160-1249` commits reducers and clocks
  atomically. Doc lines `118-120,355` describe full import-clock replacement,
  while `calculateRemoteClockMerge()` at store lines `185-224` performs minimal
  import/current-client reset plus suffix merge/prune. Lines `147-160` omit the
  remote checkpoint path; `:172` omits multi-entity arrays; `:250-256,353` omit
  counter exceptions/REPAIR order and mention the removed heuristic; `:107,377`
  name obsolete server owners. `sync-import-filter.service.ts:53-67` also says
  “no exceptions” immediately before documenting exceptions.
- **Current responsibility / consumers / formats:** documentation should teach
  MAX=20, full incoming comparison before server prune, atomic checkpointing,
  minimal reset, classifier exceptions, REPAIR order, and multi-entity conflict
  coverage. Runtime formats are unchanged.
- **Unnecessary mechanism / smallest change:** correct only these claims and
  owner links; do not restructure the whole architecture guide.
- **Equivalence / invariants / failure modes:** docs/comments only. Incorrect
  simplification guidance is itself risky, so each corrected statement must
  cite current code and proving tests.
- **Evidence and history:** prose originated in `48924428c6`/`29541951a3`;
  atomic remote checkpointing arrived in `bdb0fef9a9`.
- **Existing work:** consolidate under A5-C05/A6-PW-015 and issues
  `#8760/#8962`; do not create a duplicate generic docs item.
- **Required verification:** line-by-line cross-check against store, filter,
  server conflict/upload, core classifier, and integration tests; Markdown/link
  checks and `checkFile` if service JSDoc changes.
- **Estimated delta / benefit:** runtime/tests 0; roughly 20–40 documentation or
  comment lines corrected/simplified.
- **Blast radius / reversibility / risk / confidence:** bounded docs/comments;
  easy revert; low implementation risk but two sync-aware reviewers;
  reproduced-high confidence.
- **Verifiers / disposition / recommendation:** linked to existing docs work;
  already tracked, fold into A6-PW-015/C7.

### B21-C01 — Stop persisting the unused full-state latest pointer

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `full-state-meta::derived-latest-after-status-aware-reader`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B21; `fa03f9eddcde7e8e31a0179254231784b6ce10f5d98cc43bb585bf147758d5cb`.
- **Domains / category:** B21 primary; B05, B06, B08, and C3 related;
  redundant derived persisted field with compatibility-safe narrowing.
- **Exact evidence:** `persistence/full-state-ops-meta.ts:18-50` defines,
  derives, and writes `FullStateOpsMetaEntry.latest`. Runtime normalization at
  `operation-log-store.service.ts:544-570` reads only `refs`; active/rejected
  lookup sorts `refs` by durable sequence at `:1408-1444`. Exact search finds no
  runtime read of `meta.latest` or `getLatestFullStateRef`.
  `db-upgrade.ts:51-66` writes the shared shape,
  `db-upgrade.spec.ts:292-299` is the only raw-shape assertion, and store lines
  `2810-2816` retain stale “latest is derived” prose.
- **Current responsibility / consumers / formats:**
  `SUP_OPS.meta[full_state_ops]` is a derived local IndexedDB/SQLite acceleration
  index. `refs` is load-bearing for active and rejected lookup, cleanup,
  rebuild, replacement, and backend parity. `latest` was an O(1) selector before
  status-aware lookup made it insufficient.
- **Unnecessary mechanism / smallest change:** remove `latest` and
  `getLatestFullStateRef`, make `buildFullStateOpsMeta` return a copied `refs`
  array only, update stale prose and the v7 raw-shape expectation, and add no
  migration or rewrite.
- **Equivalence / invariants / failure modes:** current readers already ignore
  old `latest`; frozen pre-`329da9b9f3` readers normalize `refs` through their
  own builder before consulting it, so refs-only rows are backward-readable.
  Preserve ref copying/validation/order, active and rejected barriers, stale-ref
  rebuild, v7 compact `o` and historical opType seeding, transactional updates,
  malformed-row rebuild, and SQLite parity.
- **Evidence and history:** whole-repository closure on the metadata key/type/
  helpers and a separate `.latest` search close on the helper, raw assertion,
  and stale prose. `807d3bf5e5` introduced the cache; `329da9b9f3` introduced
  status-aware ref scanning. Its parent version proves old readers re-derived
  the pointer from refs.
- **Existing work:** B06-R02 and B05-R02/R03 retain v7 scan, legacy compact
  encodings, rebuild, and transaction boundaries; no exact candidate exists.
- **Required verification:** characterize refs-only and legacy refs-plus-latest
  normalization without OPS rebuild; active/rejected/stale/clear/replace/
  rollback, IDB-upgrade, and real-sql.js metadata cases; `checkFile` on the five
  touched source/spec files.
- **Estimated delta / benefit:** production about −14 to −20 LOC, tests/docs
  neutral; removes one false format invariant and unused algorithm.
- **Blast radius / reversibility / risk / confidence:** five local persistence
  files, no wire/server/backup shape; easy revert; sync-critical metadata,
  medium validation; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh persistence/sync
  reviewers; proposed; pursue before broader full-state refactors.

### B21-C02 — Finish the SnapshotUploadService API consolidation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `snapshot-upload::obsolete-low-level-public-facade`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B21; `d7ba24b8fa791ed8c3106c64a0797d5bbce467e182c604a9caa7fbdb396cff0e`.
- **Domains / category:** B21 primary; B22 and C1 related; obsolete internal
  public surface and dead fulfilled result.
- **Exact evidence:** `snapshot-upload.service.ts:34-49` exports
  `SnapshotUploadData/Result`; `:83-200` exposes four low-level helpers. Exact
  and computed-property search finds no caller of
  `getValidatedSuperSyncProvider`, `gatherSnapshotData`, `uploadSnapshot`, or
  `updateLastServerSeq` outside the service/spec. The only production callers
  invoke `deleteAndReuploadWithNewEncryption` at
  `supersync-encryption-toggle.service.ts:64-68,113-117` and
  `import-encryption-handler.service.ts:130-135`, await it, and discard the
  value. Yet snapshot lines `217,310` return `existingCfg` plus upload result,
  and spec lines `158-297,500-507` test obsolete seams directly.
- **Current responsibility / consumers / formats:** the service owns one
  cohesive destructive workflow: validate/capture under the op-log barrier,
  strip local settings, encrypt before delete, update config, retry snapshot,
  advance server sequence, and mark subsumed ops synced. Callers own user-flow
  error handling only; no low-level method/type/result is a package, plugin,
  wire, or persisted contract.
- **Unnecessary mechanism / smallest change:** keep helpers for readability but
  make them and their types private; make the high-level method return
  `Promise<void>`; remove its dead result and make caller spies resolve void.
  Reframe direct helper tests through the public workflow without dropping
  unique safety assertions.
- **Equivalence / invariants / failure modes:** callers already ignore success
  values and exceptions remain the failure channel. Preserve provider args,
  WebCrypto/mandatory-encryption fail-closed checks before delete, locked
  capture, archive-inclusive boundary state, local-only stripping, encryption
  before delete, credential-preserving config spread, config-before-upload
  recovery, UUID identity, 429 delay/cap, serverSeq acceptance, and mark-synced
  only after acceptance.
- **Evidence and history:** symbol/computed-property/import closure finds two
  callers and three specs, with no barrel/package/plugin export. `0d2538fc53`
  explains the original multi-caller mechanics; `49bf056ee0` consolidated them
  behind the high-level workflow but left the facade/result. Security/race fixes
  `63253f8e0c` and `bd67174863` attach to that workflow and remain.
- **Existing work:** A6-PW-003 and the architecture review discuss broader
  orchestration/snapshot construction, not closing this completed migration.
- **Required verification:** preserve public-path tests for provider validation,
  stripping, regenerated client ID, rejection, missing serverSeq, order, lock
  cutoff, mandatory/WebCrypto failure, 429 retries, and post-accept
  consolidation; focused service/caller specs and `checkFile`.
- **Estimated delta / benefit:** production about −2 to −8 LOC plus four
  public methods and two exported types removed; tests about −30 to −70 LOC.
- **Blast radius / reversibility / risk / confidence:** one service and three
  specs; no runtime/wire/persistence/UI change; easy revert; low behavioral risk
  inside a sync-critical workflow, small validation; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh snapshot/encryption
  reviewer; proposed; pursue independently.

### B18-C01 — Finish the sync-core helper extraction at the app boundary

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `conflict-service::post-extraction-helper-facades-and-copy-tests`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B18; `5017c79d17b2a1876510575b8b86c3174800efad28360e15fb59be3528c0be50`.
- **Domains / category:** B18 primary; B17, B19, B29, C1, and C6 related; dead
  facades, single-use wrappers, and duplicate algorithm tests.
- **Exact evidence:** `conflict-resolution.service.ts:786-800` exposes unused
  `isIdenticalConflict` and dead `_deepEqual`; `:3542-3562` contains dead
  `_extractEntityFromPayload/_extractUpdateChanges`; `:3703,3714,3783,
  3798-3868` routes one call each through `_buildEntityFrontier`,
  `_adjustForClockCorruption`, and `_suggestResolution`. Exact repository search
  finds no runtime consumer of the first four and only those single call sites
  for the latter three. App copy tests occupy
  `conflict-resolution.service.spec.ts:210-435,5131-5356,6928-7018,7089-7292`.
  Canonical helper tests are in
  `packages/sync-core/tests/conflict-resolution.spec.ts:63-188,731-853,
  1184-1318`.
- **Current responsibility / consumers / formats:** sync-core owns deep
  equality, identical/suggested resolution, payload extraction, entity
  frontier, and corruption adjustment. The app must adapt registry/logger/
  `devError` inputs, track corruption-escalated conflict objects for journal
  classification, and use the results in actual detection/resolution.
- **Unnecessary mechanism / smallest change:** delete the four uncalled service
  methods and their direct tests; inline the three one-call adapters at
  `_checkEntityForConflict`; delete exhaustive app copies of core algorithm
  matrices. Retain or add one app-boundary characterization for registry key
  resolution, corruption escalation plus journal tagging, and suggested
  resolution wiring.
- **Equivalence / invariants / failure modes:** preserve logger and
  `onPotentialCorruption: devError`, exact frontier context, comparison values,
  WeakSet identity/tagging, suggestion values, payload keys, and never change
  conflict detection or LWW planning. Core tests remain exhaustive; app tests
  must fail if adapter arguments or call order are wrong.
- **Evidence and history:** exact symbol closure reproduces dead/single-use
  status. `4d632aba3b` introduced identical-conflict app tests;
  `172fe1a49c`, `cd0d8f5cb9`, `a977fa2fbe`, and `e0bff64b34` accumulated helper
  suites. `d0b5771a47` extracted canonical conflict helpers/tests to sync-core
  but deliberately left app service integration, after which copies remained.
- **Existing work:** coordinate with B17-C04's collaborator-copy cleanup and
  B29 package API ownership; generic service decomposition issue `#8937` is
  broader and not a substitute.
- **Required verification:** repeat symbol/export/DI closure; assertion map from
  each removed app suite to core tests; focused core and conflict-service specs;
  app integration for detection, corruption journal reason, registry payload
  keys, recovery, and disjoint merge; `checkFile` on service/spec.
- **Estimated delta / benefit:** production about −45 to −65 LOC and app
  tests about −600 to −750 LOC after small boundary characterizations; one
  canonical algorithm owner and no private-`any` algorithm tests.
- **Blast radius / reversibility / risk / confidence:** one app service/spec plus
  unchanged core tests; easy revert, but sync-critical adapter wiring and large
  assertion inventory require high validation; reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh app/core conflict
  reviewers; proposed; pursue in dead-facade then copy-test slices.

### B18-C02 — Delete the weaker duplicate archive-wins spec block

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `conflict-service-spec::duplicate-archive-wins-block`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B18; `4426941ec78504a8f4029eecf6d56b575d1a6c8d154bc9cdb134ebc55aa21a79`.
- **Domains / category:** B18 primary; B36 and C6 related; exact test
  duplication and contradictory prose.
- **Exact evidence:** the comprehensive archive block at
  `conflict-resolution.service.spec.ts:5557-5903` covers remote archive versus
  local update, local archive versus remote update, replacement clock/payload/
  footprint, mixed local ops, archive versus delete, both-archive behavior, and
  multi-conflict resurrection prevention. The later `archive-wins rule` block
  at `:6051-6195` repeats only local archive/remote update, remote archive/local
  update, and local archive/remote delete with fewer assertions.
- **Current responsibility / consumers / formats:** the stronger app block and
  canonical sync-core planning cases preserve archive precedence and its
  replacement/application effects. No production or format change is proposed.
- **Unnecessary mechanism / smallest change:** delete the later three-case
  subset. Correct the earlier archive-versus-delete title/comment that says
  “normal LWW” immediately before asserting archive precedence; keep its
  executable assertions.
- **Equivalence / invariants / failure modes:** assertion-set comparison must
  show every later stimulus/outcome covered by the earlier block. Preserve
  archive payload/entityIds, merged clocks, both-side archive tie behavior,
  local/remote rejection/application, and anti-resurrection coverage.
- **Evidence and history:** line-by-line case comparison proves the strict
  subset. The later block is primarily `cba5ba3f12`; the stronger block includes
  later archive safety fixes such as `27cb18b85a`.
- **Existing work:** generic C6 overlap only; no exact record found.
- **Required verification:** before/after test-title/assertion map; focused
  conflict-service and sync-core conflict specs; mutation-check all three
  archive pairings plus replacement fields and resurrection prevention;
  `checkFile`.
- **Estimated delta / benefit:** tests about −140 to −145 LOC; less runtime
  and one unambiguous archive policy suite.
- **Blast radius / reversibility / risk / confidence:** test-only; trivial
  revert; low implementation risk, medium sync-coverage review; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** one fresh archive/conflict
  reviewer; proposed; pursue.

### B18-C03 — Test entity-registry storage patterns at their real boundary

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `conflict-service-spec::generic-entity-smokes-vs-registry-branches`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B18; `46b4f57c7b9ed5566837f75bcf527ec4b238bab306a696df58c848fd8eae2047`.
- **Domains / category:** B18 primary; B01, B36, and C6 related; repetitive and
  partly false-confidence tests.
- **Exact evidence:** `conflict-resolution.service.spec.ts:3722-3988` builds
  large one-off LWW conflicts for GLOBAL_CONFIG, PLANNER, BOARD, REMINDER, and
  PLUGIN_USER_DATA. The generic resolver does not branch on those names, and
  the remote-winning PLANNER/REMINDER/PLUGIN cases never call
  `getCurrentEntityState`; therefore the PLUGIN test's comment claiming it
  proves the registry's array branch is false. Actual storage-pattern branches
  are `conflict-resolution.service.ts:3585-3643`; the only focused state lookup
  case is the ISSUE_PROVIDER selector-factory test at spec `:181-208`.
- **Current responsibility / consumers / formats:** the registry defines
  singleton (`GLOBAL_CONFIG`), map (`PLANNER`), keyed-array (`BOARD`), and
  state-is-array (`REMINDER`, `PLUGIN_USER_DATA`) lookup shapes. Generic LWW
  winner planning is already covered independently.
- **Unnecessary mechanism / smallest change:** replace the five full conflict
  literals with a typed table around `getCurrentEntityState`, one row per
  storage branch and an explicit PLUGIN_USER_DATA regression row. Keep the
  mixed-entity atomic batch test at `:3989-4067` separate.
- **Equivalence / invariants / failure modes:** preserve real selectors, entity
  IDs, map/array keys, missing-item behavior, singleton whole-state identity,
  plugin data, and ISSUE_PROVIDER's special factory. Do not use a fake table
  that bypasses registry config or collapse mixed-batch ordering.
- **Evidence and history:** the generic LWW group began with `4d96c8ffff`;
  plugin cases were strengthened in `196e50b906`/`92947d4acb` but remained on a
  remote-winner path that never exercises the branch they describe.
- **Existing work:** coordinate with B01 entity-registry coverage and generic
  C6; no exact boundary-test conversion exists.
- **Required verification:** record branch coverage before/after; focused
  conflict-service spec; mutation-check singleton/map/keyed-array/direct-array,
  missing entity, plugin row, and ISSUE_PROVIDER selector factory; `checkFile`.
- **Estimated delta / benefit:** tests about −180 to −250 LOC; smaller
  fixtures with stronger evidence about the actual branch.
- **Blast radius / reversibility / risk / confidence:** test-only in one spec;
  easy revert; low runtime risk, medium assertion/branch-map cost; reproduced
  confidence.
- **Verifiers / disposition / recommendation:** one fresh registry/conflict
  reviewer; proposed; pursue.

### B18-C04 — Table-drive app-level timestamp edge wiring

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `conflict-service-spec::clock-skew-case-copies`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B18; `03b18695137abbf385014b39ffb1ee136f87ea84feb76d14494dd9863562bd67`.
- **Domains / category:** B18 primary; B29, B36, and C6 related; repeated
  app-level timestamp cases.
- **Exact evidence:** `conflict-resolution.service.spec.ts:5357-5556` repeats
  full setup for far-future, far-past, zero, negative, and two exact-timestamp
  tie directions. Canonical LWW planning and both stable client-ID tie
  directions are covered at
  `packages/sync-core/tests/conflict-resolution.spec.ts:494-603`.
- **Current responsibility / consumers / formats:** the app suite need only
  prove planner outcomes are wired to remote append/apply or local replacement/
  rejection. It may retain acceptance of unusual numeric timestamps as a
  compact edge table; sync-core owns winner policy.
- **Unnecessary mechanism / smallest change:** table-drive the four numeric
  skew rows through one setup/assert harness. Keep the two named, directional
  tie regressions explicit because `#9035` requires both devices to choose the
  same physical client.
- **Equivalence / invariants / failure modes:** preserve each exact timestamp,
  winner, append source, applied/rejected IDs, and the two swapped-client tie
  assertions. Do not normalize or reject timestamps as part of cleanup.
- **Evidence and history:** the repeated skew block descends chiefly from
  `936f374bde`; stable client-ID tie behavior was later fixed in
  `9132ab6722`, so those two cases are deliberately retained.
- **Existing work:** sync-core is the canonical policy owner; coordinate only
  fixture work with C6.
- **Required verification:** before/after case table inventory; focused app and
  sync-core conflict specs; mutation-check remote/local wiring and both tie
  directions; `checkFile`.
- **Estimated delta / benefit:** tests about −80 to −110 LOC; one compact
  app-wiring matrix with no scenario deletion.
- **Blast radius / reversibility / risk / confidence:** test-only; easy revert;
  low risk/small validation; reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh LWW test reviewer;
  proposed; pursue.

### B22-C01 — Delete the impossible SuperSync disable-encryption path

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-encryption::ui-hidden-disable-rejected-by-mandatory-guard`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B22; `d27e6079df3c9b422ed82b7414ed09f2ff79496b9c78c05b3685be64d6adc20f`.
- **Domains / category:** B22 primary; B21, C1, and C3 related; unreachable
  destructive workflow.
- **Exact evidence:** `sync-form.const.ts:489-515` hides disable for SuperSync
  and calls only `openDisableEncryptionDialogForFileBased`.
  `encryption-password-dialog-opener.service.ts` exposes disable only for
  file-based providers, and
  `dialog-change-encryption-password.component.html` renders removal only when
  provider type is not SuperSync. Yet its TypeScript `:145-154` keeps a
  SuperSync branch/injection, `supersync-encryption-toggle.service.ts:100-144`
  keeps `disableEncryption`, and snapshot upload `:252-265` rejects plaintext
  mandatory-encryption providers before deletion while calling future disable
  wiring currently UI-unreachable.
- **Current responsibility / consumers / formats:** supported SuperSync allows
  setup/change, not disabling. File-based providers retain their explicit
  disable path. The dead method cannot produce a valid plaintext SuperSync
  snapshot and is reachable only through hidden branches/direct tests.
- **Unnecessary mechanism / smallest change:** remove the SuperSync toggle
  method/tests, change-dialog branch/injection, snapshot stale comment, and
  disable-related SuperSync config comments. Preserve every file-based disable
  method/dialog/test.
- **Equivalence / invariants / failure modes:** no supported UI or successful
  persisted/wire format changes. Mandatory encryption must remain fail-closed,
  and no deletion may occur before encryption validation. Confirm no deep,
  reflective, or migration caller invokes the service method.
- **Evidence and history:** call/UI closure proves the path hidden and the
  mandatory snapshot guard proves it cannot succeed. It arrived in
  `3ef23354e4` with mandatory encryption, gained revert handling in
  `49d24bfec0`, and was later made impossible by the plaintext guard.
- **Existing work:** resolves the B21-routed mandatory-encryption/plaintext-
  disable mismatch; no supported deprecation decision is needed because no
  success path exists.
- **Required verification:** static SuperSync-disable closure; focused toggle
  and change-dialog specs; mandatory-encryption guard and file-based disable
  cases; `checkFile`; later scheduled SuperSync setup/password-change E2E.
- **Estimated delta / benefit:** roughly five files and −100 to −130
  production/test LOC; removes a destructive API that only fails.
- **Blast radius / reversibility / risk / confidence:** encryption UI/service
  surface; easy revert, security/sync-critical behavior with medium validation;
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh encryption/workflow
  reviewers; proposed; pursue while explicitly retaining file-based disable.

### B22-C02 — Collapse import encryption handling to its only legal transition

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `import-encryption::generic-bidirectional-state-for-one-way-enable`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B22; `028ce40baee350b88628324a16b8087839d57d989ed770e6eb1780138aa53d12`.
- **Domains / category:** B22 primary; B10, B21, C1, and C2 related; unreachable
  branches and misleading result state.
- **Exact evidence:** `import-encryption-handler.service.ts:95-98` defines
  `willChange = !currentEnabled && importedEnabled`, making its later
  current-enabled/imported-disabled branch at `:178-184` unreachable.
  `currentHasKey/importedHasKey` have no production consumer. The public helper
  accepts `importedData` it never uses, exposes a false/disable mode rejected by
  mandatory snapshot upload, and returns status booleans consumed only by tests;
  `file-imex.component.ts:243-250` reads only `.error`. Its catch also always
  reports `serverDataDeleted: false`, although upload may throw after deletion
  or config update. The warning dialog's `isDisablingEncryption` branch is
  unreachable for the same reason.
- **Current responsibility / consumers / formats:** supported import behavior is
  no change for non-SuperSync/same-state inputs, or warning plus destructive
  reupload for unencrypted-to-encrypted transition. Errors are the only caller-
  observed result.
- **Unnecessary mechanism / smallest change:** replace the generic bidirectional
  helper/result with a private one-way enable helper and a minimal nullable/
  `{error?: string}` result; remove unused key flags, parameter, disable branch,
  unreliable booleans, disabling warning UI, and direct tests of those states.
- **Equivalence / invariants / failure modes:** preserve provider gating,
  wrapped-backup/key checks, warning/confirmation, enable reupload, exception
  text, and caller behavior. Mandatory encryption and pre-delete guards remain;
  do not claim transaction status the workflow cannot know reliably.
- **Evidence and history:** consumer/data-flow closure proves only `.error` is
  observed. The generic surface came from `76defad7325`; one-way mandatory
  behavior was formalized in `a4dee9d5f7` without closing old branches.
- **Existing work:** coordinate with B10 import compatibility and B21 snapshot
  API cleanup; no wire/schema migration is proposed.
- **Required verification:** focused handler, file-imex, and warning-dialog
  specs for non-SuperSync, same state, enable, wrapped backup, missing key,
  cancel, and error; component compile and `checkFile` on every touched file.
- **Estimated delta / benefit:** roughly four files and −70 to −100
  production/test LOC; one truthful transition/result contract.
- **Blast radius / reversibility / risk / confidence:** import/encryption UI
  workflow; easy revert, sync-critical destructive path with medium validation;
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh import/encryption
  reviewers; proposed; pursue after characterizing the one legal transition.

### B22-C03 — Remove raw sync-data samples from JsonParseError

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-json-errors::raw-decrypted-data-sample`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B22; `c8dabc4170d690333bbdce075355313c963255a4be331c5f946577a6f1ee1bc7`.
- **Domains / category:** B22 primary; B16 and C8 related; privacy-sensitive
  dead diagnostic field.
- **Exact evidence:** `core/errors/sync-errors.ts:241-266` stores enumerable
  `dataSample` containing roughly 100 characters around a JSON parse position.
  `encrypt-and-compress-handler.service.ts:140-145` passes post-decrypt/
  post-decompress `outStr`, which is user data. Repository closure finds only
  the definition and direct tests, no runtime consumer. `SyncWrapperService`
  passes the caught error to `SyncLog.err` before its JsonParseError branch, so
  export exposure is plausible depending on serializer; that exposure is an
  inference because the serializer was outside this run's 60-file closure.
- **Current responsibility / consumers / formats:** callers need error class,
  safe message, and numeric parse position for classification/recovery. They do
  not need task titles, notes, settings, or other plaintext retained on the
  error object.
- **Unnecessary mechanism / smallest change:** remove `dataSample` and the
  constructor's `dataStr` parameter; pass only the original parse error and
  preserve position/safe message/name. Replace sample tests with absence-of-
  content assertions using sentinel user data.
- **Equivalence / invariants / failure modes:** JSON failure classification,
  position extraction, UI/recovery branches, and fail-closed behavior remain.
  No raw plaintext, ciphertext key, credential, or payload fragment should be
  retained or exported.
- **Evidence and history:** exact `dataSample` closure is test-only. It was
  introduced in `7496b2dd60`, before log-redaction work `5772b3416c`.
- **Existing work:** complements B16-C05/C8 logging hardening; distinct because
  this removes sensitive content at error construction.
- **Required verification:** handler and sync-error specs assert class,
  position, message, and absence of sentinel content from enumerable fields,
  stringification, and exported logs if available; `checkFile` on touched files.
- **Estimated delta / benefit:** about three files and −40 to −60
  production/test LOC; reduces retained plaintext and false diagnostic surface.
- **Blast radius / reversibility / risk / confidence:** error construction and
  tests only; easy revert, privacy-sensitive but low behavioral risk, medium
  validation; reproduced closure with inferred log exposure clearly marked.
- **Verifiers / disposition / recommendation:** two fresh privacy/error reviewers;
  proposed; pursue.

### B23-C01 — Remove the unreachable native OAuth-dialog branch

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `oauth-dialog::reverted-native-ui-branch`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B23; `70346857f0ae13dede78a158b7b5ff33d37c46e8b30fa44fffbb804b592c4a35`.
- **Domains / category:** B23 primary; provider OAuth UI; dead branch and
  translations.
- **Exact evidence:**
  `dialog-get-and-enter-auth-code.component.ts:24,47,64-80` hardcodes
  `isNativePlatform` to `false`, so the manual branch always renders and the
  native spinner/waiting branch in the template at `:6-89` never renders. The
  two native translations at `t.const.ts:1299,1304` and `en.json:1276,1281`
  have no other consumers.
- **Current responsibility / consumers / formats:** Electron can finish from
  its automatic callback; web and mobile accept a manually pasted callback or
  raw code, including OneDrive state validation and Dropbox PKCE fallback.
- **Unnecessary mechanism / smallest change:** remove the hardcoded flag,
  unreachable native template branch, conditional wrappers, spinner import and
  style, and the two dead translations. Make callback subscription explicitly
  Electron-only.
- **Equivalence / invariants / failure modes:** preserve Electron callback
  success/error, manual entry on web/Android/iOS, state validation, raw codes,
  and synchronous iOS input focus. Auth UI is sensitive to platform branches;
  do not restore the mobile deep-link flow.
- **Evidence and history:** `40b18c4693` added mobile deep-link UI;
  `ec847ce897` deliberately returned mobile to manual entry; `01e30b9c7e`
  records app-kill/PKCE and redirect-registration constraints but left the
  obsolete UI.
- **Existing work:** none found beyond the historical revert.
- **Required verification:** focused component cases for mobile manual
  rendering, Electron callback success/error, valid and invalid OneDrive URLs,
  raw codes, and synchronous focus; existing wrapper/OAuth specs and
  `checkFile` for touched files.
- **Estimated delta / benefit:** about −40 to −45 production/translation LOC;
  one truthful platform flow.
- **Blast radius / reversibility / risk / confidence:** OAuth dialog only; easy
  revert, low-to-medium auth-UI risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one provider-UI reviewer;
  proposed; pursue.

### B23-C02 — Delete the unused wrapped-provider cache reset

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `wrapped-provider-cache::dead-manual-clear`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B23; `0775f964ea53800d79f5c08c30c7628ea8dcf2e72cc309f324acc00f6c8f25d7`.
- **Domains / category:** B23 primary; dead service API and direct test.
- **Exact evidence:** `wrapped-provider.service.ts:167-175` defines
  `clearCache()`. Repository-wide exact closure finds only its declaration,
  JSDoc, and direct spec at `:276-295`. Configuration changes already invalidate
  the cache through `providerConfigChanged$` at service `:49-58`, proved by the
  spec at `:297-315`.
- **Current responsibility / consumers / formats:** the service caches one
  wrapped adapter per provider and automatically invalidates it when provider
  configuration changes.
- **Unnecessary mechanism / smallest change:** remove `clearCache()`, its test,
  and manual-invalidation wording from the class comment.
- **Equivalence / invariants / failure modes:** preserve per-provider caching,
  automatic invalidation, encryption-intent fallback/backfill, and GHSA-9544
  fail-closed behavior.
- **Evidence and history:** `28fd19209f` introduced the method; it became
  redundant after `49bf056ee0`. Non-ancestor `pr-8588` commit `ebd612200f`
  independently removes exactly this method/test; do not import its wider
  refactor.
- **Existing work:** proven prior implementation on a non-ancestor branch.
- **Required verification:** repeat direct/export/DI closure, focused wrapped-
  provider spec, and `checkFile`.
- **Estimated delta / benefit:** −12 production and −21 test LOC; removes a
  misleading second invalidation path.
- **Blast radius / reversibility / risk / confidence:** internal service API;
  easy revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one provider-host reviewer;
  proposed; pursue.

### B23-C03 — Remove the unused app credential-change callback

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `credential-store::unused-app-change-callback`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B23; `f0131262b478b710a60bb180520a49036766a7c0bc9cdd83f05fad4b5922dda1`.
- **Domains / category:** B23 primary; dead app-specific callback surface.
- **Exact evidence:** exact `CredentialChangeCallback|onConfigChange` closure
  finds no production registration or call for
  `credential-store.service.ts:34-38,67,73-78,308-314`; only its direct spec at
  `:88-99` and a no-op integration mock member at `:50-58` exercise it.
- **Current responsibility / consumers / formats:** IndexedDB persistence,
  memory caching, token updates, provider-manager notifications, adapter
  invalidation, and legacy migration use other paths.
- **Unnecessary mechanism / smallest change:** remove the app-specific exported
  alias, field, registration method, notification block, direct test, and no-op
  mock. Leave the optional package-port member for B30 compatibility review.
- **Equivalence / invariants / failure modes:** preserve durable credential
  writes, in-memory state, migrations, provider notification, and auth-clearing
  behavior. Do not widen this into a package API change.
- **Evidence and history:** the callback arrived with the store in
  `db990b7018`; `a97a15457b` later copied it to an optional package port, but no
  app consumer was added.
- **Existing work:** none found.
- **Required verification:** repeat direct/dynamic/export closure; focused
  credential-store and provider package typechecks/specs; integration-mock
  compilation and `checkFile`.
- **Estimated delta / benefit:** about −18 to −22 production and −15 test/helper
  LOC; removes a false notification contract.
- **Blast radius / reversibility / risk / confidence:** app credential store and
  tests; easy revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one credential-store reviewer;
  proposed; pursue.

### B23-C04 — Allowlist provider-host diagnostic metadata

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `provider-host-logging::credential-and-callback-values`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B23; `77734fe3b1b29989be623210544f8ddb7b88bd002cc59e015299677ff05fc4b2`.
- **Domains / category:** B23 primary; B16 and C8 related; privacy hardening and
  simplification.
- **Exact evidence:** `sync-config.service.ts:32-66,264-268` uses a recursive
  denylist that still logs `baseUrl`, `serverUrl`, `syncFolderPath`, OneDrive
  `clientId`/`tenantId`, and future fields by default. OAuth logging at
  `oauth-callback-handler.service.ts:63-68,94-98,139,169-177` records provider-
  controlled descriptions/text and, on parse failure, the callback URL with
  code/state. Credential diagnostics at
  `credential-store.service.ts:112-129,293-304` export password/key length.
  `core/log.ts:115-149,236-280` confirms logs are retained and exportable.
- **Current responsibility / consumers / formats:** diagnostics need event,
  provider identity, and coarse state booleans; OAuth parser outputs and error
  text remain available to UI/control flow without entering persistent logs.
- **Unnecessary mechanism / smallest change:** replace recursive denylisting
  with fixed allowlisted metadata. Never log callback URL/code/state, provider
  text/error description, client/server/path fields, or key length.
- **Equivalence / invariants / failure modes:** preserve OAuth parsing, token
  exchange, UI errors, credential persistence, and provider configuration.
  Sentinel secrets must be absent from JSON and text exports.
- **Evidence and history:** denylist drift spans `6470725eaf`, `3ef23354e4`,
  and `74ce49428f`; OAuth raw values came from `40b18c4693`/`02bc3e88e3`;
  key-length instrumentation came from incident commit `ee58cc3acf`.
- **Existing work:** same privacy policy as B16-C05/C8, on non-overlapping
  provider-host files; serialize with B23-C03 in the credential store.
- **Required verification:** pass sentinel URLs, paths, IDs, provider error
  descriptions, codes, states, passwords, and keys through both log exports;
  assert absence while safe event/provider/boolean metadata remains, and
  preserve parser/UI behavior.
- **Estimated delta / benefit:** about −20 to −35 production LOC with focused
  privacy tests; removes a drifting redaction mechanism.
- **Blast radius / reversibility / risk / confidence:** diagnostics across
  provider configuration/OAuth/credentials; easy revert, medium security-
  sensitive risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh privacy/provider
  reviewers; proposed; pursue first.

### B23-C05 — Collapse the stale provider-comparison document

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-docs::duplicated-stale-provider-comparison`; proposed, dependent on C7.
- **Baseline / origin / revision hash:** `9b448133…`; B23; `a9c34f94415eb9477d810aaf6406b5ce85ddbe4f4fa7bcdaf46ad3fc78deac4f`.
- **Domains / category:** B23 primary; C7 canonicalization; duplicate stale
  documentation.
- **Exact evidence:** `diagrams/07-supersync-vs-file-based.md` claims server
  operations live forever, file sync retains 200 ops, late SuperSync clients
  replay everything, and HTTP 409 means a generic sequence gap. Current code
  instead has 45-day retention with snapshot-covered cleanup, cached server
  snapshots, `MAX_RECENT_OPS = 2000`, optional split `sync-ops.json`/
  `sync-state.json` format with compatibility tombstones, and 409
  `SYNC_IMPORT_EXISTS` semantics. The 395-line file is linked only by the
  diagrams README and also recommends team workflows outside product scope.
- **Current responsibility / consumers / formats:** this is explanatory
  documentation only; provider-specific canonical diagrams and code define the
  actual storage/wire behavior.
- **Unnecessary mechanism / smallest change:** after C7 corrects canonical
  provider diagrams, replace this duplicate with a short fact-checked
  comparison and links; remove duplicated sequence/storage diagrams.
- **Equivalence / invariants / failure modes:** no runtime or format effect.
  Preserve accurate differences in server authority, cursor/CAS behavior,
  offline operation, encryption, and recovery.
- **Evidence and history:** created/reorganized in `9f0adbb95c` and expanded in
  `9605177fc0`, both before current snapshot, retention, and split-file work.
- **Existing work:** dependent on C7 to establish canonical documentation.
- **Required verification:** claim-to-code checklist, Mermaid rendering, and
  link validation after C7.
- **Estimated delta / benefit:** about −300 to −350 docs LOC; one canonical
  description per behavior.
- **Blast radius / reversibility / risk / confidence:** documentation only;
  easy revert, low runtime risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one documentation reviewer;
  proposed; pursue after C7.

### B26-C01 — Make DropboxApi the sole token-refresh owner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `dropbox-token-refresh::duplicated-provider-wrapper`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B26; `4eef3ba2fb0ca2cdb0954c622d9565f19c3f11db71caf53e2b4c14693aa4591e`.
- **Domains / category:** B26 primary; B23/B30 related; duplicated provider
  responsibility.
- **Exact evidence:** all five provider operations in
  `file-based/dropbox/dropbox.ts:134-294` wrap `DropboxApi` calls in
  `_withTokenRefresh()`. The API already owns the same one-retry policy for
  native and web requests at `dropbox-api.ts:643-649,776-783`. After that retry,
  `_handleErrorResponse()` converts a second 401 to `AuthFailSPError` at
  `:849-860`; the provider's response-shaped `_isTokenError()` at `:392-399`
  therefore cannot observe it. Focused API specs at `:236-286,748-785` pin the
  refresh and terminal-auth behavior; no provider-level test exercises the
  second wrapper.
- **Current responsibility / consumers / formats:** `DropboxApi` loads tokens,
  refreshes once, retries once, clears invalid refresh credentials, and
  normalizes the final failure. The provider adapts revisions/data to the
  generic file-provider interface.
- **Unnecessary mechanism / smallest change:** call the API directly from the
  five provider methods and delete `_withTokenRefresh()`, `_isTokenError()`, and
  the two token-summary constants. Keep caller-specific data/path handling.
- **Equivalence / invariants / failure modes:** preserve exactly one refresh
  and retry on native/web, no auth-code retry, terminal `AuthFailSPError`, token
  clearing, CAS, and file-not-found behavior. A regression could duplicate a
  write if either owner retries more than once, so verify invocation counts.
- **Evidence and history:** `5089b8d987`/`087b9dd43f` consolidated an older
  recursive provider retry into the bounded wrapper but did not remove the API
  layer that already refreshes and normalizes 401s.
- **Existing work:** no separate issue or non-ancestor implementation found.
- **Required verification:** focused web/native 401 tests count request,
  refresh, and retry calls for read/write operations; revoked refresh token and
  second-401 cases; existing auth-helper/API specs; package typecheck and
  `checkFile`.
- **Estimated delta / benefit:** one production file, roughly −35 to −50 LOC;
  one owner for retry/error normalization.
- **Blast radius / reversibility / risk / confidence:** Dropbox authenticated
  reads/writes; easy revert, medium auth/data risk, reproduced static evidence.
- **Verifiers / disposition / recommendation:** two fresh provider reviewers;
  proposed; pursue only with invocation-count proof.

### B26-C02 — Replace the copied Dropbox metadata model with its used shape

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `dropbox-metadata::unused-sdk-contract`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B26; `c07b640a1538738f5dad4f7a541677f4b6e4358e1a6e9c5fea8386256d8c1c8c`.
- **Domains / category:** B26 primary; C1 public-surface review; overbroad type
  contract.
- **Exact evidence:** `dropbox.model.ts` defines 101 lines of copied SDK
  metadata. Exact repository closure finds `DropboxFileMetadata` only in that
  file, `dropbox-api.ts`, and the `/dropbox` barrel export. Runtime consumers
  read only `meta.rev` at provider `:174,191` and `result.rev/result.size` at API
  `:270,277`; tests assert only revision and upload-size behavior. No app,
  server, test, tool, or package consumer imports the public metadata type.
- **Current responsibility / consumers / formats:** Dropbox responses must
  supply a revision for metadata/download/upload and a numeric upload size for
  truncation detection. Other SDK fields are neither interpreted nor stored.
- **Unnecessary mechanism / smallest change:** define a small internal response
  type containing `rev` and `size`, remove the copied model and unused public
  barrel export, and retain runtime response validation.
- **Equivalence / invariants / failure modes:** network payloads and Dropbox
  wire format stay unchanged; preserve missing-revision errors and uploaded-
  size validation. C1 must confirm the package subpath is not a supported
  external contract before deletion.
- **Evidence and history:** the type moved into the package in `1db67bdc4d` and
  became a tiered export in `00098f52fb`; exact current closure proves no
  repository consumer.
- **Existing work:** none found.
- **Required verification:** C1 export/consumer/package-policy check; package
  build/typecheck; Dropbox metadata/download/upload specs including missing rev
  and wrong size; `checkFile`.
- **Estimated delta / benefit:** remove one 101-line file and one public export,
  add about 4 internal type lines; reduces false API surface.
- **Blast radius / reversibility / risk / confidence:** package type surface and
  Dropbox response typing; easy revert, medium compatibility risk until C1,
  reproduced repository closure.
- **Verifiers / disposition / recommendation:** one package-interface reviewer;
  proposed; pursue if C1 admits removal.

### B26-C03 — Delete unused legacy Dropbox surfaces

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `dropbox-dead-code::check-user-and-file-path-constants`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B26; `b79aa133d567808212c8388d0dcdf11744a734830421c275a6ddb5631c6ecc7b`.
- **Domains / category:** B26 primary; dead endpoint, app constants, and compile
  fixture.
- **Exact evidence:** repository-wide closure finds `DropboxApi.checkUser()`
  only at its declaration (`dropbox-api.ts:318-335`). `DROPBOX_APP_FOLDER`,
  `DROPBOX_SYNC_MAIN_FILE_PATH`, and `DROPBOX_SYNC_ARCHIVE_FILE_PATH` occur only
  in `dropbox.const.ts:5-8`; only `DROPBOX_APP_KEY` is imported by the live
  provider factory. `_unusedCfg` at `dropbox-api.spec.ts:59-60` is the sole use
  of that spec's `DropboxCfg` import and exercises no behavior.
- **Current responsibility / consumers / formats:** authentication readiness is
  determined from stored access/refresh tokens; sync file paths are built by
  the current file-adapter prefix/path layer and the configured Dropbox
  `basePath`.
- **Unnecessary mechanism / smallest change:** remove `checkUser()`, the three
  dead path constants plus their now-unused environment import/prefix, and the
  no-op compile fixture/type import.
- **Equivalence / invariants / failure modes:** do not change app key, provider
  ID, `basePath`, live file-prefix generation, token readiness, or wire paths.
- **Evidence and history:** `checkUser()` moved with the provider in
  `1db67bdc4d`; the path constants date to `0a889cb506` and were left behind by
  later file-adapter routing.
- **Existing work:** none found.
- **Required verification:** repeat direct/dynamic/export closure; package/app
  typecheck, focused Dropbox specs, and `checkFile`.
- **Estimated delta / benefit:** about −25 production and −3 test LOC across
  three files; removes misleading legacy entry points.
- **Blast radius / reversibility / risk / confidence:** internal Dropbox API and
  dead app constants; easy revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one provider reviewer;
  proposed; pursue.

### B26-C04 — Make the Dropbox auth-code result non-nullable

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `dropbox-oauth::impossible-null-result`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B26; `4ed2b1b58a0a3ec90c010e407169673f53273c5a19a741d562127e8590387035`.
- **Domains / category:** B26 primary; OAuth contract simplification.
- **Exact evidence:** `DropboxApi.getTokensFromAuthCode()` declares an object-
  or-null result at `dropbox-api.ts:458-466`, but every success branch returns
  the token object at `:548-553` and every failure throws at `:554-562`.
  Consequently the provider guard/error at `dropbox.ts:341-344` is unreachable.
  Focused web/native specs exercise success and thrown failures but no null.
- **Current responsibility / consumers / formats:** one-shot OAuth exchange
  yields a validated access token, refresh token, and expiry or rejects.
- **Unnecessary mechanism / smallest change:** remove `| null` from the return
  type and delete the impossible caller guard.
- **Equivalence / invariants / failure modes:** preserve one-shot exchange,
  PKCE cache clearing after success, platform-specific transport, validation,
  and error propagation.
- **Evidence and history:** both nullable signature and guard arrived with the
  package move in `1db67bdc4d`; no null-producing branch exists in current or
  historical closure.
- **Existing work:** none found.
- **Required verification:** existing web/native auth-code success/failure and
  auth-helper specs, package typecheck, and `checkFile`.
- **Estimated delta / benefit:** about −4 production LOC; a truthful OAuth
  contract and one fewer impossible state.
- **Blast radius / reversibility / risk / confidence:** internal OAuth typing;
  easy revert, low behavioral risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one provider-auth reviewer;
  proposed; fold into a nearby Dropbox cleanup rather than schedule alone.

### B24-C01 — Stop emitting the unused split-snapshot provider revision

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `file-envelope::snapshot-ref-rev::write-only-best-effort-pointer`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B24; `cf913de82a25563c2f0e4961998ef066590a0b8dda8be5cd3594dc0735dc922a`.
- **Domains / category:** B24 primary; B23, B25–B27, C1, and C3 related;
  write-only optional remote-envelope metadata.
- **Exact evidence:** `file-based-sync-data.ts:90-109` exports optional
  `FileBasedSnapshotRef.rev`; `file-based.ts:1-10` publishes it. The adapter
  captures a forced state upload's revision at
  `file-based-sync-adapter.service.ts:1460-1488` and writes it during migration
  (`:1873-1883`), compaction (`:2141-2160`), and snapshot upload
  (`:2585-2596`). Snapshot validation at `:1574-1582` compares only
  `syncVersion` and an EQUAL vector clock; exhaustive `snapshotRef` closure
  finds no revision read. Spec values at `:3118,3338,3471,3505` are unread
  fixtures.
- **Current responsibility / consumers / formats:** the field places a provider
  revision inside encrypted v3 `sync-ops.json`. Actual concurrency control uses
  the ops/main-file revision passed to conditional `uploadFile`; snapshot
  identity uses `snapshotRef.file`, and recovery validates version/clock then
  falls back to fixed-state and `.bak`. The v2 envelope has no such field.
- **Unnecessary mechanism / smallest change:** make `_writeStateFile` await the
  forced upload without returning its revision and stop emitting `rev` in the
  three v3 producers. Retain deprecated optional `rev?` in the public type and
  a legacy fixture so existing files and typed consumers remain readable; do
  not bump or migrate the format.
- **Equivalence / invariants / failure modes:** preserve `snapshotRef.file`,
  syncVersion/vector-clock equality, immutable snapshot-before-ops order,
  fixed-state old-client copy, migration/tombstone order, backups,
  encryption/prefix checks, conditional ops CAS, mismatch retries, and pending-
  revision promotion only after durable apply.
- **Evidence and history:** exact closure finds three writers and no reader.
  `eca816a68c` introduced optional `rev?` and the writers without a consumer;
  `f75346613d` later added immutable file pointers but still no reader.
- **Existing work:** A5-R06 retains both live formats; A6-PW-010/provider-
  contract work does not track this exact field.
- **Required verification:** decode legacy refs with/without `rev`; assert new
  migration, compaction, and snapshot-upload envelopes omit it; rerun snapshot
  mismatch/backup, immutable preference, migration crash/race, ops-CAS,
  cancellation/pending-baseline, and provider-contract cases; focused tests and
  `checkFile`.
- **Estimated delta / benefit:** about −8 to −12 production LOC with small
  characterization additions; removes a false format invariant.
- **Blast radius / reversibility / risk / confidence:** two production files
  plus spec; compatibly different remote bytes, easy revert, sync-critical
  medium validation, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh file-format/CAS
  reviewers; proposed; pursue, serialized with B24-C02.

### B24-C02 — Give v2 and v3 download-gap policy one owner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `file-download-gap::v2-v3-copied-causal-policy`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B24; `4825cc496283c7f4c8d62330636dcb294e5701f0da72d705e872b20d1790862e`.
- **Domains / category:** B24 primary; B10, B11, and C3 related; duplicated
  sync-critical state-transition policy.
- **Exact evidence:** single-file download independently computes causal
  syncVersion regression, EQUAL-only cosmetic reset, snapshot replacement,
  `oldestOpSyncVersion > sinceSeq + 1`, and aggregate gap at adapter
  `:932-1039`; split download repeats it at `:2363-2395`. Both then stage
  baselines (`:1041-1046,2397-2399`) and return the whole cursorless buffer
  (`:1048-1100,2401-2432`). The parity matrix is repeated in the adapter spec
  at `:959-1011,1987-2140,2246-2325,3280-3350`.
- **Current responsibility / consumers / formats:** `gapDetected` makes
  `OperationLogDownloadService` reset to sequence zero at `:180-250`; the v2
  embedded state or v3 referenced snapshot is hydrated before the durable
  cursor advances. A false negative can omit compacted operations.
- **Duplicate or unnecessary mechanism / smallest change:** extract one private
  pure gap-analysis helper over the shared header, last-seen clock,
  cursor/client inputs, and a branch-supplied snapshot-present boolean. Return
  component flags plus aggregate result; leave all I/O, v2 warnings, split
  snapshot loading/validation, op projection, and pending revision staging in
  their current branches.
- **Equivalence / invariants / failure modes:** pass `!!syncData.state` for v2
  and the mandatory snapshot-ref condition for v3. Preserve EQUAL as the only
  cosmetic regression, gap behavior for GREATER_THAN/LESS_THAN/CONCURRENT,
  contiguous oldest-op boundary, legacy missing `sv`, fresh sequence zero, own
  empty snapshot, invalid-v3 gap, whole-buffer semantics, and durable-apply
  promotion. Do not alter bytes, CAS, migrations, backups, or crash order.
- **Evidence and history:** blame ties the single policy to `7f953aae0f` and the
  split copy to `eca816a68c`. The latter duplicated an already-fixed
  `EQUAL || GREATER_THAN` bug; `610ca64894` later repaired only that fork and
  documents copy drift as a silent-divergence risk.
- **Existing work:** A6-PW-007/open umbrella `#8759` track broader god-object
  decomposition, not this bounded policy seam. Do not widen into M-13.
- **Required verification:** table-characterize both modes across all four
  vector relations, own/other snapshot replacement, trim below/at/above
  `sinceSeq + 1`, missing `sv`, and sequence zero. Preserve 600-op whole-buffer,
  v3 invalid/ref-backup fallback, `snapshotAppliedOpIds`, cancelled apply, and
  file-sync convergence/compaction integrations; focused tests and `checkFile`.
- **Estimated delta / benefit:** about −25 to −45 production LOC net; one
  causal policy and no duplicated parity obligation.
- **Blast radius / reversibility / risk / confidence:** one production service
  and spec, no format/API change; easy revert, sync-critical high validation,
  reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh multi-client/file-
  sync reviewers; proposed; pursue as a standalone change.

### B30-C01 — Shrink the credential-store port to its live operations

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `credential-store::unused-clear-and-change-hooks`; proposed; merge with
  B23-C03 at D1.
- **Baseline / origin / revision hash:** `9b448133…`; B30; `f86d1f2767ea734ad1895f718750ac19bdf89b60f43f93ef28c3caa51492b93c`.
- **Domains / category:** B30 primary; B23 related; dead package/app contract.
- **Exact evidence:** `credential-store-port.ts:1-13` requires `clear()` and
  optionally exposes `onConfigChange()`. Exact production closure finds no
  `clear()` call on a credential store and no callback registration. The only
  concrete calls are direct app specs at
  `credential-store.service.spec.ts:88-99,116-127`; structural mocks implement
  both solely to satisfy the port. The concrete callback field/method/dispatch
  are at service `:67,73-78,308-314`; `clear()` is at `:170-187`. Provider-
  configuration invalidation already travels through ProviderManager's live
  config-change stream, while provider-specific `clearAuthCredentials()` uses
  `setComplete()` to preserve encryption state and typed secrets.
- **Current responsibility / consumers / formats:** live consumers load,
  replace, strictly update, or upsert provider configuration. OAuth credential
  deletion is provider-specific; legacy migration is owned by the app store.
- **Unnecessary mechanism / smallest change:** remove `clear()`,
  `CredentialChangeHandler`, and `onConfigChange()` from the package port/barrel;
  remove their app implementation, direct tests, and mock members. Coordinate
  with B23-C03 rather than landing two overlapping changes.
- **Equivalence / invariants / failure modes:** preserve `load`, `setComplete`,
  `updatePartial`, `upsertPartial`, IndexedDB migration/cache, provider-manager
  notifications, automatic wrapped-adapter invalidation, and per-provider auth
  clearing. Never replace safe token clearing with whole-record deletion.
- **Evidence and history:** both unused hooks entered the new package port in
  `a97a15457b`; the app callback originated in `082d363b55`. Exact current
  direct/dynamic/structural closure finds no production consumer.
- **Existing work:** B23-C03 proves the app callback half and intentionally
  deferred the published port half to B30.
- **Required verification:** repeat symbol/export/structural closure; focused
  credential-store/migration/provider-manager/wrapped-provider specs; compile
  every provider/test mock; package/app typechecks and `checkFile`.
- **Estimated delta / benefit:** roughly −35 to −50 production/test/helper LOC;
  one smaller credential contract with no destructive false affordance.
- **Blast radius / reversibility / risk / confidence:** package port, app store,
  and mocks; easy revert, low runtime but medium interface risk, reproduced
  repository closure.
- **Verifiers / disposition / recommendation:** one package/credential reviewer;
  proposed; merge with B23-C03 and pursue after C1.

### B30-C02 — Remove the unconsumed public provider-log subpath

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-providers-exports::test-only-log-subpath`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B30; `21b9b07314d627c9f8d850aeff38f8e94ad3596fcc2a010308f555ac62b0c905`.
- **Domains / category:** B30 primary; C1 public-surface review; stale package
  export/build configuration.
- **Exact evidence:** `package.json` publishes `./log`, `tsup.config.ts` builds
  `src/log.ts`, and root/spec/Electron tsconfigs map the subpath. Exact import
  closure finds no app, Electron, server, E2E, plugin, or other package consumer
  of `@sp/sync-providers/log`. The only test imports the source barrel relatively
  (`tests/log/error-meta.spec.ts:2`); package implementations import the internal
  `log/error-meta` module directly.
- **Current responsibility / consumers / formats:** `errorMeta`, `urlPathOnly`,
  and `urlHostOnly` remain internal provider logging helpers with direct tests.
  No runtime API or persisted/wire format requires a public log entry point.
- **Unnecessary mechanism / smallest change:** delete the `./log` package export,
  tsup entry, three tsconfig aliases, and one-line `src/log.ts`; point its test
  directly at the internal module.
- **Equivalence / invariants / failure modes:** internal helper behavior,
  privacy tests, and all provider imports remain unchanged. Because the package
  is not marked private, C1 must confirm publication/consumer policy before a
  breaking subpath removal.
- **Evidence and history:** `3bb07fc6d0` added the subpath solely when the test
  was changed to import built output. `49ac0ca823` later moved that test back to
  source but left the export, build entry, and aliases behind.
- **Existing work:** `6797e9eed2` previously removed the unused root barrel and
  47 unused sync-core exports using the same focused-subpath policy.
- **Required verification:** C1 package-consumer/publish check; exact import
  closure; package build/typecheck/tests, root/spec/Electron typechecks, export-
  map smoke check, and `checkFile` for touched TypeScript.
- **Estimated delta / benefit:** remove one public subpath and about 15–20
  config/barrel lines; fewer supported/build artifacts.
- **Blast radius / reversibility / risk / confidence:** package export map and
  build config; easy revert, medium external-compatibility risk until C1,
  reproduced monorepo closure.
- **Verifiers / disposition / recommendation:** one package-boundary reviewer;
  proposed; pursue if C1 confirms no supported external consumer.

### B30-C03 — Stop exposing PKCE verifier as an auth-readiness flag

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `provider-auth-helper::redundant-code-verifier-output`; proposed, subject to
  C1.
- **Baseline / origin / revision hash:** `9b448133…`; B30; `1332a9cd374bfcb26bb324809650c31804e00c97c51db60994111c903c88aa6b`.
- **Domains / category:** B30 primary; B23/B26/B27 related; redundant OAuth
  interface field.
- **Exact evidence:** `SyncProviderAuthHelper.codeVerifier` is declared at
  `provider-types.ts:6-14`. Dropbox and OneDrive return it, but both
  `verifyCodeChallenge` closures capture the verifier internally. The sole app
  production read is a truthiness gate in `sync-wrapper.service.ts:1122-1124`;
  the value is never passed back or otherwise used. Direct Dropbox tests inspect
  it only to infer cache rotation. If verifier generation fails,
  `getAuthHelper()` rejects before returning, so the extra readiness flag cannot
  represent a distinct live state.
- **Current responsibility / consumers / formats:** the host needs an auth URL
  and a callback that exchanges a pasted code. Provider closures own PKCE
  verifier lifetime, pairing, retry/reset, and token transport.
- **Unnecessary mechanism / smallest change:** remove `codeVerifier` from the
  public helper and provider return objects; gate the dialog on `authUrl` plus
  `verifyCodeChallenge`; assert cache pairing/rotation through generated URLs
  and exchange requests rather than exposing verifier bytes.
- **Equivalence / invariants / failure modes:** preserve Dropbox promise-cache
  semantics, OneDrive state/PKCE validation, manual/Electron flows, one-shot
  exchange, and failure propagation. Do not move verifier state into the app.
- **Evidence and history:** the field predates extraction and was carried into
  the package by `a97a15457b`/`6797e9eed2`; current closure proves it is only a
  redundant gate plus direct-test observation.
- **Existing work:** related to B23-C01 OAuth UI cleanup and B26-C04 contract
  tightening but does not overlap their code.
- **Required verification:** C1 interface check; Dropbox cache concurrency/
  rejection/success/clear cases through behavior, OneDrive state/exchange,
  sync-wrapper auth success/error/cancel, package/app typechecks, and
  `checkFile`.
- **Estimated delta / benefit:** about −5 production/interface lines plus test
  rewrites; smaller auth contract and less verifier exposure.
- **Blast radius / reversibility / risk / confidence:** provider package and
  sync-wrapper OAuth path; easy revert, medium auth/interface risk, reproduced
  confidence.
- **Verifiers / disposition / recommendation:** one fresh OAuth/interface
  reviewer; proposed; pursue only after C1.

### B30-C04 — Table-drive provider retry-classifier specifications

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `provider-tests::retry-classifier-case-tables`; proposed for C6.
- **Baseline / origin / revision hash:** `9b448133…`; B30; `38eac966b43dd48a255ef7883766f5312b26b17cd50d5fa8f30808ab41081684`.
- **Domains / category:** B30 primary; C6 test-duplication review; mechanical
  test simplification.
- **Exact evidence:** the first 204 lines of
  `native-http-retry.spec.ts` repeat the same one-call boolean assertion across
  iOS/Android code, fallback-text, and negative inputs. The 161-line
  `retryable-upload-error.spec.ts` repeats the same assertion across retryable
  and permanent strings, often several per test. The execution retry/budget/log
  cases after native spec line 206 are distinct and should remain imperative.
- **Current responsibility / consumers / formats:** the tests pin every native
  code and English fallback phrase, case behavior, false positive boundary,
  retryable upload phrase/status, and op-graph negative control.
- **Unnecessary mechanism / smallest change:** convert classifier-only examples
  to named `it.each` tables with one row per existing input/expected result.
  Keep execution-order, delay, call-count, default, and privacy assertions
  unchanged; delete the unused `NOOP_TEST_LOGGER` helper export/comment while in
  the test-helper surface.
- **Equivalence / invariants / failure modes:** preserve every literal case and
  individually named failure output. Do not merge the two production
  classifiers: they intentionally answer native transport versus upload-policy
  questions.
- **Evidence and history:** both suites grew case-by-case across
  `1cbc6335dc`, `058f92e972`, `24a691bed5`, `a2509cb8ac`, and `54dbc683a8`;
  the duplication is test syntax, not duplicated production semantics.
- **Existing work:** no table conversion found; `087b9dd43f` already used a
  table for error-class identity in the neighboring spec.
- **Required verification:** before/after case-name and literal inventory;
  focused package specs/typecheck and `checkFile`.
- **Estimated delta / benefit:** two spec files, roughly −120 to −180 test LOC;
  easier addition/review of classifier cases without scenario loss.
- **Blast radius / reversibility / risk / confidence:** tests/helpers only;
  easy revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one test-quality reviewer;
  proposed; hand to C6.

### B31-C01 — Remove the app migration wrapper's dead compatibility and inspection APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `schema-migration-app::dead-alias-and-inspection-api`; proposed, subject to
  C1.
- **Baseline / origin / revision hash:** `9b448133…`; B31; `c9bfc97077dd33d622dadf034d1fe27d3f23b98763cfbafa1f5468c24fd02017`.
- **Domains / category:** B31 primary; C1 public-surface review; dead app
  service surface.
- **Exact evidence:** `schema-migration.service.ts:141-143` retains deprecated
  `migrateIfNeeded()` as a direct alias for `migrateStateIfNeeded()`, while
  `:277-285` exposes `getMigrations()` and imports the registry solely for that
  inspection method. Exact repository closure finds both methods only in their
  direct service spec at `schema-migration.service.spec.ts:52-63,215-222`.
  The associated `SchemaMigration` re-export at service `:22` has no production
  consumer. In contrast, `migrateStateIfNeeded`, `migrateOperation`,
  `migrateOperations`, `needsMigration`, `operationNeedsMigration`, and
  `getCurrentVersion` all have live app consumers or enforce migration startup
  behavior.
- **Current responsibility / consumers / formats:** the service adapts generic
  shared migrations to the app's full `Operation` metadata and startup cache
  shape. It must preserve order, split/drop behavior, operation IDs and clocks,
  and the current/minimum schema gates.
- **Unnecessary mechanism / smallest change:** delete the deprecated alias,
  inspection-only registry method, unused type re-export/import, and their
  direct tests. Do not alter the live migration adapter or shared registry.
- **Equivalence / invariants / failure modes:** no persisted or wire shape
  changes. Preserve constructor registry validation, forward-version rejection,
  state migration, and full-operation metadata merging. C1 must confirm that
  this injectable app service is not treated as a supported external/plugin API.
- **Evidence and history:** the wrapper methods entered together in
  `082d363b55`; exact direct, barrel, dynamic, test, and structural searches
  reproduce that only their defining spec remains.
- **Existing work:** no exact issue or active implementation found. This is
  independent of retaining every historical migration and compatibility
  barrier.
- **Required verification:** C1 consumer/API check; repeat symbol and type
  closure; focused schema-migration service and shared-schema migration tests;
  app typecheck and `checkFile` for touched TypeScript.
- **Estimated delta / benefit:** roughly −20 to −30 production/test LOC; a
  smaller service API with no registry inspection escape hatch.
- **Blast radius / reversibility / risk / confidence:** one app service and
  spec; easy revert, low runtime and medium interface risk, reproduced
  repository closure.
- **Verifiers / disposition / recommendation:** one package/app-boundary
  reviewer; proposed; pursue if C1 confirms the surface is internal.

### B31-C02 — Narrow shared-schema exports to the migration primitives actually consumed

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `shared-schema-api::unused-batch-inspection-exports`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B31; `337d8373e0b6799119d16aa5da204b396f9d01b35b15aa1f965aa33d2bce9023`.
- **Domains / category:** B31 primary; C1 public-surface review; unused package
  API and duplicate adapter.
- **Exact evidence:** `src/index.ts:12-28` publicly exports
  `MigratableStateCache`, `migrateOperations`, `getCurrentSchemaVersion`, and
  `MIGRATIONS`. Exact monorepo closure finds `getCurrentSchemaVersion()` and the
  generic batch `migrateOperations()` only in `tests/migrate.spec.ts`; the app
  uses its own metadata-preserving batch adapter. The shared
  `MigratableStateCache` interface has no consumer, while the app has a distinct
  live cache shape with sequence, vector-clock, and compaction metadata. The
  public registry is consumed by the app only through B31-C01's test-only
  inspection API; migration internals and dedicated migration specs can import
  it internally. The generic batch function's `droppedCount` at
  `migrate.ts:219-231` is accumulated but absent from the returned result.
- **Current responsibility / consumers / formats:** shared-schema owns current
  and minimum versions, the sequential migration engine, migration types,
  operation/state primitives, registry validation, and SuperSync HTTP schemas.
  Those live primitives remain exported.
- **Unnecessary mechanism / smallest change:** after C1, stop exporting and
  delete the unused version getter, generic batch adapter, and shared cache
  shape; make the registry internal rather than a public barrel export. Retain
  single-state/single-operation migration and validation functions and all
  historical migration definitions.
- **Equivalence / invariants / failure modes:** no schema number, migration
  path, entity allowlist, persisted data, or HTTP contract changes. The package
  is publishable, so repository non-use alone is insufficient; any supported
  external consumer makes this candidate reject or decision-required.
- **Evidence and history:** `8dc8207da2` introduced these package conveniences
  during extraction. Current direct, barrel, package-alias, dynamic, plugin,
  server, app, and test closure finds no live monorepo consumer beyond the
  noted tests and B31-C01 surface.
- **Existing work:** earlier package cleanup `6797e9eed2` removed other unused
  sync exports, but no exact current issue or implementation covers these
  members.
- **Required verification:** C1 publication/consumer check; package export and
  declaration diff; all shared-schema and app migration tests; package build,
  package/app/server typechecks, and `checkFile` for touched TypeScript.
- **Estimated delta / benefit:** roughly −45 to −70 production/test/type LOC;
  one canonical app batch adapter and a smaller supported package surface.
- **Blast radius / reversibility / risk / confidence:** shared package barrel,
  engine, types, tests, and app import; easy source revert but potentially
  breaking externally, medium compatibility risk, supported confidence pending
  C1.
- **Verifiers / disposition / recommendation:** one fresh package-compatibility
  reviewer; proposed; admit only if C1 proves the exports unsupported.

### B31-C03 — Delete migration tests that never exercise the real engine

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `shared-schema-tests::vacuous-mock-and-duplicate-cases`; proposed for C6.
- **Baseline / origin / revision hash:** `9b448133…`; B31; `f8cd87dcfc2ef57ec2edcc45afbb23dc71005fe9ca14c5417edc509169bcd8e2`.
- **Domains / category:** B31 primary; C6 test-duplication review; vacuous and
  duplicate tests.
- **Exact evidence:** `tests/migrate.spec.ts:120-128,235-243` guards missing-
  path/registry assertions behind conditions that are false for the current
  complete registry, so those branches execute no expectation. Lines 246-373
  instantiate local mock `SchemaMigration` objects and call their callbacks
  directly; they do not pass those mocks through the real registry or migration
  engine. The project-delete crossing case at `:131-151` duplicates the
  dedicated v3→v4 barrier suite, which exercises the actual registered
  migration.
- **Current responsibility / consumers / formats:** the package tests must pin
  sequential registry validity, real v1 settings/entity/action migration,
  split/drop semantics, both compatibility barriers, and forward/current
  version behavior.
- **Unnecessary mechanism / smallest change:** remove only the false-conditional
  cases, self-testing mock callbacks, and duplicate barrier example. Keep the
  real engine/registry tests and every dedicated historical migration suite; do
  not add a production registry-injection seam solely to make the vacuous tests
  executable.
- **Equivalence / invariants / failure modes:** tests only. Preserve direct
  coverage of target-wins state merging, setting-field mapping, operation ID
  derivation, multi-entity handling, delete-wins/LWW barriers, and registry
  startup validation. C6 must compare assertion/scenario inventories rather
  than accept raw LOC reduction.
- **Evidence and history:** the mock block arrived with the extracted package
  in `8dc8207da2`; the dedicated project-delete suite was later strengthened in
  `8e810edbe7` and `aa09b09b0a`. Static control-flow inspection reproduces the
  unreachable expectations.
- **Existing work:** no exact issue or pending test cleanup found.
- **Required verification:** C6 before/after scenario and assertion inventory;
  run the complete shared-schema suite plus app schema-migration specs; package
  typecheck and `checkFile` for the touched spec.
- **Estimated delta / benefit:** one spec, roughly −120 to −150 test LOC; tests
  describe the real supported migration paths instead of locally invented
  callbacks.
- **Blast radius / reversibility / risk / confidence:** tests only; easy revert,
  low runtime but medium compatibility-regression risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one test/migration reviewer;
  proposed; hand to C6 and reject if inventory exposes a unique real invariant.

### B27-C01 — Remove the abandoned LocalFile directory-probe API

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `local-file::dead-directory-probe-ipc`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B27; `345fcbddb15ae3b223d820a96d3918d9cebc8fce114f042a3ca3791a527c2161`.
- **Domains / category:** B27 primary; B30/B35 related; dead provider port and
  Electron IPC surface.
- **Exact evidence:** `file-adapter.ts:5` declares `checkDirExists`; Android SAF
  implements/tests it at `saf-file-adapter.ts:48-52` and spec `:127-155`.
  Electron carries the same method through `electronAPI.d.ts:59,102`,
  `preload.ts:60`, `ipc-events.const.ts:48`, and
  `local-file-sync.ts:232-261` with direct tests at `:234-243`. Whole-repository
  call closure finds declarations, transport plumbing, and those tests only—no
  production caller. Renderer readiness instead uses the main-owned
  `getMainSyncFolderPath()` flow.
- **Current responsibility / consumers / formats:** main-process LocalFile code
  owns folder selection, validation, safe relative-path resolution, and file
  operations. Android SAF owns URI permission validation. No serialized sync
  format depends on this probe.
- **Unnecessary mechanism / smallest change:** remove `checkDirExists` from the
  provider port, SAF adapter, Electron API/preload/IPC/handler, and direct tests;
  update the stale resolver comment. Preserve list/read/write/delete and folder-
  selection behavior.
- **Equivalence / invariants / failure modes:** preserve main-process path
  authority, traversal/symlink/`userData` rejection, root-cache race protection,
  safe IPC errors, and Android permission checks. C1 must confirm no supported
  external Electron client invokes the IPC name.
- **Evidence and history:** `552b25074d` introduced the active probe;
  `e4f9a4e2e5` moved it during extraction; `0c21649fde` removed the last
  provider/factory caller for `#8228` but left the plumbing. Non-ancestor
  `6da578aa8d` still retains it and overlaps the Electron handler/spec, so a
  future implementation must rebase carefully.
- **Existing work:** no exact open item or implementation found; `#8228` is the
  historical caller-removal context, not current cleanup authorization.
- **Required verification:** C1 port/IPC compatibility check; exact computed and
  string IPC closure; focused provider/SAF/Electron specs; Electron and app
  typechecks/build; `local-file-sync.test.cjs`; `checkFile` for touched TS.
- **Estimated delta / benefit:** roughly −70 to −80 production/test/bridge LOC;
  one fewer cross-process capability and provider-port obligation.
- **Blast radius / reversibility / risk / confidence:** package port, Android
  adapter, and Electron IPC; easy source revert, low runtime but medium
  interface risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh Electron/provider-
  boundary reviewer; proposed; pursue after C1.

### B27-C02 — Remove the unused Android SAF file-existence bridge

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `android-saf::unused-check-file-exists-bridge`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B27; `20904d39f607e0b378cda95bc6bc2a6b8799964b36ba765f4b7d86db5eade5b3`.
- **Domains / category:** B27 primary; B35 related; unused native bridge ABI.
- **Exact evidence:** `saf.service.ts:19-22,42-44,104-116` declares a web stub
  and wrapper for `checkFileExists`; `SafBridgePlugin.kt:188-210` implements the
  Capacitor method. Exact repository search finds no caller and no direct test.
  Live SAF flows use read/write/delete plus permission and folder validation.
- **Current responsibility / consumers / formats:** the same-bundle Angular app
  calls the registered native plugin for document-tree operations. The method
  is not part of sync persistence or wire data.
- **Unnecessary mechanism / smallest change:** delete only the TypeScript
  interface/stub/wrapper and Kotlin method. Keep native plugin registration and
  every live file/permission operation.
- **Equivalence / invariants / failure modes:** no current app call changes.
  Before removal, C1 must establish that old/hot-updated JavaScript cannot run
  against a newer native bundle and that the bridge is not a supported plugin
  API; otherwise reject or require a deprecation decision.
- **Evidence and history:** `ea2ca8e622` introduced the complete bridge during
  the original SAF outline; Git and current-universe closure find no consumer
  since introduction.
- **Existing work:** no exact issue or pending implementation found.
- **Required verification:** C1 native-ABI/bundle policy; string and bridge
  closure; Android compile/tests, app typecheck, focused SAF tests, and
  `checkFile` for touched TypeScript.
- **Estimated delta / benefit:** roughly −40 to −45 production/native LOC; a
  smaller native attack and maintenance surface.
- **Blast radius / reversibility / risk / confidence:** Android plugin and app
  bridge; source-reversible but release-compatibility-sensitive, medium risk,
  reproduced repository confidence.
- **Verifiers / disposition / recommendation:** one fresh Android/compatibility
  reviewer; proposed; decision-required unless C1 proves same-bundle-only use.

### B27-C03 — Stop injecting unused platform information into OneDrive

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `onedrive-deps::unused-platform-info`; proposed, subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B27; `2631dabb61f98e01ae45326565690f3625bf3f708c8256a254080c99f4236fdf`.
- **Domains / category:** B27 primary; B30 related; redundant exported
  dependency field.
- **Exact evidence:** `onedrive.ts:27` declares `platformInfo` in
  `OneDriveDeps`; the app factory supplies it at its OneDrive adapter
  `:9,31`, and the package spec mocks it at `:40-44`. Exact member closure finds
  no `_deps.platformInfo` read in the provider and no behavioral test using its
  value.
- **Current responsibility / consumers / formats:** `OneDriveDeps` supplies the
  live fetch, credential-store, logger, OAuth callback, random/crypto, and
  environment seams. Platform information has no current branch or payload role.
- **Unnecessary mechanism / smallest change:** remove only `platformInfo` from
  the exported dependency interface, app factory, and test fixture. Do not
  combine it with other nullable client-ID or platform-policy changes.
- **Equivalence / invariants / failure modes:** preserve PKCE/state, redirect
  selection, refresh deduplication, Graph-host checks, CAS, pagination, and
  error mapping. Because the dependency type is exported, C1 must check external
  construction and excess-property compatibility.
- **Evidence and history:** extraction commit `9910d30fca` introduced the
  dependency field; no later read or rationale appears in history.
- **Existing work:** B30 owns the provider-package public-surface decision; no
  exact issue or implementation found.
- **Required verification:** C1 package-consumer check; exact member/structural
  closure; OneDrive package/app specs and typechecks; `checkFile`.
- **Estimated delta / benefit:** about −5 to −10 LOC; a more truthful dependency
  contract.
- **Blast radius / reversibility / risk / confidence:** exported interface plus
  app/test construction; easy revert, low runtime and medium source-
  compatibility risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one package-interface reviewer;
  proposed; pursue only if C1 confirms the construction API is internal.

### B27-C04 — Delete the app-local OneDrive type-forwarding shim

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `onedrive-app::type-forwarding-shim`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B27; `f06beefb69d4812494c6a7ab347da48d70f92a6e9c12d7eb12f18f65f67c71ef`.
- **Domains / category:** B27 primary; redundant app boundary.
- **Exact evidence:** app `onedrive.model.ts:1-6` only reexports package types.
  Its only live type is `OneDrivePrivateCfg`, imported by the app OneDrive spec
  and sync-config dialog; the forwarded `OneDriveItem`, `OneDriveListResponse`,
  and `OneDriveTokenResponse` have no app consumer. The app factory's additional
  type reexport at `onedrive.ts:24` also has no consumer.
- **Current responsibility / consumers / formats:** the package barrel already
  owns and exports these provider types; two app consumers need one private-
  config type for static checking only.
- **Unnecessary mechanism / smallest change:** import `OneDrivePrivateCfg`
  directly from `@sp/sync-providers/onedrive`, delete the forwarding file and
  unused factory reexport. Leave the package barrel and runtime behavior alone.
- **Equivalence / invariants / failure modes:** type/import topology only; no
  token, credential, configuration, provider ID, or serialized shape changes.
  Repeat closure to avoid deleting an indirect test import.
- **Evidence and history:** `9910d30fca` created the forwarding layers during
  extraction; exact direct/barrel/import closure finds no later consumer.
- **Existing work:** no exact issue or implementation found.
- **Required verification:** exact import/export closure; sync-config and
  OneDrive focused specs; app typecheck and `checkFile`.
- **Estimated delta / benefit:** delete one six-line file and one unused export,
  with two import rewrites; one fewer false app ownership layer.
- **Blast radius / reversibility / risk / confidence:** app types only; easy
  revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one boundary reviewer;
  proposed; pursue as a small independent cleanup.

### B27-C05 — Remove behavior-identical OneDrive error-mapper branches

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `onedrive-errors::unreachable-and-pass-through-branches`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B27; `df19836bce1cd765769a919ddb048241e71c0d6c9d7709affe13bd4f92c62c68`.
- **Domains / category:** B27 primary; code simplification without behavior
  change.
- **Exact evidence:** package `onedrive.ts:177,205,247` has fallback throws
  immediately after `_mapAndThrow(...): never`; branches at `:778-783` rethrow
  `RemoteFileNotFoundAPIError` and `AuthFailSPError` identically to the final
  `throw error` at `:803`. The parsed Graph `message` fields at `:741,847` are
  never read; mapping consumes only `code`.
- **Current responsibility / consumers / formats:** the mapper normalizes Graph
  statuses/codes into auth, not-found, conflict, rate-limit, and transient
  errors while preserving sanitized provider diagnostics.
- **Unnecessary mechanism / smallest change:** remove the three unreachable
  fallback throws, two behavior-identical pass-through branches, and unused
  parsed message fields. Keep named token/response wrappers and every status/
  code mapping.
- **Equivalence / invariants / failure modes:** thrown object identity and all
  mapped errors must remain byte-for-byte equivalent for 401/403/404/409/412/
  429 and transient cases. Do not broaden this into error-policy redesign or
  remove redaction boundaries.
- **Evidence and history:** the redundant paths date to `9910d30fca`; exact
  control-flow/member closure finds no distinct side effect or later rationale.
- **Existing work:** no exact issue or implementation found.
- **Required verification:** focused OneDrive mapping cases for every retained
  status/code and object-identity pass-through; package typecheck/tests and
  `checkFile`.
- **Estimated delta / benefit:** roughly −10 to −15 production LOC; one linear
  mapper with fewer unreachable explanations.
- **Blast radius / reversibility / risk / confidence:** one provider file and
  spec; easy revert, low behavior risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one OneDrive/error reviewer;
  proposed; pursue independently.

### B25-C01 — Remove the caller cache header already owned by the WebDAV adapter

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `webdav-upload-verify::caller-cache-header-duplicates-platform-adapter`;
  proposed; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B25; `da2265c4d825cc452da0b950b60e978b902fbf2ca7ff247a31c3518255525ae1`.
- **Domains / category:** B25 primary; B23–B30 provider-duplication evidence;
  duplicate platform policy and CORS surface.
- **Exact evidence:** `webdav-api.ts:350-387`, specifically `:355-361`, adds
  `Cache-Control: no-cache` only to the post-upload verification GET.
  `webdav-http-adapter.ts:45-62` explicitly makes cache policy an adapter
  responsibility because caller `Cache-Control` is not CORS-safelisted. Native
  requests overwrite it with `no-cache, no-store` plus `Pragma` at `:92-111`;
  browser/Electron requests use fetch `cache: 'no-store'` at `:117-131`.
  Adapter specs pin both platform policies at `:67-115`.
- **Current responsibility / consumers / formats:** `_verifyUpload()` re-GETs
  the just-written file, rejects empty/HTML responses, hashes the content, and
  returns the verified revision. Its only caller is `upload()` at API `:331`.
- **Unnecessary mechanism / smallest change:** remove only the caller `headers`
  object at API `:358-360`; keep the verification GET and every validation/hash
  check. The platform adapter remains the sole freshness owner.
- **Equivalence / invariants / failure modes:** native behavior is unchanged
  because the stronger header overwrites the caller value; web freshness remains
  `cache: 'no-store'` while an avoidable non-safelisted header disappears.
  Preserve strong-ETag `If-Match`, create-only `If-None-Match: *`, hash fallback,
  PUT→GET verification, 412 mapping, and mismatch retry. Stale verification can
  lose data, so two fresh reviewers remain mandatory despite the tiny diff.
- **Evidence and history:** `e571cc2433` added the explicit verification header
  before `5aea4b0143` centralized native headers and browser cache mode; the
  later change left this earlier caller override behind.
- **Existing work:** no exact current issue or implementation found. The fast-
  track B23–B30 provider review supplies the C5 ownership evidence.
- **Required verification:** assert the verification GET supplies no caller
  cache header; retain native/web adapter cache tests; package test/build and
  `checkFile`; focused rapid/conflict WebDAV E2E. Two fresh sync/provider
  reviewers must independently check proxy freshness and CORS behavior.
- **Estimated delta / benefit:** about −3 production LOC plus one focused
  assertion; one cache-policy owner and fewer browser deployment constraints.
- **Blast radius / reversibility / risk / confidence:** one internal API call;
  easy revert, sync-critical validation risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh sync/provider
  reviewers; proposed; pursue as an isolated change.

### B25-C02 — Remove the unused WebDAV listing and structural metadata slice

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `webdav-read-surface::unused-listing-metadata-dom-parser`; decision-required,
  subject to C1.
- **Baseline / origin / revision hash:** `9b448133…`; B25; `7722334603a43ce752dd7bd3059b4c4eeeb737c584e0ef380553d7d3d93aa4ad`.
- **Domains / category:** B25 primary; B24/B30 related; unused protocol/parser
  surface with public-provider compatibility risk.
- **Exact evidence:** the concrete provider's only listing method is
  `webdav-base-provider.ts:181-185`; internal listing/metadata live at
  `webdav-api.ts:80-163`; structural DOM types/traversal and multi-property
  parsers are `webdav-xml-parser.ts:4-115,187-320`. Exact repository closure
  finds no production invocation of WebDAV `listFiles()` and no call to
  `getFileMeta()`. `parseMultiplePropsFromXml` is then used only by those two
  methods and direct specs; `DOMParser/@xmldom` is used only by this parser and
  `tests/setup-dom-parser.ts`. Live sync reads GET bodies/content hashes.
- **Current responsibility / consumers / formats:** API/adapter/parser internals
  are intentionally unexported, but `WebdavBaseProvider` and `Webdav` are public
  through the `/webdav` package subpath, so their concrete `listFiles()` method
  is observable to an external package consumer. The generic optional
  `FileSyncProvider.listFiles` remains live for other providers and Android SAF.
- **Unnecessary mechanism / smallest change:** only after C1 approval, delete
  WebDAV provider/API listing, dead `getFileMeta`, structural response parser/
  `FileMeta`, their direct tests, and the then-unused DOMParser test setup and
  package-local dependency. Keep `PROPFIND_XML` for connection probing and keep
  response-content validation for download/upload verification.
- **Equivalence / invariants / failure modes:** the current app has no caller,
  and its CAS/revision behavior would not change. An external host may call the
  concrete method, and B24's immutable-snapshot deletion design may later choose
  listing, so repository silence is insufficient. If retained, fix rather than
  preserve its impossible 404 mock: the adapter throws
  `RemoteFileNotFoundAPIError`, but API `:113-120` catches only
  `HttpNotOkAPIError(404)`.
- **Evidence and history:** `553f944c39` added `listFiles()` during a compile
  repair. `946339a035` replaced header/PROPFIND revision tracking with content
  hashing and reduced metadata use but left listing. `087b9dd43f` deliberately
  kept generic listing optional.
- **Existing work:** B30-R02 retains the generic contract; B24 routes possible
  snapshot cleanup through a future provider decision. No exact removal issue
  or implementation was found.
- **Required verification:** C1 publication/consumer and deprecation decision;
  repeat direct/string/dynamic/export closure; prove no admitted deletion design
  needs it; package tests/build/typecheck and full/rapid/conflict WebDAV E2E.
- **Estimated delta / benefit:** roughly −330 production LOC and −330 to −380
  test/config LOC; removes a protocol/parser/polyfill surface unused by the app.
- **Blast radius / reversibility / risk / confidence:** package API plus WebDAV
  internals/tests; easy source revert but externally breaking, medium-high
  compatibility risk, reproduced in-repo confidence.
- **Verifiers / disposition / recommendation:** one fresh package/WebDAV
  compatibility reviewer; decision-required; admit only with positive C1 proof.

### B25-C03 — Finish removal of obsolete conditional WebDAV reads

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `webdav-http-status::reintroduced-conditional-download-304-path`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B25; `ca0d1102745af6675c6e511ff5adb1462e878a3b13827b8769f2d7c070d806e9`.
- **Domains / category:** B25 primary; C1 related; obsolete HTTP branch and
  occurrence-one constants.
- **Exact evidence:** `webdav-http-adapter.ts:296-323` uniquely passes status
  304 through; `webdav.const.ts:4-17` defines `NOT_MODIFIED`, used only by that
  branch and its direct spec at `:165-181`. No read sends `If-None-Match` or
  `If-Modified-Since`; the remaining `IF_NONE_MATCH` is PUT create-only at
  `webdav-api.ts:260`. `CREATED`, `NO_CONTENT`, and `CONTENT_LENGTH` occur only
  at their declarations.
- **Current responsibility / consumers / formats:** supported reads return full
  bodies; strong ETags are write preconditions, not read cache validators. A
  passed-through 304 has an empty body and downstream download/verification
  rejects it rather than representing “unchanged.”
- **Unnecessary mechanism / smallest change:** route unexpected 304 through the
  normal `HttpNotOkAPIError` path, using a null-body `Response` because platform
  constructors forbid bodies for status 304; delete the pass-through test and
  occurrence-one constants. Do not alter supported 2xx handling.
- **Equivalence / invariants / failure modes:** current supported requests do not
  generate 304. An unexpected response fails earlier and consistently instead
  of later as empty/corrupt content. Preserve 401/404/429 normalization, native
  redaction, CORS classification, 412 CAS behavior, and cache policy. A naive
  non-null-body error construction would throw a different `TypeError`.
- **Evidence and history:** `c9e6bba64a` explicitly removed conditional request
  parameters and 304 handling; `914122f134` reintroduced the adapter branch and
  constant during package extraction without a read validator.
- **Existing work:** no exact issue or implementation found.
- **Required verification:** replace pass-through coverage with a native 304
  rejection test asserting status and no constructor `TypeError`; all adapter/
  API specs, package test/build/typecheck, and `checkFile`.
- **Estimated delta / benefit:** about −8 to −15 production and −10 to −15 test
  LOC; removes a misleading unsupported capability.
- **Blast radius / reversibility / risk / confidence:** internal HTTP adapter and
  constants; easy revert, low-medium transport risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh WebDAV transport
  reviewer; proposed; pursue independently.

### B37-C01 — Delete the entity-registry lint rule that cannot inspect the registry

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `entity-registry-lint::unreachable-registry-check`; already-tracked; merge
  with B01-C01 at D1.
- **Baseline / origin / revision hash:** `9b448133…`; B37; `6e522a8a7756292a27892c422e5ce1faa4f54345217213b3fec5ab5732044641`.
- **Domains / category:** B37 primary; B01 related; dead lint mechanism and
  false enforcement signal.
- **Exact evidence:** `require-entity-registry.js:135-166` can check completeness
  only when a variable named `ENTITY_CONFIGS` is initialized directly with an
  object literal. The real registry is `ENTITY_CONFIGS = buildEntityRegistry()`
  at `entity-registry.ts:350`, so that branch cannot inspect it. ESLint scopes
  the rule only to `**/*.effects.ts` at `eslint.config.js:214-225`, excluding the
  registry file entirely. Exact effects-file search finds no literal
  `entityType` properties or entity-type switch cases for its remaining typo
  visitors. The 224-line rule has no spec.
- **Current responsibility / consumers / formats:** real completeness is pinned
  by the entity-registry specs and runtime consumers; B01-C01 proposes compiler-
  enforced app-host completeness while retaining generic partial registries.
- **Unnecessary mechanism / smallest change:** land with B01-C01, then remove the
  rule file, local-rule export/config entry, and claims that it is an executable
  invariant. Do not replace it with a broader heuristic or a production test
  seam.
- **Equivalence / invariants / failure modes:** no runtime or format change.
  Compiler-owned key exhaustiveness plus retained behavioral registry tests must
  cover normal entities while excluding `ALL`, `RECOVERY`, and `MIGRATION`.
  Removing it without the B01 replacement would reduce false confidence but not
  improve enforcement, so D1 should merge the candidates.
- **Evidence and history:** `58372626f1` introduced the rule with the registry;
  `19796204f30` later placed it in the effects-only block. Current control-flow,
  scope, and literal-use searches reproduce that it reports nothing relevant.
- **Existing work:** open `#8752` already tracks the dead rule; B01-C01 provides
  the bounded compile-time replacement.
- **Required verification:** merge/dedupe with B01-C01; run lint RuleTester suite,
  full lint/typecheck, entity-registry/LWW/conflict specs, and `checkFile` on
  changed TypeScript.
- **Estimated delta / benefit:** about −230 JavaScript/config/comment LOC plus
  B01's net test reduction; eliminates a false safety claim.
- **Blast radius / reversibility / risk / confidence:** lint configuration and a
  sync-critical registry invariant; easy revert, medium validation risk,
  reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh registry/enforcement
  reviewer; already-tracked; merge with B01-C01 rather than admit separately.

### B37-C02 — Remove the orphaned patch-package install hook

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `root-dependencies::orphaned-patch-package`; already-tracked.
- **Baseline / origin / revision hash:** `9b448133…`; B37; `7e60582b3b1566b3b227b00cc6f53927c5d4ce902592d68ff6ebd3cc4e9977d3`.
- **Domains / category:** B37 primary; dead dependency and install-time code
  execution.
- **Exact evidence:** root `package.json:25,301` runs and depends on
  `patch-package`, while no `patches/` directory exists. Exact repository search
  finds no other invocation. The package and its dependency tree remain in
  `package-lock.json:22255-22375`, so every install executes an empty hook and
  installs unused tooling.
- **Current responsibility / consumers / formats:** the tool previously applied
  a checked-in Android dependency patch. No build, runtime, provider, persisted,
  or wire format currently consumes it.
- **Unnecessary mechanism / smallest change:** remove the `postinstall` script,
  root dev dependency, and regenerated lockfile entries. Do not add a replacement
  hook or retain an empty placeholder for hypothetical future patches.
- **Equivalence / invariants / failure modes:** current install output and built
  artifacts should be identical. Verify package lifecycle scripts still run
  `prepare` where intended; a hidden/untracked local patch is not repository
  behavior and must not justify a permanent dependency.
- **Evidence and history:** `5497212b99` added the tool for one Android patch;
  `c247bc541a` removed that last patch after it caused device behavior regressions
  but left the hook and dependency.
- **Existing work:** architecture quick-win issue `#8843` already tracks this
  exact cleanup.
- **Required verification:** regenerate the lockfile with the pinned npm version;
  clean `npm ci`, prepare/package builds, Android dependency resolution, root
  lint/tests, and diff the installed lifecycle output.
- **Estimated delta / benefit:** two manifest lines plus the lockfile dependency
  subtree; one less install-time executable and supply-chain surface.
- **Blast radius / reversibility / risk / confidence:** root installation only;
  easy revert, low runtime and low-medium build risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one build/dependency reviewer;
  already-tracked; pursue through `#8843`.

### B37-C03 — Delete npm-ignored Yarn resolutions

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `root-dependencies::ignored-yarn-resolutions`; already-tracked.
- **Baseline / origin / revision hash:** `9b448133…`; B37; `f379548b02339855ad92ed781639a854321abddf082ef8613146896a724661c3`.
- **Domains / category:** B37 primary; dead package-manager configuration.
- **Exact evidence:** `package.json:177-180` declares Yarn-style `resolutions`
  for Sass 1.32.6 and `@ctrl/tinycolor` 4.1.0, while the repository declares
  `packageManager: npm@11.18.0` and uses npm `overrides` at `:320-343` for live
  constraints. The npm lock installs Sass 1.97.3 and top-level tinycolor 4.2.0,
  directly proving the two resolutions do not control this installation.
- **Current responsibility / consumers / formats:** dependency constraints are
  owned by package ranges, npm overrides, and the lockfile. No runtime or sync
  format reads the `resolutions` object.
- **Unnecessary mechanism / smallest change:** delete only the four-line
  `resolutions` object. Do not translate stale pins into live npm overrides
  without a separately reproduced compatibility need.
- **Equivalence / invariants / failure modes:** npm resolution and lockfile are
  unchanged. If Yarn is still a supported undocumented package manager, this is
  a policy decision; repository metadata, commands, Volta, CI, and lockfile all
  identify npm.
- **Evidence and history:** the block predates npm workspaces; its two pins were
  last touched in 2025 and are contradicted by the current npm lock.
- **Existing work:** architecture quick-win issue `#8843` includes this exact
  dead configuration.
- **Required verification:** clean install with pinned npm, dependency-tree diff,
  root/package builds, lint, and tests; confirm no documented Yarn support.
- **Estimated delta / benefit:** −4 manifest LOC; removes misleading constraints
  that currently provide no protection.
- **Blast radius / reversibility / risk / confidence:** package metadata only;
  immediate revert, low npm risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one build/dependency reviewer;
  already-tracked; pursue with B37-C02 but keep the rationale distinct.

### B37-C04 — Reuse the existing E2E setup action in the main CI test job

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `ci-e2e-setup::main-job-copy`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B37; `01316455324c4280dfe4ac34f3b5b389f56e832909f60a978a12f3f0e2bd8167`.
- **Domains / category:** B37 primary; duplicated CI setup.
- **Exact evidence:** `ci.yml:81-109` manually repeats Node 22 setup, Git HTTPS
  rewriting, npm-cache discovery/action, `npm i`, and Playwright browser/system-
  dependency installation. `.github/actions/setup-e2e/action.yml:1-55` owns the
  same sequence, cache keys, and purpose, adds bounded retry for Prisma download
  failures, and is already used seven times by scheduled and PR sync workflows.
  The main CI test job still predates that composite action.
- **Current responsibility / consumers / formats:** checkout remains job-local;
  the composite action owns only reusable toolchain/install/browser setup. Test,
  environment generation, i18n, Electron, unit, build-output, E2E, and artifact
  steps remain in `ci.yml`.
- **Unnecessary mechanism / smallest change:** after checkout, replace only the
  duplicated setup block with `uses: ./.github/actions/setup-e2e`. Do not create
  another workflow or generalize Electron/release setup.
- **Equivalence / invariants / failure modes:** preserve Node 22, Git URL rewrite,
  npm and Playwright cache keys, browser plus OS dependencies, and checkout
  credentials. The action's retry changes only transient-install handling; pin
  action revisions and ensure local-action checkout precedes invocation.
- **Evidence and history:** the CI block dates to `9a22232e597`; the reusable
  action was introduced days later by `c0387f12d2` and hardened in
  `7eeea37b7a`, but the older job was never migrated.
- **Existing work:** no exact issue or pending implementation found.
- **Required verification:** workflow syntax/actionlint equivalent, compare
  resolved steps and cache keys, then a full main CI test-job run including E2E
  and failure artifact upload.
- **Estimated delta / benefit:** about −20 to −25 workflow LOC; one maintained
  E2E setup path and consistent install retry behavior.
- **Blast radius / reversibility / risk / confidence:** one CI job and existing
  composite action; easy revert, low-medium pipeline risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one CI reviewer; proposed;
  pursue as an isolated workflow cleanup.

### B28-C01 — Collapse the app validator bridge into its port-shaped object

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-validation::double-validator-adapter`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B28; `581287a4719da627e9d8aec1c005d81482323f314dbd3d78e7db514ea1962f1e`.
- **Domains / category:** B28 primary; C1 related; structural duplication at
  the app/package boundary.
- **Exact evidence:** app `response-validators.ts:41-130` owns schema parsing and
  exports six validator functions. App factory `super-sync.ts:14-21,54-61`
  imports all six, renames every member, and reconstructs the exact six-member
  `SuperSyncResponseValidators` port declared at package
  `response-validators.ts:9-27`. Exact import/name closure finds only that
  factory and the co-located validator spec as app-wrapper consumers.
- **Current responsibility / consumers / formats:** shared-schema validation
  intentionally stays in the app because sync-providers may not import the
  domain schema; the package consumes an injected port. These functions validate
  wire responses and strip unsupported legacy fields.
- **Unnecessary mechanism / smallest change:** export one app-side
  `SUPER_SYNC_RESPONSE_VALIDATORS` object typed as the package port and pass it
  directly. Keep `parseResponse` and the six schema-specific functions private;
  do not move shared-schema across the package boundary.
- **Equivalence / invariants / failure modes:** preserve every schema, response
  label, `InvalidDataSPError` identity/detail, passthrough field, and deliberate
  `snapshotState` stripping. A missing member would weaken a sync input boundary,
  so the typed object and focused invalid-response cases remain required.
- **Evidence and history:** `c40feef6d2` introduced the validator port during
  extraction but retained the older individually named app exports and one-hop
  remapping.
- **Existing work:** distinct from completed A6-PW-001; do not revive its broad
  HTTP/provider/cache proposals.
- **Required verification:** exact export/import closure; focused app validator
  and package SuperSync specs; invalid label/detail and `snapshotState`
  assertions; app/package typechecks and `checkFile`.
- **Estimated delta / benefit:** about −25 to −35 production LOC; one typed
  boundary object and no six-member renaming layer.
- **Blast radius / reversibility / risk / confidence:** two app files and a
  focused spec; easy revert, sync-input medium risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh validation/provider
  reviewers; proposed; pursue independently.

### B28-C02 — Remove the superseded intentional-close flag

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-websocket::intentional-close-duplicate-state`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B28; `86cc9bc836fdb09dc2b698f571fa5c99d5b0861630ba48a6cd6fa3f65aa3336c`.
- **Domains / category:** B28 primary; C1/C3 related; redundant WebSocket
  lifecycle state.
- **Exact evidence:** `super-sync-websocket.service.ts:49-57,78-104,183-216,
  255-293` maintains `_isIntentionalClose`, while `disconnect()` already nulls
  `_currentParams`, increments `_connectGeneration`, clears the reconnect timer,
  and nulls `_ws`. Event handlers reject stale sockets by identity;
  `_scheduleReconnect()` and its timer callback separately require current
  params.
- **Current responsibility / consumers / formats:** the private flag originally
  prevented reconnect after client close. Later generation, params, timer, and
  socket-identity state now own the same lifecycle; no persisted/wire field uses
  it.
- **Unnecessary mechanism / smallest change:** after characterizing synchronous
  close callbacks, delete the flag, set/reset writes, and three branch terms.
  Keep params nulling, generation invalidation, timer cancellation, and identity
  checks as the sole authority.
- **Equivalence / invariants / failure modes:** a synchronous `onclose` during
  `disconnect()` must be stopped by null params; an async callback is stale after
  `_ws = null`; replaced sockets fail identity; in-flight connects fail
  generation. Preserve close-code 4003/4008/4009 policies, backoff/jitter,
  heartbeat, and same-params promise sharing. A missed interleaving can reconnect
  forever.
- **Evidence and history:** initial WebSocket commit `7fa8f12132` added the flag;
  `8dd188b054` later added generation, promise, and identity hardening without
  removing it; `1661579aed` added terminal code 4009.
- **Existing work:** no exact issue or current implementation found.
- **Required verification:** synchronous-close characterization; pending timer,
  repeated disconnect, params replacement, stale close, concurrent connect,
  all terminal codes, backoff cap, and heartbeat cases; focused spec and
  `checkFile`.
- **Estimated delta / benefit:** about −7 production LOC with a small
  characterization addition; one fewer lifecycle state owner.
- **Blast radius / reversibility / risk / confidence:** one service/spec; easy
  revert, WebSocket lifecycle medium risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh WebSocket/sync
  reviewers; proposed; admit only after the synchronous callback case passes.

### B28-C03 — Sanitize WebSocket errors before exportable logging

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-diagnostics::raw-websocket-error-and-reason`; proposed for C8; privacy
  hardening, not simplification benefit.
- **Baseline / origin / revision hash:** `9b448133…`; B28; `3aab82a0f96195288147cf8fe717ddde4952d0bce2bc9464409c665cb54bd775`.
- **Domains / category:** B28 primary; B13/B16/C8 related; privacy-safe
  diagnostic boundary.
- **Exact evidence:** WebSocket service `:98-100,148-150,177-180,187-189,
  248-251,287-290,311-315` logs raw caught errors and server-controlled close
  reasons. WS-triggered download `:302-325` and the immediate wrapper connection
  catch `sync-wrapper.service.ts:681-691` also log raw errors. `core/log.ts:54-71,
  123-158,238-280,364-369` serializes error messages/stacks into exportable
  history; the existing sync-core sanitizer retains only error identity/code.
- **Current responsibility / consumers / formats:** raw exceptions remain
  necessary for UI classification/control flow, but raw server text, URLs,
  operation-derived text, and stacks are not necessary in exported diagnostics.
- **Unnecessary mechanism / smallest change:** omit close reason and replace raw
  logged objects/messages only in this bounded path with existing allowlisted
  error metadata. Retain safe close code, error name/code, attempt count, and
  fixed context. Do not alter throws, catches, UI, or retry decisions.
- **Equivalence / invariants / failure modes:** connection generation, terminal
  codes, heartbeat, queue, auth stop, recovery, and reupload stay identical.
  Canary tests must prove secrets/user text/message/stack are absent from both
  JSON and text exports while safe diagnostic categories remain.
- **Evidence and history:** raw logging dates to `7fa8f12132`/`8dd188b054` and
  later recovery changes; the newer sync logger contract explicitly rejects raw
  provider responses, credentials, and user text.
- **Existing work:** merge with C8 and adjacent B16-C05; include the B13 wrapper
  catch so the immediate boundary is complete.
- **Required verification:** canary close/reconnect/auth/incomplete/generic
  errors; export both log forms; focused WebSocket/download/wrapper/logger specs
  and `checkFile`.
- **Estimated delta / benefit:** production neutral to +15 and tests +25 to +50
  LOC; privacy benefit only, no claimed simplification delta.
- **Blast radius / reversibility / risk / confidence:** diagnostics across three
  services; reversible but privacy-critical, medium risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh privacy/sync
  reviewers; proposed; route to C8 rather than score as LOC reduction.

### B28-C04 — Table-drive the SuperSync status truth table and timer boundaries

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-status-tests::repeated-truth-table-and-expiry-setup`; proposed for
  C6.
- **Baseline / origin / revision hash:** `9b448133…`; B28; `f7b6e0854d16352ad1516fd47406c9e5fd2376d373ef2a768e79223ed6b91ac8`.
- **Domains / category:** B28 primary; C6 test-only duplication.
- **Exact evidence:** `super-sync-status.service.spec.ts:15-158` repeats the same
  two-boolean truth table, order, idempotence, reset, and pending setup. Lines
  160-267 repeat clock/service setup and call `forceRecompute()` even though the
  expiry callback itself changes `_hasRecentRemoteCheck` at service `:50-62`.
- **Current responsibility / consumers / formats:** the spec pins the UI status
  rule: no pending operations AND a remote check fresh for 60,000 ms. It has no
  production export or format impact.
- **Unnecessary mechanism / smallest change:** express initial/AND/order/pending/
  reset cases as an action table and expiry/refresh cases as a clock table;
  remove dependency-toggling `forceRecompute()`. Preserve descriptive row names.
- **Equivalence / invariants / failure modes:** preserve false initial state,
  both call orders, idempotent refresh, pending reversion, `clearScope()` timer
  cancellation/reset, true at 59,999 ms, false at 60,000 ms, and refreshed
  expiry. Keep fake-clock cleanup isolated per case.
- **Evidence and history:** `6b04bc6d7c` removed a polling timer and simplified
  the service; `40def4a576` later added the repeated all-provider status cases.
- **Existing work:** no exact current finding; suitable for C6.
- **Required verification:** map every old expectation to a named row; focused
  Jasmine clock spec and `checkFile`.
- **Estimated delta / benefit:** about −100 to −140 test LOC; unchanged behavior
  with easier boundary review.
- **Blast radius / reversibility / risk / confidence:** one spec only; trivial
  revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh test-quality reviewer;
  proposed; hand to C6.

### B32-C01 — Centralize server conflict-type to wire-code mapping

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-upload-conflict-code::three-path-wire-mapping`; proposed; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B32; `4c0ade0074e3907ab956236842e3a1a5864557e805dbc8eaf8b63ecf826a28dd`.
- **Domains / category:** B32 primary; repeated server conflict policy.
- **Exact evidence:** `operation-upload.service.ts:524-529,785-790,821-825`
  repeats the same mapping in batch, serial initial-check, and serial final-check
  paths: `concurrent` and `equal_different_client` become
  `CONFLICT_CONCURRENT`; `superseded`, `unknown`, or missing type becomes
  `CONFLICT_SUPERSEDED`.
- **Current responsibility / consumers / formats:** these wire codes select the
  client's conflict-recovery path; rejection order, existing clock, audit
  metadata, and transaction behavior remain path-specific.
- **Unnecessary mechanism / smallest change:** one private/module-local
  `conflictErrorCode()` with the exact fail-closed default, called at all three
  sites. Do not merge upload paths or move conflict checks.
- **Equivalence / invariants / failure modes:** all four type states must map
  byte-identically; unknown stays superseded. Preserve messages, clocks, audit
  rows, serial final recheck, batch semantics, and transaction ordering.
- **Evidence and history:** non-ancestor reviewed commit `c8fc1ea03d` introduced
  this exact helper, but merged squash `2d9988dd73` did not retain it; frozen
  HEAD and master still contain all three copies.
- **Existing work:** no live audit packet duplicates it.
- **Required verification:** helper truth table; serial and `batchUpload: true`
  conflict specs; server typecheck/test suite; two fresh multi-client reviewers.
- **Estimated delta / benefit:** about −4 to −8 production LOC; one conflict-
  recovery code policy.
- **Blast radius / reversibility / risk / confidence:** one server service;
  easy revert, sync-critical wire behavior, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh server/client conflict
  reviewers; proposed; pursue using the previously reviewed semantics.

### B32-C02 — Reuse the vector-clock storage-pruning helper on the serial path

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-upload-prune::serial-inline-vs-shared-helper`; proposed; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B32; `5ff4b204c8d8188912cd868dd4c6678c6e0a4336d8974d0acd96e636391fefe3`.
- **Domains / category:** B32 primary; duplicate load-bearing clock boundary.
- **Exact evidence:** `conflict.ts:581-590` defines
  `pruneVectorClockForStorage()`, used by the batch path at upload service `:542`;
  serial upload repeats it inline at `:838-852`, including preserved client,
  before/after size, and debug message.
- **Current responsibility / consumers / formats:** both paths must compare full
  clocks first, then prune immediately before payload sizing/storage while
  retaining the uploading client.
- **Unnecessary mechanism / smallest change:** replace serial `:845-852` with
  the shared helper, remove the unused direct limiter import, and retain the
  ordering rationale next to the call.
- **Equivalence / invariants / failure modes:** same field mutation, preserve key,
  limit, and log. Never move pruning before either conflict check; that ordering
  regression caused the `#6434` infinite conflict loop.
- **Evidence and history:** `fdc942babb` established compare-before-prune;
  batch extraction introduced the helper while leaving the serial copy.
- **Existing work:** no exact implementation found on frozen/master.
- **Required verification:** helper unit; serial MAX/MAX+1 and equivalent batch
  persistence cases; full server typecheck/tests and two fresh vector-clock
  reviewers.
- **Estimated delta / benefit:** about −7 production LOC; one load-bearing
  storage-pruning implementation.
- **Blast radius / reversibility / risk / confidence:** one server service and
  helper; easy revert, sync-critical, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh conflict/vector-clock
  reviewers; proposed; pursue independently.

### B32-C03 — Use canonical full-state and deduplicated entity helpers in conflict detection

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-conflict-entry::duplicate-full-state-and-entity-normalization`;
  proposed; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B32; `1273dda2d495ef94179127b9d626085725fb4f35ff28278ad05dbcd04a033f26`.
- **Domains / category:** B32 primary; duplicate conflict-entry normalization.
- **Exact evidence:** `conflict.ts:28-34` explicitly compares the three full-
  state operation types despite already importing/using `isFullStateOpType()`;
  `:39-63` renames and wraps entity IDs in another `Set`, while
  `getConflictEntityIds()` already deduplicates at `:413-421`. Shared schema's
  canonical snapshot list is exactly SYNC_IMPORT, BACKUP_IMPORT, and REPAIR.
- **Current responsibility / consumers / formats:** entry normalization selects
  conflict bypass and database query shapes, including the historical per-key
  `GLOBAL_CONFIG:misc → tasks` compatibility alias.
- **Unnecessary mechanism / smallest change:** use `isFullStateOpType(op.opType)`,
  name the first result `entityIdsToCheck`, and pass it directly. Preserve the
  legacy alias branch and canonical helpers.
- **Equivalence / invariants / failure modes:** current set membership and
  order-preserving dedupe are identical. Empty/single/multi entity behavior,
  full-state bypass, query planning, and legacy aliasing must not change.
- **Evidence and history:** `c8fc1ea03d` previously removed the redundant entity
  normalization before decomposition; later alias work `e019ef0b71f` retained
  the old naming/second dedupe.
- **Existing work:** no exact live implementation on frozen/master.
- **Required verification:** full-state, empty/single/multi entity, legacy alias,
  both upload modes, and PGlite/PostgreSQL `#8334` coverage; two fresh conflict
  reviewers.
- **Estimated delta / benefit:** about −5 to −7 production LOC; one canonical
  definition for both concepts.
- **Blast radius / reversibility / risk / confidence:** conflict entry point;
  easy revert, sync-critical query risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh server-conflict
  reviewers; proposed; pursue opportunistically after B32-C01/C02.

### B32-C04 — Share piggyback loading between cached and normal upload responses

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-upload-piggyback::cached-normal-result-fetch-duplication`; proposed;
  sync-critical, characterization-required.
- **Baseline / origin / revision hash:** `9b448133…`; B32; `b5a4710ea0948798eed374fafcedd9ddd730da284516fd205fdada0cb9748041`.
- **Domains / category:** B32 primary; duplicated cursor/result assembly.
- **Exact evidence:** `sync.routes.ops-handler.ts:135-169,258-296` independently
  sets limit 500, calls `getOpsSinceWithSeq(..., false)`, obtains latest sequence
  when no cursor is returned, and computes `hasMorePiggyback` for cached retry
  and normal upload responses. Commit `064c2452ca` had to update both copies in
  lockstep.
- **Current responsibility / consumers / formats:** retry responses must fetch
  fresh remote ops at the retry request's current cursor; normal responses also
  notify WebSocket clients. Both deliberately exclude snapshot metadata.
- **Unnecessary mechanism / smallest change:** a local non-caching helper
  returning `{ newOps, latestSeq, hasMorePiggyback }`, invoked at the same two
  points. Keep branch-specific logging, `deduplicated`, WebSocket notification,
  quota ordering, and response construction separate.
- **Equivalence / invariants / failure modes:** never reuse the original cached
  result; retain current `lastKnownServerSeq`, the `false` snapshot argument,
  latest seq with zero returned ops, and quota/read order. A cursor error can
  permanently hide remote operations.
- **Evidence and history:** `5f9d73c37c` added fresh retry piggybacking;
  `064c2452ca` added `hasMorePiggyback` twice. Current tests cover current-cursor
  retry and the `false` argument but not exactly-limit versus over-limit parity.
- **Existing work:** no exact current implementation found.
- **Required verification:** first add limit and limit+1 cases for both response
  paths; retain retry-cursor, zero-op latest-seq, quota, WebSocket, and cached
  dedupe cases; server typecheck/tests; two fresh multi-client reviewers.
- **Estimated delta / benefit:** about −20 to −30 production LOC; one cursor and
  `hasMore` policy.
- **Blast radius / reversibility / risk / confidence:** upload response handler;
  easy revert, sync-critical, supported confidence pending boundary tests.
- **Verifiers / disposition / recommendation:** two fresh server/client sync
  reviewers; proposed; admit only after both missing boundaries are pinned.

### B29-C01 — Inline the two single-boolean download planners

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `download-planning::single-boolean-wrapper::gap-and-encryption-state`;
  proposed, decision-required public API.
- **Baseline / origin / revision hash:** `9b448133…`; B29; `fbe5f8277a97c259a67f9bf2ed8c5a7f74245cc8cdcc38d3c53fcf85c3e3a661`.
- **Domains / category:** B29 primary; one-consumer wrapper/public surface.
- **Exact evidence:** `packages/sync-core/src/download-planning.ts:4-23,102-118`
  wraps `!!gapDetected && !hasResetForGap` and
  `sawAnyOps && !sawEncryptedOp`; root barrel `src/index.ts:105-108` exports
  both; their only repository callers are in
  `operation-log-download.service.ts`. Focused wrapper tests are at
  `tests/download-planning.spec.ts:9-21,91-109`.
- **Current responsibility / consumers / formats:** the booleans trigger one-
  time gap reset and downloaded-data encryption-state persistence. Full-state,
  regular-op split, and snapshot planners are separate and retained.
- **Unnecessary mechanism / smallest change:** restore the two expressions at
  their sole app caller; remove only these functions, exports, and wrapper-only
  tests. Commit `610fbc1c75` extracted the same expressions without changing
  their policy.
- **Equivalence / invariants / failure modes:** expressions stay byte-for-byte
  equivalent; preserve one reset per session, observed-op aggregation, and all
  persistent/wire/action shapes.
- **Evidence and history:** mechanical import closure found one app caller for
  each function. The upload path still independently uses the equivalent
  encryption-mismatch boolean.
- **Existing work:** no current implementation found; no duplicate live packet.
- **Required verification:** public-consumer/semver closure; sync-core build and
  focused spec; gap-reset and encryption-mismatch integration cases.
- **Estimated delta / benefit:** about −38 to −45 production LOC and −26 to −32
  test LOC; less package and test ceremony for two expressions.
- **Blast radius / reversibility / risk / confidence:** app plus root package
  API; easy revert, runtime low but external-consumer risk medium, reproduced
  repository confidence only.
- **Verifiers / disposition / recommendation:** fresh API and sync reviewers;
  proposed, decision-required until out-of-tree consumer or breaking-change
  authority is resolved.

### B29-C02 — Remove redundant fields from the upload sequence plan

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `upload-sequence-plan::duplicate-derived-fields::single-seq-reason`;
  proposed, decision-required public result shape.
- **Baseline / origin / revision hash:** `9b448133…`; B29; `20230055db01bb3a041f216122399fa10a2b26e9591b7c544c7f9f783509753f`.
- **Domains / category:** B29 primary; redundant planner result fields.
- **Exact evidence:** `packages/sync-core/src/upload-planning.ts:73-77,88-121`
  guarantees `seqToStore === highestReceivedSeq` in every branch and echoes
  `hasMorePiggyback`, which is also represented by `reason`; the sole repository
  caller consumes all three at `operation-log-upload.service.ts:522-545`.
- **Current responsibility / consumers / formats:** the plan chooses the
  persisted highest server sequence and explains whether more piggybacked ops
  remain. It is exported from a package that is not marked private.
- **Unnecessary mechanism / smallest change:** return only `{ seqToStore,
  reason }`; let the caller use `seqToStore` for both aggregate and persistence,
  and the original response flag or reason for its OR condition.
- **Equivalence / invariants / failure modes:** highest received/persisted
  sequence and every reason remain identical. Never advance past an unreceived
  operation or drop the `hasMore` aggregate.
- **Evidence and history:** the redundant shape originated in `3c06157324`;
  tests at `tests/upload-planning.spec.ts:77-125` restate all fields.
- **Existing work:** no exact current implementation found.
- **Required verification:** public-consumer/semver closure; sync-core build and
  upload-planning tests; focused upload integration.
- **Estimated delta / benefit:** about −8 to −14 production/test LOC; removes
  impossible-field drift, with a small maintenance benefit.
- **Blast radius / reversibility / risk / confidence:** exported inferred result
  shape and one app caller; easy revert, runtime low but API risk medium,
  reproduced repository confidence.
- **Verifiers / disposition / recommendation:** fresh API and upload reviewers;
  proposed, decision-required; do not broaden into a planner-result redesign.

### B29-C03 — Make single-item decrypt use the canonical batch state machine

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `encryption-decrypt::duplicated-single-vs-batch-state-machine::one-batch-path`;
  proposed, characterization-required, sync/security-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B29; `56b458483415ddd03e304a59cae9edea884aaf0461727842080b0f05d85ac491`.
- **Domains / category:** B29 primary; duplicated cryptographic state machine.
- **Exact evidence:** `packages/sync-core/src/encryption.ts:115-156` and
  `:180-297` separately implement format detection, Argon derivation, AES
  decrypt, and legacy fallback. `tests/encryption.spec.ts` covers both paths;
  repository closure finds four `decrypt` and two `decryptBatch` consumers.
- **Current responsibility / consumers / formats:** public `decrypt()` handles
  the Argon `[salt16][iv12][cipher+tag]` layout and legacy
  `[iv12][cipher+tag]`, sharing session caches and cross-platform WebCrypto
  error normalization with batch decryption.
- **Unnecessary mechanism / smallest change:** implement `decrypt(data,
  password)` as the one-element `decryptBatch([data], password)` case and remove
  only the private duplicate Argon helper/path; keep the public signature.
- **Equivalence / invariants / failure modes:** preserve the >=44-byte legacy
  fallback, warnings, session caches, unique-salt batch map, WebCrypto behavior,
  and normalized errors. Allocation, scheduling, error identity, or timing
  differences can break callers even when plaintext matches.
- **Evidence and history:** `1d08cb9bc4` and `087b9dd43f` establish the formats;
  `18cae275f5` fixed >100-unique-salt and password-cache collisions and must not
  regress.
- **Existing work:** no exact current implementation found.
- **Required verification:** first characterize single versus one-item-batch
  outcomes/errors for invalid, long-legacy, wrong-password, and fallback inputs;
  package/browser-WebCrypto/app/cross-platform suites and performance sanity;
  two fresh crypto/sync reviewers.
- **Estimated delta / benefit:** about −35 to −40 production LOC; one security-
  sensitive decryption state machine.
- **Blast radius / reversibility / risk / confidence:** all encrypted sync data;
  easy code revert but high compatibility/security risk, supported confidence
  pending characterization.
- **Verifiers / disposition / recommendation:** two fresh crypto/client sync
  reviewers; proposed for investigation, not direct admission.

### B29-C04 — Remove duplicate sync-import classifier cases

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-import-filter-spec::exact-boundary-case-duplicates::single-core-owner`;
  proposed, test-only.
- **Baseline / origin / revision hash:** `9b448133…`; B29; `c1b3d10a99f1c681c62ea6a05b6a29942e660851c33d17e7a3f2d7528c923d10`.
- **Domains / category:** B29 primary, B20 overlap; duplicate unit coverage.
- **Exact evidence:** `packages/sync-core/tests/sync-import-filter.spec.ts:53-64`
  duplicates `:207-219`; `:79-90` semantically duplicates `:174-188`, with only
  an irrelevant third-client counter changed.
- **Current responsibility / consumers / formats:** the later cases explicitly
  name the import boundary; distinct GREATER, EQUAL, LESS_THAN, CONCURRENT,
  empty, same-client, different-client, and zero-counter cases remain.
- **Unnecessary mechanism / smallest change:** delete the two earlier terse
  duplicates and update B20-C02's stated classifier-case inventory.
- **Equivalence / invariants / failure modes:** no production behavior changes;
  retain every relation and client-identity boundary. Incorrect inventory could
  conceal a lost predicate case.
- **Evidence and history:** `ba838eccf6` introduced the originals and
  `087b9dd43f` the later hardening cases.
- **Existing work:** overlaps B20-C02 and must be one coordinated test cleanup.
- **Required verification:** retained truth-table inventory, sync-core tests,
  and deliberate predicate perturbation/mutation review.
- **Estimated delta / benefit:** about −24 test LOC; clearer single ownership for
  two boundary cases.
- **Blast radius / reversibility / risk / confidence:** one spec; trivial revert,
  low coverage risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** one fresh test/sync reviewer;
  proposed; merge with B20-C02 during D1.

### B29-C05 — Prune vector-clock comparison restatements

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `vector-clock-spec::scale-only-and-no-flip-duplicates::algebra-contract`;
  proposed, test-only, mutation-gated.
- **Baseline / origin / revision hash:** `9b448133…`; B29; `89f27285d768fbf18c2744df19debef5a287d4e1056ede345b9af73a5b99c289`.
- **Domains / category:** B29 primary; redundant/mislabeled algebra tests.
- **Exact evidence:** `packages/sync-core/tests/vector-clock.spec.ts:78-136`
  repeats the four relations already proved at `:10-76` with 20-key inputs even
  though comparison has no size branch. `:554-578` labels a GREATER→CONCURRENT
  flip but asserts CONCURRENT→CONCURRENT. Genuine cap/tie/preserve/retry and
  actual relation-flip cases remain at `:580-653`.
- **Current responsibility / consumers / formats:** the suite protects clock
  algebra plus the 20-entry pruning boundary and retry protocol.
- **Unnecessary mechanism / smallest change:** after mutation review, delete the
  four scale-only restatements and mislabeled no-flip case; if scale-shaped smoke
  coverage detects a unique fault, retain it and delete only the mislabeled case.
- **Equivalence / invariants / failure modes:** keep all MAX/MAX+1,
  deterministic-tie, preserved-ID, retry, and genuine relation-flip coverage.
- **Evidence and history:** `9fd9d386a87` added the scale cases;
  `087b9dd43f` added the pruning hardening around them.
- **Existing work:** no duplicate live candidate beyond the retained B29 clock
  boundary.
- **Required verification:** sync-core tests, comparison/pruning mutation check,
  and retained-boundary matrix review.
- **Estimated delta / benefit:** up to −80 to −90 test LOC; less noisy algebra
  coverage, or about −25 LOC under the conservative fallback.
- **Blast radius / reversibility / risk / confidence:** tests only; trivial
  revert, low coverage risk, supported confidence conditional on mutation.
- **Verifiers / disposition / recommendation:** fresh vector-clock test
  reviewer; proposed; narrow to only the mislabeled case if the scale block has
  unique fault-detection value.

### B38-C01 — Remove the superseded server `.env.example`

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-env-example::dotfile-vs-production-example::single-authoritative-file`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B38.1; `b7368abb2802006d3fa959d59e2e3d57e3a72cd207b424cddce690947d426afb`.
- **Domains / category:** B38 primary, B34 closure; duplicate deployment config.
- **Exact evidence:** `packages/super-sync-server/.env.example:1-81` and
  `env.example:1-125` both instruct operators to copy themselves to `.env` but
  materially diverge. The package README uses `cp env.example .env` at
  `:43,169`; no package workflow or documentation references the dotted file.
  The dotted file supplies a localhost database URL, enabled preview CORS,
  passkey/privacy values, and uncommented fake GHCR credentials while omitting
  required compose `DOMAIN` and `POSTGRES_PASSWORD`.
- **Current responsibility / consumers / formats:** `env.example` is the live
  production/deploy-script contract; the root `.env.example` used by E2E is a
  different file and remains untouched.
- **Unnecessary mechanism / smallest change:** delete only the package-local
  dotted duplicate; keep live env parsing and the authoritative `env.example`.
- **Equivalence / invariants / failure modes:** no runtime input changes. Preserve
  every supported environment key and ensure all setup instructions still name
  the authoritative file; confusing the root E2E file would break CI.
- **Evidence and history:** dotted-file history stops at `d82754faf2`, while the
  production file received deploy/migration/pool hardening through
  `b83a6745e6`; `6af85b6892` established the README copy command.
- **Existing work:** no exact live candidate found.
- **Required verification:** repository reference closure, deployment-doc link
  check, compose config smoke using `env.example`, and one fresh ops reviewer.
- **Estimated delta / benefit:** −81 configuration/documentation LOC; one
  authoritative server environment template and fewer unsafe copy paths.
- **Blast radius / reversibility / risk / confidence:** setup documentation only;
  trivial revert, low runtime risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh deployment reviewer;
  proposed; pursue independently.

### B38-C02 — Collapse the abandoned LUKS implementation into one decision record

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-encryption-at-rest::abandoned-live-and-archive-snapshots::decision-record`;
  proposed, decision-required operational archive.
- **Baseline / origin / revision hash:** `9b448133…`; B38.1; `36ed9c171bd45b35c7442b1e9d2819f014dd91b05a5748b034a342b24dd7e034`.
- **Domains / category:** B38 primary, B34/C7 closure; retired operational
  implementation and contradictory documentation.
- **Exact evidence:** commit `e050eb99fa` records that LUKS and TDE were
  incompatible with the OpenVZ deployment, moved nine LUKS artifacts under
  `archive/encryption-attempts-openvz-incompatible/`, and chose operation without
  database encryption at rest. Nevertheless,
  `docs/long-term-plans/supersync-encryption-at-rest.md:1-30` says “Planned” and
  reviewed, `packages/super-sync-server/docs/encryption-at-rest.md:1-12` says
  “Production-ready,” and `docs/testing-guide.md` invokes tool paths that were
  moved out of `tools/`. The eleven redundant plan/guide/archive artifacts total
  5,243 LOC before the stale testing guide.
- **Current responsibility / consumers / formats:** none is executed or linked
  from active deploy/build/test automation. The archive README is the only
  decision-history entry and already points to the TDE history commit; active
  `backup-encrypted.sh` and backup/recovery docs are separate and retained.
- **Unnecessary mechanism / smallest change:** keep one short archive decision
  record with origin/hardening commit pointers; delete the archived runnable
  LUKS scripts/runbooks and contradictory active plan/guide; remove or reframe
  the LUKS-only testing guide. Git history remains the source for revival.
- **Equivalence / invariants / failure modes:** no server, migration, database,
  backup, or encryption behavior changes. Do not remove encrypted backups or
  imply that end-to-end payload encryption is absent. A hidden operator using an
  archived script is the principal external-process risk.
- **Evidence and history:** phase commits `cb2e2e65a2` and `c8bce3c8cf` contain
  the complete implementation; `e050eb99fa` is the explicit retirement record.
  Repository search finds no consumer outside the archived/contradictory docs.
- **Existing work:** A6-PW-013 retains encryption-at-rest as a conditional future
  capability; this candidate removes abandoned snapshots, not the future option.
- **Required verification:** explicit ops-owner approval; full docs/link check;
  search for private runbook consumers; fresh security/operations review of the
  retained decision record and backup distinction.
- **Estimated delta / benefit:** roughly −5,000 documentation/script LOC; one
  truthful operational status and no apparently runnable retired tooling.
- **Blast radius / reversibility / risk / confidence:** repository docs/archive;
  recoverable from history, no runtime path, but medium operational-consumer
  risk; reproduced repository confidence only.
- **Verifiers / disposition / recommendation:** fresh security and operations
  reviewers; proposed, decision-required before deleting the archive.

### B38-C03 — Remove Helm scaling controls that cannot scale or protect availability

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `helm-single-replica::noop-hpa-pdb-controls::fixed-replica-contract`;
  proposed, decision-required public chart values.
- **Baseline / origin / revision hash:** `9b448133…`; B38.1; `f0f781a6cf0a110484f97656b2f0f283f55d0e0f023bd66a77083ccfe21b54d7`.
- **Domains / category:** B38 primary; unsupported/no-op deployment surface.
- **Exact evidence:** `templates/deployment.yaml:1-3` forbids
  `replicaCount > 1`; `templates/hpa.yaml:1-3` forbids
  `autoscaling.maxReplicas > 1`, so the only valid HPA has min/max one and cannot
  scale. `templates/pdb.yaml:1-13` defaults `maxUnavailable: 1`, which permits
  the sole replica to be unavailable and therefore adds no disruption
  protection. `values.yaml:196-219` exposes both mechanisms despite those
  constraints.
- **Current responsibility / consumers / formats:** Helm values are an
  operator-facing interface added in `7fa8f12132`; WebSocket connection state
  requires one server replica until shared state exists.
- **Unnecessary mechanism / smallest change:** render `replicas: 1` directly and
  remove HPA/PDB templates and their values until multi-replica architecture is
  implemented. Preserve the explicit fail-closed replica guard or equivalent
  validation.
- **Equivalence / invariants / failure modes:** the only supported runtime shape
  remains one replica. Do not accidentally allow rolling two-pod overlap with
  RWO storage or split in-memory WebSocket state.
- **Evidence and history:** the same feature commit deliberately hardened HPA to
  max one and changed PDB to maxUnavailable one after review, making the no-op
  state explicit rather than accidental.
- **Existing work:** no exact candidate found.
- **Required verification:** chart-consumer/value-override closure; `helm lint`
  and template snapshots; install/upgrade compatibility review; fresh
  Kubernetes and WebSocket reviewers.
- **Estimated delta / benefit:** about −55 to −65 chart LOC and two unsupported
  value groups; a smaller public deployment surface.
- **Blast radius / reversibility / risk / confidence:** public Helm values and
  rendered objects; easy source revert but medium operator compatibility risk,
  reproduced behavior confidence.
- **Verifiers / disposition / recommendation:** fresh Kubernetes/API reviewers;
  proposed, decision-required; pursue only if chart-consumer closure accepts
  removal.

### B38-C04 — Share the Helm database environment block

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `helm-database-env::migrator-app-exact-duplication::single-template`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B38.1; `d0310f00e1d2cd457e7ccd4c276b32a837d058a851f4fcd7a8fc2dc086df0fca`.
- **Domains / category:** B38 primary; duplicated secret/database wiring.
- **Exact evidence:** `templates/deployment.yaml:47-70` and `:101-123` repeat the
  bundled PostgreSQL user/database/password/URL and external URL/secret branches
  for the migration init container and app container. Blame assigns both copies
  to `7fa8f12132`; later migration hardening relies on them selecting the same
  database.
- **Current responsibility / consumers / formats:** both containers must receive
  byte-equivalent `DATABASE_URL` construction and secret keys in all four
  bundled/external and inline/existing-secret combinations.
- **Unnecessary mechanism / smallest change:** define one chart-local named
  template that emits the database env entries and include it at both sites;
  keep JWT and SMTP env entries container-specific.
- **Equivalence / invariants / failure modes:** rendered YAML, expansion order,
  secret names/keys, and `$(POSTGRES_*)` substitution must be identical. A
  whitespace or context bug can migrate one database and run against another.
- **Evidence and history:** repository history changes the two copies as one
  contract; no intentional divergence or separate consumer was found.
- **Existing work:** no exact implementation found.
- **Required verification:** golden `helm template` output for bundled inline,
  bundled existing secret, external URL, and external secret; migration test and
  fresh deployment reviewer.
- **Estimated delta / benefit:** about −20 to −25 chart LOC; one database target
  contract for migrator and runtime.
- **Blast radius / reversibility / risk / confidence:** Helm rendering only;
  easy revert, medium deployment risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh Helm/deployment reviewer;
  proposed; pursue only with rendered-output equivalence proof.

### B34-C01 — Delete the obsolete standalone decompression helper

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `gzip-boundary::dead-standalone-decompress-helper::compressed-body-parser`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B34.1; `10a6e2e7cd16885b6f753ef8bba229a0ddf4ac32753bea5e51103600cacf5e27`.
- **Domains / category:** B34 primary; dead production helper and duplicate tests.
- **Exact evidence:** `compressed-body-parser.ts:3-9,67-83` defines
  `decompressBody()`, but repository closure finds it only in its declaration
  and `tests/decompress-body.spec.ts:4-167`. Production ops/snapshot handlers use
  `isSingleTokenGzipEncoding()` plus `parseCompressedJsonBody()`; the
  `unsupported-content-encoding` reason is likewise declaration-only because
  `sync.routes.ts` produces the actual 415.
- **Current responsibility / consumers / formats:** the integrated parser owns
  base64, binary/decompressed limits, gzip, UTF-8/JSON parsing, and typed wire
  errors; the standalone helper owns no runtime boundary.
- **Unnecessary mechanism / smallest change:** remove the helper, unused reason
  literal, and duplicate direct suite; move any unique Unicode/invalid-base64
  assertion into the parser suite.
- **Equivalence / invariants / failure modes:** preserve all production status
  codes, reason strings, limits, Android payload behavior, and JSON semantics.
- **Evidence and history:** `7b34820b74` introduced the helper as a parser
  dependency; `9b965f2c35` deliberately inlined decode/decompress into the parser
  to decode once and distinguish errors, leaving the old helper test-only.
- **Existing work:** no duplicate live candidate found.
- **Required verification:** focused decompression and compressed-route specs,
  server build/typecheck, modified-file checks, and fresh boundary reviewer.
- **Estimated delta / benefit:** about −18 production LOC and −120 to −150 test
  LOC; one gzip/size/error boundary.
- **Blast radius / reversibility / risk / confidence:** server request parsing
  tests with no runtime caller; easy revert, low risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh server-boundary reviewer;
  proposed; pursue after preserving unique parser assertions.

### B34-C02 — Finish the dead DeviceService cleanup

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `device-lifecycle::test-only-owner-and-user-list-queries::device-service`;
  proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B34.1; `70dbbe8fdb8ae198357b047188bfbef3b9a5785faee8808014ef58c421ed3aa1`.
- **Domains / category:** B34 primary; test-preserved dead server queries.
- **Exact evidence:** `device.service.ts:11-31` exposes `isDeviceOwner()` and
  `getAllUserIds()`; exact repository searches find no production caller and
  only direct tests at `device.service.spec.ts:31-92`,
  `sync-operations.spec.ts:1093-1155`, and
  `sync.service.spec.ts:3416-3466`. Live `getOnlineDeviceCount()` and
  `deleteStaleDevices()` are separate.
- **Current responsibility / consumers / formats:** the two dead methods query
  device ownership and users with sync state; current upload/device persistence
  initializes and upserts through other code.
- **Unnecessary mechanism / smallest change:** delete the two methods and tests
  written solely against them; retain upload-side device/sync-state coverage.
- **Equivalence / invariants / failure modes:** no route, query, schema,
  persisted record, cleanup, or wire behavior changes. Preserve production
  device upsert and state initialization cases.
- **Evidence and history:** `07589dd67f` extracted all four methods;
  `c0b8f30214`/`#8498` removed the dead `SyncService` facades but rewired tests
  directly to the now-unconsumed lower methods.
- **Existing work:** continuation of `#8498`, not otherwise implemented.
- **Required verification:** device, upload, sync-service, and duplicate-
  precheck specs; build/typecheck, modified-file checks, and fresh server reviewer.
- **Estimated delta / benefit:** −22 production LOC and roughly −140 to −180
  redundant test LOC; complete the intended dead-query removal.
- **Blast radius / reversibility / risk / confidence:** service/test surface;
  easy revert, low runtime risk, reproduced repository confidence.
- **Verifiers / disposition / recommendation:** fresh device-lifecycle reviewer;
  proposed; pursue independently.

### B34-C03 — Consolidate transactional email delivery scaffolding

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `auth-email::repeated-transport-send-log-fallback::email-ts`; proposed,
  characterization-required, privacy/security-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B34.1; `6845aee810c9fa35639d71ca154362509266f278239585699deda8b8cf9f2a6b`.
- **Domains / category:** B34 primary; duplicated authentication-email delivery.
- **Exact evidence:** `email.ts:48-209` has three public verification, recovery,
  and login functions that repeat transporter lookup, a second config load,
  sender selection, delivery, Ethereal preview, success log, exception handling,
  and `false` fallback. Consumers are `auth.ts` and `passkey.ts`; current tests
  characterize only verification failure without SMTP.
- **Current responsibility / consumers / formats:** each function builds a
  distinct recipient/from/subject/text/HTML/link envelope while presenting the
  same neutral boolean delivery contract to auth endpoints.
- **Unnecessary mechanism / smallest change:** one file-local delivery helper
  accepting an exact message builder and explicit success/error log strings;
  retain the three public functions and their envelope construction.
- **Equivalence / invariants / failure modes:** byte-identical mail fields/links,
  transporter-before-message ordering, production failure `false`, preview
  behavior, and privacy-safe logs. Never add addresses or tokens to diagnostics.
- **Evidence and history:** copies accumulated in `6308e33a56`, `fd6499f138`,
  and `9c0a728ef4`; privacy hardening `1907df68d7` had to update all three.
- **Existing work:** no exact current implementation found.
- **Required verification:** first add mocked envelope/log snapshots for all
  three success/failure paths; email, passkey, and magic-link specs; build and
  modified-file checks; fresh auth/privacy reviewer.
- **Estimated delta / benefit:** about −25 to −35 production LOC after initial
  characterization; one delivery/fallback policy.
- **Blast radius / reversibility / risk / confidence:** account access email;
  easy revert, medium auth/privacy risk, supported confidence pending tests.
- **Verifiers / disposition / recommendation:** fresh auth and privacy reviewers;
  proposed; pursue only after envelope characterization.

### B34-C04 — Collapse duplicated CORS-origin mapping and error handling

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `cors-policy::duplicate-origin-map-catch-branches::config-ts`; proposed,
  security-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B34.1; `943949de89058addedc673d71c025ab0dd5afbc3223bac244d5c3ba1036fcd91`.
- **Domains / category:** B34 primary; repeated configuration parsing mechanics.
- **Exact evidence:** `config.ts:224-257` has wildcard-present and wildcard-
  absent branches that duplicate the same `try/catch`, origin mapping, config
  assignment, and error wrapper. Tests at `config.spec.ts:172-224` and
  `security-fixes.spec.ts:19-61` cover production wildcard rejection, development
  warning, exact origins, and subdomain patterns.
- **Current responsibility / consumers / formats:** production rejects universal
  `*`; development can retain it with a warning; other values pass through
  `parseCorsOrigin()` and implicitly enable CORS when not explicitly disabled.
- **Unnecessary mechanism / smallest change:** retain the rejection/warning
  decision, then run one map with `origin === '*' ? origin :
  parseCorsOrigin(origin)` and one error wrapper.
- **Equivalence / invariants / failure modes:** same ordering, wildcard and regex
  behavior, error text, implicit enablement, and allowed-origin array. A relaxed
  production wildcard would be a security regression.
- **Evidence and history:** `02ec2d97b9` introduced the security policy; no
  branch-specific mapping behavior exists.
- **Existing work:** no exact live candidate found.
- **Required verification:** config, security-fixes, and server-security specs;
  build/modified-file checks and a fresh CORS security reviewer.
- **Estimated delta / benefit:** about −10 to −12 production LOC; one parser and
  error boundary without weakening policy.
- **Blast radius / reversibility / risk / confidence:** server CORS config; easy
  revert, medium security validation risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh security reviewer;
  proposed; pursue with exact truth-table comparison.

### B33-C01 — Delete the unreachable cached-snapshot read and invalidation path

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-snapshot::dead-cached-read`; proposed.
- **Baseline / origin / revision hash:** `9b448133…`; B33; `5c3f0a71881d6a711372e2a973bf891b218757bf16d66bdab68f20021b61fbc3`.
- **Domains / category:** B33 primary, B34/C1 related; dead service path.
- **Exact evidence:** `snapshot.service.ts:103-159` implements
  `getCachedSnapshot()` and `_invalidateCachedSnapshot()`. Exact and reflective
  repository searches find no runtime call; only
  `snapshot.service.spec.ts:60-126` calls the public method. The service barrel is
  internal and the executable package exposes no named library API.
- **Current responsibility / consumers / formats:** the path reads and
  decompresses `user_sync_state.snapshot_data` and may clear corrupt snapshot
  metadata. Live snapshot generation reads its base independently inside a
  RepeatableRead transaction.
- **Unnecessary mechanism / smallest change:** delete both methods, their now-
  unused gunzip/limit imports, and four sole-consumer tests; retain byte/timestamp
  reads, cache writes, generation, and their tests.
- **Equivalence / invariants / failure modes:** no route, wire response, stored
  shape, replay order, or live cache write changes. Preserve generation
  corruption fallback, race guards, quota deltas, and encryption guards.
- **Evidence and history:** `18f03c1ec7` extracted the method;
  `9b965f2c35` added invalidation; `c0b8f30214` removed the already-dead
  `SyncService` facade but left this test-only residual.
- **Existing work:** concrete residual of A6-PW-017, not a new decomposition.
- **Required verification:** repeat symbol/export/reflection closure; snapshot
  service spec, package build/typecheck, modified-file checks, and fresh C1/B33
  reviewer.
- **Estimated delta / benefit:** about −58 to −62 production LOC and −65 test
  LOC; removes an unreachable decompression/database-write recovery path.
- **Blast radius / reversibility / risk / confidence:** one service/spec; easy
  revert, low behavioral risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh server/C1 reviewer;
  proposed; pursue independently.

### B33-C02 — Give storage reconciliation one unlocked implementation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `storage-quota::single-reconcile-body`; proposed, sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B33; `2bda7c57362a008e5505198ebbeca23721730e6d6263170fc2823b13d52f4444`.
- **Domains / category:** B33 primary; duplicated quota-accounting policy.
- **Exact evidence:** `storage-quota.service.ts:279-297` and `:304-317` both
  calculate exact usage, reject unbackfilled rows, write
  `users.storage_used_bytes`, and clear `forcedReconciles`. Only the surrounding
  reentrant versus ordinary lock/dedupe paths differ; tests at
  `storage-quota.service.spec.ts:204-401` cover both.
- **Current responsibility / consumers / formats:** deferred cleanup, quota
  checks, and upload cleanup reach `updateStorageUsage()` through `SyncService`;
  the cached counter derives from operation payload bytes plus snapshot bytes.
- **Unnecessary mechanism / smallest change:** extract a private unlocked body
  for the shared scan/backfill/write/marker sequence. The reentrant branch calls
  it directly; the ordinary branch retains inflight promise and per-user lock.
- **Equivalence / invariants / failure modes:** preserve AsyncLocalStorage
  reentrancy/deadlock avoidance, promise cleanup, stale-marker retention on
  approximate/failing scans, warning text, and exact write ordering. Do not
  merge the outer branches; quota mistakes can delete retained history.
- **Evidence and history:** `d1918b342b` added the reentrant bypass to fix a
  deadlock; `2d9988dd73` copied the unbackfilled-row guard into both bodies.
- **Existing work:** no exact implementation found.
- **Required verification:** exact-block comparison; quota service/cleanup and
  route/snapshot tests; divergence mutation; package build and modified-file
  checks; two fresh quota/sync reviewers.
- **Estimated delta / benefit:** about −10 to −18 production LOC; one owner for
  backfill and forced-marker policy.
- **Blast radius / reversibility / risk / confidence:** quota/retention service;
  easy code revert, sync-critical data-retention risk, reproduced confidence.
- **Verifiers / disposition / recommendation:** two fresh quota/sync reviewers;
  proposed; pursue only as the exact inner extraction.

### B33-C03 — Consolidate snapshot fast-forward tests into active owners

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-download-tests::snapshot-fast-forward-owners`; proposed, test-only.
- **Baseline / origin / revision hash:** `9b448133…`; B33; `304d587e986b8d45e6b9b9eca27cb660cc0acee662b1e464a6c82cf7384b74cd`.
- **Domains / category:** B33 primary, B36/B37/C6 related; excluded duplicate
  test ownership.
- **Exact evidence:** `snapshot-skip-optimization.spec.ts` is 822 LOC and
  `integration/snapshot-skip-optimization.integration.spec.ts` is 361 LOC. Both
  have been excluded by `vitest.config.ts:20-23` since `5f9d73c37c`; the mocked
  integration file is absent from `test:integration:postgres`. Active
  `operation-download.service.spec.ts:126-1060` already covers stable bounds,
  full-state fast-forward, gaps, exclude-client behavior, pagination, and clocks.
  Stale type mocks return a row regardless of predicate, so they do not prove
  causal BACKUP_IMPORT/REPAIR selection.
- **Current responsibility / consumers / formats:** the excluded suites intend
  to protect `GET /api/sync/ops` fast-forward and `DownloadOpsResponse`, but run
  under neither normal nor explicit PostgreSQL CI.
- **Unnecessary mechanism / smallest change:** move only distinct causal-type
  and boundary assertions into the active service fixture; retain a compact
  active Fastify contract only if route mapping is not already mutation-
  sensitive; delete both excluded suites and exclusion entries.
- **Equivalence / invariants / failure modes:** preserve replacing-op inclusion,
  latest causal full-state selection, real/apparent gaps, exclude-client,
  limits, and metadata. Require scenario/mutation mapping before deletion.
- **Evidence and history:** `e36ba3f47d` added both; `5f9d73c37c` excluded them
  four days later as internal-detail tests, before service decomposition.
- **Existing work:** dedupe into the B36/C6 reachability inventory.
- **Required verification:** machine-readable scenario matrix; representative
  mutations for causal predicate, effective cursor, gap baseline, and response;
  active service/route specs and normal package tests; fresh test owner.
- **Estimated delta / benefit:** roughly −900 to −1,100 net test/config LOC while
  moving distinct protection into executed owners.
- **Blast radius / reversibility / risk / confidence:** tests/config only; easy
  revert, no runtime risk but medium validation cost, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh B33/B36 test reviewer;
  proposed; pursue after scenario and mutation proof.

### B33-C04 — Make the PostgreSQL vector-clock test execute production SQL

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `server-download-tests::production-sql-path`; proposed, test-only.
- **Baseline / origin / revision hash:** `9b448133…`; B33; `86b186bf0d756b29e6ee6b24b9c641d5f5bc70902edb8f3e248c3c787644bdd0`.
- **Domains / category:** B33 primary, B36/B37/B38/C6 related; copied SQL in an
  integration test.
- **Exact evidence:** `snapshot-vector-clock-sql.integration.spec.ts:59-81`
  copies SQL and row mapping from `operation-download.service.ts:318-355` while
  claiming to verify the query used by `getOpsSinceWithSeq()`; it never
  instantiates the service. The PostgreSQL suite selects this file, while unit
  coverage mocks `$queryRaw`.
- **Current responsibility / consumers / formats:** production aggregates vector
  clocks through the latest causal full-state sequence and prunes while
  preserving requester/author IDs for the download response.
- **Unnecessary mechanism / smallest change:** seed a real causal full-state op
  and matching sync-state bound, call the production service with no persisted
  clock, and assert its public result; keep a compact user/sequence/max matrix
  and delete the copied query helper.
- **Equivalence / invariants / failure modes:** production stays unchanged;
  preserve fallback activation, upper bound, user isolation, numeric conversion,
  pruning, and preserved IDs. A production SQL mutation must fail the test.
- **Evidence and history:** `861425fd28` added the suite to validate production
  SQL but implemented a fork; `d32f7037a3` changed surrounding clock behavior
  without removing the split owner.
- **Existing work:** reconcile with C6's real-SQL/test-selection inventory.
- **Required verification:** isolated PostgreSQL integration run, active download
  unit spec, WHERE-bound/aggregation mutations, modified-file checks, and fresh
  database-test reviewer.
- **Estimated delta / benefit:** roughly −50 to −100 test LOC and removal of
  false confidence; one production SQL owner.
- **Blast radius / reversibility / risk / confidence:** one integration spec;
  easy revert, no runtime risk, medium DB validation cost, reproduced confidence.
- **Verifiers / disposition / recommendation:** fresh B33/B36 reviewer; proposed;
  pursue with mutation sensitivity demonstrated.

### B35-C01 — Replace the unsafe Android sequence-hint roadmap with a rejection fence

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `android-background-roadmap::unsafe-reminder-cursor-as-state-cursor::rejection-note`;
  discovered/proposed, unverified; sync-critical documentation.
- **Baseline / origin / revision hash:** `9b448133…`; B35.1; `be4fcefe437b1d10105885883aab2e8ca4e68666a790ea27a381ee1b671143bb`.
- **Domains / category:** B35 primary, C7 related; unsafe speculative design.
- **Exact evidence:** `docs/long-term-plans/android-background-sync-improvements.md:16-77,168-174`
  proposes using the worker's `lastServerSeq` as foreground sync start.
  `SyncReminderWorker.kt:26-83` uses that cursor only to fetch reminder changes,
  update native reminders, and persist the reminder cursor; it never applies
  operations to Angular state. `getLastSyncSeq` has no implementation consumer.
- **Unnecessary mechanism / smallest change:** replace the Phase 1 implementation
  recipe and priority row with a concise rejection note: the reminder cursor is
  not authoritative app-state progress. Preserve that warning so the shortcut is
  not rediscovered.
- **Equivalence / invariants / failure modes:** foreground sync must never skip
  operations merely because the reminder worker observed their sequences; native
  reminder behavior and all runtime/persisted/wire formats stay unchanged.
- **Evidence and history:** `10a3db97ea` introduced roadmap and worker together;
  no implementation of the proposed cursor bridge followed.
- **Required verification:** two fresh sync reviewers validate cursor authority,
  exact-reference scan, and Markdown/link checks.
- **Estimated delta / benefit:** about −50 to −60 documentation LOC and removal
  of a data-loss-prone recipe.
- **Blast radius / reversibility / risk / confidence:** documentation only; easy
  revert, but critical semantic risk if the rejection fence is omitted.
- **Verifiers / disposition / recommendation:** two fresh sync reviewers;
  discovered/proposed, unverified; pursue only with the explicit rejection.

### B35-C02 — Remove the single-implementation Android background provider interface

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `android-background-sync::single-implementation-provider-interface::direct-concrete-class`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.1; `e843437372ff4ffa93f94c4c8a71871dca13e322a207ae6d1d776ad90aa4056b`.
- **Domains / category:** B35 primary; speculative native abstraction.
- **Exact evidence:** `BackgroundSyncProvider.kt:75-94` has one implementation,
  `SuperSyncBackgroundProvider.kt:10-20,73-80`; the only production caller,
  `SyncReminderWorker.kt:33,48-52`, constructs that concrete class directly.
  Other references are KDoc and speculative roadmap Phase 3.
- **Unnecessary mechanism / smallest change:** delete the interface, inheritance,
  and `override` markers; retain `limit: Int = 100` directly on the concrete
  method and defer an abstraction until a second provider exists.
- **Equivalence / invariants / failure modes:** preserve the inherited default
  page size, fetch/pagination/reminder results, quick client, and native ABI.
- **Evidence and history:** `10a3db97ea` introduced the interface solely for
  hypothetical Dropbox/WebDAV extensibility; no polymorphic consumer followed.
- **Required verification:** Android Kotlin compile/lint, worker/reminder smoke or
  focused test, exact type-reference closure, and explicit default-argument review.
- **Estimated delta / benefit:** about −15 to −20 production/documentation LOC;
  one concrete native path.
- **Blast radius / reversibility / risk / confidence:** internal Android compile
  surface; easy revert, low risk if the default argument is retained.
- **Verifiers / disposition / recommendation:** fresh Android reviewer;
  discovered/proposed, unverified; pursue.

### B35-C03 — Prune MainHeader post-extraction state and its constant route stream

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `main-header::post-extraction-dead-state-and-constant-route-stream`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.1; `3fa606cb84f9771decd1f1b57d599a4b4e00428c9bb5194bcf593342b0bac518`.
- **Domains / category:** B35 primary; dead UI orchestration residue.
- **Exact evidence:** `main-header.component.ts:112-144,166-168,195-206,299-301,355-360`
  retains parent focus state, `isXxxs`, and a NavigationEnd pipeline that maps
  every event to `true` and starts `true`. FocusButton and PageTitle now own the
  actual focus and responsive state; the remaining parent fields have no live
  template consumer. Track functions merely return stable IDs.
- **Unnecessary mechanism / smallest change:** use a constant true signal; remove
  the router pipeline/injection and unused parent focus/responsive fields; track
  counters by ID directly; update direct-construction spec setup. Do not remove
  the child input/disabled branch in this candidate.
- **Equivalence / invariants / failure modes:** panel buttons remain enabled;
  FocusButton owns activation/summary; counter identity, sync/header behavior,
  teleporting, and accessibility remain unchanged.
- **Evidence and history:** `bda5a187418` made the route predicate unconditional;
  `b51bd2c9ca` moved focus behavior into the child and left parent residue.
- **Required verification:** modified-file checks, focused MainHeader specs, and
  desktop/mobile/vertical-action-bar smoke with a fresh UI reviewer.
- **Estimated delta / benefit:** about −25 to −35 production and −8 test LOC;
  fewer subscriptions and duplicated owners in a global header.
- **Blast radius / reversibility / risk / confidence:** header UI; easy revert,
  low runtime risk, supported repository confidence.
- **Verifiers / disposition / recommendation:** fresh UI reviewer;
  discovered/proposed, unverified; pursue owner-locally.

### B35-C04 — Delete parent-scoped child-style residue under Emulated encapsulation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `component-styles::parent-scoped-child-selector-residue::emulated-encapsulation`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.1; `81aa543a8944ba1a230b0f18131d3311e61842a59606d221956895490eea898b`.
- **Domains / category:** B35 primary; unreachable component CSS.
- **Exact evidence:** `main-header.component.scss` standalone blocks for
  `.project-settings-btn`, `.panel-btn`, and `.current-task-title`, plus the empty
  `.backdrop` and old `.right-panel` blocks in `app.component.scss`, target
  classes now owned inside child views. Default Emulated encapsulation prevents
  these non-`::ng-deep` parent selectors from matching child templates. The
  corresponding PageTitle, PlayButton, DesktopPanelButtons, and RightPanel
  components own the live styles.
- **Unnecessary mechanism / smallest change:** delete exactly those five blocks.
  Retain intentional `::ng-deep .current-task-title` rules and `button.isActive2`,
  which the Velvet theme still consumes.
- **Equivalence / invariants / failure modes:** header, page-title, play/panel,
  app sizing, mobile, RTL, vertical, and open-panel visuals remain unchanged.
- **Evidence and history:** the parent blocks predate component extraction;
  `bda5a187418` globalized the right-panel wrapper without removing the old rule.
- **Required verification:** SCSS modified-file checks, compiled-selector
  inspection, layout spec, and desktop/mobile/RTL/vertical/open-panel screenshots.
- **Estimated delta / benefit:** exactly −89 SCSS LOC; removes misleading styles.
- **Blast radius / reversibility / risk / confidence:** presentation only; easy
  revert, medium-low visual-proof risk.
- **Verifiers / disposition / recommendation:** fresh visual reviewer;
  discovered/proposed, unverified; pursue only with screenshot equivalence.

### B35-C05 — Remove three perimeter zombie constants

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `perimeter-contracts::zero-consumer-and-no-op-constants::remove-zombies`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.1; `adc4f1b3bc597dacf195a2a1f771b4156999a4ca25a8e9442f9f005381a87777`.
- **Domains / category:** B35 primary, C1 related; dead platform surface.
- **Exact evidence:** both branches of `CORS_SKIP_EXTRA_HEADERS` in
  `app.constants.ts:74-83` are `{}` and its two calendar spreads are no-ops;
  `ALLOWED_COMMANDS` in `simple-store.const.ts` has no reader/writer and the
  generic JSON loader ignores an old persisted key; `FILE_SYNC_GET_REV_AND_CLIENT_UPDATE`
  in `ipc-events.const.ts` has no symbol or literal consumer.
- **Unnecessary mechanism / smallest change:** replace the CORS conditional and
  stale TODO with one typed empty constant, and delete the two unconsumed enum
  members/comments.
- **Equivalence / invariants / failure modes:** calendar requests still add no
  header; old simple-settings JSON still parses and ignores unknown keys; all
  active IPC strings remain byte-identical.
- **Evidence and history:** `6d13abcc6e` added the never-activated CORS hook;
  `97e97042cde` removed the command path; `1059eeea04` removed the file-sync
  handler/preload/API but left the enum member.
- **Required verification:** symbol and literal closure, modified-file checks,
  app/Electron typecheck or build, calendar and Electron focused suites.
- **Estimated delta / benefit:** about −14 production LOC; less false contract
  surface at three platform boundaries.
- **Blast radius / reversibility / risk / confidence:** internal constants;
  easy revert, low compatibility risk after the persisted-loader check.
- **Verifiers / disposition / recommendation:** fresh platform reviewer;
  discovered/proposed, unverified; pursue as one bounded cleanup.

### B38-C05 — Consolidate the two SuperSync monitoring manuals

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-monitoring-docs::docker-and-script-manuals::single-canonical-runbook`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B38.2; `8bf0e8f5598e0c82745c32d29f7a363adfc2b2c1f51af6a298c4cfed17c58804`.
- **Domains / category:** B38 primary, C7 related; duplicated operational docs.
- **Exact evidence:** `DOCKER-MONITORING.md` is 274 lines and
  `scripts/MONITORING-README.md` is 298 lines. Both enumerate the same monitor,
  analyze-storage, full-suite, quick/save, per-user, export, automation,
  investigation, troubleshooting, performance, and privacy workflows. The
  Docker guide adds wrapper/report-copy details; the scripts guide adds local
  development notes. They already disagree about compiled execution versus
  installing/running `tsx` in the production container.
- **Unnecessary mechanism / smallest change:** choose the production Docker
  guide as the canonical operator runbook, merge only the unique local-development
  commands and current privacy warning, then replace the scripts manual with a
  short pointer or delete it and update its sole help reference.
- **Equivalence / invariants / failure modes:** preserve every active npm/wrapper
  command, report path, container override, and explicit warning that exports can
  contain full payloads and identifying data. Do not normalize examples that have
  not been checked against the current image.
- **Evidence and history:** `5027b31431` introduced the scripts manual for the
  toolkit; `554cc09608` added a second near-complete manual nine minutes later
  for the Docker wrapper. Subsequent compiled-JS changes updated mechanics but
  left the split documentation.
- **Required verification:** command/reference inventory, package-script and
  Dockerfile comparison, Markdown/link checks, and fresh operator/privacy review.
- **Estimated delta / benefit:** roughly −230 to −290 documentation LOC; one
  current source of truth for sensitive monitoring workflows.
- **Blast radius / reversibility / risk / confidence:** operator documentation;
  easy revert, medium operational risk if a unique command is dropped.
- **Verifiers / disposition / recommendation:** fresh operator and privacy
  reviewers; discovered/proposed, unverified; pursue with a command matrix.

### B38-C06 — Give image provenance and dirty-input checks one shell owner

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `supersync-image-provenance::deploy-and-publish-duplicate-shell-guards::shared-owner`;
  discovered/proposed, unverified; deployment-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B38.2; `0937aa614e6f46928dc43d8b9ad19193832d528ea5185b8de2dd677c9e6de0ce`.
- **Domains / category:** B38 primary; duplicated release/deploy policy.
- **Exact evidence:** `build-and-push.sh:44-99` and `deploy.sh:108-170`
  independently define `supersync_image_source_revision()` and
  `assert_clean_supersync_image_inputs()`, including the same seven path groups,
  tracked/cached dirty checks, untracked scan, fallback revision, and nearly
  identical refusal text. The differences are only current-directory handling,
  fallback output, and the `--build` message.
- **Unnecessary mechanism / smallest change:** put the path set and two guard
  functions in one adjacent shell library parameterized by repository root;
  source it from both scripts after `deploy.sh` has pulled/re-executed current
  code. Keep login, build, pull, image-label comparison, and deploy sequencing in
  their existing owners.
- **Equivalence / invariants / failure modes:** identical source revision and
  fail-closed behavior for dirty tracked, staged, and untracked inputs from any
  working directory. A stale helper must not bypass deploy self-reexecution, and
  a missing helper must fail before build/push.
- **Evidence and history:** both copies landed together in `b83a6745e6` to fix
  stale deploy-image skew; they enforce one policy but can now drift separately.
- **Required verification:** shell tests for clean/dirty/staged/untracked/fallback
  matrices from both entry points, image-label integration, modified-file checks,
  and two fresh deployment reviewers.
- **Estimated delta / benefit:** about −45 to −65 shell LOC and one authoritative
  image-input list.
- **Blast radius / reversibility / risk / confidence:** build/publish/deploy
  perimeter; easy revert, medium-high operational risk, reproduced duplication.
- **Verifiers / disposition / recommendation:** two fresh deployment reviewers;
  discovered/proposed, unverified; pursue only if the shared owner remains
  version-locked to the post-pull deploy script.

### B38-C07 — Retire the one-shot passkey credential repair after compatibility closure

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `passkey-storage-migration::manual-double-encoding-repair::retire-after-data-gate`;
  discovered/proposed, unverified; decision-required compatibility/privacy.
- **Baseline / origin / revision hash:** `9b448133…`; B38.2; `dd38c09eaedada8f7c2d8f1fb6e25a711a0a78acca857ce5dfa45f22d713e6d7`.
- **Domains / category:** B38 primary, C1/C8 related; dated manual data repair.
- **Exact evidence:** `prisma/migrations/migrate-passkey-credentials.ts` is a
  97-line, manually invoked script added in January 2026 to rewrite the original
  double-encoded WebAuthn IDs. Exact repository search finds no package command,
  deployment hook, test, or documentation consumer beyond its own run comment.
  It prints user IDs plus old/new credential IDs in hex and base64url before
  mutating each row. Current registration/login code stores and queries raw bytes.
- **Unnecessary mechanism / smallest change:** first query each deployed database
  for the legacy ASCII-base64url shape and record operator confirmation; if none
  remain and the supported upgrade window is closed, delete the script. Until
  then, retain it but remove credential-value logging and give it an explicit
  documented owner/run gate; moving it to another live folder is not simplification.
- **Equivalence / invariants / failure modes:** never strand an account whose
  passkey still uses the old encoding; preserve uniqueness and byte-exact IDs;
  never emit credential identifiers into exportable logs.
- **Evidence and history:** `a57a197d44` fixed new writes and `868ed71c4a`
  added this manual repair the following day. Later passkey hardening changed live
  flows but no repository evidence proves every deployed database was migrated.
- **Required verification:** production-owner decision, read-only legacy-shape
  inventory for every supported deployment, passkey registration/login recovery
  tests, privacy review, and exact caller/package-command closure.
- **Estimated delta / benefit:** −97 production-tool LOC after the compatibility
  gate; removes an unowned mutator and raw-identifier logging path.
- **Blast radius / reversibility / risk / confidence:** existing passkey accounts;
  code revert is easy but lost recovery capability is not, so risk is high until
  external data closure is proven.
- **Verifiers / disposition / recommendation:** auth, data-migration, and privacy
  owners; discovered/proposed, unverified; decision-required and not presently
  admissible without external compatibility evidence.

### B36-C01 — Delete the orphaned encryption E2E failure memo

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-docs::orphaned-encryption-failure-memo`; discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.1; `2e4db0e7be318d4cbf8adb6f35dab1a6f5bd480b2d25153a0bd10c8b91f3ac4e`.
- **Domains / category:** B36 primary, B22/C7 related; stale diagnostic memo.
- **Exact evidence:** `ENCRYPTION-E2E-STATUS.md` is a 525-line memo dated
  2026-01-24 and headed “ALL TESTS FAILING.” Its named owner,
  `supersync-encryption-enable-disable.spec.ts`, was deleted by `cf7fa73e5b`.
  Repository-wide backlink, filename, local-storage-key, and selector searches
  find no current consumer; its checkbox workflow no longer exists in
  `SuperSyncPage`.
- **Unnecessary mechanism / smallest change:** delete the memo without
  replacement; retain current execution guidance in `e2e/CLAUDE.md` and live
  scenario specs.
- **Equivalence / invariants / failure modes:** no executable behavior,
  encryption contract, fixture, or supported command changes.
- **Evidence and history:** created by `035fe0a95f`; its only later edit was an
  enum rename in `08e8329f97`, before the owning suite was removed.
- **Required verification:** repeat backlink/path/key/selector closure,
  Markdown-link scan, and `git diff --check`.
- **Estimated delta / benefit:** −525 stale documentation LOC and one fewer
  misleading failure authority.
- **Blast radius / reversibility / risk / confidence:** documentation only;
  trivial revert, negligible runtime risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh test-doc reviewer;
  discovered/proposed, unverified; pursue independently.

### B36-C02 — Remove unused SuperSync fixture helper APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-fixture::unused-describe-and-client-tracking-apis`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.1; `66eb7e3c34b24568080dff3663297a0797a17f16c722d1ef5479de5c30d66c51`.
- **Domains / category:** B36 primary, C1/C6 related; dead test infrastructure.
- **Exact evidence:** `supersync.fixture.ts:115-183` exports
  `supersyncDescribe`, `trackClient`, and `cleanupTrackedClients` plus a module
  map. Exact and computed-property searches find no consumers. The advertised
  automatic cleanup is not registered with a fixture or `afterEach`; 71 sync
  specs use explicit client cleanup instead.
- **Unnecessary mechanism / smallest change:** delete those three exports, the
  map, unused `SimulatedE2EClient` import, and misleading prose. Preserve health
  gating, `testRunId`, `serverHealthy`, and the exported Playwright primitives.
- **Equivalence / invariants / failure modes:** live fixture initialization,
  required-server failure/skip semantics, test isolation, and explicit cleanup
  remain unchanged.
- **Evidence and history:** introduced together by `f37110bbb5` and never
  adopted by a scenario.
- **Required verification:** symbol/reflection closure, modified-file check,
  fixture typecheck/listing, and required-server skip/fail smoke path.
- **Estimated delta / benefit:** about −65 to −70 test-infrastructure LOC;
  removes a false automatic-cleanup contract.
- **Blast radius / reversibility / risk / confidence:** E2E fixture surface;
  easy revert, low risk, reproduced repository confidence.
- **Verifiers / disposition / recommendation:** fresh E2E harness reviewer;
  discovered/proposed, unverified; pursue independently.

### B36-C03 — Reuse the canonical archive and worklog E2E helpers

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-helpers::duplicate-archive-worklog-spec-functions`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.1; `c07784b387cda8b1c20e177fe5f1f8082c98e2101fa69e7396aa6692e583c2d7`.
- **Domains / category:** B36 primary, C6 related; duplicated browser workflow.
- **Exact evidence:** `supersync-archive-data-sync.spec.ts:35-91` and
  `supersync-backup-recovery.spec.ts:38-102` locally duplicate mark-done, Daily
  Summary archive, worklog navigation/week expansion, and task counting.
  `supersync-helpers.ts:1067-1123,1220-1251` now provides matching
  `markTaskDoneByKey`, `archiveDoneTasks`, and `getWorklogTaskCount` helpers.
- **Unnecessary mechanism / smallest change:** replace the six local functions
  with those three canonical imports; preserve scenario-specific backup
  export/import helpers and assertions.
- **Equivalence / invariants / failure modes:** identical task identity,
  archive dialog flow, worklog week selection, visibility waits, and count
  semantics. Do not combine the scenarios themselves.
- **Evidence and history:** local copies arrived in `0fd2618dab` and
  `a93f6a7ba2`; shared helpers followed in `7ed76c13a4`.
- **Required verification:** modified-file checks, both focused E2E files with
  retries disabled, and the scheduled SuperSync suite.
- **Estimated delta / benefit:** about −120 to −130 test LOC; one maintained
  owner for a timing-sensitive browser workflow.
- **Blast radius / reversibility / risk / confidence:** two E2E specs; easy
  revert, low product risk and medium timing-validation cost.
- **Verifiers / disposition / recommendation:** fresh browser-test reviewer;
  discovered/proposed, unverified; pursue independently.

### B36-C04 — Delete the sequential tests mislabeled as concurrent imports

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::sequential-concurrent-import-duplicates`;
  discovered/proposed, unverified; sync-scenario-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B36.1; `03d3f6c2f0e4e0ffe7358935315b984a5b89398afee69954a1f41c7229a698d2`.
- **Domains / category:** B36 primary, C6/C7 related; misleading duplicate E2E.
- **Exact evidence:** both tests in `supersync-concurrent-import.spec.ts:46-233`
  finish Client A's import and sync before Client B is created. Client B never
  imports, uploads never overlap, and no concurrency primitive remains.
  `supersync-lastseq-preservation.spec.ts` and
  `supersync-import-clean-server-state.spec.ts` cover the retained sequential
  imported-state and post-import propagation behavior more directly.
- **Unnecessary mechanism / smallest change:** delete the 236-line file and mark
  the concurrent-full-state race uncovered. If that race is required, specify a
  separate deterministic overlap test rather than preserving this name.
- **Equivalence / invariants / failure modes:** production behavior is untouched;
  current concurrency coverage is already zero. Do not claim race coverage after
  deletion, and retain destructive-import semantics in the stronger scenarios.
- **Evidence and history:** `a977fa2fbe` originally ran parallel two-client
  imports; `cce9576946` removed Client B's import/overlap for mandatory encryption
  while retaining the old names and rationale.
- **Required verification:** scenario-matrix review, two retained import specs
  with retries disabled, and scheduled SuperSync; fresh sync-import reviewer.
- **Estimated delta / benefit:** −236 test LOC and two expensive browser tests;
  removes false confidence rather than real concurrency coverage.
- **Blast radius / reversibility / risk / confidence:** E2E selection only;
  easy revert, no runtime risk but medium scenario-coverage risk.
- **Verifiers / disposition / recommendation:** fresh sync-import and E2E
  reviewers; discovered/proposed, unverified; pursue only after matrix approval.

### B36-C05 — Delete page-object APIs left by obsolete encryption tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-page-object::orphaned-supersync-encryption-controls`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.1; `6fa4a8556c0704785572d231b42338cac69582a52714888493151269d4298295`.
- **Domains / category:** B36 primary, B22/C1 related; dead page-object API.
- **Exact evidence:** no direct, aliased, reflective, or computed-property
  consumer exists for `SuperSyncPage.enableEncryption()`,
  `disableEncryption()`, `isSyncInErrorState()`, or `isSyncEnabled()`. Two
  private wait helpers are used only by those methods, and
  `encryptionPasswordInput` is unread. The 561-line owning enable/disable suite
  was deleted by `cf7fa73e5b`.
- **Unnecessary mechanism / smallest change:** delete those methods, the two
  sole-consumer helpers, and unused locator. Preserve setup, password change,
  sync/error diagnostics, button locators used by live tests, and WebDAV APIs.
- **Equivalence / invariants / failure modes:** all live page-object consumers
  and encryption/password scenarios keep their selectors and wait semantics.
- **Evidence and history:** manual controls landed with the obsolete suite in
  `1c41228a7f`; state queries followed in `788f2dedf8`; suite deletion left the
  surface. This is the B36 companion to B22-C01.
- **Required verification:** symbol/reflection closure, modified-file check,
  page-object typecheck, password-change/wrong-password specs, and scheduled
  encrypted SuperSync matrix.
- **Estimated delta / benefit:** about −245 to −255 test LOC; a materially
  smaller and more truthful page-object contract.
- **Blast radius / reversibility / risk / confidence:** shared E2E page object;
  easy revert, low runtime risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh encryption-E2E reviewer;
  discovered/proposed, unverified; merge with B22-C01 during D1 or pursue beside it.

### B34-C05 — Finish removal of the retired password-reset flow

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `retired-password-auth::orphaned-page-asset-and-tests::password-reset-remnants`;
  discovered/proposed, unverified; deprecation/auth-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B34.2; `2426fcab2c29b8af31d8e181ef0e9dab01a5ac1621c429a2e10a43453864d0e4`.
- **Domains / category:** B34 primary, B36/C3 related; broken retired feature shell.
- **Exact evidence:** `src/pages.ts:23-25,36-97` still serves
  `/reset-password`, and `public/reset-password.js:1-57` posts to
  `/api/reset-password`. No current reset or forgot-password route/function or
  link producer exists. `password-reset-api.spec.ts` invents removed auth exports
  and is excluded by `vitest.config.ts:30-31`; `password-reset.spec.ts` imports no
  production code and tests Node/bcrypt primitives. `server-security.spec.ts`
  preserves only the orphaned GET page.
- **Unnecessary mechanism / smallest change:** delete the page/asset, both dead
  suites, page-only security assertions, and obsolete exclusion. Keep generic
  escaping coverage. Do not remove persisted reset-token columns/index or URL-log
  redaction without C3 migration/rollback review.
- **Equivalence / invariants / failure modes:** no successful password-reset path
  remains; the user-visible change is a direct 404 instead of a form whose POST
  404s. Preserve passkey and magic-link account recovery and all safe error/log
  behavior.
- **Evidence and history:** `fd6499f138` added the flow; `9c0a728ef4` replaced
  password auth; `f0f536671b` explicitly excluded the missing-route suite;
  `70414145a3` later externalized the orphaned script for CSP only.
- **Required verification:** exact route/link/asset closure, active auth/passkey/
  magic-link and server-security suites, server build/typecheck, and fresh auth/
  deprecation review.
- **Estimated delta / benefit:** about −122 production/static, −447 test, and
  −2 config LOC; removes a broken public shell and false test ownership.
- **Blast radius / reversibility / risk / confidence:** public auth URL; easy
  code revert, medium surface/compatibility risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh auth and deprecation
  reviewers; discovered/proposed, unverified; pursue after URL-support closure.

### B34-C06 — Test the real WebSocket route instead of a copied handler

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `websocket-auth::copied-handler-test-double::websocket-routes-spec`;
  discovered/proposed, unverified; security-boundary test.
- **Baseline / origin / revision hash:** `9b448133…`; B34.2; `3935bfd6b00f0791e12e486fbb2b14178c593c8c3804323e1692fc0292397583`.
- **Domains / category:** B34 primary, B36/C6 related; duplicated test implementation.
- **Exact evidence:** `websocket.routes.spec.ts:14-90` copies
  `websocket.routes.ts:45-81` into `simulateWsHandler`, then tests the copy at
  `:193-306`; regex/constant checks add more indirect coverage. Installed
  `@fastify/websocket` `^11.2.0` exposes `FastifyInstance.injectWS()` in its
  bundled typings/testing guide, so the stated inability to inject a WebSocket
  is obsolete.
- **Unnecessary mechanism / smallest change:** register the existing plugin and
  `wsRoutes`, drive `/ws` through `injectWS`, retain direct rate-limit-key tests,
  and move any pure client-ID truth table to its actual utility owner.
- **Equivalence / invariants / failure modes:** production stays unchanged;
  preserve validation order, 4001/4003/1011 close codes, authentication before
  connection registration, user/client association, shared-NAT keys, teardown,
  and non-disclosure of token/error details.
- **Evidence and history:** route and simulator landed together in
  `7fa8f12132`; later validation changes were split across `0c70e7906f` and
  `3fbde60742`, demonstrating dual-maintenance risk.
- **Required verification:** first prove deterministic `injectWS` close-code and
  teardown behavior; then route/connection/storm/rate-limit suites and server
  build/typecheck with a fresh WebSocket-security reviewer.
- **Estimated delta / benefit:** roughly −50 to −90 net test LOC; actual route
  registration and handler coverage replace a parallel implementation.
- **Blast radius / reversibility / risk / confidence:** auth WebSocket tests;
  easy revert, medium security-validation risk, reproduced discovery evidence.
- **Verifiers / disposition / recommendation:** fresh security/test reviewer;
  discovered/proposed, unverified; pursue only if the prototype is smaller and stable.

### B34-C07 — Collapse parallel SuperSync architecture-diagram sources

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-architecture::parallel-mermaid-sources::package-and-canonical-diagrams`;
  discovered/proposed, unverified; characterization-required.
- **Baseline / origin / revision hash:** `9b448133…`; B34.2; `d3eaf9c5ba2ed49fe007b075d99e9c03716147f5afae98b16028c9403df20cf7`.
- **Domains / category:** B34 primary, C7 related; duplicated architecture docs.
- **Exact evidence:** package-local `sync-server-architecture-diagrams.md` is
  994 lines and has only the package README plus one test-comment consumer;
  indexed `docs/sync-and-op-log/diagrams/02-server-sync.md` is the ADR-linked
  canonical-looking server diagram. The package tome still shows removed
  password auth; the canonical diagram still shows removed tombstones; both use
  `lastKnownSeq` while runtime uses `lastKnownServerSeq`, and one package link is
  path-invalid.
- **Unnecessary mechanism / smallest change:** designate the indexed diagram
  collection canonical, inventory/move only unique current content, delete the
  package tome, update its two consumers, and correct the canonical server
  diagram against current routes/types in the same bounded change.
- **Equivalence / invariants / failure modes:** documentation only; no protocol,
  persistence, route, or wire-format change. Unique diagrams must not disappear
  silently, and stale content must not be copied into the canonical source.
- **Evidence and history:** package source began in `b671a8cf17`; the second
  diagram arrived in `9f0adbb95c` as a paths/types refresh. Both needed updates
  in `0b4bc79354` when GET snapshot was retired, confirming parallel ownership.
- **Required verification:** unique-topic inventory, link check, Mermaid render,
  and current route/type comparison with a fresh sync-doc reviewer.
- **Estimated delta / benefit:** about −700 to −950 documentation LOC and one
  architecture owner.
- **Blast radius / reversibility / risk / confidence:** architecture guidance;
  easy revert, medium correctness risk, supported pending content inventory.
- **Verifiers / disposition / recommendation:** fresh sync and documentation
  reviewers; discovered/proposed, unverified; pursue through C7, not blind deletion.

### B35-C06 — Prune historical BannerService residue

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `banner-singleton::redundant-dismiss-all-and-debug-tombstone::banner-service-startup`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.2; `47992b271ba694c8b014de6f8662dde4c773d3a86a51284f4a6d380cc25639f3`.
- **Domains / category:** B35 primary, C1 related; dead comments/redundant API.
- **Exact evidence:** `banner.service.ts:42-121` is an 80-line commented debug
  harness. `open()` replaces an existing same-ID banner and private storage starts
  empty, so at most one banner per ID exists; `dismiss()` filters that ID, making
  `dismissAll()` identical today. Its only production caller is
  `startup.service.ts:397`, with one direct spec block.
- **Unnecessary mechanism / smallest change:** call
  `dismiss(BannerId.Offline)` from StartupService, delete `dismissAll`, its
  redundant spec, the commented harness, and the commented log line.
- **Equivalence / invariants / failure modes:** offline banner closes exactly as
  now; same-ID replacement, priority, active signal/observable, `hideWhen`, and
  auto-dismiss stay unchanged. `activeBanner$` is live in Task UI and Banner
  component and must remain.
- **Evidence and history:** `cdb212a6ec` added `dismissAll` when `dismiss()` used
  `shift()`; `8203409e05` changed both storage and targeted filtering, removing
  that distinction. Debug examples date to 2019.
- **Required verification:** modified-file checks, Banner/Startup specs, symbol
  closure, and offline-banner smoke.
- **Estimated delta / benefit:** about −91 production/comment and −13 test LOC;
  one banner-dismiss contract.
- **Blast radius / reversibility / risk / confidence:** singleton UI service;
  easy revert, low risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh shell/UI reviewer;
  discovered/proposed, unverified; pursue.

### B35-C07 — Delete obsolete PFAPI immediate-save replica tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `android-foreground-tests::removed-pfapi-immediate-save-replicas::obsolete-spec-blocks`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.2; `5068c1bd3a5fafce1e46872758d08e35ba3f927bed0112396dbf4e5cb3430ef3`.
- **Domains / category:** B35 primary, C6 related; tests of a removed mechanism.
- **Exact evidence:** `android-foreground-tracking.effects.spec.ts:552-821`
  locally reimplements `_saveTimeTrackingImmediately` and notification handlers;
  ten tests invoke only those copies. Current production instead awaits
  `_flushPendingOperations()` and op-log flush; current sequencing tests remain
  at `:1083-1198`. The old symbol/model-save logic exists only in the stale blocks.
- **Unnecessary mechanism / smallest change:** delete exactly those two describes;
  retain all exported-helper tests plus current flush/recovery/tick-gap/one-op
  scenarios. Do not broaden this into removing the spec's other copied logic
  without a distinct-scenario matrix.
- **Equivalence / invariants / failure modes:** runtime is untouched. Pause/done
  must still reconcile native time before task mutation and await pending-op
  persistence; retained current scenarios protect that ordering.
- **Evidence and history:** `55d4fd1520` introduced the PFAPI path and replicas;
  `db990b7018` replaced production with op-log flushing four days later without
  updating the spec.
- **Required verification:** focused spec before/after result and test count,
  modified-file check, exact-symbol closure, and fresh C6 scenario review.
- **Estimated delta / benefit:** −270 test LOC and ten obsolete tests; no
  production delta.
- **Blast radius / reversibility / risk / confidence:** Android test inventory;
  easy revert, low-medium coverage risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh Android/C6 reviewer;
  discovered/proposed, unverified; pursue narrowly.

### B35-C08 — Remove unused global Log context state and debug helper

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `core-log::unused-global-context-and-x-helper::direct-log-surface`;
  discovered/proposed, unverified; privacy/API-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.2; `399ff43389ce37e6227f738fd35f214945dbc6b4b7a5d13299f5e5d46b1dfa75`.
- **Domains / category:** B35 primary, C1/C8 related; dead logger API/state.
- **Exact evidence:** `log.ts:91,114-120` owns mutable global context/prefix and
  direct methods consume it at `:170-212`; `x` is at `:217-222`. Whole-repository
  exact searches find no `Log.setContext` or `Log.x` call. Direct context is
  therefore always empty; real scoped callers use separate `withContext`.
  PluginAPI exposes `PluginLog`, not these members.
- **Unnecessary mechanism / smallest change:** delete `context`, `setContext`,
  `getPrefix`, and `x`; inline the current empty prefix/context into direct calls.
  Retain `withContext`, `PluginLog`, and heavily consumed `error`/`normal` aliases.
- **Equivalence / invariants / failure modes:** preserve levels, prebound console
  functions, serialization/truncation/redaction, direct export records with
  `ctx: ''`, console argument shape, and scoped contexts.
- **Evidence and history:** `30998b21da` introduced `setContext` with no found
  caller; `2bb32b4bba` added `x`, whose last lineage caller was removed in
  `080f0b0be3`.
- **Required verification:** confirm Log is not an external/plugin contract,
  characterize empty direct context/prefix plus `withContext`, then modified-file
  checks and build/unit closure.
- **Estimated delta / benefit:** about −14 production LOC and less mutable global
  logging surface.
- **Blast radius / reversibility / risk / confidence:** shared logger; easy
  revert, low-medium API/privacy risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh logger/privacy reviewer;
  discovered/proposed, unverified; pursue after characterization.

### B35-C09 — Collapse SnackService's vacuous render switch

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `snack-render::vacuous-type-switch::single-open-from-component`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.2; `24dca6fa4033b977d398a89deff58fa67de8645ad9796ebd134b931643bf5282`.
- **Domains / category:** B35 primary, C2 related; vacuous state branch.
- **Exact evidence:** `snack.service.ts:119-128` routes ERROR, CUSTOM, SUCCESS,
  and default through the identical
  `openFromComponent(SnackCustomComponent, cfg)` call. Type remains meaningful
  earlier for duration and data but does not affect rendering.
- **Unnecessary mechanism / smallest change:** replace only the switch with one
  direct assignment; keep all type-dependent preparation unchanged.
- **Equivalence / invariants / failure modes:** identical component/config for
  every type; preserve translation, duration/data, polling class, promises,
  spinner/showWhile, persistent-action, and dismissal behavior.
- **Evidence and history:** `e829a9c29b` introduced the already-vacuous switch
  during the 2019 snack-store removal; later edits changed only its common call.
- **Required verification:** modified-file check, focused SnackService spec, and
  optional table-driven MatSnackBar spy over every type.
- **Estimated delta / benefit:** about −8 production LOC; one obvious render path.
- **Blast radius / reversibility / risk / confidence:** private service helper;
  trivial revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh UI-service reviewer;
  discovered/proposed, unverified; pursue opportunistically.

### B35-C10 — Remove the dormant full-panel boards action surface

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `boards-panel-update::unconsumed-full-panel-action-and-commented-reducer::task-id-update-path`;
  discovered/proposed, unverified; compatibility-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.3; `70fd299a18c23ae447bd0bbb195ab3399807859a73abece3972597cdcf8f7842`.
- **Domains / category:** B35 primary, C1/C3 related; dead action/API and
  commented implementation.
- **Exact evidence:** whole-repository call search finds no invocation of
  `BoardsActions.updatePanelCfg`; only its declaration/export remains at
  `boards.actions.ts:45-56,90`. Its reducer has been commented out in full at
  `boards.reducer.ts:165-196` since 2025. `BoarFieldsToRemove` is declared only
  at `boards.model.ts:47-49`. Live panel ordering uses the distinct
  `updatePanelCfgTaskIds` action from `board-panel.component.ts:253,272`.
- **Unnecessary mechanism / smallest change:** delete the unused action creator,
  namespace member, commented reducer block, and unused typo-named interface.
  Retain the serialized action-type enum entry until C3 proves historical
  op-log compatibility; do not conflate it with the live task-ID action.
- **Equivalence / invariants / failure modes:** current producers and reducers
  are unchanged. Preserve board/panel sanitization, unique panel IDs, persistent
  task ordering, and the ability to validate/reject historical serialized action
  names deliberately rather than accidentally.
- **Evidence and history:** the disabled reducer dates to `d5859521a04`; the
  persistent action wrapper was added later in `b2f5ee820d4` but no producer was
  found. `BoarFieldsToRemove` originated in `963701ac7f` and has no consumer.
- **Required verification:** exact symbol and serialized-string closure, op-log
  action-type compatibility review, boards reducer/component specs, modified-file
  checks, and a fresh sync/API reviewer.
- **Estimated delta / benefit:** roughly −50 production/comment LOC and two dead
  TypeScript exports without touching live behavior.
- **Blast radius / reversibility / risk / confidence:** boards public module and
  serialized action taxonomy; easy revert, low runtime but medium compatibility
  risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh boards and sync-compatibility
  reviewers; discovered/proposed, unverified; pursue with the enum retained.

### B35-C11 — Drop two unused focus-mode config subscriptions

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `focus-break-effects::unused-config-with-latest-from::complete-and-skip-break`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.3; `bb4eff89837d6c45d45cef2b00d6e26a273e5db6ebe00d584fc861140cf67e8b`.
- **Domains / category:** B35 primary, C1 related; redundant reactive inputs.
- **Exact evidence:** `focus-mode.effects.ts:627-643` adds
  `selectFocusModeConfig` to `autoStartSessionOnBreakComplete$` but destructures
  `config` without reading it. The same unused selector/value occurs in
  `skipBreak$` at `:659-687`. Strategy mode, current task, and action payload
  alone determine every branch and emitted action.
- **Unnecessary mechanism / smallest change:** remove only those two selector
  reads and tuple slots; keep the effects separate and leave all actual config
  consumers untouched.
- **Equivalence / invariants / failure modes:** identical actions for complete/
  skipped breaks, paused-task resumption, auto-start policy, and duration. Config
  changes no longer create needless tuple emissions, but action-driven behavior
  and sync boundaries remain unchanged.
- **Evidence and history:** `f945c9850ce` introduced both unused reads during a
  focus-mode settings change; surrounding logic predates them and never consumed
  the values.
- **Required verification:** focused break-completion/skip specs, an explicit
  config-change non-emission characterization, modified-file checks, and fresh
  focus-mode review.
- **Estimated delta / benefit:** about −4 production LOC and two unnecessary
  store subscriptions/tuple dimensions.
- **Blast radius / reversibility / risk / confidence:** local effects only; trivial
  revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh focus-mode reviewer;
  discovered/proposed, unverified; pursue opportunistically.

### B35-C12 — Prune duplicated and vacuous FocusModeEffects tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `focus-effects-spec::duplicate-scenarios-and-tautological-sync-test::real-effect-contract`;
  discovered/proposed, unverified; characterization-required.
- **Baseline / origin / revision hash:** `9b448133…`; B35.3; `a45039d862580efc77eeab547de6b1696ec2cc95ab0701216923fa8e0f77b289`.
- **Domains / category:** B35 primary, C6 related; low-signal test inventory.
- **Exact evidence:** the 2,945-line spec repeats six exact test titles, has a
  `combined behavior` case at `:909-923` that repeats the immediately preceding
  paused-task test, and repeats pause-tracking cases at `:2348-2391` and
  `:2873-2943`. The rapid-sync toggle case at `:1827-1865` concludes only
  `expect(emitCount).toBeGreaterThanOrEqual(0)`, which cannot fail for its
  initialized counter. The `Bug #5954 Additional Edge Cases` block re-exercises
  earlier missing/done/paused-task and break cases.
- **Unnecessary mechanism / smallest change:** build a named scenario matrix,
  delete only exact/strictly weaker duplicates and the tautological test, and
  retain one strongest test for every action, timer purpose, sync-window, task
  existence, and ordering branch.
- **Equivalence / invariants / failure modes:** production is untouched. Coverage
  must retain sync suppression/recovery, pairwise task capture, work/break pause
  behavior, Flowtime ordering, duration-zero/overtime, and user task-switch
  protection; title equality alone is not sufficient proof of duplication.
- **Evidence and history:** the vacuous toggle test and adjacent sync variants
  landed together in `1997081a01`; duplicated pause-tracking blocks trace to
  `7b099af796` and later bug-specific additions accumulated beside them.
- **Required verification:** C6 scenario-to-assertion matrix, focused spec before/
  after test count and results, mutation/branch review for removed cases, and a
  fresh reviewer independent from the production cleanup.
- **Estimated delta / benefit:** conservatively −180 to −350 test LOC and faster,
  less timing-sensitive focus tests.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, medium false-coverage risk, reproduced examples but matrix pending.
- **Verifiers / disposition / recommendation:** fresh C6/focus reviewer;
  discovered/proposed, unverified; pursue only after scenario mapping.

### B35-C13 — Collapse stale IdleService and IdleEffects scaffolding

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `idle-core::redundant-selector-wrapper-fake-async-and-debug-tombstone::idle-services`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.3; `7b14be90aec1cdbb4e76c65c2a7e3c05dc5e0b2ef008d90368571f1660b33c73`.
- **Domains / category:** B35 primary; redundant wrapper/signature/comments.
- **Exact evidence:** `idle.service.ts:13-18` wraps `store.select(selectIsIdle)`
  in a private observable plus `distinctUntilChanged/shareReplay`, although NgRx
  selector output already supplies the live distinct state stream. In
  `idle.effects.ts:395-407`, `_updateSimpleCounterValues` contains no await and
  both callers ignore its synthetic promise. A commented debug constructor
  remains at `:370-376`.
- **Unnecessary mechanism / smallest change:** expose the selector stream
  directly, make the private counter helper synchronous `void`, and delete the
  commented dispatch harness. Do not restructure idle-dialog orchestration.
- **Equivalence / invariants / failure modes:** consumers still receive current
  idle transitions; counter updates remain synchronous and in the same order;
  idle polling, focus-session handling, dialog serialization, and sync guards
  remain untouched.
- **Evidence and history:** the observable wrapper dates to `7858d07eac`; the
  fake-async helper to `af43ed3aef`. Neither acquired asynchronous work, and the
  debug harness is historical residue.
- **Required verification:** characterize selector replay/distinct behavior,
  IdleService consumer tests, IdleEffects counter/dialog tests, modified-file
  checks, and fresh idle-owner review.
- **Estimated delta / benefit:** roughly −12 to −16 production/comment LOC and
  one truthful synchronous contract.
- **Blast radius / reversibility / risk / confidence:** shared idle observable and
  private helper; easy revert, low-medium subscription-semantics risk, supported.
- **Verifiers / disposition / recommendation:** fresh idle/reactive reviewer;
  discovered/proposed, unverified; pursue as a bounded cleanup.

### B35-C14 — Remove content-bearing calendar-event debug logs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `calendar-banner::event-object-debug-log::exportable-log-history`;
  discovered/proposed, unverified; privacy-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.3; `3e01545b28d8b6ca57d9a770eaa6113c50721fda117d59fc47838094cd18d799`.
- **Domains / category:** B35 primary, C8 related; privacy/logging residue.
- **Exact evidence:** `_addEvToShow` at
  `calendar-integration.effects.ts:227-239` calls
  `Log.log('addEvToShow', curVal, calEv)`. `CalendarIntegrationEvent` explicitly
  contains user titles, descriptions, URLs, IDs, and provider IDs, while `curVal`
  also embeds provider configuration. `Log` records every call to exportable
  history (`log.ts:1,73-94,123-162,228-271`). A second adjacent typo-only debug
  message (`UDATE _currentlyShownBanners$`) carries no diagnostic state.
- **Unnecessary mechanism / smallest change:** delete the object-bearing log and
  the adjacent stale update marker. Add no replacement unless a privacy-safe ID-
  free counter is proven operationally necessary.
- **Equivalence / invariants / failure modes:** banner deduplication, sorting,
  provider filtering, and display behavior are unchanged. Exported diagnostics
  lose only unsolicited calendar/provider content.
- **Evidence and history:** object logging originated as console-era debug code;
  `97f96f2393` mechanically converted it to `Log.log`, thereby making it part of
  retained/exportable history. The neighboring marker dates to `bb337cc422`.
- **Required verification:** C8 exported-history characterization with a sentinel
  title/description/URL, negative log scan, calendar integration/effect specs,
  modified-file checks, and a fresh privacy reviewer.
- **Estimated delta / benefit:** −2 production LOC and removal of a concrete
  user-content disclosure path from diagnostics.
- **Blast radius / reversibility / risk / confidence:** diagnostics only; trivial
  revert, very low behavior risk and high privacy value, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh privacy/calendar reviewer;
  discovered/proposed, unverified; prioritize for admission.

### B35-C15 — Make backlog disabling one persistent operation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `project-backlog-disable::effect-generated-second-persistent-op::project-update-and-legacy-move-action`;
  discovered/proposed, unverified; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B35.4; `defefc52971116e28214bfc611c99c8b7bd40071feda7b39367204afc384bf72`.
- **Domains / category:** B35 primary, C1 related; effect fan-out/persistent-op
  boundary.
- **Exact evidence:** `project.effects.ts:59-70` reacts to
  `updateProject(isEnableBacklog:false)` by dispatching a second action;
  `project.actions.ts:284-294` marks that generated action persistent, and
  `project.reducer.ts:151,623-635` applies the flag and task-list transfer in two
  reducer passes. `plugin-hooks.effects.ts:314-335` observes both. Static closure
  found no other producer of the move-all action.
- **Unnecessary mechanism / smallest change:** make the `updateProject` reducer
  append current backlog IDs to regular task IDs and clear the backlog when the
  flag becomes false; remove only the generating effect and its three specs.
  Retain the legacy action creator, reducer handler, action type, and plugin-hook
  registration so historical persisted operations can still replay.
- **Equivalence / invariants / failure modes:** one user intent becomes one new
  op; preserve regular-then-backlog order and idempotent historical two-op replay.
  Plugin hooks change from two notifications to one for new operations, and
  concurrent project-op conflict boundaries change, so both require review.
- **Evidence and history:** `d6708d8d18` introduced the two-step flow before the
  op log; `f4df0731e3` later made the second action persistent. `03ddbb5ab4`
  moved the effect to `LOCAL_ACTIONS`, so remote replay of the first op cannot
  recreate its companion.
- **Required verification:** action-capture count, new one-op replay, historical
  two-op replay, plugin-hook emissions, concurrent project updates, reducer
  specs, scheduled SuperSync, and two fresh sync/plugin reviewers.
- **Estimated delta / benefit:** about −12 production and −50 test LOC plus the
  core one-intent/one-op invariant.
- **Blast radius / reversibility / risk / confidence:** synced project state and
  plugin events; reversible but high data-convergence risk, supported evidence.
- **Verifiers / disposition / recommendation:** two fresh sync-critical reviewers;
  discovered/proposed, unverified; pursue only if Wave E budget permits both.

### B35-C16 — Delete the identical project lookup alias

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `project-lookup::identical-catch-error-alias-after-selector-contract-change::project-service-and-note-consumer`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.4; `47142eb66dd7097d2f19f6376f175097f5fdbd98000294446c181da39e689eb4`.
- **Domains / category:** B35 primary, C1 related; duplicate service API.
- **Exact evidence:** `project.service.ts:354-366` implements `getByIdOnce$` and
  `getByIdOnceCatchError$` byte-for-byte identically. Repository closure finds
  one alias caller, `note.component.ts:109`.
- **Unnecessary mechanism / smallest change:** switch that caller to
  `getByIdOnce$` and delete the alias; add no replacement helper.
- **Equivalence / invariants / failure modes:** missing projects still yield
  `undefined`, invalid empty IDs still throw, and selector logging stays unchanged.
- **Evidence and history:** `1c73db9cae5` changed `selectProjectById` to return
  `undefined` and removed the alias's `catchError`, leaving two names for one
  contract.
- **Required verification:** exact symbol/reflection closure, Note component and
  ProjectService specs, modified-file checks, and external/dynamic API review.
- **Estimated delta / benefit:** −7 production LOC and one misleading contract.
- **Blast radius / reversibility / risk / confidence:** service plus one consumer;
  easy revert, low API risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh project/API reviewer;
  discovered/proposed, unverified; pursue.

### B35-C17 — Remove the simulated Planner/Today integration spec

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `planner-today::mockstore-post-dispatch-state-invention::planner-today-sync-spec`;
  discovered/proposed, unverified; characterization-required.
- **Baseline / origin / revision hash:** `9b448133…`; B35.4; `ec7c07738973231137d9251f53b3454f05d7bfd722e55fa330ce9bac8ace2f47`.
- **Domains / category:** B35 primary, C6 related; test that invents its result.
- **Exact evidence:** all five cases in `planner-today-sync.spec.ts:91-350`
  dispatch an action, manually install the expected post-reducer state, override
  `selectTodayTaskIds` with the expected answer, then assert that override. No
  production reducer or selector result is exercised. Real coverage exists in
  `planner-shared.reducer.spec.ts:234+` and
  `task-shared-crud.reducer.spec.ts:169+,2248+`.
- **Unnecessary mechanism / smallest change:** map the five named scenarios to
  real reducer/selector coverage, add only a genuinely missing production-owner
  case, then delete the 351-line simulated file.
- **Equivalence / invariants / failure modes:** runtime is untouched. Preserve
  today/future planning, recurring due-today creation, virtual `TODAY_TAG`, and
  Today selector visibility through real code paths.
- **Evidence and history:** `4b63554b185` explicitly converted the suite to
  simulated meta-reducer behavior because MockStore does not run meta-reducers.
- **Required verification:** C6 scenario matrix, focused real meta-reducer/
  selector specs before and after, test count, and fresh test-integrity reviewer.
- **Estimated delta / benefit:** up to −351 test LOC and removal of false
  integration confidence.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, medium coverage risk until mapped, supported evidence.
- **Verifiers / disposition / recommendation:** fresh C6/planner reviewer;
  discovered/proposed, unverified; pursue after mapping.

### B35-C18 — Replace the copied planner calendar partitioner tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `planner-calendar::copied-private-event-partitioner-tests::planner-selectors-spec-and-source`;
  discovered/proposed, unverified; characterization-required.
- **Baseline / origin / revision hash:** `9b448133…`; B35.4; `289563eea26863d48fccb4beb93a5a08b70878a63e6d59a2e16bf8d093648d88`.
- **Domains / category:** B35 primary, C6 related; copied production logic in tests.
- **Exact evidence:** `planner.selectors.spec.ts:30-315` defines and tests a local
  `getIcalEventsForDay`; production separately implements the behavior at
  `planner.selectors.ts:375-407`. The copy compares local calendar components and
  classifies all-day events itself, while production now applies
  `startOfNextDayDiffMs`, `getDbDateStr`, and `isAllDayCalendarEvent`. Actual
  `selectPlannerDays.projector` tests already exist at spec `:465-644`.
- **Unnecessary mechanism / smallest change:** remove the copied helper/describe
  and unused scaffolding; port only unique scenario intent into a small table
  through the real selector, including a nonzero logical-day offset boundary.
- **Equivalence / invariants / failure modes:** runtime is untouched. Retain
  logical-day offset, all-day/24-hour classification, provider/property
  preservation, event-day filtering, and time-budget exclusion.
- **Evidence and history:** the copy landed in `26723bfa6d6`; production became
  logical-day-offset aware in `03572c3f2c` without updating it, demonstrating
  drift and false confidence.
- **Required verification:** C6 scenario matrix, real projector cases at zero and
  nonzero offset plus DST adjacency, focused spec, and fresh planner reviewer.
- **Estimated delta / benefit:** roughly −250 to −300 test LOC with assertions
  moved onto production behavior.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, medium coverage risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh C6/planner reviewer;
  discovered/proposed, unverified; pursue.

### B35-C19 — Share the two simple-counter chart builders

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `metric-chart::parallel-click-and-stopwatch-chart-builders::metric-selectors`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.4; `62f483b4d3ec93a765e465a88bb2c8a82c6389d7bc54795e2b81fd31cf8d8c7b`.
- **Domains / category:** B35 primary; local duplicate pure algorithms.
- **Exact evidence:** `metric.selectors.ts:73-131` contains parallel 29-line
  click-counter and stopwatch chart builders; only counter type and value
  conversion differ. Both exports flow through MetricService, and ten focused
  selector tests cover their contracts.
- **Unnecessary mechanism / smallest change:** add one private pure builder
  parameterized only by `SimpleCounterType` and value conversion; retain both
  exported selectors and service APIs.
- **Equivalence / invariants / failure modes:** preserve sorted/sliced day union,
  labels, `undefined` for zero/missing values, stopwatch millisecond-to-minute
  rounding, and selector memoization boundaries.
- **Evidence and history:** both selectors originated in `5c0232b33c`; count-map
  guards and chart fixes have repeatedly modified both blocks in lockstep.
- **Required verification:** existing ten selector tests, explicit zero-value
  regression, modified-file checks, and fresh metrics reviewer.
- **Estimated delta / benefit:** about −20 to −25 production LOC with no public
  API change.
- **Blast radius / reversibility / risk / confidence:** pure selectors; easy
  revert, low risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh metrics reviewer;
  discovered/proposed, unverified; pursue opportunistically.

### B35-C20 — Make owner-local task and reminder diagnostics privacy-safe

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `privacy-safe-logging::raw-task-reminder-payloads::reminder-tag-repeat-effects`;
  discovered/proposed, unverified; privacy-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.5; `23150221dbb76bb3c4ca160d0c675e3faa08aa20d1b397ba71544d904d38bccf`.
- **Domains / category:** B35 primary, C8 related; content-bearing debug logs.
- **Exact evidence:** `reminder.service.ts:110-114` logs full
  `WorkerReminder[]` objects whose titles are populated at `:106`;
  `tag.effects.ts:128-138` logs an object containing full tasks; and
  `task-repeat-cfg.effects.ts:718-719,759` logs repeat changes, live/archive
  tasks, and archive changes that can contain titles and notes.
- **Unnecessary mechanism / smallest change:** delete the five debug calls and
  now-unused `environment`/repeat `Log` imports. If diagnostics are proven
  necessary, retain only privacy-reviewed counts, IDs, and changed-field names.
- **Equivalence / invariants / failure modes:** state, scheduling, dispatch,
  persistence, reminder delivery, repeat creation, and tag ordering are
  unchanged. Exportable diagnostics no longer capture user content.
- **Evidence and history:** exact `Log.log`/`console.log` closure reproduced the
  five sites. The reminder log came from `3129c1dbca`; tag/archive logs came
  through the console-to-exportable-log conversion `97f96f2393`; current repeat
  logs blame to the `3d2c811e78` RRULE revert.
- **Required verification:** modified-file checks on all three TS files, focused
  reminder/tag/repeat effect specs, negative sentinel scan of exported logs, and
  a fresh privacy/domain reviewer.
- **Estimated delta / benefit:** about −9 production LOC; concrete privacy gain
  with no intended behavior change.
- **Blast radius / reversibility / risk / confidence:** diagnostics only; trivial
  revert, low behavior risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh privacy/reminder/repeat
  reviewer; discovered/proposed, unverified; prioritize for admission.

### B35-C21 — Remove superseded TagService read APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `unused-tag-read-surface::zero-runtime-consumers::tag-service-and-selector`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.5; `41ff4452841e9cc6e5269c3248edc0386f3afd482c29e1cf9da2de72c53538af`.
- **Domains / category:** B35 primary, C1 related; unused selector/service API.
- **Exact evidence:** repository-wide exact searches find no production consumer
  for `tagsSortedForUI$`, `tagsSortedForUI`, the signal
  `tagsNoMyDayAndNoListSorted`, or `getTagsByIds$`. `selectTagsByIds` occurs only
  in its definition, the service wrapper, and direct service tests. The live
  observable `tagsNoMyDayAndNoListSorted$` is a distinct API and remains used.
- **Unnecessary mechanism / smallest change:** remove only those dead service
  properties/wrapper, the selector, imports, and direct tests. Keep tree-order
  APIs and `tagsNoMyDayAndNoListSorted$`.
- **Equivalence / invariants / failure modes:** no runtime consumer, action,
  entity shape, tag ordering, persisted format, or plugin API changes. The main
  failure mode is an undiscovered dynamic consumer.
- **Evidence and history:** sorted APIs entered in `cc002d192e`; `d50c74eda7`
  moved UI consumers to tree-order signals and left this surface behind. The
  by-ID selector/wrapper dates to the earlier 2019–2020 service design.
- **Required verification:** exact and bracket/reflection/public-barrel closure,
  modified-file checks, tag service/reducer specs, TypeScript build, and a fresh
  tag/API reviewer.
- **Estimated delta / benefit:** about −22 production and −13 test LOC; smaller
  misleading read surface.
- **Blast radius / reversibility / risk / confidence:** private app service plus
  selector; easy revert, low API risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh tag/API reviewer;
  discovered/proposed, unverified; pursue.

### B35-C22 — Trim dormant repeat-config mutation facade while preserving replay

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `unused-repeat-mutation-surface::zero-runtime-producers-preserve-persisted-actions`;
  discovered/proposed, unverified; compatibility-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.5; `dde454663b400ed67cb8d2961e352247da299d7355d7bc80ed583b54fa8bd38f`.
- **Domains / category:** B35 primary, C1/C3 related; dormant service/action
  surface with replay constraints.
- **Exact evidence:** `deleteTaskRepeatCfgsNoTaskCleanup`, the
  `updateTaskRepeatCfgs` service wrapper, and the `upsertTaskRepeatCfg` service
  wrapper have only definition/test/comment references. The singular
  `upsertTaskRepeatCfg` action is non-persistent and has no runtime producer.
  Whole-repository exact searches reproduce that closure.
- **Unnecessary mechanism / smallest change:** remove the three dead service
  wrappers/imports/tests. Remove the zero-producer non-persistent singular
  upsert action, reducer handler, and tests only after raw/dynamic action closure.
  Explicitly retain the plural update/delete and singular delete action creators
  and reducers because historical persisted ops or older clients may replay them.
- **Equivalence / invariants / failure modes:** current mutation behavior stays
  unchanged and serialized replay names remain available. The failure mode is a
  raw producer constructing the nominally non-persistent action type.
- **Evidence and history:** wrappers originate in 2019–2021 flows;
  `79c2136572` removed repeat action-based save effects when persistence became
  centralized. Old project-delete alternatives survive only as comments from
  `e88b0aea5c`.
- **Required verification:** raw action-type/dynamic/plugin searches, persisted-
  action metadata tests, an old-op replay fixture, repeat service/reducer specs,
  modified-file checks, and a fresh compatibility reviewer.
- **Estimated delta / benefit:** roughly −21 production and −65 to −70 test LOC
  if the guarded action removal is proven; less if only wrappers are removed.
- **Blast radius / reversibility / risk / confidence:** repeat API/reducer and
  possible old traffic; easy code revert but medium compatibility risk,
  supported evidence.
- **Verifiers / disposition / recommendation:** fresh C3/repeat reviewer;
  discovered/proposed, unverified; prefer wrapper-only scope if action provenance
  remains uncertain.

### B35-C23 — Centralize recurring-config eligibility checks

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `repeat-eligibility-invariant::duplicated-selector-prefilter::repeat-selectors`;
  discovered/proposed, unverified; sync-critical.
- **Baseline / origin / revision hash:** `9b448133…`; B35.5; `32bf73cc1c1a7bad835bc4a94a138c324db84199eb0ca02184ec5e81dcbc74e7`.
- **Domains / category:** B35 primary; C2-style duplicated pure logic. Fast-track
  does not authorize a standalone C2 run.
- **Exact evidence:** `task-repeat-cfg.selectors.ts:88-165` contains two
  selectors that independently implement the same paused, effective-cursor,
  future-cursor, deleted-instance, date-conversion, and newest-due checks; only
  the final exact-day versus overdue predicate differs.
- **Unnecessary mechanism / smallest change:** extract a private helper returning
  the eligible newest due date or `null`. Keep final predicates explicit:
  exact-day requires `isSameDay`; unprocessed/overdue requires only an eligible
  due date. Do not add a boolean “mode” or shared memoized selector.
- **Equivalence / invariants / failure modes:** preserve logical-day conversion,
  pause behavior, future cursor suppression, deleted dates, exact-day matching,
  overdue catch-up, and projector memoization. Consumers include task creation,
  planner/schedule projectors, and mobile reminder pre-scheduling.
- **Evidence and history:** both copies arrived in `d4e5673e55d`; later pause and
  deleted-instance/cursor fixes (`0414b743650`, `6b3675cd611`) had to be mirrored.
- **Required verification:** two fresh reviewers, full selector/repeat/mobile-
  notification/planner/schedule/timezone suites, and a before/after corpus across
  paused/cursor/deleted/exact/overdue cases.
- **Estimated delta / benefit:** net −20 to −30 production LOC and one owner for
  a repeatedly mirrored invariant.
- **Blast radius / reversibility / risk / confidence:** recurring-task creation
  and logical day; reversible but high convergence/scheduling risk, supported.
- **Verifiers / disposition / recommendation:** requires two fresh sync/logical-
  day reviewers; discovered/proposed, unverified. Because standalone C2 is
  omitted and reviewer budget is capped, do not admit unless D1 finds a covered
  cross-cutting owner and both reviewers are available.

### B35-C24 — Prune duplicate repeat reducer registration and debug tombstones

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `repeat-delete-semantics::duplicate-reducer-registration-and-debug-tombstones`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.5; `b03e117cf7fa725ddbe8e10427e9f75163990b48d850ae3d80e6707f567c7b2f`.
- **Domains / category:** B35 primary, C1/C6 related; duplicate handler and inert
  debug/test residue.
- **Exact evidence:** `task-repeat-cfg.reducer.ts:72,83` registers the identical
  delete reducer twice; `:43-56` is a commented alternative after an
  unconditional return. `task-repeat-cfg.selectors.ts:188-206` is a disabled
  debug override; its spec `:256-297` has three disabled tests and `:435,509`
  has debug console output.
- **Unnecessary mechanism / smallest change:** remove only the second identical
  handler and the inert comments/logs/disabled tests. Retain the first handler,
  action type, active delete tests, and all replay contracts.
- **Equivalence / invariants / failure modes:** the first handler produces the
  same reducer result; active selector/delete behavior and serialized actions
  remain unchanged.
- **Evidence and history:** both handlers have coexisted since `6e3ddf008b`;
  unreachable alternatives came from `e88b0aea5c`, debug override from
  `df829fd4d15`, and disabled tests from the 2025 selector-test move.
- **Required verification:** repeat reducer/selector specs, modified-file checks,
  exact handler closure, and a fresh repeat reviewer.
- **Estimated delta / benefit:** about −34 production and −44 test LOC; removes
  one exact duplicate and historical noise.
- **Blast radius / reversibility / risk / confidence:** reducer/test inventory;
  easy revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh repeat reviewer;
  discovered/proposed, unverified; pursue independently or combine with the
  wrapper-only portion of B35-C22 after D1.

### B35-C25 — Delete dormant work-context and page scaffolding

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `dead-page-scaffolding::zero-consumer-fields-and-no-op-load::work-context-work-view-daily-summary`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.7; `13ef167a6df5a7543b3ae916c5290d9d1945275e6f627b85b05ec64701ede9bf`.
- **Domains / category:** B35 primary, C1 related; dead method, constant branch,
  and never-read fields.
- **Exact evidence:** `work-context.service.ts:633-638` exposes an empty
  `load(): Promise<void>` whose commented implementation is obsolete; exact
  repository searches find no caller. `work-view.component.ts:351` initializes
  `isShowTimeWorkedWithoutBreak` to `true` and never writes it, so the sole
  template branch at `work-view.component.html:53` is constant.
  `_switchListAnimationTimeout` is only declared at `:380` and conditionally
  cleared at `:506-507`, never assigned. In
  `daily-summary.component.ts:180-182,266`, `hasTasksForToday$` and
  `actionsToExecuteBeforeFinishDay` have no template, test, or production
  consumer.
- **Unnecessary mechanism / smallest change:** delete the no-op load method,
  inline the always-enabled work-view block, remove the never-assigned timeout
  cleanup, and remove the two unused daily-summary fields plus now-unused
  imports. Keep the rendered time-without-break content and all live lifecycle
  logic.
- **Equivalence / invariants / failure modes:** no action, subscription, route,
  persisted shape, plugin contract, or sync ordering changes. The material
  failure mode is a dynamic template or reflective call missed by textual
  closure.
- **Evidence and history:** exact symbol and call-form searches reproduce only
  the cited declarations/template/cleanup. Work-context `load` predates its
  explicit async return type in `3e8865e9aa`; the work-view flag and timeout
  trace to `0cbd272bbc`; no later producer or consumer was found.
- **Required verification:** repeat exact/bracket/template searches, compile and
  modified-file checks, focused work-context/work-view/daily-summary specs, and
  one fresh UI/API reviewer.
- **Estimated delta / benefit:** about −15 to −25 production/template LOC;
  removes misleading lifecycle and optionality signals.
- **Blast radius / reversibility / risk / confidence:** four app files; trivial
  revert, low behavioral risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh UI/API reviewer;
  discovered/proposed, unverified; pursue.

### B35-C26 — Put copied native-date tests on production boundaries

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `date-test-oracles::copied-native-date-and-range-logic::worklog-daily-summary`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.7; `1f4c0dd7731810623b82c2f53f1c666ed3f8f41538577eaeb3fa146a1533b9e5`.
- **Domains / category:** B35 primary, C6 related; copied implementation and
  false-oracle tests.
- **Exact evidence:** `worklog.service.spec.ts:14-30` splits date strings and
  constructs `Date` objects locally without invoking `WorklogService`.
  `daily-summary.component.spec.ts:283-316` likewise tests a locally constructed
  `new Date()` and never calls the component's finish-day methods.
  `worklog.service.timezone.spec.ts:1-117` copies range filtering over local
  arrays, conditionally asserts by host timezone, and never instantiates
  `WorklogService`; the root suite runs every spec in Berlin and Los Angeles at
  `package.json:133-137`.
- **Unnecessary mechanism / smallest change:** delete the two generic native-
  Date blocks and replace the copied timezone-filter suite with one direct
  `WorklogService` range-boundary characterization, reusing the existing
  context-aware service setup. Do not remove distinct worklog or finish-day
  sync/error scenarios.
- **Equivalence / invariants / failure modes:** production behavior is untouched.
  The replacement must preserve an assertion against the actual inclusive
  local-day boundary in a negative UTC offset; otherwise deletion would erase
  the regression intent while only removing its current false oracle.
- **Evidence and history:** both “moment replacement” blocks entered in
  `0080154ca5`; the standalone timezone copy entered in `f499802306`. Exact
  service-reference inspection confirms that none of the three blocks executes
  the production path.
- **Required verification:** map the regression to the real service method,
  run the focused worklog and daily-summary specs in Berlin and Los Angeles,
  run modified-file checks, and obtain a fresh test/logical-day review.
- **Estimated delta / benefit:** likely −80 to −110 test LOC after one focused
  replacement; fewer misleading oracles and less duplicated timezone work.
- **Blast radius / reversibility / risk / confidence:** tests only; easy revert,
  medium coverage risk, reproduced structural evidence.
- **Verifiers / disposition / recommendation:** fresh C6/logical-day reviewer;
  discovered/proposed, unverified; pursue only with the production-boundary
  replacement pinned first.

### B35-C27 — Share the PluginBridge test provider scaffold

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `plugin-test-harness::repeated-testbed-provider-inventory::plugin-bridge-specs`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.7; `ba9b5e8a6c08e077380fb715f94b4f2c8354bc71bcfc7d20610dc16649be6e78`.
- **Domains / category:** B35 primary, B23-B30/C5 and C6 related; duplicated
  test dependency setup.
- **Exact evidence:** four PluginBridge specs total 1,724 lines and contain ten
  `TestBed` provider blocks: seven in `plugin-bridge.service.spec.ts` and one
  each in the add-task, counter, and work-context specs. Each repeats most of
  the same 15–20 dependencies, including hooks, persistence, configuration,
  archive, translation, sync, theme, HTTP, and data-init services, while only a
  few behavior-specific spies differ.
- **Unnecessary mechanism / smallest change:** add one test-only factory for the
  default PluginBridge providers with explicit per-suite overrides. Keep
  behavior-specific subjects and spies beside their tests, and do not introduce
  a production facade or generic Angular test framework.
- **Equivalence / invariants / failure modes:** production code and plugin APIs
  are unchanged. Provider precedence, spy identity, teardown, and suites that
  intentionally omit methods must remain explicit; an over-permissive default
  could hide a newly required dependency.
- **Evidence and history:** exact provider/symbol counts reproduce ten blocks
  across the four files. The foundational scaffold came from `d4d81bf511`, and
  later feature/privacy commits repeatedly copied or extended it, including
  `8a331c05ba`, `b96321fe57`, `9176fa5238`, `9a7a86c8ec`, and
  `0c07053032`.
- **Required verification:** audit provider override parity, run all four
  focused specs, compile and check every changed spec/helper, and obtain one
  fresh plugin-test reviewer.
- **Estimated delta / benefit:** roughly −300 to −500 test LOC; one maintained
  dependency inventory instead of ten near-copies.
- **Blast radius / reversibility / risk / confidence:** test harness only; easy
  revert, medium false-positive/false-negative risk, reproduced duplication.
- **Verifiers / disposition / recommendation:** fresh plugin-test reviewer;
  discovered/proposed, unverified; pursue with a deliberately narrow helper.

### B35-C28 — Delete the unreachable pre-lazy PluginService loader

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `plugin-runtime::unreachable-pre-lazy-loader-subtree::plugin-service`;
  discovered/proposed, unverified; compatibility-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.7; `31a3e12a572db8b5fe156130d39a152a4244c1d6a407ac22947a0d8965a799a6`.
- **Domains / category:** B35 primary, C1/C3 related; superseded loader
  subsystem and public zero-consumer entry point.
- **Exact evidence:** in `plugin.service.ts`, `_loadBuiltInPlugins:284-289` and
  `_loadUploadedPlugins:807-833` have no callers; `_loadPluginsFromPaths:836-861`
  is called only by the dead built-in method; `_loadPlugin:863-986` is reached
  only through that chain and `loadPluginFromPath:1237-1244`, for which an exact
  repository search finds no consumer. Startup instead calls
  `_discoverBuiltInPlugins`, `_discoverUploadedPlugins`, and
  `_loadEnabledPlugins` at `:165-169`, with activation using
  `_loadPluginLazy:585,649`.
- **Unnecessary mechanism / smallest change:** remove only the unreachable
  pre-lazy methods and zero-consumer public bridge. Preserve ZIP upload,
  discovery/state registration, consent checks, activation, lazy loading,
  iframe generation, and loaded-plugin persistence.
- **Equivalence / invariants / failure modes:** current startup and activation
  paths remain. The main risks are an untyped/reflection-based caller of the
  public method or a legacy plugin workflow that bypasses repository call sites;
  removal must not weaken manifest validation, permissions, or secret handling.
- **Evidence and history:** exact symbol/call-form searches reproduce the closed
  dead chain and the separate live lazy chain. All five legacy methods originated
  in foundational plugin commit `d4d81bf511`; no later owner was found.
- **Required verification:** bracket/reflection/plugin-doc/public-surface and
  dynamic-consumer closure, compile, all PluginService and ZIP/activation tests,
  modified-file check, and a fresh API/plugin-security reviewer.
- **Estimated delta / benefit:** about −190 production LOC; removes a second
  loader lifecycle and its divergent security/validation policy surface.
- **Blast radius / reversibility / risk / confidence:** central plugin service
  and nominally public method; easy code revert, high compatibility/security
  risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh API/plugin-security
  reviewer; discovered/proposed, unverified; investigate for admission only
  after C1 and C3 closure.

### B35-C29 — Remove PluginService legacy and zero-consumer read APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `plugin-runtime::legacy-and-zero-consumer-read-accessors::plugin-service`;
  discovered/proposed, unverified; compatibility-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.7; `d1292e47a1f7131c6b4d2e2e9b629b7554b049c4690e6cbff64cdc9ae12ab98e`.
- **Domains / category:** B35 primary, C1/C3 related; unused public read surface.
- **Exact evidence:** `plugin.service.ts:1033-1070` `getAllPluginsLegacy()` is
  used only by its direct spec; `getLoadedPlugins:1072-1074` and
  `getLoadedPlugin:1080-1085` are likewise referenced only by direct tests.
  `getPluginIcon:1112-1114` has no consumer; live UI consumers use
  `getPluginIconsSignal()` at `:1119` from the icon component and magic-nav
  configuration. The same-named `PluginRunner.getLoadedPlugin` is a separate
  method and remains live.
- **Unnecessary mechanism / smallest change:** delete those four accessors,
  their direct-only tests, and now-unused imports. Preserve `getAllPlugins`,
  plugin-state queries, initialization status, lazy activation, and the signal-
  based icon API.
- **Equivalence / invariants / failure modes:** repository runtime behavior is
  unchanged. Dynamic JavaScript access or an undocumented plugin-facing API is
  the removal risk, so nominally public surface closure is required even though
  static consumers are absent.
- **Evidence and history:** repository-wide exact searches reproduce only the
  definitions and cited direct tests. The accessors date to foundational commit
  `d4d81bf511`; the legacy test was revived in `196e50b906`, but no runtime
  consumer was restored.
- **Required verification:** bracket/reflection/docs/plugin-package closure,
  compile, focused PluginService/UI icon tests, modified-file checks, and a
  fresh API/plugin reviewer.
- **Estimated delta / benefit:** about −50 production LOC plus direct-only tests;
  smaller and less misleading PluginService API.
- **Blast radius / reversibility / risk / confidence:** nominally public app
  service; easy revert, medium compatibility risk, reproduced static evidence.
- **Verifiers / disposition / recommendation:** fresh API/plugin reviewer;
  discovered/proposed, unverified; pursue after C1/C3 confirmation.

### B35-C30 — Retire the superseded monolithic task-shared reducer spec

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `task-shared-meta-reducer-coverage::superseded-monolithic-plus-split-owner-suites::task-shared.reducer.spec.ts+task-shared-meta-reducers/*-shared.reducer.spec.ts`;
  discovered/proposed, unverified; sync-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.8; `1baaf892fbdfc927ff4688469f2ef712151b1bb93221f67f3b938c39ad78c555`.
- **Domains / category:** B35 primary, C6 related; superseded monolithic test
  inventory after reducer-suite split.
- **Exact evidence:** `task-shared.reducer.spec.ts` is 2,709 lines with 99 test
  cases; 93 titles exactly match cases in the split owner suites. The six
  unmatched titles start at lines `266,282,1541,1862,2508,2524`; semantic
  neighbors already exist for done timestamps, TODAY ordering, future planner
  days, and deadline creation, but title matching alone does not prove assertion
  equivalence. Production and integration consumers use
  `createCombinedTaskSharedMetaReducer`, not the monolithic spec.
- **Unnecessary mechanism / smallest change:** build an assertion-level 99-case
  matrix, move only genuinely unique ingress/marker assertions to the relevant
  split suites, update stale references in `task.reducer.spec.ts:85,92`, then
  delete the monolith. Do not change the combined reducer or its ordering.
- **Equivalence / invariants / failure modes:** production is untouched. Every
  persisted action, replay path, reducer order, TODAY/logical-day rule,
  delete-wins marker, and unique edge assertion must remain owned; exact title
  duplication can still hide different fixtures or expectations.
- **Evidence and history:** mechanical test-title inventory reproduces 93/99
  matches. `9bf9d82d44` added roughly 2,930 lines across six split suites while
  retaining the monolith; `0854d469ef` split production reducers and barely
  changed the old suite.
- **Required verification:** assertion-by-assertion matrix for all 99 cases,
  focused old/new suite runs, test-count reconciliation, mutation challenges for
  each uniquely retained invariant, modified-file checks, and a fresh task-
  reducer/sync-test reviewer.
- **Estimated delta / benefit:** up to −2,709 test LOC after small migrations;
  one maintained owner per task-shared reducer concern.
- **Blast radius / reversibility / risk / confidence:** test inventory only;
  easy revert, medium-high coverage risk and large validation cost, supported
  evidence.
- **Verifiers / disposition / recommendation:** fresh task-shared/C6 reviewer;
  discovered/proposed, unverified; investigate for admission only if the full
  assertion matrix fits one verifier.

### B35-C31 — Remove two non-diagnostic task-shared CRUD tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `task-shared-crud-coverage::spy-only-concurrency-plus-wall-clock-smoke::task-shared-crud.reducer.spec.ts:2346-2389`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.8; `90cec306928e413992a6f9d5ebd002fdd6c315e76ea2ccae8030bf81fd5751f9`.
- **Domains / category:** B35 primary, C6 related; false concurrency and
  performance tests.
- **Exact evidence:** at `task-shared-crud.reducer.spec.ts:2346-2389`, the
  concurrency case uses an identity mock and asserts only two spy calls; the
  “large numbers efficiently” case uses a `Date.now() < 1000ms` wall-clock
  assertion while likewise exercising only spies. Neither reduces state,
  overlaps work, or measures the production reducer.
- **Unnecessary mechanism / smallest change:** delete only these two cases and
  their obsolete suite prose, retaining the functional CRUD matrix. Coordinate
  with B35-C30 so the same false cases are not migrated from the monolith.
- **Equivalence / invariants / failure modes:** runtime and real CRUD coverage
  are unchanged. Verification must confirm no CI policy treats the wall-clock
  smoke as an explicit performance gate.
- **Evidence and history:** both cases were copied unchanged by `9bf9d82d44`
  from the monolithic suite and still do not invoke reducer behavior.
- **Required verification:** focused CRUD suite, action-to-retained-case map,
  test inventory, modified-file check, and one fresh task-test reviewer.
- **Estimated delta / benefit:** about −44 test LOC; removes two misleading test
  names and a host-speed assertion.
- **Blast radius / reversibility / risk / confidence:** one test file; trivial
  revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh task-test reviewer;
  discovered/proposed, unverified; low-priority pursue.

### B35-C32 — Collapse non-measuring tag cascade scale fixtures

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `tag-delete-cascade-coverage::four-nontiming-large-fixture-replicas::tag-shared.reducer.spec.ts:1004-1234`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.8; `784b2e178a2acb2d062b3a8f85b07c641a6499ee63ce4d669ea7919a49905592`.
- **Domains / category:** B35 primary, C6 related; repeated scale-shaped tests
  without a measured performance contract.
- **Exact evidence:** `tag-shared.reducer.spec.ts:1004-1234` contains four large-
  fixture “performance” cases that record no time or complexity measure. Smaller
  cases already cover delete cascades, orphans, repeat config, and ordering;
  the four larger fixtures vary scale/fan-out but repeat their semantic oracle.
- **Unnecessary mechanism / smallest change:** retain one representative fan-out
  scale smoke and the full small semantic matrix; delete the other three large-
  fixture replicas. If CI intentionally observes per-test duration, move the
  scale concern to a real benchmark instead.
- **Equivalence / invariants / failure modes:** production is unchanged. The
  retained case must still exercise the Set-based high-fan-out path and every
  cascade target; collapsing all scale fixtures could conceal a size-dependent
  regression.
- **Evidence and history:** `943913a2fd` deliberately introduced all four with
  Set optimizations, so scale intent is plausible even though no explicit
  metric was added.
- **Required verification:** assertion/fixture matrix, CI-duration-policy check,
  focused tag suite with one retained scale case, modified-file check, and a
  fresh tag/performance reviewer.
- **Estimated delta / benefit:** about −150 to −180 test LOC; less repeated
  fixture construction while keeping a scale sentinel.
- **Blast radius / reversibility / risk / confidence:** one test file; easy
  revert, low-medium scale-coverage risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh tag/performance reviewer;
  discovered/proposed, unverified; investigate.

### B35-C33 — Table-drive non-finite deadline validation cases

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `deadline-input-validation::copy-pasted-nonfinite-case-matrix::task-shared-deadline.reducer.spec.ts:131-187`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.8; `859914787202c7d555ec3253807f6a7cb8c1a01040bdd2e01db2e5819f366e3d`.
- **Domains / category:** B35 primary, C6 related; repeated validation setup.
- **Exact evidence:** `task-shared-deadline.reducer.spec.ts:131-187` repeats five
  cases for `NaN`, positive infinity, and negative infinity across
  `deadlineWithTime` and `deadlineRemindAt`, with the same unchanged-state
  expectation and near-identical setup.
- **Unnecessary mechanism / smallest change:** replace only that copy-paste with
  a typed table retaining five individually named cases and exact field/value
  coverage. Do not combine production validation branches or action types.
- **Equivalence / invariants / failure modes:** the same five inputs must run and
  assert state identity. A Cartesian generator that silently adds or drops a
  field/value case would make review harder and should be avoided.
- **Evidence and history:** the repeated matrix entered with the deadline guard
  in `d401e6169e`; exact inspection reproduces one setup/oracle shape.
- **Required verification:** one-for-one case inventory, focused deadline suite,
  modified-file check, and a fresh reducer-test reviewer.
- **Estimated delta / benefit:** about −30 to −40 test LOC; clearer invalid-input
  coverage with no runtime change.
- **Blast radius / reversibility / risk / confidence:** one test block; trivial
  revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh reducer-test reviewer;
  discovered/proposed, unverified; pursue opportunistically.

### B35-C34 — Name repeated batch-consistency test arguments

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `batch-consistency-invariants::repeated-six-argument-test-invocations::validate-and-fix-data-consistency-after-batch-update.spec.ts`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.8; `88e9fb50125961e2d103454f2112d982a697f1922206f0114d89978062e0af21`.
- **Domains / category:** B35 primary, C6 related; repeated positional test
  harness calls.
- **Exact evidence:**
  `validate-and-fix-data-consistency-after-batch-update.spec.ts:72-669`
  repeats 18 six-argument calls whose meaningful variations are obscured by
  positional defaults. The duplication is test-only; the production function's
  signature and behavior are distinct from the proposed helper.
- **Unnecessary mechanism / smallest change:** add one strongly typed spec-local
  wrapper with named overrides, mechanically translate all 18 calls, and keep
  every scenario and assertion separate. Do not change the production API or
  merge cases.
- **Equivalence / invariants / failure modes:** argument values, update ordering,
  repair decisions, and assertions must be byte-for-byte equivalent after
  translation. Over-broad wrapper defaults could cause multiple tests to stop
  exercising their intended variant.
- **Evidence and history:** the repeated call surface originated in
  `5fb3328a1f` and remained through `7ca216f64a` and `1118e04ddf`.
- **Required verification:** exact before/after 18-call argument matrix, focused
  suite, modified-file check, and a fresh batch-consistency reviewer.
- **Estimated delta / benefit:** about −70 to −100 test LOC and clearer scenario
  inputs.
- **Blast radius / reversibility / risk / confidence:** one spec-local harness;
  easy revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh batch-test reviewer;
  discovered/proposed, unverified; low-priority pursue.

### B35-C35 — Delete the never-used startup debounce operator

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `debounce-during-startup::remove-unused-operator`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.9; `ac55d6c7dc2eff9cceed262aebe1c99acf7a8d5328fba06a30effb6d3fae9c3b`.
- **Domains / category:** B35 primary, C1/C6 related; zero-consumer utility and
  direct-only spec.
- **Exact evidence:** repository-wide symbol and filename searches find
  `debounceDuringStartup` only in
  `debounce-during-startup.operator.ts` and its spec. The pair totals 408 lines;
  no effect, barrel, dynamic lookup, plugin surface, or documentation consumer
  was found. The separately live `skipDuringSyncWindow()` operator is not part
  of this candidate.
- **Unnecessary mechanism / smallest change:** delete the operator and its
  direct-only spec, then remove any now-empty export/import residue. Do not
  replace it with another startup debounce abstraction.
- **Equivalence / invariants / failure modes:** no runtime caller changes.
  Startup hydration guards, replay suppression, timing, and effect emissions
  stay with their existing operators. An out-of-tree deep import is the only
  material API risk.
- **Evidence and history:** exact symbol/path and history searches reproduce
  definition/spec-only closure. `06e3136dd7` introduced it as a possible future
  effects utility; no consumer was ever added.
- **Required verification:** repeat exact/bracket/barrel closure, TypeScript
  build and lint, modified-file checks, and a fresh effects/API reviewer.
- **Estimated delta / benefit:** −408 source/test LOC; removes an unused timing
  abstraction that resembles load-bearing sync-window guards.
- **Blast radius / reversibility / risk / confidence:** isolated utility/spec;
  trivial revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh effects/API reviewer;
  discovered/proposed, unverified; prioritize for admission.

### B35-C36 — Finish the skipDuringSync alias deprecation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `skip-during-sync::remove-deprecated-alias`;
  discovered/proposed, unverified; compatibility-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.9; `910e08a6c69bc788ee0b80a81b7a75fc4411f5ff12e4998fedc4cd3e8a1d388a`.
- **Domains / category:** B35 primary, B37/C1/C3 related; deprecated alias plus
  lint compatibility surface.
- **Exact evidence:** no production caller imports deprecated
  `skipDuringSync`; live code uses `skipWhileApplyingRemoteOps()`. The old name
  remains only in its alias/tests, stale focus-mode test wording, and
  `require-hydration-guard.js` plus rule tests that recognize both spellings.
- **Unnecessary mechanism / smallest change:** remove the alias and alias-only
  tests, update lint recognition/tests and stale wording, and preserve
  `skipWhileApplyingRemoteOps()` unchanged. Do not weaken the distinct full
  startup/apply/cooldown `skipDuringSyncWindow()` rule.
- **Equivalence / invariants / failure modes:** current production operators and
  hydration behavior remain. Removing the lint spelling before closing all
  repository consumers could create false lint outcomes; external deep imports
  remain the compatibility risk.
- **Evidence and history:** exact old-name search reproduces no runtime import.
  `b3022c7285` added the alias only for backwards compatibility during the
  rename, with no rollout horizon recorded.
- **Required verification:** exact/bracket/export closure, operator and local-
  rule specs, full repository lint, modified-file checks, and a fresh lint/sync-
  compatibility reviewer.
- **Estimated delta / benefit:** small source/test/rule deletion; one canonical
  name at a load-bearing guard boundary.
- **Blast radius / reversibility / risk / confidence:** utility, lint rule, and
  tests; easy revert, low runtime but medium compatibility risk, supported
  evidence.
- **Verifiers / disposition / recommendation:** fresh C1/C3/lint reviewer;
  discovered/proposed, unverified; pursue only after rollout closure.

### B35-C37 — Remove generic values from exportable utility logs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `generic-utility-logs::redact-values`;
  discovered/proposed, unverified; privacy-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.9; `757f9d9a748ff2f45686a1119cc0e731757b5cb14fc6e960f9fdec0bae6eebe9`.
- **Domains / category:** B35 primary, C8 related; content-capable generic log
  arguments.
- **Exact evidence:** `wait-for-sync-window.operator.ts` passes its generic `T`
  to three exportable `Log` calls. Current documented use is date-change
  strings, but the type permits future user-content values. `locale-date.pipe.ts`
  logs both the input value and caught exception on formatting failure. Exported
  log history therefore receives data that is unnecessary to identify the
  diagnostic phase.
- **Unnecessary mechanism / smallest change:** keep content-free phase/context
  messages while removing the generic values and value-bearing exception from
  exported logs. Preserve waiting, timeout/proceed behavior, formatting, and
  fallback return values.
- **Equivalence / invariants / failure modes:** sync-window ordering and pipe
  output remain unchanged; diagnostics lose payload detail by design. If error
  classification is operationally required, use a reviewed constant/category,
  not arbitrary content.
- **Evidence and history:** exact log-call closure reproduces the five value-
  bearing arguments. The sync operator logging dates through `9810c320b1`; no
  sanitizer boundary guarantees generic `T` is content-free.
- **Required verification:** log-spy assertions with sentinel private values,
  focused locale-date and day-change/sync-window specs, modified-file checks,
  and a fresh privacy/sync reviewer.
- **Estimated delta / benefit:** small LOC change with concrete privacy and API-
  safety benefit.
- **Blast radius / reversibility / risk / confidence:** diagnostics only; easy
  revert, low behavior risk, supported privacy evidence.
- **Verifiers / disposition / recommendation:** fresh privacy/sync reviewer;
  discovered/proposed, unverified; prioritize for admission.

### B35-C38 — Remove unreferenced utility exports

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `owned-utilities::remove-unreferenced-exports`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.9; `f96195002a7e7470053e7089b81e1466633921446630f1098b167cb15f5aa63a`.
- **Domains / category:** B35 primary, C1 related; dead helper surface.
- **Exact evidence:** repository-wide symbol, namespace, and module-path searches
  find no consumer for `getEnvNumber`, `getAllEnv`, or
  `fakeEntityStateFromNumbersArray`. `PasswordStrengthLevel` is used only in its
  defining component file, so its export modifier is unused. `getAllEnv` also
  exposes the full generated environment object without a caller.
- **Unnecessary mechanism / smallest change:** delete the three unused helpers
  and direct-only tests/examples, and make `PasswordStrengthLevel` file-private.
  Preserve active environment accessors, entity factories, and password scoring.
- **Equivalence / invariants / failure modes:** tracked runtime behavior is
  unchanged. Dynamic module namespace access or out-of-tree deep imports are the
  removal risk; no persisted or wire shape is involved.
- **Evidence and history:** exact/static-string/namespace searches reproduce
  zero current consumers. The helpers date from 2020/2025 and have no later
  adoption or rollout owner.
- **Required verification:** tracked/bracket/export closure, affected focused
  specs, TypeScript build, modified-file checks, and a fresh utility/API reviewer.
- **Estimated delta / benefit:** modest source/test deletion and a smaller
  environment/type surface.
- **Blast radius / reversibility / risk / confidence:** several isolated utility
  files; easy revert, low risk, reproduced static evidence.
- **Verifiers / disposition / recommendation:** fresh utility/API reviewer;
  discovered/proposed, unverified; pursue.

### B35-C39 — Collapse Electron add-task validation onto the IPC boundary

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `electron-add-task::duplicate-effect-validation-and-fake-spec::ipc-parser-boundary`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.6 clean replacement;
  `2a58a02e1acd5a18b6772f31c99f904af4ba2ce3c25fadcea65cfd0233670aef`.
- **Domains / category:** B35 primary, C1/C6 related; redundant validation and
  false effect coverage.
- **Exact evidence:** `ipcAddTaskFromAppUri$` parses unknown values through
  `parseAddTaskFromAppUriPayload` and filters nulls at
  `core/ipc-events.ts:7-18,53-58`. Its only repository consumer,
  `TaskElectronEffects.handleAddTaskFromProtocol$:203-217`, repeats payload
  validation. The 124-line effect spec immediately replaces that production
  observable with a local subject/pipeline, and its validator case tests another
  local copy; it therefore exercises neither production path.
- **Unnecessary mechanism / smallest change:** expose the already-filtered IPC
  observable as non-null, reduce the effect to the `TaskService.add(title)` tap,
  and delete the fake spec. Do not add an injection seam solely to test one tap.
- **Equivalence / invariants / failure modes:** Electron-only registration and
  the `IPC.ADD_TASK_FROM_APP_URI` channel remain. One valid event must add one
  task; malformed/non-string/missing values must add none. No task/action/schema
  or plugin format changes.
- **Evidence and history:** exact consumer closure finds only the effect. The
  fake spec dates to the July 2025 protocol fix; the centralized parser and its
  direct tests arrived on 2026-07-14, leaving the second guard/copies stale.
- **Required verification:** direct parser spec, an Electron protocol-boundary
  test proving one/zero adds, Electron build/smoke, modified-file checks, and a
  fresh Electron/API reviewer.
- **Estimated delta / benefit:** about −124 false-positive test LOC plus a
  redundant validation branch; one validation owner.
- **Blast radius / reversibility / risk / confidence:** Electron IPC boundary;
  easy revert, low-medium behavior risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh Electron/API reviewer;
  discovered/proposed, unverified; pursue only with packaged-boundary coverage.

### B35-C40 — Remove the deprecated tag time-tracking cleanup path

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `time-tracking-tag-cleanup::deprecated-zero-caller-current-plus-archive-path`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.6 clean replacement;
  `8d6f8c327cbecd859e29013d0aec0457e0355a657cd72668ac0f7b6811e12e65`.
- **Domains / category:** B35 primary, C1/C3 related; superseded service method.
- **Exact evidence:** repository-wide exact-symbol/string searches find
  `cleanupDataEverywhereForTag` only at its declaration in
  `time-tracking.service.ts:108-144`. Runtime/tests use the distinct
  `cleanupArchiveDataForTag`, including `ArchiveOperationHandler`; current-state
  tag cleanup moved into the atomic tag meta-reducer.
- **Unnecessary mechanism / smallest change:** delete only the deprecated method
  and comment. Preserve project cleanup and `cleanupArchiveDataForTag` exactly.
- **Equivalence / invariants / failure modes:** live current-state cleanup stays
  in one persistent meta-reducer operation. Young/old archive cleanup remains
  serialized behind `TASK_ARCHIVE`; archive shapes, triggers, ordering, and
  replay behavior do not change. Out-of-tree deep callers are the residual risk.
- **Evidence and history:** `39a199af096` explicitly moved live tag cleanup into
  the meta-reducer, added the archive-only method, and deprecated this copy; no
  later consumer was found.
- **Required verification:** exact/bracket/plugin closure, time-tracking and
  archive-handler specs, archive integration, modified-file check, and a fresh
  tag/archive compatibility reviewer.
- **Estimated delta / benefit:** about −37 production LOC; removes a misleading
  non-atomic alternative path.
- **Blast radius / reversibility / risk / confidence:** internal service API;
  trivial revert, low runtime/medium compatibility risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh tag/archive reviewer;
  discovered/proposed, unverified; prioritize for admission.

### B35-C41 — Reuse TaskService archive entity materialization

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `task-service-archive-reads::repeated-id-materialization-and-orphan-filter::getArchivedTasks`;
  discovered/proposed, unverified; sync-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B35.6 clean replacement;
  `2deb966697c18bd315365e28807bad7c81fccba1dbf70381227db2762dc00594`.
- **Domains / category:** B35 primary, C1 related; duplicated archive read and
  orphan-filter policy.
- **Exact evidence:** at `task.service.ts:1342-1393`,
  `getAllTasksForProject`, `getArchiveTasksForRepeatCfgId`, `getArchivedTasks`,
  and `getAllTasksEverywhere` repeat archive load → IDs → entity lookup →
  orphan filtering. `29eeb80c327` deliberately added the same type guard to all
  copies after orphaned archive IDs caused crashes.
- **Unnecessary mechanism / smallest change:** have the three aggregate/filter
  methods reuse `getArchivedTasks()` while preserving current evaluation order:
  snapshot live tasks first, then load archive. Add no new abstraction and keep
  all public method names/types.
- **Equivalence / invariants / failure modes:** preserve archive ordering, orphan
  filtering, project/repeat predicates, live-before-archive concatenation, and
  serialization. Current caller tests mostly mock the methods, so a naive reuse
  can change timing or snapshots without detection.
- **Evidence and history:** exact method-body comparison reproduces the shared
  sequence; the synchronized orphan guards from `29eeb80c327` demonstrate one
  policy maintained in four places.
- **Required verification:** characterize orphan IDs, ordering, project/repeat
  filters, and live+archive snapshot timing first; then task service, REST,
  metrics, repeat, and archive integration specs plus a fresh archive reviewer.
- **Estimated delta / benefit:** modest production reduction with one owner for
  crash-preventing materialization policy.
- **Blast radius / reversibility / risk / confidence:** high-fan-in TaskService
  reads; easy revert, medium behavioral risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh archive/TaskService
  reviewer; discovered/proposed, unverified; investigate after characterization.

### B35-C42 — Delete timezone specs that do not test their named owners

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `timezone-tests::utility-diagnostics-without-component-or-effect::reminder-short-syntax`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.6 clean replacement;
  `fb64639220988f00f6ad56b950b8e0db2c85e104b12dbbc741eb5a8e4ce182c5`.
- **Domains / category:** B35 primary, C6 related; misplaced diagnostic specs.
- **Exact evidence:** `dialog-view-task-reminders.component.tz.spec.ts` never
  creates the component; its near-midnight date is never passed to `getTomorrow`
  and another case calls the same utility three times.
  `short-syntax.effects.tz.spec.ts` never creates the effect and executes
  assertions only for selected LA/Berlin names or winter offsets, allowing
  other environments to run zero expectations. Both emit diagnostic console
  output.
- **Unnecessary mechanism / smallest change:** delete both specs. If product
  scheduling coverage is required, add assertions against emitted actions in
  the real component/effect specs rather than copying date utilities.
- **Equivalence / invariants / failure modes:** production is untouched. Direct
  `get-db-date-str` tests and the normal Berlin/Los Angeles lanes remain, but
  deletion must not be represented as owner-level timezone behavior coverage.
- **Evidence and history:** both files were introduced in July 2025 as timezone
  diagnostic coverage and never instantiated their named owners.
- **Required verification:** direct date utility, real short-syntax effect, and
  reminder component specs in the timezone CI lane, modified-file checks, and a
  fresh logical-day/test reviewer.
- **Estimated delta / benefit:** roughly −158 test LOC and noisy diagnostics;
  truthful timezone ownership.
- **Blast radius / reversibility / risk / confidence:** tests only; trivial
  revert, low-medium coverage-perception risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh C6/logical-day reviewer;
  discovered/proposed, unverified; pursue with uncovered owner behavior explicit.

### B35-C43 — Share paired Android reminder cancellation

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `android-reminder-cancel::paired-base-and-deadline-try-block::delete-bulk-archive`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B35.6 clean replacement;
  `508617652ab2ec8258600b90bf5d29517ae21fe0e1a00d814459fb19839f611c`.
- **Domains / category:** B35 primary, C1 related; repeated native side-effect
  sequence.
- **Exact evidence:** delete, bulk-delete, archive-parent, and archive-subtask
  branches at `task-reminder.effects.ts:256-329` repeat cancellation of the base
  notification and its `_deadline` notification inside identical try/catch
  blocks.
- **Unnecessary mechanism / smallest change:** introduce one private helper for
  exactly that pair and use it only in those four paths. Keep both calls in one
  try block so a base-call exception still prevents the deadline call.
- **Equivalence / invariants / failure modes:** preserve `LOCAL_ACTIONS`, action
  filters, Android gates, notification ID construction, call order, exception
  behavior, and action counts. Done-task, unschedule/dismiss, deadline-only, and
  dialog paths stay separate because their gates/sets/errors differ.
- **Evidence and history:** exact block comparison reproduces four identical
  pairs. The paths accumulated through several Android reminder bug fixes in
  early 2026, so broader helper unification is explicitly excluded.
- **Required verification:** new bridge-spy characterization for delete, bulk,
  parent/subtask archive, order, and exception behavior; focused effects tests,
  Android smoke, modified-file checks, and a fresh Android reviewer.
- **Estimated delta / benefit:** small production reduction and one owner for
  paired notification IDs.
- **Blast radius / reversibility / risk / confidence:** native side effects;
  easy revert, medium Android risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh Android reviewer;
  discovered/proposed, unverified; low-priority investigate.

### B36-C06 — Remove resolved #7810 snapshot-test diagnostics

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-diagnostics::snapshot-7810-full-body-and-idb-capture`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.2; `8767792f2a6e0c36aff3295574d8a339872e3d4fe3b68a82997ec3eb647b4fb0`.
- **Domains / category:** B36 primary, C6/C8 related; stale failure
  instrumentation.
- **Exact evidence:** `supersync-snapshot-vector-clock.spec.ts:2,12-111,159-161,169,190,211-250,325-331`
  installs request/response listeners, buffers full API bodies, reads IndexedDB
  and localStorage, and wraps failures only to log diagnostics. No assertion
  consumes the captured state, and the diagnostic `clear()` has no caller.
- **Unnecessary mechanism / smallest change:** remove the type-only imports,
  diagnostic helpers, listener/state plumbing, incident note, timing marks, and
  diagnostic catch wrappers. Retain the direct sync/wait calls and every
  scenario assertion.
- **Equivalence / invariants / failure modes:** snapshot-plus-tail and replay
  convergence assertions remain. Removing full-body capture also reduces
  exportable/logged data exposure; the trade-off is less bespoke evidence if
  #7810 recurs, not less pass/fail coverage.
- **Evidence and history:** exact-symbol closure finds only this file.
  `aa1c13e805` added the block to diagnose #7810; `87212472fa` fixed the
  cross-test database clobber and reports both files stable under repeated
  parallel runs.
- **Required verification:** symbol closure, modified-file check, focused
  snapshot-vector-clock E2E with retries disabled, scheduled parallel SuperSync,
  and a fresh E2E/privacy reviewer.
- **Estimated delta / benefit:** roughly −145 to −150 test LOC; medium
  maintenance and privacy benefit.
- **Blast radius / reversibility / risk / confidence:** failure diagnostics only;
  easy revert, low behavior risk and medium validation cost, supported evidence.
- **Verifiers / disposition / recommendation:** fresh E2E/privacy reviewer;
  discovered/proposed, unverified; pursue independently.

### B36-C07 — Delete non-gating high-volume stress diagnostics

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-diagnostics::stress-unasserted-idb-and-store-probes`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.2; `32d5fef4e63a49afefceaa30b0a9809e57276bcc2dd36c3c92d5ba345237b4f4`.
- **Domains / category:** B36 primary, C6/C8 related; non-gating debug code.
- **Exact evidence:** `supersync-stress.spec.ts:255-307` reads `SUP_OPS` and
  converts every success or error outcome into a logged object;
  `:333-377` inspects an optional global store or DOM fallback and likewise
  only logs the result. The actual task-count and done-state assertions are at
  `:326-330,379-384`.
- **Unnecessary mechanism / smallest change:** delete both page-evaluate probes
  and their logs, and make the stale “synced 99 operations” message generic.
  Retain the 197-operation setup, syncs, waits, scrolling, and all assertions.
- **Equivalence / invariants / failure modes:** server-sequence/piggyback and
  bulk-yield behavior retain observable E2E oracles. Because probe failures are
  swallowed and cannot fail the test, removal does not weaken its pass/fail
  contract.
- **Evidence and history:** exact-symbol closure finds no other consumer.
  `064c2452ca` introduced the probes as diagnostic logging while fixing the
  piggyback limit; later blame is formatting and stability work.
- **Required verification:** modified-file check, focused stress E2E with retries
  disabled, scheduled sharded SuperSync, and a fresh E2E reviewer.
- **Estimated delta / benefit:** about −98 test LOC plus one truthful log; medium
  maintenance and runtime benefit.
- **Blast radius / reversibility / risk / confidence:** diagnostics only; easy
  revert, low behavior risk and medium-high validation cost, supported evidence.
- **Verifiers / disposition / recommendation:** fresh E2E reviewer;
  discovered/proposed, unverified; pursue independently.

### B36-C08 — Delete the large-time-estimate E2E false oracle

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::large-time-estimate-unobserved-property`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.2; `1912500202572e02f0780fb5907c4d85d647a0c075e6ae969f2a3f9d3ca91032`.
- **Domains / category:** B36 primary, C6/C7 related; misleading scenario test.
- **Exact evidence:** `supersync-time-tracking-advanced.spec.ts:253-310` says it
  verifies an eight-hour estimate exactly, but `:281-305` only creates `t:8h`
  and asserts that the task title is visible on each client. The estimate is
  never read or compared, and exact-name search finds no second implementation.
- **Unnecessary mechanism / smallest change:** delete the test, its sole-use
  `expectTaskVisible` import, and the suite-header claim; explicitly record
  large-estimate precision as uncovered. Do not replace it with another
  visibility smoke test.
- **Equivalence / invariants / failure modes:** runtime and replay behavior are
  untouched. Effective estimate-precision coverage is already zero; generic
  propagation and the file's assertion-backed concurrent time-delta case remain.
- **Evidence and history:** `d9f35be660` introduced the broad scenario; later
  changes stabilized/formatted it without adding an estimate oracle.
- **Required verification:** C6 scenario-matrix acknowledgement of the uncovered
  property, modified-file check, both retained focused-file cases, scheduled
  SuperSync, and a fresh time-tracking/E2E reviewer.
- **Estimated delta / benefit:** about −60 test LOC and one two-client E2E;
  medium maintenance/runtime benefit.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, medium coverage risk and validation cost, supported evidence.
- **Verifiers / disposition / recommendation:** fresh time-tracking/E2E reviewer;
  discovered/proposed, unverified; pursue only with the coverage gap explicit.

### B36-C09 — Collapse duplicate future-day planner sync tests

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::planner-future-day-visibility-triplicate`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.2; `70c8f45250626ca4808b161310f1af296659ffea7084b14cf5bd824b061c3fd0`.
- **Domains / category:** B36 primary, C6/C7 related; duplicated browser scenario.
- **Exact evidence:** `supersync-planner.spec.ts:32-86` checks one future task
  created with `sd:1d`. `:88-140` repeats the same flow with `sd:2d` while its
  prose falsely claims a move to today; `:205-257` repeats it with `sd:3d`.
  Both duplicates search the whole planner and never assert a date bucket.
- **Unnecessary mechanism / smallest change:** delete the two-day and three-day
  cases and remove the suite-header claim about moving between days. Retain the
  stronger one-day future case and the distinct TODAY/dueDay case at `:142-203`.
- **Equivalence / invariants / failure modes:** logical-day/TODAY behavior retains
  one future propagation path and the virtual-TODAY path. Relative offsets can
  cross calendar boundaries, but the duplicates have no boundary-specific oracle.
- **Evidence and history:** all three scenarios arrived in `d9f35be660` without
  bug-specific lineage; later edits were generic E2E stabilization.
- **Required verification:** C6 scenario-map review, modified-file check, focused
  planner E2E, timezone checks, scheduled SuperSync, and a fresh planner/logical-
  day reviewer.
- **Estimated delta / benefit:** about −106 to −107 test LOC and two two-client
  E2Es; medium maintenance/runtime benefit.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, low product risk and medium coverage-validation risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh planner/logical-day reviewer;
  discovered/proposed, unverified; pursue the duplicate deletion without
  parameterizing equivalent cases.

### B36-C10 — Delete two error tests that trigger neither failure nor retry

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::error-recovery-and-retry-without-fault`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.2; `b9b5cabc2e26e6c5baba640e350883e300b28fdf2ec73a6ceb0be3664c285757`.
- **Domains / category:** B36 primary, C6/C7 related; false error/idempotency
  coverage.
- **Exact evidence:** `supersync-error-handling.spec.ts:144-196` labels two
  successful sequential uploads as network-failure recovery without inducing a
  failure. `:198-248` claims retry/idempotency but awaits three completed syncs
  after acknowledgement; it neither resends one operation nor overlaps requests.
- **Unnecessary mechanism / smallest change:** delete both tests and the
  suite-header recovery claim. Retain the file's divergent-LWW and three-client
  convergence cases.
- **Equivalence / invariants / failure modes:** replay/idempotency and offline-
  recovery behavior lose no actual oracle because neither mechanism is exercised.
  Dedicated no-op, injected-duplicate, transient-failure, and convergence suites
  retain their assertion-backed paths.
- **Evidence and history:** `9e8d05f430` introduced both as broad error coverage
  with the missing fault/retry present from inception. Exact closure finds
  explicit no-op coverage in `supersync-no-op-sync.spec.ts:35-72`, duplicate-op
  injection in `supersync-error-scenarios.spec.ts:230-331`, and transient-failure
  injection in the #8331 spec `:69-268`.
- **Required verification:** C6 scenario-map review, modified-file check, focused
  error-handling/no-op/error-scenarios/#8331 cases, scheduled SuperSync, and a
  fresh sync-error/E2E reviewer.
- **Estimated delta / benefit:** about −105 to −106 test LOC and two E2Es; medium
  maintenance/runtime benefit.
- **Blast radius / reversibility / risk / confidence:** test inventory only; easy
  revert, low product risk and medium coverage-validation risk, supported evidence.
- **Verifiers / disposition / recommendation:** fresh sync-error/E2E reviewer;
  discovered/proposed, unverified; pursue.

### B36-C11 — Delete unused SuperSync E2E helper APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-helpers::unused-supersync-assertion-and-time-display-apis`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.3; `1a69b3ad2f75e847a37ac3cfdaea416cf9ca0c37cd00a087000e214b28ea6d5a`.
- **Domains / category:** B36 primary, C1/C6 related; dead test-harness exports.
- **Exact evidence:** tracked-file exact searches find no consumer outside the
  defining files for 13 exported symbols: `expectTaskNotOnAnyClient`,
  `expectTaskDoneOnAllClients`, `expectTaskOrderMatches`,
  `expectSameTaskOrder`, `expectTaskExists`, `expectTimeTrackingActive`,
  `expectTimeTrackingInactive`, `cleanupTestData`, `getTaskElementFromPage`,
  `getTaskTimeDisplay`, `waitForTaskTimeDisplay`, `expectTaskNotInWorklog`, and
  `getWorklogTaskCount`. The time-display pair forms an internal dead chain;
  the other symbols occur only at their definitions.
- **Unnecessary mechanism / smallest change:** delete only those exports and
  any imports made unused inside `supersync-assertions.ts` and
  `supersync-helpers.ts`. Preserve every helper with a live scenario consumer
  and the generic helpers documented by `e2e/CLAUDE.md`.
- **Equivalence / invariants / failure modes:** no scenario currently calls the
  APIs, so test behavior and product code remain unchanged. Dynamic imports or
  an external unpublished harness consumer are the material closure risks.
- **Evidence and history:** exact tracked-file symbol searches reproduce the
  definition-only set. The unused surface accumulated across `f37110bbb5`,
  `e62f2f86fa3`, `4b5fc3fb33`, and `7ed76c13a4`; no adoption was found.
- **Required verification:** exact/bracket/barrel closure, E2E TypeScript/list
  discovery, modified-file checks, and one fresh E2E-harness reviewer.
- **Estimated delta / benefit:** about −120 test LOC; a smaller documented
  helper vocabulary and less locator-policy drift.
- **Blast radius / reversibility / risk / confidence:** two test utility files;
  trivial revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh E2E-harness reviewer;
  discovered/proposed, unverified; pursue.

### B36-C12 — Delete the worklog tracked-time false oracle

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::worklog-tracked-time-unobserved-property`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.3; `6a7f91bc4672d008a71dea12443c2e55c9a81e6c7ac31413a378a144fd9720d6`.
- **Domains / category:** B36 primary, C6 related; expensive E2E with an
  unobserved named property.
- **Exact evidence:** `supersync-worklog.spec.ts:118-204` spends three seconds
  tracking, completes and archives the task, then asserts only that its title is
  visible. Lines `197-199` explicitly avoid reading the time. Generic worklog
  propagation is already asserted earlier in the file, while
  `supersync.spec.ts:773-865` compares persisted `timeSpent` across clients.
- **Unnecessary mechanism / smallest change:** delete this single two-client
  test and record rendered worklog time as uncovered. Retain the generic
  archive/worklog case and exact persisted-time scenario; do not describe them
  as UI-format coverage.
- **Equivalence / invariants / failure modes:** runtime behavior is untouched and
  effective tracked-time UI coverage is already absent. If rendered worklog time
  is release-critical, a deterministic value assertion is required instead of
  preserving this title-only smoke test.
- **Evidence and history:** exact assertion inspection reproduces the missing
  time oracle. The scenario originated in `d9f35be660` and never gained one.
- **Required verification:** C6 scenario-map acknowledgement, focused retained
  worklog and exact-time runs, scheduled SuperSync, modified-file check, and a
  fresh time-tracking/E2E reviewer.
- **Estimated delta / benefit:** about −87 test LOC and one two-client browser
  scenario; medium runtime and maintenance benefit.
- **Blast radius / reversibility / risk / confidence:** test inventory only;
  easy revert, medium coverage-perception risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh time-tracking/E2E
  reviewer; discovered/proposed, unverified; pursue only with the uncovered UI
  property explicit.

### B36-C13 — Delete the permissive WebDAV same-second burst test

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `e2e-scenarios::webdav-same-second-burst-accepts-failures`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.3; `0adbeaeffd0a4ac80ca0f3dda157808ca459916e7e019725d1ef10974a1f6390`.
- **Domains / category:** B36 primary, C6 related; false concurrency and success
  oracle.
- **Exact evidence:** `webdav-single-client-rapid-sync.spec.ts:234-310` claims
  ten same-second successful syncs, but the loop serially waits 500 ms plus sync
  completion, catches every timeout/error, and passes with only three successes.
  It therefore establishes neither same-second overlap nor completion of all
  ten attempts.
- **Unnecessary mechanism / smallest change:** delete only the third test.
  Preserve the file's first two assertion-backed rapid create/mutation cases and
  record deterministic timestamp-boundary concurrency as uncovered.
- **Equivalence / invariants / failure modes:** no product behavior changes. The
  only loss is a permissive no-412 smoke signal; if same-second conditional-write
  behavior is required, replace it later using controlled request overlap or
  server instrumentation.
- **Evidence and history:** the case entered in `7ed76c13a4`; `350e07e6961`
  relaxed it to its current three-of-ten threshold. Direct flow inspection
  reproduces the serial waits and swallowed failures.
- **Required verification:** C6 scenario-map update, focused retained WebDAV
  rapid-sync tests, scheduled WebDAV, modified-file check, and a fresh provider-
  concurrency reviewer.
- **Estimated delta / benefit:** about −77 test LOC and ten sync attempts; medium
  runtime benefit.
- **Blast radius / reversibility / risk / confidence:** test inventory only;
  easy revert, medium scenario-coverage risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh WebDAV/E2E reviewer;
  discovered/proposed, unverified; pursue with the coverage gap explicit.

### B36-C14 — Delete archive orphan-cleanup tests that never apply the reducer

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `archive-subtask-tests::payload-echo-does-not-exercise-orphan-cleanup`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.3; `ebb9ca06833c267861d1dee9973a2a4544978d0eca6d472d3244463443542654`.
- **Domains / category:** B36 primary, C6 related; integration tests that do not
  execute their named behavior.
- **Exact evidence:** `archive-subtask-sync.integration.spec.ts:572-725` builds,
  stores, and reconstructs archive payloads but never invokes the task reducer.
  Its first case explicitly delegates orphan removal to
  `task.reducer.spec.ts:827-924`; payload preservation is already exercised at
  `:103-388` and handler flow at `:395-569` in the same integration file.
- **Unnecessary mechanism / smallest change:** delete the final describe block,
  its local setup/factory, and resulting imports. Retain the direct reducer
  orphan regression and the earlier archive conversion/application cases.
- **Equivalence / invariants / failure modes:** archive runtime is untouched and
  the actual orphan-deletion oracle remains. Verification must confirm that the
  direct reducer test applies the stale-parent scenario rather than merely
  checking a similarly named fixture.
- **Evidence and history:** both the defensive fix and this documentary block
  arrived in `dd5741faa70`; direct inspection shows no reducer call in the
  block and stronger payload/handler owners earlier in the file.
- **Required verification:** focused archive integration and reducer specs,
  mutation/challenge of the reducer fix, modified-file check, and a fresh
  archive/replay reviewer.
- **Estimated delta / benefit:** about −154 test LOC; removes executable prose
  that overstates integration coverage.
- **Blast radius / reversibility / risk / confidence:** test inventory only;
  easy revert, low-medium coverage risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh archive/replay reviewer;
  discovered/proposed, unverified; pursue.

### B36-C15 — Delete compaction tests that never compact

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `compaction-tests::unsynced-and-rejected-without-compaction-call`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.3; `bd69cda6ef8bf543d49aadfb48d0f00a773b92d7914072e4d9a0e66a5eea9d8f`.
- **Domains / category:** B36 primary, C6 related; misowned integration tests.
- **Exact evidence:** none of the three tests at
  `compaction.integration.spec.ts:234-311` calls `compact()` or
  `emergencyCompact()`; they only query unsynced operations or mark/read
  rejection metadata. Direct compaction owners exist in
  `operation-log-compaction.service.spec.ts:229-246,553-570`, with store query
  behavior at `operation-log-store.service.spec.ts:489-520` and state-level
  integration at `state-consistency.integration.spec.ts:295-327`.
- **Unnecessary mechanism / smallest change:** delete that describe block and
  its suite-header coverage claim. Preserve direct regular/emergency compaction,
  unsynced-query, rejection, and state-consistency tests.
- **Equivalence / invariants / failure modes:** product code is untouched. The
  retained owners must explicitly prove that regular and emergency compaction
  share the same unsynced/rejected preservation predicate.
- **Evidence and history:** call searches within the block reproduce zero
  compaction invocations. The weak block entered in `4b8edc91ab1` and was never
  upgraded to exercise the service.
- **Required verification:** focused direct compaction/store/state-consistency
  specs, coverage-owner mapping, modified-file check, and a fresh compaction
  reviewer.
- **Estimated delta / benefit:** about −79 test LOC; truthful suite ownership and
  less duplicated store setup.
- **Blast radius / reversibility / risk / confidence:** test inventory only;
  easy revert, low risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh compaction reviewer;
  discovered/proposed, unverified; pursue after confirming both compaction modes
  retain the predicate owner.

### B36-C16 — Delete the LWW integration suite that never calls the conflict engine

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `lww-tests::store-and-utility-self-tests-without-conflict-service`;
  discovered/proposed, unverified; sync-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B36.4; `accf109c4d3b94e896cdd8fa6068204db369c34c38b4eac6d8c2c313022a9fbf`.
- **Domains / category:** B36 primary, C6 related; misleading whole-suite
  integration coverage.
- **Exact evidence:** `lww-conflict-resolution.integration.spec.ts:1-1559`
  imports store and vector-clock utilities but never imports or invokes
  `ConflictResolutionService`. Most cases calculate timestamps/clocks inside
  the test and manually call generic rejection/application methods. Its
  unconditional equal-timestamp “remote wins” prose also conflicts with the
  live stable client-ID tie-breaker.
- **Unnecessary mechanism / smallest change:** delete the suite without a new
  harness after mapping each named scenario to direct owners in
  `conflict-resolution.service.spec.ts`, conflict-persistence integration,
  store/vector-clock specs, and `supersync-lww-conflict.spec.ts`.
- **Equivalence / invariants / failure modes:** product code is unchanged.
  Timestamp/client-ID winner selection, delete/update restoration, causal
  dominance, atomic rejection/application, and entity-specific LWW behavior
  must all retain a direct executable owner; a name-only mapping is insufficient.
- **Evidence and history:** exact import/call closure reproduces no conflict-
  service execution. The file began with LWW in `4d96c8ffff`, expanded in
  `ee7e0750da`, and gained documentary payload cases in `527bb229ac` without
  being converted to a real service test.
- **Existing work:** related to B36.3-Q02's locally recreated LWW path, but the
  files and removal scopes do not overlap.
- **Required verification:** complete scenario-owner matrix, focused direct LWW
  specs and browser case, winner-selection mutation challenge, modified-file
  check, and a fresh LWW/test-topology reviewer.
- **Estimated delta / benefit:** about −1,559 test LOC; removes the largest false
  integration owner in this slice.
- **Blast radius / reversibility / risk / confidence:** one test file; easy
  revert, medium-high coverage-inventory risk, reproduced structural evidence.
- **Verifiers / disposition / recommendation:** fresh LWW/C6 reviewer;
  discovered/proposed, unverified; investigate for admission only with complete
  owner mapping.

### B36-C17 — Delete the shared-database mock sync-scenarios suite

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `sync-scenario-tests::shared-db-mock-protocol-without-sync-service`;
  discovered/proposed, unverified; sync-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; B36.4; `380350aabdcceb57f514712df245df620f926b9ff7f05ab13932e2f816ad354f`.
- **Domains / category:** B36 primary, C6 related; mock protocol presented as
  end-to-end sync behavior.
- **Exact evidence:** `sync-scenarios.integration.spec.ts:1-1048` acknowledges
  that clients share one IndexedDB and performs neither state application nor UI
  conflict resolution. It tests `SimulatedClient`, `MockSyncServer`, and store
  primitives, not `OperationLogSyncService` or the real server; “convergence”
  assertions compare mock operation counts rather than application state.
- **Unnecessary mechanism / smallest change:** delete the suite while retaining
  its helpers for focused consumers. Map named upload/download, conflict,
  dependency, lifecycle, pagination, dedupe, and convergence claims to the
  direct client/server/service/E2E owners before removal.
- **Equivalence / invariants / failure modes:** runtime is untouched. The risk is
  deleting a unique intermediate-state assertion hidden behind a broad scenario
  title; each claimed invariant needs an assertion-level owner rather than a
  suite-name match.
- **Evidence and history:** direct imports and assertions reproduce the shared-
  DB mock boundary. The suite arrived with its helpers in `9a654c0c47`; later
  changes removed ACKs, renamed types, or moved paths without connecting it to
  production synchronization.
- **Required verification:** C6 assertion-level scenario matrix, focused
  production service/store/server specs, scheduled SuperSync/WebDAV, modified-
  file check, and a fresh sync-test-topology reviewer.
- **Estimated delta / benefit:** about −1,048 test LOC; materially smaller false
  scenario inventory.
- **Blast radius / reversibility / risk / confidence:** one test file; easy
  revert, medium-high coverage risk and large validation cost, reproduced
  structural evidence.
- **Verifiers / disposition / recommendation:** fresh C6/sync reviewer;
  discovered/proposed, unverified; investigate only after full scenario mapping.

### B36-C18 — Delete the legacy archive suite that only echoes its fixture

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `legacy-archive-tests::opaque-payload-cache-echo-without-import-export`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.4; `b4895172386076789b23db51354a9bc8e89bc4c056f0259c2b6dea5bfaa7ca5a`.
- **Domains / category:** B36 primary, C6 related; opaque store round-trip
  mistaken for import/archive coverage.
- **Exact evidence:** `legacy-archive-subtasks.integration.spec.ts:1-445`
  constructs `legacyData`, puts that same object in a `SYNC_IMPORT` operation or
  state cache, then reads it back. It never invokes legacy parsing, finish-day
  archival, export serialization, or an operation applier. The real regression
  at `e2e/tests/import-export/archive-subtasks.spec.ts:176-275` imports the
  legacy fixture, archives, exports, and checks all tasks and relationships.
- **Unnecessary mechanism / smallest change:** delete the opaque round-trip file;
  retain the import/export E2E plus archive service, reducer, and data-repair
  owners for malformed/orphan relationships.
- **Equivalence / invariants / failure modes:** product behavior is unchanged.
  Legacy import acceptance, archive inclusion, export inclusion, and both sides
  of parent/subtask relationships must remain directly asserted.
- **Evidence and history:** exact call inspection reproduces no import/export or
  apply boundary. The false suite and real E2E arrived in `6191c782f0`; the
  export correction followed in `3bf1cc348f`.
- **Existing work:** B36-C14 concerns a different orphan-cleanup payload block
  and remains a separate dedupe key.
- **Required verification:** focused legacy import/export E2E, archive reducer/
  service/data-repair specs, modified-file check, and a fresh compatibility/
  archive reviewer.
- **Estimated delta / benefit:** −445 test LOC; removes a false legacy-coverage
  signal.
- **Blast radius / reversibility / risk / confidence:** one test file; easy
  revert, low-medium coverage risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh archive/compatibility
  reviewer; discovered/proposed, unverified; pursue with the real E2E retained.

### B36-C19 — Delete provider-switch tests with no provider transition

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `provider-switch-tests::no-provider-transition-before-after-identity`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.4; `0f806d4cd34aea882c59b4730db0a53b510c4a811c660517f708d1859ced569c`.
- **Domains / category:** B36 primary, C6 related; three false provider-switch
  scenarios.
- **Exact evidence:** `provider-switch.integration.spec.ts:43-197` creates only
  `serverA`; at each alleged switch it executes no transition and creates no
  second provider, then rereads unchanged rows or writes with the same client.
  Later cases in the file at least use a second endpoint, while three browser
  suites exercise actual WebDAV/SuperSync provider changes.
- **Unnecessary mechanism / smallest change:** delete only the first describe
  block and unsupported header claims. Retain later pending-operation/server-
  change cases and all real provider-switch E2Es.
- **Equivalence / invariants / failure modes:** runtime is unchanged. Local-op
  retention, identity/clocks, provider credentials/configuration, and cross-
  provider transfer remain protected by actual transition owners.
- **Evidence and history:** direct flow inspection reproduces no transition.
  The no-op switch existed from the suite's inception in `a7a831c2f1`; later
  commits only moved or formatted it.
- **Required verification:** focused wrapped-provider/vector-clock specs, three
  provider-switch E2Es, scheduled WebDAV/SuperSync, modified-file check, and a
  fresh provider-switch reviewer.
- **Estimated delta / benefit:** about −155 test LOC; removes three misleading
  cases at low runtime risk.
- **Blast radius / reversibility / risk / confidence:** one test block; trivial
  revert, low-medium coverage risk, reproduced evidence.
- **Verifiers / disposition / recommendation:** fresh provider/E2E reviewer;
  discovered/proposed, unverified; pursue.

### B36-C20 — Remove definition-only integration-helper APIs

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `integration-harness::definition-only-helper-surface`;
  discovered/proposed, unverified.
- **Baseline / origin / revision hash:** `9b448133…`; B36.4; `d75667b114fd1b86c1661d888f6dd672b64c480601f6b8a2b6c022ea38fc312a`.
- **Domains / category:** B36 primary, C1/C6 related; dead integration-harness
  surface.
- **Exact evidence:** exact symbol/bracket/string searches find no consumers for
  17 APIs: harness `getClient`, `setMockArchive`, `syncAtoB`,
  `createTestSyncOperation`; provider `setLatency`, `setReady`,
  `getCallHistory`, `getFileCount`, `createMockProviderWithData`; factory
  `createGenericOperation`, `createMinimalTagPayload`,
  `createMinimalNotePayload`, `createMinimalGlobalConfigPayload`; simulated
  client `getOpsBySource`; and mock-server `getOpsForEntity`, `receiveUpload`,
  `getOpsSince`.
- **Unnecessary mechanism / smallest change:** delete those definitions and
  stale examples, then fold now-unobservable provider latency/readiness state to
  its existing zero-latency/ready behavior. Preserve every helper with a live
  integration consumer.
- **Equivalence / invariants / failure modes:** no current test calls the APIs
  and production is untouched. Dynamic lookup, a hidden barrel, or a scenario
  depending indirectly on mutable readiness/latency would invalidate removal.
- **Evidence and history:** repository-wide exact/bracket/string closure found
  definitions/documentation only and no barrel/package consumer. The surface
  accumulated in `9a654c0c47`, `6235a3de67`, `91dc87a867`, and
  `c29913aeac` without adoption. This does not overlap B36-C11's E2E APIs.
- **Required verification:** repeat tracked/dynamic/export closure, TypeScript
  test discovery, focused file-based/simulated-client integrations, modified-
  file checks, and a fresh harness reviewer.
- **Estimated delta / benefit:** about −200 test-helper LOC; smaller mock API and
  less unexercised state.
- **Blast radius / reversibility / risk / confidence:** integration helpers
  only; easy revert, low risk, reproduced static evidence.
- **Verifiers / disposition / recommendation:** fresh harness reviewer;
  discovered/proposed, unverified; pursue.
### C8-N01 — Remove raw `additionalLog` from crash-report surfaces

- **Stable ID / dedupe key / status:** stable ID pending D1;
  `error-diagnostics::additional-log::crash-alert-and-github-issue`;
  discovered/proposed, unverified; privacy/security-sensitive.
- **Baseline / origin / revision hash:** `9b448133…`; C8;
  `cc55043380464bc5bb7477418ea9e377e620fbeed50d59ecb8bf3a99ca15042d`.
- **Domains / category:** C8 primary; B01, B16, B22, and B30 related;
  diagnostic privacy boundary.
- **Exact evidence:** `packages/sync-providers/src/errors/index.ts:18-35`
  states that `additionalLog` may contain raw user data and must never enter a
  logger, while retaining raw constructor arguments. `HttpNotOkAPIError` at
  `:80-130` retains a raw response/body, and app validation errors at
  `sync-errors.ts:333-345` retain serialized Typia errors whose values can
  contain model content. `global-error-handler.util.ts:140-145` renders any
  object's `additionalLog`, and `getGithubIssueErrorMarkdown()` at `:257-318`
  embeds it under `### AL` in the prefilled GitHub issue URL.
- **Current responsibility / consumers / formats:** raw error state remains
  useful to catch-site control flow. The crash handler needs error identity,
  title, stack, metadata, and action history, but not arbitrary diagnostic
  payloads. Current `Error` serialization does not itself prove that
  `additionalLog` enters JSON log exports; the alert displays it locally and
  prefilled report content leaves the app only if the user follows/submits it.
- **Unnecessary mechanism / smallest change:** remove generic `additionalLog`
  reflection from the crash alert and GitHub markdown. Do not delete the error
  property wholesale. If classification is required, retain only fixed error
  name/code and reviewed primitive metadata.
- **Equivalence / invariants / failure modes:** preserve error handling, title,
  stacktrace, metadata, action history, backup recovery UI, XSS-safe rendering,
  and GitHub reporting. Sentinel response bodies, Typia values, URLs,
  credentials, and decrypted data must be absent from alert text and generated
  issue URLs.
- **Evidence and history:** `00526ad712` added alert rendering and `9ca4fabdcc`
  added `### AL`. `91e53bb488` later shifted privacy responsibility to
  structured catch-site logging and explicitly prohibited raw `additionalLog`,
  but the older global consumers remained. `4d8605baa3` made the DOM sink XSS-
  safe via `textContent`; it did not make the content privacy-safe.
- **Existing work:** no primary origin covers this sink. Link policy and
  verification with B01-C05, B16-C05, B22-C03, B23-C04, and B30 retained
  logger/error decisions without merging their non-overlapping call sites.
- **Required verification:** focused crash-handler tests with sentinel HTTP
  body, validation value, URL, and credential; assert absence from alert text
  and decoded issue body while title/stack/meta remain. Existing global-handler
  utility specs do not cover `additionalLog`.
- **Estimated delta / benefit:** small diagnostic-only deletion plus focused
  tests; removes a policy contradiction and potential user-assisted disclosure
  route.
- **Blast radius / reversibility / risk / confidence:** crash diagnostics only;
  easy revert, low behavioral risk, high privacy value. Sink and history are
  reproduced; runtime reachability by every error subtype remains unverified.
- **Verifiers / disposition / recommendation:** fresh privacy/error-boundary
  reviewer; discovered/proposed, unverified; admit first.
