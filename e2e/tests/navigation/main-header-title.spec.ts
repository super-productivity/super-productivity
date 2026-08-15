import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * How the header divides a row that is too narrow for everything in it (#9480).
 *
 * Two rules, and they are each other's counterweight. The title yields first
 * (`flex-shrink: 999`) so a long project name never pushes the actions off
 * screen (#7477) — but it stops yielding at `--header-title-text-min`, because
 * the name is the one thing in the row that says which context you are looking
 * at. What it refuses to give up comes out of the action row, which scrolls
 * rather than dropping a button off an edge nothing can scroll back.
 *
 * Asserted against the live layout rather than against any bookkeeping: the
 * regressions here were always the CSS and the model disagreeing.
 */
const createClickCounter = async (page: Page, title: string): Promise<void> => {
  await page.goto('/#/habits');
  await page.waitForURL(/habits/);

  await page.locator('.add-habit-btn').click();
  const dialog = page.locator('dialog-simple-counter-edit-settings');
  await expect(dialog).toBeVisible();

  await dialog.locator('formly-form input').first().fill(title);
  await dialog.locator('mat-select').first().click();
  await page.locator('mat-option:has-text("Click Counter")').click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();

  await page.goto('/#/tag/TODAY/tasks');
  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

const openNotesPanel = async (page: Page): Promise<void> => {
  await page.locator('.e2e-toggle-notes-btn').first().click();
  await expect(page.locator('right-panel.isOpen')).toBeVisible();
  await expect(page.locator('right-panel.isPanelAnimating')).toHaveCount(0);
};

test.describe('main header title and action row', () => {
  /**
   * The title box is sized by its name, not by a floor, so the buttons that
   * follow it sit against the name rather than after a run of empty box. A
   * 160px floor used to pad every short title: "Today" measures ~75px, leaving
   * 77px of nothing before the project-menu button.
   */
  test('keeps the title buttons against the title, at any width', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    for (const width of [1400, 1100, 900]) {
      await page.setViewportSize({ width, height: 860 });
      await expect(async () => {
        const gap = await page.evaluate(() => {
          const header = document.querySelector('main-header') as HTMLElement;
          const text = header.querySelector('.page-title-text') as HTMLElement | null;
          const actions = header.querySelector(
            '.page-title-actions',
          ) as HTMLElement | null;
          if (!text || !actions) {
            return null;
          }
          return Math.round(
            actions.getBoundingClientRect().left - text.getBoundingClientRect().right,
          );
        });
        expect(gap, `no title actions rendered at ${width}px`).not.toBeNull();
        // A few px of designed spacing is fine; a floor's worth of dead box
        // is what this guards against.
        expect(gap!, `dead space before the title buttons at ${width}px`).toBeLessThan(
          16,
        );
      }).toPass({ timeout: 10000 });
    }
  });

  /**
   * The other side of that trade. With nothing owed to the title, the row spent
   * every pixel on actions: a 320px project name was squeezed to 70px at an
   * 800px window and rendered 2px wide at 600px.
   *
   * This is the one place the desktop value of `--header-title-text-min` is
   * asserted — it lives behind a viewport media query, which a Karma unit test
   * cannot pin without asserting against the runner's own window size.
   */
  test('keeps enough of a long project name to read it', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Quarterly Planning And Review');
    await projectPage.navigateToProjectByName('Quarterly Planning And Review');

    await page.setViewportSize({ width: 800, height: 860 });

    await expect(async () => {
      const title = await page.evaluate(() => {
        const el = document.querySelector('.page-title-text') as HTMLElement | null;
        const box = document.querySelector('.page-title') as HTMLElement | null;
        if (!el || !box) {
          return null;
        }
        const boxStyle = getComputedStyle(box);
        // The floor lives on the title BOX and covers the icon as well as the
        // name, so what it promises the NAME is whatever is left after the icon
        // and the gap beside it. `min-width` is BORDER-box here (the app sets
        // `box-sizing: border-box` globally), so the box's own inline padding
        // comes out of it too — the CSS adds the padding back in for exactly
        // this reason, and subtracting it here is what checks that it did.
        const icon = box.querySelector('.page-title-icon') as HTMLElement | null;
        const iconCost = icon
          ? icon.getBoundingClientRect().width + parseFloat(boxStyle.columnGap || '0')
          : 0;
        const padding =
          parseFloat(boxStyle.paddingInlineStart || '0') +
          parseFloat(boxStyle.paddingInlineEnd || '0');
        return {
          shown: el.clientWidth,
          // Unsqueezed width of the whole line: the box is `nowrap` and clipped,
          // so this is independent of how narrow it has been made.
          natural: el.scrollWidth,
          nameFloor: parseFloat(boxStyle.minWidth) - iconCost - padding,
        };
      });
      expect(title, 'no page title rendered').not.toBeNull();
      const { shown, natural, nameFloor } = title!;
      // The floor is a real length above 600px, and the name outgrows it — so
      // neither assertion below is trivially true.
      expect(
        nameFloor,
        'the desktop title floor should reserve room for the name',
      ).toBeGreaterThan(0);
      expect(
        natural,
        'the name should be longer than the floor for this test',
      ).toBeGreaterThan(nameFloor);
      // 1px of slop for the sub-pixel widths a fractional layout produces.
      expect(
        shown,
        `only ${shown}px of a ${natural}px name survived a ${nameFloor}px floor`,
      ).toBeGreaterThanOrEqual(nameFloor - 1);
    }).toPass({ timeout: 10000 });
  });

  /**
   * What the floor costs, and the guarantee that makes it affordable: the row
   * scrolls, so every action is still reachable. The right panel is what
   * narrows the header most, and `.main-content` is `overflow: hidden` — before
   * the row scrolled, an action past its trailing edge was simply gone.
   *
   * Swept rather than sampled: this is a pair of thresholds in two stylesheets
   * and a single sample would let one drift.
   */
  test('keeps every action reachable as the window narrows', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1000, height: 860 });
    await openNotesPanel(page);

    for (const width of [900, 800, 720, 650]) {
      await page.setViewportSize({ width, height: 860 });

      await expect(async () => {
        const row = await page.evaluate(() => {
          const nav = document.querySelector(
            'nav.action-nav-right',
          ) as HTMLElement | null;
          const scroller = nav?.querySelector('.action-nav-scroll') as HTMLElement | null;
          if (!nav || !scroller) {
            return null;
          }
          // Put the row at rest first, because at these widths it does not
          // start there: the open panel this test needs deliberately reveals
          // the row's END, and that reveal is re-applied on every resize while
          // the panel's width animation still runs — so each step of the sweep
          // lands on a revealed row. The trailing action is scrolled into view
          // further down for the same reason. Neither is a layout fault, and
          // asserting "already at 0" would only assert that narrowing rewinds
          // a deliberate scroll, which is neither true nor wanted. What the
          // sweep is about is where the content sits once the row IS at rest.
          scroller.scrollLeft = 0;
          const navRect = nav.getBoundingClientRect();
          const scrollRect = scroller.getBoundingClientRect();
          const leading = scroller.querySelector('button');
          const wrapper = document.querySelector('main-header .wrapper') as HTMLElement;
          return {
            // The nav never spills past the header's own clip edge...
            insideWrapper: navRect.right <= wrapper.getBoundingClientRect().right + 0.5,
            // ...and at rest the leading action begins inside the scrollport,
            // so nothing is stranded left-of-origin, where `scrollLeft` clamps
            // at 0 and cannot bring it back. Asked of the rendered box rather
            // than of `scrollLeft`, which reads 0 in exactly that failure.
            atStart:
              !!leading && leading.getBoundingClientRect().left >= scrollRect.left - 1,
            overflowPx: Math.round(scroller.scrollWidth - scroller.clientWidth),
          };
        });
        expect(row, 'no action row rendered').not.toBeNull();
        expect(row!.insideWrapper, `nav spilled past the header at ${width}px`).toBe(
          true,
        );
        expect(row!.atStart, `row was not at rest at ${width}px`).toBe(true);
      }).toPass({ timeout: 10000 });

      // The scrollport can actually seat a control. `toBeInViewport()` alone
      // cannot say this: it passes on any non-zero intersection, so it went
      // green at 650px against a row whose content box was 0px wide and which
      // showed none of its seven actions — the very failure this test names.
      // A scroll affordance is worth nothing without room to scroll in.
      const seats = await page.evaluate(() => {
        const scroller = document.querySelector('.action-nav-scroll') as HTMLElement;
        const btn = scroller.querySelector('button');
        return {
          clientWidth: scroller.clientWidth,
          buttonWidth: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
        };
      });
      expect(
        seats.clientWidth,
        `action row had no room for a button at ${width}px`,
      ).toBeGreaterThanOrEqual(seats.buttonWidth);

      // ...and the trailing action really can be brought into view, whether or
      // not the row happens to overflow at this particular width. Down to the
      // button rather than the group around it: several action components are
      // `display: contents` and so have no box to put in the viewport.
      const last = page.locator('.action-nav-scroll button').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
    }
  });

  /**
   * Counters are the one group whose length the app does not bound, so below
   * 600px they collapse behind a single trigger instead of scrolling.
   *
   * The structural half of this is unit-tested; what only a real browser shows
   * is that the tray is not clipped. It is anchored outside `.action-nav-scroll`
   * precisely because that box is `overflow-x: auto`, which couples `overflow-y`
   * to a non-visible value — anchored inside, the tray would be cut off at the
   * row's own height and never seen.
   */
  test('collapses the counters into a tray that is not clipped, below 600px', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await createClickCounter(page, 'Water');
    await page.setViewportSize({ width: 400, height: 860 });

    // Not inline any more, and one trigger in their place.
    await expect(
      page.locator('.counters-action-group simple-counter-button'),
    ).toHaveCount(0);
    const trigger = page.locator('.mobile-dropdown-wrapper button').first();
    await expect(trigger).toBeVisible();

    await trigger.click();

    // Really on screen, not merely in the DOM behind a clip.
    const counter = page.locator('#mobile-simple-counter-menu simple-counter-button');
    await expect(counter).toHaveCount(1);
    await expect(counter).toBeInViewport();
  });

  /**
   * The tracked-task pill is free: it is absolutely positioned inside
   * `.pill-slot`, a `flex: 1 1 0` box that is exactly the row's leftover space,
   * so starting or stopping tracking must not shift a single action. This is
   * the invariant the placement exists to satisfy — assert the play button's
   * position is byte-identical with and without a tracked task.
   *
   * Also pins that the pill is not scrolled content. Inside
   * `.action-nav-scroll` it would sit beyond the inline-start clip edge, and
   * left-of-origin overflow cannot be scrolled back (`scrollLeft` clamps at 0)
   * — the bug that reverted `0a95482e64`.
   */
  test('never moves the action buttons when a task is tracked', async ({
    page,
    workViewPage,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(
      'A really quite long tracked task name that would eat the row',
    );

    const play = page.locator('play-button .play-btn');
    const idleX = Math.round((await play.boundingBox())!.x);

    await page.locator('.play-btn.tour-playBtn').first().click();
    const pill = page.locator('.current-task-title');
    await expect(pill).toBeVisible();

    expect(Math.round((await play.boundingBox())!.x)).toBe(idleX);
    await expect(page.locator('.action-nav-scroll .current-task-title')).toHaveCount(0);

    // Tucked under the play button rather than parked beside it: the pill's
    // trailing end runs past the button's leading edge, and the button paints
    // over it.
    const pillBox = (await pill.boundingBox())!;
    const playBox = (await play.boundingBox())!;
    expect(pillBox.x + pillBox.width).toBeGreaterThan(playBox.x);
    expect(pillBox.x + pillBox.width).toBeLessThan(playBox.x + playBox.width);
  });

  /**
   * A plain wheel scrolls the row.
   *
   * A vertical wheel does nothing to a horizontal-only scroller, so before this
   * the fade pointed at shift+wheel — a gesture most mouse users do not know,
   * while trackpad, touch and keyboard all reached the row fine. Asserted as
   * "the trailing action became reachable", not as a scroll offset, because the
   * offset is an implementation detail and the reachability is the promise.
   */
  test('scrolls the action row with a plain wheel', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 700, height: 860 });
    await openNotesPanel(page);

    const scroller = page.locator('.action-nav-scroll');
    await expect(async () => {
      const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(
        overflow,
        'the row needs to overflow for this test to mean anything',
      ).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Opening the panel clicks a button that lives inside this scroller, which
    // scrolls it into view — park the row before measuring the wheel.
    await scroller.evaluate((el) => {
      el.scrollLeft = 0;
    });
    expect(await scroller.evaluate((el) => Math.abs(el.scrollLeft))).toBe(0);

    await scroller.hover();
    await page.mouse.wheel(0, 240);

    await expect(async () => {
      const travelled = await scroller.evaluate((el) => Math.abs(el.scrollLeft));
      expect(travelled, 'a plain wheel should have moved the row').toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  /**
   * Shown only where the leftover genuinely fits it, asked as a container query
   * against `.pill-slot` rather than inferred from a viewport width — the old
   * 1080px cutoff hid the pill on windows with space to spare (#8818) while
   * saying nothing about the real slack, which depends on the context name, the
   * side nav and the right panel.
   *
   * Held at one window width across the show/hide pair on purpose: a ladder of
   * viewport sizes cannot tell the two rules apart, because every width that
   * has slack is also a wide window. Only holding the window still and taking
   * the slack away separates them.
   */
  test('shows the tracked-task pill only where the row has room for it', async ({
    page,
    workViewPage,
  }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('A tracked task with a fairly long name');
    await page.locator('.play-btn.tour-playBtn').first().click();

    const pill = page.locator('.current-task-title');

    // One window width, two answers -- which is the whole point, and the thing
    // a viewport rule cannot express. At 1100px the row has ~320px of leftover
    // and the pill shows.
    await expect(pill).toBeVisible();

    // Same 1100px window, but the notes panel now takes the leftover down to
    // zero, so the pill goes. This is the assertion that fails against the
    // 1080px cutoff it replaced: at 1100px that rule shows the pill, with
    // nowhere for it to sit (#8818 in reverse).
    await openNotesPanel(page);
    await expect(pill).toBeHidden();

    // Panel still open -- give the row its width back and the pill returns, so
    // it is tracking the slack rather than either input on its own.
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(pill).toBeVisible();
  });
});
