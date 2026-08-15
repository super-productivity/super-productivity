import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * Dragging the right-panel divider walks the header through dozens of widths.
 *
 * The header used to answer "what fits?" by measuring, and a collapsed action
 * has no width to measure — so the only way it could ever come back was to
 * render every collapsed action inline again and look. That happened on every
 * widening, which meant a drag tore down and rebuilt the whole action row over
 * and over, `simple-counter-button` and its countdown subscription included,
 * and the row visibly flickered while it did.
 *
 * Width decides nothing about the row's contents now — it scrolls instead — so
 * a resize must change nothing about the DOM at all. That is what this counts,
 * and it is what would fail first if a width-driven fit were ever reintroduced.
 * Deliberately a mutation count and not a screenshot: the churn is the defect,
 * and a still frame cannot see it.
 */
const countRowMutations = async (
  page: Page,
  act: () => Promise<void>,
): Promise<number> => {
  await expect(page.locator('.action-nav-scroll')).toHaveCount(1);

  await page.evaluate(() => {
    // The scroller and the action groups inside it — every level an action can
    // be added to or removed from. Watching only the scroller would miss the
    // focus button and the counters, which live one level down inside
    // `.counters-action-group`, and their subscriptions are exactly the churn
    // this is here to catch. Not `subtree`, though: below these, Material's
    // ripple nodes appear and vanish under the cursor a drag drags across, and
    // counting those would measure the mouse rather than the row.
    const boxes = document.querySelectorAll(
      '.action-nav-scroll, .action-nav-scroll .header-action-group',
    );
    const w = window as unknown as {
      __rowMutations: number;
      __rowObserver: MutationObserver;
    };
    w.__rowMutations = 0;
    w.__rowObserver = new MutationObserver((records) => {
      w.__rowMutations += records.length;
    });
    boxes.forEach((box) => w.__rowObserver.observe(box, { childList: true }));
  });

  await act();

  return page.evaluate(() => {
    const w = window as unknown as {
      __rowMutations: number;
      __rowObserver: MutationObserver;
    };
    w.__rowObserver.disconnect();
    return w.__rowMutations;
  });
};

const openNotesPanel = async (page: Page): Promise<void> => {
  await page.locator('.e2e-toggle-notes-btn').first().click();
  await expect(page.locator('right-panel.isOpen')).toBeVisible();
  await expect(page.locator('right-panel.isPanelAnimating')).toHaveCount(0);
};

/** Drag the right panel's divider by `dx`, in the small steps a hand makes. */
const dragDivider = async (page: Page, dx: number): Promise<void> => {
  const handle = page.locator('right-panel .resize-handle');
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error('right panel resize handle not found');
  }
  const y = box.y + Math.round(box.height / 2);
  const from = box.x + Math.round(box.width / 2);

  await page.mouse.move(from, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const travelled = (dx * i) / steps;
    await page.mouse.move(from + travelled, y);
  }
  await page.mouse.up();
  await expect(page.locator('right-panel.resizing')).toHaveCount(0);
};

test.describe('main header while the layout is resized', () => {
  test('does not rebuild the action row while the divider is dragged', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1100, height: 860 });
    await openNotesPanel(page);

    // Out and back to the same place, so the row ends where it started and any
    // mutation counted is churn rather than a real change of what fits.
    const mutations = await countRowMutations(page, async () => {
      await dragDivider(page, -120);
      await dragDivider(page, 120);
    });

    // Zero: nothing about the row's contents depends on width any more, it
    // just scrolls. Re-offering on every widening frame ran to dozens.
    expect(
      mutations,
      `the action row was rebuilt ${mutations} times during one divider drag`,
    ).toBe(0);
  });

  test('does not rebuild the action row when the side panel is toggled', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1600, height: 860 });

    // Opening the panel takes ~400px off the header — the largest width change
    // the app makes in one step, and the one the old fit reacted to hardest.
    const mutations = await countRowMutations(page, async () => {
      await openNotesPanel(page);
    });

    expect(
      mutations,
      `the action row was rebuilt ${mutations} times just opening a panel`,
    ).toBe(0);
  });
});
