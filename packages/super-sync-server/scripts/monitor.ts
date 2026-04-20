import { prisma, disconnectDb } from '../src/db';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync, execFileSync } from 'child_process';

const LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'app.log');
const USAGE_HISTORY_PATH = path.join(process.cwd(), 'logs', 'usage-history.jsonl');

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

interface ActiveCountRow {
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
  ops_count: bigint;
  snapshot_bytes: bigint;
  total_bytes: bigint;
}

interface OperationRow {
  id: number;
  user_id: number;
  action_type: string;
  op_type: string;
  entity_type: string;
  entity_id: string | null;
  payload_bytes: bigint;
  payload_json_length: bigint;
  received_at: bigint;
}

interface EntityTypeBreakdownRow {
  entity_type: string;
  count: bigint;
  total_bytes: bigint;
  avg_bytes: bigint;
  max_bytes: bigint;
}

interface LargestOperationRow {
  id: number;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  payload_bytes: bigint;
  payload: unknown;
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
}

// --- Snapshot types for JSONL history ---

interface UsageSnapshotUser {
  id: number;
  email: string;
  bytes: number;
  opsBytes: number;
  opsCount: number;
  snapshotBytes: number;
}

interface UsageSnapshot {
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
    console.log('Status: Disconnected ❌');
    console.error('Error:', error);
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
    // Aggregate per-user op size in a single pass; correlated subqueries here
    // scan the full operations table per user and hang on large DBs.
    const users: UserStorageRow[] = await prisma.$queryRaw`
      WITH ops_per_user AS (
        SELECT
          user_id,
          SUM(pg_column_size(payload))::bigint AS ops_bytes,
          COUNT(*)::bigint AS ops_count
        FROM operations
        GROUP BY user_id
      )
      SELECT
        u.id,
        u.email,
        COALESCE(o.ops_bytes, 0) as ops_bytes,
        COALESCE(o.ops_count, 0) as ops_count,
        COALESCE(LENGTH(s.snapshot_data), 0) as snapshot_bytes,
        (COALESCE(o.ops_bytes, 0) + COALESCE(LENGTH(s.snapshot_data), 0)) as total_bytes
      FROM users u
      LEFT JOIN ops_per_user o ON o.user_id = u.id
      LEFT JOIN user_sync_state s ON u.id = s.user_id
      ORDER BY total_bytes DESC
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
      opsCount: Number(u.ops_count),
      snapshotBytes: Number(u.snapshot_bytes),
    }));

    console.table(
      usersData.map((u) => ({
        ID: u.id,
        Email: displayEmail(u.email),
        Ops: u.opsCount,
        OpsSize: formatBytes(u.opsBytes),
        AvgOp: u.opsCount > 0 ? formatBytes(u.opsBytes / u.opsCount) : '-',
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
    console.error('Error fetching usage data:', error);
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
  const snapshots: UsageSnapshot[] = lines
    .slice(-tailCount)
    .map((line) => JSON.parse(line));

  if (snapshots.length === 0) {
    console.log('No snapshots found.');
    return;
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

    // Get recent operations with sizes
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
          pg_column_size(o.payload) as payload_bytes,
          LENGTH(o.payload::text) as payload_json_length,
          o.received_at
        FROM operations o
        WHERE o.user_id = ${userId}
        ORDER BY o.server_seq DESC
        LIMIT ${tailCount};
      `;
    } else {
      ops = await prisma.$queryRaw`
        SELECT
          o.id,
          o.user_id,
          o.action_type,
          o.op_type,
          o.entity_type,
          o.entity_id,
          pg_column_size(o.payload) as payload_bytes,
          LENGTH(o.payload::text) as payload_json_length,
          o.received_at
        FROM operations o
        ORDER BY o.server_seq DESC
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
        JSONLen: Number(o.payload_json_length),
        Time: new Date(Number(o.received_at)).toLocaleTimeString(),
      })),
    );

    // Summary by entity type
    let byType: EntityTypeBreakdownRow[];
    if (hasUserFilter) {
      byType = await prisma.$queryRaw`
        SELECT
          o.entity_type,
          COUNT(*) as count,
          SUM(pg_column_size(o.payload)) as total_bytes,
          AVG(pg_column_size(o.payload)) as avg_bytes,
          MAX(pg_column_size(o.payload)) as max_bytes
        FROM operations o
        WHERE o.user_id = ${userId}
        GROUP BY o.entity_type
        ORDER BY total_bytes DESC;
      `;
    } else {
      byType = await prisma.$queryRaw`
        SELECT
          o.entity_type,
          COUNT(*) as count,
          SUM(pg_column_size(o.payload)) as total_bytes,
          AVG(pg_column_size(o.payload)) as avg_bytes,
          MAX(pg_column_size(o.payload)) as max_bytes
        FROM operations o
        GROUP BY o.entity_type
        ORDER BY total_bytes DESC;
      `;
    }

    console.log('\n--- Breakdown by Entity Type ---');
    console.table(
      byType.map((t) => ({
        Type: t.entity_type,
        Count: Number(t.count),
        Total: formatBytes(Number(t.total_bytes)),
        Avg: formatBytes(Number(t.avg_bytes)),
        Max: formatBytes(Number(t.max_bytes)),
      })),
    );

    // Show largest single operation
    let largest: LargestOperationRow[];
    if (hasUserFilter) {
      largest = await prisma.$queryRaw`
        SELECT
          o.id,
          o.action_type,
          o.entity_type,
          o.entity_id,
          pg_column_size(o.payload) as payload_bytes,
          o.payload
        FROM operations o
        WHERE o.user_id = ${userId}
        ORDER BY pg_column_size(o.payload) DESC
        LIMIT 1;
      `;
    } else {
      largest = await prisma.$queryRaw`
        SELECT
          o.id,
          o.action_type,
          o.entity_type,
          o.entity_id,
          pg_column_size(o.payload) as payload_bytes,
          o.payload
        FROM operations o
        ORDER BY pg_column_size(o.payload) DESC
        LIMIT 1;
      `;
    }

    if (largest.length > 0) {
      const op = largest[0];
      console.log('\n--- Largest Operation ---');
      console.log(`ID: ${op.id}`);
      console.log(`Action: ${op.action_type}`);
      console.log(`Entity: ${op.entity_type}:${op.entity_id || '*'}`);
      console.log(`Size: ${formatBytes(Number(op.payload_bytes))}`);

      // Show keys in the payload
      const payload = op.payload as Record<string, unknown> | null;
      if (payload && typeof payload === 'object') {
        console.log('\nPayload structure:');
        const analyzePayload = (
          obj: Record<string, unknown>,
          prefix = '',
          depth = 0,
        ): void => {
          if (depth > 10) return;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            const valStr = JSON.stringify(val);
            const size = new TextEncoder().encode(valStr).length;
            if (size > 1000) {
              console.log(
                `  ${prefix}${key}: ${formatBytes(size)} (${typeof val}${Array.isArray(val) ? `[${val.length}]` : ''})`,
              );
              if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                analyzePayload(val as Record<string, unknown>, prefix + '  ', depth + 1);
              }
            }
          }
        };
        analyzePayload(payload);
      }
    }
  } catch (error) {
    console.error('Error fetching operations:', error);
  }
};

const showActiveUsers = async (args: string[]): Promise<void> => {
  console.log('\n--- Active Users Report ---');
  try {
    const showFullEmails = args.includes('--unmask');
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

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
      { label: 'Last 90 days', ms: 90 * ONE_DAY },
    ];

    console.log('\n--- Active Users (by device heartbeat / by sync operations) ---');
    for (const period of periods) {
      const threshold = BigInt(now - period.ms);
      const result: ActiveCountRow[] = await prisma.$queryRaw`
        SELECT
          (SELECT COUNT(DISTINCT user_id) FROM sync_devices WHERE last_seen_at > ${threshold}) as device_count,
          (SELECT COUNT(DISTINCT user_id) FROM operations WHERE received_at > ${threshold}) as ops_count;
      `;
      const devices = Number(result[0]?.device_count ?? 0);
      const ops = Number(result[0]?.ops_count ?? 0);
      console.log(`  ${period.label}: ${devices} connected / ${ops} syncing`);
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

    const recentUsers: RecentUserRow[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.email,
        u.created_at,
        MAX(d.last_seen_at) as last_active,
        COUNT(DISTINCT d.client_id) as device_count,
        COALESCE(COUNT(o.id), 0) as ops_7d
      FROM users u
      INNER JOIN sync_devices d ON u.id = d.user_id
      LEFT JOIN operations o ON u.id = o.user_id AND o.received_at > ${sevenDaysAgo}
      WHERE d.last_seen_at > ${sevenDaysAgo}
      GROUP BY u.id, u.email, u.created_at
      ORDER BY last_active DESC
      LIMIT ${recentLimit};
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

    // Engaged users: active on N+ distinct days (UTC) in the last 2 weeks
    const twoWeeksAgo = BigInt(now - 14 * ONE_DAY);
    const engagedUsers: EngagedUserRow[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.email,
        COUNT(DISTINCT (TO_TIMESTAMP(o.received_at::double precision / 1000) AT TIME ZONE 'UTC')::date) as active_days,
        COUNT(*) as ops_count
      FROM users u
      INNER JOIN operations o ON u.id = o.user_id
      WHERE o.received_at > ${twoWeeksAgo}
      GROUP BY u.id, u.email
      HAVING COUNT(DISTINCT (TO_TIMESTAMP(o.received_at::double precision / 1000) AT TIME ZONE 'UTC')::date) >= ${engagedThreshold}
      ORDER BY active_days DESC, ops_count DESC;
    `;

    console.log(
      `\n--- Engaged Users (${engagedThreshold}+ active days in last 2 weeks, UTC) ---`,
    );
    console.log(`Count: ${engagedUsers.length}`);
    if (engagedUsers.length > 0) {
      console.table(
        engagedUsers.map((u) => ({
          ID: u.id,
          Email: displayEmail(u.email),
          'Active Days': Number(u.active_days),
          'Ops (2w)': Number(u.ops_count),
        })),
      );
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
    console.error('Error fetching active users:', error);
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
        console.log('    --threshold <n> Engaged users day threshold (default 3)');
        console.log('    --limit <n>    Recently active users limit (default 30)');
        console.log('  logs           Show server logs');
        console.log('    --tail <n>     Show last n lines (default 100)');
        console.log('    --search "s"   Filter logs by term');
        console.log('    --error        Show only errors');
        console.log('  ops            Analyze recent operations');
        console.log('    --tail <n>     Show last n ops (default 50)');
        console.log('    --user <id>    Filter by user ID');
        console.log('\nGlobal flags:');
        console.log('  --unmask         Show full email addresses (masked by default)');
        break;
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    await disconnectDb();
  }
};

main();
