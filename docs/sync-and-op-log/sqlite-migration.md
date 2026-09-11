# Native SQLite Op-Log Migration

**Status (July 2026):** Foundation implemented and tested in CI; native rollout
not wired. IndexedDB remains the live op-log backend on every platform.

This document is the single status, rationale, and rollout contract for the
native SQLite work associated with #7892 and #7931.

## Goal and scope

On Capacitor Android, critical op-log state currently lives in WebView
IndexedDB (`SUP_OPS`), which can be lost if WebView storage is evicted. The goal
is to move that database to app-private SQLite on native iOS/Android while
preserving the operation log's atomicity and recovery behavior.

This is not a global storage rewrite:

- web/PWA remain on IndexedDB;
- Electron keeps its current persistence and rotated backups;
- theme, credential, OAuth, and other small IndexedDB databases are outside the
  #7892 critical-data scope; and
- no native backend may become the default until migration and rollback are
  proven on real devices.

The mobile local-backup safeguards from #7924/#7925 are already active. They
reduce the blast radius but do not replace durable app-private storage.

## Current implementation

### Landed, inactive foundation

- `OpLogDbAdapter` / `OpLogTx` define the backend-neutral persistence and
  transaction contract; `OP_LOG_DB_SCHEMA` describes the stores and indexes.
- `IndexedDbOpLogAdapter` is the production backend. Both
  `OperationLogStoreService` and `ArchiveStoreService` obtain adapters through
  `OP_LOG_DB_ADAPTER_FACTORY`.
- Store initialization supports both connection-adopting IndexedDB adapters and
  self-managing adapters: the latter call `adapter.init()` and do not open the
  WebView database.
- `SqliteOpLogAdapter` implements the port against a minimal `SqliteDb`
  interface. It is covered by the in-memory translation tests, a real `sql.js`
  contract pass, and a store-level integration pass.
- Separate adapters that share one physical `SqliteDb` also share a FIFO queue
  keyed by that connection, preventing overlapping `BEGIN` statements and
  statements leaking into another transaction (#8746). The store-level race —
  op-log appends against lock-free archive flushes over one connection — is
  covered on both backends by
  `src/app/op-log/testing/integration/sqlite-shared-connection.integration.spec.ts`.
- Index reads exclude rows whose index column is NULL (a local op in
  `bySyncedAt` / `bySourceAndStatus`), matching IndexedDB, which does not index
  a record lacking the keyPath value (#8312).
- Ranges are scalar-only; a compound index is queried by an exact key tuple
  (`DbIndexQuery`). A genuine compound range has no meaning both backends
  agree on, so the port cannot express one.
- `DbIterateOptions.limit` pushes "first / latest row" scans down to `LIMIT ?`
  so `getLastSeq()` never transfers the whole ops table (#8313).
- `migrateOpLogBackend()` copies all op-log stores into an empty destination
  transaction and verifies operation count, last sequence, and vector clock
  before commit. It is validated in CI for real IndexedDB to `sql.js`.
- `local-rules/no-adapter-in-tx` enforces the SQLite re-entrancy rule: code in a
  transaction callback must use its `tx` handle, not enqueue another adapter
  call behind its own transaction.

### Not wired

- The project does not include a native SQLite plugin or a native `SqliteDb`
  wrapper.
- `OP_LOG_DB_ADAPTER_FACTORY` still returns `IndexedDbOpLogAdapter` everywhere.
- `migrateOpLogBackend()` has no startup trigger or completion marker.
- No platform has a SQLite feature flag or fallback selection.
- `SqliteOpLogAdapter` still falls back to sequence `0` if `SqliteDb.run()`
  omits `lastId`; native rollout must replace that invalid fallback with a
  positive-integer assertion.
- The Capacitor bridge, native SQLite build, lifecycle behavior, and bulk-write
  performance have not been validated on a device.

Nothing in the landed SQLite foundation changes runtime storage behavior for
current users.

## Storage contract that must not change

The SQLite backend must preserve the same observable guarantees as IndexedDB:

1. `ops.seq` is a positive, monotonically allocated primary key and `op.id` is
   unique.
2. `appendWithVectorClockOverwrite()` writes the operation and vector clock
   atomically.
3. Destructive state replacement writes operations, state cache, vector clock,
   client ID, and archive state atomically.
4. A transaction commits only when its callback resolves and rolls back on any
   thrown/rejected operation.
5. Two adapter instances over the same physical SQLite connection serialize
   against one another.
6. A transaction callback uses only the supplied `OpLogTx`. Re-entering a
   public adapter method would wait behind the transaction's own queue slot.
7. SQLite errors retain the error semantics callers rely on, including
   duplicate-operation and quota failures.

The native wrapper must return the inserted row ID from the same write. An
absent, zero, non-integer, or separately queried ID must fail before it can
become an operation sequence.

## Migration safety contract

The first native rollout must treat backend migration as a high-risk state
replacement, not as a best-effort copy:

1. Gate the SQLite selection behind a native-only feature flag that defaults
   off.
2. Quiesce op capture and every writer that can mutate `SUP_OPS`.
3. Run only when the SQLite destination is empty and the legacy IndexedDB
   source exists.
4. Copy every store while preserving primary keys, including gaps in operation
   sequences.
5. Verify at least operation count, last sequence, and vector clock before the
   destination transaction commits. Any mismatch rolls back.
6. Write the completion marker only after the verified commit.
7. Keep the IndexedDB source untouched for at least one released version and
   provide an explicit fallback path.
8. Never merge two non-empty backends.

`migrateOpLogBackend()` implements the copy and verify-before-commit core.
Startup quiescence, detection, marker/fallback policy, and lifecycle handling
remain caller responsibilities.

## Remaining rollout gates

Complete these in order:

1. Add the native SQLite dependency and a thin `SqliteDb` wrapper over one
   app-private database connection.
2. Validate insert IDs, transaction/error mapping, app pause/resume, abrupt
   termination, and representative bulk writes on Android and iOS.
3. Provide the two persistence services separate adapters over the same
   physical connection, after dual-running the store-level integration specs
   that compose multi-store transactions (`race-conditions`,
   `clean-slate-interrupt`) against `SqliteOpLogAdapter`, as
   `remote-apply-store-port` and `sqlite-shared-connection` already do.
4. Add the native-only, default-off provider selection.
5. Wire startup detection, quiescence, `migrateOpLogBackend()`, the completion
   marker, retained-source fallback, and interrupted-migration recovery.
6. Dogfood with the flag, then use a staged native rollout. Remove the
   IndexedDB fallback and transitional `adoptConnection` bridge only after the
   retained-source window and rollback evidence are complete.

Do not expand the migration to non-critical IndexedDB databases as part of
these gates.

## Executable owners and verification

| Concern                                    | Owner                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| Persistence port and transaction rules     | `src/app/op-log/persistence/op-log-db-adapter.ts`         |
| Backend DI default                         | `src/app/op-log/persistence/op-log-db-adapter.token.ts`   |
| IndexedDB backend                          | `src/app/op-log/persistence/indexed-db-op-log-adapter.ts` |
| SQLite backend and shared-connection queue | `src/app/op-log/persistence/sqlite-op-log-adapter.ts`     |
| Backend migration core                     | `src/app/op-log/persistence/op-log-backend-migration.ts`  |
| Schema                                     | `src/app/op-log/persistence/op-log-db-schema.ts`          |

Focused CI checks:

```bash
npm run test:file src/app/op-log/persistence/sqlite-op-log-adapter.spec.ts
npm run test:file src/app/op-log/persistence/op-log-backend-migration.spec.ts
npm run test:file src/app/op-log/testing/integration/remote-apply-store-port.integration.spec.ts
npm run test:file src/app/op-log/testing/integration/sqlite-shared-connection.integration.spec.ts
```

CI proves adapter and SQLite-engine semantics, not the Capacitor bridge or
device lifecycle. The rollout remains blocked until the on-device gates above
are reproducible.
