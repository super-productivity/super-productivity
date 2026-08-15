import { Prisma } from '@prisma/client';
import { prisma, disconnectDb, reportMonitoringError } from './monitoring-db';
import { newestOpsPerUser, resolveOperationScope } from './monitoring-scope';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync, execFileSync } from 'child_process';

const LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'app.log');
const USAGE_HISTORY_PATH = path.join(process.cwd(), 'logs', 'usage-history.jsonl');
const USAGE_METRIC_VERSION = 2;
const RECENT_OPS_PER_USER = 5;
const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * Widest window an operations-derived count can honestly claim.
 *
 * Cleanup deletes `sync_devices` rows unseen this long outright
 * (`deleteStaleDevices`), while the old-ops sweep SKIPS any user whose snapshot
 * predates the same cutoff (`deleteOldSyncedOpsForAllUsers`). The two are not
 * merely asymmetric, they are inverted: the lapsed cohort keeps its operations
 * and loses its heartbeat. So a window wider than this counts users the
 * device-scoped driver cannot see, and would silently under-report.
 *
 * Mirrors `RETENTION_DAYS` in `src/sync/sync.types.ts`, deliberately not
 * imported — these scripts stay independent of the server modules.
 * monitoring-scripts.spec.ts pins the two together, so changing retention fails
 * a test instead of quietly making a window lie.
 */
const RETENTION_WINDOW_DAYS = 45;

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const maskedLocal =
    local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
};

const parseIntArg = (args: string[], flag: string, defaultVal: number): number => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const val = parseInt(args[idx + 1], 10);
  if (isNaN(val) || val < 0) {
    console.error(
      `Invalid value for ${flag}: expected a non-negative integer, got "${args[idx + 1]}"`,
    );
    process.exit(1);
  }
  return val;
};

const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// --- Query result interfaces ---

interface DbSizeRow {
  size: string;
}

interface TableSizeRow {
  table: string;
  size: string;
}

interface ActivityWindowRow {
  bucket: bigint;
  device_count: bigint;
  ops_count: bigint;
}

interface CountRow {
  count: bigint;
}

interface UserStorageRow {
  id: number;
  email: string;
  ops_bytes: bigint;
  last_seq: number;
  snapshot_bytes: bigint;
  total_bytes: bigint;
}

interface OperationRow {
  id: string;
  user_id: number;
  action_type: string;
  op_type: string;
  entity_type: string;
  entity_id: string | null;
  payload_bytes: bigint;
  received_at: bigint;
}

interface EntityTypeSummary {
  count: number;
  totalBytes: number;
  maxBytes: number;
}

interface RecentUserRow {
  id: number;
  email: string;
  created_at: Date;
  last_active: bigint;
  device_count: bigint;
  ops_7d: bigint;
}

interface EngagedUserRow {
  id: number;
  email: string;
  active_days: bigint;
  ops_count: bigint;
  /** Matches before the page was cut; identical on every row. */
  total_engaged: bigint;
}

interface ActiveCountsRow {
  active_24h: bigint;
  active_7d: bigint;
  active_30d: bigint;
}

interface ActiveDeviceUserRow {
  id: number;
  email: string;
  devices: bigint;
  last_seen: bigint;
}

// --- Snapshot types for JSONL history ---

interface UsageSnapshotUser {
  id: number;
  email: string;
  bytes: number;
  opsBytes: number;
  lastSeq: number;
  snapshotBytes: number;
}

interface UsageSnapshot {
  metricVersion?: number;
  timestamp: string;
  totalBytes: number;
  userCount: number;
  users: UsageSnapshotUser[];
}

const showStats = async (): Promise<void> => {
  console.log('\n--- System Vitals ---');
  console.log(`Hostname: ${os.hostname()}`);
  console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`CPUs: ${os.cpus().length}`);

  const loadAvg = os.loadavg();
  console.log(
    `Load Avg: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}`,
  );

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  console.log(`Memory: ${formatBytes(usedMem)} used / ${formatBytes(totalMem)} total`);

  console.log('\n--- Database Connection ---');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Status: Connected ✅');

    // Get DB Size
    const dbSizeResult: DbSizeRow[] = await prisma.$queryRaw`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size;
    `;
    console.log(`DB Size: ${dbSizeResult[0]?.size}`);

    // Get table sizes
    const tableSizes: TableSizeRow[] = await prisma.$queryRaw`
      SELECT
        relname as table,
        pg_size_pretty(pg_total_relation_size(relid)) as size
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 5;
    `;
    if (tableSizes.length > 0) {
      console.log('\nTop tables by size:');
      tableSizes.forEach((t) => console.log(`  ${t.table}: ${t.size}`));
    }
  } catch (error) {
    reportMonitoringError('Error:', error);
    console.log('Status: Disconnected ❌');
    process.exitCode = 1;
  }

  // Disk space
  console.log('\n--- Disk Space ---');
  try {
    const dfOutput = execSync('df -h / 2>/dev/null || echo "N/A"', { encoding: 'utf-8' });
    const lines = dfOutput.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 5) {
        console.log(
          `Root filesystem: ${parts[2]} used / ${parts[1]} total (${parts[4]} used)`,
        );
      }
    }

    // Data directory size
    const dataDir = process.env.DATA_DIR || './data';
    if (fs.existsSync(dataDir)) {
      let duOutput: string;
      try {
        duOutput = execFileSync('du', ['-sh', dataDir], { encoding: 'utf-8' }).trim();
      } catch {
        duOutput = 'N/A';
      }
      const size = duOutput.split('\t')[0];
      console.log(`Data directory: ${size}`);
    }
  } catch {
    console.log('Could not determine disk space');
  }
};

const showUsage = async (saveHistory = true, showFullEmails = false): Promise<void> => {
  console.log('\n--- User Storage Usage (Top 20) ---');
  try {
    // Uploads and cleanup maintain storage_used_bytes incrementally. Reading that
    // counter avoids a full operations-table scan on every monitoring run.
    const users: UserStorageRow[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.email,
        GREATEST(
          u.storage_used_bytes - COALESCE(OCTET_LENGTH(s.snapshot_data), 0),
          0
        )::bigint AS ops_bytes,
        COALESCE(s.last_seq, 0) AS last_seq,
        COALESCE(OCTET_LENGTH(s.snapshot_data), 0)::bigint AS snapshot_bytes,
        u.storage_used_bytes AS total_bytes
      FROM users u
      LEFT JOIN user_sync_state s ON u.id = s.user_id
      ORDER BY u.storage_used_bytes DESC
      LIMIT 20;
    `;

    if (users.length === 0) {
      console.log('No users found.');
      return;
    }

    const displayEmail = (email: string): string =>
      showFullEmails ? email : maskEmail(email);

    const usersData = users.map((u) => ({
      id: u.id,
      email: u.email,
      bytes: Number(u.total_bytes),
      opsBytes: Number(u.ops_bytes),
      lastSeq: u.last_seq,
      snapshotBytes: Number(u.snapshot_bytes),
    }));

    console.table(
      usersData.map((u) => ({
        ID: u.id,
        Email: displayEmail(u.email),
        LastSeq: u.lastSeq,
        OpsSize: formatBytes(u.opsBytes),
        Snapshot: formatBytes(u.snapshotBytes),
        Total: formatBytes(u.bytes),
      })),
    );

    const totalBytes = usersData.reduce((sum: number, u) => sum + u.bytes, 0);
    console.log(`\nTotal: ${formatBytes(totalBytes)} across ${usersData.length} users`);

    // Save snapshot to history
    if (saveHistory) {
      const snapshotUsers = usersData.map((u) => ({
        ...u,
        email: displayEmail(u.email),
      }));
      const snapshot = {
        metricVersion: USAGE_METRIC_VERSION,
        timestamp: new Date().toISOString(),
        totalBytes,
        userCount: usersData.length,
        users: snapshotUsers,
      };

      const logsDir = path.dirname(USAGE_HISTORY_PATH);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      fs.appendFileSync(USAGE_HISTORY_PATH, JSON.stringify(snapshot) + '\n');
      console.log(`\nSnapshot saved to ${USAGE_HISTORY_PATH}`);
    }
  } catch (error) {
    reportMonitoringError('Error fetching usage data:', error);
    process.exitCode = 1;
  }
};

const showUsageHistory = async (args: string[]): Promise<void> => {
  console.log('\n--- Usage History ---');

  if (!fs.existsSync(USAGE_HISTORY_PATH)) {
    console.log('No history yet. Run "usage" command to start tracking.');
    return;
  }

  const showFullEmails = args.includes('--unmask');
  const tailCount = parseIntArg(args, '--tail', 10);

  const content = fs.readFileSync(USAGE_HISTORY_PATH, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const parsedSnapshots: UsageSnapshot[] = lines
    .slice(-tailCount)
    .map((line) => JSON.parse(line));

  if (parsedSnapshots.length === 0) {
    console.log('No snapshots found.');
    return;
  }

  const currentMetricVersion =
    parsedSnapshots[parsedSnapshots.length - 1].metricVersion ?? 1;
  const snapshots = parsedSnapshots.filter(
    (snapshot) => (snapshot.metricVersion ?? 1) === currentMetricVersion,
  );
  const ignoredSnapshotCount = parsedSnapshots.length - snapshots.length;
  if (ignoredSnapshotCount > 0) {
    console.log(
      `Ignoring ${ignoredSnapshotCount} older ${ignoredSnapshotCount === 1 ? 'snapshot' : 'snapshots'} because ${ignoredSnapshotCount === 1 ? 'its' : 'their'} storage metric is not comparable.`,
    );
  }

  console.table(
    snapshots.map((s) => ({
      Date: new Date(s.timestamp).toLocaleString(),
      Users: s.userCount,
      Total: formatBytes(s.totalBytes),
    })),
  );

  // Show growth if we have multiple snapshots
  if (snapshots.length >= 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const growth = last.totalBytes - first.totalBytes;
    const days =
      (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) /
      (1000 * 60 * 60 * 24);

    console.log(
      `\nGrowth over ${days.toFixed(1)} days: ${growth >= 0 ? '+' : ''}${formatBytes(growth)}`,
    );
    if (days > 0) {
      console.log(`Average: ${formatBytes(growth / days)}/day`);
    }

    // Per-user pivot table: rows = users, columns = snapshots
    const allUserIds = new Set<string>();
    const userEmails = new Map<string, string>();
    for (const snap of snapshots) {
      for (const u of snap.users) {
        allUserIds.add(String(u.id));
        userEmails.set(String(u.id), u.email);
      }
    }

    const displayEmail = (email: string): string =>
      showFullEmails ? email : maskEmail(email);

    // Build column headers (short date format)
    const colHeaders = snapshots.map((s) => {
      const d = new Date(s.timestamp);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });

    // Build rows with raw byte values for sorting
    const rows = Array.from(allUserIds).map((id) => {
      const row: Record<string, string> = {
        Email: displayEmail(userEmails.get(id) ?? id),
      };
      let latestBytes = 0;
      snapshots.forEach((snap, i: number) => {
        const user = snap.users.find((u) => String(u.id) === id);
        row[colHeaders[i]] = user ? formatBytes(user.bytes) : '-';
        if (i === snapshots.length - 1) {
          latestBytes = user ? user.bytes : 0;
        }
      });
      return { row, latestBytes };
    });

    // Sort by latest snapshot size (descending) using raw bytes
    rows.sort((a, b) => b.latestBytes - a.latestBytes);

    console.log('\n--- Per-User History ---');
    console.table(rows.map((r) => r.row));
  }
};

const showLogs = async (args: string[]): Promise<void> => {
  console.log('\n--- Server Logs ---');

  if (!fs.existsSync(LOG_FILE_PATH)) {
    console.error(`Log file not found at: ${LOG_FILE_PATH}`);
    console.error(
      'Ensure LOG_TO_FILE=true is set in .env and the server has written logs.',
    );
    return;
  }

  const searchIndex = args.indexOf('--search');
  const searchTerm = searchIndex !== -1 ? args[searchIndex + 1] : null;

  const tailCount = parseIntArg(args, '--tail', 100);

  const onlyErrors = args.includes('--error');

  const fileStream = fs.createReadStream(LOG_FILE_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const filteredLines: string[] = [];

  for await (const line of rl) {
    let include = true;

    if (onlyErrors && !line.includes('"level":"ERROR"') && !line.includes('[ERROR]')) {
      include = false;
    }

    if (searchTerm && !line.toLowerCase().includes(searchTerm.toLowerCase())) {
      include = false;
    }

    if (include) {
      filteredLines.push(line);
      if (filteredLines.length > tailCount) {
        filteredLines.shift(); // Keep only the last N lines
      }
    }
  }

  filteredLines.forEach((line) => console.log(line));
};

const showOps = async (args: string[]): Promise<void> => {
  console.log('\n--- Recent Operations Analysis ---');
  try {
    const tailCount = parseIntArg(args, '--tail', 50);
    const userId = parseIntArg(args, '--user', -1);
    const hasUserFilter = userId >= 0;
    const scope = hasUserFilter ? undefined : await resolveOperationScope();
    if (scope) {
      console.log(
        `Scope: up to ${RECENT_OPS_PER_USER} newest operations per user, then the newest ${tailCount} candidates overall.`,
      );
      console.log(scope.description);
    }

    // The global server sequence is per-user, so ORDER BY server_seq across the
    // entire table cannot use the (user_id, server_seq) index. Fetch a small tail
    // through that index for each user, then sort only those candidates.
    let ops: OperationRow[];
    if (hasUserFilter) {
      ops = await prisma.$queryRaw`
        SELECT
          o.id,
          o.user_id,
          o.action_type,
          o.op_type,
          o.entity_type,
          o.entity_id,
          o.payload_bytes,
          o.received_at
        FROM operations o
        WHERE o.user_id = ${userId}
        ORDER BY o.server_seq DESC
        LIMIT ${tailCount};
      `;
    } else {
      ops = await prisma.$queryRaw`
        WITH candidate_ops AS MATERIALIZED (
          ${newestOpsPerUser(
            scope?.userIds ?? [],
            Prisma.sql`
              id, user_id, action_type, op_type, entity_type, entity_id,
              payload_bytes, received_at
            `,
            RECENT_OPS_PER_USER,
          )}
        )
        SELECT
          id,
          user_id,
          action_type,
          op_type,
          entity_type,
          entity_id,
          payload_bytes,
          received_at
        FROM candidate_ops
        ORDER BY received_at DESC
        LIMIT ${tailCount};
      `;
    }

    if (ops.length === 0) {
      console.log('No operations found.');
      return;
    }

    console.table(
      ops.map((o) => ({
        User: o.user_id,
        Action: o.action_type.substring(0, 40),
        Entity: `${o.entity_type}:${(o.entity_id || '*').substring(0, 15)}`,
        PayloadSize: formatBytes(Number(o.payload_bytes)),
        Time: new Date(Number(o.received_at)).toLocaleTimeString(),
      })),
    );

    const byType = new Map<string, EntityTypeSummary>();
    for (const op of ops) {
      const bytes = Number(op.payload_bytes);
      const current = byType.get(op.entity_type) ?? {
        count: 0,
        totalBytes: 0,
        maxBytes: 0,
      };
      current.count += 1;
      current.totalBytes += bytes;
      current.maxBytes = Math.max(current.maxBytes, bytes);
      byType.set(op.entity_type, current);
    }

    console.log('\n--- Breakdown of Shown Operations by Entity Type ---');
    console.table(
      Array.from(byType.entries())
        .sort((a, b) => b[1].totalBytes - a[1].totalBytes)
        .map(([type, summary]) => ({
          Type: type,
          Count: summary.count,
          Total: formatBytes(summary.totalBytes),
          Avg: formatBytes(summary.totalBytes / summary.count),
          Max: formatBytes(summary.maxBytes),
        })),
    );

    const largest = ops.reduce((current, op) =>
      Number(op.payload_bytes) > Number(current.payload_bytes) ? op : current,
    );
    if (largest) {
      const op = largest;
      console.log('\n--- Largest Shown Operation ---');
      console.log(`ID: ${op.id}`);
      console.log(`Action: ${op.action_type}`);
      console.log(`Entity: ${op.entity_type}:${op.entity_id || '*'}`);
      console.log(`Size: ${formatBytes(Number(op.payload_bytes))}`);
    }
  } catch (error) {
    reportMonitoringError('Error fetching operations:', error);
    process.exitCode = 1;
  }
};

interface EngagedUsersOptions {
  readonly now: number;
  /** Distinct active days in the window a user needs to qualify. */
  readonly threshold: number;
  readonly limit: number;
  readonly displayEmail: (email: string) => string;
}

/**
 * Users active on `threshold`+ distinct UTC days in the last two weeks.
 *
 * Split out of `showActiveUsers` because it is opt-in: see the call site for why
 * it cannot sit in the default path until `operations` carries an index with
 * `received_at` leading.
 */
const showEngagedUsers = async (options: EngagedUsersOptions): Promise<void> => {
  const { now, threshold, limit, displayEmail } = options;
  const twoWeeksAgo = BigInt(now - 14 * ONE_DAY);

  // Paged like every other table in this report. Unpaged, this printed a row per
  // matching account: 2,499 of them on the 3M-operation fixture, growing with
  // the active fleet, which buries the number the section exists to show.
  // `COUNT(*) OVER ()` is evaluated before LIMIT, so the headline count stays
  // exact while only `limit` rows are carried back and rendered.
  //
  // The count rides on the rows, so at least one has to come back to carry it:
  // `--limit 0` is a legal way to ask for counts without a table, and fetching
  // literally zero rows would report "Count: 0" for a fleet of thousands. A
  // wrong number is worse than no number. Fetch one, display none.
  const pageSize = Math.max(1, limit);
  const engagedUsers: EngagedUserRow[] = await prisma.$queryRaw`
    WITH engaged AS (
      SELECT
        u.id,
        u.email,
        COUNT(DISTINCT (TO_TIMESTAMP(o.received_at::double precision / 1000) AT TIME ZONE 'UTC')::date) as active_days,
        COUNT(*) as ops_count
      FROM users u
      INNER JOIN operations o ON u.id = o.user_id
      WHERE o.received_at > ${twoWeeksAgo}
      GROUP BY u.id, u.email
      HAVING COUNT(DISTINCT (TO_TIMESTAMP(o.received_at::double precision / 1000) AT TIME ZONE 'UTC')::date) >= ${threshold}
    )
    SELECT
      id,
      email,
      active_days,
      ops_count,
      COUNT(*) OVER () as total_engaged
    FROM engaged
    ORDER BY active_days DESC, ops_count DESC
    LIMIT ${pageSize};
  `;

  const totalEngaged = Number(engagedUsers[0]?.total_engaged ?? 0);
  const shown = engagedUsers.slice(0, limit);
  console.log(`\n--- Engaged Users (${threshold}+ active days in last 2 weeks, UTC) ---`);
  console.log(`Count: ${totalEngaged}`);
  if (shown.length > 0) {
    if (totalEngaged > shown.length) {
      console.log(`(showing the top ${shown.length} of ${totalEngaged})`);
    }
    console.table(
      shown.map((u) => ({
        ID: u.id,
        Email: displayEmail(u.email),
        'Active Days': Number(u.active_days),
        'Ops (2w)': Number(u.ops_count),
      })),
    );
  }
};

const showActiveUsers = async (args: string[]): Promise<void> => {
  console.log('\n--- Active Users Report ---');
  try {
    const showFullEmails = args.includes('--unmask');
    const now = Date.now();

    const engagedThreshold = parseIntArg(args, '--threshold', 3);
    const recentLimit = parseIntArg(args, '--limit', 30);

    const displayEmail = (email: string): string =>
      showFullEmails ? email : maskEmail(email);

    // Total registered users
    const totalUsers = await prisma.user.count();
    const verifiedUsers = await prisma.user.count({ where: { isVerified: 1 } });

    console.log(`\nTotal registered users: ${totalUsers}`);
    console.log(`Verified users: ${verifiedUsers}`);

    // Active users by time period
    // "Device activity" = device heartbeats (includes idle polling)
    // "Sync operations" = actual data changes pushed to server
    const periods = [
      { label: 'Last 24 hours', ms: ONE_DAY },
      { label: 'Last 7 days', ms: 7 * ONE_DAY },
      { label: 'Last 30 days', ms: 30 * ONE_DAY },
      // Retention, not 90 days: both tables are pruned at this bound, so a
      // wider window reports nothing a narrower one does not, and the operations
      // side of it cannot be answered exactly. See RETENTION_WINDOW_DAYS.
      {
        label: `Last ${RETENTION_WINDOW_DAYS} days`,
        ms: RETENTION_WINDOW_DAYS * ONE_DAY,
      },
    ].map((period) => ({ ...period, threshold: BigInt(now - period.ms) }));
    // The widest window bounds the driver, so every narrower one is answered
    // from the same pass.
    const widestThreshold = periods[periods.length - 1].threshold;

    console.log(
      `\n--- Active Users (by device heartbeat / by sync operations, ${RETENTION_WINDOW_DAYS}d retention) ---`,
    );
    // One statement for all four windows, driven from the users that hold a
    // device heartbeat inside the widest one.
    //
    // What this replaced ran `COUNT(DISTINCT user_id) FROM operations WHERE
    // received_at > $1` once per window. `received_at` is the NON-leading column
    // of the only index covering it, (user_id, received_at), so each of those
    // walks essentially the whole index: on a 3M-operation fixture even the 24h
    // window touched 20,034 buffers of a 36k-buffer index, and the four windows
    // together cost 110,047. That price is set by the size of `operations`, not
    // by the size of the answer, and it was paid four times per report.
    //
    // Scoping the probe to device-active users is what bounds it, and the bound
    // is exact FOR WINDOWS AT OR BELOW RETENTION_WINDOW_DAYS: sync.service.ts
    // upserts `sync_devices.last_seen_at` INSIDE the upload transaction, so a
    // user with an operation in such a window necessarily still has a heartbeat
    // in it. Above that bound the guarantee inverts and this would under-report,
    // which is why the widest window is retention -- see RETENTION_WINDOW_DAYS
    // for the retention asymmetry that causes it.
    //
    // Each user's MAX(received_at) is then one backwards descent of
    // (user_id, received_at). Same fixture: 11,165 buffers in a single round
    // trip, identical counts in every window, and flat as `operations` grows.
    //
    // A per-user probe was tried once before and reverted, driven from `users`
    // rather than from `sync_devices` -- that pays a descent for every registered
    // account, including every one that never synced at all (7,061 of the
    // fixture's 10,561). The driver is the whole point; do not widen it back to
    // `users`. monitoring-scripts.spec.ts asserts the driver table, because
    // widening it is a cost regression that produces identical output and so
    // cannot be caught by checking the numbers.
    const activity: ActivityWindowRow[] = await prisma.$queryRaw`
      WITH active_devices AS MATERIALIZED (
        SELECT user_id, MAX(last_seen_at) AS last_seen
        FROM sync_devices
        WHERE last_seen_at > ${widestThreshold}
        GROUP BY user_id
      ),
      activity AS MATERIALIZED (
        SELECT
          a.last_seen,
          (
            SELECT MAX(o.received_at)
            FROM operations o
            WHERE o.user_id = a.user_id
          ) AS last_op
        FROM active_devices a
      ),
      windows (bucket) AS (
        VALUES ${Prisma.join(
          periods.map((period) => Prisma.sql`(${period.threshold}::bigint)`),
        )}
      )
      SELECT
        w.bucket AS bucket,
        COUNT(*) FILTER (WHERE a.last_seen > w.bucket) AS device_count,
        COUNT(*) FILTER (WHERE a.last_op > w.bucket) AS ops_count
      FROM windows w
      CROSS JOIN activity a
      GROUP BY w.bucket
    `;

    const countsByBucket = new Map(
      activity.map((row) => [
        String(row.bucket),
        {
          devices: Number(row.device_count ?? 0),
          ops: Number(row.ops_count ?? 0),
        },
      ]),
    );
    for (const period of periods) {
      const counts = countsByBucket.get(String(period.threshold));
      console.log(
        `  ${period.label}: ${counts?.devices ?? 0} connected / ${counts?.ops ?? 0} syncing`,
      );
    }

    // New users by time period
    console.log('\n--- New Registrations ---');
    const regPeriods = [
      { label: 'Last 24 hours', ms: ONE_DAY },
      { label: 'Last 7 days', ms: 7 * ONE_DAY },
      { label: 'Last 30 days', ms: 30 * ONE_DAY },
    ];
    for (const period of regPeriods) {
      const since = new Date(now - period.ms);
      const count = await prisma.user.count({
        where: { createdAt: { gte: since } },
      });
      console.log(`  ${period.label}: ${count} new users`);
    }

    // Recently active users table (last 7 days)
    const sevenDaysAgo = BigInt(now - 7 * ONE_DAY);

    // Get total count first
    const totalActive: CountRow[] = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      INNER JOIN sync_devices d ON u.id = d.user_id
      WHERE d.last_seen_at > ${sevenDaysAgo};
    `;
    const totalActiveCount = Number(totalActive[0]?.count ?? 0);

    // Pick the page from sync_devices first, then count operations for those
    // rows only. Joining operations before the LIMIT aggregated every operation
    // of the last 7 days across every active user (~5k) to display 30 of them;
    // counting after it is `recentLimit` bounded range scans on
    // (user_id, received_at) instead. The DISTINCT that used to guard ops_7d is
    // gone with the fan-out that made it necessary -- no device join remains to
    // multiply the rows, so COUNT(*) is both correct and cheaper here.
    const recentUsers: RecentUserRow[] = await prisma.$queryRaw`
      WITH recent AS MATERIALIZED (
        SELECT
          u.id,
          u.email,
          u.created_at,
          MAX(d.last_seen_at) as last_active,
          COUNT(DISTINCT d.client_id) as device_count
        FROM users u
        INNER JOIN sync_devices d ON u.id = d.user_id
        WHERE d.last_seen_at > ${sevenDaysAgo}
        GROUP BY u.id, u.email, u.created_at
        ORDER BY last_active DESC
        LIMIT ${recentLimit}
      )
      SELECT
        r.id,
        r.email,
        r.created_at,
        r.last_active,
        r.device_count,
        (
          SELECT COUNT(*)
          FROM operations o
          WHERE o.user_id = r.id AND o.received_at > ${sevenDaysAgo}
        ) as ops_7d
      FROM recent r
      ORDER BY r.last_active DESC;
    `;

    if (recentUsers.length > 0) {
      const suffix =
        totalActiveCount > recentUsers.length
          ? ` (showing ${recentUsers.length} of ${totalActiveCount})`
          : '';
      console.log(`\n--- Recently Active Users (last 7 days)${suffix} ---`);
      console.table(
        recentUsers.map((u) => ({
          ID: u.id,
          Email: displayEmail(u.email),
          Devices: Number(u.device_count),
          'Ops (7d)': Number(u.ops_7d),
          'Last Active': new Date(Number(u.last_active)).toLocaleString(),
          Registered: new Date(u.created_at).toLocaleDateString(),
        })),
      );
    }

    // Engaged users: active on N+ distinct days (UTC) in the last 2 weeks.
    //
    // Opt-in, because it is the one section of this report whose cost is set by
    // the size of `operations` rather than by the number of active users, and no
    // rewrite removes that: counting DISTINCT active days has to visit every
    // operation in the window. On the 3M-operation fixture it cost 25,644
    // buffers -- 28% MORE than the 20,034-buffer window query that was hitting
    // statement_timeout on the hosted instance -- so leaving it in the default
    // path means the report still cannot finish, just one section later.
    //
    // Giving `operations` an index with `received_at` leading would fix it
    // properly (the same fixture: 20,034 -> 255 buffers for a windowed count).
    // Until that index exists, the default report stays answerable from the
    // active-user set alone and an operator asks for the expensive question.
    if (args.includes('--engaged')) {
      await showEngagedUsers({
        now,
        threshold: engagedThreshold,
        limit: recentLimit,
        displayEmail,
      });
    } else {
      console.log(
        '\n--- Engaged Users: skipped (pass --engaged; reads 2 weeks of operations) ---',
      );
      // `--threshold` tunes only this section. Silently ignoring it would let an
      // operator read the numbers above as filtered when they are not.
      if (args.includes('--threshold')) {
        console.log('  (--threshold applies only with --engaged; ignored)');
      }
    }

    // Users who never synced (no device ever registered)
    const neverSynced: CountRow[] = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM users u
      LEFT JOIN sync_devices d ON u.id = d.user_id
      WHERE d.user_id IS NULL;
    `;
    console.log(
      `\nUsers who never registered a device: ${Number(neverSynced[0]?.count ?? 0)}`,
    );
  } catch (error) {
    reportMonitoringError('Error fetching active users:', error);
    process.exitCode = 1;
  }
};

// Fast variant of active-users that touches only sync_devices + users.
// Avoids the operations table entirely so it stays fast on large DBs.
const showActiveUsersQuick = async (args: string[]): Promise<void> => {
  console.log('\n--- Active Users (quick: sync_devices only) ---');
  try {
    const showFullEmails = args.includes('--unmask');
    const limit = parseIntArg(args, '--limit', 50);
    const displayEmail = (email: string): string =>
      showFullEmails ? email : maskEmail(email);

    const now = Date.now();
    const since24h = BigInt(now - ONE_DAY);
    const since7d = BigInt(now - 7 * ONE_DAY);
    const since30d = BigInt(now - 30 * ONE_DAY);

    const counts: ActiveCountsRow[] = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE last_seen_at > ${since24h}) AS active_24h,
        COUNT(DISTINCT user_id) FILTER (WHERE last_seen_at > ${since7d})  AS active_7d,
        COUNT(DISTINCT user_id) FILTER (WHERE last_seen_at > ${since30d}) AS active_30d
      FROM sync_devices;
    `;
    const c = counts[0];
    console.log(`  Last 24 hours: ${Number(c?.active_24h ?? 0)}`);
    console.log(`  Last 7 days:   ${Number(c?.active_7d ?? 0)}`);
    console.log(`  Last 30 days:  ${Number(c?.active_30d ?? 0)}`);

    const users: ActiveDeviceUserRow[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.email,
        COUNT(DISTINCT d.client_id) AS devices,
        MAX(d.last_seen_at) AS last_seen
      FROM sync_devices d
      JOIN users u ON u.id = d.user_id
      WHERE d.last_seen_at > ${since7d}
      GROUP BY u.id, u.email
      ORDER BY MAX(d.last_seen_at) DESC
      LIMIT ${limit};
    `;

    if (users.length === 0) {
      console.log('\nNo users active in the last 7 days.');
      return;
    }

    console.log(`\n--- Top ${users.length} users by last device activity (7d) ---`);
    console.table(
      users.map((u) => ({
        ID: u.id,
        Email: displayEmail(u.email),
        Devices: Number(u.devices),
        'Last Seen': new Date(Number(u.last_seen)).toLocaleString(),
      })),
    );
  } catch (error) {
    reportMonitoringError('Error fetching active users (quick):', error);
    process.exitCode = 1;
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];
  const showFullEmails = args.includes('--unmask');

  try {
    switch (command) {
      case 'stats':
        await showStats();
        break;
      case 'usage':
        await showUsage(!args.includes('--no-save'), showFullEmails);
        break;
      case 'usage-history':
        await showUsageHistory(args);
        break;
      case 'logs':
        await showLogs(args);
        break;
      case 'ops':
        await showOps(args);
        break;
      case 'active-users':
        await showActiveUsers(args);
        break;
      case 'active-users-quick':
        await showActiveUsersQuick(args);
        break;
      default:
        console.log('SuperSync Monitor CLI');
        console.log('Usage: npm run monitor -- <command> [flags]');
        console.log('\nCommands:');
        console.log('  stats          Show system vitals and DB status');
        console.log('  usage          Show top 20 users by storage (saves snapshot)');
        console.log('    --no-save      Skip saving snapshot to history');
        console.log('  usage-history  Show usage over time');
        console.log('    --tail <n>     Show last n snapshots (default 10)');
        console.log('  active-users   Show active user counts and recent activity');
        console.log(
          '    --engaged      Add the engaged-users section (reads 2 weeks of ops)',
        );
        console.log('    --threshold <n> Engaged users day threshold (default 3)');
        console.log(
          '    --limit <n>    Rows per user table; counts stay exact (default 30)',
        );
        console.log(
          '  active-users-quick  Fast active-user listing (sync_devices only; skips operations)',
        );
        console.log('    --limit <n>    Top users limit (default 50)');
        console.log('  logs           Show server logs');
        console.log('    --tail <n>     Show last n lines (default 100)');
        console.log('    --search "s"   Filter logs by term');
        console.log('    --error        Show only errors');
        console.log('  ops            Analyze recent operations');
        console.log('    --tail <n>     Show last n ops (default 50)');
        console.log('    --user <id>    Filter by user ID');
        console.log('\nGlobal flags:');
        console.log('  --unmask         Show full email addresses (masked by default)');
        console.log('\nEnvironment:');
        console.log(
          '  MONITOR_SCOPE_USERS  Users sampled by unfiltered `ops` (default 200)',
        );
        break;
    }
  } catch (err) {
    reportMonitoringError('Unexpected error:', err);
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
};

main();
