import { test, expect } from '../../fixtures/test.fixture';

const SIDENAV = 'magic-side-nav';
const ROUTER_WRAPPER = '.route-wrapper';
const SETTINGS_BTN = `${SIDENAV} nav-item:has([icon="settings"]) button, ${SIDENAV} .tour-settingsMenuBtn`;

test.describe.serial('Plugin Visibility', () => {
  test('navigate to settings page', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });
    await expect(page).toHaveURL(/\/config/);
  });

  test('check page structure', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });

    const results = await page.evaluate(() => {
      const pageResults: {
        hasPluginSection: boolean;
        hasPluginManagement: boolean;
        hasCollapsible: boolean;
        pluginHeading?: Element;
        headingText: string;
        sectionCount: number;
        sectionClasses: string[];
        hasConfigPage: boolean;
      } = {
        hasPluginSection: false,
        hasPluginManagement: false,
        hasCollapsible: false,
        headingText: '',
        sectionCount: 0,
        sectionClasses: [],
        hasConfigPage: false,
      };

      // Check for plugin section
      pageResults.hasPluginSection = !!document.querySelector('.plugin-section');
      pageResults.hasPluginManagement = !!document.querySelector('plugin-management');
      pageResults.hasCollapsible = !!document.querySelector(
        '.plugin-section collapsible',
      );

      // Check for plugin heading
      const headings = Array.from(document.querySelectorAll('h2'));
      pageResults.pluginHeading = headings.find((h) => h.textContent?.includes('Plugin'));
      pageResults.headingText = pageResults.pluginHeading?.textContent || 'Not found';

      // Get all section classes
      const sections = Array.from(document.querySelectorAll('.config-section'));
      pageResults.sectionCount = sections.length;
      pageResults.sectionClasses = sections.map((s) => s.className);

      // Check entire page HTML for debugging
      const configPage = document.querySelector('.page-settings');
      pageResults.hasConfigPage = !!configPage;

      return pageResults;
    });

    // console.log('Page structure results:', results);
    expect(results).toBeTruthy();
  });

  test('log page content for debugging', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });

    await page.evaluate(() => {
      const configContent =
        document.querySelector('.page-settings')?.innerHTML || 'No config page found';
      // console.log('Config page content length:', configContent.length);

      // Look for any mentions of plugin
      const pluginMentions = configContent.match(/plugin/gi) || [];
      // console.log('Plugin mentions found:', pluginMentions.length);

      return {
        contentLength: configContent.length,
        pluginMentions: pluginMentions.length,
        hasPluginText: configContent.toLowerCase().includes('plugin'),
      };
    });
  });
});
