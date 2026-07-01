import { validateFull } from '../../validation/validation-fn';
import { dataRepair } from '../../validation/data-repair';
import { createAppDataCompleteMock } from '../../../util/app-data-mock';
import { EMPTY_SIMPLE_COUNTER } from '../../../features/simple-counter/simple-counter.const';
import { SimpleCounterType } from '../../../features/simple-counter/simple-counter.model';
import { AppDataComplete } from '../../model/model-config';

/**
 * Integration repro for issue #7330's recurrence on SIMPLE_COUNTER
 * (ruckusvol's logs, both devices ≥ v18.6.0).
 *
 * A concurrent delete-vs-update across devices recreated a counter from a
 * partial LWW payload, leaving `simpleCounter.entities.<id>.type === undefined`.
 * typia rejects the enum, and the previous dataRepair/auto-fix pipeline had no
 * rule for it, so post-sync validation looped on:
 *
 *   [validation-fn] Validation failed   firstErrorPath: ...simpleCounter...type
 *   [ValidateStateService] State still invalid after repair
 *
 * and the user dead-ended on the "Repair attempted but failed" dialog. This
 * drives the SAME pipeline ValidateStateService uses (real `validateFull` →
 * real `dataRepair` → real `validateFull`) and asserts the corrupt counter is
 * now healed end-to-end rather than re-failing. It is the regression net that
 * fails loudly if either repair layer is removed.
 */
describe('SimpleCounter undefined-type post-sync repair (#7330) — integration', () => {
  const COUNTER_ID = 'cnt_TMfJh3tw15FP4gRcNTx9O';

  const makeStateWithCounter = (counter: Record<string, unknown>): AppDataComplete => {
    const state = createAppDataCompleteMock();
    (
      state as unknown as { simpleCounter: { ids: string[]; entities: unknown } }
    ).simpleCounter = {
      ids: [COUNTER_ID],
      entities: { [COUNTER_ID]: counter },
    };
    return state;
  };

  it('baseline mock validates (harness sanity)', () => {
    expect(validateFull(createAppDataCompleteMock()).isValid).toBe(true);
  });

  it('reproduces the failure and heals it through the real validate→repair→validate pipeline', () => {
    // The exact on-disk shape from the report: a counter complete except for
    // `type` (errorCount: 1), with its accumulated count data intact.
    const corruptCounter: Record<string, unknown> = {
      ...EMPTY_SIMPLE_COUNTER,
      id: COUNTER_ID,
      title: 'Coffee',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      countOnDay: { '2026-06-29': 7 },
      // Stamped onto every recreated entity by lwwUpdateMetaReducer; harmless
      // excess property under typia createValidate, mirrors the real state.
      modified: 123,
    };
    delete corruptCounter['type'];

    const corruptState = makeStateWithCounter(corruptCounter);

    // 1. Reproduce: full validation fails on exactly the reported path.
    const before = validateFull(corruptState);
    expect(before.isValid).toBe(false);
    const firstError = before.typiaResult.success
      ? undefined
      : before.typiaResult.errors[0];
    expect(firstError?.path).toContain('simpleCounter');
    expect(firstError?.path).toContain('type');

    // 2. Repair via the same entry point ValidateStateService uses.
    const errors = before.typiaResult.success ? [] : before.typiaResult.errors;
    const repaired = dataRepair(corruptState, errors).data;

    // 3. The previously-fatal state is now valid (no "still invalid after repair").
    expect(validateFull(repaired).isValid).toBe(true);

    const healed = (
      repaired as unknown as {
        simpleCounter: { entities: Record<string, Record<string, unknown>> };
      }
    ).simpleCounter.entities[COUNTER_ID];
    // `type` is backfilled to the harmless ClickCounter default...
    expect(healed['type']).toBe(SimpleCounterType.ClickCounter);
    // ...and the user's count history is preserved, not wiped.
    expect(healed['countOnDay']).toEqual({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '2026-06-29': 7,
    });
  });
});
