import { validateFull } from './validation-fn';
import { dataRepair } from './data-repair';
import { AppDataComplete, withDefaultModelSlices } from '../model/model-config';
import legacyPartial from './test-fixtures/legacy-pf-v13-partial-models.json';

/**
 * Regression guard for #9770.
 *
 * `legacy-pf-v13-partial-models.json` is a real pre-migration backup of a `pf`
 * database written in July 2025. It only carries the six model slices that
 * existed back then (task, project, tag, reminders, planner, globalConfig), so
 * its value is its AGE — do not add slices to it to make a test pass.
 *
 * Without `withDefaultModelSlices` the migration path validates it, repairs it,
 * re-validates, and still finds `timeTracking` / `menuTree` / `boards` missing.
 * It then throws "Data repair failed", so the app shows "Migration Failed"
 * followed by "Failed to load data" and stays unusable on every restart.
 */
describe('legacy pf data missing newer model slices (#9770)', () => {
  const loadFixture = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(legacyPartial)) as Record<string, unknown>;

  it('the raw fixture is missing slices typia requires', () => {
    const result = validateFull(loadFixture() as unknown as AppDataComplete);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];

    expect(result.isValid).toBe(false);
    expect(errors.map((e) => e.path)).toContain('$input.timeTracking');
  });

  it('withDefaultModelSlices only fills gaps and never overwrites existing data', () => {
    const raw = loadFixture();
    const filled = withDefaultModelSlices(raw);

    expect(filled.task).toEqual(raw.task as AppDataComplete['task']);
    expect(filled.globalConfig).toEqual(
      raw.globalConfig as AppDataComplete['globalConfig'],
    );
    expect(filled.timeTracking).toBeDefined();
    expect(filled.menuTree).toBeDefined();
    expect(filled.boards).toBeDefined();
  });

  it('validates after filling defaults and repairing, as the migration path does', () => {
    const data = withDefaultModelSlices(loadFixture());

    const result = validateFull(data);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];
    const repaired = dataRepair(data, errors).data;

    const postRepair = validateFull(repaired);
    const postRepairErrors =
      'errors' in postRepair.typiaResult ? postRepair.typiaResult.errors : [];
    expect(postRepairErrors.map((e) => `${e.path} :: ${e.expected}`)).toEqual([]);
    expect(postRepair.isValid).toBe(true);
  });

  it('keeps the single legacy task through the migration path', () => {
    const data = withDefaultModelSlices(loadFixture());
    const result = validateFull(data);
    const errors = 'errors' in result.typiaResult ? result.typiaResult.errors : [];
    const repaired = dataRepair(data, errors).data;

    expect(repaired.task.ids).toEqual(['TJ-NDR6Sjc0qc0TS-tUgE']);
  });
});
