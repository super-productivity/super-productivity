import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * #9349: the Electron main process only forwards idle periods longer than 60s,
 * so a `minIdleTime` below that silently disabled idle detection entirely.
 *
 * The unit spec pins the validator; this drives the real settings UI, because
 * the error only surfaces through `updateOn: 'blur'` + `markAllAsTouched()` and
 * the save is blocked in `ConfigFormComponent`, none of which a component
 * harness exercises end to end.
 */

const IDLE_SECTION = '.section-idle';
const MIN_IDLE_INPUT = `${IDLE_SECTION} input[inputduration]`;

/**
 * The idle fields carry `isHideForNoAdvancedFeatures`, which CSS-hides them
 * unless the app runs under Electron or the Chrome extension. E2E runs plain
 * web, so stand in for that environment rather than skip the whole feature.
 */
const enableAdvancedFeatures = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.classList.add('isAdvancedFeatures');
    document.body.classList.remove('isNoAdvancedFeatures');
  });
};

const openIdleSection = async (page: Page): Promise<void> => {
  await page.goto('/#/config?tab=2');
  await page.waitForURL(/config/);
  await enableAdvancedFeatures(page);

  const collapsible = page.locator(`${IDLE_SECTION} collapsible`);
  await collapsible.waitFor({ state: 'visible', timeout: 10000 });
  await collapsible.scrollIntoViewIfNeeded();

  const isExpanded = await collapsible.evaluate((el: Element) =>
    el.classList.contains('isExpanded'),
  );
  if (!isExpanded) {
    await collapsible.locator('.collapsible-header').click();
    await collapsible
      .locator('.collapsible-panel')
      .waitFor({ state: 'visible', timeout: 5000 });
  }
};

/** Idle tracking is off by default; minIdleTime is hidden behind it. */
const enableIdleTracking = async (page: Page): Promise<void> => {
  const toggle = page
    .locator(`${IDLE_SECTION} mat-slide-toggle, ${IDLE_SECTION} mat-checkbox`)
    .filter({ hasText: 'Enable idle time handling' })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  const classes = (await toggle.getAttribute('class')) ?? '';
  if (!classes.includes('checked')) {
    await toggle.click();
    await expect(toggle).toHaveClass(/checked/, { timeout: 5000 });
  }
  await page.locator(MIN_IDLE_INPUT).waitFor({ state: 'visible', timeout: 5000 });
};

const setMinIdleTime = async (page: Page, value: string): Promise<void> => {
  const input = page.locator(MIN_IDLE_INPUT);
  // fill() can land before the ngModel binding is live, so re-assert.
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }).toPass({ timeout: 5000 });
  // The field is `updateOn: 'blur'` — the value only reaches the form on blur.
  await input.blur();
};

/** Re-read after a full reload so the value comes from IndexedDB, not the DOM. */
const reloadAndReadMinIdleTime = async (page: Page): Promise<string> => {
  await page.reload();
  await openIdleSection(page);
  await enableIdleTracking(page);
  return (await page.locator(MIN_IDLE_INPUT).inputValue()).trim();
};

test.describe('Idle: minimum idle time floor (#9349)', () => {
  test('should reject a below-floor value and not persist it', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await openIdleSection(page);
    await enableIdleTracking(page);

    await setMinIdleTime(page, '30s');

    const error = page.locator(`${IDLE_SECTION} mat-error`);
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toContainText('1m');
    await expect(error).not.toContainText('60000');

    // The stored default, untouched — stronger than "not 30s", which would also
    // hold if the field came back empty.
    expect(await reloadAndReadMinIdleTime(page)).toBe('5m');
  });

  // Positive control: without this, the assertion above would pass even if
  // nothing in this form ever persisted.
  test('should persist a value at or above the floor', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await openIdleSection(page);
    await enableIdleTracking(page);

    await setMinIdleTime(page, '2m');

    await expect(page.locator(`${IDLE_SECTION} mat-error`)).toBeHidden();

    expect(await reloadAndReadMinIdleTime(page)).toBe('2m');
  });
});
