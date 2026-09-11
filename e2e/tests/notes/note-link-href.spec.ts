import { test, expect } from '../../fixtures/test.fixture';

/**
 * Both note renderers resolve a link target through the same helper
 * (`toRenderableHref`): the markdown renderer for an unlocked note, and
 * `renderLinks` for a locked one ("Disable Markdown Parsing"). These tests pin
 * the three outcomes at runtime, in both renderers:
 *
 * - a schemeless web host becomes an `http://` link,
 * - a bare filename stays text (`.md` is a registrable TLD — a relative file
 *   reference must never become a visit to a stranger's domain),
 * - an app deep-link scheme keeps its scheme verbatim.
 */
const linkLine = (unique: string): string =>
  `[${unique}-www](www.example.com) [${unique}-file](readme.md) [${unique}-dt](x-devonthink-item://abc123)`;

test.describe('note link hrefs', () => {
  test('unlocked note (markdown renderer) normalizes, blocks and preserves hrefs', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const unique = `${testPrefix}-href`;
    await notePage.addNote(linkLine(unique));

    const note = page.locator('note', { hasText: `${unique}-www` }).first();
    await expect(note).toBeVisible();

    const wwwAnchor = note.locator(`a:has-text("${unique}-www")`);
    await expect(wwwAnchor).toBeVisible();
    expect(await wwwAnchor.getAttribute('href')).toBe('http://www.example.com');

    // Rendered as inert text, so the link text is still readable.
    await expect(note.locator(`a:has-text("${unique}-file")`)).toHaveCount(0);
    await expect(note).toContainText(`${unique}-file`);

    const deepLinkAnchor = note.locator(`a:has-text("${unique}-dt")`);
    await expect(deepLinkAnchor).toBeVisible();
    expect(await deepLinkAnchor.getAttribute('href')).toBe('x-devonthink-item://abc123');
  });

  test('locked note (renderLinks) resolves the same hrefs as the markdown renderer', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const unique = `${testPrefix}-href-locked`;
    await notePage.addNote(linkLine(unique));

    const note = page.locator('note', { hasText: `${unique}-www` }).first();
    await expect(note).toBeVisible();

    // Toggle lock via context menu ("Disable Markdown Parsing")
    await note.hover();
    const menuBtn = note.locator('button:has(mat-icon:has-text("more_vert"))');
    await menuBtn.click();
    const lockBtn = page
      .locator('.mat-mdc-menu-content button')
      .filter({ has: page.locator('mat-icon:has-text("lock_open")') });
    await lockBtn.click();

    const wwwAnchor = note.locator(`a:has-text("${unique}-www")`);
    await expect(wwwAnchor).toBeVisible();
    expect(await wwwAnchor.getAttribute('href')).toBe('http://www.example.com');

    await expect(note.locator(`a:has-text("${unique}-file")`)).toHaveCount(0);
    await expect(note).toContainText(`${unique}-file`);

    const deepLinkAnchor = note.locator(`a:has-text("${unique}-dt")`);
    await expect(deepLinkAnchor).toBeVisible();
    expect(await deepLinkAnchor.getAttribute('href')).toBe('x-devonthink-item://abc123');
  });
});
