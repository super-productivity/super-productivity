# SuperSync Server

A custom, high-performance synchronization server for Super Productivity.

> **Note:** This server implements a custom operation-based synchronization protocol (Event Sourcing), **not** WebDAV. It is designed specifically for the Super Productivity client's efficient sync requirements.

> **Related Documentation:**
>
> - [Authentication Architecture](./docs/authentication.md) - Auth design decisions and security features
> - [Sync Architecture Field Guide](../../docs/sync-and-op-log/sync-architecture.html) - Whole-system maintainer overview
> - [Server Architecture](./docs/architecture.md) - Server-only contracts and trust boundaries
> - [Backup & Disaster Recovery](./docs/backup-and-recovery.md) - Backup setup and recovery procedures

## Architecture

The server uses an **append-on-write retained operation log** backed by **PostgreSQL** (via Prisma):

1.  **Operations**: Clients upload atomic operations (Create, Update, Delete, Move).
2.  **Sequence Numbers**: The server assigns a strictly increasing per-user `server_seq` within the current sync dataset.
3.  **Synchronization**: Clients request "all operations since sequence `X`".
4.  **Full-state boundaries**: Clients can fast-forward from causal full-state operations; an optional plaintext cache supports server-side replay and restore.

### Key Design Principles

| Principle                      | Description                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Scoped server authority**    | Server owns per-user order and accepted upload results, not app-state semantics                    |
| **Two-part conflict handling** | Server detects upload conflicts; clients resolve rejections and download-side concurrency          |
| **E2E encryption support**     | Optional payload encryption leaves routing and causal metadata plaintext                           |
| **Idempotent uploads**         | Durable operation-ID uniqueness is the backstop; request IDs add a five-minute process-local cache |

## Quick Start

### Docker (Recommended)

The easiest way to run the server is using the provided Docker Compose configuration.
Deploy hosts need Docker with the Compose plugin, `curl`, `git`, and `jq`.
The image revision check requires Docker Compose support for
`docker compose config --format json`.

```bash
# 1. Copy environment example
cp env.example .env

# 2. Configure .env (Set JWT_SECRET, DOMAIN, POSTGRES_PASSWORD)
nano .env

# 3. Deploy the stack and run database migrations
./scripts/deploy.sh
```

`docker compose up` is not a deployment substitute: container startup migrations
are disabled by default so app restarts cannot race the deploy migrator.
`./scripts/deploy.sh` runs `prisma migrate deploy` once before replacing the app
container, then brings the stack up and verifies the health endpoint.

Leave `DATABASE_URL` unset when using the bundled Postgres service. The default
connection uses `postgres:5432`; existing installs that already set
`DATABASE_URL` with `db:5432` keep working because the Compose service exposes
`db` as a network alias.

> **Upgrade note:** because `RUN_MIGRATIONS_ON_STARTUP` defaults to `false`,
> `docker compose pull && docker compose up -d` can leave the app running
> against unapplied migrations. Use `./scripts/deploy.sh` for production
> updates, or `./scripts/deploy.sh --build` for local image builds.

`deploy.sh` verifies that the pulled/built `supersync` image has an
`org.opencontainers.image.revision` label matching the latest commit that
affects the SuperSync image inputs. This prevents host deploy scripts from
running migrations against a stale image, without requiring a new image for
unrelated repo commits. If you publish custom images, pass the same source
revision as `VCS_REF` during the Docker build or set
`SUPERSYNC_SKIP_IMAGE_REVISION_CHECK=true` only for a deliberate manual
override.

Some migrations use `CREATE INDEX CONCURRENTLY`, which can block on long-running
transactions on a busy database. Run deploys off-hours when applying schema
changes, and raise `MIGRATION_TIMEOUT` (seconds, default `900`) if a large
table requires more time. Exit code `124` from `deploy.sh` means the migration
timed out — re-run after the blocking transaction clears. A lock-bounded
reloption migration (one that sets its own short `lock_timeout`, such as the
`operations_entity_ids_gin` one) instead fails fast rather than queueing
traffic, and is retried natively a bounded number of times. If every
attempt times out it is left rolled back — clear the blocking transaction and
re-run the deploy.

If a deploy was interrupted after Prisma recorded a migration as failed, later
deploys can stop with `P3009`. Prisma can also stop migrations with `P3018`
when they contain `CREATE/DROP INDEX CONCURRENTLY` statements, which cannot run
in one transaction block. `scripts/migrate-deploy.sh` handles the safe
drop-then-create concurrent-index case generically: it resolves the failed row
when needed, applies the migration SQL outside Prisma migrate, marks the
migration applied, and retries `migrate deploy`. It also retries any
lock-bounded reloption migration natively — recognized by its shape, never by
name; all other failed migration shapes stop for manual review.

An application rollback does not require changing this index setting. If
measured insert latency regresses after this rollout, restore PostgreSQL's
default in a separately approved database change:

```bash
printf '%s\n' \
  'BEGIN;' \
  "SET LOCAL lock_timeout = '1s';" \
  'ALTER INDEX "operations_entity_ids_gin" RESET (fastupdate);' \
  'COMMIT;' | npx prisma db execute --schema prisma/schema.prisma --stdin
```

> **Existing databases created before the `0_init` baseline:** the migration
> chain now begins with a `0_init` baseline that creates the base tables, so a
> brand-new database can be initialized from migrations alone. A database whose
> schema predates this baseline must tell Prisma which migrations its schema
> already reflects **before the next deploy**, or `migrate deploy` tries to
> recreate existing objects and fails (`relation "users" already exists`, or
> `P3005 The database schema is not empty`). This also applies to the unattended
> deploy paths (the Helm `migrate-db` initContainer and the Docker
> `RUN_MIGRATIONS_ON_STARTUP=true` startup), which fail loudly until baselined.
>
> - **Database with prior Prisma migration history** (the pre-`0_init`
>   migrations are recorded in `_prisma_migrations`): mark only the baseline as
>   applied.
>
>   ```bash
>   npx prisma migrate resolve --applied 0_init
>   ```
>
> - **Database created with `prisma db push`** (no migration history): its
>   logical schema already matches the latest `schema.prisma`, but `db push`
>   cannot represent the `operations_entity_ids_gin` storage reloption. Apply
>   that database-only state and drain the old pending list before baselining
>   the whole chain. The explicit transaction keeps `SET LOCAL` scoped to the
>   `ALTER`; if its lock timeout fires, retry this off-hours.
>
>   ```bash
>   (
>     set -e
>     printf '%s\n' \
>       'BEGIN;' \
>       "SET LOCAL lock_timeout = '1s';" \
>       'ALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);' \
>       'COMMIT;' | npx prisma db execute --schema prisma/schema.prisma --stdin
>     printf '%s\n' \
>       'BEGIN;' \
>       "SET LOCAL statement_timeout = '300s';" \
>       "SELECT gin_clean_pending_list('operations_entity_ids_gin');" \
>       'COMMIT;' | npx prisma db execute --schema prisma/schema.prisma --stdin
>     for m in prisma/migrations/*/; do
>       npx prisma migrate resolve --applied "$(basename "$m")"
>     done
>   )
>   ```
>
> Fresh databases need none of this — `migrate deploy` applies `0_init` and the
> rest of the chain automatically.

For local `prisma migrate dev` shadow databases, apply migrations containing
`CREATE INDEX CONCURRENTLY` through `prisma db execute` outside the transaction
and then mark the migration applied, mirroring the production deploy workaround.

If `DATABASE_URL` points to an external PostgreSQL server, set
`POSTGRES_SERVICE=` to the empty value. `deploy.sh` then starts only the
app/proxy services with compose dependencies disabled so the bundled Postgres
container is not required. Prisma migrations still run against the configured
`DATABASE_URL`.

### Payload byte backfill and batch uploads

The `payload_bytes` column must be fully backfilled before enabling batched
uploads in production. During a partial backfill, quota reconciles use a slower
fallback for old operation rows with `payload_bytes = 0`.

Run the backfill to completion:

```bash
npm run migrate-payload-bytes
```

In a source checkout before `npm run build`, use:

```bash
npm run migrate-payload-bytes:dev
```

Only then set both rollout flags:

```bash
SUPERSYNC_BATCH_UPLOAD=true
SUPERSYNC_PAYLOAD_BYTES_BACKFILL_COMPLETE=true
```

The server refuses to start with `SUPERSYNC_BATCH_UPLOAD=true` unless the
completion flag is also set.

### Manual Setup (Development)

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Set up .env
cp env.example .env
# Edit .env to point to your PostgreSQL instance (DATABASE_URL)

# Push schema to DB
npx prisma db push

# Start the server
npm run dev

# Or build and run
npm run build
npm start
```

## Configuration

All configuration is done via environment variables.

| Variable       | Default                              | Description                                                                     |
| :------------- | :----------------------------------- | :------------------------------------------------------------------------------ |
| `PORT`         | `1900`                               | Server port                                                                     |
| `HOST`         | `0.0.0.0`                            | Server bind address. Use `::` for IPv6-only deployments.                        |
| `DATABASE_URL` | -                                    | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/db`)  |
| `JWT_SECRET`   | -                                    | **Required.** Secret for signing JWTs (min 32 chars)                            |
| `PUBLIC_URL`   | -                                    | **Required.** Public URL used for email links (e.g. `https://sync.example.com`) |
| `CORS_ORIGINS` | `https://app.super-productivity.com` | Allowed CORS origins                                                            |
| `SMTP_HOST`    | -                                    | SMTP Server for emails                                                          |

## API Endpoints

### Authentication

Production account creation and login use passkeys or emailed magic links; there
is no production password-based `/api/register` or `/api/login` endpoint.

| Endpoint group             | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `/api/register/passkey/*`  | Start and verify passkey registration                             |
| `/api/register/magic-link` | Register an email-only account                                    |
| `/api/verify-email`        | Activate an account and, for passkey signup, its bound credential |
| `/api/login/passkey/*`     | Start and verify passkey authentication                           |
| `/api/login/magic-link*`   | Request and consume a one-time login link                         |
| `/api/recover/passkey*`    | Replace a passkey after email-token recovery                      |
| `/api/replace-token`       | Revoke all earlier JWTs and return a replacement                  |

See [Authentication Architecture](./docs/authentication.md) for lifecycle and
security boundaries. Executable routes and schemas live in
[`src/api.ts`](./src/api.ts), with token behavior in
[`src/auth.ts`](./src/auth.ts) and WebAuthn behavior in
[`src/passkey.ts`](./src/passkey.ts).

### Synchronization

All HTTP sync endpoints require bearer authentication:
`Authorization: Bearer <jwt-token>`. The WebSocket endpoint uses the same
full-access, 365-day JWT from the `token` query parameter; it is not a narrower
WebSocket-only credential.

#### 1. Upload Operations

Send new changes to the server.

```http
POST /api/sync/ops
```

#### 2. Download Operations

Get changes from other devices.

```http
GET /api/sync/ops?sinceSeq=123
```

#### 3. Sync Status (diagnostic)

Check sync status and storage info. Not used by the production client — intended for operator/debugging use.

```http
GET /api/sync/status
```

## Client Configuration

In Super Productivity, configure the Custom Sync provider with:

- **Base URL**: `https://sync.your-domain.com` (or your deployed URL)
- **Auth Token**: JWT token from login

## Maintenance

### Scripts

The server includes scripts for administrative tasks. These use the configured database.

```bash
# Delete a user account
npm run delete-user -- user@example.com

# Clear sync data (preserves account)
npm run clear-data -- user@example.com

# Clear ALL sync data (dangerous)
npm run clear-data -- --all
```

## API Details

The stable endpoint purposes and server invariants are documented in
[Server Architecture](./docs/architecture.md). Request and response shapes are
owned by the executable routes: sync wire shapes live in
[`packages/shared-schema/src/supersync-http-contract.ts`](../shared-schema/src/supersync-http-contract.ts),
while authentication schemas live beside the routes in
[`src/api.ts`](./src/api.ts).

## Security Features

| Feature                          | Implementation                                                 |
| -------------------------------- | -------------------------------------------------------------- |
| **Authentication**               | Passkey or magic-link login issuing JWT bearer tokens          |
| **Enumeration Resistance**       | Neutral email-flow responses and dummy passkey options         |
| **Input Validation**             | Operation ID, entity ID, schema version validated              |
| **Rate Limiting**                | Route-specific authentication and per-user sync limits         |
| **Vector Clock Sanitization**    | Shared-schema limits; prune only after conflict detection      |
| **Entity Type Allowlist**        | Prevents injection of invalid entity types                     |
| **Request Deduplication**        | Five-minute process cache plus durable operation-ID uniqueness |
| **Whole-Account JWT Revocation** | Token versioning with a 30-second process-local auth cache     |

## Multi-Instance Deployment Considerations

The bundled Helm chart deliberately caps SuperSync at one replica. A custom
multi-instance deployment must address the following process-local state before
it can provide the same guarantees.

### Authentication Cache and Revocation

**Issue**: Successful JWT verification caches the account's verification and
token-version state for 30 seconds in each process. A token-version write
invalidates only the process performing that write.

**Impact**: After token replacement, passkey recovery, or account deletion, a
different replica can accept a previously cached JWT for at most the remaining
cache TTL.

**Solution for multi-instance**: Use shared invalidation or centralized
verification. Consistent per-account routing can reduce exposure, but is not a
general replacement for shared invalidation.

### Passkey Challenge Storage

**Issue**: WebAuthn challenges are stored in an in-memory Map, which doesn't work across instances.

**Symptom**: Passkey registration/login fails if the challenge generation request hits instance A but verification hits instance B.

**Solution for multi-instance**:

- Implement shared challenge storage
- Or use sticky sessions for the complete WebAuthn ceremony

**Current status**: A warning is logged at startup in production if in-memory storage is used.

### Snapshot Generation Locks

**Issue**: Concurrent snapshot generation prevention uses an in-memory Map.

**Symptom**: Same user may trigger duplicate snapshot computations across different instances.

**Impact**: Performance only (no data corruption) - snapshots are deterministic.

**Solution for multi-instance**:

- Implement Redis distributed lock (optional, only for performance)

### Request and Quota Coordination

**Issue**: Request-result deduplication, in-flight storage reconciles, and forced
storage-reconcile markers are process-local.

**Impact**: A retry routed to another instance can be recomputed, although
durable operation-ID uniqueness still prevents the same operation from being
inserted twice. A forced storage-counter reconcile signal does not survive a
process restart or move to another instance, so later exact reconciliation must
self-heal any drift.

### Single-Instance Deployment

For single-instance deployments, the cross-instance portions of these
limitations do not apply. Process restarts still clear in-memory coordination.

## Security Notes

- **Set JWT_SECRET** to a secure random value in production (min 32 characters).
- **Treat email verification, login, and recovery links as credentials.** Their
  tokens are currently stored in plaintext. Expiry prevents use but is not a
  general automatic-deletion boundary: records are cleared when their flow
  consumes or explicitly rejects them, or when a later request overwrites them;
  an expired verification token can remain stored. See
  [Authentication Architecture](./docs/authentication.md#email-tokens-are-bearer-secrets).
- **Use HTTPS and WSS in production.** Every reverse-proxy logging setup must
  omit sensitive query values and token-bearing `Referer` headers from both
  access logs and request failure/error logs.
  Login and recovery pages must also emit `Referrer-Policy: no-referrer` so
  same-origin subrequests do not copy their credential-bearing URL. The
  [bundled Caddy configuration](./Caddyfile) replaces the complete logged query
  suffix, drops `Referer` from both Caddy log paths, and provides the response
  policy. The application error logger likewise replaces its complete query
  suffix. Custom setups must provide equivalent protection. See
  [Authentication Architecture](./docs/authentication.md) for why this is a
  full-access, 365-day credential.
- **Restrict CORS origins** in production.
- **Database backups** are recommended for production deployments.
