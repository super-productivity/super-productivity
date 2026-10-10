import { StageError } from './stage-error.mjs';
import { probeViewport } from './viewport.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const poll = async (fn, timeoutMs, intervalMs = 150) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) return value;
    await sleep(intervalMs);
  }
};

/** Device screen size in physical pixels (an override, if set, wins). */
const screenSize = async (adb) => {
  const out = await adb.shell('wm', 'size');
  const sizes = [...out.matchAll(/(\d+)x(\d+)/g)];
  if (!sizes.length)
    throw new StageError('calibration', `cannot parse 'wm size': ${out}`);
  const [, w, h] = sizes[sizes.length - 1];
  return { width: Number(w), height: Number(h) };
};

/**
 * IME helpers. Finding 3: `element.focus()` and CDP input never raise the
 * Android soft keyboard, so the element is tapped with a real `adb shell input
 * tap`, and the tap is only trusted once `document.activeElement` confirms it.
 */
export const createIme = ({ page, adb }) => {
  let offset = null;

  /**
   * Maps CSS client coordinates to screen pixels by measuring one real tap:
   * tap the screen centre, read the `touchstart` client point it produced.
   * This absorbs the status bar, Chrome's toolbar and devicePixelRatio
   * without guessing any of them. The touch is swallowed so nothing reacts.
   */
  const calibrate = async () => {
    if (offset) return offset;
    const { width, height } = await screenSize(adb);
    await page.evaluate(() => {
      window.__androidVerifyTouch = null;
      window.addEventListener(
        'touchstart',
        (ev) => {
          const t = ev.touches[0];
          window.__androidVerifyTouch = { x: t.clientX, y: t.clientY };
          ev.preventDefault();
          ev.stopImmediatePropagation();
        },
        { capture: true, once: true, passive: false },
      );
    });
    const sx = width / 2;
    const sy = height / 2;
    await adb.tap(sx, sy);
    const touch = await poll(
      () => page.evaluate(() => window.__androidVerifyTouch),
      3000,
    );
    if (!touch) {
      throw new StageError('calibration', 'calibration tap never reached the page', {
        screen: { width, height },
      });
    }
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    offset = { x: sx / dpr - touch.x, y: sy / dpr - touch.y, dpr };
    return offset;
  };

  /**
   * Taps `selector` for real, asserts it became `document.activeElement`, then
   * waits for the IME and for the viewport to settle.
   *
   * The activeElement assertion is load-bearing: a missed tap still yields
   * plausible-looking geometry, so it must fail the run instead.
   */
  const tapAndOpen = async (selector, { imeTimeoutMs = 5000 } = {}) => {
    const baseline = await probeViewport(page);
    const off = await calibrate();
    // Drop any programmatic focus, so only the tap can make the target active.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    const rect = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
    if (!rect || rect.width === 0 || rect.height === 0) {
      throw new StageError('tap-target-missing', `no visible element for ${selector}`, {
        rect,
      });
    }
    const screenPoint = {
      x: (rect.x + rect.width / 2 + off.x) * off.dpr,
      y: (rect.y + rect.height / 2 + off.y) * off.dpr,
    };
    await adb.tap(screenPoint.x, screenPoint.y);

    const isActive = () =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const active = document.activeElement;
        return !!el && !!active && (el === active || el.contains(active));
      }, selector);
    if (!(await poll(isActive, 2000))) {
      // Describe the element structurally only — never log user content.
      const activeElement = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName.toLowerCase()}.${[...a.classList].join('.')}` : null;
      });
      throw new StageError('tap-missed', `tap did not focus ${selector}`, {
        rect,
        screenPoint,
        offset: off,
        activeElement,
      });
    }

    const imeShown = await poll(() => adb.isImeShown(), imeTimeoutMs, 250);
    if (!imeShown) {
      throw new StageError(
        'ime-not-shown',
        'soft keyboard did not appear (AVD needs hw.keyboard=no, see README finding 4)',
        { rect, screenPoint },
      );
    }

    // The keyboard animates in; wait until the page sees it and two probes agree.
    // Still NO_IME after the loop is reported, not thrown — the scenario decides.
    let viewport = await probeViewport(page, baseline);
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const next = await probeViewport(page, baseline);
      const settled =
        next.path !== 'NO_IME' &&
        next.innerHeight === viewport.innerHeight &&
        next.visualViewportHeight === viewport.visualViewportHeight;
      viewport = next;
      if (settled) break;
    }
    return { baseline, viewport, rect, screenPoint, offset: off, imeShown };
  };

  return { calibrate, tapAndOpen };
};
