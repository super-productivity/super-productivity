import { migrateState } from '@sp/shared-schema';
import { validateFull, validateAppDataProperty } from './validation-fn';
import { AppDataComplete } from '../model/model-config';
import frozen from './test-fixtures/frozen-state-v18.15.json';

/**
 * Guardrail for "required field added without a migration" (#9125, #9124).
 *
 * `frozen-state-v18.15.json` is persisted app state as written by v18.15. It
 * stands in for the data already sitting on users' disks, so its value is its
 * AGE — do not regenerate it from current defaults, and do not add fields to it
 * to make a failing test pass.
 *
 * WHEN THIS FAILS you made a field required that older data does not carry. Fix
 * the model: type it optional (`?`) — the cheap, preferred answer — or backfill
 * it in a schema migration, which costs a schema bump (see AGENTS.md rule 10).
 * Editing the fixture silences the guard and ships the bug #9124 fixed.
 *
 * A TRANSFORMING MIGRATION IS NOT A REASON TO EDIT THIS FILE. `migrateState`
 * below applies it during the test, and the spec still passing is the proof the
 * migration handles real v18.15 data — the most valuable thing this test does.
 * Hand-editing to the post-migration shape while `__frozenAtSchemaVersion`
 * stays 4 would re-apply the migration to already-migrated data. The only edit
 * ever warranted is re-pinning the version if `MIN_SUPPORTED_SCHEMA_VERSION`
 * rises above it; then migrate the fixture forward once, or add a new dated
 * fixture alongside — never regenerate this one from `createValidAppData()`.
 *
 * WHY THE FIXTURE IS BULKY: typia checks a TYPE, and it cannot check a type
 * whose only instances live in an empty collection. Every populated collection
 * here buys coverage of one more persisted model, so keep them non-empty (the
 * `no vacuous collections` spec below enforces that). Known limits: `validateFull`
 * omits `archiveOld`/`archiveYoung` (`DataToValidate` in validation-fn.ts), so
 * they are validated separately below; nothing checks types that appear nowhere
 * in the fixture at all.
 *
 * NOTE: `migrateState` is a no-op while `__frozenAtSchemaVersion` equals
 * `CURRENT_SCHEMA_VERSION` — it goes live at the next bump, and a bump shipped
 * without a migration fails here with "No migration path from version N".
 *
 * ⚠️ Locally this spec can pass on a STALE validator. typia inlines the whole
 * model graph into `validation-fn.ts`, but Angular's build cache does not
 * invalidate that file when a type it only *imports* changes — so right after
 * editing a model, a warm-cache run still validates against the old shape and
 * reports zero errors. CI builds cold and is unaffected. To check a model change
 * locally, clear the cache first: `rm -rf .angular/cache`. Clearing only the
 * `babel-webpack` namespace is NOT enough — verified: the typia output is cached
 * under `angular-webpack`, and the narrower clear still reports a green false
 * negative against a model that genuinely broke the fixture.
 *
 * @see AGENTS.md — Sync-correctness rule 11
 */
describe('frozen prior-release state survives migrate -> validateFull', () => {
  const DO_NOT_EDIT =
    'FROZEN FIXTURE FAILED — do NOT add the field to the fixture. Type it ' +
    "optional (`?`) or backfill it in a migration. See this spec's docblock.\n";

  // structuredClone is load-bearing: migrateState returns `state` BY REFERENCE
  // when source === target, so without it every spec here shares one live
  // handle on the imported module singleton and a single stray mutation would
  // corrupt the fixture for whatever runs next.
  const migrateFrozen = (): AppDataComplete => {
    const migrated = migrateState(
      structuredClone(frozen.state),
      frozen.__frozenAtSchemaVersion,
    );
    if (!migrated.success) {
      throw new Error(`migration of frozen fixture failed: ${migrated.error}`);
    }
    return migrated.data as AppDataComplete;
  };

  it('validates after being migrated to the current schema version', () => {
    const result = validateFull(migrateFrozen());
    const details = !result.typiaResult.success
      ? result.typiaResult.errors
          .map((e) => `${e.path}: expected ${e.expected}`)
          .join('\n')
      : `cross-model: ${result.crossModelError}`;

    expect(result.isValid)
      .withContext(DO_NOT_EDIT + details)
      .toBe(true);
  });

  // #9124 regression lock. v18.14 shipped schema 2 WITHOUT the required field
  // #8965 added, so the v2->v3 migration has to backfill it — otherwise the
  // migration-path gate rejects the snapshot and the app boots to an empty
  // store, every launch. Derived from the same frozen bytes minus that one
  // field rather than a second fixture: identical coverage, no duplication.
  // This is also the only case that exercises the migration chain while
  // __frozenAtSchemaVersion equals CURRENT_SCHEMA_VERSION.
  it('backfills the idle field when migrating v18.14 (schema 2) data', () => {
    const v18_14 = structuredClone(frozen.state) as unknown as AppDataComplete;
    delete (v18_14.globalConfig.idle as { isSuppressIdleDuringFocusMode?: boolean })
      .isSuppressIdleDuringFocusMode;

    const migrated = migrateState(v18_14, 2);
    if (!migrated.success) {
      throw new Error(`v18.14 migration failed: ${migrated.error}`);
    }
    const data = migrated.data as AppDataComplete;

    expect(data.globalConfig.idle.isSuppressIdleDuringFocusMode)
      .withContext('v2->v3 must backfill the field #8965 added (#9124)')
      .toBe(false);
    expect(validateFull(data).isValid).withContext(DO_NOT_EDIT).toBe(true);
  });

  // validateFull omits the archives, so they need their own pass.
  (['archiveYoung', 'archiveOld'] as const).forEach((key) => {
    it(`validates ${key}, which validateFull does not cover`, () => {
      const data = migrateFrozen();
      const result = validateAppDataProperty(key, data[key]);
      const details = result.success
        ? ''
        : result.errors.map((e) => `${e.path}: expected ${e.expected}`).join('\n');

      expect(result.success)
        .withContext(DO_NOT_EDIT + details)
        .toBe(true);
    });
  });

  // Mechanically enforces the docblock's central prohibition. The likeliest way
  // this guard dies is someone regenerating the fixture from
  // `createValidAppData()`, which yields EMPTY collections — and typia cannot
  // check the shape of a type whose only instances live in an empty collection,
  // so the spec would still pass while covering nothing. Every path below would
  // be emptied by that regeneration.
  it('has no vacuous (empty) collections', () => {
    const MUST_BE_POPULATED = [
      'task.entities',
      'task.entities.task-1.attachments',
      'project.entities',
      'tag.entities',
      'note.entities',
      'issueProvider.entities',
      'metric.entities',
      'metric.entities.2026-07-18.reflections',
      'taskRepeatCfg.entities',
      'section.entities',
      'simpleCounter.entities',
      'reminders',
      'pluginUserData',
      'pluginMetadata',
      'planner.days',
      'timeTracking.project',
      'timeTracking.tag',
      'boards.boardCfgs',
      'archiveYoung.task.entities',
      'archiveOld.task.entities',
      'globalConfig.flowtime.breakRules',
      'issueProvider.entities.ip-JIRA.availableTransitions',
    ];
    const at = (path: string): unknown =>
      path
        .split('.')
        .reduce<unknown>(
          (acc, k) => (acc as Record<string, unknown> | undefined)?.[k],
          frozen.state,
        );

    const empty = MUST_BE_POPULATED.filter((path) => {
      const value = at(path);
      return !value || Object.keys(value as object).length === 0;
    });

    expect(empty)
      .withContext('empty collection = its element type is never shape-checked')
      .toEqual([]);
  });

  // The fixture is a dump from a running app. Regenerating it against a real
  // profile would commit live credentials, so fail loudly instead of relying on
  // the "do not regenerate" comment.
  it('carries no credentials', () => {
    const SECRET_KEY_RE =
      /pass|token|api_?key|secret|encryptKey|clientId|userName|username|loginName/i;
    const found: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (!value || typeof value !== 'object') return;
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
        if (SECRET_KEY_RE.test(k) && typeof v === 'string' && v.length) {
          found.push(`${path}.${k}`);
        }
        walk(v, `${path}.${k}`);
      });
    };
    walk((frozen.state as { globalConfig: unknown }).globalConfig, 'globalConfig');
    walk((frozen.state as { issueProvider: unknown }).issueProvider, 'issueProvider');

    expect(found)
      .withContext(`non-empty credential-shaped fields: ${found.join(', ')}`)
      .toEqual([]);
  });
});
