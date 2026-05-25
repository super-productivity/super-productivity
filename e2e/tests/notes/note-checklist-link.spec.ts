import { test, expect } from '../../fixtures/test.fixture';

test.describe('Issue #7013 — link in checklist in project note', () => {
  test('unlocked note: link in checklist renders as <a> tag', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const unique = `${testPrefix}-7013`;
    const noteContent = `- [ ] [${unique}-link](https://example.com)`;

    await notePage.addNote(noteContent);

    const note = page.locator('note', { hasText: `${unique}-link` }).first();
    await expect(note).toBeVisible();

    const anchor = note.locator(`a:has-text("${unique}-link")`);
    await expect(anchor).toBeVisible();
    const href = await anchor.getAttribute('href');
    expect(href).toContain('example.com');
  });

  test('locked note: link in checklist still renders as <a> tag', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const unique = `${testPrefix}-7013-locked`;
    const noteContent = `- [ ] [${unique}-link](https://example.com)`;

    await notePage.addNote(noteContent);

    const note = page.locator('note', { hasText: `${unique}-link` }).first();
    await expect(note).toBeVisible();

    // Toggle lock via context menu ("Disable Markdown Parsing")
    await note.hover();
    const menuBtn = note.locator('button:has(mat-icon:has-text("more_vert"))');
    await menuBtn.click();
    const lockBtn = page
      .locator('.mat-mdc-menu-content button')
      .filter({ has: page.locator('mat-icon:has-text("lock_open")') });
    await lockBtn.click();

    // Locked path should still linkify URLs via RenderLinksPipe
    const anchor = note.locator(`a:has-text("${unique}-link")`);
    await expect(anchor).toBeVisible();
    const href = await anchor.getAttribute('href');
    expect(href).toContain('example.com');
  });
});
