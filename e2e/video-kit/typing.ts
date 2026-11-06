/**
 * Typing that reads as a person at a keyboard rather than a fixed-rate robot.
 */
import type { Page } from '@playwright/test';
import { setCursorVisible } from './cursor';

/** Deterministic 0..1 noise per index, so every re-run types identically. */
const noise = (i: number): number => {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const WORD_BREAK = /[\s.,:;!?]/;

/** Uneven key rhythm around `baseMs`, plus a beat after words and punctuation. */
const keyDelay = (char: string, i: number, baseMs: number): number => {
  const spread = 0.8 * noise(i);
  const typed = baseMs * (0.6 + spread);
  const pause = WORD_BREAK.test(char) ? baseMs * 0.8 : 0;
  return Math.round(typed + pause);
};

/**
 * Types into the focused element; `\n` presses Enter. Hides the cursor, which
 * would otherwise sit in the text; the next `pointer.glideTo` shows it again.
 *
 *   await editor.click();
 *   await typeText(page, '# Launch plan\n- [ ] Publish the update');
 */
export const typeText = async (
  page: Page,
  text: string,
  options: { delayMs?: number } = {},
): Promise<void> => {
  const baseMs = options.delayMs ?? 75;
  await setCursorVisible(page, false);
  const chars = [...text];
  for (const [i, char] of chars.entries()) {
    if (char === '\n') await page.keyboard.press('Enter');
    else await page.keyboard.type(char);
    if (i < chars.length - 1) await page.waitForTimeout(keyDelay(char, i, baseMs));
  }
};
