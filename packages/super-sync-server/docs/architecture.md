# SuperSync Server Architecture

SuperSync is an authenticated PostgreSQL-backed relay, ordering service, and
upload-conflict gate for the operation-log protocol. It validates operation
metadata, detects vector-clock conflicts, assigns a per-user server sequence,
persists accepted operations, and notifies peer clients. Clients own
application-state semantics, encryption keys and decryption, and resolution of
rejected conflicts.

For the client and whole-system context, start with the
[Sync Architecture Field Guide](../../../docs/sync-and-op-log/sync-architecture.html).

## Ownership and Trust Boundary

- The server is authoritative for each user's retained operation order and
  accepted upload result, not for the semantic meaning of application state.
- [`@sp/shared-schema`](../../shared-schema/src/supersync-http-contract.ts) owns
  the HTTP wire contracts. [`@sp/sync-core`](../../sync-core/src/) owns the
  vector-clock algorithms shared by client and server.
- The server validates identifiers, operation types, sizes, timestamps, clocks,
  schema versions, quotas, and conflict metadata before persistence.
- Upload conflicts are detected server-side and returned as rejections. The
  client resolves them by producing or applying subsequent operations.
- All HTTP sync routes require bearer authentication. The WebSocket endpoint
  verifies the same full-access, 365-day JWT from the `token` query parameter;
  it sends only lightweight “new operations available” notifications, while
  payloads still move over HTTP.

Production deployments must expose HTTP and WebSocket traffic only over HTTPS
and WSS. Every reverse-proxy logging setup must omit sensitive query values and
token-bearing `Referer` headers from access logs and request failure/error logs,
and token-bearing login/recovery pages must emit
`Referrer-Policy: no-referrer`. The
[bundled Caddy configuration](../Caddyfile) replaces the complete logged query
suffix, drops `Referer` from both Caddy log paths, and sets that response policy;
the application error logger also replaces its complete query suffix. See the
[authentication architecture](./authentication.md) for the token lifecycle and
risk.

JWT verification consults a bounded, 30-second process-local cache of account
verification and token-version state. Auth mutations invalidate the cache in
the process performing the write, but independent replicas receive no
invalidation signal. A multi-instance deployment therefore needs shared auth
invalidation (or must explicitly accept the bounded revocation lag); WebAuthn
ceremonies additionally need shared challenge storage or sticky routing. The
bundled Helm chart remains single-replica.

## Stable API Surface

Request and response fields belong to the
[shared wire contract](../../shared-schema/src/supersync-http-contract.ts); do
not duplicate them here.

| Method and path                    | Stable purpose                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/sync/ops`               | Validate and upload regular operations; the response may piggyback newer remote operations                 |
| `GET /api/sync/ops`                | Download retained operations in per-user sequence order with pagination, gap, and full-state metadata      |
| `POST /api/sync/snapshot`          | Upload a full-state `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR` operation                                  |
| `GET /api/sync/status`             | Return diagnostic sequence, device, snapshot-age, and quota information; not used by the production client |
| `DELETE /api/sync/data`            | Erase the user's sync dataset and reset its sequence state                                                 |
| `GET /api/sync/restore-points`     | List causal full-state replay boundaries                                                                   |
| `GET /api/sync/restore/:serverSeq` | Reconstruct plaintext state at a retained sequence                                                         |
| `GET /api/sync/ws`                 | Notify other clients that operations are available; never stream operation payloads                        |

There is no `GET /api/sync/snapshot` endpoint. The executable route authority
is [`sync.routes.ts`](../src/sync/sync.routes.ts) and
[`websocket.routes.ts`](../src/sync/websocket.routes.ts).

## Per-User Ordering and Transaction Invariant

`serverSeq` is a total order within one user's current sync dataset. Accepted
uploads commit inside a PostgreSQL `RepeatableRead` transaction. One atomic
update of `user_sync_state.lastSeq` per accepted operation reserves its
sequence number and serializes accepted writers for that user. A concurrent
transaction that read the same earlier snapshot must fail and retry rather than
commit conflicting operations. A causal `REPAIR` additionally locks that row
and must prove `repairBaseServerSeq === lastSeq`. Incoming vector clocks are
compared before being pruned for storage.

A regular upload carrying `lastKnownServerSeq` uses the same row lock to compare
its cursor with `user_sync_state.latestStateReplacementSeq`. A cursor behind
the latest `SYNC_IMPORT` or `BACKUP_IMPORT` is rejected before any operation is
inserted, and the replacement is piggybacked without excluding its author. The
nullable marker is reconciled lazily from retained operations after an upgrade;
zero records that the reconciliation found no replacement.

A clean-slate full-state upload deletes the prior dataset but preserves
`lastSeq`, preventing sequence reuse visible to existing clients. Only explicit
`DELETE /api/sync/data` erases the entire dataset and resets the sequence to
zero.

This serialization mechanism is a load-bearing decision; see
[ADR #4](../../../ARCHITECTURE-DECISIONS.md#4-upload-conflict-safety-via-the-lastseq-row-lock-under-repeatableread),
[`sync.service.ts`](../src/sync/sync.service.ts), and
[`operation-upload.service.ts`](../src/sync/services/operation-upload.service.ts).

## Storage, Retention, Snapshots, and Restore Points

- `operations` is append-on-write, not retained forever. Rows are immutable
  while retained; cleanup, quota recovery, clean-slate replacement, and explicit
  data deletion can remove them.
- `user_sync_state` owns `lastSeq`, the optional compressed snapshot cache, the
  latest causal full-state marker, and the latest explicit state-replacement
  boundary. `sync_devices` is used only for per-device identity/metadata and
  last-seen tracking. Its `lastAckedSeq` field is dormant legacy schema state:
  current sync and retention code neither advances nor reads it.
- Normal sync bootstraps from operation rows. `GET /ops` can fast-forward to the
  latest causal full-state operation; clients do not download the server's
  cached snapshot blob.
- The snapshot cache is an optional server-replay optimization for plaintext
  data. Encrypted full-state uploads remain operations but cannot become a
  server-readable state cache.
- Restore points are `SYNC_IMPORT`, `BACKUP_IMPORT`, and causal `REPAIR`
  operations. Markerless legacy repairs cannot authorize fast-forward, restore,
  or history pruning.
- Default retention is 45 days. Cleanup removes stale devices and may remove
  only the old operation prefix before a proven causal full-state boundary,
  while preserving that boundary and its replay tail. The boundary comes from
  the operation stream itself — no snapshot cursor is required (#9688), so
  encrypted-only and snapshotless histories are pruned too. While a cached
  snapshot BLOB exists, the boundary additionally never passes that row's
  cursor (protects the cached base's replay tail for restore); a cursor left
  behind without its blob does not cap. A user's aged prefix is pruned whole
  or not at all, so the lowest surviving op stays a full-state op. When recent
  operations block the newest boundary, cleanup falls back to the newest causal
  boundary at or before the lowest recent sequence (#9962). This preserves every
  operation inside retention without letting frequent checkpoints block an older
  complete prefix. Quota
  recovery uses a
  separate bounded cleanup policy.
- Routine incremental sync does not create periodic full-state boundaries.
  Adding a client cadence requires a compatibility design (#9962): released
  v18.14.0 clients accept schema-4 operations but treat `REPAIR` as a reset and
  discard concurrent edits. Reusing current repair semantics alone cannot safely
  enable automatic checkpoints for accounts with those clients.
- Server-generated restore is unavailable when the required replay range
  contains encrypted operations.

The persistence authority is
[`schema.prisma`](../prisma/schema.prisma). Retention and replay live in
[`cleanup.ts`](../src/sync/cleanup.ts),
[`storage-quota.service.ts`](../src/sync/services/storage-quota.service.ts),
[`snapshot.service.ts`](../src/sync/services/snapshot.service.ts), and
[`op-replay.ts`](../src/sync/op-replay.ts).

## E2EE Boundary

When SuperSync E2EE is enabled, only `operation.payload` is encrypted
client-side. The server has no key and stores that payload as an opaque value.
Routing and causality metadata—including operation and client IDs, action and
operation types, entity IDs, vector clock, timestamps, schema version, import
reason, and the encryption flag—remains plaintext and is used by validation,
ordering, and conflict detection.

The payload's AES-GCM tag does not authenticate the plaintext metadata. E2EE
therefore provides payload confidentiality and integrity, not metadata
confidentiality or end-to-end authenticity of the complete operation. See the
[encryption architecture](../../../docs/sync-and-op-log/supersync-encryption-architecture.md).

## Executable Owners and Tests

| Concern                      | Owner                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authentication               | [`api.ts`](../src/api.ts), [`auth.ts`](../src/auth.ts), [`passkey.ts`](../src/passkey.ts), [`auth-cache.ts`](../src/auth-cache.ts)  |
| Wire protocol                | [`supersync-http-contract.ts`](../../shared-schema/src/supersync-http-contract.ts)                                                  |
| HTTP and WebSocket routes    | [`sync.routes.ts`](../src/sync/sync.routes.ts), [`websocket.routes.ts`](../src/sync/websocket.routes.ts)                            |
| Upload transaction and order | [`sync.service.ts`](../src/sync/sync.service.ts), [`operation-upload.service.ts`](../src/sync/services/operation-upload.service.ts) |
| Conflict lookup              | [`conflict.ts`](../src/sync/conflict.ts)                                                                                            |
| Download, gap, fast-forward  | [`operation-download.service.ts`](../src/sync/services/operation-download.service.ts)                                               |
| Snapshot and restore         | [`snapshot.service.ts`](../src/sync/services/snapshot.service.ts), [`op-replay.ts`](../src/sync/op-replay.ts)                       |
| Retention and quota          | [`cleanup.ts`](../src/sync/cleanup.ts), [`storage-quota.service.ts`](../src/sync/services/storage-quota.service.ts)                 |
| Persistence                  | [`schema.prisma`](../prisma/schema.prisma)                                                                                          |

The load-bearing PostgreSQL race coverage is in
[`tests/integration/`](../tests/integration/), especially the repair-causality,
clean-slate atomicity, conflict-detection, and snapshot-vector-clock suites.
