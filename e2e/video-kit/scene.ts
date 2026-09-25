/**
 * The scene change most videos repeat: cut to black, reset camera and cursor,
 * set up the next state, clear leftovers, and reveal it under a new caption.
 */
import type { Page } from '@playwright/test';
import type { Camera } from './camera';
import { showOverlay } from './captions';
import type { Pointer } from './cursor';
import type { LayerHandle } from './dom';
import { cutToScene, settleScene } from './transitions';

export type NextSceneOptions = {
  /** Runs behind black: navigation (even `page.goto`), state changes. */
  setup?: () => Promise<unknown> | unknown;
  /** Lower-third caption that fades in with the reveal. */
  caption?: string;
  /** Parked behind black, so the scene opens without a stray cursor or hover. */
  pointer?: Pointer;
  /** Snapped back to 1× behind black. */
  camera?: Camera;
  /**
   * Names the scene in setup-time logs and for `onSceneStart` (scene marks,
   * contact sheets). Defaults to the caption.
   */
  label?: string;
  fadeMs?: number;
};

/**
 * Cuts to the next scene and returns its caption handle, if any.
 *
 *   caption = await nextScene(page, {
 *     caption: 'Navigate Boards with arrow keys.',
 *     pointer,
 *     setup: () => page.goto('/#/boards'),
 *   });
 */
export const nextScene = async (
  page: Page,
  options: NextSceneOptions,
): Promise<LayerHandle | undefined> => {
  let caption: LayerHandle | undefined;
  await cutToScene(
    page,
    async () => {
      await options.camera?.reset({ durationMs: 0 });
      await options.setup?.();
      await options.pointer?.park({ isBehindBlack: true });
      await settleScene(page);
      if (options.caption) {
        caption = await showOverlay(page, options.caption, { noWait: true });
      }
    },
    { fadeMs: options.fadeMs, label: options.label ?? options.caption },
  );
  return caption;
};
