import { expect, test } from '../../fixtures/test.fixture';

// MatTooltip only takes its touch code path when `Platform.ANDROID`/`IOS` is
// true, and that check is UA-sniffed — a touch-enabled context alone is not
// enough to reproduce #10015. The fixture appends `PLAYWRIGHT-WORKER-n`, so
// onboarding is still skipped with this UA in place.
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Nothing Phone 1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

test.use({
  userAgent: ANDROID_UA,
  // The custom isolated-context fixture consumes contextOptions, so keep the
  // mobile/touch descriptor nested here (same reason as the mobile-webkit
  // project in playwright.config.ts).
  contextOptions: {
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  },
});

test.describe('Fullscreen note editor toolbar on a phone', () => {
  test('keeps the overflowing formatting controls reachable by touch', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // The notes page object drives the desktop side panel; on the phone layout
    // Project Notes is only reachable through the side panel menu.
    await page.locator('button[aria-label="Side Panel Menu"]').first().tap();
    await page.locator('.mat-mdc-menu-item', { hasText: 'Project Notes' }).first().tap();

    const noteText = `${testPrefix}-toolbar-note`;
    await page.locator('#add-note-btn, button:has-text("Add new Note")').first().tap();
    await page.locator('dialog-fullscreen-markdown textarea').fill(noteText);
    await page.locator('#T-save-note').tap();
    await expect(page.locator('dialog-fullscreen-markdown')).toBeHidden();

    // Reopen the saved note. #10015 is about editing an existing Project Note,
    // which is DialogFullscreenMarkdownComponent itself — the add-note flow
    // above is the DialogAddNoteComponent subclass, and the two only share this
    // template by path.
    await page.locator('note', { hasText: noteText }).locator('.markdown-preview').tap();

    // Both components declare `selector: 'dialog-fullscreen-markdown'`, so the
    // element alone cannot tell them apart. Prefilled content can: the add-note
    // dialog always opens empty.
    await expect(page.locator('dialog-fullscreen-markdown textarea')).toHaveValue(
      noteText,
    );

    const toolbar = page.locator('dialog-fullscreen-markdown .formatting-toolbar');
    await expect(toolbar).toBeVisible();

    // Precondition: the toolbar really is wider than the screen here. Without
    // this the rest of the test would pass vacuously on a wider viewport.
    const overflowPx = await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflowPx).toBeGreaterThan(0);

    // The regression itself: MatTooltip's long-press gesture writes an inline
    // `touch-action: none` onto every tooltip host, and the buttons tile the
    // whole toolbar — so a swipe never becomes a pan and the overflow is
    // unreachable. Headless Chromium cannot synthesize a real compositor pan,
    // so assert on the property that gates one.
    const blockedButtonCount = await toolbar.evaluate(
      (el) =>
        Array.from(el.querySelectorAll('button')).filter(
          (btn) => getComputedStyle(btn).touchAction === 'none',
        ).length,
    );
    expect(blockedButtonCount).toBe(0);

    // …and scrolling actually brings the hidden controls into view.
    const lastButton = toolbar.locator('button').last();
    await expect(lastButton).not.toBeInViewport();
    await toolbar.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(lastButton).toBeInViewport();
  });
});
