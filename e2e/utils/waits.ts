import { type Page } from '@playwright/test';

const DEFAULT_ROUTE_REGEX = /#\/(tag|project)\/.+\/tasks/;

type WaitForAppReadyOptions = {
  /**
   * Additional selector that should be visible before returning.
   */
  selector?: string;
  /**
   * Whether to wait for a work-view style route.
   */
  ensureRoute?: boolean;
  /**
   * Custom route regex if ensureRoute is enabled.
   */
  routeRegex?: RegExp;
};

/**
 * Dismiss up to `maxAttempts` blocking confirmation dialogs.
 * Some app flows show chained dialogs (e.g., pre-migration + data-repair)
 * that must be dismissed before the app shell becomes interactive.
 */
const dismissBlockingDialogs = async (page: Page, maxAttempts = 3): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const dialogConfirmBtn = page.locator('dialog-confirm button[e2e="confirmBtn"]');
      await dialogConfirmBtn.waitFor({ state: 'visible', timeout: 2000 });
      await dialogConfirmBtn.click();
      await page.waitForTimeout(500);
    } catch {
      break;
    }
  }
};

/**
 * Simplified wait that relies on Playwright's auto-waiting.
 * Previously used Angular testability API to check Zone.js stability.
 * Now just checks DOM readiness - Playwright handles element actionability.
 *
 * Experiment showed: Angular stability checks not needed for most UI tests.
 * Playwright's auto-waiting (before click, fill, assertions) is sufficient.
 */
export const waitForAngularStability = async (
  page: Page,
  timeout = 3000,
): Promise<void> => {
  await page.waitForFunction(
    () =>
      document.readyState === 'complete' && !!document.querySelector('.route-wrapper'),
    { timeout },
  );
};

/**
 * Dismisses the onboarding preset selection screen if present.
 * Sets the localStorage flag to skip it without altering app feature config.
 */
const dismissOnboardingPresets = async (page: Page): Promise<void> => {
  try {
    const isVisible = await page
      .locator('onboarding-preset-selection')
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (isVisible) {
      await page.evaluate(() => {
        localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
        localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
        localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
        localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
    }
  } catch {
    // Preset selection not present, ignore
  }
};

/**
 * Shared helper to wait until the application shell and Angular are ready.
 * Optimized for speed - removed networkidle wait and redundant checks.
 *
 * Note: The app shows a loading screen while initial sync and data load completes.
 * This screen hides the .route-wrapper, so we must wait for loading to complete first.
 */
export const waitForAppReady = async (
  page: Page,
  options: WaitForAppReadyOptions = {},
): Promise<void> => {
  const { selector, ensureRoute = true, routeRegex = DEFAULT_ROUTE_REGEX } = options;

  // Wait for initial page load
  await page.waitForLoadState('domcontentloaded');

  // Handle any blocking dialogs (pre-migration, confirmation, etc.)
  // These dialogs block app until dismissed
  await dismissBlockingDialogs(page);

  // Dismiss onboarding preset selection if present (blocks entire UI)
  await dismissOnboardingPresets(page);

  // Wait for the loading screen to disappear (if visible).
  // The app shows `.loading-full-page-wrapper` while syncing/importing data.
  const loadingWrapper = page.locator('.loading-full-page-wrapper');
  try {
    const isLoadingVisible = await loadingWrapper.isVisible().catch(() => false);
    if (isLoadingVisible) {
      await loadingWrapper.waitFor({ state: 'hidden', timeout: 30000 });
    }
  } catch {
    // Loading screen might not appear at all - that's fine
  }

  // Wait for route to match (if required)
  // Use longer timeout with retry for slow-loading apps (especially second client)
  if (ensureRoute) {
    try {
      await page.waitForURL(routeRegex, { timeout: 20000 });
    } catch {
      // If route doesn't match, try refreshing once and waiting again
      console.log('[waitForAppReady] Route timeout, attempting reload...');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForURL(routeRegex, { timeout: 15000 });
    }
  }

  // Re-check loading screen (may appear after initial check during Angular bootstrap)
  const loadingRecheck = page.locator('.loading-full-page-wrapper');
  const isStillLoading = await loadingRecheck.isVisible().catch(() => false);
  if (isStillLoading) {
    await loadingRecheck.waitFor({ state: 'hidden', timeout: 30000 });
  }

  // Wait for main route wrapper to be visible (indicates app shell loaded)
  try {
    await page
      .locator('.route-wrapper')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    // Safety net: reload and retry if app got stuck
    console.log(
      '[waitForAppReady] .route-wrapper not visible after 15s, attempting reload...',
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await dismissBlockingDialogs(page);
    const rl = page.locator('.loading-full-page-wrapper');
    if (await rl.isVisible().catch(() => false)) {
      await rl.waitFor({ state: 'hidden', timeout: 30000 });
    }
    if (ensureRoute) {
      await page.waitForURL(routeRegex, { timeout: 15000 });
    }
    await page
      .locator('.route-wrapper')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  // Wait for optional selector
  if (selector) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8000 });
  }

  await waitForAngularStability(page).catch(() => {});

  // Small buffer to ensure animations settle.
  // Check if page is still open before waiting (handles test timeout scenarios)
  if (!page.isClosed()) {
    await page.waitForTimeout(200);
  }
};

/**
 * Wait for UI to settle after an action (e.g., adding a task).
 * Uses Angular stability as the primary signal rather than fixed timeouts.
 * Falls back to a minimal timeout if Angular stability check fails.
 */
export const waitForUISettle = async (page: Page): Promise<void> => {
  if (page.isClosed()) {
    return;
  }
  try {
    await waitForAngularStability(page, 2000);
  } catch {
    // Fall back to minimal fixed timeout if stability check fails
    if (!page.isClosed()) {
      await page.waitForTimeout(200);
    }
  }
};

/**
 * Wait for local state changes to persist before triggering sync.
 * This ensures IndexedDB writes have completed after UI state changes.
 * Uses Angular stability + networkidle as indicators that async operations have settled.
 *
 * Note: IndexedDB writes happen asynchronously outside of Angular's zone and network
 * requests, so we add an explicit delay after stability checks to ensure persistence
 * completes before operations like page reload.
 */
export const waitForStatePersistence = async (page: Page): Promise<void> => {
  // Check if page is still open
  if (page.isClosed()) {
    return;
  }
  // Wait for Angular to become stable (async operations complete)
  await waitForAngularStability(page, 3000).catch(() => {});
  // Wait for any pending network requests to complete
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  // Additional delay for IndexedDB writes to complete (they happen outside Angular zone)
  // The operation log effects use concatMap which serializes writes, but the actual
  // IndexedDB transaction may still be pending when Angular reports stability.
  // Reduced from 500ms to 200ms as a minimal safety buffer - Angular stability check
  // already ensures most async work is complete.
  if (!page.isClosed()) {
    await page.waitForTimeout(200);
  }
};
