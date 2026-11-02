/** Super Productivity specifics shared by the reel scenarios. */
import type { Page } from '@playwright/test';

/** Editorial pause: time for viewers to read. UI readiness belongs in `expect()`. */
export const hold = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dispatches NgRx actions through the e2e test helpers the app exposes, all in
 * one synchronous page turn, as a sequence of UI events would not be.
 */
export const dispatch = async (page: Page, ...actions: unknown[]): Promise<void> => {
  await page.evaluate((all) => {
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers;
    for (const action of all) store.dispatch(action);
  }, actions);
};

/**
 * The shared screenshot seed disables animations for stable stills, but its
 * `transition: none !important` also flattens every video fade into a hard cut.
 */
export const enableAnimations = async (page: Page): Promise<void> => {
  await dispatch(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'misc',
    sectionCfg: { isDisableAnimations: false },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'misc',
      opType: 'UPD',
    },
  });
};
