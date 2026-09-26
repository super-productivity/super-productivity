# Native SQLite Op-Log Migration — Parked

**Status (2026-09-26): Parked by maintainer decision.** The inactive SQLite
adapter, backend-copy migration, SQLite-only tests, and `sql.js` test dependency
have been removed. IndexedDB remains the live op-log backend on every platform.
There is no active native SQLite rollout plan.

**Reopen only for a confirmed IndexedDB eviction loss not covered by native
backups.** The original motivation alone does not justify a replacement backend.

## Current storage behavior

`OP_LOG_DB_ADAPTER_FACTORY` unconditionally creates `IndexedDbOpLogAdapter`.
`OperationLogStoreService` and `ArchiveStoreService` retain the `OpLogDbAdapter`
port, transaction contract, and existing IndexedDB initialization and upgrades.

This removal does not migrate or delete user databases. The legacy pfapi/v16
migration into `SUP_OPS` and native backups remain unchanged. Android's native
backup store uses SQLite independently of the removed op-log adapter; it is not
part of this decision. See the [user-data reference](../wiki/3.06-User-Data.md)
for current backup and recovery behavior.

## Historical rationale and implementation

The proposal associated with #7892 and #7931 aimed to protect critical op-log
state from WebView IndexedDB eviction by moving native iOS/Android persistence
to app-private SQLite. It excluded web/PWA, Electron, and small databases such
as credentials and theme settings. Native backup safeguards from #7924/#7925
were already active.

The foundation implemented a SQLite adapter, a shared-connection FIFO queue,
and a backend-copy helper that verified operation count, last sequence, and
vector clock before committing. Tests exercised an in-memory fake and the
`sql.js` SQLite engine. The factory never selected SQLite in production;
there was no native plugin, native database wrapper, startup migration trigger,
completion marker, or platform feature flag. Device lifecycle and bridge
behavior had not been validated.

**Last commit containing the removed implementation:**
[`9177c3afed6429934632b23de936cda8c6603fde`](https://github.com/super-productivity/super-productivity/tree/9177c3afed6429934632b23de936cda8c6603fde).
The complete former plan and tests are preserved there. For example:

```bash
git show 9177c3afed6429934632b23de936cda8c6603fde:src/app/op-log/persistence/sqlite-op-log-adapter.ts
git show 9177c3afed6429934632b23de936cda8c6603fde:src/app/op-log/persistence/op-log-backend-migration.ts
git show 9177c3afed6429934632b23de936cda8c6603fde:docs/sync-and-op-log/sqlite-migration.md
```

## Historical constraints if the decision is reopened

These are review context, not approved implementation steps. Any future
proposal needs fresh evidence and review before restoring code or dependencies.

- Preserve positive, monotonic operation sequences, unique operation IDs,
  atomic operation/clock writes, and atomic state replacement across stores.
- Preserve transaction rollback and error semantics. Separate adapters sharing
  a native connection must not interleave transactions or re-enter their own
  transaction queue.
- Validate native insert IDs, bridge behavior, pause/resume, abrupt termination,
  and bulk-write performance on actual devices. The former `sql.js` tests did
  not establish those guarantees.
- Any storage migration would need quiesced writers, an empty destination,
  preserved keys, verification before commit, interrupted-migration recovery,
  and a retained source with an explicit fallback. Never merge non-empty
  backends. The removed copy helper alone did not provide startup coordination
  or rollback policy.

The retained IndexedDB adapter, store, archive, and remote-apply integration
tests continue to cover current persistence. The S3 consumer audit, validation
results, and local draft update for #7931 are recorded in
[the S3 result](../plans/2026-09-26-sync-S3-result.md).
