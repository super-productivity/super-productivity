import { expect, test } from '../../fixtures/test.fixture';

const CONFIRM_CREATE_TAG_BTN = `button[e2e="confirmBtn"]`;
const BASIC_TAG_TITLE = 'task tag-list tag:last-of-type .tag-title';

test.describe('Autocomplete Dropdown', () => {
  test('should create a simple tag', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add task with tag syntax, skipClose=true to keep input open
    // Use sd:today to set dueDay so task appears in TODAY view
    await workViewPage.addTask('some task <3 #basicTag sd:today', true);

    // Wait for and click the confirm create tag button with increased timeout
    await page.waitForSelector(CONFIRM_CREATE_TAG_BTN, {
      state: 'visible',
      timeout: 10000, // Reduced from 15s to 10s
    });
    await page.locator(CONFIRM_CREATE_TAG_BTN).click();

    // Wait for dialog to close
    await page.waitForSelector(CONFIRM_CREATE_TAG_BTN, {
      state: 'hidden',
      timeout: 8000, // Reduced from 10s to 8s
    });

    // Close the add task input if still open
    const backdrop = page.locator('.backdrop');
    if (await backdrop.isVisible()) {
      await backdrop.click();
    }

    // Wait for tag to be created with increased timeout
    await page.waitForSelector(BASIC_TAG_TITLE, { state: 'visible', timeout: 10000 }); // Reduced from 15s to 10s

    // Assert tag is present and has correct text
    const tagTitle = page.locator(BASIC_TAG_TITLE);
    await expect(tagTitle).toBeVisible();
    await expect(tagTitle).toContainText('basicTag');
  });
});
