import { FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import pinnedTraces from './sync-fuzz-pinned-traces.json';
import { FUZZ_PROFILES } from './sync-fuzz-profiles';
import { FuzzFailure, FuzzResult, runFuzz } from './sync-fuzz-runner';
import { keepKarmaAlive, shrinkTrace } from './sync-fuzz-shrink';

/**
 * Random-seed entry point of the sync fuzz harness, for a manual bug hunt
 * (no CI job runs it; PRs get `npm run sync-fuzz:compare` instead). Like
 * the other `*.benchmark.ts` files it compiles with the specs but runs only
 * when named:
 *
 *   npm run test:file src/app/op-log/testing/integration/sync-fuzz/sync-fuzz-seeds.benchmark.ts
 *
 * Each seed runs STEPS random steps of one intent mix on three devices. A
 * seed fails on a failure signature that no pinned trace explains
 * (sync-fuzz-pinned-traces.json): a pin explains its primary signature, and
 * its other signatures only in a run that also shows its primary. The first
 * seed of each new signature is
 * then shrunk by delta debugging and printed, in its own spec, with its replay
 * results and a dump of the server log and every device's op log. Pin a trace
 * only once it fails 3 of 3 replays; an intermittent failure is a harness bug
 * first.
 *
 * FIRST_SEED moves daily; set it to a reported seed to replay that run.
 */
const FIRST_SEED = Math.floor(Date.now() / 86_400_000) * 1000;
const SEED_COUNT = 30;
const STEPS = 30;
const SHRINK_SLOTS = 12;
const SHRINK_RUNS = 100;
/** Set to report every failure signature, pinned or not. */
const IGNORE_PINNED = false;

/** Traces to replay with a full dump, e.g. while triaging a pin. */
const DEBUG_TRACES: [string, FuzzStep[]][] = [];

const PINS = pinnedTraces as unknown as { primary?: string; signatures: string[] }[];

/** The failures of a run that no pin explains. */
const newFailures = (failures: FuzzFailure[]): FuzzFailure[] => {
  if (IGNORE_PINNED) return failures;
  const shown = new Set(failures.map((f) => f.signature));
  const explained = new Set(
    PINS.filter((pin) => pin.primary && shown.has(pin.primary)).flatMap(
      (pin) => pin.signatures,
    ),
  );
  return failures.filter((f) => !explained.has(f.signature));
};

interface Sweep {
  results: Map<string, FuzzResult>;
  /** Each new signature with the first seed showing it, in order of discovery. */
  firstSeen: { signature: string; seed: string; steps: FuzzStep[]; count: number }[];
}

let sweep: Promise<Sweep> | undefined;

/** Runs every seed once, for whichever spec asks first. */
const runSweep = (): Promise<Sweep> =>
  (sweep ??= (async () => {
    const results = new Map<string, FuzzResult>();
    const firstSeen: Sweep['firstSeen'] = [];
    for (const [profile, weights] of Object.entries(FUZZ_PROFILES)) {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed++) {
        keepKarmaAlive(seed);
        const result = await runFuzz({ seed, stepCount: STEPS, weights });
        results.set(`${profile} ${seed}`, result);
        for (const { signature } of newFailures(result.failures)) {
          const seen = firstSeen.find((f) => f.signature === signature);
          if (seen) seen.count++;
          else {
            firstSeen.push({
              signature,
              seed: `${profile} ${seed}`,
              steps: result.steps,
              count: 1,
            });
          }
        }
      }
    }
    return { results, firstSeen };
  })());

/** The dump without device A's setup ops (clock A only, counters 1-9). */
const compactDump = (result: FuzzResult): string =>
  result.dump!.filter((line) => !/\{"fuzzDevA":[1-9]\}/.test(line)).join(' ¦ ');

describe('sync fuzz random seeds', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  for (const profile of Object.keys(FUZZ_PROFILES)) {
    for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed++) {
      it(`${profile} seed ${seed} fails only as the pinned traces do`, async () => {
        const result = (await runSweep()).results.get(`${profile} ${seed}`)!;
        expect(newFailures(result.failures))
          .withContext(`seed=${seed} trace=${JSON.stringify(result.steps)}`)
          .toEqual([]);
      }, 900_000);
    }
  }

  for (let slot = 0; slot < SHRINK_SLOTS; slot++) {
    it(`shrinks new failure signature ${slot}`, async () => {
      const found = (await runSweep()).firstSeen[slot];
      if (!found) return;
      const { signature, seed, steps, count } = found;
      const isSame = (result: FuzzResult): boolean =>
        result.failures.some((f) => f.signature === signature);
      const minimal = await shrinkTrace(steps, isSame, SHRINK_RUNS);
      const replays: string[] = [];
      for (let replay = 0; replay < 3; replay++) {
        replays.push(isSame(await runFuzz({ steps: minimal })) ? 'fail' : 'pass');
      }
      const debug = await runFuzz({ steps: minimal, debug: true });
      fail(
        `SHRUNK ${signature} seeds=${count}/${SEED_COUNT * Object.keys(FUZZ_PROFILES).length} ` +
          `first=${seed} replays=${replays.join(',')} trace=${JSON.stringify(minimal)} ` +
          `failures=${JSON.stringify(debug.failures)} ` +
          `rejections=${JSON.stringify(debug.rejections)} DUMP ${compactDump(debug)}`,
      );
    }, 900_000);
  }

  for (const [name, steps] of DEBUG_TRACES) {
    it(`dumps the debug trace ${name}`, async () => {
      const result = await runFuzz({ steps, debug: true });
      fail(
        `DUMP ${name} failures=${JSON.stringify(result.failures)} ` +
          `rejections=${JSON.stringify(result.rejections)} ¦ ${compactDump(result)}`,
      );
    }, 120_000);
  }
});
