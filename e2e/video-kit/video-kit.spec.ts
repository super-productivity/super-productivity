/**
 * Behavior tests for the kit on routed static pages (no app server):
 *   npm run video:kit-test
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  createCamera,
  createPointer,
  cutToScene,
  fadeTransition,
  frameTarget,
  installCursor,
  installTapRipple,
  markScene,
  nextScene,
  onSceneStart,
  showCaption,
  showEndCard,
  showOverlay,
  showStill,
  timeLapse,
  typeText,
} from './index';

const ORIGIN = 'http://vk.test';

const pageHtml = (name: string): string => `<!doctype html>
<html><head><style>
  html, body { margin: 0; height: 100%; background: #fff; }
  app-root { display: block; width: 100vw; height: 100vh; position: relative; }
  .box { position: absolute; width: 120px; height: 80px; background: #36c; }
</style></head><body><app-root>
  <h1>${name}</h1>
  <div class="box" id="top-left" style="left: 40px; top: 40px"></div>
  <div class="box" id="mid" style="left: 580px; top: 320px"></div>
  <div class="box" id="low" style="left: 580px; top: 560px"></div>
  <input id="field" style="position: absolute; left: 40px; top: 400px" />
</app-root></body></html>`;

const solidSvg = (color: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`,
  )}`;

/** Brightest channel value (0-255) in a screenshot, decoded in-page to avoid a PNG dependency. */
const maxBrightness = async (page: Page, png: Buffer): Promise<number> =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    }
    return max;
  }, png.toString('base64'));

const centerOf = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  const half = { w: box.width / 2, h: box.height / 2 };
  return { x: box.x + half.w, y: box.y + half.h };
};

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'home';
    return route.fulfill({ contentType: 'text/html', body: pageHtml(name) });
  });
});

test.describe('layer ownership', () => {
  test('a card handle hides only its own card', async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    await showEndCard(page, { title: 'Card A' }, { fadeMs: 60 });
    const b = await showEndCard(page, { title: 'Card B' }, { fadeMs: 60 });
    await b.hide();
    await expect(page.locator('.vk-end-card', { hasText: 'Card B' })).toHaveCount(0);
    await expect(page.locator('.vk-end-card', { hasText: 'Card A' })).toHaveCount(1);
  });

  test('a replaced caption handle cannot touch its replacement', async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    const first = await showCaption(page, 'One', { fadeMs: 60 });
    await showCaption(page, 'Two', { fadeMs: 60 });
    await first.update('Stale');
    await first.hide();
    await expect(page.locator('.vk-caption')).toHaveCount(1);
    await expect(page.locator('.vk-caption')).toHaveText('Two');
  });

  test('a replaced still handle cannot hide the new still', async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    const first = await showStill(page, solidSvg('red'), { fadeMs: 60 });
    await showStill(page, solidSvg('blue'), { fadeMs: 60 });
    await first.hide();
    await expect(page.locator(`img[src="${solidSvg('blue')}"]`).first()).toBeVisible();
  });
});

test.describe('paused page clock', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.goto(`${ORIGIN}/`);
    await page.clock.pauseAt(Date.now() + 60_000);
  });

  test('hidden layers are still removed', async ({ page }) => {
    const caption = await showOverlay(page, 'Paused', { fadeMs: 60 });
    const card = await showEndCard(page, { title: 'Paused card' }, { fadeMs: 60 });
    await caption.hide();
    await card.hide();
    await expect(page.locator('.vk-overlay, .vk-end-card')).toHaveCount(0);
  });

  test('stills crossfade and resolve', async ({ page }) => {
    const stills = await showStill(page, solidSvg('red'), { fadeMs: 80 });
    await stills.crossfadeTo(solidSvg('blue'));
    await stills.hide();
    await expect(page.locator('img')).toHaveCount(0);
  });
});

test('cutToScene keeps the frame black across a full navigation', async ({ page }) => {
  await page.goto(`${ORIGIN}/first`);
  let brightnessBehindCut = -1;
  await cutToScene(
    page,
    async () => {
      await page.goto(`${ORIGIN}/second`);
      brightnessBehindCut = await maxBrightness(page, await page.screenshot());
    },
    { fadeMs: 60 },
  );
  expect(brightnessBehindCut).toBeLessThan(8);
  await expect(page.locator('h1')).toHaveText('second');
  expect(await maxBrightness(page, await page.screenshot())).toBeGreaterThan(200);
  // The cover must not come back on the next, unrelated navigation.
  await page.goto(`${ORIGIN}/third`);
  expect(await maxBrightness(page, await page.screenshot())).toBeGreaterThan(200);
});

test('a failed cut reveals the page and clears the cover across navigation', async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/first`);
  const error = new Error('scene setup failed');
  await expect(
    cutToScene(
      page,
      async () => {
        await page.goto(`${ORIGIN}/second`);
        throw error;
      },
      { fadeMs: 0 },
    ),
  ).rejects.toBe(error);
  expect(await maxBrightness(page, await page.screenshot())).toBeGreaterThan(200);
  await page.goto(`${ORIGIN}/third`);
  expect(await maxBrightness(page, await page.screenshot())).toBeGreaterThan(200);
});

test('a failed dim transition removes its layer and preserves the error', async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/`);
  const error = new Error('scene setup failed');
  await expect(
    fadeTransition(
      page,
      () => {
        throw error;
      },
      { fadeMs: 0 },
    ),
  ).rejects.toBe(error);
  await expect(page.locator('#vk-dim')).toHaveCount(0);
});

test.describe('pointer', () => {
  test('fromLeft durationMs covers the whole journey', async ({ page }) => {
    await installCursor(page);
    await page.goto(`${ORIGIN}/`);
    const pointer = createPointer(page);
    await pointer.glideTo(page.locator('#top-left'), { durationMs: 100 });
    const startedAt = Date.now();
    await pointer.glideTo(page.locator('#mid'), { durationMs: 1000, fromLeft: true });
    // One 1000ms journey plus per-move round-trips; the bug (two full legs) took
    // ~2000ms. The wide gap absorbs round-trip overhead on a loaded machine.
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  test('glides end exactly on the target center', async ({ page }) => {
    await installCursor(page);
    await page.goto(`${ORIGIN}/`);
    const pointer = createPointer(page);
    await pointer.glideTo(page.locator('#top-left'), { durationMs: 100 });
    await pointer.glideTo(page.locator('#low'), { durationMs: 200 });
    const target = await centerOf(page.locator('#low'));
    const cursor = await page
      .locator('#vk-cursor')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform));
    expect(cursor.m41).toBeCloseTo(target.x, 0);
    expect(cursor.m42).toBeCloseTo(target.y, 0);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('one tap draws one ripple', async ({ page }) => {
    await installTapRipple(page);
    await page.goto(`${ORIGIN}/`);
    await page.touchscreen.tap(200, 200);
    await expect(page.locator('.vk-tap-ripple')).toHaveCount(1);
    // Removed once faded out, even with timers frozen.
    await expect(page.locator('.vk-tap-ripple')).toHaveCount(0);
  });
});

test.describe('camera', () => {
  const frame = { vw: 1000, vh: 800, stageLeft: 0, stageTop: 0, stageWidth: 1000 };

  test('frameTarget centers the target in the area above a covered bottom inset', () => {
    const box = { x: 450, y: 350, width: 100, height: 100 };
    const view = frameTarget({
      box,
      view: { scale: 1, x: 0, y: 0 },
      scale: 2,
      frame: {
        ...frame,
        stageHeight: 800,
        insets: { top: 0, right: 0, bottom: 200, left: 0 },
      },
    });
    // Target center (500, 400) lands at the safe-area center (500, 300):
    // screen = offset + scale × point.
    const scaled = { x: 2 * 500, y: 2 * 400 };
    expect(view.x + scaled.x).toBeCloseTo(500);
    expect(view.y + scaled.y).toBeCloseTo(300);
  });

  test('frameTarget never pulls the stage off an uncovered edge', () => {
    const view = frameTarget({
      box: { x: 0, y: 0, width: 50, height: 50 },
      view: { scale: 1, x: 0, y: 0 },
      scale: 2,
      frame: {
        ...frame,
        stageHeight: 800,
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    });
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBeCloseTo(0);
  });

  test('auto-framing keeps the target clear of a lower caption', async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    const caption = await showOverlay(page, 'A caption covering the lower third', {
      fadeMs: 0,
    });
    const camera = createCamera(page, 'app-root');
    await camera.zoomTo(page.locator('#low'), { scale: 2, durationMs: 0 });
    const target = await page.locator('#low').boundingBox();
    const bar = await page.locator('.vk-overlay').boundingBox();
    expect(target!.y + target!.height).toBeLessThanOrEqual(bar!.y);
    await caption.hide();
    await camera.reset({ durationMs: 0 });
  });

  test('auto-framing refuses a target too wide to magnify', async ({ page }) => {
    await page.goto(`${ORIGIN}/`);
    const camera = createCamera(page, 'app-root');
    await expect(camera.zoomTo(page.locator('h1'), { durationMs: 0 })).rejects.toThrow(
      /too large to magnify/,
    );
  });

  test('a glide refuses a target the camera panned off-screen', async ({ page }) => {
    await installCursor(page);
    await page.goto(`${ORIGIN}/`);
    const camera = createCamera(page, 'app-root');
    await camera.zoomTo(page.locator('#top-left'), { scale: 2.5, durationMs: 0 });
    const pointer = createPointer(page);
    await expect(pointer.glideTo(page.locator('#low'))).rejects.toThrow(
      /outside the frame/,
    );
  });
});

test('timeLapse advances the page clock in steps that each fire due timers', async ({
  page,
}) => {
  await page.clock.install({ time: 0 });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => {
    const w = window as unknown as { ticks: number };
    w.ticks = 0;
    setInterval(() => w.ticks++, 1000);
  });
  await timeLapse(page, 5 * 60_000, { stepMs: 60_000, frameMs: 0 });
  // One jump would fire the interval once; five steps fire it five times.
  expect(await page.evaluate(() => (window as unknown as { ticks: number }).ticks)).toBe(
    5,
  );
  expect(await page.evaluate(() => Date.now())).toBeGreaterThanOrEqual(5 * 60_000);
});

test('nextScene navigates behind black, reveals its caption and reports the scene', async ({
  page,
}) => {
  await installCursor(page);
  await page.goto(`${ORIGIN}/first`);
  const pointer = createPointer(page);
  await pointer.glideTo(page.locator('#mid'), { durationMs: 100 });
  const labels: string[] = [];
  onSceneStart(page, (label) => labels.push(label));
  const caption = await nextScene(page, {
    caption: 'Second scene.',
    pointer,
    fadeMs: 60,
    setup: () => page.goto(`${ORIGIN}/second`),
  });
  await expect(page.locator('h1')).toHaveText('second');
  await expect(page.locator('.vk-overlay')).toHaveText('Second scene.');
  await expect(page.locator('body')).toHaveClass(/vk-cursor-hidden/);
  markScene(page, 'End card.');
  expect(labels).toEqual(['Second scene.', 'End card.']);
  await caption?.hide();
});

test('typeText types exactly the text and a glide brings the cursor back', async ({
  page,
}) => {
  await installCursor(page);
  await page.goto(`${ORIGIN}/`);
  const pointer = createPointer(page);
  await pointer.glideTo(page.locator('#field'), { durationMs: 100 });
  await page.locator('#field').click();
  await typeText(page, 'Ship it, today!', { delayMs: 5 });
  await expect(page.locator('#field')).toHaveValue('Ship it, today!');
  await expect(page.locator('body')).toHaveClass(/vk-cursor-hidden/);
  await pointer.glideTo(page.locator('#mid'), { durationMs: 100 });
  await expect(page.locator('body')).not.toHaveClass(/vk-cursor-hidden/);
});
