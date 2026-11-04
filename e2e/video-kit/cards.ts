/**
 * Full-screen cards: a logo grid (integrations, platforms, partners) and a
 * title / end card with optional logo and count-up stats. Cards cover the app
 * and captions; pair them with `cutToScene` or crossfade one over another.
 */
import type { Page } from '@playwright/test';
import { ensureStyle, FONT, hideById, type LayerHandle, nextLayerId, Z } from './dom';

/**
 * One stat line on the end card. A plain string renders as-is; the object form
 * counts `{n}` in `template` up from 0 to `to` during the reveal.
 *   { template: '★ {n}K on GitHub', to: 19 }            → "★ 19K on GitHub"
 *   { template: '{n} ★ on Google Play', to: 4.8, decimals: 1 }
 *
 * Counting uses requestAnimationFrame, so a Playwright page clock must be
 * running (`page.clock.resume()`) or the numbers stay at 0.
 */
export type EndCardStat = string | { template: string; to: number; decimals?: number };

export type EndCardContent = {
  title: string;
  subtitle?: string;
  /** One line per entry, stacked under the subtitle. */
  stats?: EndCardStat[];
  /**
   * Optional logo above the title, loaded from the app's own server.
   * `monochrome` flattens it to a white silhouette for the dark backdrop.
   */
  logo?: { src: string; alt?: string; monochrome?: boolean };
};

export type LogoGridItem = {
  /** Inline SVG markup using `fill="currentColor"`. Trusted, checked-in strings only. */
  svg: string;
  label: string;
  /** Brand color for the icon (CSS `color`); defaults to white. */
  color?: string;
};

export type LogoGridCardContent = {
  title: string;
  /** Works best with 3-6 entries. */
  logos: LogoGridItem[];
  /** Optional small line below the grid, e.g. "& many more". */
  subtitle?: string;
};

type CardOptions = {
  fadeMs?: number;
  /** Return once the fade-in starts; see `OverlayOptions.noWait`. */
  noWait?: boolean;
};

const STYLE_ID = 'vk-cards';
const LOGO_STAGGER_MS = 100;
const MAX_STAGGERED_LOGOS = 6;

const logoStaggerCss = Array.from({ length: MAX_STAGGERED_LOGOS }, (_, i) => {
  const staggerMs = i * LOGO_STAGGER_MS;
  return `.vk-logo-card.visible .vk-logo-card-logo:nth-child(${i + 1}) { transition-delay: ${80 + staggerMs}ms; }`;
}).join('\n');

const CSS = `
  .vk-end-card {
    position: fixed;
    inset: 0;
    z-index: ${Z.endCard};
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: var(--vk-card-bg, linear-gradient(135deg, #0a0a14 0%, #131626 100%));
    opacity: 0;
    transition: opacity var(--vk-fade-ms, 250ms) ease-out;
    pointer-events: none;
    font-family: ${FONT};
    padding: min(72px, 7vw);
  }
  .vk-end-card.visible { opacity: 1; }
  .vk-end-card-logo {
    width: clamp(80px, 22vw, 260px);
    height: clamp(80px, 22vw, 260px);
    margin: 0 0 56px;
    object-fit: contain;
  }
  /* brightness(0) flattens any image to black; invert(1) flips it to white. */
  .vk-end-card-logo.monochrome { filter: brightness(0) invert(1); }
  .vk-end-card .vk-headline { margin: 0 0 40px; }
  .vk-end-card-subtitle {
    color: #c8cce0;
    font-weight: 500;
    font-size: clamp(18px, 3.5vw, 60px);
    letter-spacing: -0.01em;
    margin: 0;
  }
  .vk-end-card-stats {
    margin-top: 44px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }
  .vk-end-card-stat {
    color: #9da2ba;
    font-weight: 500;
    font-size: clamp(16px, 3vw, 52px);
    margin: 0;
    white-space: nowrap;
  }
  .vk-logo-card {
    position: fixed;
    inset: 0;
    z-index: ${Z.logoCard};
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #000;
    color: #fff;
    opacity: 0;
    transition: opacity var(--vk-fade-ms, 350ms) ease-out;
    pointer-events: none;
    font-family: ${FONT};
    /* Bottom padding reserves the lower third for the title bar. */
    padding: 88px 88px 240px;
  }
  .vk-logo-card.visible { opacity: 1; }
  .vk-logo-card .vk-headline {
    position: absolute;
    /* Raised off the bottom edge so the bar reads as placed, not glued on. */
    bottom: 72px;
    left: 0;
    right: 0;
    padding: 32px 60px;
    background: #000;
    transform: translateY(24px);
    transition: transform var(--vk-fade-ms, 350ms) ease-out;
  }
  .vk-logo-card.visible .vk-headline { transform: translateY(0); }
  .vk-logo-card-logos {
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: 64px 80px;
    justify-items: center;
  }
  /* Tall frames (9:16 and narrower) get a 2-column grid so logos read big
     instead of cramped. Not orientation: portrait, which also matches square. */
  @media (max-aspect-ratio: 3/4) {
    .vk-logo-card-logos {
      grid-template-columns: repeat(2, auto);
      gap: 88px 120px;
    }
  }
  .vk-logo-card-logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    /* Default icon color, inherited via fill="currentColor". Brand colors are
       set inline on this cell; a rule on the inner svg would outrank them. */
    color: #fff;
    opacity: 0;
    transform: translateY(16px);
    transition:
      opacity 400ms ease-out,
      transform 400ms ease-out;
  }
  .vk-logo-card.visible .vk-logo-card-logo {
    opacity: 1;
    transform: translateY(0);
  }
  ${logoStaggerCss}
  .vk-logo-card-logo svg {
    width: clamp(80px, 11vw, 160px);
    height: clamp(80px, 11vw, 160px);
  }
  .vk-logo-card-label {
    font-size: clamp(24px, 2.2vw, 36px);
    color: #c8cce0;
    font-weight: 500;
    margin: 0;
  }
  /* Outranks app paragraph margins so the subtitle clears the logos. */
  .vk-logo-card .vk-logo-card-subtitle {
    margin-top: 120px;
    font-size: clamp(30px, 2.6vw, 44px);
    color: #b6bbcd;
    font-weight: 500;
  }
`;

/** Shows a full-screen logo grid whose logos stagger in under a lower-third title. */
export const showLogoGridCard = async (
  page: Page,
  content: LogoGridCardContent,
  options: CardOptions = {},
): Promise<LayerHandle> => {
  const fadeMs = options.fadeMs ?? 420;
  const id = nextLayerId('vk-logo-card');
  await ensureStyle(page, STYLE_ID, CSS);
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = 'vk-logo-card';
      el.style.setProperty('--vk-fade-ms', `${args.fadeMs}ms`);
      const title = document.createElement('p');
      title.className = 'vk-headline';
      title.textContent = args.content.title;
      el.appendChild(title);
      const grid = document.createElement('div');
      grid.className = 'vk-logo-card-logos';
      for (const logo of args.content.logos) {
        const cell = document.createElement('div');
        cell.className = 'vk-logo-card-logo';
        if (logo.color) cell.style.color = logo.color;
        // Trusted: logo SVGs are checked-in constants, never user input.
        cell.insertAdjacentHTML('afterbegin', logo.svg);
        const label = document.createElement('p');
        label.className = 'vk-logo-card-label';
        label.textContent = logo.label;
        cell.appendChild(label);
        grid.appendChild(cell);
      }
      el.appendChild(grid);
      if (args.content.subtitle) {
        const sub = document.createElement('p');
        sub.className = 'vk-logo-card-subtitle';
        sub.textContent = args.content.subtitle;
        el.appendChild(sub);
      }
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id, content, fadeMs },
  );
  if (!options.noWait) {
    const lastLogo = Math.min(content.logos.length, MAX_STAGGERED_LOGOS);
    // Fade plus the stagger, so every logo has started by the time we return.
    const staggerMs = lastLogo * LOGO_STAGGER_MS;
    await page.waitForTimeout(fadeMs + staggerMs);
  }
  return { hide: () => hideById(page, id, fadeMs) };
};

/**
 * Shows a full-screen title or end card. Stats with a template count up one
 * after another once the card has faded in.
 */
export const showEndCard = async (
  page: Page,
  content: EndCardContent,
  options: CardOptions = {},
): Promise<LayerHandle> => {
  const fadeMs = options.fadeMs ?? 380;
  const id = nextLayerId('vk-end-card');
  await ensureStyle(page, STYLE_ID, CSS);
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = 'vk-end-card';
      el.style.setProperty('--vk-fade-ms', `${args.fadeMs}ms`);
      const { logo, title, subtitle, stats } = args.content;
      if (logo) {
        const img = document.createElement('img');
        img.className = `vk-end-card-logo${logo.monochrome ? ' monochrome' : ''}`;
        img.src = logo.src;
        img.alt = logo.alt ?? '';
        el.appendChild(img);
      }
      const titleEl = document.createElement('p');
      titleEl.className = 'vk-headline';
      titleEl.textContent = title;
      el.appendChild(titleEl);
      if (subtitle) {
        const sub = document.createElement('p');
        sub.className = 'vk-end-card-subtitle';
        sub.textContent = subtitle;
        el.appendChild(sub);
      }
      const counters: { el: HTMLElement; template: string; to: number; dec: number }[] =
        [];
      if (stats && stats.length > 0) {
        const box = document.createElement('div');
        box.className = 'vk-end-card-stats';
        for (const line of stats) {
          const stat = document.createElement('p');
          stat.className = 'vk-end-card-stat';
          if (typeof line === 'string') {
            stat.textContent = line;
          } else {
            const dec = line.decimals ?? 0;
            stat.textContent = line.template.replace('{n}', (0).toFixed(dec));
            counters.push({ el: stat, template: line.template, to: line.to, dec });
          }
          box.appendChild(stat);
        }
        el.appendChild(box);
      }
      // Staggered count-ups read as facts revealed one by one; starting after
      // the fade keeps numbers from rolling while the card still appears.
      const staggerMs = 280;
      const countMs = 900;
      counters.forEach((counter, i) => {
        const delayMs = i * staggerMs;
        window.setTimeout(() => {
          const start = performance.now();
          const tick = (now: number): void => {
            const t = Math.min((now - start) / countMs, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const value = (eased * counter.to).toFixed(counter.dec);
            counter.el.textContent = counter.template.replace('{n}', value);
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, args.fadeMs + delayMs);
      });
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id, content, fadeMs },
  );
  if (!options.noWait) await page.waitForTimeout(fadeMs);
  return { hide: () => hideById(page, id, fadeMs) };
};
