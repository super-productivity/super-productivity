/** Pixels of slack for rounding between layout and visual viewport values. */
const EPSILON = 2;

/**
 * Page-side viewport probe.
 *
 * `path` says how the page experienced the IME, relative to `baseline` (a probe
 * taken before the keyboard was raised):
 * - RESIZING: the layout viewport shrank (`innerHeight` dropped) — adjustResize-like.
 * - NON_RESIZING: `innerHeight` stayed, only the visual viewport shrank — the
 *   IME covers part of the layout viewport.
 * - NO_IME: neither shrank, so no keyboard covers the page and any geometry
 *   measured now says nothing about IME behavior.
 */
export const probeViewport = async (page, baseline) => {
  const raw = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    visualViewportHeight: window.visualViewport?.height ?? null,
    visualViewportOffsetTop: window.visualViewport?.offsetTop ?? null,
    visualViewportScale: window.visualViewport?.scale ?? null,
    devicePixelRatio: window.devicePixelRatio,
  }));
  const vvHeight = raw.visualViewportHeight ?? raw.innerHeight;
  let path = 'NO_IME';
  if (baseline && raw.innerHeight < baseline.innerHeight - EPSILON) {
    path = 'RESIZING';
  } else if (vvHeight < raw.innerHeight - EPSILON) {
    path = 'NON_RESIZING';
  }
  return { ...raw, path };
};
