import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import legacyPartial from '../../../src/app/op-log/validation/test-fixtures/legacy-pf-v13-partial-models.json';
import { MIGRATION_BACKUP_PREFIX } from '../../../electron/shared-with-frontend/get-backup-timestamp';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import { ImportPage } from '../../pages/import.page';
import {
  readMigratedState,
  seedLegacyDatabase,
} from '../../utils/legacy-migration-helpers';

/**
 * Issue #9770: a `pf` database written by an older version only holds the model
 * keys that existed back then. The reporter's (a July 2025 install) has no
 * `timeTracking`, `menuTree` or `boards`; typia rejects the data, `dataRepair`
 * has no defaults for those three, so migration threw "Data repair failed" and
 * the app dead-ended on "Migration Failed" then "Failed to load data" — on
 * every restart, with no way out.
 *
 * The unit tests pin the pieces (the slice fill, the preserved repair guard,
 * the post-repair validation). None of them can show that the app actually
 * STARTS with this database on disk, because they all mock LegacyPfDbService.
 * That is what this test is for: it seeds the reporter's real backup into a
 * real `pf` IndexedDB and asserts the migration completes and the app renders.
 *
 * The fixture is imported from the unit test-fixtures directory on purpose —
 * one copy of the reporter's data, so the two suites cannot drift apart.
 *
 * Run: npm run e2e:file e2e/tests/migration/legacy-partial-model-slices-9770.spec.ts -- --retries=0
 */

type MigratedState = Record<string, { ids?: string[] } | undefined>;

/** Every key still present in the legacy `pf/main` store. */
const readLegacyKeys = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('pf', 1);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const keysReq = db
              .transaction('main', 'readonly')
              .objectStore('main')
              .getAllKeys();
            keysReq.onsuccess = () => {
              db.close();
              resolve(keysReq.result.map(String));
            };
            keysReq.onerror = () => {
              db.close();
              reject(keysReq.error);
            };
          } catch (e) {
            db.close();
            reject(e);
          }
        };
        req.onerror = () => reject(req.error);
      }),
  );

test.describe('@migration #9770 legacy data missing newer model slices', () => {
  test('app migrates and starts when the pf database predates timeTracking, menuTree and boards', async ({
    browser,
    baseURL,
  }) => {
    const partialData = JSON.parse(JSON.stringify(legacyPartial)) as Record<
      string,
      unknown
    >;
    // Guard the premise: if the fixture ever gains these keys the test would
    // pass without exercising the bug at all.
    for (const missing of ['timeTracking', 'menuTree', 'boards']) {
      expect(missing in partialData).toBe(false);
    }

    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.route('**/*.js', async (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(page, partialData);
      await page.unroute('**/*.js');

      // The auto-backup download happens BEFORE the migration itself, so it
      // fires in the broken case too — it only proves migration was attempted.
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain(MIGRATION_BACKUP_PREFIX);

      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });

      // The load-bearing assertion: pre-fix, _performMigration throws before
      // appendOperationAndSnapshot, so no snapshot is ever written and this
      // poll times out.
      await expect
        .poll(
          async () =>
            (await readMigratedState<MigratedState>(page)).task?.ids?.length ?? 0,
          {
            timeout: 30000,
          },
        )
        .toBe(1);

      const state = await readMigratedState<MigratedState>(page);
      expect(state.task?.ids).toEqual(['TJ-NDR6Sjc0qc0TS-tUgE']);
      // The slices the old database never had are present in the migrated store.
      expect(state.timeTracking).toBeDefined();
      expect(state.menuTree).toBeDefined();
      expect(state.boards).toBeDefined();

      // The user-visible symptom: no migration error dialog is left on screen.
      await expect(page.locator('dialog-legacy-migration .error-message')).toHaveCount(0);

      // Checked last: the IndexedDB poll above is a real settle window, so a
      // startup failure has had time to surface.
      expect(pageErrors.filter((m) => /migration|repair|validation/i.test(m))).toEqual(
        [],
      );
    } finally {
      await context.close();
    }
  });
  // The other half of #9770: when legacy data genuinely CANNOT be migrated the
  // app used to dead-end on this dialog forever — OK was the only button and
  // every restart landed right back here. Seeds a database with settings but no
  // task/project state, which isDataRepairPossible() refuses by design.
  test('offers a way out when the legacy data cannot be migrated at all', async ({
    browser,
    baseURL,
  }) => {
    const unmigratableData = {
      globalConfig: (legacyPartial as Record<string, unknown>).globalConfig,
    };

    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);

    try {
      await page.route('**/*.js', async (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(page, unmigratableData);
      await page.unroute('**/*.js');

      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await downloadPromise;

      // The dead end itself.
      const dialog = page.locator('dialog-legacy-migration');
      await expect(dialog.locator('.error-message')).toBeVisible({ timeout: 30000 });
      // Real copy, not a raw translation key — the dialog resolves its strings
      // before the app's normal language setup has run.
      await expect(dialog.locator('.error-message')).not.toContainText('MIGRATE.');
      await expect(dialog.locator('h1')).toHaveText('Migration Failed');

      // Offered unconditionally: the way out keeps the legacy database, so
      // there is no copy at risk and nothing to gate on.
      const startFreshBtn = dialog.getByRole('button', {
        name: 'Continue without old data',
      });
      await expect(startFreshBtn).toBeVisible();
      await startFreshBtn.click();

      // No reload and no second confirmation: the marker makes
      // hasUsableEntityData() false from here on, so this same boot continues
      // into the ordinary empty-store path.
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });
      await expect(page.locator('dialog-legacy-migration')).toHaveCount(0);

      // The load-bearing half: the legacy data is still on disk, untouched.
      // Polled, not read once: neither wait above is a settle point for the
      // marker. The dialog is closed in the `finally` BEFORE _skipLegacyData()
      // writes it, and the app shell renders behind the dialog anyway — so a
      // single read here loses the race on a loaded machine.
      await expect
        .poll(() => readLegacyKeys(page), { timeout: 10000 })
        .toEqual(expect.arrayContaining(['globalConfig', '_migration_skipped']));

      // ...and the next boot does NOT walk back into the failed migration.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });
      await expect(page.locator('dialog-legacy-migration')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // Acknowledging the failure instead of taking the way out escalates the
  // migration throw through the hydrator's catch into attemptRecovery(), and
  // hasUsableEntityData() lets a `pf` database through on a `globalConfig` key
  // alone. The globalConfig has to be a VALID one: recovery validates after
  // filling defaults, so a malformed config is refused there anyway and never
  // reaches the guard. With a config the app itself wrote, the filled state
  // validates cleanly and — without the raw guard — a RECOVERY genesis snapshot
  // of an all-defaults store is written over the user's database, permanently
  // shadowing whatever is still on disk.
  test('acknowledging the failure does not snapshot an empty store over the legacy data', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const url = baseURL || 'http://localhost:4242';

    // The config has to be one THIS build considers valid. A legacy-schema
    // config fails validateFull for its own reasons and never reaches the
    // guard, so take the app's own export as the source of truth.
    const exportPath = testInfo.outputPath('current-export.json');
    const setupContext = await browser.newContext({
      storageState: undefined,
      baseURL: url,
      acceptDownloads: true,
    });
    let currentGlobalConfig: unknown;
    try {
      const setupPage = await setupContext.newPage();
      await setupPage.addInitScript(skipOnboardingForE2E);
      await setupPage.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(setupPage);
      const exportPage = new ImportPage(setupPage);
      await exportPage.navigateToImportPage();
      const dl = setupPage.waitForEvent('download', { timeout: 60000 });
      await exportPage.exportBackupBtn.click();
      await (await dl).saveAs(exportPath);
      const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as Record<
        string,
        any
      >;
      currentGlobalConfig = (exported.data ?? exported).globalConfig;
      expect(currentGlobalConfig).toBeDefined();
    } finally {
      await setupContext.close();
    }

    const context = await browser.newContext({
      storageState: undefined,
      baseURL: url,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);

    try {
      await page.route('**/*.js', async (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(page, { globalConfig: currentGlobalConfig });
      await page.unroute('**/*.js');

      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await downloadPromise;

      const dialog = page.locator('dialog-legacy-migration');
      await expect(dialog.locator('.error-message')).toBeVisible({ timeout: 30000 });
      // Ok, not the escape hatch — this is the path that reaches recovery.
      await dialog.getByRole('button', { name: 'Ok', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      // Settle window: recovery runs right after the dialog closes, so give the
      // unguarded write a real chance to land before asserting it did not.
      await page.waitForTimeout(5000);

      // The load-bearing assertion: no genesis snapshot of an all-defaults
      // store. Without the guard `task`/`project` come back as empty-but-present
      // slices, because the filled state validates.
      const state = await readMigratedState<MigratedState>(page);
      expect(state.task).toBeUndefined();
      expect(state.project).toBeUndefined();

      // ...and the legacy database is still there to recover from.
      expect(await readLegacyKeys(page)).toContain('globalConfig');
    } finally {
      await context.close();
    }
  });

  // The escape hatch is only honest if the file it leaves behind can actually be
  // read back. The auto-backup is the RAW `pf` dump, so it is missing the same
  // newer slices that broke the migration — the import has to fill them too, or
  // the promised recovery route fails exactly the way the migration did.
  test('the auto-backup it leaves behind can be imported into a clean install', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const partialData = JSON.parse(JSON.stringify(legacyPartial)) as Record<
      string,
      unknown
    >;
    const url = baseURL || 'http://localhost:4242';
    const backupPath = testInfo.outputPath('pre-migration-backup.json');

    // Phase 1 — the affected install: capture the file the dialog points at.
    const legacyContext = await browser.newContext({
      storageState: undefined,
      baseURL: url,
      acceptDownloads: true,
    });
    try {
      const legacyPage = await legacyContext.newPage();
      await legacyPage.addInitScript(skipOnboardingForE2E);
      await legacyPage.route('**/*.js', async (route) => route.abort());
      await legacyPage.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(legacyPage, partialData);
      await legacyPage.unroute('**/*.js');

      const downloadPromise = legacyPage.waitForEvent('download', { timeout: 60000 });
      await legacyPage.reload({ waitUntil: 'domcontentloaded' });
      const download = await downloadPromise;
      await download.saveAs(backupPath);
    } finally {
      await legacyContext.close();
    }

    // Guard the premise: the captured file must really be the raw legacy dump,
    // otherwise the import below would not exercise the missing slices at all.
    const captured = JSON.parse(readFileSync(backupPath, 'utf8')) as Record<
      string,
      unknown
    >;
    for (const missing of ['timeTracking', 'menuTree', 'boards']) {
      expect(missing in captured).toBe(false);
    }

    // Phase 2 — a clean install imports it, as the dialog promises.
    const freshContext = await browser.newContext({
      storageState: undefined,
      baseURL: url,
      acceptDownloads: true,
    });
    try {
      const page = await freshContext.newPage();
      await page.addInitScript(skipOnboardingForE2E);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const importPage = new ImportPage(page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(backupPath);

      // The load-bearing assertion: pre-fix the import rejects this file the
      // same way the migration did, and the task never lands.
      await expect
        .poll(
          async () =>
            (await readMigratedState<MigratedState>(page)).task?.ids?.length ?? 0,
          { timeout: 30000 },
        )
        .toBe(1);
      const state = await readMigratedState<MigratedState>(page);
      expect(state.task?.ids).toEqual(['TJ-NDR6Sjc0qc0TS-tUgE']);
      expect(state.timeTracking).toBeDefined();
      expect(state.menuTree).toBeDefined();
      expect(state.boards).toBeDefined();
    } finally {
      await freshContext.close();
    }
  });
});
