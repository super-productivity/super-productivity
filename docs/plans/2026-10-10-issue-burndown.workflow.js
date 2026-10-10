export const meta = {
  name: 'issue-burndown',
  description:
    'Triage, reproduce, fix and ship open bugs per docs/plans/2026-10-10-issue-burndown.md',
  whenToUse:
    'Unattended bug burn-down. args: {baseSha, issues, runDir?, limit?, ship?, reproSlots?, fixPorts?}',
  phases: [
    { title: 'Triage', detail: 'one agent per issue' },
    { title: 'Reproduce', detail: 'failing test on BASE_SHA, worktree per issue' },
    { title: 'Fix', detail: 'leanest fix for easy candidates' },
    { title: 'Verify', detail: 'mechanical verifier and adversarial reviewer' },
    { title: 'Ship', detail: 'push, cgcf until ready, ready-for-review PR' },
    { title: 'Finalize', detail: 'push repro branch, write final.json' },
    { title: 'Decide', detail: 'ordered decision list and batch actions' },
  ],
};

// All stage instructions live in the runbook; this script only orchestrates.
const DOC = 'docs/plans/2026-10-10-issue-burndown.md';
const A = args || {};
const RUN = A.runDir || '.tmp/issue-burndown';
const SHIP_PRS = A.ship !== false;
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
  platformSpecific: BOOL,
  reproducibleHere: BOOL,
  clarity: { enum: ['clear', 'ok', 'missing-steps'] },
  needsDecision: BOOL,
  decisionQuestion: STR,
  harm: { type: 'integer', minimum: 1, maximum: 5 },
  reach: { type: 'integer', minimum: 1, maximum: 3 },
  demand: NUM,
  rootCauseHypothesis: STR,
  fixProposal: STR,
  summary: obj({ expected: STR, actual: STR, steps: STR, environment: STR }),
  needsInfoDraft: STR,
});

const REPRO = obj({
  number: NUM,
  status: { enum: ['reproduced', 'not-reproduced', 'not-attempted'] },
  testType: { enum: ['unit', 'e2e', 'e2e-sync', 'none'] },
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
  route: { enum: ['shipped', 'ready-for-cgcf', 'decision', 'batch-action', 'skipped'] },
  branch: STR,
  prUrl: STR,
  reason: STR,
});

const DECIDE = obj({
  decisions: NUM,
  batchActions: NUM,
  shipped: NUM,
  summary: STR,
});

// Caps concurrent use of a scarce resource (a slot, a port) across pipeline
// items; the workflow's own cap only limits agents overall.
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

if (!A.baseSha)
  throw new Error('args.baseSha is required (see the runbook prerequisites)');
const all = A.issues || [];
const issues = A.limit ? all.slice(0, A.limit) : all;
if (issues.length < all.length) log(`Pilot: ${issues.length} of ${all.length} issues`);
if (!SHIP_PRS) log('ship: false, verified fixes stop at a pushed branch');

// Stage 1
const triaged = (
  await parallel(
    issues.map(
      (i) => () =>
        agent(task(i.number, 'Stage 1 — Triage (one issue per agent)', 'triage'), {
          ...SUB,
          phase: 'Triage',
          label: `triage #${i.number}`,
          schema: TRIAGE,
        }),
    ),
  )
).filter(Boolean);
log(`Triaged ${triaged.length} of ${issues.length}`);

// Stage 2: union duplicate pairs; the oldest open issue is canonical.
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

const fixed = (t) => t.alreadyFixed && t.alreadyFixed.fixed;
const syncRepro = (t) =>
  t.kind === 'bug' &&
  t.sync &&
  t.userReported &&
  !fixed(t) &&
  t.clarity !== 'missing-steps';
const webRepro = (t) =>
  t.kind === 'bug' &&
  !t.sync &&
  !t.platformSpecific &&
  t.reproducibleHere &&
  !fixed(t) &&
  t.clarity !== 'missing-steps';
const priority = (t) => t.harm * t.reach * 100 + (t.demand || 0);
const toReproduce = canonical
  .filter((t) => syncRepro(t) || webRepro(t))
  .sort((a, b) => priority(b) - priority(a));
log(
  `${duplicateOf.length} duplicates folded; ${toReproduce.length} issues go to reproduction ` +
    `(${toReproduce.filter((t) => t.sync).length} sync); ` +
    `${canonical.length - toReproduce.length} go straight to the decision or batch lists`,
);

const reproPool = pool(Array.from({ length: A.reproSlots || 3 }, (_, i) => i));
const syncPool = pool([0]);
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
          'Stage 4 — Fix (easy candidates only, worktree)',
          `fix-${attempt}`,
          `Start from branch repro/issue-${t.number}. Your E2E port: ${port}.` +
            (feedback ? `\nThe previous attempt was rejected: ${feedback}` : ''),
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
    if (!fix || fix.status !== 'fixed') {
      return { fix, reason: fix ? fix.reason : 'fix agent died' };
    }
    if (!withinLimits(fix)) return { fix, reason: 'exceeds easy-lane limits' };

    const stage = 'Stage 5 — Verify (two independent agents, fresh worktree each)';
    const verdicts = (
      await parallel([
        () =>
          fixPool((port) =>
            agent(
              task(
                t.number,
                stage,
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
              stage,
              `verify-review-${attempt}`,
              `You are the adversarial reviewer. Branch: ${fix.branch}. Read the diff and code; do not build.`,
            ),
            {
              ...SUB,
              phase: 'Verify',
              label: `review #${t.number}`,
              isolation: 'worktree',
              schema: VERDICT,
            },
          ),
      ])
    ).filter(Boolean);
    if (verdicts.length === 2 && verdicts.every((v) => v.pass)) {
      return { fix, verdicts, passed: true };
    }
    feedback =
      verdicts
        .filter((v) => !v.pass)
        .map((v) => v.reason)
        .join(' | ') || 'a verifier died';
    const retryable = verdicts.length === 2 && verdicts.every((v) => v.pass || v.fixable);
    if (!retryable) return { fix, verdicts, reason: feedback };
  }
  return { reason: `rejected twice: ${feedback}` };
}

// Stages 3–6, item by item in priority order.
const outcomes = await pipeline(
  toReproduce,
  (t) =>
    (t.sync ? syncPool : reproPool)((slot) =>
      agent(
        task(
          t.number,
          'Stage 3 — Reproduce (one issue per agent, worktree)',
          'repro',
          t.sync
            ? 'Use the sync slot: provider E2E scripts, never fix.'
            : `Reproduce slot ${slot}; use the shared app at http://localhost:4242.`,
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
    const easy = repro && repro.status === 'reproduced' && !t.sync && !t.needsDecision;
    const result = easy
      ? await fixAndVerify(t)
      : {
          reason: t.sync
            ? 'sync: reproduce only'
            : t.needsDecision
              ? 'needs a product decision'
              : 'not reproduced',
        };
    const ship = result.passed;
    const final = await (ship ? fixPool : (fn) => fn(null))((port) =>
      agent(
        header(t.number) +
          (ship
            ? `Follow "Stage 6 — Ship or finalize", verified fix. Branch: ${result.fix.branch}. ` +
              (SHIP_PRS ? `Your E2E port: ${port}.` : 'ship is false: push only.')
            : `Follow "Stage 6 — Ship or finalize", the finalize part.`) +
          `\nRepro: ${JSON.stringify(repro)}\nFix and verification: ${JSON.stringify(result)}\n` +
          `Write ${RUN}/issues/${t.number}/final.json and return the same object.`,
        {
          ...SUB,
          phase: ship ? 'Ship' : 'Finalize',
          label: `${ship ? 'ship' : 'finalize'} #${t.number}`,
          ...(ship && SHIP_PRS ? { isolation: 'worktree' } : {}),
          schema: FINAL,
        },
      ),
    );
    return { number: t.number, repro: repro && repro.status, final };
  },
);

const done = outcomes.filter(Boolean);
const shipped = done.filter(
  (o) => o.final && ['shipped', 'ready-for-cgcf'].includes(o.final.route),
);
log(
  `${shipped.length} fixes ${SHIP_PRS ? 'shipped' : 'pushed'}; building the decision list`,
);

// Stage 7
const decided = await agent(
  `Run dir: ${RUN}. Runbook: ${DOC}. BASE_SHA=${A.baseSha}.\n` +
    `Follow "Stage 7 — Decisions list (orchestrator, \`xhigh\`)". Read every record under ${RUN}/issues/.\n` +
    `Issues in scope: ${JSON.stringify(issues.map((i) => i.number))}\n` +
    `Duplicates folded by the script (issue -> canonical): ${JSON.stringify(duplicateOf)}\n` +
    `Write decisions.md, batch-actions.md and summary.md in ${RUN}, then return the counts.`,
  {
    model: 'opus',
    effort: 'xhigh',
    phase: 'Decide',
    label: 'decision list',
    schema: DECIDE,
  },
);

return {
  triaged: triaged.length,
  duplicates: duplicateOf.length,
  reproduced: done.filter((o) => o.repro === 'reproduced').length,
  shipped: shipped.map((o) => ({
    number: o.number,
    pr: o.final.prUrl,
    branch: o.final.branch,
  })),
  decided,
};
