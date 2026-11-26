// Phase 0 eval (§ 10 of the plan): runs each case through the same ask() and
// validator as the panel, against the real API, and reports per model how
// many answers were valid, how many matched, and how long they took.

import { readFileSync } from 'node:fs';
import { ask } from '../core/ask';
import { canApplyWithoutReview } from '../core/auto-apply';
import { DEFAULT_MODEL, type RequestFn } from '../core/claude';
import type { Named, Snapshot, TaskLike } from '../core/types';
import { checkProposal, type Expect } from './check';

interface Case {
  name: string;
  request: string;
  selection?: string[];
  expect: Expect;
}

interface CaseFile {
  today: string;
  projects: Named[];
  tags: Named[];
  tasks: (Partial<TaskLike> & { id: string; title: string })[];
  cases: Case[];
}

interface Outcome {
  name: string;
  ms: number;
  isValid: boolean;
  /** The panel would have applied this answer without review (§ 8.1). */
  isAuto: boolean;
  problems: string[];
}

const fetchRequest: RequestFn = async (url, options) => {
  const res = await fetch(url, {
    method: String(options.method),
    headers: options.headers as Record<string, string>,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(Number(options.timeout)),
  });
  // Same "status N" shape as the host's errors, so errorMessage() reads both.
  if (!res.ok)
    throw new Error(`status ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const toSnapshot = (file: CaseFile, selectionIds: string[]): Snapshot => {
  const [y, m, d] = file.today.split('-').map(Number);
  return {
    tasks: file.tasks.map((t) => ({
      isDone: false,
      timeEstimate: 0,
      timeSpent: 0,
      projectId: 'p1',
      tagIds: [],
      subTaskIds: [],
      ...t,
    })),
    projects: file.projects,
    tags: file.tags,
    day: {
      todayStr: file.today,
      startOfNextDayDiffMs: 0,
      nowMs: new Date(y, m - 1, d, 9).getTime(),
    },
    selectionIds,
    currentTaskId: null,
  };
};

const runCase = async (
  file: CaseFile,
  c: Case,
  model: string,
  apiKey: string,
): Promise<Outcome> => {
  const started = Date.now();
  try {
    const { ctx, proposal, calls } = await ask(
      { request: fetchRequest, apiKey, model },
      toSnapshot(file, c.selection ?? []),
      c.request,
    );
    const ms = Date.now() - started;
    // Valid: readable on the first try and nothing dropped by the validator.
    const isValid = calls === 1 && !proposal.dropped.length && !proposal.isTooMany;
    return {
      name: c.name,
      ms,
      isValid,
      isAuto: canApplyWithoutReview(proposal, ctx),
      problems: [...proposal.dropped, ...checkProposal(proposal, c.expect)],
    };
  } catch (err) {
    return {
      name: c.name,
      ms: Date.now() - started,
      isValid: false,
      isAuto: false,
      problems: [String(err)],
    };
  }
};

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

const report = (model: string, outcomes: Outcome[]): void => {
  const ms = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const matched = outcomes.filter((o) => !o.problems.length).length;
  const valid = outcomes.filter((o) => o.isValid).length;
  console.log(
    `\n${model}: ${matched}/${outcomes.length} matched, ${valid} valid first try, ` +
      `p50 ${percentile(ms, 0.5)} ms, p90 ${percentile(ms, 0.9)} ms, ` +
      `${outcomes.filter((o) => o.isAuto && o.problems.length).length} unsafe`,
  );
  for (const o of outcomes.filter((x) => x.problems.length)) {
    // A wrong answer that skips the review is what the § 8.1 gate must rule out.
    const mark = o.isAuto ? '✗ UNSAFE' : '✗';
    console.log(`  ${mark} ${o.name}: ${o.problems.join('; ')}`);
  }
};

const main = async (): Promise<void> => {
  const file = JSON.parse(readFileSync(process.argv[2], 'utf8')) as CaseFile;
  const apiKey = process.env.ANTHROPIC_API_KEY as string;
  const models = (process.env.EVAL_MODELS || DEFAULT_MODEL)
    .split(',')
    .map((m) => m.trim());
  for (const model of models) {
    const outcomes: Outcome[] = [];
    // One at a time, so latencies aren't skewed by parallel load.
    for (const c of file.cases) outcomes.push(await runCase(file, c, model, apiKey));
    report(model, outcomes);
  }
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
