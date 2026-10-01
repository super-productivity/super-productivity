import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { fuzzDay, FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import { FUZZ_PROFILES } from './sync-fuzz-profiles';
import { runFuzz } from './sync-fuzz-runner';
import { keepKarmaAlive } from './sync-fuzz-shrink';

/**
 * Every failure signature of a fixed seed sweep, with the seeds that show it,
 * pinned or not. `tools/sync-fuzz-compare.js` runs it on a branch and on its
 * base and fails on a seed that newly shows a signature; the random sweep in
 * sync-fuzz-seeds.benchmark.ts cannot see that, since a pin explains every
 * seed with its primary signature. Runs only when named, like the other
 * `*.benchmark.ts` files.
 *
 * Per seed it also reports what the comparison judges a newly failing seed
 * by: a hash of the executed steps, and the final field values the intents
 * write. The values are read from the store as the run leaves it (device C,
 * after the restart oracle restarted it last), not from the run's internals,
 * so a base whose runner predates this report still produces them. Archived
 * tasks are not in the store.
 *
 * The seeds are the ones #10382 measured with, so reports stay comparable.
 * The report leaves Karma as the failure message (console output is not
 * captured), between the markers the tool parses.
 */
const FIRST_SEED = 20725000;
const SEED_COUNT = 30;
const STEPS = 30;

const REPORT_START = 'SYNC_FUZZ_REPORT_START';
const REPORT_END = 'SYNC_FUZZ_REPORT_END';

interface Entities {
  ids: string[];
  entities: Record<string, Record<string, unknown> | undefined>;
}

/** The fields the intents write, per store slice, plus today's time and count. */
const FIELDS: [slice: string, type: string, fields: string[]][] = [
  ['tasks', 'task', ['title', 'notes', 'isDone', 'dueDay', 'timeSpentOnDay']],
  ['note', 'note', ['content', 'isPinnedToToday', 'isLock']],
  ['simpleCounter', 'habit', ['title', 'isEnabled', 'countOnDay']],
];

const finalValues = async (): Promise<Record<string, unknown>> => {
  const root = (await firstValueFrom(TestBed.inject(Store))) as Record<string, unknown>;
  const day = fuzzDay();
  const values: Record<string, unknown> = {};
  for (const [slice, type, fields] of FIELDS) {
    const state = root[slice] as Entities | undefined;
    for (const id of state?.ids ?? []) {
      const entity = state!.entities[id] ?? {};
      for (const field of fields) {
        const value = entity[field];
        values[`${type}:${id}.${field}`] =
          value && typeof value === 'object'
            ? (value as Record<string, unknown>)[day]
            : value;
      }
    }
  }
  return values;
};

/** A short, stable hash of the executed steps (FNV-1a). */
const stepsHash = (steps: FuzzStep[]): string => {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(steps)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return `${steps.length}:${(hash >>> 0).toString(16)}`;
};

describe('sync fuzz signature report', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('reports every signature with its seeds', async () => {
    const signatures: Record<string, string[]> = {};
    const runs: Record<string, { steps: string; values: Record<string, unknown> }> = {};
    for (const [profile, weights] of Object.entries(FUZZ_PROFILES)) {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed++) {
        keepKarmaAlive(seed);
        const { failures, steps } = await runFuzz({ seed, stepCount: STEPS, weights });
        const name = `${profile}:${seed}`;
        for (const signature of new Set(failures.map((f) => f.signature))) {
          (signatures[signature] ??= []).push(name);
        }
        runs[name] = { steps: stepsHash(steps), values: await finalValues() };
      }
    }
    fail(`${REPORT_START}${JSON.stringify({ signatures, runs })}${REPORT_END}`);
  }, 3_600_000);
});
