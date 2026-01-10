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

  // Wait for the loading screen to disappear (if visible).
  // The app shows `.loading-full-page-wrapper` while syncing/importing data.
  // The `.route-wrapper` is conditionally rendered and won't exist until loading completes.
  const loadingWrapper = page.locator('.loading-full-page-wrapper');
  try {
    // Short timeout to check if loading screen is visible
    const isLoadingVisible = await loadingWrapper.isVisible().catch(() => false);
    if (isLoadingVisible) {
      // Wait for loading screen to disappear (longer timeout for sync operations)
      await loadingWrapper.waitFor({ state: 'hidden', timeout: 30000 });
    }
  } catch {
    // Loading screen might not appear at all - that's fine
  }

  // Wait for route to match (if required)
  if (ensureRoute) {
    await page.waitForURL(routeRegex, { timeout: 15000 });
  }

  // Wait for main route wrapper to be visible (indicates app shell loaded)
  await page
    .locator('.route-wrapper')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });

  // Wait for optional selector
  if (selector) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8000 });
  }

  // Note: We no longer call waitForAngularStability here because:
  // 1. We've already confirmed .route-wrapper is visible
  // 2. Playwright's auto-waiting handles element actionability
  // 3. The readyState check in waitForAngularStability can cause flakiness
};

/**
 * Wait for local state changes to persist before triggering sync.
 * This ensures IndexedDB writes have completed after UI state changes.
 * Optimized to rely on Angular stability rather than networkidle.
 */
export const waitForStatePersistence = async (page: Page): Promise<void> => {
  // Wait for Angular to become stable (async operations complete)
  await waitForAngularStability(page, 3000);
  // Small buffer for IndexedDB writes to complete
  await page.waitForTimeout(100);
};
