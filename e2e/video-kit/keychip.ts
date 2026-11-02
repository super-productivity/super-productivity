/**
 * Keycap chips: show the shortcut being pressed, so keyboard-driven changes
 * have a visible cause on screen.
 */
import type { Page } from '@playwright/test';
import {
  ensureStyle,
  hideById,
  type LayerHandle,
  MONO_FONT,
  nextLayerId,
  Z,
} from './dom';

const STYLE_ID = 'vk-keychip';

const CSS = `
  /* Physically modeled keycap. Positioned by the modifier classes below;
     restyle .vk-keychip to move it. */
  .vk-keychip {
    position: fixed;
    top: 56px;
    right: 56px;
    z-index: ${Z.caption};
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 28px;
    border-radius: 14px;
    background: linear-gradient(180deg, #2a2f44 0%, #161a2c 100%);
    box-shadow:
      inset 0 -4px 0 rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      0 10px 30px rgba(0, 0, 0, 0.45);
    color: #f7f8fb;
    font-family: ${MONO_FONT};
    font-weight: 700;
    font-size: clamp(26px, 2.6vw, 44px);
    letter-spacing: 0.04em;
    opacity: 0;
    transform: translateY(-12px) scale(0.92);
    transition:
      opacity var(--vk-fade-ms, 220ms) ease-out,
      transform var(--vk-fade-ms, 220ms) cubic-bezier(0.34, 1.56, 0.64, 1);
    pointer-events: none;
  }
  /* Centered just above a lower-third caption, where the eye already is. */
  .vk-keychip.above-caption {
    top: auto;
    right: 0;
    left: 0;
    bottom: calc(clamp(48px, 6.4vw, 96px) * 1.15 + 124px);
    width: fit-content;
    margin: 0 auto;
    font-size: clamp(30px, 2.9vw, 56px);
  }
  .vk-keychip.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .vk-keychip-plus {
    color: #8a90ad;
    font-weight: 500;
  }
`;

export type KeyChipPosition = 'top-right' | 'above-caption';

/**
 * Shows a keycap chip. The label splits on `+` and renders with a muted plus,
 * so "Shift+A" reads as two keys. A brief pop-in makes each key in a fast
 * sequence land as a discrete event. Centered above the caption by default,
 * where the eye already is; `top-right` tends to land on app toolbars.
 *
 *   const chip = await showKeyChip(page, 'Shift+A');
 *   await page.keyboard.press('Shift+A');
 *   await chip.hide();
 */
export const showKeyChip = async (
  page: Page,
  key: string,
  options: { fadeMs?: number; noWait?: boolean; position?: KeyChipPosition } = {},
): Promise<LayerHandle> => {
  const fadeMs = options.fadeMs ?? 220;
  const id = nextLayerId('vk-keychip');
  const position = options.position ?? 'above-caption';
  await ensureStyle(page, STYLE_ID, CSS);
  await page.evaluate(
    (args) => {
      const el = document.createElement('div');
      el.id = args.id;
      el.className = `vk-keychip ${args.position}`;
      el.style.setProperty('--vk-fade-ms', `${args.fadeMs}ms`);
      args.key
        .split('+')
        .map((part) => part.trim())
        .forEach((part, i) => {
          if (i > 0) {
            const plus = document.createElement('span');
            plus.className = 'vk-keychip-plus';
            plus.textContent = '+';
            el.appendChild(plus);
          }
          const span = document.createElement('span');
          span.textContent = part;
          el.appendChild(span);
        });
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    },
    { id, key, fadeMs, position },
  );
  if (!options.noWait) await page.waitForTimeout(fadeMs);
  return { hide: () => hideById(page, id, fadeMs) };
};
