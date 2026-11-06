import { expect, test } from '../../fixtures/test.fixture';

declare global {
  interface Window {
    __copiedText?: string;
  }
}

test.describe('Copy task as markdown checklist', () => {
  test('Ctrl+C on a focused task copies it and its sub tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parent = taskPage.getTaskByText('Parent task');
    await workViewPage.addSubTask(parent, 'Sub one');
    await workViewPage.addSubTask(parent, 'Sub two');

    // clipboard-read cannot be granted in this browser context, so record what
    // the app hands to the real clipboard API instead of reading it back.
    await page.evaluate(() => {
      navigator.clipboard.writeText = (text: string): Promise<void> => {
        window.__copiedText = text;
        return Promise.resolve();
      };
    });

    await parent.focus();
    await page.keyboard.press('Control+c');

    await expect
      .poll(() => page.evaluate(() => window.__copiedText))
      .toBe(`- [ ] ${testPrefix}-Parent task\n  - [ ] Sub one\n  - [ ] Sub two`);
  });
});
