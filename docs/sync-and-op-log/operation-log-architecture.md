# Operation Log Architecture

> **Maintainer routing:** use the
> [Sync Architecture Field Guide](./sync-architecture.html) for the current
> whole-system mental model. This long-form document preserves deep rationale,
> migration policy, and implementation history; volatile mechanics in its
> historical inventories can lag the focused contracts and executable owners
> linked from the field guide.

**Status:** Deep rationale and migration/implementation history; receiver-side
cross-version migration is active.
**Routing reviewed:** July 20, 2026

> **Historical overview warning:** the introductory inventory below predates
> later file-v3, conflict, recovery, and server-retention work. All providers
> (SuperSync, WebDAV/Nextcloud, Dropbox, OneDrive, and LocalFile) now enter the
> unified client operation-log pipeline; use the field guide and its focused
> source map for current behavior.

---

## Introduction: The Core Architecture

### The Core Concept: Event Sourcing

The operation log records replayable state transitions instead of persisting each
NgRx model independently. It is event-sourcing-inspired, but it is a bounded
operation log rather than an immutable history from the beginning of time:

- **Local recovery boundary:** startup loads a state-cache snapshot, then replays
  the retained tail. A safe terminal full-state operation can replace that work.
- **Mutable lifecycle metadata:** operation payloads are append-only, but delivery,
  application, rejection, and retry metadata changes as the row progresses.
- **Bounded history:** compaction deletes operations already covered by a safe
  snapshot and the relevant sync frontier. A `DELETE` is recorded as an operation,
  but neither it nor a rejected loser is permanent audit history.

### 1. How Data is Saved (The Write Path)

When a user performs an action (like ticking a checkbox):

1. **Reduce:** NgRx commits the live-state transition synchronously.
2. **Capture:** The capture meta-reducer marks a persistent local action as
   pending, or defers it while remote operations are being applied.
3. **Persist:** A non-dispatching effect serializes captured actions, validates
   each operation, and atomically appends the operation plus its new vector clock
   under the operation-log lock.
4. **Schedule sync:** Only after that durable append does the client update its
   pending status and request an upload.

The reducer deliberately runs before the asynchronous append. If persistence
fails, live state can therefore be ahead of the durable log; the client surfaces
a reload action and prevents compaction from baking that phantom change into a
snapshot. Open tabs do not exchange operation payloads: the web startup guard
blocks a second active instance instead.

### 2. How Data is Loaded (The Read Path)

Replaying _every_ operation since the beginning would be too slow. We use **Snapshots** to speed this up:

1.  **Load Snapshot:** On startup, the app loads the latest valid state-cache snapshot.
2.  **Replay Tail:** The app then queries the Log: "Give me all operations that happened _after_ this snapshot."
3.  **Fast Forward:** It applies those few "tail" operations to the snapshot. Now the app is fully up to date.
4.  **Hydration Optimization:** If a sync just happened, we might simply load the new state directly, skipping the replay entirely.

### 3. How Sync Works

The Operation Log enables two types of synchronization:

**A. SuperSync operation transport**

- **Exchange:** Devices swap individual `Operations`, not full files. This saves massive amounts of bandwidth.
- **Conflict Detection:** Because every operation has a **Vector Clock**, we can mathematically prove if two changes happened concurrently.
  - _Example:_ Device A sends "Update Title (Version 1 -> 2)". Device B sees it has "Version 1", so it applies the update safely.
  - _Conflict:_ If Device B _also_ made a change and is at "Version 2", it knows "Wait, we both changed Version 1 at the same time!" -> **Conflict Detected**.
- **Resolution:** Semantic precedence and eligible disjoint-field merge run first;
  remaining conflicts resolve deterministically with LWW. Ordinary operation
  conflicts do not block on a winner dialog. Rejected rows are retained only until
  compaction, and production conflict-journal emission is currently disabled.

**B. File-provider operation transport**

- The default v2 format stores a full state/archive baseline and a bounded recent-op
  buffer in one `sync-data.json`; each op-bearing upload rewrites that monolith.
- The opt-in v3 split format makes `sync-ops.json` the hot commit point and rewrites
  the snapshot/archive file only for bootstrap, compaction, migration, force-upload,
  or gap recovery.
- Both formats feed the same client operation-log pipeline. See
  [Part B](#part-b-file-based-sync) for the current transport contract.

### 4. Safety & Self-Healing

Validation occurs at operation ingress and at the hydration/sync checkpoints
described in Part D. Repairable state may produce a full-state `REPAIR`
operation; unrepaired failures prevent the session from claiming success. A
repair row is retained like other operations, not as permanent audit history.

### 5. Maintenance (Compaction)

After 500 durable local appends, the client _attempts_ compaction. The attempt can
skip safely when remote reducer/archive work, pending local writes, a persistence
divergence, hydration fallback, or an empty/degraded store makes snapshotting
unsafe. A successful pass writes a new state-cache boundary and deletes only old,
terminal rows covered by that boundary; unsynced and incomplete rows remain.

---

## Overview

The Operation Log serves **four distinct purposes**:

| Purpose                    | Description                                       | Status       |
| -------------------------- | ------------------------------------------------- | ------------ |
| **A. Local Persistence**   | Fast writes, crash recovery, event sourcing       | Complete ✅  |
| **B. File-Based Sync**     | Default v2 monolith or opt-in v3 split files      | Complete ✅  |
| **C. Server Sync**         | Upload/download individual operations (SuperSync) | Complete ✅¹ |
| **D. Validation & Repair** | Prevent corruption, auto-repair invalid state     | Complete ✅  |

> ¹ **Cross-version sync**: receiver-side op migration (A.7.11) runs before conflict detection. The remaining caveat is the released fleet: v17.0.0–v18.14.0 clients apply newer-schema ops (up to schema 5) unmigrated — see the [A.7.11 Bump Policy](#bump-policy--a-bump-does-not-protect-the-released-fleet).

> **✅ Migrations Active**: Migration safety (A.7.12), tail ops consistency (A.7.13), and unified migration interface (A.7.15) are implemented, and real migrations exist — `CURRENT_SCHEMA_VERSION = 4` (v1→v2 misc-to-tasks-settings split; v2→v3 and v3→v4 are semantic compatibility barriers). See A.7 and the A.7.11 Bump Policy.

This document is structured around these four purposes. Most complexity lives in **Part A** (local persistence). **Part B** handles file-based sync via the `FileBasedSyncAdapter`. **Part C** handles operation-based sync with SuperSync server. **Part D** integrates validation and automatic repair.

```
Local intent ──► NgRx reducer ──► live state
      │
      └──► capture + ordered append ──► SUP_OPS
                                            │
                                            ├──► SuperSync operation transport
                                            └──► file-provider envelopes

Remote input ──► migrate/filter/resolve ──► reducers + archive side effects
                                                │
                                                └──► durable checkpoint/cursor
```

---

## Why this architecture: rejected alternatives

The operation log is **not** incidental complexity. It is the minimum design
that satisfies one hard, non-negotiable constraint:

> **Design goal: no silent data loss on concurrent multi-device edits,
> offline-first, with a "dumb" server that cannot merge** (file providers have no
> server logic; SuperSync payloads can be end-to-end encrypted and opaque to the
> server).

This is the constraint the architecture is intended to satisfy, not a claim that
all races are closed. The #9073 no-pending mitigation reconstructs retained
concurrent local operations and routes supported overlapping crossings through
deterministic LWW, but it cannot do so when the local side is no longer retained
or cannot be decomposed safely. The focused
[conflict contract](./conflict-journal-and-review.md#composition-residual-pre-existing-class)
documents that residual and its possible class-level fixes.

Independent prior analyses (three separate model reviews) evaluated every
simpler approach against that constraint and rejected each:

| Alternative                            | What it is                                                       | Why rejected                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Last-Write-Wins (global timestamp)** | Drop logical clocks; newest wall-clock write wins                | User devices have unreliable clocks; concurrent independent field edits silently overwrite each other. Unacceptable for a personal productivity app. (Survives only as a _field-level_ tie-break inside conflict resolution.)                                                         |
| **Delta / state-diff sync**            | Keep a shadow copy, upload changed fields, server shallow-merges | Shadow state has no atomic coupling with the watermark → a crash mid-sync corrupts permanently; LWW shallow-merge loses concurrent independent edits; O(N) `JSON.stringify` diffing freezes the UI at 10k+ tasks; requires server-side merge, incompatible with opaque E2EE payloads. |
| **Full-state / snapshot sync**         | Sync whole model files (the old PFAPI model)                     | Re-transfers everything on every change; no per-entity conflict granularity; cannot reconstruct intent after an offline edit. Retained only as a _bootstrapping_ mechanism (snapshot + tail replay), not the sync mechanism.                                                          |
| **CRDTs (Yjs/Automerge/etc.)**         | Math-guaranteed convergence                                      | High conceptual complexity; most implementations assume a trusted server or relay, clashing with the dumb-file + E2EE constraint. The op-log deliberately _borrows_ op-based-CRDT properties (UUID idempotency, causal ordering) without the full machinery.                          |
| **Server-assigned sequence numbers**   | Let the server impose a total order                              | Requires server connectivity for ordering — incompatible with offline-first and file-based providers that have no server. Used only as a _complement_ (SuperSync seq for global order; vector clocks still required for the file-based/offline case).                                 |

**Consequences any future redesign must preserve:** classify concurrent
independent edits before overwriting them and keep any remaining residuals
explicit; work without a trusted/merging server and with opaque E2EE payloads;
rebase offline edits cleanly on reconnect; retain tombstones long enough;
bound growth via snapshot + compaction; prefer false-concurrency over
false-ordering in conflict metadata (compare clocks _before_ pruning); scale to
10k+ active / 20k+ archived tasks without main-thread O(N) work.

The only self-identified over-engineering historically was the vector-clock
pruning _defense layers_, which were since removed (see
[`vector-clocks.md`](./vector-clocks.md)).

---

# Part A: Local Persistence

The operation log is the durable transition log for local persistence. It is
WAL-like, but the reducer runs before asynchronous capture/append, so the
divergence guard is part of its safety contract. It provides:

1. **Fast writes** - Small ops are instant vs. serializing 5MB on every change
2. **Crash recovery** - Rebuild from a screened snapshot plus retained tail
3. **Bounded evidence** - Retain recent transitions for recovery and debugging,
   not as a permanent audit log or general undo history

## A.1 Database Architecture

`SUP_OPS` contains more than a single append-only table. Its current stores and
indexes are defined by
[`OperationLogStoreService`](../../src/app/op-log/persistence/operation-log-store.service.ts),
which is the authority for upgrades and transaction boundaries:

| Durable concern          | Role                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Operation rows           | Retained local and remote operations plus mutable delivery/application metadata                         |
| State cache              | A boot-time baseline with its covered local sequence, vector clock, schema version, and entity frontier |
| Clock/client/meta rows   | Working causal state, device identity, full-state metadata, and replacement/rebuild recovery markers    |
| Young/old archive stores | Archived tasks and time-tracking data that live outside NgRx                                            |

The exact operation envelope is owned by
[`@sp/sync-core`](../../packages/sync-core/src/operation.types.ts) and narrowed for
the application in
[`operation.types.ts`](../../src/app/op-log/core/operation.types.ts). Do not copy
those interfaces into design docs: both the envelope and row metadata evolve.

Synced application-model recovery data lives in `SUP_OPS`. Provider credentials,
conflict-journal records, plugin caches, and local UI/browser settings have
separate owners; see the [user-data reference](../wiki/3.06-User-Data.md).

### Remote Apply Checkpoints

Downloaded operations use a durable status transition so reducer state, archive IndexedDB side effects, vector clocks, and the server cursor cannot disagree after a crash:

1. `pending` — the remote op is stored, but no reducer-commit checkpoint exists yet.
2. `archive_pending` — reducers committed and the op's vector clock was merged atomically; archive side effects have not yet completed.
3. `failed` — an archive side-effect attempt failed. `retryCount` is charged only to the attempted row, so later rows in the same batch do not consume retry budget.
4. `applied` — reducer and archive work both completed.

Bulk replay isolates conversion/reducer exceptions per operation. The reducer-successful
subsequence is checkpointed and receives archive side effects; ordinary reducer-failed remote
rows are marked with terminal `rejectedAt` plus `reducerRejectedAt` metadata in the **same transaction**.
`reducerRejectedAt` is distinct from an ordinary sync rejection: hydration excludes that row
because its migrated reducer effect never entered state. Pending rows deliberately removed by a
schema migration receive the same terminal marker. This prevents one malformed operation from
terminating NgRx's state pipeline or receiving archive work, without creating a crash window
where startup could mistake it for incomplete reducer work.

Full-state and local operations are exceptions: a full-state failure discards the entire
speculative bulk batch, while a local replay failure aborts hydration without rejecting the user
intent. Neither case is terminally acknowledged when its state never entered NgRx.

Startup recovery leaves surviving `pending` rows pending, then hydration replays them through the
same per-operation reducer-failure collector. Successful rows and reducer failures are durably
partitioned before archive retry or snapshot creation. A pending full-state operation never uses
the direct-load shortcut. During live sync, a full-state reducer failure aborts before the reducer
checkpoint and server cursor advance, so the pending row remains recoverable. Hydration retries
`archive_pending`/`failed` rows with reducer dispatch disabled. Ordinary sync refuses to download,
upload, or advance its cursor while any incomplete rows remain. Version 8 introduced a downgrade
barrier for the reducer/archive checkpoint; version 9 similarly prevents older readers from replaying
operations quarantined with `reducerRejectedAt`.

Local actions buffered during a remote-apply window stay ordered until each operation is durable. Transient persistence failures keep the failed suffix queued and block the current sync so a later sync can retry. A deterministically invalid buffered action also remains queued, but requires reload: its reducer already changed live state, so discarding it would let live state diverge from the durable operation log.

## A.2 Write Path

```
User Action
    │
    ▼
NgRx reducer commits live state
    │
    └──► capture meta-reducer marks the local persistent action pending
              │
              └──► non-dispatching effect, ordered with concatMap
                        │
                        ├──► validate identifiers/payload
                        ├──► create operation + incremented clock
                        └──► lock + atomic operation/clock append
                                  │
                                  ├──► success: upload/compaction bookkeeping
                                  └──► failure: surface reload + fence compaction
```

### Persistent Action Pattern

Only actions with explicit `meta.isPersistent: true` enter the capture path.
Remote/replayed actions set `meta.isRemote` and are never captured again. During
remote application, new local persistent actions are buffered and appended later
with clocks based on the applied remote frontier.

The contract is executable in
[`persistent-action.interface.ts`](../../src/app/op-log/core/persistent-action.interface.ts),
[`operation-capture.meta-reducer.ts`](../../src/app/op-log/capture/operation-capture.meta-reducer.ts),
and
[`operation-log.effects.ts`](../../src/app/op-log/capture/operation-log.effects.ts).
UI-only state and hydration/replay plumbing must not masquerade as new user
intent.

## A.3 Read Path (Hydration)

```
App Startup
    │
    ▼
OperationLogHydratorService
    │
    ├──► Load snapshot from SUP_OPS.state_cache
    │         │
    │         └──► If no snapshot: Genesis migration from 'pf'
    │
    ├──► Run schema migration if needed
    │
    ├──► Dispatch loadAllData(snapshot, { isHydration: true })
    │
    └──► Load replay range (seq > snapshot.lastAppliedOpSeq)
              │
              ├──► If the final op carries full state and no reducer work is pending:
              │      validate and load that state directly
              │
              ├──► Otherwise: migrate operations, then replay the result
              │      (migration may transform, split, or drop obsolete rows)
              │
              └──► If replayed >10 ops and state is valid: save a new snapshot
```

### Hydration Optimizations

Two optimizations speed up hydration:

1. **Direct-load a safe terminal full state**: When the last replayable operation is a `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR`, and no row in that replay range still has pending reducer work, the hydrator validates and loads its full state directly. Pending work disables the shortcut so those rows can be replayed and checkpointed.

2. **Save snapshot after replay**: After replaying more than 10 tail operations, a new state cache snapshot is saved. This avoids replaying the same operations on subsequent startups.

### Genesis Migration

With no state cache, hydration first runs the local legacy migration check and
then re-reads the cache. If both the cache and operation log are empty, the app
keeps its normal initial NgRx state; it does not manufacture the pseudo-snapshot
shown in older versions of this document. Legacy `pf` recovery is allowed only
after proving that `SUP_OPS` contains neither a snapshot nor operation rows, and
the recovery operation plus snapshot are committed atomically. See
[`operation-log-hydrator.service.ts`](../../src/app/op-log/persistence/operation-log-hydrator.service.ts)
and
[`operation-log-recovery.service.ts`](../../src/app/op-log/persistence/operation-log-recovery.service.ts).

A genesis op (`MIGRATION` / `RECOVERY`) is not replayable by other clients — it
carries this client's whole state as an ordinary Batch op that receivers apply
as a no-op. A client whose history is still only that genesis op (never synced,
no full-state op) is therefore treated like a fresh client with local data at
join time: it gets the local-data conflict dialog on a non-empty server, or
seeds an empty server with a `SYNC_IMPORT`
(`SyncLocalStateService.isNeverSyncedGenesisClient`, #9863). Because that
download-side decision is what actually ships the state, API-based providers
(SuperSync) never upload the genesis op itself: `OperationLogUploadService`
leaves it out of the upload set and marks it synced locally once the round's
full-state ops are settled (`isGenesisEntityType`, #9921). While the upload is
still blocked (no encryption key yet), or when this client's own `SYNC_IMPORT`
was just dropped on `SYNC_IMPORT_EXISTS`, the op stays pending, because a
pending genesis op is what makes the incoming-import gate prompt. File-based
providers keep uploading it: there the ops upload is what writes the state
snapshot. Servers may still hold genesis ops uploaded by older clients;
receivers apply them as no-ops as before.

## A.4 Compaction

### Purpose

Without compaction, the op log grows unbounded. Compaction:

1. Creates a fresh snapshot from current NgRx state
2. Deletes old ops that are "baked into" the snapshot

### Triggers

- An asynchronous attempt after **500 durable local operation appends**
- Recovery of an older snapshot that lacks the current entity frontier
- An emergency attempt after a storage-quota append failure

### Process

Normal compaction drains local capture before taking the operation-log lock. It
then refuses to snapshot while remote work is incomplete, a local operation is
pending or undrained, a persistence failure left live state ahead, hydration is
running in fallback mode, or the live store has no meaningful data. Skipping is
safe because the retained log remains the recovery source.

On success it snapshots current state with the latest local sequence, working
vector clock, schema version, and entity frontier, resets the compaction counter,
then prunes only rows that are terminal, covered by the snapshot, and older than
the retention cutoff. Active unsynced rows and incomplete remote rows survive.
The exact guard ordering is load-bearing; follow
[`operation-log-compaction.service.ts`](../../src/app/op-log/persistence/operation-log-compaction.service.ts)
rather than reimplementing it from prose.

### Configuration

| Setting                       | Current value          | Meaning                                                  |
| ----------------------------- | ---------------------- | -------------------------------------------------------- |
| Automatic attempt             | 500 appends            | In-memory/persisted counter threshold                    |
| Normal terminal-row retention | 7 days                 | Recent synced/rejected evidence remains available        |
| Emergency retention           | 1 day                  | More aggressive eligible-row pruning after quota failure |
| Phase timeout                 | 25 seconds             | Abort before an overlong compaction outruns lock safety  |
| Failure notification          | 3 consecutive failures | Surface persistent maintenance failure                   |

These values are centralized in
[`operation-log.const.ts`](../../src/app/op-log/core/operation-log.const.ts).

## A.5 Multi-Tab Coordination

Browser builds use the Web Locks API to serialize named critical sections over
shared IndexedDB. Electron and Android WebView are single-instance and use an
in-process promise mutex. Browsers without Web Locks also fall back to that
single-tab mutex, which cannot protect two tabs.

The app does **not** broadcast operation payloads between live tabs. Startup uses
a `BroadcastChannel` handshake to block a second same-origin instance. That
single-instance policy and the Web Locks layer are complementary safeguards; see
[`StartupService`](../../src/app/core/startup/startup.service.ts) and
[`LockService`](../../src/app/op-log/sync/lock.service.ts).

## A.6 LOCAL_ACTIONS Token for Effects

Remote/replayed actions carry `meta.isRemote: true`. Re-running ordinary effects
for them can duplicate notifications, external calls, and—most dangerously—new
persistent actions. Therefore effects inject
[`LOCAL_ACTIONS`](../../src/app/util/local-actions.token.ts), which excludes
remote actions. The sole broad-stream exception is the operation-log capture
effect, whose own filters enforce the persistence boundary.

This is one half of the atomic-intent rule. A state transition that must replay
atomically across synced slices or entities belongs in a meta-reducer so the
reducer pass and captured operation remain one unit; an effect fan-out creates
multiple independently syncable operations. Broader workflows may deliberately
remain independent persistent actions when their normal side effects and
entity-specific conflict boundaries matter, as documented for
[project completion in ADR #5](../../ARCHITECTURE-DECISIONS.md#5-project-completion-decoupled-resolution-over-atomic-multi-entity-op).
Selector-driven effects also require the hydration/sync guard. The normative
contributor rules and examples live in
[`contributor-sync-model.md`](./contributor-sync-model.md).

---

## A.6.1 Disaster Recovery

### SUP_OPS Corruption

```
1. Detect: Hydration fails or returns empty/invalid state
2. Verify SUP_OPS has neither a snapshot nor any operation rows
3. Only when SUP_OPS is provably empty, check legacy 'pf' database for data
4. If found: Run recovery migration with that data
5. Otherwise: restore through sync or a user-selected backup
```

Automatic legacy recovery runs the emptiness check and legacy write under the operation-log
lock, and fails closed. A present snapshot, a non-empty operation log, or an inspection error
prevents the legacy write and propagates the hydration failure. The generic hydration catch
must never place an older `pf` copy at the current SUP_OPS sequence frontier. When recovery is
allowed, the recovery operation, state-cache snapshot, and vector clock commit in one IndexedDB
transaction; an interrupted write cannot leave a snapshot claiming an operation that rolled back.

The exact branches matter: a corrupt but present snapshot first falls back to
retained-op replay, while legacy recovery is a last resort for a provably empty
`SUP_OPS` database. Follow
[`operation-log-hydrator.service.ts`](../../src/app/op-log/persistence/operation-log-hydrator.service.ts)
and
[`operation-log-recovery.service.ts`](../../src/app/op-log/persistence/operation-log-recovery.service.ts)
rather than translating this summary into recovery code.

## A.7 Schema Migrations

When Super Productivity's data model changes (new fields, renamed properties, restructured entities), schema migrations ensure existing data remains usable after app updates.

> **Current Status (2026-07):** `CURRENT_SCHEMA_VERSION = 4`. Three migrations exist: v1→v2 (misc-to-tasks-settings split, a real payload transformation) and two no-op semantic barriers — v2→v3 (replacement-mode LWW envelopes) and v3→v4 (marked project delete-wins). The barriers change no stored shapes; they gate conflict semantics for receivers that understand them. Read the [A.7.11 Bump Policy](#bump-policy--a-bump-does-not-protect-the-released-fleet) before adding version 5.

### Configuration

`CURRENT_SCHEMA_VERSION` and `MIN_SUPPORTED_SCHEMA_VERSION` are defined in
[`packages/shared-schema/src/schema-version.ts`](../../packages/shared-schema/src/schema-version.ts)
and re-exported by the client migration service. Current receivers have no
forward-compatibility skip band; the released-fleet exception is documented in
the bump policy below.

### Core Concepts

| Concept                    | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| **Schema Version**         | Integer tracking current data model version (stored in ops + snapshots)     |
| **Migration**              | Function transforming state from version N to N+1                           |
| **Snapshot Boundary**      | Migrations run when loading snapshots, creating clean versioned checkpoints |
| **Forward Compatibility**  | Newer apps can read older data (via migrations)                             |
| **Backward Compatibility** | Older apps receiving newer ops (via graceful degradation)                   |

### Migration Triggers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    App Update Detected                               │
│                    (schemaVersion mismatch)                          │
└─────────────────────────────────────────────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    Load Snapshot         Replay Ops         Receive Remote Ops
    (older version)       (mixed versions)   (ordered remote batch)
           │                   │                   │
           ▼                   ▼                   ▼
    migrateState         migrateOperation    Screen, then migrate
    shared chain         shared chain        compatible prefix
```

### A.7.1 Snapshot Migration (Local)

When app starts and finds a snapshot with older schema version:

```
App Startup (schema v1 → v2)
    │
    ▼
Load state_cache (v1 snapshot)
    │
    ▼
Detect version mismatch: snapshot.schemaVersion < CURRENT_SCHEMA_VERSION
    │
    ▼
Run migration chain: migrateV1ToV2(snapshot.state)
    │
    ▼
Dispatch loadAllData(migratedState)
    │
    ▼
Force new snapshot with schemaVersion = 2
    │
    ▼
Continue with tail ops (ops after snapshot)
```

### A.7.2 Operation Replay (Mixed Versions)

Operations in the log may have different schema versions. Before replay, the
hydrator runs the shared operation-migration chain.

One source operation can remain unchanged, be transformed, expand into several
operations, or be dropped as obsolete. The hydrator replays only the migrated
result and keeps source-operation IDs for durable reducer checkpointing. See the
shared [`migrate.ts`](../../packages/shared-schema/src/migrate.ts) chain and the
client
[`operation-log-hydrator.service.ts`](../../src/app/op-log/persistence/operation-log-hydrator.service.ts)
for the executable contract.

### A.7.3 Remote Sync (Cross-Version Clients)

[`RemoteOpsProcessingService`](../../src/app/op-log/sync/remote-ops-processing.service.ts)
screens a downloaded batch in transport order. For each operation it first
validates the schema version. An invalid version, a version below the supported
minimum, a version newer than this client, or a migration failure stops the
batch at that operation. The compatible prefix may finish processing; the
blocked operation and suffix are neither stored nor applied. Callers leave the
transport cursor unchanged so that suffix is downloaded again after an update
or migration fix.

Compatible older operations run through the shared migration chain before
full-state filtering, conflict detection, or reducer application. A migration
may transform or split an operation; `null` is an intentional terminal drop and
does not block the cursor.

### A.7.4 Full State Imports (SYNC_IMPORT/BACKUP_IMPORT)

Full-state operations do not have a separate forward-compatibility path. They
pass through the same ordered compatibility screen as every other remote
operation: a too-new full-state operation blocks itself and the suffix, and the
caller freezes the cursor. Current code has no `MAX_VERSION_SKIP` branch and
does not attempt to load newer state by stripping unknown fields.

For an older full-state operation, the shared operation chain is the receiver
boundary. A migration that changes persisted state shape must cover both
snapshots through `migrateState` and relevant full-state or incremental payloads
through `migrateOperation`; replacement semantics run only after that operation
is compatible.

### A.7.5 Migration Implementation

Migrations are defined in
[`packages/shared-schema/src/migrations/`](../../packages/shared-schema/src/migrations/)
and executed by the shared [`migrate.ts`](../../packages/shared-schema/src/migrate.ts)
chain. The stable type contract lives in
[`migration.types.ts`](../../packages/shared-schema/src/migration.types.ts):
every `SchemaMigration` supplies `migrateState`, while optional
`migrateOperation` accepts an `OperationLike` and returns `OperationLike`,
`OperationLike[]`, or `null`.

**How to create a new migration:**

1. Read the [A.7.11 Bump Policy](#bump-policy--a-bump-does-not-protect-the-released-fleet)
   and avoid a bump when older clients can safely tolerate a payload marker or
   envelope.
2. If a bump is required, update
   [`schema-version.ts`](../../packages/shared-schema/src/schema-version.ts), add
   the next contiguous registry entry, and declare whether operation migration
   is required.
3. Test state migration, unchanged/transformed/split/dropped operation results
   as applicable, retained-tail replay, and the remote cursor-freeze path.

**Transforming-migration residual:** the receiver pipeline is implemented, but
any future field rename or removal still needs a concrete payload
transformation (or intentional drop) and cross-version tests. The existence of
the shared chain alone does not make that change safe.

### A.7.10 Legacy Data Migration

> **Note:** The legacy PFAPI system has been removed (January 2026). This section documents historical migration paths.

For users upgrading from older versions (pre-operation-log), the `ServerMigrationService` handles migration:

1. On first sync, it detects legacy remote data format
2. Downloads the full state from the legacy format
3. Creates a `SYNC_IMPORT` operation with the imported state
4. Uploads the new format to the sync provider

**Key file:** `src/app/op-log/sync/server-migration.service.ts`

All future schema changes should use the **Schema Migration** system (A.7) described above.

### A.7.6 Implemented Safety Features

**Migration Safety (A.7.12)** ✅ - Backup created before migration; rollback on failure.

**Tail Ops Consistency (A.7.13)** ✅ - Tail ops are migrated during hydration to match current schema.

**Unified Migrations (A.7.15)** ✅ - State and operation migrations linked in single `SchemaMigration` definition.

### A.7.7 When Is Operation Migration Needed?

| Change Type          | State Migration   | Op Migration                   | Example                     |
| -------------------- | ----------------- | ------------------------------ | --------------------------- |
| Add optional field   | ✅ (set default)  | ❌ (old ops just don't set it) | `priority?: string`         |
| Rename field         | ✅ (copy old→new) | ✅ (transform payload)         | `estimate` → `timeEstimate` |
| Remove field/feature | ✅ (delete it)    | ✅ (drop ops or strip field)   | Remove `pomodoro`           |
| Change field type    | ✅ (convert)      | ✅ (convert in payload)        | `"1h"` → `3600`             |
| Add entity type      | ✅ (initialize)   | ❌ (no old ops exist)          | New `Board` entity          |

**Rule of thumb:** Additive changes (new optional fields, new entities) don't need operation migration. Field renames/removals require it.

### A.7.8 Cross-Version Sync

**Status:** Implemented receiver-side: compatible remote ops pass
`SchemaMigrationService.migrateOperation()` before conflict detection; a
too-new op is blocked before migration. Senders upload ops as-is.

**Guardrails for newer-schema ops:**

- Current receivers (post-v18.14.0): block any op with `schemaVersion > CURRENT_SCHEMA_VERSION` outright, freeze the download cursor, and prompt for an app update.
- Released receivers (v17.0.0–v18.14.0): tolerate up to `CURRENT + 3` (their `MAX_VERSION_SKIP`) and apply those ops UNMIGRATED after a once-per-session warning — and they advance the cursor even when blocking, permanently skipping blocked ops. This fleet reality drives the A.7.11 Bump Policy.

**Required before:** Any schema migration that renames/removes fields.

### A.7.11 Cross-Version Sync Implementation Guide

> **Status:** Receiver-side state and operation migration is implemented. The
> Bump Policy below is normative.

#### Receiver contract

The current receiver contract is deliberately one-way:

- Compatible older operations use the shared migration chain before conflict
  detection.
- The first too-new, unsupported, invalid, or failed-to-migrate operation stops
  processing at that point. Its suffix is not migrated or applied, and callers
  freeze the cursor.
- A current client never forward-migrates a newer operation. Safety for older
  released clients therefore comes from payload-level graceful degradation, not
  from the version stamp.

#### Bump Policy — a bump does NOT protect the released fleet

A version bump only fences receivers that ship AFTER the bump. As of 2026-07:

- Every released client from v17.0.0 through v18.14.0 runs schema 2 with a forward-compat band (`MAX_VERSION_SKIP = 3`): it APPLIES ops up to schema 5 unmigrated after a once-per-session warning snack, and blocks schema ≥ 6 — but these clients advance the server cursor even while blocking, permanently skipping the blocked ops (loss that survives the later app update).
- Post-v18.14.0 receivers block any newer-schema op outright and freeze the cursor (loud and lossless).

Therefore:

0. **Default: do NOT bump.** A bump is near-irreversible and it is not free even when "safe": it hard-blocks every not-yet-updated post-v18.14.0 client (frozen cursor) on the new ops, and it cannot be reverted once any op carries the new version — a reverted client hard-blocks on the v(N+1) ops it already wrote and the USE_REMOTE recovery path throws on them. So a bump must earn its cost. If old clients can apply the op unmigrated (the envelope / inert-marker pattern), gate the new semantics on a payload marker and **leave `CURRENT_SCHEMA_VERSION` alone**. Only bump when a change genuinely requires it: a transforming migration (renamed/removed field, dropped op) or a semantic you must hard-fence off older clients. **Cautionary example — v4 (#9009, project delete-wins) was bumped for a marker-only change old clients degrade on fine: the feature is driven entirely by the payload marker (plus the `entityId === projectId` auth check); the `schemaVersion >= 4` gate adds only narrow malformed-op hardening, not feature correctness. It needed no bump, yet it now fences every lagging post-v18.14.0 client and can't be undone. Don't repeat it.**
1. New op semantics MUST degrade gracefully on older clients — see the `LwwUpdatePayload` envelope pattern in `packages/sync-core` ('patch' ops apply correctly on pre-v3 clients via `updateOne`; the v4 delete-wins marker is inert for them). If they degrade, bumping is _safe_ at any fleet share (the stamp is a fence for future receivers, not a protection for current ones) — but safe ≠ necessary: if it degrades, prefer a marker/envelope with **no** bump (see 0).
2. A change that older clients would MISAPPLY must not ship behind a bump alone. No fleet percentage makes it safe while released v17–v18.14 clients still sync: one lagging device silently misapplies the ops for its whole account and writes the result back with dominating clocks. Treat such changes as blocked until the v17–v18.14 sync fleet is effectively extinct — or redesign them to degrade (option 1).
3. **Precondition: any bump PR must address the downgrade relabel (#8770).** Local hydration has no future-version gate — `stateNeedsMigration()` is `version < target` — so a vN client reading a v(N+1) state cache (rollback, snap channel lag, old sideloaded APK) loads it unmigrated (Checkpoint B validation is non-fatal and never repairs), and the next snapshot/compaction write stamps it `CURRENT_SCHEMA_VERSION`. The cache is then v(N+1)-shaped under a vN label — additive residue survives because typia's `createValidate` does not strip excess properties — and on re-upgrade the N→N+1 migration runs a **second** time on already-migrated state. Until #8770 ships a guard (repro-first, per the sync-change rule), every migration MUST be a no-op on already-migrated state (v1→v2 guards via `hasMigratedFields`; barrier migrations are no-ops by construction), and the bump PR must state how downgraded clients are handled.

#### Widening a wire vocabulary needs no bump — but the receiver must block

`opType`, `syncImportReason`, and restore-point `type` are strict enums only on
the REQUEST side of the SuperSync contract, where the server validates per op.
On the RESPONSE side they are loose strings, and the receiver decides per op
(`remote-op-block.util.ts`, the one block predicate shared by
`remote-ops-processing.service.ts`, the full-state conflict gate's prefix cut,
and the USE_REMOTE preflight): an unknown
value blocks the batch at that op exactly like `VERSION_TOO_NEW` — prefix
applied, cursor frozen, "update your app" snack — never a skip, which would
advance the cursor past data the client never understood. (Restore points of
an unknown type are simply kept in the list and rendered generically.) Before this the
transport parser rejected the whole page with a generic error and wedged every
not-yet-updated device (#8764). Two consequences:

- Adding a value to one of these unions does not require a schema bump; per
  rule 0 above, don't add one for it.
- Clients released before this receiver change still wedge on any widening,
  so a widening must wait for a release-lag window after it shipped. The
  window covers servers too: `validation.service.ts` rejects unknown op types
  on upload, so self-hosted servers must carry the new value first.

A type-level assertion in `super-sync.ts` keeps the sync-core `OpType` enum
and `SUPER_SYNC_OP_TYPES` identical, so a value added to one side fails the
build instead of surfacing as a runtime block on other devices.

#### Executable sources and release checks

Follow the executable contracts instead of copying their shapes into this guide:

- Ordered remote screening and cursor-block result:
  [`remote-ops-processing.service.ts`](../../src/app/op-log/sync/remote-ops-processing.service.ts)
- Migration return types:
  [`migration.types.ts`](../../packages/shared-schema/src/migration.types.ts)
- Shared state and operation chains:
  [`migrate.ts`](../../packages/shared-schema/src/migrate.ts)
- Current/minimum versions and the code-level bump warning:
  [`schema-version.ts`](../../packages/shared-schema/src/schema-version.ts)

Before release, tests must cover the concrete state transformation, every
relevant operation result (including split or drop), retained-tail replay, and a
remote batch whose incompatible operation leaves its suffix and cursor
untouched.

---

# Part B: File-Based Sync

WebDAV, Nextcloud, Dropbox, OneDrive, and LocalFile have no operation API. The
client therefore adapts their file primitives to the same operation-sync
interface used by the rest of the pipeline. The full visual tour lives in the
field guide's [transport section](./sync-architecture.html#transport); this part
records only the durable format boundary and its owners.

## B.1 Two Current Wire Formats

| Format                                      | Remote files                                                                                          | Normal op-bearing sync                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v2 monolith (default)**                   | `sync-data.json` plus recovery backup                                                                 | Downloads the changed monolith, merges its retained ops, rebuilds current state plus both archive partitions, and conditionally rewrites the complete monolith.             |
| **v3 split files (opt-in “Surgical sync”)** | `sync-ops.json`, referenced snapshot generation, compatibility state/backup files, and a v2 tombstone | Conditionally rewrites the bounded ops commit point. A full state/archive snapshot is written only for initial bootstrap, compaction, migration, force-upload, or recovery. |

Both formats carry a vector clock, schema version, synthetic `syncVersion`, and
a bounded `recentOps` buffer. That common adapter and envelope do not themselves
provide physical compare-and-swap. The provider interface calls its
conditional-write token `rev`: a read returns it, and the adapter passes it back
as the expected token for upload. It is provider-native where the backend
supplies revision/ETag CAS and a synthetic content hash on the best-effort
fallbacks:

- Dropbox revisions and OneDrive ETags enforce atomic conditional replacement.
- WebDAV/Nextcloud can enforce atomic replacement when a read returns a strong
  ETag, which the upload sends as `If-Match`. Without a strong ETag, `rev` falls
  back to a content hash; the pre-upload GET detects an already-stale writer but
  cannot close the GET→PUT race, so concurrency protection is best effort.
- LocalFile also uses a content hash and a read/check/write sequence with no
  cross-process CAS. It is a single-writer, backup-only transport, not a safe
  concurrent multi-device writer.

Where the provider enforces CAS, a revision mismatch aborts the write and a
later cycle downloads before retrying. The best-effort backends cannot broadly
guarantee that every simultaneous write race will abort.

The v3 migration is one-way for a sync folder. It leaves a v3 tombstone in the
legacy `sync-data.json` location so clients that do not understand the split
format stop instead of recreating an independent v2 history.

## B.2 Bootstrap, Incremental Catch-up, and Gaps

File providers do not expose a server-assigned operation cursor. The adapter
treats file `syncVersion` as a synthetic transport watermark and exposes it as
`latestSeq` to the common sync orchestration. A normal op-bearing commit advances
it once; snapshot replacement can reset it, which the gap path detects. It is
not the provider `rev`/ETag and does not prove per-operation ordering. One upload
can carry multiple operations under the same new watermark; stable operation
IDs provide durable deduplication, while vector clocks carry causality.

1. **Normal catch-up:** download the bounded ops buffer and pass every retained
   candidate through the common applied-ID and conflict pipeline.
2. **Fresh client / forced seq-0:** return a full state/archive baseline. In v2,
   that baseline represents the monolith and its retained ops. In v3, the ops
   file points to a validated snapshot generation; retained ops newer than the
   snapshot boundary replay on top.
3. **Gap:** a version reset, snapshot replacement, or trimmed operation needed by
   this client signals a gap. The caller retries from seq 0 and installs the
   causal baseline instead of pretending the remaining buffer is complete.
4. **Commit:** the downloaded `rev`, vector clock, and expected synthetic
   watermark remain staged until the caller confirms that baseline and ops were
   durably applied. Cancelling a data-conflict decision does not advance the
   baseline.

A bootstrap or gap baseline is transport state, not an automatic new
`SYNC_IMPORT` for every download. The sync service hydrates the baseline under
the op-log/archive locks and records which retained operations the baseline
already contains; only the suffix beyond that boundary is replayed.

## B.3 Archive Boundary

`archiveYoung` and `archiveOld` are local IndexedDB partitions, not independent
remote histories. A full file baseline includes both partitions; archive intent
also travels in operations so another client can execute the same idempotent
move/restore side effect.

- v2 re-embeds both complete archive partitions on each op-bearing monolith
  upload.
- v3 embeds them when it writes a full snapshot; op-only syncs between snapshots
  do not rewrite the archive files, although an archive operation itself carries
  the data required for deterministic application.
- Applying a remote full-state baseline holds the archive mutex and commits the
  young/old pair atomically. Compression uses that same mutex so it cannot write
  an archive image read before a concurrent replacement.

## B.4 Executable Owners

| Contract                                                                                            | Owner                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| v2/v3 envelopes, filenames, caps, and snapshot reference                                            | [`packages/sync-providers/src/file-based-sync-data.ts`](../../packages/sync-providers/src/file-based-sync-data.ts)        |
| Format selection, conditional IO, migration, gap detection, baseline staging, and archive inclusion | [`file-based-sync-adapter.service.ts`](../../src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts) |
| Baseline installation and common download/conflict orchestration                                    | [`operation-log-sync.service.ts`](../../src/app/op-log/sync/operation-log-sync.service.ts)                                |
| Local archive side effects                                                                          | [`archive-operation-handler.service.ts`](../../src/app/op-log/apply/archive-operation-handler.service.ts)                 |

---

# Part C: Server Sync

For server-based sync, the operation log IS the sync mechanism. Individual operations are uploaded/downloaded rather than full state snapshots.

## C.1 How Server Sync Differs from File-Based

| Aspect              | File-Based Sync (Part B)                                           | SuperSync (Part C)                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Incremental unit    | Bounded compact ops inside v2 or v3 file format                    | Individual retained operations       |
| Baseline            | Client-written full state/archive snapshot                         | Causal full-state operation in log   |
| Transport watermark | Synthetic `syncVersion` exposed as `latestSeq`, plus ID dedup      | Server-assigned sequence             |
| Write-race guard    | Provider `rev`; atomic only when the backend supports physical CAS | Database transaction                 |
| Server visibility   | No application logic                                               | Payloads opaque when E2EE is enabled |

## C.2 Operation Sync Protocol

The shared port is
[`OperationSyncCapable`](../../packages/sync-providers/src/provider-types.ts).
Its API and file-provider modes deliberately share one orchestration contract,
but differ in pagination and baseline behavior. For SuperSync, one normal cycle:

1. waits for accepted local-action capture to finish and resolves a fenced
   provider/epoch pair;
2. downloads ordered pages after the last durably committed server sequence,
   before uploading local rows;
3. migrates, filters, conflict-resolves, applies, and checkpoints each compatible
   prefix, advancing the cursor only after its baseline, operations, archive side
   effects, applied IDs, and clocks are durable;
4. uploads pending local rows in bounded batches and processes per-operation
   acceptance/rejection results plus any piggybacked remote operations; and
5. re-uploads newly synthesized local-win operations in the same cycle through a
   bounded reconciliation loop.

An incompatible operation, failed apply, or cancelled full-state decision leaves
its operation and suffix uncommitted, so a later cycle downloads them again. The
executable orchestration lives in
[`operation-log-sync.service.ts`](../../src/app/op-log/sync/operation-log-sync.service.ts),
with upload routing in
[`operation-log-upload.service.ts`](../../src/app/op-log/sync/operation-log-upload.service.ts)
and ordered receiver processing in
[`remote-ops-processing.service.ts`](../../src/app/op-log/sync/remote-ops-processing.service.ts).

## C.3 Full-State Operations via Snapshot Endpoint

Operations that contain the full application state (`SYNC_IMPORT`,
`BACKUP_IMPORT`, `REPAIR`) use the dedicated `/api/sync/snapshot` route rather
than the regular operation-batch route. The route supports compressed large-body
transport, but the accepted request is still validated, quota-checked, and stored
as a full-state operation in the ordered log.

### Operation Routing

```
Upload Flow
    │
    ├──► Filter: Is opType in { SYNC_IMPORT, BACKUP_IMPORT, REPAIR }?
    │         │
    │         ├──► YES: Upload via /api/sync/snapshot
    │         │         • Uses uploadSnapshot() method
    │         │         • SYNC_IMPORT → initial; BACKUP_IMPORT/REPAIR → recovery
    │         │         • Supports E2E encryption
    │         │
    │         └──► NO: Upload via /api/sync/ops (normal batched upload)
```

Before upload, the client extracts and validates the wrapped full state, removes
device-local sync settings, optionally encrypts the state, and preserves the
original operation ID, vector clock, schema version, clean-slate/repair scope,
and import reason. Those fields are part of correctness and deduplication; do not
reconstruct the call from this prose. Follow
[`OperationLogUploadService`](../../src/app/op-log/sync/operation-log-upload.service.ts),
the public provider contract in
[`provider-types.ts`](../../packages/sync-providers/src/provider-types.ts), and
the server's
[`snapshot handler`](../../packages/super-sync-server/src/sync/sync.routes.snapshot-handler.ts).

### OpType to Reason Mapping

| OpType          | Snapshot Reason | Use Case                         |
| --------------- | --------------- | -------------------------------- |
| `SYNC_IMPORT`   | `initial`       | First sync or full state refresh |
| `BACKUP_IMPORT` | `recovery`      | Restoring from backup file       |
| `REPAIR`        | `recovery`      | Auto-repair with corrected state |

The accepted upload remains a causal full-state operation in the server log, so
clients can skip its covered prefix and apply the retained tail. For plaintext
payloads only, an optional compressed cache accelerates _server-side replay and
restore generation_; production clients do not download that cache. E2EE
payloads remain replayable as operations but cannot populate a plaintext server
cache.

## C.4 Conflict Detection

Client conflict classification compares each incoming entity operation with a
local entity frontier built from snapshot metadata, retained applied operations,
and pending operations. A concurrent pending local operation supplies the normal
two-sided conflict directly.

No pending row does not automatically mean “safe to apply.” For a concurrent op
on a live entity, the #9073 mitigation reconstructs every retained local op still
concurrent with the incoming clock. Supported overlapping, single-entity sides
become a synthetic conflict and go through the same deterministic LWW path.
Pairs that commute (identical content, disjoint real fields, noise-only changes,
or positive task-time deltas) intentionally apply without LWW.

Arrival-order behavior remains only where the client cannot construct a safe,
deterministic local side: for example, its evidence was compacted into the
snapshot frontier, an operation is multi-entity, or the retained side is a local
delete/archive that needs compensation machinery. Those fallback cases do not
create a conflict object or journal row. See
[Composition residual (pre-existing class)](./conflict-journal-and-review.md#composition-residual-pre-existing-class)
for the remaining composition and mixed-receiver limitations.

The executable owners are `RemoteOpsProcessingService` and
`ConflictResolutionService`; server upload conflict detection is a second gate,
not a replacement for the client arrival-order problem above.

## C.5 Conflict Resolution (LWW Auto-Resolution)

Conflicts first apply explicit semantic precedence and eligible disjoint-field merging, then
fall back to Last-Write-Wins (LWW) via
`ConflictResolutionService.autoResolveConflictsLWW()`. For the current high-level policy, see
the field guide's [causality section](./sync-architecture.html#causality); the focused
[conflict journal and review contract](./conflict-journal-and-review.md) owns the more volatile
merge and review details.

### LWW Resolution Strategy

1. **Compare timestamps**: Each side's maximum operation timestamp is compared
2. **Newer wins**: The side with the newer timestamp wins
3. **Tie-breaker**: When timestamps are equal, stable ordering of the client IDs attached to
   the maximum-timestamp operations chooses the winner, so either the local or remote side can
   win deterministically

Winner selection and disjoint-field merging remain active in production. Conflict journaling is
an observe-only capability and is not required for resolution: the production remote-processing
path currently sets `disableConflictJournal: true`, so it does not emit journal entries. The
journal store and review UI therefore remain dormant/incomplete rather than a complete record of
resolved conflicts. See the focused contract above for current status and lifecycle details.

### When Local Wins

When local state is newer, we can't just reject the remote ops - that would cause the local state to never sync to the server. Instead:

1. **Reject both** local AND remote ops (they're now obsolete)
2. **Create a new UPDATE operation** with:
   - Current entity state from NgRx store
   - Merged vector clock (local + remote) + increment
   - **Preserved maximum timestamp from local ops** (critical for correct LWW semantics - using `Date.now()` would give unfair advantage in future conflicts)
3. **This new op is re-uploaded** by the current sync cycle's bounded
   reconciliation loop. It remains pending for a later cycle only when that loop
   is interrupted, blocked, or reaches its retry cap.

A warning-level log is emitted: `OpLog.warn('LWW local wins - creating update op for ${entityType}:${entityId}')`

### Rejected Operations

When operations are rejected (either local or remote):

- Rejected ops remain in the log for history/debugging
- `getUnsynced()` excludes rejected ops (won't re-upload)
- Compaction may eventually delete old rejected ops

### Archive-Wins Rule

When a `moveToArchive` operation conflicts with a field-level update (e.g., rename, time tracking changes), the archive operation **always wins** regardless of timestamps. This bypasses the normal LWW timestamp comparison because archiving represents explicit user intent that should not be reversed by a concurrent field update.

**Rationale:** If Client A archives a task and Client B concurrently renames it, the archive must win — otherwise, the LWW update would "resurrect" the archived task back into the active store by replacing its state.

**Implementation:** `ConflictResolutionService` checks whether either the local or remote side contains a `TASK_SHARED_MOVE_TO_ARCHIVE` action. If so, the archive side wins automatically, and a new archive operation is created with a merged vector clock (via `_createArchiveWinOp()`).

This is the **first level** of archive resurrection prevention. The **second level** is the [bulk archive filter](../../src/app/op-log/apply/bulk-archive-filter.util.ts), which pre-scans operation batches for archive operations and skips any LWW Update operations targeting entities being archived in the same batch. This two-level defense handles the 3+ client scenario where LWW Updates can arrive before or after archive ops in the same batch.

**Key files:**

- `src/app/op-log/sync/conflict-resolution.service.ts` — Archive-wins check and `_createArchiveWinOp()`
- `src/app/op-log/apply/bulk-hydration.meta-reducer.ts` — Pre-scan archive filtering

### Superseded Operation Handling for moveToArchive

The `SupersededOperationResolverService` treats `moveToArchive` as a special case alongside DELETE operations. When a `moveToArchive` op is rejected by the server due to concurrent conflicts, it is **re-created with a merged vector clock** instead of being discarded.

This is necessary because `moveToArchive` removes entities from the NgRx store (via the archive reducer), so `getCurrentEntityState()` returns `undefined` for archived entities. Without this special handling, the superseded operation resolver would be unable to re-create the operation, and archived tasks would be lost.

**Implementation:** Before entity-by-entity processing, `SupersededOperationResolverService` identifies bulk semantic operations like `moveToArchive` and re-creates them with the original payload and a merged vector clock, preserving the full task data in `MultiEntityPayload` format.

**Key file:** `src/app/op-log/sync/superseded-operation-resolver.service.ts`

### Singleton Entity LWW Updates

The `lwwUpdateMetaReducer` handles LWW Update actions (created when the local side wins a conflict) differently depending on the entity's storage pattern:

| Storage Pattern | Entity Types                                          | LWW Update Behavior                                                             |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Adapter**     | TASK, PROJECT, TAG, NOTE, TASK_REPEAT_CFG, etc.       | Individual entity replacement via NgRx entity adapter (`updateOne` or `addOne`) |
| **Singleton**   | GLOBAL_CONFIG, TIME_TRACKING, MENU_TREE, WORK_CONTEXT | Entire feature state replaced with the winning data                             |
| **Unsupported** | Map, array, virtual patterns                          | Logged as warning; not supported for LWW                                        |

For **adapter entities**, the meta-reducer also syncs relationships (e.g., `project.taskIds` when `projectId` changes, `tag.taskIds` when `tagIds` changes, `TODAY_TAG.taskIds` when `dueDay` changes, `parent.subTaskIds` when `parentId` changes).

**Key file:** `src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts`

### User Notification

A non-blocking snack notification is shown after auto-resolution:

- "Sync conflicts auto-resolved: X local win(s), Y remote win(s)"

## C.6 Full-State Filtering

When a `SYNC_IMPORT` or `BACKUP_IMPORT` operation is received, it represents an explicit user action to restore **all clients** to a specific point in time. Operations created without knowledge of the import are filtered out.

The executable owner is
[`SyncImportFilterService`](../../src/app/op-log/sync/sync-import-filter.service.ts),
with causal classification shared through
[`classifyOpAgainstSyncImport`](../../packages/sync-core/src/sync-import-filter.ts).

### The Problem Without a Transport Fence

Consider this scenario:

1. Client A creates Op1, Op2 (offline)
2. Client B does a SYNC_IMPORT (restores from backup)
3. Client B uploads the SYNC_IMPORT to server
4. Client A comes online, uploads Op1, Op2, then downloads SYNC_IMPORT
5. **Problem**: Op1, Op2 reference entities that were WIPED by the import

### Explicit Import/Restore Semantics

`SYNC_IMPORT` and `BACKUP_IMPORT` establish a clean slate. An operation that is
causally greater than or equal to that boundary stays; an operation dominated by
it is already represented and is dropped. A genuinely concurrent operation is
also dropped because it was authored without knowledge of the reset.

Pruned/reset clocks can make a _post-import_ operation compare concurrent. The
classifier therefore keeps two provable cases: a higher counter from the import's
own client, or an operation carrying at least the import client's boundary
counter. These are causal proofs, not timestamp guesses. The latest boundary is
chosen by durable batch/store order, never UUID order.

### Automatic Repair Semantics

`REPAIR` is not an explicit clean slate. Causally older work is represented by
its full state, but concurrent work normally replays on top. For a repair in the
same downloaded batch, a concurrent prefix covered by its
`repairBaseServerSeq` is dropped as already represented; a legacy repair without
that proof moves the prefix immediately after the repair boundary. Concurrent
suffix work remains valid.

All of these decisions use vector clocks because the question is causal
knowledge of the full-state boundary, not wall-clock recency.

SuperSync also prevents the invalid suffix from entering the server log. An
incremental upload carrying `lastKnownServerSeq` is serialized with state
replacement uploads on the user's sequence row. If its cursor predates the
latest `SYNC_IMPORT` or `BACKUP_IMPORT`, the whole batch is rejected and the
replacement is piggybacked before the client retries. Client-side filtering
remains necessary for other providers, retained legacy data, and defense in
depth.

See the field guide's [causality and conflict policy](./sync-architecture.html#causality)
for the visual overview.

---

# Part D: Data Validation & Repair

Validation is layered, but not every checkpoint automatically mutates user data.
In particular, boot hydration prefers showing recoverable data over opening a
repair dialog or silently rewriting it.

## D.1 Validation Architecture

| Boundary           | What runs                                                                                           | Failure behavior                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local capture      | Structural operation-payload validation before append                                               | Do not persist the operation; mark live/durable divergence, surface reload, and fence compaction                                                 |
| Snapshot hydration | Structural/cache screening plus schema migration; matching-schema snapshots use the trust fast path | Migration failure falls back to retained-log replay without overwriting the intact cache; validation errors are logged rather than auto-repaired |
| Tail/full replay   | State validation after reducer replay                                                               | Continue with visible state but do not save an invalid replacement cache                                                                         |
| Remote apply       | Active-state validation, then full state including archives only if repair is needed                | Repair and revalidate; persist a `REPAIR` operation before replacing live state, or mark the sync session failed                                 |

## D.2 REPAIR Operation Type

Post-sync repair uses `dataRepair()` and revalidates the result. A successful
repair is represented by a causal full-state `REPAIR` operation containing the
repaired state, a repair summary, and—when available—the server sequence on
which the repair was based. The authoritative payload and summary types live in
[`operation.types.ts`](../../src/app/op-log/core/operation.types.ts).

### REPAIR Operation Behavior

- **During startup**: A terminal REPAIR can use the safe full-state direct-load shortcut when no row in the replay range has pending reducer work. Otherwise the range is migrated and replayed normally.
- **During sync**: REPAIR is narrower than an explicit import. Operations concurrent with it are replayed on top of the repaired snapshot (including a concurrent prefix that must move after the full-state boundary). On SuperSync, REPAIR never requests a clean slate; the server locks the user's sequence row and accepts the snapshot only when `repairBaseServerSeq` still equals the current server sequence. A stale repair is retired locally before the concurrent server suffix is downloaded.
- **Upload ordering**: If a full-state upload fails, later regular operations stay pending. Permanent snapshot failures are classified by the central rejection handler after any remote work has been applied. A rejected local explicit import/restore remains a durable upload barrier across later sync cycles; incremental operations resume only after a newer full-state snapshot succeeds. Rejected remote imports are conflict-resolution history, and stale automatic REPAIR is excluded so its concurrent suffix can download and trigger a fresh repair if still necessary.
- **User notification**: automatic/in-lock repair is non-blocking; explicitly
  interactive repair may use the acknowledgement dialog.
- **Retained evidence**: the repair row remains inspectable only while normal
  operation retention keeps it; it is not a permanent audit trail.

## D.3 Checkpoint A: Payload Validation

Before a local append,
[`validate-operation-payload.ts`](../../src/app/op-log/validation/validate-operation-payload.ts)
checks the envelope and operation-specific payload structure. This is
intentionally shallower than whole-state Typia and relationship validation.
Internally generated `REPAIR` operations follow their own construction path.

## D.4 Checkpoints B & C: Hydration Validation

The hydrator validates a snapshot synchronously when migration ran or its schema
stamp does not match. A matching-schema cache is trusted for startup speed; this
is why adding a required persisted field without a migration is dangerous. After
tail or from-zero replay, validation gates creation of a replacement cache.

Hydration validation does **not** call `dataRepair()`: a boot-time native confirm
can steal focus, and silently repairing the only visible copy is worse than
loading it and logging the failure. See
[`operation-log-hydrator.service.ts`](../../src/app/op-log/persistence/operation-log-hydrator.service.ts).

## D.5 Checkpoint D: Post-Sync Validation

After remote processing,
[`RemoteOpsProcessingService`](../../src/app/op-log/sync/remote-ops-processing.service.ts)
calls `ValidateStateService.validateAndRepairCurrentState()`. The valid fast path
checks the active snapshot without archive reads. If invalid, it loads the full
state including both archive partitions, repairs and revalidates it, writes the
`REPAIR` operation/cache under the existing operation-log lock, and only then
dispatches the repaired replacement with remote-effect suppression. Failure
sets the session-validation latch, so the sync wrapper cannot claim `IN_SYNC`.

## D.6 Executable Owners

| Responsibility                                             | Owner                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Typia plus cross-model validation and repair orchestration | [`validate-state.service.ts`](../../src/app/op-log/validation/validate-state.service.ts)           |
| Pure repair transforms and summary accounting              | [`data-repair.ts`](../../src/app/op-log/validation/data-repair.ts)                                 |
| Durable repair operation/cache creation and notification   | [`repair-operation.service.ts`](../../src/app/op-log/validation/repair-operation.service.ts)       |
| SuperSync repair base sequence                             | [`repair-sync-context.service.ts`](../../src/app/op-log/validation/repair-sync-context.service.ts) |

---

# Operational Boundaries

### IndexedDB Quota Exhaustion

Quota failure is not an optimistic rollback path. The reducer has already run,
so an unrecovered append leaves live state ahead of the log; the client marks
that divergence, fences compaction, and offers reload.

The specialized quota branch recognizes raw browser variants and contains a
one-retry circuit breaker plus a 24-hour emergency retention policy. Its current
reachability is deliberately narrow: the store wraps the standard Chromium
error into the generic persistence-failure path, while raw legacy variants reach
`emergencyCompact()`. Because that call is still inside the failing write's stack,
the pending-write guard currently makes the compaction attempt skip. This is why
the retry code must not be described as successful recovery today; a future
delete-only emergency compactor would change that boundary. See the load-bearing
comments in
[`operation-log.effects.ts`](../../src/app/op-log/capture/operation-log.effects.ts)
and
[`operation-log-compaction.service.ts`](../../src/app/op-log/persistence/operation-log-compaction.service.ts).

### Compaction Trigger Coordination

The 500-ops compaction trigger uses a persistent counter stored in `state_cache.compactionCounter`:

- Each atomic append increments the durable counter
- Counter persists across app restarts
- Counter is reset after successful compaction
- The in-memory mirror avoids an IndexedDB read on every threshold check

### Device Identity and Legacy Data

The sync `clientId` —
the device's stable sync identity — lives in the `SUP_OPS` `client_id` store
(key `current`). It used to live in the legacy `pf` database; storing it in
`SUP_OPS` lets destructive flows (clean-slate, backup-restore) rotate it
atomically inside `runDestructiveStateReplacement`'s transaction, instead of a
hand-rolled cross-database two-phase commit. `pf` remains a read-only, one-time
migration source: the first read on a not-yet-migrated device copies the id
forward (`ClientIdService`). The clientId is non-regenerable (it keys the vector
clock), so a transient IndexedDB read failure propagates rather than minting a
fresh id.

### Compaction During Active Sync

- Compaction and sync serialize on the operation-log lock
- Compaction aborts before snapshotting while any non-rejected `pending` remote row exists
- Deletion requires terminal status: synced applied/legacy-complete rows or old rejected rows
- `archive_pending` and `failed` quarantine rows survive regardless of age
- Emergency compaction returns `false` when it skips for pending reducer work or an empty/degraded
  live state; callers only treat an actually written snapshot/prune pass as success

---

# Part E: Smart Archive Handling

The application splits active NgRx state from two IndexedDB archive partitions.
`archiveYoung` receives newly archived tasks and non-today time tracking;
`archiveOld` holds tasks moved past the 21-day threshold and time tracking moved
during the periodic full young-to-old flush.

## E.1 The Problem with Syncing Archives

Archive partitions can contain tens of thousands of tasks and worklogs. Treating
them as an always-rewritten remote file makes a small archive transition pay for
the whole historical dataset. The cost depends on the transport: default v2
file sync still rewrites that full baseline, while SuperSync and the opt-in v3
file format can normally transfer the operation without rewriting a remote
archive snapshot.

## E.2 New Strategy: Deterministic Local Side Effects

Archive changes are replayable operations with deterministic, idempotent local
side effects. The receiver updates its own IndexedDB archive partitions rather
than installing a separately versioned archive database file. This does **not**
mean archive data never crosses the network: `moveToArchive` carries the full
task data needed by a receiver, and full file-sync baselines include both archive
partitions.

| Transport             | What crosses the network for archive changes                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **SuperSync**         | The archive operation payload; no separate archive-file upload.                                                |
| **File v2 (default)** | The operation buffer plus complete state, `archiveYoung`, and `archiveOld` in the rewritten monolith.          |
| **File v3 (opt-in)**  | Normally the operation in `sync-ops.json`; complete archive partitions when a snapshot is created or replaced. |

### E.3 Workflow: moveToArchive

When a user archives tasks:

1.  **Client A (Origin):**
    - Generates `moveToArchive` operation.
    - Writes the task family to `archiveYoung` and moves non-today local
      time-tracking data out of active state.
2.  **Sync:** The operation, including the required full task data,
    travels to Client B. File-v2 also rewrites its complete archive baseline.
3.  **Client B (Remote):**
    - Receives `moveToArchive` operation.
    - Executes the **exact same logic**:
      - Writes the tasks carried by the action to its own `ArchiveYoung`.
      - Removes them from Active Store.

**Result:** Both clients apply the same archive transition locally. SuperSync
does not transfer a separate archive file; file v3 normally avoids a full
archive snapshot rewrite between compactions; default file v2 does not.

### E.4 Workflow: Flushing (Young → Old)

The originating client moves eligible data, then emits `flushYoungToOld` with
the captured timestamp. Remote clients run the same threshold calculation under
the archive mutex and atomically commit the new young/old pair. Passing the
timestamp in the operation keeps replay independent of each receiver's wall
clock.

### E.5 Idempotency Requirements

All archive operations MUST be idempotent:

| Operation            | Guarantee                          |
| -------------------- | ---------------------------------- |
| `moveToArchive`      | Skip if task already in archive    |
| `flushYoungToOld`    | Move only items not already in Old |
| `restoreFromArchive` | Skip if task already in Active     |

The exact mutation and retry behavior belongs to
[`ArchiveOperationHandler`](../../src/app/op-log/apply/archive-operation-handler.service.ts)
and [`ArchiveService`](../../src/app/features/archive/archive.service.ts).

## E.6 Time Tracking Sync Semantics

Time tracking is a nested `project/tag → context ID → date → compact session`
map. Its archive boundary differs from the task age boundary:

```
Daily (finish work):
  all non-today active entries → archiveYoung

Every ~14 days (flush):
  all archiveYoung time tracking → archiveOld

Task archive flush in the same operation:
  only task families older than 21 days → archiveOld
```

Full-state assembly merges the three sources at field level with priority
`current > archiveYoung > archiveOld`. Incremental sync remains operation-based;
notably, concurrent positive task-time deltas commute and apply both instead of
being reduced to whole-entry LWW.

| Responsibility                  | Owner                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| State shape                     | [`time-tracking.model.ts`](../../src/app/features/time-tracking/time-tracking.model.ts)                   |
| Full-state three-source merge   | [`merge-time-tracking-states.ts`](../../src/app/features/time-tracking/merge-time-tracking-states.ts)     |
| Daily and periodic partitioning | [`sort-data-to-flush.ts`](../../src/app/features/archive/util/sort-data-to-flush.ts)                      |
| Remote archive application      | [`archive-operation-handler.service.ts`](../../src/app/op-log/apply/archive-operation-handler.service.ts) |

## E.7 Archive Payload Boundary

[`TaskService.moveToArchive()`](../../src/app/features/tasks/task.service.ts)
persists the selected parent-task batch, then dispatches one
`moveToArchive({ tasks })` action. Capture records that persistent action as one
operation carrying the selected batch's full task payload. The receiver needs
that data because archive storage is outside NgRx and the tasks may no longer
exist in its active state.

There is no archive-specific chunking. SuperSync's
[`DEFAULT_SYNC_CONFIG`](../../packages/super-sync-server/src/sync/sync.types.ts)
limits each operation payload to `20 * 1024 * 1024` bytes (20 MiB) by default.
A sufficiently large archive action can therefore exceed the per-operation
limit; even below it, one very large payload is a known scalability and failure
boundary. Current code neither splits nor compresses this action, and no
replacement design is specified here.

---

# Part F: Atomic State Consistency

This section documents the architectural principles ensuring that related model changes happen atomically, preventing state inconsistency during sync.

## F.1 The Problem: Effects Create Non-Atomic Changes

When a user deletes a tag, multiple entities must be updated:

- The tag is deleted
- Tasks referencing the tag have their `tagIds` updated
- TaskRepeatCfgs referencing the tag are updated or deleted
- TimeTracking data for the tag is cleaned up

If these changes happen in separate NgRx effects:

1. Each effect dispatches a separate action
2. Each action becomes a separate operation in the log
3. During sync, operations may arrive out of order or partially
4. **Result**: Temporary or permanent state inconsistency

## F.2 The Solution: Meta-Reducers for Atomic Changes

**Principle**: Related entity changes that must replay as one atomic transition
should happen in a single reducer pass.

Meta-reducers wrap the root reducer and can update every affected slice during
that one pass. For example,
[`tag-shared.reducer.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/tag-shared.reducer.ts)
owns tag deletion cleanup across tasks, repeat configurations, and time
tracking. Its tests are the executable contract; do not reproduce the reducer
shape from this guide.

### Meta-Reducers in Use

| Meta-Reducer                      | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `tagSharedMetaReducer`            | Tag deletion cleanup (tasks, repeat cfgs, time tracking) |
| `projectSharedMetaReducer`        | Project deletion cleanup                                 |
| `taskSharedCrudMetaReducer`       | Task CRUD with tag/project updates                       |
| `taskSharedLifecycleMetaReducer`  | Task lifecycle (archive, restore)                        |
| `taskSharedSchedulingMetaReducer` | Task scheduling with Today tag updates                   |
| `plannerSharedMetaReducer`        | Planner day management                                   |
| `taskRepeatCfgSharedMetaReducer`  | Repeat config deletion with task cleanup                 |
| `issueProviderSharedMetaReducer`  | Issue provider updates                                   |
| `operationCaptureMetaReducer`     | Marks the action as pending capture (increments counter) |

## F.3 Multi-Entity Operation Capture

The `OperationCaptureService` and `operation-capture.meta-reducer` work together using a **pending counter** to track captures (no positional queue — see the note below):

1. **After action**: Meta-reducer calls `OperationCaptureService.incrementPending()` with the action
2. **Effect processes**: Effect computes `entityChanges` via `OperationCaptureService.extractEntityChanges()`, writes the operation, then decrements the counter in a `finally`
3. **Result**: Single operation with action payload and optional `entityChanges[]` array

`flushPendingWrites()` polls `getPendingCount()` to know when every dispatched action has been written. NgRx reducers process actions sequentially and the effect uses `concatMap`, so writes stay ordered.

**Why a counter, not a positional FIFO queue (#8306 / #8318)**: the old design queued an `EntityChange[]` per action and correlated meta-reducer `push` with effect `shift` purely by position. If a write threw before its `dequeue` ran (e.g. a `LockAcquisitionTimeoutError`), the entry leaked and `flushPendingWrites()` could never reach 0 — every later sync then failed after its 30s timeout. A counter decremented in a `finally` cannot leak. `entityChanges` is now computed in the write path from the action (a pure function), so there is nothing to keep positionally aligned.

**Note**: Most actions return empty `entityChanges[]` - the action payload is sufficient for replay. Only TIME_TRACKING and TASK time sync actions have special handling to extract entity changes from the action payload. The field is still emitted (even as `[]`) because the Android background provider reads it and the `isMultiEntityPayload` guard requires it.

```
User Action (e.g., Delete Tag)
    │
    ▼
tagSharedMetaReducer (+ other meta-reducers)
    ├──► Atomically update all related entities
    │
    ▼
Feature Reducers
    │
    ▼
operation-capture.meta-reducer
    ├──► Call OperationCaptureService.incrementPending(action)
    │         └──► Increments the pending counter
    │
    ▼
OperationLogEffects (per-action wrapper: writeOperationFromEffect)
    ├──► Call OperationCaptureService.extractEntityChanges(action)
    ├──► Create + persist single Operation with action payload
    └──► finally: OperationCaptureService.decrementPending()
```

## F.4 When to Use Meta-Reducers vs Effects

| Scenario                                                | Pattern                                  |
| ------------------------------------------------------- | ---------------------------------------- |
| One replay-atomic transition across slices/entities     | Meta-reducer                             |
| Independent persistent workflow step                    | Ordinary reducer action                  |
| Entity deletion whose cleanup must replay with deletion | Meta-reducer                             |
| UI notifications (snackbar, sound)                      | Effect using `LOCAL_ACTIONS`             |
| External API calls                                      | Effect using `LOCAL_ACTIONS`             |
| Archive operations (async I/O)                          | Dedicated archive operation handler path |
| Navigation/routing                                      | Effect using `LOCAL_ACTIONS`             |

**Rule of thumb**: state changes that must replay atomically across slices or
entities use a meta-reducer. Independent workflow steps remain ordinary
persistent actions; effects own I/O and UI side effects and use `LOCAL_ACTIONS`.
The deliberate workflow exception and its costs are documented in the
[Contributor Sync Model](./contributor-sync-model.md#the-atomicity-rule--one-replay-atomic-transition-one-op)
and [ADR #5](../../ARCHITECTURE-DECISIONS.md#5-project-completion-decoupled-resolution-over-atomic-multi-entity-op).

## F.5 Board-Style Hybrid Pattern

For references between entities (e.g., `tag.taskIds`), we use a "board-style" pattern where:

- **Source of truth**: The child entity's reference (e.g., `task.tagIds`)
- **Derived list**: The parent entity's list (e.g., `tag.taskIds`) is for ordering only

Selectors recompute membership from the source of truth, filter stale ordering
IDs, preserve the stored order, and append missing members. The current handling
of nested tagged tasks is subtle; use
[`computeOrderedTaskIdsForTag`](../../src/app/features/tag/store/tag.reducer.ts)
instead of a copied implementation.

## F.6 Guidelines for New Features

When adding new entities or relationships:

1. **Identify related entities** that must change together
2. **Create or extend a meta-reducer** to handle atomic updates
3. **Declare correct persistent metadata** (`entityType`, entity IDs, `opType`)
   and cover capture/replay with the real action shape
4. **Use `LOCAL_ACTIONS`** in effects for side effects only
5. **Consider board-style pattern** for parent-child list references

---

# Source Map

Use the field guide's stable
[executable source map](./sync-architecture.html#sources) instead of maintaining
a copied file tree here. The main implementation boundaries are
[`src/app/op-log/`](../../src/app/op-log/),
[`packages/shared-schema/src/`](../../packages/shared-schema/src/),
[`packages/sync-core/src/`](../../packages/sync-core/src/),
[`packages/sync-providers/src/`](../../packages/sync-providers/src/), and
[`packages/super-sync-server/src/`](../../packages/super-sync-server/src/).

# References

- [Contributor Sync Model](./contributor-sync-model.md) - The single invariant for effects, reducers, selector guards, and bulk dispatch
- [SECTION Conflict Replay](./section-conflict-replay.md) - Narrow semantic-replay and released-client compatibility contract
- [SuperSync Encryption](./supersync-encryption-architecture.md) - End-to-end encryption implementation and integrity boundary
- [Vector Clocks](./vector-clocks.md) - Vector clock implementation details
