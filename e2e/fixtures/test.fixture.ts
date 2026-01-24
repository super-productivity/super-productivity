import { BrowserContext, test as base } from '@playwright/test';
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
import { waitForAppReady } from '../utils/waits';
import { dismissTourIfVisible } from '../utils/tour-helpers';

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
  // Create isolated context for each test
  isolatedContext: async ({ browser, baseURL }, use, testInfo) => {
    const url = baseURL || testInfo.project.use.baseURL || 'http://localhost:4242';
    // Create a new context with isolated storage
    const context = await browser.newContext({
      // Each test gets its own storage state
      storageState: undefined,
      // Preserve the base userAgent and add worker index for debugging
      userAgent: `PLAYWRIGHT PLAYWRIGHT-WORKER-${testInfo.workerIndex}`,
      baseURL: url,
    });

    await use(context);

    // Cleanup
    await context.close();
  },

  // Override page to use isolated context
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    // Temporary diagnostic: Track 404 responses
    const notFoundUrls = new Map<string, number>();

    try {
      // Set up error handling
      page.on('pageerror', (error) => {
        console.error('Page error:', error.message);
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error('Console error:', msg.text());
        } else if (process.env.E2E_VERBOSE) {
          console.log(`Console ${msg.type()}:`, msg.text());
        }
      });

      page.on('response', async (response) => {
        if (response.status() === 404) {
          const url = response.url();
          notFoundUrls.set(url, (notFoundUrls.get(url) || 0) + 1);
        }
      });

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

      // Dismiss Shepherd tour if it appears
      await dismissTourIfVisible(page);

      await use(page);
    } finally {
      // Log 404 summary if any were found
      if (notFoundUrls.size > 0) {
        console.log('\n=== 404 Resources ===');
        const sorted = Array.from(notFoundUrls.entries()).sort((a, b) => b[1] - a[1]); // Sort by count descending
        sorted.forEach(([url, count]) => {
          console.log(`[${count}x] ${url}`);
        });
        console.log(`Total unique 404s: ${notFoundUrls.size}`);
        console.log('=====================\n');
      }

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
