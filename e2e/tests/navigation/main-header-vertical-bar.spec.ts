import { expect, test } from '../../fixtures/test.fixture';

/**
 * The teleported vertical strip is the one consumer of the header's markup that
 * lives in a different stylesheet: `src/styles/components/_vertical-action-bar.scss`
 * moves `nav.action-nav-right` to `document.body` and lays its groups out as a
 * column. Nothing links the two files, so a structural change to the header can
 * break the rail silently — and this branch made one, putting
 * `.action-nav-scroll` between the nav and its groups, which forced that
 * stylesheet's `>` combinators to become descendant ones. Get that wrong and
 * the rail lays its buttons out in a row inside a 48px column.
 *
 * Asserted as geometry rather than as CSS, because the failure is a layout, not
 * a declaration: every button on one x, each on its own y.
 */
test('teleports the action bar into a single column when enabled', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('/#/config');
  // Config sections start collapsed.
  await page.getByText('Misc Settings', { exact: false }).first().click();
  const toggle = page.getByText('Vertical action bar on the side (experimental)').first();
  await toggle.waitFor({ state: 'visible' });
  await toggle.click();

  const rail = page.locator('body > nav.action-nav-right--teleported');
  await expect(rail).toBeVisible();

  await expect(async () => {
    const strip = await page.evaluate(() => {
      const nav = document.querySelector(
        'body > nav.action-nav-right--teleported',
      ) as HTMLElement;
      const buttons = (
        Array.from(nav.querySelectorAll('button')) as HTMLElement[]
      ).filter((b) => b.getBoundingClientRect().width > 0);
      return {
        groupDirections: (
          Array.from(nav.querySelectorAll('.header-action-group')) as HTMLElement[]
        ).map((g) => getComputedStyle(g).flexDirection),
        buttonCount: buttons.length,
        distinctX: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().left)))
          .size,
        distinctY: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))
          .size,
      };
    });

    expect(strip.buttonCount).toBeGreaterThan(1);
    // A row inside the rail would share a y and spread across x -- exactly what
    // a stale `>` combinator produces.
    expect(strip.distinctX, 'buttons should share one column').toBe(1);
    expect(strip.distinctY, 'each button should have its own row').toBe(
      strip.buttonCount,
    );
    expect(strip.groupDirections.every((d) => d === 'column')).toBe(true);
  }).toPass({ timeout: 10000 });
});
