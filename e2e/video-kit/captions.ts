/**
 * Text layers over the recorded app: lower-third / centered captions, a caption
 * bar whose text swaps in place. Injected as fixed-position DOM so they render in real fonts, fade via CSS transitions, and stay diffable
 * as code (copy changes are PRs, not video-editor title clips).
 *
 *   const caption = await showOverlay(page, 'No account. No tracking.');
 *   await page.waitForTimeout(1500);
 *   await caption.hide();
 */
import type { Page } from '@playwright/test';
import { ensureStyle, FONT, hideById, type LayerHandle, nextLayerId, Z } from './dom';

export type CaptionPosition = 'center' | 'lower';

export type OverlayChip = {
  /** Inline SVG markup. Trusted, checked-in strings only: it is set as HTML. */
  svg?: string;
  /** Optional text after the icon. */
  label?: string;
};

export type OverlayOptions = {
  /** Vertical placement; defaults to 'lower' (lower-third title bar). */
  position?: CaptionPosition;
  /** Fade duration in ms, used for both show and hide. */
  fadeMs?: number;
  /** Optional row of icon chips below the text, e.g. integrations named in the copy. */
  chips?: OverlayChip[];
  /**
   * Return as soon as the fade-in starts instead of waiting for it. Use inside
   * a `cutToScene` callback so the fade plays during the reveal, not behind black.
   */
  noWait?: boolean;
};

export type CaptionHandle = LayerHandle & {
  /** Swaps the text in place with a short slide, keeping the bar on screen. */
  update: (text: string, options?: { fadeMs?: number }) => Promise<void>;
};

/** Class shared by every caption layer; `settleScene` clears them behind a cut. */
export const OVERLAY_CLASS = 'vk-overlay';

const STYLE_ID = 'vk-captions';
/** Marks the single persistent bar; a new `showCaption` replaces the old one. */
const CAPTION_CLASS = 'vk-caption';

const CSS = `
  .vk-overlay {
    position: fixed;
    left: 0;
    right: 0;
    /* Above fadeTransition's dim so text reads through it while the app changes. */
    z-index: ${Z.caption};
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--vk-fade-ms, 350ms) ease-out;
  }
  .vk-overlay.lower { bottom: 0; }
  .vk-overlay.center {
    top: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    transform: translateY(-50%);
  }
  .vk-overlay.visible { opacity: 1; }
  .vk-overlay-bg {
    background: var(--vk-caption-bg, #000);
    padding: min(32px, 3.2vw) min(60px, 6vw);
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translateY(24px);
    transition: transform var(--vk-fade-ms, 350ms) ease-out;
  }
  .vk-overlay.visible .vk-overlay-bg { transform: translateY(0); }
  .vk-overlay.center .vk-overlay-bg {
    border-radius: 14px;
    max-width: 80vw;
  }
  .vk-caption .vk-headline {
    transition:
      opacity var(--vk-caption-text-ms, 170ms) ease-out,
      transform var(--vk-caption-text-ms, 170ms) ease-out;
  }
  .vk-overlay-chips {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-top: 22px;
    flex-wrap: wrap;
  }
  .vk-overlay-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    color: #fff;
    font-family: ${FONT};
    font-weight: 500;
    font-size: clamp(22px, 2vw, 32px);
  }
  .vk-overlay-chip svg {
    width: 1.15em;
    height: 1.15em;
  }
`;

type CaptionDom = {
  id: string;
  text: string;
  className: string;
  fadeMs: number;
  chips: OverlayChip[];
  /** Existing nodes matching this selector are removed first. */
  replaces?: string;
};

/** Builds a caption bar and starts its fade-in. */
const mountCaption = async (page: Page, dom: CaptionDom): Promise<void> => {
  await page.evaluate((args) => {
    if (args.replaces) {
      document.querySelectorAll(args.replaces).forEach((node) => node.remove());
    }
    const el = document.createElement('div');
    el.id = args.id;
    el.className = args.className;
    el.style.setProperty('--vk-fade-ms', `${args.fadeMs}ms`);
    const bg = document.createElement('div');
    bg.className = 'vk-overlay-bg';
    const p = document.createElement('p');
    p.className = 'vk-headline';
    p.textContent = args.text;
    bg.appendChild(p);
    if (args.chips.length > 0) {
      const row = document.createElement('div');
      row.className = 'vk-overlay-chips';
      for (const chip of args.chips) {
        const span = document.createElement('span');
        span.className = 'vk-overlay-chip';
        // Trusted: chip SVGs are checked-in constants, never user input.
        if (chip.svg) span.insertAdjacentHTML('afterbegin', chip.svg);
        if (chip.label) {
          const label = document.createElement('span');
          label.textContent = chip.label;
          span.appendChild(label);
        }
        row.appendChild(span);
      }
      bg.appendChild(row);
    }
    el.appendChild(bg);
    document.body.appendChild(el);
    // Force a style flush before flipping `visible` so the transition runs.
    void el.offsetWidth;
    el.classList.add('visible');
  }, dom);
};

/** Shows a one-off caption. Several can coexist; each `hide()` removes its own. */
export const showOverlay = async (
  page: Page,
  text: string,
  options: OverlayOptions = {},
): Promise<LayerHandle> => {
  const position = options.position ?? 'lower';
  const fadeMs = options.fadeMs ?? 420;
  const id = nextLayerId('vk-overlay');
  await ensureStyle(page, STYLE_ID, CSS);
  await mountCaption(page, {
    id,
    text,
    className: `${OVERLAY_CLASS} ${position}`,
    fadeMs,
    chips: options.chips ?? [],
  });
  // Waiting for the fade keeps beat timing aligned with what is visible.
  if (!options.noWait) await page.waitForTimeout(fadeMs);
  return { hide: () => hideById(page, id, fadeMs) };
};

/**
 * Shows the single persistent caption bar, replacing any previous one. Unlike
 * `showOverlay`, its text can change in place via `update()`, so a montage
 * keeps one steady bar. A replaced bar's handle becomes a no-op.
 */
export const showCaption = async (
  page: Page,
  text: string,
  options: Pick<OverlayOptions, 'fadeMs' | 'noWait' | 'position'> = {},
): Promise<CaptionHandle> => {
  const position = options.position ?? 'lower';
  const fadeMs = options.fadeMs ?? 420;
  const id = nextLayerId(CAPTION_CLASS);
  await ensureStyle(page, STYLE_ID, CSS);
  await mountCaption(page, {
    id,
    text,
    className: `${OVERLAY_CLASS} ${CAPTION_CLASS} ${position}`,
    fadeMs,
    chips: [],
    replaces: `.${CAPTION_CLASS}`,
  });
  if (!options.noWait) await page.waitForTimeout(fadeMs);
  return {
    update: (nextText, updateOptions = {}) =>
      swapCaptionText(page, { id, text: nextText, fadeMs: updateOptions.fadeMs ?? 170 }),
    hide: () => hideById(page, id, fadeMs),
  };
};

const swapCaptionText = async (
  page: Page,
  swap: { id: string; text: string; fadeMs: number },
): Promise<void> => {
  const { text, fadeMs } = swap;
  const selector = `#${swap.id} .vk-headline`;
  // Slide the old text down and out...
  const shouldUpdate = await page.evaluate(
    (args) => {
      const textEl = document.querySelector<HTMLElement>(args.selector);
      if (!textEl || textEl.textContent === args.text) return false;
      textEl.style.setProperty('--vk-caption-text-ms', `${args.fadeMs}ms`);
      textEl.style.opacity = '0';
      textEl.style.transform = 'translateY(8px)';
      return true;
    },
    { selector, text, fadeMs },
  );
  if (!shouldUpdate) return;
  await page.waitForTimeout(fadeMs);
  // ...then drop the new text in from above.
  await page.evaluate(
    (args) => {
      const textEl = document.querySelector<HTMLElement>(args.selector);
      if (!textEl) return;
      textEl.textContent = args.text;
      textEl.style.transform = 'translateY(-8px)';
      void textEl.offsetWidth;
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
    },
    { selector, text },
  );
  await page.waitForTimeout(fadeMs);
};
