/**
 * Shared plumbing for the kit's DOM layers: stacking order, style injection,
 * and the fade-out-then-remove pattern every layer uses.
 */
import type { Page } from '@playwright/test';

/**
 * Stacking order of kit layers. All sit far above app UI; within the kit,
 * full-screen cards cover captions, and the black cut layer covers everything.
 */
export const Z = {
  cursor: 2147483640,
  dim: 2147483640,
  still: 2147483640,
  caption: 2147483641,
  logoCard: 2147483645,
  endCard: 2147483646,
  black: 2147483647,
} as const;

/**
 * Theming hooks: set these on `:root` in a project stylesheet to restyle every
 * layer without forking the kit. Fallbacks are the defaults.
 */
export const FONT = 'var(--vk-font, Roboto, "Inter", system-ui, sans-serif)';
export const MONO_FONT =
  "var(--vk-mono-font, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace)";

/**
 * One headline size across captions and cards gives the video a single voice.
 * `!important` outranks app typography such as `.mat-typography h1` (0,1,1).
 */
const BASE_CSS = `
  .vk-headline {
    color: var(--vk-headline-color, #fff);
    font-family: ${FONT};
    font-weight: 600 !important;
    font-size: clamp(24px, 6.4vw, 96px) !important;
    letter-spacing: -0.02em !important;
    line-height: 1.15 !important;
    text-align: center;
    margin: 0;
  }
`;

/**
 * Injects a layer's `<style>` (plus the shared base rules) once per page;
 * later calls with the same id are no-ops.
 */
export const ensureStyle = async (page: Page, id: string, css: string): Promise<void> => {
  await page.evaluate(
    (sheets) => {
      for (const sheet of sheets) {
        if (document.getElementById(sheet.id)) continue;
        const style = document.createElement('style');
        style.id = sheet.id;
        style.textContent = sheet.css;
        document.head.appendChild(style);
      }
    },
    [
      { id: 'vk-base-style', css: BASE_CSS },
      { id: `${id}-style`, css },
    ],
  );
};

let layerCounter = 0;

/**
 * A page-unique id per layer instance, so a handle only ever reaches its own
 * layer: a stale handle is a no-op instead of hiding its replacement.
 */
export const nextLayerId = (prefix: string): string => {
  layerCounter += 1;
  return `${prefix}-${layerCounter}`;
};

/**
 * Starts the element's CSS fade-out (drops `.visible`, zeroes an inline
 * opacity), waits for it, and removes the node when its opacity transition
 * ends. Clock policy: the kit never relies on page timers for correctness,
 * because a paused Playwright clock freezes them while CSS transitions keep
 * running. Waits happen in Node; removal follows `transitionend`.
 */
export const hideById = async (page: Page, id: string, fadeMs: number): Promise<void> => {
  await page.evaluate(
    (args) => {
      const el = document.getElementById(args.id);
      if (!el) return;
      const remove = (e: TransitionEvent): void => {
        if (e.target === el && e.propertyName === 'opacity') el.remove();
      };
      el.addEventListener('transitionend', remove);
      // Fires instead of transitionend when the fade-in had barely started.
      el.addEventListener('transitioncancel', remove);
      el.classList.remove('visible');
      el.style.opacity = '0';
      if (args.fadeMs <= 0) el.remove();
    },
    { id, fadeMs },
  );
  await page.waitForTimeout(fadeMs);
};

export type LayerHandle = {
  hide: () => Promise<void>;
};
