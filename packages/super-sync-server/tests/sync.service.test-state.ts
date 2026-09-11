/**
 * Shared test state and Prisma-mock helpers for the sync service specs.
 *
 * Separated into its own file to avoid circular import issues with vitest mock hoisting.
 */

export const testState = {
  operations: new Map<string, any>(),
  syncDevices: new Map<string, any>(),
  userSyncStates: new Map<number, any>(),
  users: new Map<number, any>(),
  pendingPasskeyRegistrations: new Map<string, any>(),
  serverSeqCounter: 0,
  batchConflictQueryCount: 0,
  entityConflictFindFirstCount: 0,
  entityConflictArrayQueryCount: 0,
  fullStateAuthorLookupCount: 0,
};

export function resetTestState(): void {
  testState.operations = new Map();
  testState.syncDevices = new Map();
  testState.userSyncStates = new Map();
  testState.users = new Map();
  testState.pendingPasskeyRegistrations = new Map();
  testState.serverSeqCounter = 0;
  testState.batchConflictQueryCount = 0;
  testState.entityConflictFindFirstCount = 0;
  testState.entityConflictArrayQueryCount = 0;
  testState.fullStateAuthorLookupCount = 0;
}

/**
 * detectConflictForEntity's array branch is raw SQL — a MATERIALIZED CTE over the
 * entity_ids GIN index — so every tx mock must answer it via $queryRaw rather than
 * the typed model API.
 *
 * `AS "maxSeq"` is the load-bearing half of the discriminator: only this query
 * aggregates to a maxSeq. Keep `entity_ids @>` as well, but do not rely on it —
 * this inspects the template LITERALS, and the multi-entity lookup moved its `@>` into
 * an interpolated `Prisma.sql` fragment, so it is a bound VALUE there and invisible
 * here. Which is the general hazard worth remembering: every tx mock discriminates on
 * template literals, so extracting SQL into a `Prisma.sql` fragment silently removes
 * that text from all of their views. (An unmatched query throws, which is loud.)
 */
/**
 * Text of a `$queryRaw` call, however Prisma delivered it.
 *
 * A tagged template arrives as the template's string array; a pre-built `Prisma.Sql`
 * (which is how the causal full-state lookup ships, so its op_type values stay LITERALS)
 * arrives as ONE object argument. `String(sqlObject)` is "[object Object]", so a mock
 * that only handles the array form silently stops recognising anything — which is the
 * hazard the comment above warns about, now reached from the other direction.
 */
export function rawQueryText(strings: unknown): string {
  if (typeof strings === 'string') return strings;
  if (Array.isArray(strings)) return strings.join('');
  const sql = strings as { sql?: string; strings?: readonly string[] } | null;
  return sql?.sql ?? (sql?.strings ?? []).join('');
}

/** Bound values, from the rest-args (tagged template) or off the `Prisma.Sql`. */
export function rawQueryValues(strings: unknown, params: unknown[]): unknown[] {
  if (params.length > 0) return params;
  return (strings as { values?: unknown[] } | null)?.values ?? [];
}

export function isEntityArrayBranchQuery(strings: unknown): boolean {
  const sql = rawQueryText(strings);
  return sql.includes('AS "maxSeq"') && sql.includes('entity_ids @>');
}

/**
 * The download path's newest-causal-full-state lookup (`latestCausalFullStateSql`).
 * The selected columns distinguish this from the old-ops aged-prefix fallback,
 * which uses the same causal predicate but binds a retention cutoff as well.
 */
export function isLatestCausalFullStateQuery(strings: unknown): boolean {
  const sql = rawQueryText(strings);
  return (
    sql.includes('SELECT server_seq, client_id') &&
    sql.includes('repair_base_server_seq IS NOT NULL')
  );
}

/**
 * The UPLOAD path's variant of the same statement (`resolveFullStateAuthor`): identical
 * predicate, no `server_seq` bound, so it binds `user_id` alone. Distinguishing it is
 * what lets a spec pin the lookup to one-per-transaction.
 */
export function isUnboundedCausalFullStateQuery(
  strings: unknown,
  params: unknown[],
): boolean {
  return (
    isLatestCausalFullStateQuery(strings) && rawQueryValues(strings, params).length === 1
  );
}

/**
 * Answers it from in-memory ops, mirroring latestCausalFullStateSql: full-state
 * ops, except legacy REPAIRs with no base cursor, newest first. Returns the raw snake_case
 * row shape the service parses.
 *
 * `maxServerSeq` is absent for the upload path's unbounded author lookup, which binds
 * `user_id` alone.
 */
export function latestCausalFullStateRows(
  operations: Map<string, any>,
  values: unknown[],
): Array<{ server_seq: number; client_id: string }> {
  const [userId, maxServerSeq] = values as [number, number | undefined];
  const newest = Array.from(operations.values())
    .filter(
      (op: any) =>
        op.userId === userId &&
        (maxServerSeq === undefined || op.serverSeq <= maxServerSeq) &&
        (op.opType === 'SYNC_IMPORT' ||
          op.opType === 'BACKUP_IMPORT' ||
          (op.opType === 'REPAIR' && op.repairBaseServerSeq != null)),
    )
    .sort((a: any, b: any) => b.serverSeq - a.serverSeq)[0];
  return newest ? [{ server_seq: newest.serverSeq, client_id: newest.clientId }] : [];
}

/**
 * Answers that query from in-memory ops. Parameter order follows the tagged
 * template in conflict.ts: entityId (inside the CTE), then userId, then entityType.
 * Returns the single-row shape the caller destructures.
 */
export function entityArrayBranchRows(
  operations: Map<string, any>,
  params: unknown[],
): Array<{ maxSeq: number | null }> {
  const [entityId, userId, entityType] = params as [string, number, string];
  const seqs = Array.from(operations.values())
    .filter(
      (op: any) =>
        op.userId === userId &&
        op.entityType === entityType &&
        Array.isArray(op.entityIds) &&
        op.entityIds.includes(entityId),
    )
    .map((op: any) => op.serverSeq);
  return [{ maxSeq: seqs.length ? Math.max(...seqs) : null }];
}

export function applyOperationSelect(op: any, select?: Record<string, boolean>): any {
  if (!op || !select) {
    return op;
  }

  return Object.fromEntries(
    Object.entries(select)
      .filter(([, shouldSelect]) => shouldSelect)
      .map(([key]) => [key, op[key]]),
  );
}

export function hasOperationUniqueConflict(
  operations: Map<string, any>,
  row: any,
): boolean {
  return Array.from(operations.values()).some(
    (op) =>
      op.id === row.id ||
      (op.userId === row.userId &&
        row.serverSeq !== undefined &&
        op.serverSeq === row.serverSeq),
  );
}

export type OperationWhereAlternative = {
  opType?: string | { in?: string[] };
  repairBaseServerSeq?: null | { not: null };
};

/**
 * Evaluates one alternative of a `CAUSAL_FULL_STATE_OPERATION_WHERE`-shaped
 * `OR` list against an operation row. Shared so every Prisma mock decodes the
 * production predicate (src/sync/sync.types.ts) the same way.
 */
export function matchesOperationAlternative(
  opType: string,
  repairBaseServerSeq: number | null | undefined,
  alternative: OperationWhereAlternative,
): boolean {
  const wantedOpType = alternative.opType;
  if (typeof wantedOpType === 'string' && opType !== wantedOpType) {
    return false;
  }
  if (
    typeof wantedOpType === 'object' &&
    wantedOpType.in &&
    !wantedOpType.in.includes(opType)
  ) {
    return false;
  }
  if (alternative.repairBaseServerSeq === null && repairBaseServerSeq != null) {
    return false;
  }
  if (alternative.repairBaseServerSeq?.not === null && repairBaseServerSeq == null) {
    return false;
  }
  return true;
}

/**
 * Mocks `prisma.operation.groupBy({ by: ['userId'], _max: { serverSeq } })`
 * for the old-ops sweep's boundary query: `serverSeq.gt` plus the
 * CAUSAL_FULL_STATE_OPERATION_WHERE `OR` list. Anything else throws rather
 * than being silently ignored — a where-clause the mock cannot decode would
 * otherwise let the one query that authorizes DELETEs drift away from its
 * unit-test double while every spec stayed green.
 */
export function mockOperationGroupByMaxSeq(
  operations: Map<string, any>,
  args: {
    where?: { serverSeq?: { gt?: number }; OR?: OperationWhereAlternative[] };
  },
): Array<{ userId: number; _max: { serverSeq: number | null } }> {
  const where = args.where ?? {};
  const unsupported = Object.keys(where).filter((k) => k !== 'serverSeq' && k !== 'OR');
  if (unsupported.length > 0) {
    throw new Error(
      `mockOperationGroupByMaxSeq: unsupported where keys ${unsupported.join(', ')}`,
    );
  }
  if (!Array.isArray(where.OR)) {
    throw new Error(
      'mockOperationGroupByMaxSeq: expected a CAUSAL_FULL_STATE_OPERATION_WHERE OR list',
    );
  }

  const maxSeqByUser = new Map<number, number>();
  for (const op of operations.values()) {
    if (where.serverSeq?.gt !== undefined && op.serverSeq <= where.serverSeq.gt) {
      continue;
    }
    if (
      !where.OR.some((alternative) =>
        matchesOperationAlternative(op.opType, op.repairBaseServerSeq, alternative),
      )
    ) {
      continue;
    }
    const prev = maxSeqByUser.get(op.userId);
    if (prev === undefined || op.serverSeq > prev) {
      maxSeqByUser.set(op.userId, op.serverSeq);
    }
  }
  return Array.from(maxSeqByUser.entries()).map(([userId, maxSeq]) => ({
    userId,
    _max: { serverSeq: maxSeq },
  }));
}

/**
 * Mocks the old-ops sweep's "does the prefix still hold an op inside
 * retention?" probe:
 * `findFirst({ where: { userId, serverSeq: { lt }, receivedAt: { gte } } })`.
 *
 * Returns `undefined` when `args` is not that shape so callers fall through to
 * their own branches. Spelled out here because the hand-written findFirst mocks
 * silently ignore filters they don't know: one would then answer this probe
 * with an unrelated row (never prune) and another with null (always prune) —
 * opposite wrong answers on the guard that keeps a plain delta from becoming
 * the lowest surviving op.
 */
export function mockOperationFindFirstFreshBelowBoundary(
  operations: Map<string, any>,
  args: {
    where?: {
      userId?: number;
      serverSeq?: { lt?: number };
      receivedAt?: { gte?: bigint };
    };
    select?: Record<string, boolean>;
  },
): any | null | undefined {
  const { userId, serverSeq, receivedAt } = args.where ?? {};
  if (serverSeq?.lt === undefined || receivedAt?.gte === undefined) {
    return undefined;
  }
  // Strict like its two siblings above. Silently ignoring an unknown key makes
  // this mock answer a NARROWER production query as though it were the probe:
  // adding any further filter to the real `findFirst` (which in Postgres can
  // cut the result to zero and disable the whole-or-nothing guard outright)
  // otherwise passes the entire unit suite, leaving only the real-Postgres
  // spec — skipped in a default `npm test` — to catch it.
  const unsupported = Object.keys(args.where ?? {}).filter(
    (key) => !['userId', 'serverSeq', 'receivedAt'].includes(key),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `mockOperationFindFirstFreshBelowBoundary: unsupported where keys ${unsupported.join(', ')}`,
    );
  }
  const match = Array.from(operations.values()).find(
    (op) =>
      op.userId === userId &&
      op.serverSeq < serverSeq.lt! &&
      op.receivedAt >= receivedAt.gte!,
  );
  return match ? applyOperationSelect(match, args.select) : null;
}

/**
 * Mocks the causal-REPAIR fallback the state-replacement guard uses when no
 * SYNC_IMPORT/BACKUP_IMPORT survives:
 * `findFirst({ where: { userId, opType: 'REPAIR', repairBaseServerSeq: { not: null } } })`.
 *
 * Returns `undefined` when `args` is not that shape so callers fall through to
 * their own branches. Spelled out because both hand-written findFirst mocks
 * decode only `opType.in` and `OR` lists: a scalar `opType` falls through to
 * `null`, which is indistinguishable from "no boundary survives" — precisely
 * the wrong answer the fallback exists to prevent. The unit suite would then
 * stay green whether the fallback works or not.
 */
export function mockOperationFindFirstCausalRepair(
  operations: Map<string, any>,
  args: {
    where?: {
      userId?: number;
      opType?: unknown;
      repairBaseServerSeq?: { not?: null };
    };
    select?: Record<string, boolean>;
  },
): any | null | undefined {
  const { userId, opType, repairBaseServerSeq } = args.where ?? {};
  if (opType !== 'REPAIR' || repairBaseServerSeq?.not !== null) {
    return undefined;
  }
  const match = Array.from(operations.values())
    .filter(
      (op) =>
        op.userId === userId && op.opType === 'REPAIR' && op.repairBaseServerSeq != null,
    )
    .sort((a, b) => b.serverSeq - a.serverSeq)[0];
  return match ? applyOperationSelect(match, args.select) : null;
}

type UserSyncStateNotNullFilter = { not: null };

/**
 * Mocks `prisma.userSyncState.findMany` for the where-clauses the server
 * actually issues, and throws on any other key rather than ignoring it.
 *
 * The old-ops sweep keys its snapshot cap on `snapshotData` (#9688): only a
 * user still holding a cached snapshot BLOB may have their prune boundary
 * pulled down to `lastSnapshotSeq`. A mock that drops the filter hands every
 * seeded user back as a blob holder, so the uncapped path — the one almost
 * every user takes under mandatory E2EE — is never exercised and re-keying the
 * cap onto the cursor passes the whole unit suite.
 */
export function mockUserSyncStateFindMany(
  userSyncStates: Map<number, any>,
  args?: {
    where?: {
      snapshotData?: UserSyncStateNotNullFilter;
      lastSnapshotSeq?: UserSyncStateNotNullFilter;
      snapshotAt?: UserSyncStateNotNullFilter;
    };
  },
): any[] {
  const where = args?.where ?? {};
  const supported = ['snapshotData', 'lastSnapshotSeq', 'snapshotAt'] as const;
  const unsupported = Object.keys(where).filter(
    (k) => !supported.includes(k as (typeof supported)[number]),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `mockUserSyncStateFindMany: unsupported where keys ${unsupported.join(', ')}`,
    );
  }
  return Array.from(userSyncStates.values()).filter((s: any) =>
    supported.every((key) => where[key]?.not !== null || s[key] != null),
  );
}
