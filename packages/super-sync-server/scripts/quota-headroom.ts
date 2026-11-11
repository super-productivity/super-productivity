/**
 * `monitor -- quota`: how close accounts are to their storage quota.
 *
 * The server prunes an account's operation history only behind a full-state
 * boundary, and routine incremental sync creates none (docs/architecture.md),
 * so an active account's `storage_used_bytes` mostly only grows. This report
 * shows per account the counter against `storage_quota_bytes`, the bytes
 * uploaded over the last 30 days, and a projected time to quota at that rate,
 * plus a fleet summary.
 *
 * Accounts are identified by numeric id only; the report never reads email.
 *
 * Cost:
 * - The percentage summary reads `users` only (one row per account, no
 *   `operations` access), so it covers every account exactly.
 * - Growth reads `operations` only for accounts with a device heartbeat in
 *   the window (an upload bumps `last_seen_at`, so an account without one has
 *   uploaded nothing), capped at `MONITOR_SCOPE_USERS` and taking the highest
 *   quota use first. Per account it costs one index descent (the first
 *   operation in the window), the newest OPS_PER_USER operations for the
 *   average size and at most OPS_PER_USER full-state operations through their
 *   partial index, so the work is `users x tail`, as for the other reports.
 *   The uploaded bytes are therefore an estimate: the newest OPS_PER_USER
 *   full-state operations in the window are summed exactly (one is up to five
 *   orders of magnitude larger than a delta, so averaging it in or out put the
 *   result off by 10x and more), and the remaining operations count times
 *   their average size. An account with more full-state operations than that
 *   in the window is underestimated.
 * - The full-state lookup is only bounded with the partial index
 *   `operations_user_id_full_state_server_seq_idx` (migration 20260512000000).
 *   Without it (a `prisma db push` database, or an INVALID index after an
 *   interrupted build) it reads every operation in the window.
 *
 * The projection uses gross uploaded bytes and assumes nothing is pruned, which
 * is the routine case above; cleanup or a full-state boundary makes the real
 * time to quota longer. A one-off import counts as if it recurred every window,
 * and the delta estimate can be off in either direction.
 */

import { prisma } from './monitoring-db';
import { OPERATION_BYTES, OPS_PER_USER, scopeUserLimit } from './monitoring-scope';

export const QUOTA_GROWTH_WINDOW_DAYS = 30;
export const QUOTA_PERCENT_THRESHOLDS = [50, 75, 90] as const;
export const QUOTA_PROJECTION_HORIZONS_DAYS = [90, 180, 365] as const;
const DEFAULT_TABLE_ROWS = 20;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface QuotaAccount {
  id: number;
  usedBytes: number;
  quotaBytes: number;
  uploadedBytes: number;
}

export interface QuotaAccountReport extends QuotaAccount {
  usedPercent: number;
  /** 0 when already at or over quota; null when nothing was uploaded. */
  daysToQuota: number | null;
}

export interface QuotaFleetSummary {
  accounts: number;
  abovePercent: Record<(typeof QUOTA_PERCENT_THRESHOLDS)[number], number>;
  atOrOverQuota: number;
}

export interface QuotaProjectionSummary {
  /** Scoped accounts not yet at quota that are projected to reach it within N days. */
  withinDays: Record<(typeof QUOTA_PROJECTION_HORIZONS_DAYS)[number], number>;
  /** Scoped accounts already at or over quota. */
  atOrOverQuota: number;
}

/**
 * Days until `usedBytes` reaches `quotaBytes` at the window's upload rate.
 */
export const projectDaysToQuota = (
  account: QuotaAccount,
  windowDays: number = QUOTA_GROWTH_WINDOW_DAYS,
): number | null => {
  if (account.usedBytes >= account.quotaBytes) return 0;
  if (account.uploadedBytes <= 0) return null;
  const bytesPerDay = account.uploadedBytes / windowDays;
  return (account.quotaBytes - account.usedBytes) / bytesPerDay;
};

export const toAccountReport = (
  account: QuotaAccount,
  windowDays: number = QUOTA_GROWTH_WINDOW_DAYS,
): QuotaAccountReport => ({
  ...account,
  usedPercent: (account.usedBytes / account.quotaBytes) * 100,
  daysToQuota: projectDaysToQuota(account, windowDays),
});

export const summarizeProjections = (
  reports: QuotaAccountReport[],
): QuotaProjectionSummary => {
  const withinDays = Object.fromEntries(
    QUOTA_PROJECTION_HORIZONS_DAYS.map((horizon) => [
      horizon,
      reports.filter(
        (r) =>
          r.usedBytes < r.quotaBytes &&
          r.daysToQuota !== null &&
          r.daysToQuota <= horizon,
      ).length,
    ]),
  ) as QuotaProjectionSummary['withinDays'];
  return {
    withinDays,
    atOrOverQuota: reports.filter((r) => r.usedBytes >= r.quotaBytes).length,
  };
};

/** Soonest to quota first; accounts that are not growing last, by quota use. */
export const sortByUrgency = (reports: QuotaAccountReport[]): QuotaAccountReport[] =>
  [...reports].sort((a, b) => {
    if (a.daysToQuota !== b.daysToQuota) {
      if (a.daysToQuota === null) return 1;
      if (b.daysToQuota === null) return -1;
      return a.daysToQuota - b.daysToQuota;
    }
    return b.usedPercent - a.usedPercent || a.id - b.id;
  });

const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const formatDays = (days: number | null): string => {
  if (days === null) return 'not growing';
  if (days === 0) return 'at quota';
  if (days > 3650) return '> 10 years';
  return `${Math.ceil(days)} d`;
};

interface FleetRow {
  accounts: bigint;
  above_50: bigint;
  above_75: bigint;
  above_90: bigint;
  at_quota: bigint;
}

interface ScopeRow {
  id: number;
  used_bytes: bigint;
  quota_bytes: bigint;
  matched: bigint;
}

export interface GrowthRow {
  user_id: number;
  last_seq: number | bigint;
  first_seq: number | bigint | null;
  /** The newest OPS_PER_USER full-state operations in the window: count, bytes. */
  full_state_count: number | bigint | null;
  full_state_bytes: number | null;
  /** Average size of the newest delta operations, inside the window / overall. */
  avg_window_delta_bytes: number | null;
  avg_delta_bytes: number | null;
}

/**
 * Estimated bytes uploaded in the window: its full-state operations exactly,
 * plus the remaining operation count (from sequence numbers) times the average
 * delta size (from the newest operations, those inside the window when there
 * are any).
 */
export const estimateWindowBytes = (row: GrowthRow): number => {
  if (row.first_seq === null) return 0;
  const count = Number(row.last_seq) - Number(row.first_seq) + 1;
  if (count <= 0) return 0;
  const fullStateCount = Math.min(Number(row.full_state_count ?? 0), count);
  const deltaAvg = row.avg_window_delta_bytes ?? row.avg_delta_bytes ?? 0;
  return Math.round(
    Number(row.full_state_bytes ?? 0) + (count - fullStateCount) * deltaAvg,
  );
};

/**
 * Fleet percentages over every account. Integer arithmetic, so a threshold is
 * exact: "above 90%" is `used * 100 > quota * 90`.
 */
export const queryFleetSummary = async (): Promise<QuotaFleetSummary> => {
  const [row] = await prisma.$queryRaw<FleetRow[]>`
    SELECT
      COUNT(*) AS accounts,
      COUNT(*) FILTER (WHERE storage_used_bytes * 100 > storage_quota_bytes * 50) AS above_50,
      COUNT(*) FILTER (WHERE storage_used_bytes * 100 > storage_quota_bytes * 75) AS above_75,
      COUNT(*) FILTER (WHERE storage_used_bytes * 100 > storage_quota_bytes * 90) AS above_90,
      COUNT(*) FILTER (WHERE storage_used_bytes >= storage_quota_bytes) AS at_quota
    FROM users
    WHERE storage_quota_bytes > 0
  `;
  return {
    accounts: Number(row?.accounts ?? 0),
    abovePercent: {
      50: Number(row?.above_50 ?? 0),
      75: Number(row?.above_75 ?? 0),
      90: Number(row?.above_90 ?? 0),
    },
    atOrOverQuota: Number(row?.at_quota ?? 0),
  };
};

/**
 * Accounts that uploaded in the window (device heartbeat inside it) with the
 * highest quota use, capped, plus the bytes each uploaded in the window.
 */
export const queryGrowingAccounts = async (
  since: bigint,
  limit: number,
): Promise<{ accounts: QuotaAccount[]; matched: number }> => {
  const scope = await prisma.$queryRaw<ScopeRow[]>`
    SELECT
      u.id,
      u.storage_used_bytes AS used_bytes,
      u.storage_quota_bytes AS quota_bytes,
      COUNT(*) OVER () AS matched
    FROM users u
    WHERE u.storage_quota_bytes > 0
      AND u.id IN (SELECT user_id FROM sync_devices WHERE last_seen_at > ${since})
    ORDER BY u.storage_used_bytes::float8 / u.storage_quota_bytes DESC, u.id
    LIMIT ${limit}
  `;
  if (scope.length === 0) return { accounts: [], matched: 0 };

  const userIds = scope.map((row) => row.id);
  // Bounded per account, like the other operations reports: one index descent
  // on (user_id, received_at, server_seq) finds the first operation in the
  // window, `last_seq` gives the newest, and their difference counts the
  // window's operations (the server prunes only behind a full-state boundary,
  // so a window is contiguous). The delta size comes from the newest
  // OPS_PER_USER operations, preferring those inside the window. Summing every
  // operation in the window instead hit statement_timeout on the hosted
  // instance with 1,000 accounts (2026-11-11). Full-state operations are the
  // exception: there are few, each can outweigh every delta in the window, and
  // the partial index on them makes a LIMITed sum of the newest ones cheap.
  // Their op_type values stay literals so that the query implies that index's
  // predicate under any plan (see latestCausalFullStateSql).
  const growth = await prisma.$queryRaw<GrowthRow[]>`
    SELECT
      scope_users.user_id,
      COALESCE(state.last_seq, 0) AS last_seq,
      first_in_window.server_seq AS first_seq,
      full_state.full_state_count,
      full_state.full_state_bytes,
      tail.avg_window_delta_bytes,
      tail.avg_delta_bytes
    FROM unnest(${userIds}::int[]) AS scope_users(user_id)
    LEFT JOIN user_sync_state state ON state.user_id = scope_users.user_id
    LEFT JOIN LATERAL (
      SELECT operations.server_seq
      FROM operations
      WHERE operations.user_id = scope_users.user_id
        AND operations.received_at > ${since}
      ORDER BY operations.received_at, operations.server_seq
      LIMIT 1
    ) AS first_in_window ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS full_state_count,
        COALESCE(SUM(newest_full_state.bytes), 0)::float8 AS full_state_bytes
      FROM (
        SELECT ${OPERATION_BYTES} AS bytes
        FROM operations
        WHERE operations.user_id = scope_users.user_id
          AND operations.server_seq >= first_in_window.server_seq
          AND operations.op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')
        ORDER BY operations.server_seq DESC
        LIMIT ${OPS_PER_USER}
      ) AS newest_full_state
    ) AS full_state ON true
    LEFT JOIN LATERAL (
      SELECT
        AVG(newest.bytes) FILTER (
          WHERE newest.received_at > ${since} AND NOT newest.is_full_state
        )::float8 AS avg_window_delta_bytes,
        AVG(newest.bytes) FILTER (WHERE NOT newest.is_full_state)::float8
          AS avg_delta_bytes
      FROM (
        SELECT
          ${OPERATION_BYTES} AS bytes,
          operations.received_at,
          operations.op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')
            AS is_full_state
        FROM operations
        WHERE operations.user_id = scope_users.user_id
        ORDER BY operations.server_seq DESC
        LIMIT ${OPS_PER_USER}
      ) AS newest
    ) AS tail ON true
  `;
  const uploadedById = new Map(
    growth.map((row) => [row.user_id, estimateWindowBytes(row)]),
  );

  return {
    accounts: scope.map((row) => ({
      id: row.id,
      usedBytes: Number(row.used_bytes),
      quotaBytes: Number(row.quota_bytes),
      uploadedBytes: uploadedById.get(row.id) ?? 0,
    })),
    matched: Number(scope[0].matched),
  };
};

const parseLimit = (args: string[]): number => {
  const idx = args.indexOf('--limit');
  if (idx === -1 || idx + 1 >= args.length) return DEFAULT_TABLE_ROWS;
  const value = Number.parseInt(args[idx + 1], 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--limit expects a non-negative integer, got "${args[idx + 1]}"`);
  }
  return value;
};

export const showQuotaHeadroom = async (
  args: string[],
  now: number = Date.now(),
): Promise<void> => {
  const tableRows = parseLimit(args);
  const scopeLimit = scopeUserLimit();
  const windowDays = QUOTA_GROWTH_WINDOW_DAYS;
  const since = BigInt(now - windowDays * ONE_DAY_MS);

  console.log('\n--- Storage Quota Headroom ---');

  const fleet = await queryFleetSummary();
  console.log(`\nAll ${fleet.accounts} accounts (storage used vs quota):`);
  console.table(
    QUOTA_PERCENT_THRESHOLDS.map((threshold) => ({
      'Used above': `${threshold}%`,
      Accounts: fleet.abovePercent[threshold],
    })).concat([{ 'Used above': 'at or over quota', Accounts: fleet.atOrOverQuota }]),
  );

  const { accounts, matched } = await queryGrowingAccounts(since, scopeLimit);
  if (accounts.length === 0) {
    console.log(`\nNo account has a device heartbeat in the last ${windowDays} days.`);
    return;
  }

  const reports = sortByUrgency(accounts.map((a) => toAccountReport(a, windowDays)));
  const projections = summarizeProjections(reports);
  const population =
    matched > accounts.length
      ? `the ${accounts.length} with the highest quota use of ${matched} accounts active in the last ${windowDays} days (widen with MONITOR_SCOPE_USERS)`
      : `all ${accounts.length} accounts active in the last ${windowDays} days`;

  console.log(
    `\nProjected time to quota at each account's ${windowDays}-day upload rate, for ${population}.` +
      ' Uploaded bytes are an estimate (full-state operations exact, the rest count x average size);' +
      ' pruning makes real times longer:',
  );
  console.table([
    ...QUOTA_PROJECTION_HORIZONS_DAYS.map((horizon) => ({
      'Reaches quota': `within ${horizon} days`,
      Accounts: projections.withinDays[horizon],
    })),
    { 'Reaches quota': 'already at or over', Accounts: projections.atOrOverQuota },
  ]);

  if (tableRows > 0) {
    console.log(`\nPer account, soonest to quota first (top ${tableRows}, --limit):`);
    console.table(
      reports.slice(0, tableRows).map((r) => ({
        ID: r.id,
        Used: formatMb(r.usedBytes),
        Quota: formatMb(r.quotaBytes),
        'Used %': `${r.usedPercent.toFixed(1)}%`,
        [`Uploaded ${windowDays}d (est.)`]: formatMb(r.uploadedBytes),
        'To quota': formatDays(r.daysToQuota),
      })),
    );
  }
};
