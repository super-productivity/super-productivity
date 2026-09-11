/**
 * Shared EXPLAIN harness for the conflict-lookup plan specs.
 *
 * Extracted because it was copied, and the copy rotted: the batch spec's walker was
 * fixed to multiply the discarded-row counters by `Actual Loops` and to read
 * `Rows Removed by Join Filter`, while the single-entity spec's copy kept
 * under-reporting by up to the loop count and scored a join fan-out as zero. Both specs
 * exist to catch cost regressions on the upload path, so a blind spot in either is the
 * same class of bug. One implementation, one place to fix.
 *
 * The runner is structural rather than `PGlite` so the same walker also drives a REAL
 * PostgreSQL connection (batch-conflict-plan.integration.spec.ts). PGlite is PG18 and
 * production is PG 16.x; the two planners disagree about this exact query — see that
 * spec's header — so the numbers have to be reproducible on both without a second
 * implementation to keep in sync.
 */
export type ExplainRunner = {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type PlanNode = Record<string, unknown>;

export type Measured = {
  /** ROOT-node buffers only — see rootBlocks. */
  blocks: number;
  /** Actual Rows x Actual Loops, summed over the tree. The primary signal. */
  rowsTouched: number;
  rowsFiltered: number;
  rowsJoinFiltered: number;
  tempBlocks: number;
  /**
   * `Heap Fetches`, summed over the tree. An Index Only Scan reports one per
   * tuple whose page the VISIBILITY MAP does not mark all-visible — so this is
   * the only counter that separates "index-only" as a plan shape from
   * "index-only" as an actual saving. `blocks` cannot: a heap page still in
   * shared_buffers is a hit, so a fully degraded scan can read cheap here and
   * be catastrophic on a host where that page is cold.
   */
  heapFetches: number;
  /** Node types + index names, joined with ' -> '. */
  nodes: string;
  /**
   * Root-node `Total Cost` — the number the PLANNER compares, not a measurement. Use it
   * only to reason about plan CHOICE (is one candidate cheaper than another, or are they
   * tied?). It says nothing about what a plan actually costs to run: two plans here have
   * been observed bit-identical in estimated cost while differing 6700x in buffers.
   */
  estimatedCost: number;
};

type Accumulator = {
  touched: number;
  filtered: number;
  joinFiltered: number;
  heapFetches: number;
  nodes: string[];
};

/**
 * `rowsTouched` — Actual Rows x Actual Loops summed over the tree — is the PRIMARY
 * signal, and the only one here that is planner-independent.
 *
 * Two rounds of review were defeated by picking a counter instead. Round 1 asserted
 * `Rows Removed by Filter`, and a fan-out moved the work into a JOIN, where Postgres
 * reports `Rows Removed by Join Filter` — a different key, so 59.8M discarded rows
 * scored 0. Round 2 added that key, and it too fails on PG 16.14 (production's version),
 * where the same fan-out is planned as a HASH join and attributes nothing to a join
 * filter: both counters read 0 while the query touches 2.2M rows against the shipped
 * form's 12.5k. `tempBlocks` catches it only at low `work_mem` — the shipped
 * docker-compose sets 4MB, but at 64MB an 80x regression passes clean.
 *
 * `Actual Loops` multiplication is not cosmetic: Postgres divides the discarded-row
 * counters by loops (`explain.c:show_instrumentation_count`), so a filter inside a
 * per-probe nested loop is reported at 1/100th of what it discarded.
 */
const walk = (node: PlanNode, acc: Accumulator): void => {
  const loops = (node['Actual Loops'] as number) ?? 1;
  acc.touched += ((node['Actual Rows'] as number) ?? 0) * loops;
  acc.filtered += ((node['Rows Removed by Filter'] as number) ?? 0) * loops;
  acc.joinFiltered += ((node['Rows Removed by Join Filter'] as number) ?? 0) * loops;
  // NOT multiplied by loops: unlike the Rows-Removed counters, Heap Fetches is
  // not divided by loops on the way out of explain.c, so scaling it here would
  // square the count inside a nested loop.
  acc.heapFetches += (node['Heap Fetches'] as number) ?? 0;
  acc.nodes.push(
    `${node['Node Type']}${node['Scan Direction'] ? ' ' + node['Scan Direction'] : ''}` +
      `${node['Index Name'] ? ' on ' + node['Index Name'] : ''}`,
  );
  for (const child of (node.Plans as PlanNode[]) ?? []) walk(child, acc);
};

/**
 * Buffers are deliberately taken from the ROOT node only: `Shared Hit/Read Blocks` are
 * CUMULATIVE, so a parent already includes everything its children read. Summing every
 * node double-counts the same buffers once per level of nesting, inflating deep plans
 * (a CTE form nests one level deeper than a flat one) and biasing budgets against the
 * new code.
 */
const rootBlocks = (node: PlanNode): number =>
  ((node['Shared Hit Blocks'] as number) ?? 0) +
  ((node['Shared Read Blocks'] as number) ?? 0);

/**
 * Renders an EXECUTE argument. TEST-ONLY, and deliberately not exported: it builds SQL
 * literals by escaping, which is safe here only because every value comes from a spec's
 * own fixture and `standard_conforming_strings` is on. Arrays are hard-coded to
 * `::text[]` — the only array parameter these statements bind — and a non-scalar would
 * otherwise render as `[object Object]`, silently EXPLAINing a DIFFERENT query than
 * production sends, which is the exact fidelity trap this harness exists to prevent. So
 * it throws instead.
 */
const toSqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return `ARRAY[${value.map(toSqlLiteral).join(',')}]::text[]`;
  if (typeof value === 'object') {
    throw new Error(
      `explainGeneric cannot render a non-scalar parameter (${JSON.stringify(value)}); ` +
        'add an explicit cast rather than letting it stringify.',
    );
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

let preparedCounterId = 0;

/**
 * Shared PREPARE/EXECUTE core. `mode` decides which world is measured; see the two
 * exported wrappers below for when each one is faithful. The params are rendered as
 * literals for EXECUTE, but the PLAN is built through a prepared statement, which is
 * exactly the situation Prisma puts Postgres in — unlike a bare `EXPLAIN` with literal
 * constants, which is a third thing again and is the trap this harness exists to prevent.
 */
const explainWithPlanCacheMode = async (
  db: ExplainRunner,
  sql: string,
  params: readonly unknown[],
  mode: 'force_generic_plan' | 'force_custom_plan',
): Promise<Measured> => {
  const name = `plan_probe_${preparedCounterId++}`;
  const args = params.map(toSqlLiteral).join(', ');
  await db.exec(`SET plan_cache_mode = ${mode}`);
  await db.exec(`PREPARE ${name} AS ${sql}`);
  try {
    const res = await db.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE ${name}${args ? `(${args})` : ''}`,
    );
    const plan = (res.rows[0]['QUERY PLAN'] as PlanNode[])[0].Plan as PlanNode;
    const acc: Accumulator = {
      touched: 0,
      filtered: 0,
      joinFiltered: 0,
      heapFetches: 0,
      nodes: [],
    };
    walk(plan, acc);
    return {
      blocks: rootBlocks(plan),
      rowsTouched: acc.touched,
      rowsFiltered: acc.filtered,
      rowsJoinFiltered: acc.joinFiltered,
      tempBlocks: (plan['Temp Written Blocks'] as number) ?? 0,
      heapFetches: acc.heapFetches,
      nodes: acc.nodes.join(' -> '),
      estimatedCost: (plan['Total Cost'] as number) ?? 0,
    };
  } finally {
    await db.exec(`DEALLOCATE ${name}`);
    await db.exec(`SET plan_cache_mode = auto`);
  }
};

/**
 * EXPLAIN under `force_generic_plan` — the faithful mode for any statement whose generic
 * plan Postgres might actually adopt.
 *
 * MEASURE WITH `force_generic_plan`, NEVER WITH LITERALS. Prisma sends parameterized
 * prepared statements; under the default `auto` Postgres plans the first ~5 executions
 * as CUSTOM, then compares the generic cost against the average custom cost and MAY
 * switch — a cost comparison, not an automatic switch, so a statement can stay on custom
 * plans indefinitely. The single-entity lookup was observed going generic on production,
 * and a generic plan cannot see parameter values, so that is the mode those specs cover.
 * `EXPLAIN` with literal constants is a third thing again, and is the trap: the
 * single-entity spec once tested that way and the blind spot passed two designs that were
 * catastrophic in production. If you add a shape, route it through this function.
 *
 * The exception is a statement whose generic plan is so much more expensive that
 * `choose_custom_plan` can never adopt it — see {@link explainCustom}, and measure BOTH.
 */
export const explainGeneric = (
  db: ExplainRunner,
  sql: string,
  params: readonly unknown[],
): Promise<Measured> => explainWithPlanCacheMode(db, sql, params, 'force_generic_plan');

/**
 * EXPLAIN under `force_custom_plan` — params folded to `Const`s at plan time.
 *
 * DO NOT reach for this to make a spec look healthier; that is precisely the failure
 * {@link explainGeneric}'s header describes. It is faithful ONLY for a statement that
 * provably cannot go generic, and "provably" means measuring the generic plan in the same
 * spec and showing the gap.
 *
 * The old-ops boundary scan is such a statement, and the reason is worth stating because
 * it is invisible in the plan: a PARTIAL index is unreachable under a generic plan at all.
 * With `Param` nodes there are no `Const`s for `operator_predicate_proof` to evaluate, so
 * `predOK` is false and no path into any partial index on the table is generated. Measured
 * on production (PG 16): custom = BitmapOr, cost 22,844; generic = Parallel Seq Scan, cost
 * 982,701, so a 43x margin pins that particular statement on custom plans.
 *
 * BUT THE THRESHOLD IS NOT "generic <= average custom", and reading it that way is how a
 * statement gets left on `explainCustom` when it provably goes generic. `cached_plan_cost`
 * adds a SYNTHETIC planning charge of `1000 * cpu_operator_cost * (nrelations + 1)` — a
 * fixed 5.00 for a single-table query, not measured planning time — to the custom side
 * before the comparison, and the comparison is strictly `<`. So a CHEAP statement flips
 * unconditionally: a `LIMIT 1` lookup planning at ~1.94 carries avg_custom >= 5.29 and can
 * never beat a generic cost of 4.85, no matter how bad the generic plan is at runtime.
 * A large margin only protects EXPENSIVE statements. See
 * `latestCausalFullStateSql` (sync.types.ts) for the statement this cost the fleet.
 *
 * That margin is a load-bearing assumption, not a detail — so a spec using this function
 * must ALSO assert the generic shape via {@link explainGeneric}, which is what turns the
 * assumption into something CI re-checks rather than something a comment claims.
 */
export const explainCustom = (
  db: ExplainRunner,
  sql: string,
  params: readonly unknown[],
): Promise<Measured> => explainWithPlanCacheMode(db, sql, params, 'force_custom_plan');
