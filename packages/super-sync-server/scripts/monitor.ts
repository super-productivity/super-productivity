import { prisma, disconnectDb } from '../src/db';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync } from 'child_process';

const LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'app.log');
const USAGE_HISTORY_PATH = path.join(process.cwd(), 'logs', 'usage-history.jsonl');

const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

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
    const dbSizeResult: any[] = await prisma.$queryRaw`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size;
    `;
    console.log(`DB Size: ${dbSizeResult[0]?.size}`);

    // Get table sizes
    const tableSizes: any[] = await prisma.$queryRaw`
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
      const duOutput = execSync(`du -sh "${dataDir}" 2>/dev/null || echo "N/A"`, {
        encoding: 'utf-8',
      });
      const size = duOutput.split('\t')[0];
      console.log(`Data directory: ${size}`);
    }
  } catch {
    console.log('Could not determine disk space');
  }
};

const showUsage = async (saveHistory = true): Promise<void> => {
  console.log('\n--- User Storage Usage (Top 20) ---');
  try {
    // Calculate size of operations and snapshot data per user
    const users: any[] = await prisma.$queryRaw`
      SELECT
        u.id,
        u.email,
        COALESCE((SELECT SUM(pg_column_size(o.payload)) FROM operations o WHERE o.user_id = u.id), 0) as ops_bytes,
        COALESCE((SELECT COUNT(*) FROM operations o WHERE o.user_id = u.id), 0) as ops_count,
        COALESCE(LENGTH(s.snapshot_data), 0) as snapshot_bytes,
        (
          COALESCE((SELECT SUM(pg_column_size(o.payload)) FROM operations o WHERE o.user_id = u.id), 0) +
          COALESCE(LENGTH(s.snapshot_data), 0)
        ) as total_bytes
      FROM users u
      LEFT JOIN user_sync_state s ON u.id = s.user_id
      ORDER BY total_bytes DESC
      LIMIT 20;
    `;

    if (users.length === 0) {
      console.log('No users found.');
      return;
    }

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
        Email: u.email,
        Ops: u.opsCount,
        OpsSize: formatBytes(u.opsBytes),
        AvgOp: u.opsCount > 0 ? formatBytes(u.opsBytes / u.opsCount) : '-',
        Snapshot: formatBytes(u.snapshotBytes),
        Total: formatBytes(u.bytes),
      })),
    );

    const totalBytes = usersData.reduce((sum, u) => sum + u.bytes, 0);
    console.log(`\nTotal: ${formatBytes(totalBytes)} across ${usersData.length} users`);

    // Save snapshot to history
    if (saveHistory) {
      const snapshot = {
        timestamp: new Date().toISOString(),
        totalBytes,
        userCount: usersData.length,
        users: usersData,
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

  const tailIndex = args.indexOf('--tail');
  const tailCount = tailIndex !== -1 ? parseInt(args[tailIndex + 1], 10) : 10;

  const content = fs.readFileSync(USAGE_HISTORY_PATH, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const snapshots = lines.slice(-tailCount).map((line) => JSON.parse(line));

  if (snapshots.length === 0) {
    console.log('No snapshots found.');
    return;
  }

  console.table(
    snapshots.map((s: any) => ({
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
        allUserIds.add(u.id);
        userEmails.set(u.id, u.email);
      }
    }

    // Build column headers (short date format)
    const colHeaders = snapshots.map((s: any) => {
      const d = new Date(s.timestamp);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });

    // Build rows
    const rows = Array.from(allUserIds).map((id) => {
      const row: Record<string, string> = { Email: userEmails.get(id) ?? id };
      snapshots.forEach((snap: any, i: number) => {
        const user = snap.users.find((u: any) => u.id === id);
        row[colHeaders[i]] = user ? formatBytes(user.bytes) : '-';
      });
      return row;
    });

    // Sort by latest snapshot size (descending)
    const lastCol = colHeaders[colHeaders.length - 1];
    rows.sort((a, b) => {
      const aVal = a[lastCol] === '-' ? 0 : parseFloat(a[lastCol]);
      const bVal = b[lastCol] === '-' ? 0 : parseFloat(b[lastCol]);
      return bVal - aVal;
    });

    console.log('\n--- Per-User History ---');
    console.table(rows);
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

  const tailIndex = args.indexOf('--tail');
  const tailCount = tailIndex !== -1 ? parseInt(args[tailIndex + 1], 10) : 100;

  const onlyErrors = args.includes('--error');

  const fileStream = fs.createReadStream(LOG_FILE_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];

  for await (const line of rl) {
    let include = true;

    if (onlyErrors && !line.includes('"level":"ERROR"') && !line.includes('[ERROR]')) {
      include = false;
    }

    if (searchTerm && !line.toLowerCase().includes(searchTerm.toLowerCase())) {
      include = false;
    }

    if (include) {
      lines.push(line);
      if (lines.length > tailCount) {
        lines.shift(); // Keep only the last N lines
      }
    }
  }

  lines.forEach((line) => console.log(line));
};

const showOps = async (args: string[]): Promise<void> => {
  console.log('\n--- Recent Operations Analysis ---');
  try {
    const tailIndex = args.indexOf('--tail');
    const tailCount = tailIndex !== -1 ? parseInt(args[tailIndex + 1], 10) : 50;

    const userIndex = args.indexOf('--user');
    const userId = userIndex !== -1 ? parseInt(args[userIndex + 1], 10) : null;

    // Get recent operations with sizes
    let ops: any[];
    if (userId) {
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
    let byType: any[];
    if (userId) {
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
    let largest: any[];
    if (userId) {
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
      const payload = op.payload as any;
      if (payload && typeof payload === 'object') {
        console.log('\nPayload structure:');
        const analyzePayload = (obj: any, prefix = ''): void => {
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            const valStr = JSON.stringify(val);
            const size = new TextEncoder().encode(valStr).length;
            if (size > 1000) {
              console.log(
                `  ${prefix}${key}: ${formatBytes(size)} (${typeof val}${Array.isArray(val) ? `[${val.length}]` : ''})`,
              );
              if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                analyzePayload(val, prefix + '  ');
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

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'stats':
        await showStats();
        break;
      case 'usage':
        await showUsage();
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
      default:
        console.log('SuperSync Monitor CLI');
        console.log('Usage: npm run monitor -- <command> [flags]');
        console.log('\nCommands:');
        console.log('  stats          Show system vitals and DB status');
        console.log('  usage          Show top 20 users by storage (saves snapshot)');
        console.log('  usage-history  Show usage over time');
        console.log('    --tail <n>     Show last n snapshots (default 10)');
        console.log('  logs           Show server logs');
        console.log('    --tail <n>     Show last n lines (default 100)');
        console.log('    --search "s"   Filter logs by term');
        console.log('    --error        Show only errors');
        console.log('  ops            Analyze recent operations');
        console.log('    --tail <n>     Show last n ops (default 50)');
        console.log('    --user <id>    Filter by user ID');
        break;
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    await disconnectDb();
  }
};

main();
