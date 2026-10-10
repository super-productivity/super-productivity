export const meta = {
  name: 'issue-burndown',
  description:
    'Screen, triage, reproduce and fix open issues per docs/plans/2026-10-10-issue-burndown.md',
  whenToUse:
    'Unattended issue burn-down. args: {baseSha, issues, runDir?, limit?, reproSlots?, fixPorts?} or {ship: true, ready: [{number, branch}]}',
  phases: [
    { title: 'Screen', detail: 'classify issues in batches of 25' },
    { title: 'Triage', detail: 'one agent per bug or feature candidate' },
    { title: 'Reproduce', detail: 'failing test on BASE_SHA, worktree per issue' },
    { title: 'Fix', detail: 'leanest fix for easy candidates' },
    { title: 'Verify', detail: 'mechanical verifier and adversarial reviewer' },
    { title: 'Finalize', detail: 'push the branch, write final.json' },
    { title: 'Decide', detail: 'ordered decision list and batch actions' },
    { title: 'Ship', detail: 'cgcf until ready, then PR (cgcf environment only)' },
  ],
};

// All stage instructions live in the runbook; this script only orchestrates.
const DOC = 'docs/plans/2026-10-10-issue-burndown.md';
const A = args || {};
const RUN = A.runDir || '.tmp/issue-burndown';
const SUB = { model: 'opus', effort: 'medium' };
const MAX_PROD_FILES = 5;
const MAX_PROD_LINES = 120;

const NUM = { type: 'integer' };
const STR = { type: 'string' };
const BOOL = { type: 'boolean' };
const obj = (properties, required) => ({
  type: 'object',
  properties,
  required: required || Object.keys(properties),
});

const SCREEN = obj({
  issues: {
    type: 'array',
    items: obj({
      number: NUM,
      kind: { enum: ['bug', 'feature', 'tracker', 'question', 'unclear'] },
      note: STR,
    }),
  },
});

const TRIAGE = obj({
  number: NUM,
  kind: { enum: ['bug', 'feature', 'tracker', 'question', 'unclear'] },
  alreadyFixed: obj({ fixed: BOOL, commit: STR, version: STR }),
  duplicates: { type: 'array', items: NUM },
  earnsPlace: { enum: ['yes', 'no', 'unclear', 'n/a'] },
  earnsPlaceReason: STR,
  area: STR,
  platforms: { type: 'array', items: STR },
  sync: BOOL,
  userReported: BOOL,
  reproducibleHere: BOOL,
  notReproducibleReason: STR,
  clarity: { enum: ['clear', 'ok', 'missing-steps'] },
  needsDecision: BOOL,
  decisionQuestion: STR,
  harm: { type: 'integer', minimum: 1, maximum: 5 },
  reach: { type: 'integer', minimum: 1, maximum: 3 },
  demand: NUM,
  summary: obj({ expected: STR, actual: STR, steps: STR, environment: STR }),
  needsInfoDraft: STR,
});

const REPRO = obj({
  number: NUM,
  status: { enum: ['reproduced', 'not-reproduced', 'not-attempted'] },
  testType: { enum: ['unit', 'e2e', 'none'] },
  testFile: STR,
  commit: STR,
  failingAssertion: STR,
  notes: STR,
});

const FIX = obj({
  number: NUM,
  status: { enum: ['fixed', 'needs-decision', 'failed'] },
  branch: STR,
  commit: STR,
  rootCause: STR,
  prodFiles: NUM,
  prodLines: NUM,
  protectedSurfaces: { type: 'array', items: STR },
  reason: STR,
});

const VERDICT = obj({
  pass: BOOL,
  fixable: BOOL,
  reason: STR,
  commands: { type: 'array', items: STR },
});

const FINAL = obj({
  number: NUM,
  route: { enum: ['ready-for-cgcf', 'decision', 'batch-action', 'skipped'] },
  branch: STR,
  reason: STR,
});

const DECIDE = obj({
  decisions: NUM,
  batchActions: NUM,
  readyForCgcf: NUM,
  summary: STR,
});

const SHIP = obj({
  number: NUM,
  status: { enum: ['pr-opened', 'moved-to-decisions'] },
  prUrl: STR,
  reason: STR,
});

// Caps concurrent use of a scarce resource (a repro slot, a fix port) across
// pipeline items; the workflow's own cap only limits agents overall.
function pool(resources) {
  const free = [...resources];
  const waiting = [];
  const release = (r) => {
    const next = waiting.shift();
    if (next) next(r);
    else free.push(r);
  };
  return async (fn) => {
    const r = free.length ? free.pop() : await new Promise((res) => waiting.push(res));
    try {
      return await fn(r);
    } finally {
      release(r);
    }
  };
}

const header = (n) =>
  `Issue #${n}. BASE_SHA=${A.baseSha}. Run dir: ${RUN}. Runbook: ${DOC}.\n`;
const task = (n, stage, file, extra) =>
  header(n) +
  `Follow "${stage}" and "Ground rules" in the runbook. ${extra || ''}\n` +
  `Write your record to ${RUN}/issues/${n}/${file}.json and return the same object.`;

// ---------------------------------------------------------------- Ship mode
if (A.ship) {
  const ready = A.ready || [];
  const fixPool = pool(A.fixPorts || [4300, 4301]);
  log(`Shipping ${ready.length} branches through cgcf`);
  const shipped = await pipeline(ready, (item) =>
    fixPool((port) =>
      agent(
        task(
          item.number,
          'Stage 7 — Ship (`cgcf` environment only)',
          'ship',
          `Branch: ${item.branch}. Your E2E port: ${port}.`,
        ),
        {
          ...SUB,
          phase: 'Ship',
          label: `ship #${item.number}`,
          isolation: 'worktree',
          schema: SHIP,
        },
      ),
    ),
  );
  return { shipped: shipped.filter(Boolean) };
}

// ---------------------------------------------------------------- Main run
if (!A.baseSha)
  throw new Error('args.baseSha is required (see the runbook prerequisites)');
const all = A.issues || [];
const issues = A.limit ? all.slice(0, A.limit) : all;
if (issues.length < all.length) log(`Pilot: ${issues.length} of ${all.length} issues`);

const chunks = [];
for (let i = 0; i < issues.length; i += 25) chunks.push(issues.slice(i, i + 25));

const screened = [];
const triaged = (
  await pipeline(
    chunks,
    (batch) =>
      agent(
        `Run dir: ${RUN}. Runbook: ${DOC}. BASE_SHA=${A.baseSha}.\n` +
          `Follow "Stage 1 — Screen" and "Ground rules". Read each issue with gh issue view.\n` +
          `Write one record per issue to ${RUN}/issues/<N>/screen.json and return all of them.\n` +
          batch.map((i) => `#${i.number} ${i.title}`).join('\n'),
        { ...SUB, phase: 'Screen', label: `screen #${batch[0].number}…`, schema: SCREEN },
      ),
    (screen) => {
      const list = (screen && screen.issues) || [];
      screened.push(...list);
      return parallel(
        list
          .filter((i) => i.kind === 'bug' || i.kind === 'feature')
          .map(
            (i) => () =>
              agent(task(i.number, 'Stage 2 — Triage (one issue per agent)', 'triage'), {
                ...SUB,
                phase: 'Triage',
                label: `triage #${i.number}`,
                schema: TRIAGE,
              }),
          ),
      );
    },
  )
)
  .flat()
  .filter(Boolean);
log(`Screened ${screened.length}, triaged ${triaged.length}`);

// Stage 3: union duplicate pairs among triaged issues; oldest open issue wins.
const parent = new Map(triaged.map((t) => [t.number, t.number]));
const find = (n) => (parent.get(n) === n ? n : find(parent.get(n)));
for (const t of triaged) {
  for (const d of t.duplicates || []) {
    if (!parent.has(d)) continue;
    const [a, b] = [find(t.number), find(d)];
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
}
const canonical = triaged.filter((t) => find(t.number) === t.number);
const duplicateOf = triaged
  .filter((t) => find(t.number) !== t.number)
  .map((t) => ({ number: t.number, canonical: find(t.number) }));
log(`${duplicateOf.length} duplicates folded into ${canonical.length} canonical issues`);

const priority = (t) => t.harm * t.reach * 100 + (t.demand || 0);
const toReproduce = canonical
  .filter(
    (t) =>
      t.kind === 'bug' &&
      !t.sync &&
      t.reproducibleHere &&
      t.clarity !== 'missing-steps' &&
      !(t.alreadyFixed && t.alreadyFixed.fixed),
  )
  .sort((a, b) => priority(b) - priority(a));
log(`${toReproduce.length} bugs go to reproduction; the rest go to the decision list`);

const reproPool = pool(Array.from({ length: A.reproSlots || 3 }, (_, i) => i));
const fixPool = pool(A.fixPorts || [4300, 4301]);

const withinLimits = (f) =>
  f.prodFiles <= MAX_PROD_FILES &&
  f.prodLines <= MAX_PROD_LINES &&
  (f.protectedSurfaces || []).length === 0;

async function fixAndVerify(t) {
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const fix = await fixPool((port) =>
      agent(
        task(
          t.number,
          'Stage 5 — Fix (easy candidates only, worktree)',
          `fix-${attempt}`,
          `Start from branch repro/issue-${t.number}. Your E2E port: ${port}.` +
            (feedback ? `\nPrevious attempt was rejected: ${feedback}` : ''),
        ),
        {
          ...SUB,
          phase: 'Fix',
          label: `fix #${t.number} (${attempt})`,
          isolation: 'worktree',
          schema: FIX,
        },
      ),
    );
    if (!fix || fix.status !== 'fixed')
      return { fix, verdicts: [], reason: fix ? fix.reason : 'fix agent died' };
    if (!withinLimits(fix))
      return { fix, verdicts: [], reason: 'exceeds easy-lane limits' };

    const verdicts = await parallel([
      () =>
        fixPool((port) =>
          agent(
            task(
              t.number,
              'Stage 6 — Verify (two independent agents, fresh worktree each)',
              `verify-mechanical-${attempt}`,
              `You are the mechanical verifier. Branch: ${fix.branch}. Your E2E port: ${port}.`,
            ),
            {
              ...SUB,
              phase: 'Verify',
              label: `verify #${t.number}`,
              isolation: 'worktree',
              schema: VERDICT,
            },
          ),
        ),
      () =>
        agent(
          task(
            t.number,
            'Stage 6 — Verify (two independent agents, fresh worktree each)',
            `verify-review-${attempt}`,
            `You are the adversarial reviewer. Branch: ${fix.branch}. Do not build or run E2E; read the diff and code.`,
          ),
          {
            ...SUB,
            phase: 'Verify',
            label: `review #${t.number}`,
            isolation: 'worktree',
            schema: VERDICT,
          },
        ),
    ]);
    const ok = verdicts.filter(Boolean);
    if (ok.length === 2 && ok.every((v) => v.pass))
      return { fix, verdicts: ok, passed: true };
    const fixable = ok.length === 2 && ok.every((v) => v.pass || v.fixable);
    feedback =
      ok
        .filter((v) => !v.pass)
        .map((v) => v.reason)
        .join(' | ') || 'a verifier died';
    if (!fixable) return { fix, verdicts: ok, reason: feedback };
  }
  return { reason: `rejected twice: ${feedback}` };
}

const outcomes = await pipeline(
  toReproduce,
  (t) =>
    reproPool((slot) =>
      agent(
        task(
          t.number,
          'Stage 4 — Reproduce (one issue per agent, worktree)',
          'repro',
          `Repro slot ${slot}; use the shared server at http://localhost:4242.`,
        ),
        {
          ...SUB,
          phase: 'Reproduce',
          label: `repro #${t.number}`,
          isolation: 'worktree',
          schema: REPRO,
        },
      ),
    ),
  async (repro, t) => {
    const fixable = repro && repro.status === 'reproduced' && !t.needsDecision;
    const result = fixable
      ? await fixAndVerify(t)
      : { reason: t.needsDecision ? 'needs a product decision' : 'not reproduced' };
    const final = await agent(
      header(t.number) +
        `Follow the finalize step at the end of "Stage 6 — Verify" in the runbook.\n` +
        `Repro: ${JSON.stringify(repro)}\nFix and verification: ${JSON.stringify(result)}\n` +
        `Write ${RUN}/issues/${t.number}/final.json and return the same object.`,
      { ...SUB, phase: 'Finalize', label: `finalize #${t.number}`, schema: FINAL },
    );
    return { number: t.number, repro: repro && repro.status, final };
  },
);

const done = outcomes.filter(Boolean);
const ready = done.filter((o) => o.final && o.final.route === 'ready-for-cgcf');
log(
  `${ready.length} fixes ready for cgcf, ${done.length - ready.length} reproduced or attempted issues need a decision`,
);

phase('Decide');
const decided = await agent(
  `Run dir: ${RUN}. Runbook: ${DOC}. BASE_SHA=${A.baseSha}.\n` +
    `Follow "Stage 6b — Decisions list (orchestrator, \`xhigh\`)". Read every record under ${RUN}/issues/.\n` +
    `Duplicates folded by the script (issue -> canonical): ${JSON.stringify(duplicateOf)}\n` +
    `Write decisions.md, batch-actions.md and ready-for-cgcf.md in ${RUN}, then return the counts.`,
  {
    model: 'opus',
    effort: 'xhigh',
    phase: 'Decide',
    label: 'decision list',
    schema: DECIDE,
  },
);

return {
  screened: screened.length,
  triaged: triaged.length,
  duplicates: duplicateOf.length,
  reproduced: done.filter((o) => o.repro === 'reproduced').length,
  readyForCgcf: ready.map((o) => ({ number: o.number, branch: o.final.branch })),
  decided,
};
