import { FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import { runFuzz } from './sync-fuzz-runner';
import fixtures from './time-preserving-resolution.fixtures.json';

/**
 * Original 30-step traces, frozen on the published retry PR (#10499).
 * Seed07 loses 7000→4000 ms; both original seed23 variants change C's Today
 * order only on restart. The same steps reproduce both regressions before
 * the mixed-history improvement and with own-successor-only retry recovery.
 * Other baseline ordering/field residues remain the fuzz sweep's responsibility.
 */
describe('time and restart retry regressions, original frozen traces (#10499)', () => {
  afterEach(() => SyncFuzzHarness.dispose());
  for (const fixture of fixtures) {
    it(
      fixture.name,
      async () => {
        const steps = fixture.steps as FuzzStep[];
        const result = await runFuzz({ steps });
        expect(result.steps).toEqual(steps);
        expect(
          result.failures.filter(
            ({ signature }) =>
              signature === 'time-loss:task' || signature.startsWith('restart-changed:'),
          ),
        )
          .withContext(JSON.stringify(result.failures))
          .toEqual([]);
      },
      60_000,
    );
  }
});
