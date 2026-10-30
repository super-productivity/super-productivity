import { readFileSync } from 'node:fs';
import { emptySpec, Query, ViewSpec } from '../core/spec';
import { Effort, MODELS, runEdit } from '../core/edit-loop';

// Measures what the plan's targets need: time to the first visible change,
// total time, rejected steps and whether the result matches the request.
// Expectations are deliberately loose (types, key fields), not exact specs.

interface Expect {
  types?: string[];
  groupBy?: string;
  queryHas?: Record<string, unknown>;
  fieldsInclude?: string[];
  firstChildType?: string;
  title?: string;
  columnsAtLeast?: number;
  columnsPerRow?: number;
  unchanged?: boolean;
  says?: boolean;
}

interface Case {
  id: string;
  start: string;
  request: string;
  selected?: string;
  expect: Expect;
}

const file = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
  starts: Record<string, ViewSpec>;
  cases: Case[];
};

const components = (spec: ViewSpec) => Object.values(spec.components);
const queries = (spec: ViewSpec): Query[] => Object.values(spec.queries);

const check = (
  c: Case,
  before: ViewSpec,
  after: ViewSpec,
  say: string | null,
): string[] => {
  const e = c.expect;
  const fails: string[] = [];
  const types = new Set(components(after).map((x) => x.type));
  e.types?.forEach((t) => !types.has(t) && fails.push(`no ${t}`));
  if (e.groupBy && !components(after).some((x) => x.groupBy === e.groupBy)) {
    fails.push(`not grouped by ${e.groupBy}`);
  }
  for (const [key, value] of Object.entries(e.queryHas ?? {})) {
    const hit = queries(after).some(
      (q) =>
        JSON.stringify(q[key]) === JSON.stringify(value) ||
        (key === 'scope' &&
          String(q.scope).toLowerCase() === String(value).toLowerCase()),
    );
    if (!hit) fails.push(`no query with ${key}=${JSON.stringify(value)}`);
  }
  e.fieldsInclude?.forEach((f) => {
    if (!components(after).some((x) => x.fields?.includes(f as never)))
      fails.push(`no field ${f}`);
  });
  if (e.firstChildType) {
    const root = after.root ? after.components[after.root] : undefined;
    const first = root?.children?.[0];
    if (!first || after.components[first]?.type !== e.firstChildType) {
      fails.push(`first part is not a ${e.firstChildType}`);
    }
  }
  if (e.title && after.title !== e.title) fails.push(`title is "${after.title}"`);
  if (e.columnsAtLeast) {
    const max = Math.max(0, ...components(after).map((x) => x.columns?.length ?? 0));
    if (max < e.columnsAtLeast) fails.push(`${max} columns`);
  }
  if (
    e.columnsPerRow &&
    !components(after).some((x) => x.columnsPerRow === e.columnsPerRow)
  ) {
    fails.push(`no columnsPerRow ${e.columnsPerRow}`);
  }
  if (e.unchanged && JSON.stringify(before) !== JSON.stringify(after))
    fails.push('view changed');
  if (e.says && !say) fails.push('no explanation');
  return fails;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

const run = async (): Promise<void> => {
  const models = (process.env.EVAL_MODELS ?? MODELS.map((m) => m.id).join(',')).split(
    ',',
  );
  const efforts = (process.env.EVAL_EFFORTS ?? 'default').split(',');
  for (const model of models) {
    for (const effort of efforts) {
      const first: number[] = [];
      const total: number[] = [];
      let rejected = 0;
      let steps = 0;
      let passed = 0;
      console.log(`\n${model} · effort ${effort}`);
      for (const c of file.cases) {
        const before = c.start === 'empty' ? emptySpec() : file.starts[c.start];
        try {
          const result = await runEdit({
            fetchFn: fetch,
            apiKey: process.env.ANTHROPIC_API_KEY!,
            model,
            effort: effort === 'default' ? undefined : (effort as Effort),
            spec: before,
            selectedId: c.selected ?? null,
            request: c.request,
          });
          const fails = check(c, before, result.spec, result.say);
          if (result.firstStepMs !== null) first.push(result.firstStepMs);
          total.push(result.totalMs);
          rejected += result.rejectedSteps;
          steps += result.steps;
          if (!fails.length) passed++;
          console.log(
            `${fails.length ? '✗' : '✓'} ${c.id.padEnd(22)} first ${String(result.firstStepMs ?? '-').padStart(6)} ms  total ${String(result.totalMs).padStart(6)} ms  steps ${result.steps}${result.rejectedSteps ? ` (${result.rejectedSteps} rejected)` : ''}${fails.length ? `  ${fails.join('; ')}` : ''}`,
          );
        } catch (err) {
          console.log(`✗ ${c.id.padEnd(22)} ${(err as Error).message}`);
        }
      }
      console.log(
        `passed ${passed}/${file.cases.length} · first change p50 ${median(first)} ms · total p50 ${median(total)} ms · rejected steps ${rejected}/${steps}`,
      );
    }
  }
};

void run();
