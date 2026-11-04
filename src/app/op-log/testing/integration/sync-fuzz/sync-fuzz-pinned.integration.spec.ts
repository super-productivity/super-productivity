import { FuzzStep } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import pinnedTraces from './sync-fuzz-pinned-traces.json';
import { IS_REPAIR_SIGNATURE, runFuzz } from './sync-fuzz-runner';

/**
 * Pinned sync fuzz traces: minimized three-device traces. Each pin asserts
 * TODAY's outcome, like unsupported-multi-entity-conflict.integration.spec.ts
 * pins its stops: the steps that ran, the sorted failure signatures of the
 * oracles in sync-fuzz-runner.ts, and the server's rejections. Failure
 * details are only printed.
 * - A pin with failures reproduces a known bug on master. `ref` names its
 *   issue, or the decision that keeps it; `primary` is the signature that
 *   defines the bug, which sync-fuzz-seeds.benchmark.ts does not report again.
 * - A pin without failures is a regression test for a fixed bug (`ref` names
 *   the fixing PR), or a coverage trace for paths no other pin takes.
 *
 * A fix changes the outcome and fails its pin. Then set the pin's
 * `signatures`/`rejections` to the fixed outcome (usually none), drop
 * `primary`, and set `ref` to the fixing PR, so the trace stays as a
 * regression test. The failure message prints the new outcome. New traces
 * come from sync-fuzz-seeds.benchmark.ts.
 */

interface PinnedTrace {
  /** Failure class, shared by the traces of one bug. */
  class: string;
  /** The issue, the kept-by-design decision, or the fixing PR. */
  ref: string;
  name: string;
  steps: FuzzStep[];
  /** The signature that defines a failing pin's bug. */
  primary?: string;
  /** Sorted failure signatures. */
  signatures: string[];
  rejections: string[];
}

const PINS = pinnedTraces as unknown as PinnedTrace[];

describe('sync fuzz pinned traces (known current behavior)', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('lists sorted signatures and the primary of every failing pin', () => {
    for (const pin of PINS) {
      expect(pin.signatures)
        .withContext(pin.name)
        .toEqual([...pin.signatures].sort());
      expect(
        pin.primary === undefined
          ? pin.signatures.length === 0
          : pin.signatures.includes(pin.primary),
      )
        .withContext(`${pin.name}: primary ${pin.primary}`)
        .toBeTrue();
    }
  });

  for (const pin of PINS) {
    it(`${pin.class}: ${pin.name}`, async () => {
      const { steps, failures, rejections } = await runFuzz({ steps: pin.steps });
      const signatures = failures.map((f) => f.signature).sort();
      expect({ steps, signatures, rejections })
        .withContext(`${pin.ref}; failures now: ${JSON.stringify(failures)}`)
        .toEqual({
          steps: pin.steps,
          signatures: pin.signatures,
          rejections: pin.rejections,
        });
      // A REPAIR or failed validation carries the run's dump for triage.
      for (const failure of failures) {
        if (IS_REPAIR_SIGNATURE.test(failure.signature)) {
          expect(failure.detail).withContext(failure.signature).toContain(' DUMP ');
        }
      }
    }, 60_000);
  }
});
