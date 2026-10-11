export const meta = {
  name: 'issue-burndown',
  description:
    'Triage, reproduce, fix and ship open bugs per the bug burn-down runbook copied into the run dir',
  whenToUse:
    'Unattended bug burn-down. args: {baseSha, runDir, mainDir, issues: [numbers], only?, skip?, ship?, reproSlots?, fixPorts?, shipPort?}',
  phases: [
    { title: 'Triage', detail: 'one agent per issue, read-only' },
    { title: 'Route', detail: 'finalize issues that skip reproduction' },
    { title: 'Reproduce', detail: 'failing or confirming test on BASE_SHA' },
    { title: 'Fix', detail: 'leanest fix for easy candidates' },
    { title: 'Verify', detail: 'mechanical verifier and adversarial reviewer' },
    { title: 'Ship', detail: 'draft PR, cgcf until ready, mark ready' },
    { title: 'Finalize', detail: 'push repro branch, write final.json' },
    { title: 'Decide', detail: 'decision list, batch actions, summary' },
  ],
};

// Stage instructions live in the runbook copy in the run dir; this script only
// orchestrates and routes.
const A = args || {};
const RUN = A.runDir;
const MAIN = A.mainDir;
const BASE = A.baseSha;
if (!BASE || !RUN || !MAIN)
  throw new Error('args.baseSha, runDir and mainDir are required');
if (!RUN.startsWith('/') || !MAIN.startsWith('/')) {
  throw new Error('runDir and mainDir must be absolute paths');
}
const DOC = `${RUN}/runbook.md`;
const SHIP_PRS = A.ship !== false;
const SUB = { model: 'opus', effort: 'medium' };
const MAX_PROD_FILES = 5;
const MAX_PROD_LINES = 120;

const NUM = { type: 'integer' };
const STR = { type: 'string' };
const BOOL = { type: 'boolean' };
const OPT_STR = { type: ['string', 'null'] };
const NUMS = { type: 'array', items: NUM };
const enumOf = (...values) => ({ enum: values });
const obj = (properties, required) => ({
  type: 'object',
  properties,
  required: required || Object.keys(properties),
});

const TRIAGE = obj({
  number: NUM,
  kind: enumOf('bug', 'feature', 'tracker', 'question', 'unclear'),
  fixStatus: enumOf('no', 'released', 'unreleased', 'partial', 'likely', 'superseded'),
  fixCommit: OPT_STR,
  fixVersion: OPT_STR,
  regressionIn: OPT_STR,
  existingWork: obj({
    openPrs: NUMS,
    claimedBy: OPT_STR,
    maintainerAsked: BOOL,
    maintainerRuling: OPT_STR,
  }),
  duplicates: NUMS,
  related: NUMS,
  dupSearch: enumOf('done', 'partial'),
  earnsPlace: enumOf('yes', 'no', 'unclear', 'n/a'),
  earnsPlaceReason: STR,
  area: STR,
  platforms: { type: 'array', items: STR },
  sync: BOOL,
  userReported: BOOL,
  platformSpecific: BOOL,
  harness: enumOf('unit', 'unit-tz-la', 'e2e', 'e2e-sync', 'none', 'unknown'),
  clarity: enumOf('clear', 'ok', 'missing-steps'),
  evidenceUnreadable: BOOL,
  needsDecision: BOOL,
  decisionQuestion: OPT_STR,
  harm: { type: 'integer', minimum: 1, maximum: 5 },
  reach: { type: 'integer', minimum: 1, maximum: 3 },
  demand: NUM,
  rootCauseHypothesis: OPT_STR,
  fixProposal: OPT_STR,
  summary: obj({ expected: STR, actual: STR, steps: STR, environment: STR }),
  proposedAction: enumOf(
    'close-fixed',
    'close-after-release',
    'close-dup',
    'close-not-planned',
    'close-stale',
    'needs-info',
    'set-type-bug',
    'set-type-feature',
    'none',
  ),
  needsInfoDraft: OPT_STR,
  notes: STR,
});

const REPRO = obj({
  number: NUM,
  status: enumOf('reproduced', 'passes-on-base', 'not-reproduced', 'not-attempted'),
  testFile: OPT_STR,
  commit: OPT_STR,
  output: STR,
  notes: STR,
});

const FIX = obj({
  number: NUM,
  status: enumOf('fixed', 'needs-decision', 'failed'),
  branch: OPT_STR,
  commit: OPT_STR,
  rootCause: STR,
  reason: STR,
});

const MECHANICAL = obj({
  pass: BOOL,
  failsAtRepro: BOOL,
  passesAtFix: BOOL,
  checksPass: BOOL,
  testFilesUnchanged: BOOL,
  prodFiles: NUM,
  prodLines: NUM,
  touchesProtected: BOOL,
  touched: { type: 'array', items: STR },
  reason: STR,
});

const REVIEW = obj({ pass: BOOL, fixable: BOOL, reason: STR });

const FINAL = obj({
  number: NUM,
  route: enumOf('shipped', 'ready-for-cgcf', 'decision', 'batch-action', 'summary'),
  branch: OPT_STR,
  prUrl: OPT_STR,
  reason: STR,
  decisionEntry: OPT_STR,
  batchLines: { type: 'array', items: STR },
});

const DECIDE = obj({
  decisions: NUM,
  batchActions: NUM,
  shipped: NUM,
  summaryRows: NUM,
  notes: STR,
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
  `Issue ${n}. BASE_SHA=${BASE}. RUN=${RUN}. MAIN=${MAIN}. Runbook: ${DOC}.\n`;
const task = (n, stage, file, extra) =>
  header(n) +
  `Follow "${stage}" and "Ground rules" in the runbook. ${extra || ''}\n` +
  `Write your record to ${RUN}/issues/${n}/${file}.json and return the same object.`;
const records = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n');

// ------------------------------------------------------------------ Stage 1
const skip = new Set(A.skip || []);
const all = (A.only || A.issues || []).filter((n) => !skip.has(n));
if (A.only) log(`Pilot on ${all.length} hand-picked issues`);
if (skip.size) log(`Skipping ${skip.size} issues that already have a final.json`);
if (!SHIP_PRS) log('ship: false, verified fixes stop at a pushed branch');

const triageResults = await parallel(
  all.map(
    (n) => () =>
      agent(
        task(
          n,
          'Stage 1 — Triage (one issue per agent, main checkout, read-only)',
          'triage',
        ),
        {
          ...SUB,
          phase: 'Triage',
          label: `triage ${n}`,
          schema: TRIAGE,
        },
      ),
  ),
);
const triaged = triageResults.filter(Boolean);
const failedTriage = all.filter((n, i) => !triageResults[i]);
if (failedTriage.length) log(`Triage failed for ${failedTriage.join(', ')}`);

// ------------------------------------------------------------------ Stage 2
const byNumber = new Map(triaged.map((t) => [t.number, t]));
const parent = new Map(triaged.map((t) => [t.number, t.number]));
const find = (n) => (parent.get(n) === n ? n : find(parent.get(n)));
for (const t of triaged) {
  for (const d of t.duplicates || []) {
    if (parent.has(d)) parent.set(find(d), find(t.number));
  }
}
const clarityRank = { clear: 0, ok: 1, 'missing-steps': 2 };
const better = (a, b) =>
  clarityRank[a.clarity] - clarityRank[b.clarity] ||
  (a.kind === 'bug' ? 0 : 1) - (b.kind === 'bug' ? 0 : 1) ||
  a.number - b.number;
const groups = new Map();
for (const t of triaged) {
  const root = find(t.number);
  groups.set(root, [...(groups.get(root) || []), t]);
}
const canonical = [];
const duplicateOf = [];
const bigGroups = [];
for (const members of groups.values()) {
  const sorted = [...members].sort(better);
  canonical.push(sorted[0]);
  for (const m of sorted.slice(1))
    duplicateOf.push({ number: m.number, canonical: sorted[0].number });
  if (members.length >= 3) bigGroups.push(members.map((m) => m.number));
}

function route(t) {
  const w = t.existingWork || {};
  if (t.fixStatus === 'released') return 'batch:close-fixed';
  if (t.fixStatus === 'unreleased') return 'batch:close-after-release';
  if (t.fixStatus === 'likely') return 'stage3:confirm';
  if ((w.openPrs || []).length || w.claimedBy) return 'decision:existing-work';
  if (w.maintainerAsked) return 'summary:awaiting-reporter';
  if (t.evidenceUnreadable) return 'decision:evidence-unreadable';
  if (t.clarity === 'missing-steps') return 'batch:needs-info';
  if (t.kind === 'feature' && t.earnsPlace === 'no') return 'batch:close-not-planned';
  if (t.kind !== 'bug') return 'decision:not-a-bug';
  if (t.proposedAction === 'close-stale') return 'batch:close-stale';
  if (t.sync && !t.userReported) {
    return t.harm >= 4 || t.regressionIn === 'unreleased'
      ? 'decision:sync-rule-15'
      : 'summary:sync-no-action';
  }
  if (t.platformSpecific) return 'decision:platform';
  if (t.sync) return 'stage3:sync';
  if (t.needsDecision) return 'stage3:decision';
  if (['unit', 'unit-tz-la', 'e2e'].includes(t.harness)) return 'stage3:fix';
  return 'decision:no-harness';
}

const routes = {};
for (const d of duplicateOf) routes[d.number] = 'batch:close-dup';
for (const t of canonical) routes[t.number] = route(t);
for (const n of failedTriage) routes[n] = 'summary:triage-failed';

const priority = (a, b) => b.harm * b.reach - a.harm * a.reach || b.demand - a.demand;
const toReproduce = canonical
  .filter((t) => routes[t.number].startsWith('stage3:'))
  .sort(priority);
const directly = triaged.filter((t) => !routes[t.number].startsWith('stage3:'));
log(
  `${duplicateOf.length} duplicates; ${toReproduce.length} to reproduction; ` +
    `${directly.length} routed directly`,
);

// Finalize issues that never reach Stage 3, so each one ends with final.json.
const routedDirectly = parallel(
  directly.map(
    (t) => () =>
      agent(
        header(t.number) +
          `Follow "Stage 6 — Ship or finalize", the finalize part, for an issue that skips reproduction.\n` +
          `Route: ${routes[t.number]}` +
          (routes[t.number] === 'batch:close-dup'
            ? ` (canonical issue ${duplicateOf.find((d) => d.number === t.number).canonical})`
            : '') +
          `\nTriage record: ${RUN}/issues/${t.number}/triage.json. Push nothing.\n` +
          `Write ${RUN}/issues/${t.number}/final.json and return the same object.`,
        { ...SUB, phase: 'Route', label: `route ${t.number}`, schema: FINAL },
      ),
  ),
);

// ------------------------------------------------------------- Stages 3-6
const reproPool = pool(Array.from({ length: A.reproSlots || 3 }, (_, i) => i));
const syncPool = pool([0]);
const fixPool = pool(A.fixPorts || [4300, 4301]);
const shipPool = pool([A.shipPort || 4310]);

const withinLimits = (m) =>
  m.prodFiles <= MAX_PROD_FILES && m.prodLines <= MAX_PROD_LINES && !m.touchesProtected;

async function verify(t, repro, fix, attempt) {
  const stage = 'Stage 5 — Verify (two agents, fresh worktree each)';
  const context = `\nRecords:\n${records(t, repro, fix)}`;
  const runMechanical = () =>
    fixPool((port) =>
      agent(
        task(
          t.number,
          stage,
          `verify-mechanical-${attempt}`,
          `You are the mechanical verifier. Repro commit ${repro.commit}, fix commit ${fix.commit}. Your port: ${port}.` +
            context,
        ),
        {
          ...SUB,
          phase: 'Verify',
          label: `verify ${t.number}`,
          isolation: 'worktree',
          schema: MECHANICAL,
        },
      ),
    );
  const runReview = () =>
    agent(
      task(
        t.number,
        stage,
        `verify-review-${attempt}`,
        `You are the adversarial reviewer. Branch ${fix.branch}. Read the diff and code; do not build.` +
          context,
      ),
      {
        ...SUB,
        phase: 'Verify',
        label: `review ${t.number}`,
        isolation: 'worktree',
        schema: REVIEW,
      },
    );
  let [mech, review] = await parallel([runMechanical, runReview]);
  if (!mech) mech = await runMechanical();
  if (!review) review = await runReview();
  return { mech, review };
}

async function fixAndVerify(t, repro) {
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const fix = await fixPool((port) =>
      agent(
        task(
          t.number,
          'Stage 4 — Fix (worktree, easy candidates only)',
          `fix-${attempt}`,
          `Start from repro commit ${repro.commit}. Your port: ${port}.` +
            (feedback ? `\nThe previous attempt was rejected: ${feedback}` : '') +
            `\nRecords:\n${records(t, repro)}`,
        ),
        {
          ...SUB,
          phase: 'Fix',
          label: `fix ${t.number} (${attempt})`,
          isolation: 'worktree',
          schema: FIX,
        },
      ),
    );
    if (!fix || fix.status !== 'fixed')
      return { fix, reason: fix ? fix.reason : 'fix agent died' };

    const { mech, review } = await verify(t, repro, fix, attempt);
    if (!mech || !review) return { fix, reason: 'a verifier died twice' };
    if (!withinLimits(mech))
      return { fix, mech, reason: 'exceeds the easy-lane limits as measured' };
    if (!mech.testFilesUnchanged)
      return { fix, mech, reason: 'the fix commit changed test files' };
    if (mech.pass && review.pass) return { fix, mech, review, passed: true };
    feedback = [mech.pass ? '' : mech.reason, review.pass ? '' : review.reason]
      .filter(Boolean)
      .join(' | ');
    if (!review.pass && !review.fixable) return { fix, mech, review, reason: feedback };
  }
  return { reason: `rejected twice: ${feedback}` };
}

const reproduce = (t) => {
  const r = routes[t.number];
  const mode =
    r === 'stage3:sync'
      ? 'Use the sync slot.'
      : r === 'stage3:confirm'
        ? 'Confirm mode: fixStatus is likely; the test is expected to pass.'
        : `Harness: ${t.harness}.`;
  return (r === 'stage3:sync' ? syncPool : reproPool)(() =>
    agent(
      task(
        t.number,
        'Stage 3 — Reproduce (worktree on `BASE_SHA`)',
        'repro',
        `${mode}\nTriage record:\n${records(t)}`,
      ),
      {
        ...SUB,
        phase: 'Reproduce',
        label: `repro ${t.number}`,
        isolation: 'worktree',
        schema: REPRO,
      },
    ),
  );
};

const outcomes = await pipeline(toReproduce, reproduce, async (repro, t) => {
  const r = routes[t.number];
  const fixable =
    repro &&
    repro.status === 'reproduced' &&
    repro.commit &&
    (r === 'stage3:fix' ||
      (r === 'stage3:confirm' && ['unit', 'unit-tz-la', 'e2e'].includes(t.harness)));
  const result = fixable
    ? await fixAndVerify(t, repro)
    : { reason: repro ? `repro ${repro.status}; route ${r}` : 'repro agent died' };

  const shipping = Boolean(result.passed);
  const shipStep = (port) =>
    agent(
      header(t.number) +
        (shipping
          ? `Follow "Stage 6 — Ship or finalize", the ship part. Branch ${result.fix.branch}.` +
            (SHIP_PRS ? ` Your port: ${port}.` : ' ship is false: push the branch only.')
          : `Follow "Stage 6 — Ship or finalize", the finalize part. Route ${r}.`) +
        `\nRecords:\n${records(t, repro, result)}\n` +
        `Write ${RUN}/issues/${t.number}/final.json and return the same object.`,
      {
        ...SUB,
        phase: shipping ? 'Ship' : 'Finalize',
        label: `${shipping ? 'ship' : 'finalize'} ${t.number}`,
        schema: FINAL,
        ...(shipping && SHIP_PRS
          ? { isolation: 'worktree', agentType: 'general-purpose' }
          : {}),
      },
    );
  const final = shipping && SHIP_PRS ? await shipPool(shipStep) : await shipStep(null);
  return { number: t.number, repro: repro && repro.status, final };
});

const direct = (await routedDirectly).filter(Boolean);
const done = outcomes.filter(Boolean);
const shipped = done.filter(
  (o) => o.final && ['shipped', 'ready-for-cgcf'].includes(o.final.route),
);
log(
  `${shipped.length} fixes ${SHIP_PRS ? 'shipped' : 'pushed'}; writing the decision list`,
);

// ------------------------------------------------------------------ Stage 7
const decided = await agent(
  `RUN=${RUN}. BASE_SHA=${BASE}. Runbook: ${DOC}.\n` +
    `Follow "Stage 7 — Decision list (orchestrator, \`xhigh\`)". Read every final.json under ${RUN}/issues/.\n` +
    `Issues in this run: ${JSON.stringify(all)}\n` +
    `Routes: ${JSON.stringify(routes)}\n` +
    `Pipeline outcomes: ${JSON.stringify(done.map((o) => ({ number: o.number, repro: o.repro, route: o.final && o.final.route })))}\n` +
    `Duplicate groups of three or more to re-check: ${JSON.stringify(bigGroups)}\n` +
    `Issues with no final.json because an agent died: ${JSON.stringify(
      all.filter(
        (n) =>
          !direct.some((d) => d.number === n) &&
          !done.some((o) => o.number === n && o.final),
      ),
    )}\n` +
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
  issues: all.length,
  failedTriage,
  duplicates: duplicateOf.length,
  reproduced: done.filter((o) => o.repro === 'reproduced').length,
  shipped: shipped.map((o) => ({
    number: o.number,
    pr: o.final.prUrl,
    branch: o.final.branch,
  })),
  decided,
};
