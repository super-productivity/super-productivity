import type { Locator, Page } from '@playwright/test';

/**
 * A finger pan across `target`, as real touch input via CDP: synthetic
 * TouchEvents bypass `touch-action` and never scroll, so they cannot tell a
 * page swipe apart from a scroll the browser would have taken.
 *
 * `beforeRelease` runs with the finger still down, e.g. to assert what is
 * visible mid-pan. `holdMs` keeps the finger still before moving, which turns
 * the gesture into a long-press drag; `start` pins where the finger lands.
 */
export const touchPan = async (
  page: Page,
  target: Locator,
  deltaX: number,
  opts: {
    deltaY?: number;
    steps?: number;
    holdMs?: number;
    start?: { x: number; y: number };
    beforeRelease?: () => Promise<void>;
  } = {},
): Promise<void> => {
  const { deltaY = 0, steps = 12, holdMs = 0, beforeRelease } = opts;
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('touchPan: target has no bounding box');
  }
  // Start on the side the finger moves away from, so it stays on the target.
  const startX = opts.start?.x ?? (deltaX < 0 ? box.x + box.width - 30 : box.x + 30);
  const startY = opts.start?.y ?? box.y + Math.min(box.height / 2, 300);

  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, points: { x: number; y: number }[]): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points } as never);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    await send('touchStart', [{ x: startX, y: startY }]);
    if (holdMs) {
      await page.waitForTimeout(holdMs);
    }
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(16);
      const stepX = (deltaX * i) / steps;
      const stepY = (deltaY * i) / steps;
      await send('touchMove', [{ x: startX + stepX, y: startY + stepY }]);
    }
    if (beforeRelease) {
      await beforeRelease();
    }
    await send('touchEnd', []);
  } finally {
    await cdp.detach();
  }
};
