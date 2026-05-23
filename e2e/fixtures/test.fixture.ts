import { test as base } from '@playwright/test';
import type { BrowserContext, ConsoleMessage } from '@playwright/test';
import { WorkViewPage } from '../pages/work-view.page';
import { ProjectPage } from '../pages/project.page';
import { TaskPage } from '../pages/task.page';
import { SettingsPage } from '../pages/settings.page';
import { DialogPage } from '../pages/dialog.page';
import { PlannerPage } from '../pages/planner.page';
import { SyncPage } from '../pages/sync.page';
import { TagPage } from '../pages/tag.page';
import { NotePage } from '../pages/note.page';
import { SideNavPage } from '../pages/side-nav.page';
import { skipOnboardingForE2E, waitForAppReady } from '../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
} from '../utils/runtime-errors';

type TestFixtures = {
  workViewPage: WorkViewPage;
  projectPage: ProjectPage;
  taskPage: TaskPage;
  settingsPage: SettingsPage;
  dialogPage: DialogPage;
  plannerPage: PlannerPage;
  syncPage: SyncPage;
  tagPage: TagPage;
  notePage: NotePage;
  sideNavPage: SideNavPage;
  isolatedContext: BrowserContext;
  waitForNav: (selector?: string) => Promise<void>;
  testPrefix: string;
};

export const test = base.extend<TestFixtures>({
  // Create isolated context for each test.
  // We use Playwright's merged `contextOptions` fixture so future option additions
  // propagate automatically instead of requiring this list to stay in sync by hand.
  isolatedContext: async (
    { browser, contextOptions, baseURL, actionTimeout, navigationTimeout },
    use,
    testInfo,
  ) => {
    const url = baseURL || testInfo.project.use.baseURL || 'http://localhost:4242';
    const baseUserAgent = contextOptions.userAgent ?? 'PLAYWRIGHT';

    const context = await browser.newContext({
      ...contextOptions,
      // Each test gets its own storage state
      storageState: undefined,
      // Preserve the base userAgent and add worker index for debugging
      userAgent: `${baseUserAgent} PLAYWRIGHT-WORKER-${testInfo.workerIndex}`,
      baseURL: url,
    });

    // Use !== undefined so a configured `0` (Playwright's "no timeout") is honored.
    if (actionTimeout !== undefined) context.setDefaultTimeout(actionTimeout);
    if (navigationTimeout !== undefined) {
      context.setDefaultNavigationTimeout(navigationTimeout);
    }

    await use(context);

    // Cleanup
    await context.close();
  },

  // Override page to use isolated context
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    // Page errors are uncaught JS exceptions in the app — almost always test-relevant.
    // Each error is logged via console.error as it arrives (so it stays visible even
    // when the test fails for another reason), then aggregated and thrown at teardown
    // if the test otherwise passed.
    const runtimeErrors = attachPageErrorCollector(page, 'page');

    // Skip onboarding, hints, and example tasks before the app boots.
    // This runs before any page JavaScript, so Angular sees the flags immediately.
    await page.addInitScript(skipOnboardingForE2E);

    try {
      if (process.env.E2E_VERBOSE) {
        page.on('console', (msg: ConsoleMessage) => {
          console.log(`Console ${msg.type()}:`, msg.text());
        });
      }

      // Navigate to the app with retry logic
      let navigationSuccess = false;
      for (let attempt = 0; attempt < 3 && !navigationSuccess; attempt++) {
        try {
          await page.goto('/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          navigationSuccess = true;
        } catch (error) {
          if (attempt === 2) throw error;
          console.log(`Navigation attempt ${attempt + 1} failed, retrying...`);
          await page.waitForTimeout(1000);
        }
      }

      await waitForAppReady(page);

      let testFailed = false;
      try {
        await use(page);
      } catch (error) {
        testFailed = true;
        throw error;
      } finally {
        if (!testFailed) {
          assertNoRuntimeBrowserErrors(runtimeErrors, 'page');
        }
      }
    } finally {
      // Cleanup - make sure context is still available
      if (!page.isClosed()) {
        await page.close();
      }
    }
  },

  // Provide test prefix for data namespacing
  testPrefix: async ({}, use, testInfo) => {
    // Use worker index and parallel index for unique prefixes
    const prefix = `W${testInfo.workerIndex}-P${testInfo.parallelIndex}`;
    await use(prefix);
  },

  workViewPage: async ({ page, testPrefix }, use) => {
    await use(new WorkViewPage(page, testPrefix));
  },

  projectPage: async ({ page, testPrefix }, use) => {
    await use(new ProjectPage(page, testPrefix));
  },

  taskPage: async ({ page, testPrefix }, use) => {
    await use(new TaskPage(page, testPrefix));
  },

  settingsPage: async ({ page, testPrefix }, use) => {
    await use(new SettingsPage(page, testPrefix));
  },

  dialogPage: async ({ page, testPrefix }, use) => {
    await use(new DialogPage(page, testPrefix));
  },

  plannerPage: async ({ page }, use) => {
    await use(new PlannerPage(page));
  },

  syncPage: async ({ page }, use) => {
    await use(new SyncPage(page));
  },

  tagPage: async ({ page, testPrefix }, use) => {
    await use(new TagPage(page, testPrefix));
  },

  notePage: async ({ page, testPrefix }, use) => {
    await use(new NotePage(page, testPrefix));
  },

  sideNavPage: async ({ page, testPrefix }, use) => {
    await use(new SideNavPage(page, testPrefix));
  },

  waitForNav: async ({ page }, use) => {
    const waitForNav = async (selector?: string): Promise<void> => {
      await waitForAppReady(page, {
        ensureRoute: false,
        selector,
      });
    };
    await use(waitForNav);
  },
});

export { expect } from '@playwright/test';
