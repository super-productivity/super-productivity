import { FuzzStep } from './sync-fuzz-actions';
import { FileTransportOptions } from './sync-fuzz-file-transport';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import pinnedTraces from './sync-fuzz-pinned-traces.json';
import { FUZZ_PROFILES } from './sync-fuzz-profiles';
import { FuzzResult, runFuzz } from './sync-fuzz-runner';
import { keepKarmaAlive, shrinkTrace } from './sync-fuzz-shrink';
import {
  distinctTraces,
  formatShrunk,
  formatTriage,
  ShrunkTrace,
  triage,
  TriagePin,
  TriageRow,
  TriageRun,
} from './sync-fuzz-triage';

/**
 * Triage of a seed sweep: which failure signatures to read first, and how few
 * traces are behind them. Runs the same seeds on every transport, lists the
 * signatures (those some run shows as more than a list order first), shrinks
 * the first such run of each, and replays every distinct shrunk trace three
 * times per transport (sync-fuzz-triage.ts). Not a gate; runs only when named:
 *
 *   npm run quiet -- test:file src/app/op-log/testing/integration/sync-fuzz/sync-fuzz-triage.benchmark.ts
 *   rg -o 'SYNC_FUZZ_(TRIAGE|SHRUNK).*' <printed log path> | sort -u | tr '|' '\n'
 *
 * The results leave Karma as failure messages (console output is not
 * captured), so the nonzero exit is expected. Each is one line with `|`
 * between its rows: the reporter keeps five lines of a message.
 *
 * The seeds are the fixed ones of the signature report, so a table compares
 * with an earlier one; move FIRST_SEED for a fresh hunt.
 */
const FIRST_SEED = 20725000;
const SEED_COUNT = 30;
const STEPS = 30;
const SHRINK_RUNS = 100;
const REPLAYS = 3;

/**
 * `file` is the v2 single file. The split format (`{ split: true }`) gave the
 * same signatures when this was written; add it here to check that again.
 */
const TRANSPORTS: Record<string, FileTransportOptions | undefined> = {
  supersync: undefined,
  file: {},
};

const PINS = pinnedTraces as unknown as TriagePin[];

interface Sweep {
  rows: TriageRow[];
  steps: Map<string, FuzzStep[]>;
  /** Runs per transport that answered a data conflict dialog. */
  answered: Record<string, number>;
}

/** Runs every seed on every transport. */
const runSweep = async (): Promise<Sweep> => {
  const runs: TriageRun[] = [];
  const steps = new Map<string, FuzzStep[]>();
  const answered: Record<string, number> = {};
  for (const [transport, fileTransport] of Object.entries(TRANSPORTS)) {
    answered[transport] = 0;
    for (const [profile, weights] of Object.entries(FUZZ_PROFILES)) {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed++) {
        keepKarmaAlive(seed);
        const result = await runFuzz({ seed, stepCount: STEPS, weights, fileTransport });
        const name = `${profile}:${seed}`;
        runs.push({ transport, name, failures: result.failures });
        steps.set(`${transport} ${name}`, result.steps);
        if (result.answeredConflicts) answered[transport]++;
      }
    }
  }
  return { rows: triage(runs), steps, answered };
};

/** Shrinks the first more-than-order run of every candidate signature. */
const shrinkCandidates = async ({ rows, steps }: Sweep): Promise<ShrunkTrace[]> => {
  const shrunk: { signature: string; steps: FuzzStep[] }[] = [];
  for (const { signature, first } of rows) {
    if (!first) continue;
    // Not `orderOnly`: a list signature must stay more than order while it shrinks.
    const isSame = (result: FuzzResult): boolean =>
      result.failures.some((f) => f.signature === signature && !f.orderOnly);
    const minimal = await shrinkTrace(
      steps.get(`${first.transport} ${first.name}`)!,
      isSame,
      { maxRuns: SHRINK_RUNS, fileTransport: TRANSPORTS[first.transport] },
    );
    shrunk.push({ signature, steps: minimal });
  }
  return distinctTraces(shrunk);
};

/**
 * Replays a trace on every transport. A signature showing in fewer replays
 * than ran is a harness bug first; one showing on every transport points at
 * the core, on one at that transport.
 */
const replay = async (trace: ShrunkTrace): Promise<string> => {
  const replays: Record<string, string[][]> = {};
  for (const [transport, fileTransport] of Object.entries(TRANSPORTS)) {
    replays[transport] = [];
    for (let i = 0; i < REPLAYS; i++) {
      keepKarmaAlive(i);
      const result = await runFuzz({ steps: trace.steps, fileTransport });
      replays[transport].push(
        result.failures.map((f) => f.signature + (f.orderOnly ? ' (order)' : '')),
      );
    }
  }
  return formatShrunk(trace, replays, PINS);
};

describe('sync fuzz triage sweep', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('reports the triage table and the shrunk traces', async () => {
    const sweep = await runSweep();
    const table = [
      ...formatTriage(sweep.rows, Object.keys(TRANSPORTS)),
      // Each answer drops one side unjudged: many of them thin that column.
      `runs that answered a data conflict dialog: ${JSON.stringify(sweep.answered)}`,
    ];
    const lines: string[] = [];
    for (const trace of await shrinkCandidates(sweep)) lines.push(await replay(trace));
    fail(`SYNC_FUZZ_TRIAGE ${table.join('|')}`);
    fail(`SYNC_FUZZ_SHRUNK ${lines.join('|')}`);
  }, 7_200_000);
});
