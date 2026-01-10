import { Page } from '@playwright/test';

/**
 * Helper functions for plugin testing with robust loading verification
 */

/**
 * Wait for plugin assets to be available via HTTP
 */
export const waitForPluginAssets = async (
  page: Page,
  maxRetries: number = 12,
  retryDelay: number = 1000,
  overallTimeoutMs?: number,
): Promise<boolean> => {
  // Hard cap for total waiting time to avoid exceeding test timeout
  const capMs = overallTimeoutMs ?? (process.env.CI ? 25000 : 15000);
  const start = Date.now();
  // In CI, keep retries conservative to stay under cap
  if (process.env.CI) {
    maxRetries = Math.min(Math.max(maxRetries, 10), 15);
    retryDelay = Math.max(retryDelay, 1500);
  }

  const baseUrl = page.url().split('#')[0];
  const testUrl = `${baseUrl}assets/bundled-plugins/api-test-plugin/manifest.json`;

  // Basic readiness check; keep short to not eat into cap
  try {
    await page.waitForSelector('app-root', { state: 'visible', timeout: 8000 });
  } catch {
    return false;
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await page.request.get(testUrl);
      if (response.ok()) {
        await response.json();
        return true;
      } else {
        // Debug: Check if basic assets work
        if (response.status() === 404 && i === 3) {
          const iconUrl = `${baseUrl}assets/icons/sp.svg`;
          try {
            await page.request.get(iconUrl);
          } catch (e) {
            console.error(`[Plugin Test] Basic asset test failed:`, e.message);
          }
        }
      }
    } catch (error: any) {
      console.error(
        `[Plugin Test] Attempt ${i + 1}/${maxRetries}: Error - ${error.message}`,
      );
    }

    // Respect overall cap to avoid test-level timeout
    const elapsed = Date.now() - start;
    if (elapsed + retryDelay > capMs) {
      break;
    }
    if (i < maxRetries - 1) {
      // Wait before retry - network request, so timeout is appropriate here
      await page.waitForTimeout(retryDelay);
    }
  }

  console.error('[Plugin Test] Failed to load plugin assets after all retries');

  // In CI, this might be expected if assets aren't built properly
  if (process.env.CI) {
    console.warn('[Plugin Test] Plugin assets unavailable; skipping in CI');
  }

  return false;
};

/**
 * Wait for plugin system to be initialized - now navigates to settings and ensures plugin section is available
 */
export const waitForPluginManagementInit = async (
  page: Page,
  timeout: number = 15000, // Reduced from 20s to 15s // Reduced from 30s to 20s
): Promise<boolean> => {
  try {
    // First ensure we're on the settings page and plugin section is expanded
    const currentUrl = page.url();
    if (!currentUrl.includes('#/config')) {
      await page.click('text=Settings');
      await page.waitForURL(/.*#\/config.*/, { timeout: 8000 }); // Reduced from 10s to 8s
    }

    // Wait for settings page to load
    await page.waitForSelector('.page-settings', { state: 'visible', timeout: 8000 }); // Reduced from 10s to 8s

    // Wait a bit for the page to stabilize
    await page.waitForTimeout(500);

    // Expand plugin section if collapsed and scroll it into view
    await page.evaluate(() => {
      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'instant', block: 'center' });
      }

      const collapsible = document.querySelector('.plugin-section collapsible');
      if (collapsible && !collapsible.classList.contains('isExpanded')) {
        const header = collapsible.querySelector('.collapsible-header');
        if (header) {
          (header as HTMLElement).click();
        }
      }
    });

    // Wait for expansion animation and scroll to complete
    await page.waitForTimeout(300);

    // Scroll plugin-management into view explicitly
    await page.evaluate(() => {
      const pluginMgmt = document.querySelector('plugin-management');
      if (pluginMgmt) {
        pluginMgmt.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });

    // Wait for plugin management component to be attached (not necessarily visible)
    await page.waitForSelector('plugin-management', {
      state: 'attached',
      timeout: Math.max(5000, timeout - 20000),
    });

    // Additional check for plugin cards to be loaded
    const result = await page.waitForFunction(
      () => {
        const pluginMgmt = document.querySelector('plugin-management');
        if (!pluginMgmt) return false;

        const cards = document.querySelectorAll('plugin-management mat-card');
        return cards.length > 0;
      },
      { timeout: Math.max(5000, timeout - 25000) },
    );

    return !!result;
  } catch (error) {
    console.error('[Plugin Test] Plugin management init failed:', error.message);
    return false;
  }
};

/**
 * Enable a plugin with robust verification
 */
export const enablePluginWithVerification = async (
  page: Page,
  pluginName: string,
  timeout: number = 8000, // Reduced from 10s to 8s // Reduced from 15s to 10s
): Promise<boolean> => {
  const startTime = Date.now();

  // First, verify the plugin card exists
  const pluginCardResult = await page
    .waitForFunction(
      (name) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => {
          const title = card.querySelector('mat-card-title')?.textContent || '';
          return title.includes(name);
        });

        if (targetCard) {
          return true;
        }
        return false;
      },
      pluginName,
      { timeout: timeout / 2 },
    )
    .catch(() => null);

  if (!pluginCardResult) {
    console.error(`[Plugin Test] Plugin card not found for: ${pluginName}`);
    return false;
  }

  // Enable the plugin
  const enableResult = await page.evaluate((name) => {
    const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
    const targetCard = cards.find((card) => {
      const title = card.querySelector('mat-card-title')?.textContent || '';
      return title.includes(name);
    });

    if (!targetCard) {
      return { success: false, error: 'Card not found' };
    }

    const toggle = targetCard.querySelector(
      'mat-slide-toggle button[role="switch"]',
    ) as HTMLButtonElement;

    if (!toggle) {
      return { success: false, error: 'Toggle not found' };
    }

    const wasEnabled = toggle.getAttribute('aria-checked') === 'true';
    if (!wasEnabled) {
      toggle.click();
    }

    return { success: true, wasEnabled };
  }, pluginName);

  if (!enableResult.success) {
    console.error(`[Plugin Test] Failed to enable plugin: ${enableResult.error}`);
    return false;
  }

  // Wait for the toggle state to update
  await page.waitForFunction(
    (name) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        return title.includes(name);
      });

      const toggle = targetCard?.querySelector(
        'mat-slide-toggle button[role="switch"]',
      ) as HTMLButtonElement;

      return toggle?.getAttribute('aria-checked') === 'true';
    },
    pluginName,
    { timeout: timeout - (Date.now() - startTime) },
  );

  return true;
};

/**
 * Wait for plugin to be fully loaded and visible in menu
 */
export const waitForPluginInMenu = async (
  page: Page,
  pluginName: string,
  timeout: number = 15000, // Reduced from 20s to 15s
): Promise<boolean> => {
  try {
    // Navigate to main view to see the menu
    await page.goto('/#/tag/TODAY');

    // Wait for magic-side-nav to exist
    await page.waitForSelector('magic-side-nav', {
      state: 'attached',
      timeout: timeout / 2,
    });

    // Wait for the specific plugin button in the magic-side-nav
    const result = await page.waitForFunction(
      (name) => {
        const sideNav = document.querySelector('magic-side-nav');
        if (!sideNav) {
          return false;
        }

        const buttons = Array.from(sideNav.querySelectorAll('nav-item button'));
        const found = buttons.some((btn) => {
          const text = btn.textContent?.trim() || '';
          return text.includes(name);
        });

        return found;
      },
      pluginName,
      { timeout },
    );

    return !!result;
  } catch (error) {
    console.error(`[Plugin Test] Plugin ${pluginName} not found in menu:`, error.message);
    return false;
  }
};

/**
 * Debug helper to log current plugin state
 */
export const logPluginState = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
    const plugins = cards.map((card) => {
      const title =
        card.querySelector('mat-card-title')?.textContent?.trim() || 'Unknown';
      const toggle = card.querySelector(
        'mat-slide-toggle button[role="switch"]',
      ) as HTMLButtonElement;
      const enabled = toggle?.getAttribute('aria-checked') === 'true';
      return { title, enabled };
    });

    const menuButtons = Array.from(
      document.querySelectorAll('magic-side-nav nav-item button'),
    ).map((btn) => btn.textContent?.trim() || '');

    return {
      pluginCards: plugins,
      menuEntries: menuButtons,
      hasPluginManagement: !!document.querySelector('plugin-management'),
      hasMagicSideNav: !!document.querySelector('magic-side-nav'),
    };
  });

  // Plugin state debugging removed to reduce test output
};

/**
 * Get timeout multiplier for CI environment
 */
export const getCITimeoutMultiplier = (): number => {
  return process.env.CI ? 2 : 1;
};

/**
 * Disable a plugin with robust verification
 */
export const disablePluginWithVerification = async (
  page: Page,
  pluginName: string,
  timeout: number = 10000,
): Promise<boolean> => {
  const startTime = Date.now();

  // First, verify the plugin card exists and is enabled
  const pluginCardResult = await page
    .waitForFunction(
      (name) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => {
          const title = card.querySelector('mat-card-title')?.textContent || '';
          return title.includes(name);
        });
        return !!targetCard;
      },
      pluginName,
      { timeout: timeout / 2 },
    )
    .catch(() => null);

  if (!pluginCardResult) {
    console.error(`[Plugin Test] Plugin card not found for: ${pluginName}`);
    return false;
  }

  // Check current state and click to disable if needed
  const disableResult = await page.evaluate((name) => {
    const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
    const targetCard = cards.find((card) => {
      const title = card.querySelector('mat-card-title')?.textContent || '';
      return title.includes(name);
    });

    if (!targetCard) {
      return {
        success: false,
        error: 'Card not found',
        wasEnabled: false,
        clicked: false,
      };
    }

    const toggle = targetCard.querySelector(
      'mat-slide-toggle button[role="switch"]',
    ) as HTMLButtonElement;

    if (!toggle) {
      return {
        success: false,
        error: 'Toggle not found',
        wasEnabled: false,
        clicked: false,
      };
    }

    const wasEnabled = toggle.getAttribute('aria-checked') === 'true';
    if (wasEnabled) {
      toggle.click();
      return { success: true, wasEnabled, clicked: true };
    }

    // Already disabled
    return { success: true, wasEnabled: false, clicked: false };
  }, pluginName);

  if (!disableResult.success) {
    console.error(`[Plugin Test] Failed to disable plugin: ${disableResult.error}`);
    return false;
  }

  // If already disabled, no need to wait
  if (!disableResult.clicked) {
    return true;
  }

  // Wait for the toggle state to update to disabled
  const remainingTimeout = Math.max(5000, timeout - (Date.now() - startTime));
  try {
    await page.waitForFunction(
      (name) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => {
          const title = card.querySelector('mat-card-title')?.textContent || '';
          return title.includes(name);
        });

        const toggle = targetCard?.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;

        return toggle?.getAttribute('aria-checked') === 'false';
      },
      pluginName,
      { timeout: remainingTimeout },
    );
    return true;
  } catch (error) {
    console.error(
      `[Plugin Test] Timeout waiting for plugin to disable: ${error.message}`,
    );
    return false;
  }
};

/**
 * Robust element clicking with multiple selector fallbacks
 */
export const robustClick = async (
  page: Page,
  selectors: string[],
  timeout: number = 8000, // Reduced from 10s to 8s
): Promise<boolean> => {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      await element.waitFor({ state: 'visible', timeout: timeout / selectors.length });
      await element.click();
      return true;
    } catch (error) {
      console.log(`Selector ${selector} failed: ${error.message}`);
    }
  }
  console.error(`All selectors failed: ${selectors.join(', ')}`);
  return false;
};

/**
 * Wait for element with multiple selector fallbacks
 */
export const robustWaitFor = async (
  page: Page,
  selectors: string[],
  timeout: number = 8000, // Reduced from 10s to 8s
): Promise<boolean> => {
  const promises = selectors.map((selector) =>
    page
      .locator(selector)
      .first()
      .waitFor({
        state: 'visible',
        timeout,
      })
      .then(() => selector)
      .catch(() => null),
  );

  try {
    const result = await Promise.race(promises.filter(Boolean));
    return !!result;
  } catch {
    return false;
  }
};
