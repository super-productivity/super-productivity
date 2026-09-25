/**
 * Time-lapse on a Playwright page clock: tracked time, timers and countdowns
 * visibly climb instead of jumping.
 */
import type { Page } from '@playwright/test';

export type TimeLapseOptions = {
  /** Page time per step. Default one minute. */
  stepMs?: number;
  /** Real time each step stays on screen. Default 60ms (~1.5 frames at 25fps). */
  frameMs?: number;
};

/**
 * Advances the page clock by `totalMs` in steps. Each step fires due timers
 * once, so interval-driven UI updates once per step. Needs
 * `page.clock.install()` before the page loaded.
 *
 *   await timeLapse(page, 30 * 60_000); // 30 minutes in ~2s
 */
export const timeLapse = async (
  page: Page,
  totalMs: number,
  options: TimeLapseOptions = {},
): Promise<void> => {
  const stepMs = options.stepMs ?? 60_000;
  const frameMs = options.frameMs ?? 60;
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await page.clock.fastForward(Math.min(stepMs, totalMs - elapsed));
    await new Promise((resolve) => setTimeout(resolve, frameMs));
  }
};
