import { migrateState } from '@sp/shared-schema';
import { validateFull } from './validation-fn';
import { AppDataComplete } from '../model/model-config';
import frozen from './test-fixtures/frozen-state-v18.15.json';

/**
 * Guardrail for "required field added without a migration" (#9125, #9124).
 *
 * `frozen-state-v18.15.json` is a snapshot of the persisted app-state shape as
 * written by v18.15. It is FROZEN ON PURPOSE and must never be regenerated from
 * current defaults: it stands in for the data already sitting on users' disks.
 * Every slice carries at least one entity, because typia cannot check the shape
 * of an entity type whose collection is empty — a fixture with `entities: {}`
 * would validate no matter how the model changed.
 *
 * If this spec fails, you made a field required that older data does not carry.
 * Fix it in the model, NOT in the fixture — either type the field optional (`?`)
 * or backfill it in a schema migration. Editing the fixture to add the field
 * silences the guard and ships the bug that #9124 fixed: hydration re-migrates
 * every boot, and for entity slices no reducer heals the gap.
 *
 * Regenerating is only correct when a *transforming* migration legitimately
 * changes the on-disk shape — and then the fixture should be hand-edited to the
 * shape the migration produces, so the diff is reviewable.
 *
 * ⚠️ Locally this spec can pass on a STALE validator. typia inlines the whole
 * model graph into `validation-fn.ts`, but Angular's build cache does not
 * invalidate that file when a type it only *imports* changes — so right after
 * editing a model, a warm-cache run still validates against the old shape and
 * reports zero errors. CI builds cold and is unaffected. To check a model change
 * locally, clear the cache first: `rm -rf .angular/cache`.
 *
 * @see docs/sync-and-op-log/contributor-sync-model.md ("Required fields on persisted models")
 */
describe('frozen prior-release state survives migrate -> validateFull', () => {
  it('validates after being migrated to the current schema version', () => {
    const migrated = migrateState(frozen.state, frozen.__frozenAtSchemaVersion);
    expect(migrated.success).withContext(`migration failed`).toBe(true);

    const result = validateFull(migrated.data as AppDataComplete);
    const details =
      'errors' in result.typiaResult
        ? result.typiaResult.errors
            .map((e) => `${e.path}: expected ${e.expected}`)
            .join('\n')
        : result.crossModelError;

    expect(result.isValid)
      .withContext(details || '')
      .toBe(true);
  });
});
