// #5146: with the IME up, the add-task bar's short-syntax dropdown must render
// inside the area that is really visible. MentionListComponent.checkBounds
// measures against `window.visualViewport`, which a desktop Playwright run can
// never split from the layout viewport — only a real IME on a real screen does.
// The unit spec (`describe('drop direction')` in mention-list.component.spec.ts)
// stubs that split; this checks what Android actually reports.
//
// `@` (due-date suggestions) always has entries, so no data setup is needed.

const INPUT = 'add-task-bar.global .main-input';
const LIST = 'mention-list ul';
/** Rounding slack in CSS px. */
const SLACK = 1;

export default async ({ page, adb, ime, probe, StageError }) => {
  // The emulator reports `pointer: fine` (the host mouse), so the app boots as
  // a hybrid device in mouse mode. A real touch flips InputIntentService to
  // touch, as a user's first tap would; calibrate's tap is real and swallowed.
  await ime.calibrate();

  // Premise: on a real touch device InputIntentService sets this class, which
  // pins the global add-task bar to the bottom — the #5146 layout.
  const isTouchPrimary = await page.evaluate(() =>
    document.body.classList.contains('isTouchPrimary'),
  );
  if (!isTouchPrimary) {
    throw new StageError('premise', 'body.isTouchPrimary is not set on the device');
  }

  // Below 600px the header button is absent and the bottom nav FAB opens the
  // bar instead. Clicked via the DOM: a Playwright click is a CDP mouse event,
  // whose pointermove flips InputIntentService to mouse and drops the premise.
  const addBtn = page.locator('.add-task-button, .tour-addBtn').first();
  await addBtn.waitFor({ state: 'visible', timeout: 20_000 });
  await addBtn.evaluate((el) => el.click());
  await page.locator(INPUT).first().waitFor({ state: 'visible', timeout: 10_000 });

  const tap = await ime.tapAndOpen(INPUT);
  // Typed in one burst, Gboard is still composing the previous word when `@`
  // arrives, and MentionDirective ignores composing keydowns. A pause after the
  // space lets the composition end, so `@` lands as a plain keydown.
  await adb.text('test task ');
  await new Promise((r) => setTimeout(r, 800));
  await adb.text('@');

  try {
    await page
      .locator(`${LIST}:not([hidden]) li`)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new StageError('dropdown-not-shown', 'mention list never showed entries');
  }
  // checkBounds positions the list in a requestAnimationFrame; let it land.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  const viewport = await probe(tap.baseline);
  const stillTouchPrimary = await page.evaluate(() =>
    document.body.classList.contains('isTouchPrimary'),
  );
  const geometry = await page.evaluate(
    ({ list, input }) => {
      const toRect = (r) => ({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
      });
      const ul = document.querySelector(list);
      const bar = document.querySelector('add-task-bar.global');
      const field = document.querySelector(input);
      return {
        listRect: toRect(ul.getBoundingClientRect()),
        barRect: bar ? toRect(bar.getBoundingClientRect()) : null,
        inputRect: field ? toRect(field.getBoundingClientRect()) : null,
        dropUp: ul.classList.contains('mention-dropdown'),
        listMaxHeight: ul.style.maxHeight || null,
        itemRects: [...ul.querySelectorAll('li')].map((li) =>
          toRect(li.getBoundingClientRect()),
        ),
      };
    },
    { list: LIST, input: INPUT },
  );

  const visibleTop = viewport.visualViewportOffsetTop ?? 0;
  const visibleBottom =
    visibleTop + (viewport.visualViewportHeight ?? viewport.innerHeight);
  // An item counts as visible when it lies within both the visible area and
  // the (scrollable, possibly capped) list box.
  const itemsVisible = geometry.itemRects.filter(
    (r) =>
      r.top >= Math.max(visibleTop, geometry.listRect.top) - SLACK &&
      r.bottom <= Math.min(visibleBottom, geometry.listRect.bottom) + SLACK,
  ).length;

  const checks = {
    stillTouchPrimary,
    imeCoversPage: viewport.path !== 'NO_IME',
    hasItems: geometry.itemRects.length > 0,
    listTopVisible: geometry.listRect.top >= visibleTop - SLACK,
    listBottomVisible: geometry.listRect.bottom <= visibleBottom + SLACK,
    someItemVisible: itemsVisible > 0,
  };

  return {
    pass: Object.values(checks).every(Boolean),
    measurements: {
      path: viewport.path,
      innerHeight: viewport.innerHeight,
      visualViewportHeight: viewport.visualViewportHeight,
      visualViewportOffsetTop: viewport.visualViewportOffsetTop,
      visibleTop,
      visibleBottom,
      listRect: geometry.listRect,
      dropUp: geometry.dropUp,
      listMaxHeight: geometry.listMaxHeight,
      itemCount: geometry.itemRects.length,
      itemsVisible,
      barRect: geometry.barRect,
      inputRect: geometry.inputRect,
      checks,
      viewport,
      baseline: tap.baseline,
      tap: { screenPoint: tap.screenPoint, offset: tap.offset, imeShown: tap.imeShown },
    },
  };
};
