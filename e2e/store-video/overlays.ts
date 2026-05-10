/**
 * Text overlays for marketing-reel beats. Injected as fixed-position DOM via
 * `page.evaluate()` so they render in the app's actual fonts, layer cleanly on
 * the live UI, fade in/out via CSS transitions, and stay diffable as code
 * (copy changes are PRs, not Kdenlive title clips).
 *
 *   const overlay = await showOverlay(page, 'No account. No tracking.');
 *   await page.waitForTimeout(1500);
 *   await overlay.hide();
 *
 * For the closing brand frame, use `showEndCard` instead — full-viewport,
 * solid backdrop, multi-line layout.
 */

import type { Page } from '@playwright/test';

export type OverlayPosition = 'center' | 'lower';

export type OverlayChip = {
  /** Inline SVG string (use one of the `LOGOS` constants below). */
  svg?: string;
  /** Optional text after the icon. */
  label?: string;
};

export type OverlayOptions = {
  /** Vertical placement; defaults to 'lower' (lower-third title bar). */
  position?: OverlayPosition;
  /** Fade transition duration in ms (applied to both show and hide). */
  fadeMs?: number;
  /**
   * Optional row of icon chips below the text. Used by beats that name
   * external integrations (GitHub, Jira, …) — chips visually reinforce the
   * copy without forcing the viewer to parse it.
   */
  chips?: OverlayChip[];
  /**
   * If true, return as soon as the DOM is set up (the visible class has
   * been added so the fade-in is now running). The caller is responsible
   * for letting it play out — useful when this call lands inside a
   * `cutToScene` callback so the fade plays *during* the fade-from-black.
   */
  noWait?: boolean;
};

/**
 * Pre-built brand SVGs (Simple Icons) plus a Material "more" glyph. Inlined
 * here so overlays render with no network fetch and no asset pipeline. Trust
 * boundary: these strings are checked into the repo, not user input — safe
 * for innerHTML.
 */
export const LOGOS = {
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  gitlab:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"/></svg>',
  jira: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129V13.03a5.218 5.218 0 0 0 5.215 5.214V6.761a1.001 1.001 0 0 0-1.001-1.004zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z"/></svg>',
  trello:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.147 0H2.853A2.86 2.86 0 0 0 0 2.853v18.294A2.86 2.86 0 0 0 2.853 24h18.294A2.86 2.86 0 0 0 24 21.147V2.853A2.86 2.86 0 0 0 21.147 0M10.34 18.66a.94.94 0 0 1-.94.94H4.51a.94.94 0 0 1-.94-.94V4.46a.94.94 0 0 1 .94-.94h4.89a.94.94 0 0 1 .94.94zm10.09-6.7a.94.94 0 0 1-.94.94H14.6a.94.94 0 0 1-.94-.94V4.46a.94.94 0 0 1 .94-.94h4.89a.94.94 0 0 1 .94.94z"/></svg>',
  linear:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M.403 13.795A12 12 0 0 0 10.205 23.597zM.014 11.166a12 12 0 0 1 13.156-12.971l1.236 1.235L1.286 12.557 0 11.272a12 12 0 0 1 .014-.106m1.638-3.32a12 12 0 0 1 6.094-6.094l8.68 8.68-6.095 6.095zm5.79 13.998l9.992-9.992a12 12 0 0 0 5.93-2.876c.044-.04.087-.08.13-.121q.063-.06.124-.123c.04-.043.082-.087.122-.13a12 12 0 0 0 2.876-5.93z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>',
} as const;

export type OverlayHandle = {
  hide: () => Promise<void>;
};

export type CaptionHandle = OverlayHandle & {
  update: (text: string, options?: { fadeMs?: number }) => Promise<void>;
};

/**
 * One line on the end card. Plain string renders as-is. The object form
 * animates the `{n}` placeholder in `template` from 0 up to `to` over the
 * card's reveal — gives an otherwise static frame a beat of motion.
 *   { template: '★ {n}K on GitHub', to: 19 }            → "★ 19K on GitHub"
 *   { template: '{n} ★ on Google Play', to: 4.8, decimals: 1 }
 *
 * Animation requires the page clock to be running (call `page.clock.resume()`
 * in the spec before showing the card if it was previously installed).
 */
export type EndCardStat = string | { template: string; to: number; decimals?: number };

export type EndCardContent = {
  title: string;
  subtitle?: string;
  /** One line per entry. Rendered stacked under the subtitle. */
  stats?: EndCardStat[];
  /**
   * Optional logo above the title. URL is served by the dev server.
   * `monochrome: true` applies a brightness/invert filter so the image
   * renders as a pure-white silhouette on the dark backdrop.
   */
  logo?: { src: string; alt?: string; monochrome?: boolean };
};

export type IntegrationsLogo = {
  /** Inline SVG string from `LOGOS`. */
  svg: string;
  label: string;
  /**
   * Optional brand color for the SVG. Maps to CSS `color`, which the SVGs
   * inherit via `fill="currentColor"`. Defaults to white.
   */
  color?: string;
};

export type IntegrationsCardContent = {
  title: string;
  /** Logo grid; works best with 3-6 entries. */
  logos: IntegrationsLogo[];
  /** Optional small text below the grid (e.g. "+ more integrations"). */
  subtitle?: string;
};

const STYLE_ID = '__sp-video-overlay-style';
const OVERLAY_ID_PREFIX = '__sp-video-overlay-';
const END_CARD_ID = '__sp-video-end-card';
const CAPTION_ID = '__sp-video-caption';

let overlayCounter = 0;

const ensureStyleInjected = async (page: Page): Promise<void> => {
  await page.evaluate((id) => {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .__sp-video-overlay {
        position: fixed;
        left: 0;
        right: 0;
        /* Above fadeTransition (2147483640) so overlay text reads through the
           dim while the underlying app changes. End/integration cards are
           higher still so they cover the overlay when they take over. */
        z-index: 2147483641;
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--__sp-fade-ms, 350ms) ease-out;
      }
      .__sp-video-overlay.lower { bottom: 0; }
      .__sp-video-overlay.center {
        top: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        transform: translateY(-50%);
      }
      .__sp-video-overlay.visible { opacity: 1; }
      .__sp-video-overlay-bg {
        background: #000;
        padding: 32px 60px;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translateY(24px);
        transition: transform var(--__sp-fade-ms, 350ms) ease-out;
      }
      .__sp-video-overlay.visible .__sp-video-overlay-bg {
        transform: translateY(0);
      }
      .__sp-video-caption .__sp-video-overlay-text {
        transition:
          opacity var(--__sp-caption-text-ms, 170ms) ease-out,
          transform var(--__sp-caption-text-ms, 170ms) ease-out;
      }
      .__sp-video-overlay.center .__sp-video-overlay-bg {
        border-radius: 14px;
        max-width: 80vw;
      }
      .__sp-video-overlay-text,
      .__sp-video-int-card-title,
      .__sp-video-end-card-title {
        color: #fff;
        font-family: Roboto, "Inter", system-ui, sans-serif;
        font-weight: 600 !important;
        /* All "main text" across the reel renders at one size — single voice.
           !important guards against .mat-typography h1 (specificity 0,1,1)
           which would otherwise outrank our class selector. */
        font-size: clamp(48px, 6.4vw, 96px) !important;
        letter-spacing: -0.02em !important;
        line-height: 1.15 !important;
        text-align: center;
        margin: 0;
      }
      .__sp-video-overlay-chips {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-top: 22px;
        flex-wrap: wrap;
      }
      .__sp-video-overlay-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 18px;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 999px;
        color: #fff;
        font-family: Roboto, "Inter", system-ui, sans-serif;
        font-weight: 500;
        font-size: clamp(22px, 2vw, 32px);
      }
      .__sp-video-overlay-chip svg {
        width: 1.15em;
        height: 1.15em;
      }
      .__sp-video-end-card {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: linear-gradient(135deg, #0a0a14 0%, #131626 100%);
        opacity: 0;
        transition: opacity var(--__sp-fade-ms, 250ms) ease-out;
        pointer-events: none;
        font-family: Roboto, "Inter", system-ui, sans-serif;
        padding: 72px;
      }
      .__sp-video-end-card.visible { opacity: 1; }
      .__sp-video-end-card-logo {
        width: clamp(160px, 22vw, 260px);
        height: clamp(160px, 22vw, 260px);
        margin: 0 0 56px;
        object-fit: contain;
      }
      .__sp-video-end-card-logo.monochrome {
        /* brightness(0) flattens any rasterized PNG to black; invert(1) flips
           it to a pure-white silhouette. For SVGs with no fill (sp.svg) this
           also produces a clean white mark on the dark backdrop. */
        filter: brightness(0) invert(1);
      }
      .__sp-video-end-card-title {
        margin: 0 0 40px;
      }
      .__sp-video-end-card-subtitle {
        color: #c8cce0;
        font-weight: 500;
        font-size: clamp(36px, 3.5vw, 60px);
        letter-spacing: -0.01em;
        margin: 0;
      }
      .__sp-video-end-card-stats {
        margin-top: 44px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        align-items: center;
      }
      .__sp-video-end-card-stat {
        color: #9da2ba;
        font-weight: 500;
        font-size: clamp(34px, 3vw, 52px);
        margin: 0;
        white-space: nowrap;
      }
      /* The platforms list (third stat) is much longer than the animated
         "★ 19K" / "4.8 ★" lines and would wrap at the bigger size. Render
         it at a step smaller so it stays on one line without forcing the
         shorter stats to also shrink. */
      .__sp-video-end-card-stat:nth-child(3) {
        font-size: clamp(24px, 2.2vw, 38px);
      }
      .__sp-video-int-card {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        /* Logos centered in the upper portion of the card. Title is
           absolutely positioned at the bottom in a lower-third style,
           matching the overlay text in beats 1-3. */
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: #000;
        color: #fff;
        opacity: 0;
        transition: opacity var(--__sp-fade-ms, 350ms) ease-out;
        pointer-events: none;
        font-family: Roboto, "Inter", system-ui, sans-serif;
        /* Big bottom padding reserves the lower-third for the title bar,
           keeping logos clear of it without absolute math. */
        padding: 88px 88px 240px;
      }
      .__sp-video-int-card.visible { opacity: 1; }
      .__sp-video-int-card-title {
        position: absolute;
        /* Raised slightly off the bottom so the bar feels intentionally
           placed rather than glued to the viewport edge. */
        bottom: 72px;
        left: 0;
        right: 0;
        margin: 0;
        padding: 32px 60px;
        background: #000;
        text-align: center;
        max-width: none;
        transform: translateY(24px);
        transition: transform var(--__sp-fade-ms, 350ms) ease-out;
      }
      .__sp-video-int-card.visible .__sp-video-int-card-title {
        transform: translateY(0);
      }
      .__sp-video-int-card-logos {
        display: grid;
        grid-template-columns: repeat(3, auto);
        gap: 64px 80px;
        justify-items: center;
      }
      .__sp-video-int-card-logo {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        /* Default color for the SVG (inherited via fill="currentColor").
           Per-logo brand colors are set inline via cell.style.color in
           showIntegrationsCard — keep this rule on the cell, NOT on the
           inner svg, otherwise the more-specific child rule would beat
           the inline parent style. */
        color: #fff;
        opacity: 0;
        transform: translateY(16px);
        transition:
          opacity 400ms ease-out,
          transform 400ms ease-out;
      }
      .__sp-video-int-card.visible .__sp-video-int-card-logo {
        opacity: 1;
        transform: translateY(0);
      }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(1) { transition-delay: 80ms; }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(2) { transition-delay: 180ms; }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(3) { transition-delay: 280ms; }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(4) { transition-delay: 380ms; }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(5) { transition-delay: 480ms; }
      .__sp-video-int-card.visible .__sp-video-int-card-logo:nth-child(6) { transition-delay: 580ms; }
      .__sp-video-int-card-logo svg {
        width: clamp(80px, 11vw, 160px);
        height: clamp(80px, 11vw, 160px);
      }
      .__sp-video-int-card-logo-label {
        font-size: clamp(24px, 2.2vw, 36px);
        color: #c8cce0;
        font-weight: 500;
        margin: 0;
      }
      .__sp-video-int-card-subtitle {
        margin-top: 120px;
        font-size: clamp(30px, 2.6vw, 44px);
        color: #b6bbcd;
        font-weight: 500;
      }
    `;
    document.head.appendChild(style);
  }, STYLE_ID);
};

export const showOverlay = async (
  page: Page,
  text: string,
  options: OverlayOptions = {},
): Promise<OverlayHandle> => {
  const position: OverlayPosition = options.position ?? 'lower';
  const fadeMs = options.fadeMs ?? 420;
  const chips = options.chips ?? [];
  await ensureStyleInjected(page);
  overlayCounter += 1;
  const id = `${OVERLAY_ID_PREFIX}${overlayCounter}`;
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = `__sp-video-overlay ${args.position}`;
      el.style.setProperty('--__sp-fade-ms', `${args.fadeMs}ms`);
      const bg = document.createElement('div');
      bg.className = '__sp-video-overlay-bg';
      const p = document.createElement('p');
      p.className = '__sp-video-overlay-text';
      p.textContent = args.text;
      bg.appendChild(p);
      if (args.chips.length > 0) {
        const row = document.createElement('div');
        row.className = '__sp-video-overlay-chips';
        for (const chip of args.chips) {
          const span = document.createElement('span');
          span.className = '__sp-video-overlay-chip';
          if (chip.svg) {
            // Trusted source: chip.svg comes from the LOGOS constant in
            // overlays.ts, which is checked-in code, not user input.
            span.insertAdjacentHTML('afterbegin', chip.svg);
          }
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
      // Force a paint before flipping `visible` so the transition fires.
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id, text, position, fadeMs, chips },
  );
  // Wait for fade-in to finish so beat-duration timing reflects visible
  // state. Skip when noWait so callers (e.g. inside cutToScene) can let
  // the fade run concurrently with their own animation.
  if (!options.noWait) {
    await page.waitForTimeout(fadeMs);
  }
  return {
    hide: async (): Promise<void> => {
      await page.evaluate(
        (args) => {
          const el = document.getElementById(args.id);
          if (!el) return;
          el.classList.remove('visible');
          window.setTimeout(() => el.remove(), args.fadeMs + 50);
        },
        { id, fadeMs },
      );
      await page.waitForTimeout(fadeMs);
    },
  };
};

export const showCaption = async (
  page: Page,
  text: string,
  options: Pick<OverlayOptions, 'fadeMs' | 'noWait' | 'position'> = {},
): Promise<CaptionHandle> => {
  const position: OverlayPosition = options.position ?? 'lower';
  const fadeMs = options.fadeMs ?? 420;
  await ensureStyleInjected(page);
  await page.evaluate(
    (args) => {
      document.getElementById(args.id)?.remove();

      const el = document.createElement('div');
      el.id = args.id;
      el.className = `__sp-video-overlay __sp-video-caption ${args.position}`;
      el.style.setProperty('--__sp-fade-ms', `${args.fadeMs}ms`);

      const bg = document.createElement('div');
      bg.className = '__sp-video-overlay-bg';

      const p = document.createElement('p');
      p.className = '__sp-video-overlay-text';
      p.textContent = args.text;
      bg.appendChild(p);

      el.appendChild(bg);
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id: CAPTION_ID, text, position, fadeMs },
  );
  if (!options.noWait) {
    await page.waitForTimeout(fadeMs);
  }

  return {
    update: async (nextText, updateOptions = {}): Promise<void> => {
      const textFadeMs = updateOptions.fadeMs ?? 170;
      const shouldUpdate = await page.evaluate(
        (args) => {
          const textEl = document.querySelector<HTMLElement>(
            `#${args.id} .__sp-video-overlay-text`,
          );
          if (!textEl || textEl.textContent === args.text) return false;
          textEl.style.setProperty('--__sp-caption-text-ms', `${args.fadeMs}ms`);
          textEl.style.opacity = '0';
          textEl.style.transform = 'translateY(8px)';
          return true;
        },
        { id: CAPTION_ID, text: nextText, fadeMs: textFadeMs },
      );
      if (!shouldUpdate) return;

      await page.waitForTimeout(textFadeMs);
      await page.evaluate(
        (args) => {
          const textEl = document.querySelector<HTMLElement>(
            `#${args.id} .__sp-video-overlay-text`,
          );
          if (!textEl) return;
          textEl.textContent = args.text;
          textEl.style.transform = 'translateY(-8px)';
          void textEl.offsetWidth;
          textEl.style.opacity = '1';
          textEl.style.transform = 'translateY(0)';
        },
        { id: CAPTION_ID, text: nextText },
      );
      await page.waitForTimeout(textFadeMs);
    },
    hide: async (): Promise<void> => {
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('visible');
      }, CAPTION_ID);
      await page.waitForTimeout(fadeMs);
      await page.evaluate((id) => document.getElementById(id)?.remove(), CAPTION_ID);
    },
  };
};

const INT_CARD_ID = '__sp-video-int-card';
const TRANSITION_ID = '__sp-video-transition';
const LOOP_BOUNDARY_ID = '__sp-video-loop-boundary';
const DRAG_GHOST_ID = '__sp-video-drag-ghost';

/**
 * Attaches a "ghost" element that follows the cursor during a drag — a
 * clone of the source element, semi-transparent, slightly tilted, casting
 * a shadow. SP's cdkDrag may or may not show its own preview depending on
 * the drop target wiring; this guarantees the act of dragging reads on the
 * gif regardless. Call `attach` at mouse-down time, `detach` at mouse-up.
 *
 *   const ghost = await attachDragGhost(page, sourceLocator);
 *   await page.mouse.down();
 *   await page.mouse.move(...);
 *   await page.mouse.up();
 *   await ghost.detach();
 */
export const attachDragGhost = async (
  page: Page,
  sourceLocator: import('@playwright/test').Locator,
): Promise<{ detach: () => Promise<void> }> => {
  const box = await sourceLocator.boundingBox();
  const html = await sourceLocator.evaluate((el) => el.outerHTML).catch(() => null);
  if (!box || !html) {
    return { detach: async () => undefined };
  }
  await page.evaluate(
    (args) => {
      const ghost = document.createElement('div');
      ghost.id = args.id;
      ghost.innerHTML = args.html;
      ghost.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        `width:${args.width}px`,
        'pointer-events:none',
        // Above app UI, under the lower-third overlay.
        'z-index:999998',
        'opacity:0.88',
        'box-shadow:0 18px 48px rgba(0,0,0,0.55)',
        'border-radius:6px',
        'transform:translate3d(-9999px,-9999px,0) rotate(-2deg)',
        'transition:none',
        'will-change:transform',
      ].join(';');
      // Inner wrappers might have the original element's id — null them
      // out so they don't collide with anything in the live DOM.
      ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      document.body.appendChild(ghost);
      const halfW = args.width / 2;
      const halfH = args.height / 2;
      const onMove = (e: MouseEvent): void => {
        ghost.style.transform = `translate3d(${e.clientX - halfW}px,${e.clientY - halfH}px,0) rotate(-2deg)`;
      };
      // Stash on window so detach can pull it off again.
      (window as unknown as { __spDragGhostMove?: typeof onMove }).__spDragGhostMove =
        onMove;
      document.addEventListener('mousemove', onMove, { passive: true });
    },
    { id: DRAG_GHOST_ID, html, width: box.width, height: box.height },
  );
  return {
    detach: async () => {
      await page.evaluate((id) => {
        const ghost = document.getElementById(id);
        if (ghost) ghost.remove();
        const w = window as unknown as {
          __spDragGhostMove?: (e: MouseEvent) => void;
        };
        if (w.__spDragGhostMove) {
          document.removeEventListener('mousemove', w.__spDragGhostMove);
          w.__spDragGhostMove = undefined;
        }
      }, DRAG_GHOST_ID);
    },
  };
};

/**
 * Full-screen black overlay used to bookend the recording so the gif loop
 * boundary doesn't read as a hard cut. Sits above everything (z-index above
 * the end card). Call `mode: 'in'` first (opaque, fading to transparent over
 * the lead-in) and `mode: 'out'` at the end (transparent, fading to opaque).
 */
export const loopBoundary = async (
  page: Page,
  mode: 'in' | 'out',
  durationMs = 350,
): Promise<void> => {
  await page.evaluate(
    (args) => {
      let el = document.getElementById(args.id);
      const transition = `opacity ${args.durationMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      if (!el) {
        el = document.createElement('div');
        el.id = args.id;
        el.style.cssText = [
          'position:fixed',
          'inset:0',
          'background:#000',
          'z-index:2147483647',
          'pointer-events:none',
          // Material's standard motion curve (cubic-bezier(0.4, 0, 0.2, 1)
          // — slow start, fast middle, slow finish, asymmetrically biased
          // toward a snappier reveal) reads smoother for scene cuts than
          // a generic `ease-in-out`. At the gif's 25fps a 200ms fade is
          // ~5 frames; the curve concentrates the visible opacity change
          // into the middle frames so it reads as a gradient rather than
          // a stepped staircase.
          `transition:${transition}`,
          // Start opacity matches the mode: 'in' starts opaque (revealing
          // SP underneath); 'out' starts transparent (covering it back up).
          `opacity:${args.mode === 'in' ? 1 : 0}`,
        ].join(';');
        document.body.appendChild(el);
      }
      el.style.transition = transition;
      // Force a paint before the opacity flip so duration changes on the
      // reused boundary element take effect for this transition.
      void el.offsetWidth;
      el.style.opacity = args.mode === 'in' ? '0' : '1';
    },
    { id: LOOP_BOUNDARY_ID, mode, durationMs },
  );
  await page.waitForTimeout(durationMs);
};

/**
 * Hard scene cut via fade-to-black. Use when the next scene's content is
 * unrelated to the previous one — full-screen card replacing focus mode,
 * for example. The screen fades to true black, the callback runs while
 * the scene is hidden behind the black, then black fades back to reveal
 * whatever the callback set up.
 *
 * This is more reliable than `fadeTransition` (which uses a partial dim
 * and lets the underlying state-change show through). With `cutToScene`,
 * intermediate states (focus-mode dismissal animations, layout reflow,
 * etc.) are invisible behind the black cover.
 *
 *   await cutToScene(page, async () => {
 *     await dismissFocusMode();
 *     await showIntegrationsCard(page, content, { noWait: true });
 *   });
 *
 * The `{ noWait: true }` on `showIntegrationsCard` lets its stagger
 * animation play *during* the fade-from-black rather than be hidden
 * behind it.
 */
export const cutToScene = async (
  page: Page,
  setupNextScene: () => Promise<void> | void,
  options: { fadeMs?: number; label?: string } = {},
): Promise<void> => {
  // 200ms × 2 (fade-to-black + fade-from-black) = 400ms per scene cut.
  // At the gif's 25fps that's ~5 frames per fade. Combined with Material
  // motion curve and sierra2_4a dither (see build-video.ts) this reads as
  // a smooth gradient at this duration. Going shorter starts to look
  // stepped; much longer drags out the reel.
  const fadeMs = options.fadeMs ?? 200;
  // Fade existing scene to opaque black (loopBoundary uses z 2147483647,
  // higher than any beat overlay/card, so it covers everything).
  await loopBoundary(page, 'out', fadeMs);
  // Behind black: prepare next scene.
  const setupStartedAt = Date.now();
  await setupNextScene();
  if (options.label) {
    console.log(
      `[video] ${options.label}: setup behind black ${Date.now() - setupStartedAt}ms`,
    );
  }
  // Fade black away to reveal the next scene.
  await loopBoundary(page, 'in', fadeMs);
};

/**
 * Subtly dim-fade the screen while an underlying transition happens (state
 * dispatch, navigation). Use to soften hard cuts between SP views.
 *
 *   await fadeTransition(page, async () => {
 *     // do the cut here — dispatch, navigate, etc.
 *   });
 */
export const fadeTransition = async (
  page: Page,
  during: () => Promise<void> | void,
  options: { fadeMs?: number; opacity?: number; label?: string } = {},
): Promise<void> => {
  // Slightly longer fade with a softer dim — the lower-third overlay
  // text rides above the dim layer (higher z-index), so reducing the
  // dim from 70% → 55% black still hides the underlying state change
  // but keeps the lower-third bar feeling continuous instead of cut.
  const fadeMs = options.fadeMs ?? 260;
  const opacity = options.opacity ?? 0.55;
  await page.evaluate(
    (args) => {
      const existing = document.getElementById(args.id);
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = args.id;
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483640',
        'background:#000',
        'opacity:0',
        `transition:opacity ${args.fadeMs}ms ease-out`,
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(el);
      void el.offsetWidth;
      el.style.opacity = String(args.opacity);
    },
    { id: TRANSITION_ID, fadeMs, opacity },
  );
  await page.waitForTimeout(fadeMs);
  const setupStartedAt = Date.now();
  await during();
  if (options.label) {
    console.log(
      `[video] ${options.label}: setup under dim ${Date.now() - setupStartedAt}ms`,
    );
  }
  await page.evaluate(
    (args) => {
      const el = document.getElementById(args.id);
      if (!el) return;
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), args.fadeMs + 50);
    },
    { id: TRANSITION_ID, fadeMs },
  );
  await page.waitForTimeout(fadeMs);
};

const easeInOutCubic = (t: number): number => {
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  const scaled = -2 * t;
  const shifted = scaled + 2;
  const cubed = Math.pow(shifted, 3);
  const halved = cubed / 2;
  return 1 - halved;
};

export const smoothMouseMove = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { durationMs?: number; steps?: number } = {},
): Promise<void> => {
  const durationMs = options.durationMs ?? 520;
  const steps = options.steps ?? Math.max(10, Math.round(durationMs / 16));
  const delayMs = Math.max(8, Math.round(durationMs / steps));
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const eased = easeInOutCubic(t);
    const xDelta = dx * eased;
    const yDelta = dy * eased;
    const x = from.x + xDelta;
    const y = from.y + yDelta;
    await page.mouse.move(x, y);
    if (i < steps) {
      await page.waitForTimeout(delayMs);
    }
  }
};

export const showIntegrationsCard = async (
  page: Page,
  content: IntegrationsCardContent,
  options: { fadeMs?: number; noWait?: boolean } = {},
): Promise<OverlayHandle> => {
  const fadeMs = options.fadeMs ?? 420;
  await ensureStyleInjected(page);
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = '__sp-video-int-card';
      el.style.setProperty('--__sp-fade-ms', `${args.fadeMs}ms`);

      const title = document.createElement('p');
      title.className = '__sp-video-int-card-title';
      title.textContent = args.content.title;
      el.appendChild(title);

      const grid = document.createElement('div');
      grid.className = '__sp-video-int-card-logos';
      for (const logo of args.content.logos) {
        const cell = document.createElement('div');
        cell.className = '__sp-video-int-card-logo';
        // CSS `color` flows into the SVG via `fill="currentColor"`. Label
        // stays white (set on its own selector) so brand colors only apply
        // to the icon.
        if (logo.color) cell.style.color = logo.color;
        // Trusted source: `logo.svg` comes from the LOGOS constant in
        // overlays.ts, which is checked-in code, not user input.
        cell.insertAdjacentHTML('afterbegin', logo.svg);
        const label = document.createElement('p');
        label.className = '__sp-video-int-card-logo-label';
        label.textContent = logo.label;
        cell.appendChild(label);
        grid.appendChild(cell);
      }
      el.appendChild(grid);

      if (args.content.subtitle) {
        const sub = document.createElement('p');
        sub.className = '__sp-video-int-card-subtitle';
        sub.textContent = args.content.subtitle;
        el.appendChild(sub);
      }

      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id: INT_CARD_ID, content, fadeMs },
  );
  // When noWait, return as soon as DOM is set up (the visible class has
  // been added, so the fade-in / stagger animation is now running). The
  // caller is responsible for letting it play out — useful when this
  // call lands inside a `cutToScene` callback so the stagger plays
  // *during* the fade-from-black rather than wasted behind it.
  if (!options.noWait) {
    // Fade plus the longest stagger delay (~580ms for 6th logo).
    await page.waitForTimeout(fadeMs + 600);
  }
  return {
    hide: async (): Promise<void> => {
      await page.evaluate(
        (args) => {
          const el = document.getElementById(args.id);
          if (!el) return;
          el.classList.remove('visible');
          window.setTimeout(() => el.remove(), args.fadeMs + 50);
        },
        { id: INT_CARD_ID, fadeMs },
      );
      await page.waitForTimeout(fadeMs);
    },
  };
};

export const showEndCard = async (
  page: Page,
  content: EndCardContent,
  options: { fadeMs?: number; noWait?: boolean } = {},
): Promise<OverlayHandle> => {
  const fadeMs = options.fadeMs ?? 380;
  await ensureStyleInjected(page);
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = '__sp-video-end-card';
      el.style.setProperty('--__sp-fade-ms', `${args.fadeMs}ms`);
      if (args.content.logo) {
        const img = document.createElement('img');
        img.className =
          '__sp-video-end-card-logo' +
          (args.content.logo.monochrome ? ' monochrome' : '');
        img.src = args.content.logo.src;
        img.alt = args.content.logo.alt ?? '';
        el.appendChild(img);
      }
      const title = document.createElement('p');
      title.className = '__sp-video-end-card-title';
      title.textContent = args.content.title;
      el.appendChild(title);
      if (args.content.subtitle) {
        const sub = document.createElement('p');
        sub.className = '__sp-video-end-card-subtitle';
        sub.textContent = args.content.subtitle;
        el.appendChild(sub);
      }
      if (args.content.stats && args.content.stats.length > 0) {
        const statsBox = document.createElement('div');
        statsBox.className = '__sp-video-end-card-stats';
        const animated: HTMLElement[] = [];
        for (const line of args.content.stats) {
          const stat = document.createElement('p');
          stat.className = '__sp-video-end-card-stat';
          if (typeof line === 'string') {
            stat.textContent = line;
          } else {
            stat.dataset.tpl = line.template;
            stat.dataset.to = String(line.to);
            stat.dataset.decimals = String(line.decimals ?? 0);
            const placeholder = (line.decimals ?? 0) > 0 ? '0.0' : '0';
            stat.textContent = line.template.replace('{n}', placeholder);
            animated.push(stat);
          }
          statsBox.appendChild(stat);
        }
        el.appendChild(statsBox);
        if (animated.length > 0) {
          // Stagger each stat's count-up by ~280ms so they read as
          // sequential facts being revealed, not one undifferentiated blob
          // of motion. Wait for the card's fade-in to complete before the
          // first one starts so the numbers don't roll while the card is
          // still appearing.
          const stagger = 280;
          const duration = 900;
          animated.forEach((p, i) => {
            const offset = i * stagger;
            const delay = args.fadeMs + offset;
            window.setTimeout(() => {
              const start = performance.now();
              const tick = (now: number): void => {
                const t = Math.min((now - start) / duration, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                const tpl = p.dataset.tpl ?? '';
                const to = Number(p.dataset.to ?? '0');
                const dec = Number(p.dataset.decimals ?? '0');
                const val = (eased * to).toFixed(dec);
                p.textContent = tpl.replace('{n}', val);
                if (t < 1) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }, delay);
          });
        }
      }
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id: END_CARD_ID, content, fadeMs },
  );
  // Skip when noWait so the fade-in / stat counter-ups play concurrently
  // with whatever animation the caller is running (typically a fade-from
  // -black). Otherwise wait for the card to fully reveal before returning.
  if (!options.noWait) {
    await page.waitForTimeout(fadeMs);
  }
  return {
    hide: async (): Promise<void> => {
      await page.evaluate(
        (args) => {
          const el = document.getElementById(args.id);
          if (!el) return;
          el.classList.remove('visible');
          window.setTimeout(() => el.remove(), args.fadeMs + 50);
        },
        { id: END_CARD_ID, fadeMs },
      );
      await page.waitForTimeout(fadeMs);
    },
  };
};
