/**
 * Shared bounds for every monitoring report that reads `operations`.
 *
 * In the 2026-08-07 suite run all six operations-backed reports hit the
 * operator's `statement_timeout` and all four that avoid the table succeeded.
 * The reports were bounded in *rows returned* but not in *work done*: a
 * `TABLESAMPLE SYSTEM (1)` still reads 1% of however large the table has grown,
 * and a per-user LATERAL tail still visited every account on the instance
 * (8,610 rows of `user_sync_state`) to collect it.
 *
 * Both drivers are replaced by the scope resolved here. See
 * `scripts/MONITORING-README.md` for the rules a new report must follow.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './monitoring-db';

/** Operations read per sampled user. Not adjustable — cost is `users x this`. */
export const OPS_PER_USER = 100;

const DEFAULT_SCOPE_USERS = 200;
const SCOPE_USERS_ENV = 'MONITOR_SCOPE_USERS';

/**
 * How many users a report samples.
 *
 * An environment variable rather than a CLI flag on purpose: the entry point
 * that actually timed out is `run-all-monitoring`, which builds every child
 * command line itself and forwards no per-report flags — but does pass
 * `{...process.env}` to each child. So `MONITOR_SCOPE_USERS=25 npm run
 * monitor:all` reaches all six reports, while a flag would have reached none of
 * them without threading it through the suite. It also means exactly one place
 * parses the value, which is what keeps the guard below unskippable.
 */
export const scopeUserLimit = (): number => {
  const raw = process.env[SCOPE_USERS_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_SCOPE_USERS;

  const parsed = Number.parseInt(raw, 10);
  // A rejected value must never fall through to the query. Prisma serialises raw
  // parameters with JSON.stringify, so a NaN limit binds as SQL NULL -- and
  // `LIMIT NULL` is `LIMIT ALL`, silently restoring the unbounded fan-out this
  // module exists to prevent. `LIMIT 0` is just as bad in the other direction: it
  // prints a confident all-zero report that reads like a healthy empty instance.
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== raw.trim()) {
    throw new Error(
      `${SCOPE_USERS_ENV} must be a positive integer, got "${raw}". ` +
        `Omit it to use the default of ${DEFAULT_SCOPE_USERS}.`,
    );
  }
  return parsed;
};

export interface OperationScope {
  /** Users this report reads, newest device heartbeat first. */
  readonly userIds: number[];
  /** Sentence naming the sampled population, for the report header. */
  readonly description: string;
}

/**
 * Resolve the users a report samples: those with the most recent device
 * heartbeat, capped at `scopeUserLimit()`.
 *
 * Resolved once per report and reused across its statements, for two reasons.
 * `sync_devices.last_seen_at` is bumped inside the upload transaction, so live
 * traffic reorders this set continuously — re-running the driver per statement
 * would let the three tables of `operation-types` describe three different
 * populations, and the two tables of `operation-sizes` disagree on `COUNT(*)`.
 * (The `TABLESAMPLE` version this replaced held its sample steady with a shared
 * `REPEATABLE` seed; that guarantee has to survive the rewrite.) It also means
 * `sync_devices` is scanned once per report instead of once per statement.
 *
 * `COUNT(*) OVER ()` is evaluated before `LIMIT`, so the number of users that
 * matched rides along on rows already being fetched — no second query, and the
 * header can say whether the cap actually bound.
 */
export const resolveOperationScope = async (since?: bigint): Promise<OperationScope> => {
  const limit = scopeUserLimit();
  const rows = await prisma.$queryRaw<Array<{ user_id: number; matched_users: bigint }>>`
    SELECT user_id, COUNT(*) OVER () AS matched_users
    FROM (
      SELECT user_id, MAX(last_seen_at) AS seen
      FROM sync_devices
      ${since === undefined ? Prisma.empty : Prisma.sql`WHERE last_seen_at > ${since}`}
      GROUP BY user_id
    ) active
    ORDER BY seen DESC
    LIMIT ${limit}
  `;

  const userIds = rows.map((row) => row.user_id);
  const matched = rows.length > 0 ? Number(rows[0].matched_users) : 0;

  return {
    userIds,
    description:
      matched > userIds.length
        ? `Based on the newest ${OPS_PER_USER} operations of each of the ${userIds.length} most recently active users, of ${matched} matching (widen with ${SCOPE_USERS_ENV}).`
        : `Based on the newest ${OPS_PER_USER} operations of each of all ${userIds.length} matching users.`,
  };
};

/**
 * The newest `opsPerUser` operations of every user in `userIds`, projected to
 * `columns`.
 *
 * Each tail is read backwards through the `(user_id, server_seq)` unique index,
 * so a user costs one index descent plus `opsPerUser` heap fetches. That the
 * index is used is what bounds the projection too: `columns` is evaluated on the
 * scan, so if the planner ever chose a Sort instead, an expression in `columns`
 * would run for every matching row rather than `opsPerUser` of them.
 *
 * Keep any `received_at` window on the *outside* of this fragment: pushing it
 * into the subquery turns the bounded index tail back into a scan of that user's
 * whole history looking for matches.
 */
export const newestOpsPerUser = (
  userIds: number[],
  columns: Prisma.Sql,
  opsPerUser: number = OPS_PER_USER,
): Prisma.Sql =>
  Prisma.sql`
        SELECT scoped_ops.*
        FROM unnest(${userIds}::int[]) AS scope_users(user_id)
        CROSS JOIN LATERAL (
          SELECT ${columns}
          FROM operations
          WHERE operations.user_id = scope_users.user_id
          ORDER BY operations.server_seq DESC
          LIMIT ${opsPerUser}
        ) AS scoped_ops
      `;

/**
 * Storage size of one operation row.
 *
 * `payload_bytes` is the counter the upload path maintains; rows written before
 * migration 20260514000001 still carry 0 and fall back to measuring the JSON.
 * That fallback dominates everything else here — measured on 250 users x 100 ops
 * with 12KB out-of-line payloads it cost 6.5x the blocks and 10.7x the time of
 * the backfilled path (133,763 blocks / 737ms vs 20,432 / 69ms), because reading
 * the payload means a TOAST fetch per row. If these reports are slow, check
 * `operations_payload_bytes_unbackfilled_idx` is empty before tuning anything
 * else; `npm run migrate-payload-bytes` fixes it.
 *
 * Evaluate this AT THE SCAN, never over a CTE that projects `payload` forward.
 * The projection does not force a detoast (a tuplestore carries the TOAST
 * pointer), but it does copy any inline-compressed payload through an extra
 * materialisation pass: 20k rows, 46ms and 559 temp blocks spilled to disk
 * versus 17ms and no spill.
 */
export const OPERATION_BYTES = Prisma.sql`
          CASE
            WHEN payload_bytes > 0 THEN payload_bytes
            ELSE OCTET_LENGTH(payload::text)::bigint +
                 OCTET_LENGTH(vector_clock::text)::bigint
          END
        `;
