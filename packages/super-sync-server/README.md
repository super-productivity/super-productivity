# SuperSync Server

A custom, high-performance synchronization server for Super Productivity.

> **Note:** This server implements a custom operation-based synchronization protocol (Event Sourcing), **not** WebDAV. It is designed specifically for the Super Productivity client's efficient sync requirements.

> **Related Documentation:**
>
> - [Authentication Architecture](./docs/authentication.md) - Auth design decisions and security features
> - [Operation Log Architecture](/docs/sync-and-op-log/operation-log-architecture.md) - Client-side architecture
> - [Server Architecture Diagrams](./sync-server-architecture-diagrams.md) - Visual diagrams
> - [Backup & Disaster Recovery](./docs/backup-and-recovery.md) - Backup setup and recovery procedures

## Architecture

The server uses an **Append-Only Log** architecture backed by **PostgreSQL** (via Prisma):

1.  **Operations**: Clients upload atomic operations (Create, Update, Delete, Move).
2.  **Sequence Numbers**: The server assigns a strictly increasing `server_seq` to each operation.
3.  **Synchronization**: Clients request "all operations since sequence `X`".
4.  **Snapshots**: The server can regenerate the full state by replaying operations, optimizing initial syncs.

### Key Design Principles

| Principle                           | Description                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| **Server-Authoritative**            | Server assigns monotonic sequence numbers for total ordering              |
| **Client-Side Conflict Resolution** | Server stores operations as-is; clients detect and resolve conflicts      |
| **E2E Encryption Support**          | Payloads can be encrypted client-side; server treats them as opaque blobs |
| **Idempotent Uploads**              | Request ID deduplication prevents duplicate operations                    |

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
timed out — re-run after the blocking transaction clears.

If a deploy was interrupted after Prisma recorded a migration as failed, later
deploys can stop with `P3009`. Prisma can also stop migrations with `P3018`
when they contain `CREATE/DROP INDEX CONCURRENTLY` statements, which cannot run
in one transaction block. `scripts/migrate-deploy.sh` handles the safe
drop-then-create concurrent-index case generically: it resolves the failed row
when needed, applies the migration SQL outside Prisma migrate, marks the
migration applied, and retries `migrate deploy`.

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
| `DATABASE_URL` | -                                    | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/db`)  |
| `JWT_SECRET`   | -                                    | **Required.** Secret for signing JWTs (min 32 chars)                            |
| `PUBLIC_URL`   | -                                    | **Required.** Public URL used for email links (e.g. `https://sync.example.com`) |
| `CORS_ORIGINS` | `https://app.super-productivity.com` | Allowed CORS origins                                                            |
| `SMTP_HOST`    | -                                    | SMTP Server for emails                                                          |

## API Endpoints

### Authentication

#### Register a new user

```http
POST /api/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

Response:

```json
{
  "message": "User registered. Please verify your email.",
  "id": 1,
  "email": "user@example.com"
}
```

#### Login

```http
POST /api/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

Response:

```json
{
  "token": "jwt-token",
  "user": { "id": 1, "email": "user@example.com" }
}
```

### Synchronization

All sync endpoints require Bearer authentication: `Authorization: Bearer <jwt-token>`

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

#### 3. Get Snapshot

Get the full current state (optimized).

```http
GET /api/sync/snapshot
```

#### 4. Sync Status

Check pending operations and device status.

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

### Upload Operations (`POST /api/sync/ops`)

Request body:

```json
{
  "ops": [
    {
      "id": "uuid-v7",
      "opType": "UPD",
      "entityType": "TASK",
      "entityId": "task-123",
      "payload": { "changes": { "title": "New title" } },
      "vectorClock": { "clientA": 5 },
      "timestamp": 1701234567890,
      "schemaVersion": 1
    }
  ],
  "clientId": "clientA",
  "lastKnownSeq": 100
}
```

Response:

```json
{
  "results": [{ "opId": "uuid-v7", "accepted": true, "serverSeq": 101 }],
  "newOps": [],
  "latestSeq": 101
}
```

### Download Operations (`GET /api/sync/ops`)

Query parameters:

- `sinceSeq` (required): Server sequence number to start from
- `limit` (optional): Max operations to return (default: 500)

### Upload Snapshot (`POST /api/sync/snapshot`)

Used for full-state operations (BackupImport, SyncImport, Repair):

```json
{
  "state": {
    /* Full AppDataComplete */
  },
  "clientId": "clientA",
  "reason": "initial",
  "vectorClock": { "clientA": 10 },
  "schemaVersion": 1
}
```

## Security Features

| Feature                       | Implementation                                    |
| ----------------------------- | ------------------------------------------------- |
| **Authentication**            | JWT Bearer tokens in Authorization header         |
| **Timing Attack Mitigation**  | Dummy hash comparison on invalid users            |
| **Input Validation**          | Operation ID, entity ID, schema version validated |
| **Rate Limiting**             | Configurable per-user limits                      |
| **Vector Clock Sanitization** | Limited to 50 entries, 255 char keys              |
| **Entity Type Allowlist**     | Prevents injection of invalid entity types        |
| **Request Deduplication**     | Prevents duplicate operations on retry            |

## Multi-Instance Deployment Considerations

When deploying multiple server instances behind a load balancer, be aware of these limitations:

### Passkey Challenge Storage

**Issue**: WebAuthn challenges are stored in an in-memory Map, which doesn't work across instances.

**Symptom**: Passkey registration/login fails if the challenge generation request hits instance A but verification hits instance B.

**Solution for multi-instance**:

- Implement Redis-backed challenge storage
- Or use sticky sessions (less ideal)

**Current status**: A warning is logged at startup in production if in-memory storage is used.

### Snapshot Generation Locks

**Issue**: Concurrent snapshot generation prevention uses an in-memory Map.

**Symptom**: Same user may trigger duplicate snapshot computations across different instances.

**Impact**: Performance only (no data corruption) - snapshots are deterministic.

**Solution for multi-instance**:

- Implement Redis distributed lock (optional, only for performance)

### Single-Instance Deployment

For single-instance deployments, these limitations do not apply. The current implementation is fully functional and well-tested for single-instance use.

## Security Notes

- **Set JWT_SECRET** to a secure random value in production (min 32 characters).
- **Use HTTPS in production**. The Docker setup includes Caddy to handle this automatically.
- **Restrict CORS origins** in production.
- **Database backups** are recommended for production deployments.
