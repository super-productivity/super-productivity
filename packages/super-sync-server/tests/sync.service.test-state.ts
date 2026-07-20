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
  testState.serverSeqCounter = 0;
  testState.batchConflictQueryCount = 0;
  testState.entityConflictFindFirstCount = 0;
  testState.entityConflictArrayQueryCount = 0;
  testState.fullStateAuthorLookupCount = 0;
}

/**
 * detectConflictForEntity's array branch is raw SQL — a MATERIALIZED CTE over the
 * entity_ids GIN index — so every tx mock must answer it via $queryRaw rather than
 * the typed model API. `AS "maxSeq"` is the discriminator: the only other raw query
 * against `operations` (prefetchLatestEntityOpsForBatch) is a DISTINCT ON with no
 * such alias, so the two never collide.
 */
export function isEntityArrayBranchQuery(strings: unknown): boolean {
  const sql = Array.isArray(strings) ? strings.join('') : String(strings);
  return sql.includes('AS "maxSeq"') && sql.includes('entity_ids @>');
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
