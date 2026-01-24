#!/usr/bin/env tsx
/**
 * SuperSync Storage Analysis Tool
 *
 * A reusable investigation script for analyzing operation patterns, user behavior,
 * and storage anomalies in the SuperSync database.
 *
 * Usage:
 *   npm run analyze-storage -- <command> [options]
 *
 * Commands:
 *   operation-sizes [--user <id>]        Analyze operation size distribution
 *   operation-timeline [--user <id>]     Analyze temporal patterns (bursts, loops)
 *   operation-types [--user <id>]        Breakdown by operation type
 *   large-ops [--limit <n>]              Find and analyze largest operations
 *   rapid-fire [--threshold <n>]         Detect potential sync loops
 *   snapshot-analysis                    Analyze snapshot usage patterns
 *   user-deep-dive --user <id>           Complete analysis for one user
 *   export-ops --user <id> [--limit <n>] Export operations to JSON for analysis
 *   compare-users <id1> <id2>            Compare two users' patterns
 */

import { prisma, disconnectDb } from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Utility Functions
// ============================================================================

const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};

const saveToFile = (filename: string, data: any): string => {
  const outputDir = path.join(process.cwd(), 'analysis-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filepath;
};

// ============================================================================
// Analysis Commands
// ============================================================================

/**
 * Analyze operation size distribution to identify outliers
 */
const analyzeOperationSizes = async (userId?: number): Promise<void> => {
  console.log('\n=== Operation Size Distribution ===\n');

  const whereClause = userId ? `WHERE user_id = ${userId}` : '';

  // Get percentile distribution
  const sizeDistribution: any[] = await prisma.$queryRaw`
    SELECT
      percentile_cont(0.10) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p10,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p75,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p90,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY pg_column_size(payload)) as p99,
      MIN(pg_column_size(payload)) as min_size,
      MAX(pg_column_size(payload)) as max_size,
      AVG(pg_column_size(payload)) as avg_size,
      COUNT(*) as total_ops
    FROM operations
    ${userId ? `WHERE user_id = ${userId}` : ''};
  `;

  const stats = sizeDistribution[0];
  console.log('Size Percentiles:');
  console.log(`  Min:  ${formatBytes(Number(stats.min_size))}`);
  console.log(`  P10:  ${formatBytes(Number(stats.p10))}`);
  console.log(`  P25:  ${formatBytes(Number(stats.p25))}`);
  console.log(`  P50:  ${formatBytes(Number(stats.p50))} (median)`);
  console.log(`  P75:  ${formatBytes(Number(stats.p75))}`);
  console.log(`  P90:  ${formatBytes(Number(stats.p90))}`);
  console.log(`  P95:  ${formatBytes(Number(stats.p95))}`);
  console.log(`  P99:  ${formatBytes(Number(stats.p99))}`);
  console.log(`  Max:  ${formatBytes(Number(stats.max_size))}`);
  console.log(`  Avg:  ${formatBytes(Number(stats.avg_size))}`);
  console.log(`  Total Operations: ${Number(stats.total_ops)}`);

  // Size buckets
  console.log('\nSize Distribution:');
  const buckets: any[] = await prisma.$queryRaw`
    SELECT
      CASE
        WHEN pg_column_size(payload) < 512 THEN '0-512B'
        WHEN pg_column_size(payload) < 1024 THEN '512B-1KB'
        WHEN pg_column_size(payload) < 5120 THEN '1KB-5KB'
        WHEN pg_column_size(payload) < 10240 THEN '5KB-10KB'
        WHEN pg_column_size(payload) < 51200 THEN '10KB-50KB'
        WHEN pg_column_size(payload) < 102400 THEN '50KB-100KB'
        ELSE '100KB+'
      END as size_bucket,
      COUNT(*) as count,
      SUM(pg_column_size(payload)) as total_bytes
    FROM operations
    ${userId ? `WHERE user_id = ${userId}` : ''}
    GROUP BY size_bucket
    ORDER BY MIN(pg_column_size(payload));
  `;

  console.table(
    buckets.map((b) => ({
      Bucket: b.size_bucket,
      Count: Number(b.count),
      Total: formatBytes(Number(b.total_bytes)),
      AvgSize: formatBytes(Number(b.total_bytes) / Number(b.count)),
    })),
  );
};

/**
 * Analyze temporal patterns - detect bursts, sync loops, etc.
 */
const analyzeOperationTimeline = async (userId?: number): Promise<void> => {
  console.log('\n=== Operation Timeline Analysis ===\n');

  // Operations per day
  console.log('Operations per Day (last 30 days):');
  const perDay: any[] = await prisma.$queryRaw`
    SELECT
      DATE(to_timestamp(received_at / 1000)) as date,
      COUNT(*) as ops_count,
      COUNT(DISTINCT client_id) as unique_devices,
      SUM(pg_column_size(payload)) as total_bytes
    FROM operations
    WHERE received_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000
    ${userId ? `AND user_id = ${userId}` : ''}
    GROUP BY DATE(to_timestamp(received_at / 1000))
    ORDER BY date DESC
    LIMIT 30;
  `;

  if (perDay.length > 0) {
    console.table(
      perDay.map((d) => ({
        Date: String(d.date).split('T')[0],
        Ops: Number(d.ops_count),
        Devices: Number(d.unique_devices),
        Size: formatBytes(Number(d.total_bytes)),
      })),
    );
  } else {
    console.log('No recent operations found.');
  }

  // Operations per hour (last 24 hours)
  console.log('\nOperations per Hour (last 24 hours):');
  const perHour: any[] = await prisma.$queryRaw`
    SELECT
      DATE_TRUNC('hour', to_timestamp(received_at / 1000)) as hour,
      COUNT(*) as ops_count,
      AVG(pg_column_size(payload)) as avg_size
    FROM operations
    WHERE received_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000
    ${userId ? `AND user_id = ${userId}` : ''}
    GROUP BY hour
    ORDER BY hour DESC
    LIMIT 24;
  `;

  if (perHour.length > 0) {
    console.table(
      perHour.map((h) => ({
        Hour: new Date(h.hour).toLocaleString(),
        Ops: Number(h.ops_count),
        AvgSize: formatBytes(Number(h.avg_size)),
      })),
    );
  }
};

/**
 * Breakdown operations by type
 */
const analyzeOperationTypes = async (userId?: number): Promise<void> => {
  console.log('\n=== Operation Type Analysis ===\n');

  // By opType
  console.log('By Operation Type:');
  const byOpType: any[] = await prisma.$queryRaw`
    SELECT
      op_type,
      COUNT(*) as count,
      SUM(pg_column_size(payload)) as total_bytes,
      AVG(pg_column_size(payload)) as avg_bytes,
      MAX(pg_column_size(payload)) as max_bytes,
      COUNT(DISTINCT user_id) as unique_users
    FROM operations
    ${userId ? `WHERE user_id = ${userId}` : ''}
    GROUP BY op_type
    ORDER BY total_bytes DESC;
  `;

  console.table(
    byOpType.map((t) => ({
      Type: t.op_type,
      Count: Number(t.count),
      Total: formatBytes(Number(t.total_bytes)),
      Avg: formatBytes(Number(t.avg_bytes)),
      Max: formatBytes(Number(t.max_bytes)),
      Users: Number(t.unique_users),
    })),
  );

  // By entityType
  console.log('\nBy Entity Type:');
  const byEntityType: any[] = await prisma.$queryRaw`
    SELECT
      entity_type,
      COUNT(*) as count,
      SUM(pg_column_size(payload)) as total_bytes,
      AVG(pg_column_size(payload)) as avg_bytes
    FROM operations
    ${userId ? `WHERE user_id = ${userId}` : ''}
    GROUP BY entity_type
    ORDER BY total_bytes DESC;
  `;

  console.table(
    byEntityType.map((t) => ({
      Entity: t.entity_type,
      Count: Number(t.count),
      Total: formatBytes(Number(t.total_bytes)),
      Avg: formatBytes(Number(t.avg_bytes)),
    })),
  );

  // By actionType (top 10)
  console.log('\nBy Action Type (Top 10):');
  const byActionType: any[] = await prisma.$queryRaw`
    SELECT
      action_type,
      COUNT(*) as count,
      SUM(pg_column_size(payload)) as total_bytes,
      AVG(pg_column_size(payload)) as avg_bytes
    FROM operations
    ${userId ? `WHERE user_id = ${userId}` : ''}
    GROUP BY action_type
    ORDER BY total_bytes DESC
    LIMIT 10;
  `;

  console.table(
    byActionType.map((t) => ({
      Action: t.action_type.substring(0, 50),
      Count: Number(t.count),
      Total: formatBytes(Number(t.total_bytes)),
      Avg: formatBytes(Number(t.avg_bytes)),
    })),
  );
};

/**
 * Find and analyze the largest operations
 */
const analyzeLargeOperations = async (limit = 20): Promise<void> => {
  console.log(`\n=== Top ${limit} Largest Operations ===\n`);

  const largeOps: any[] = await prisma.$queryRaw`
    SELECT
      o.id,
      o.user_id,
      u.email,
      o.op_type,
      o.action_type,
      o.entity_type,
      o.entity_id,
      pg_column_size(o.payload) as payload_bytes,
      o.received_at,
      o.is_payload_encrypted
    FROM operations o
    JOIN users u ON o.user_id = u.id
    ORDER BY pg_column_size(o.payload) DESC
    LIMIT ${limit};
  `;

  console.table(
    largeOps.map((op) => ({
      User: `${op.user_id} (${op.email})`,
      OpType: op.op_type,
      Entity: op.entity_type,
      Size: formatBytes(Number(op.payload_bytes)),
      Encrypted: op.is_payload_encrypted,
      When: new Date(Number(op.received_at)).toLocaleString(),
    })),
  );

  // Detailed analysis of the largest one
  if (largeOps.length > 0) {
    const largest = largeOps[0];
    console.log('\n=== Largest Operation Details ===');
    console.log(`ID: ${largest.id}`);
    console.log(`User: ${largest.user_id} (${largest.email})`);
    console.log(`Type: ${largest.op_type}`);
    console.log(`Action: ${largest.action_type}`);
    console.log(`Entity: ${largest.entity_type}:${largest.entity_id || 'N/A'}`);
    console.log(`Size: ${formatBytes(Number(largest.payload_bytes))}`);
    console.log(`Encrypted: ${largest.is_payload_encrypted}`);

    // Get the actual payload to analyze structure
    const fullOp = await prisma.operation.findUnique({
      where: { id: largest.id },
      select: { payload: true },
    });

    if (fullOp && !largest.is_payload_encrypted) {
      console.log('\nPayload Structure:');
      const analyzeObject = (obj: any, indent = 0): void => {
        const prefix = '  '.repeat(indent);
        for (const [key, value] of Object.entries(obj)) {
          const valueStr = JSON.stringify(value);
          const size = new TextEncoder().encode(valueStr).length;

          if (Array.isArray(value)) {
            console.log(`${prefix}${key}: Array[${value.length}] - ${formatBytes(size)}`);
            if (value.length > 0 && typeof value[0] === 'object') {
              console.log(
                `${prefix}  Sample item keys: ${Object.keys(value[0]).join(', ')}`,
              );
            }
          } else if (typeof value === 'object' && value !== null) {
            console.log(`${prefix}${key}: Object - ${formatBytes(size)}`);
            if (size > 1024) {
              analyzeObject(value, indent + 1);
            }
          } else {
            if (size > 100) {
              console.log(`${prefix}${key}: ${typeof value} - ${formatBytes(size)}`);
            }
          }
        }
      };
      analyzeObject(fullOp.payload as any);
    } else if (largest.is_payload_encrypted) {
      console.log('\nPayload is encrypted, cannot analyze structure.');
    }
  }
};

/**
 * Detect potential sync loops or rapid-fire operations
 */
const detectRapidFire = async (thresholdPerSecond = 5): Promise<void> => {
  console.log(`\n=== Rapid Fire Detection (>${thresholdPerSecond} ops/second) ===\n`);

  const rapidFire: any[] = await prisma.$queryRaw`
    SELECT
      user_id,
      client_id,
      DATE_TRUNC('second', to_timestamp(received_at / 1000)) as second,
      COUNT(*) as ops_in_second,
      array_agg(DISTINCT op_type) as op_types,
      array_agg(DISTINCT entity_type) as entity_types
    FROM operations
    GROUP BY user_id, client_id, second
    HAVING COUNT(*) > ${thresholdPerSecond}
    ORDER BY ops_in_second DESC
    LIMIT 50;
  `;

  if (rapidFire.length === 0) {
    console.log('No rapid-fire patterns detected.');
    return;
  }

  console.table(
    rapidFire.map((rf) => ({
      User: rf.user_id,
      Client: rf.client_id.substring(0, 12) + '...',
      Second: new Date(rf.second).toLocaleString(),
      Ops: Number(rf.ops_in_second),
      OpTypes: rf.op_types.join(', '),
    })),
  );

  // Group by user to find habitual offenders
  const byUser = new Map<number, number>();
  rapidFire.forEach((rf) => {
    const current = byUser.get(rf.user_id) || 0;
    byUser.set(rf.user_id, current + 1);
  });

  console.log('\nUsers with Most Rapid-Fire Incidents:');
  const userIncidents = Array.from(byUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [userId, count] of userIncidents) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    console.log(`  User ${userId} (${user?.email}): ${count} incidents`);
  }
};

/**
 * Analyze snapshot usage patterns
 */
const analyzeSnapshots = async (): Promise<void> => {
  console.log('\n=== Snapshot Analysis ===\n');

  const snapshotStats: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(CASE WHEN snapshot_data IS NOT NULL THEN 1 END) as users_with_snapshot,
      COUNT(CASE WHEN snapshot_data IS NULL THEN 1 END) as users_without_snapshot,
      AVG(LENGTH(snapshot_data)) FILTER (WHERE snapshot_data IS NOT NULL) as avg_snapshot_size,
      MAX(LENGTH(snapshot_data)) as max_snapshot_size,
      SUM(LENGTH(snapshot_data)) as total_snapshot_size
    FROM user_sync_state;
  `;

  const stats = snapshotStats[0];
  console.log('Snapshot Statistics:');
  console.log(`  Users with snapshot: ${Number(stats.users_with_snapshot)}`);
  console.log(`  Users without snapshot: ${Number(stats.users_without_snapshot)}`);
  console.log(`  Average size: ${formatBytes(Number(stats.avg_snapshot_size || 0))}`);
  console.log(`  Max size: ${formatBytes(Number(stats.max_snapshot_size || 0))}`);
  console.log(`  Total size: ${formatBytes(Number(stats.total_snapshot_size || 0))}`);

  // Correlation with operation count
  console.log('\nSnapshot Size vs Operation Count:');
  const correlation: any[] = await prisma.$queryRaw`
    SELECT
      u.id,
      u.email,
      (SELECT COUNT(*) FROM operations o WHERE o.user_id = u.id) as op_count,
      LENGTH(s.snapshot_data) as snapshot_size,
      s.last_snapshot_seq
    FROM users u
    LEFT JOIN user_sync_state s ON u.id = s.user_id
    WHERE s.snapshot_data IS NOT NULL
    ORDER BY LENGTH(s.snapshot_data) DESC
    LIMIT 20;
  `;

  console.table(
    correlation.map((c) => ({
      User: `${c.id} (${c.email})`,
      Ops: Number(c.op_count),
      SnapshotSize: formatBytes(Number(c.snapshot_size)),
      LastSeq: Number(c.last_snapshot_seq),
    })),
  );
};

/**
 * Complete deep-dive analysis for a single user
 */
const userDeepDive = async (userId: number): Promise<void> => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DEEP DIVE: User ${userId}`);
  console.log('='.repeat(80));

  // User info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      syncState: true,
      devices: true,
    },
  });

  if (!user) {
    console.log('User not found.');
    return;
  }

  console.log('\n--- User Profile ---');
  console.log(`Email: ${user.email}`);
  console.log(`Created: ${user.createdAt.toLocaleString()}`);
  console.log(`Verified: ${user.isVerified === 1 ? 'Yes' : 'No'}`);
  console.log(`Devices: ${user.devices.length}`);

  if (user.devices.length > 0) {
    console.log('\nDevices:');
    console.table(
      user.devices.map((d) => ({
        ClientId: d.clientId.substring(0, 20) + '...',
        Name: d.deviceName || 'Unknown',
        LastSeen: new Date(Number(d.lastSeenAt)).toLocaleString(),
        LastAckedSeq: d.lastAckedSeq,
      })),
    );
  }

  if (user.syncState) {
    console.log('\n--- Sync State ---');
    console.log(`Last Seq: ${user.syncState.lastSeq}`);
    console.log(`Last Snapshot Seq: ${user.syncState.lastSnapshotSeq || 'N/A'}`);
    console.log(
      `Snapshot Size: ${formatBytes(user.syncState.snapshotData?.length || 0)}`,
    );
    console.log(
      `Snapshot Age: ${user.syncState.snapshotAt ? formatDuration(Date.now() - Number(user.syncState.snapshotAt)) : 'N/A'}`,
    );
  }

  // Run all analyses for this user
  await analyzeOperationSizes(userId);
  await analyzeOperationTimeline(userId);
  await analyzeOperationTypes(userId);

  // Device-specific patterns
  console.log('\n--- Per-Device Operation Breakdown ---');
  const perDevice: any[] = await prisma.$queryRaw`
    SELECT
      client_id,
      COUNT(*) as ops,
      SUM(pg_column_size(payload)) as total_bytes,
      MIN(received_at) as first_op,
      MAX(received_at) as last_op
    FROM operations
    WHERE user_id = ${userId}
    GROUP BY client_id
    ORDER BY ops DESC;
  `;

  console.table(
    perDevice.map((d) => ({
      Device: d.client_id.substring(0, 20) + '...',
      Ops: Number(d.ops),
      Size: formatBytes(Number(d.total_bytes)),
      FirstOp: new Date(Number(d.first_op)).toLocaleString(),
      LastOp: new Date(Number(d.last_op)).toLocaleString(),
    })),
  );
};

/**
 * Export operations to JSON for external analysis
 */
const exportOperations = async (userId: number, limit = 1000): Promise<void> => {
  console.log(`\n=== Exporting Operations for User ${userId} ===\n`);

  const ops = await prisma.operation.findMany({
    where: { userId },
    orderBy: { serverSeq: 'desc' },
    take: limit,
    select: {
      id: true,
      clientId: true,
      serverSeq: true,
      actionType: true,
      opType: true,
      entityType: true,
      entityId: true,
      payload: true,
      vectorClock: true,
      schemaVersion: true,
      clientTimestamp: true,
      receivedAt: true,
      isPayloadEncrypted: true,
    },
  });

  const filename = `user-${userId}-ops-${new Date().toISOString().split('T')[0]}.json`;
  const filepath = saveToFile(filename, ops);

  console.log(`Exported ${ops.length} operations to: ${filepath}`);

  // Basic stats
  const totalSize = new TextEncoder().encode(JSON.stringify(ops)).length;
  console.log(`Total export size: ${formatBytes(totalSize)}`);
  console.log(`Average op size: ${formatBytes(totalSize / ops.length)}`);
};

/**
 * Compare two users' operation patterns
 */
const compareUsers = async (userId1: number, userId2: number): Promise<void> => {
  console.log(`\n=== Comparing Users ${userId1} vs ${userId2} ===\n`);

  const getStats = async (userId: number) => {
    const stats: any[] = await prisma.$queryRaw`
      SELECT
        COUNT(*) as total_ops,
        SUM(pg_column_size(payload)) as total_bytes,
        AVG(pg_column_size(payload)) as avg_bytes,
        MIN(received_at) as first_op,
        MAX(received_at) as last_op,
        COUNT(DISTINCT client_id) as device_count,
        COUNT(DISTINCT op_type) as unique_op_types,
        COUNT(DISTINCT entity_type) as unique_entity_types
      FROM operations
      WHERE user_id = ${userId};
    `;
    return stats[0];
  };

  const [stats1, stats2] = await Promise.all([getStats(userId1), getStats(userId2)]);

  const [user1, user2] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId1 }, select: { email: true } }),
    prisma.user.findUnique({ where: { id: userId2 }, select: { email: true } }),
  ]);

  console.table([
    {
      Metric: 'Email',
      User1: user1?.email || 'Unknown',
      User2: user2?.email || 'Unknown',
    },
    {
      Metric: 'Total Operations',
      User1: Number(stats1.total_ops),
      User2: Number(stats2.total_ops),
    },
    {
      Metric: 'Total Size',
      User1: formatBytes(Number(stats1.total_bytes)),
      User2: formatBytes(Number(stats2.total_bytes)),
    },
    {
      Metric: 'Avg Op Size',
      User1: formatBytes(Number(stats1.avg_bytes)),
      User2: formatBytes(Number(stats2.avg_bytes)),
    },
    {
      Metric: 'Devices',
      User1: Number(stats1.device_count),
      User2: Number(stats2.device_count),
    },
    {
      Metric: 'Unique Op Types',
      User1: Number(stats1.unique_op_types),
      User2: Number(stats2.unique_op_types),
    },
    {
      Metric: 'First Operation',
      User1: new Date(Number(stats1.first_op)).toLocaleDateString(),
      User2: new Date(Number(stats2.first_op)).toLocaleDateString(),
    },
    {
      Metric: 'Last Operation',
      User1: new Date(Number(stats1.last_op)).toLocaleDateString(),
      User2: new Date(Number(stats2.last_op)).toLocaleDateString(),
    },
  ]);
};

// ============================================================================
// CLI
// ============================================================================

const showHelp = (): void => {
  console.log(`
SuperSync Storage Analysis Tool

Usage:
  npm run analyze-storage -- <command> [options]

Commands:
  operation-sizes [--user <id>]           Analyze operation size distribution
  operation-timeline [--user <id>]        Analyze temporal patterns (bursts, loops)
  operation-types [--user <id>]           Breakdown by operation type
  large-ops [--limit <n>]                 Find and analyze largest operations (default: 20)
  rapid-fire [--threshold <n>]            Detect potential sync loops (default: 5 ops/sec)
  snapshot-analysis                       Analyze snapshot usage patterns
  user-deep-dive --user <id>              Complete analysis for one user
  export-ops --user <id> [--limit <n>]    Export operations to JSON (default: 1000)
  compare-users <id1> <id2>               Compare two users' patterns

Examples:
  npm run analyze-storage -- operation-sizes --user 29
  npm run analyze-storage -- large-ops --limit 50
  npm run analyze-storage -- rapid-fire --threshold 10
  npm run analyze-storage -- user-deep-dive --user 27
  npm run analyze-storage -- compare-users 27 29
  `);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  const getOption = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : undefined;
  };

  const getUserId = (): number | undefined => {
    const userId = getOption('--user');
    return userId ? parseInt(userId, 10) : undefined;
  };

  const getLimit = (): number => {
    const limit = getOption('--limit');
    return limit ? parseInt(limit, 10) : 20;
  };

  const getThreshold = (): number => {
    const threshold = getOption('--threshold');
    return threshold ? parseInt(threshold, 10) : 5;
  };

  try {
    switch (command) {
      case 'operation-sizes':
        await analyzeOperationSizes(getUserId());
        break;

      case 'operation-timeline':
        await analyzeOperationTimeline(getUserId());
        break;

      case 'operation-types':
        await analyzeOperationTypes(getUserId());
        break;

      case 'large-ops':
        await analyzeLargeOperations(getLimit());
        break;

      case 'rapid-fire':
        await detectRapidFire(getThreshold());
        break;

      case 'snapshot-analysis':
        await analyzeSnapshots();
        break;

      case 'user-deep-dive': {
        const userId = getUserId();
        if (!userId) {
          console.error('Error: --user <id> is required for user-deep-dive');
          process.exit(1);
        }
        await userDeepDive(userId);
        break;
      }

      case 'export-ops': {
        const userId = getUserId();
        if (!userId) {
          console.error('Error: --user <id> is required for export-ops');
          process.exit(1);
        }
        await exportOperations(userId, getLimit());
        break;
      }

      case 'compare-users': {
        const userId1 = args[1] ? parseInt(args[1], 10) : undefined;
        const userId2 = args[2] ? parseInt(args[2], 10) : undefined;
        if (!userId1 || !userId2) {
          console.error('Error: Two user IDs required: compare-users <id1> <id2>');
          process.exit(1);
        }
        await compareUsers(userId1, userId2);
        break;
      }

      default:
        showHelp();
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
};

main();
