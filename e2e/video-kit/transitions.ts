/**
 * Scene transitions: fade through black, a softer dim, and crossfading stills.
 * Each covers an app state change so the viewer never sees reflow, route
 * changes, or dismissal animations.
 */
import { expect, type Page } from '@playwright/test';
import { OVERLAY_CLASS } from './captions';
import { hideById, type LayerHandle, nextLayerId, Z } from './dom';

const BLACK_ID = 'vk-black';
const DIM_ID = 'vk-dim';
/** sessionStorage flag: set while a cut is behind black, read by the next document. */
const COVER_FLAG = 'vk-cover';

/**
 * Material's standard curve concentrates the change in the middle frames, so a
 * short fade reads as a gradient rather than a staircase at 25fps.
 */
const FADE_CURVE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Fades a full-screen black layer above everything. `'in'` starts opaque and
 * reveals the page; `'out'` covers it. Bookend a looping GIF with both so the
 * seam is black-to-black, not a jump cut.
 */
export const loopBoundary = async (
  page: Page,
  mode: 'in' | 'out',
  durationMs = 350,
): Promise<void> => {
  await page.evaluate(
    (args) => {
      let el = document.getElementById(args.id);
      const transition = `opacity ${args.durationMs}ms ${args.curve}`;
      if (!el) {
        el = document.createElement('div');
        el.id = args.id;
        el.style.cssText = [
          'position:fixed',
          'inset:0',
          'background:#000',
          `z-index:${args.z}`,
          'pointer-events:none',
          `transition:${transition}`,
          `opacity:${args.mode === 'in' ? 1 : 0}`,
        ].join(';');
        document.body.appendChild(el);
      }
      el.style.transition = transition;
      // Flush styles so a changed duration on the reused layer applies now.
      void el.offsetWidth;
      el.style.opacity = args.mode === 'in' ? '0' : '1';
    },
    { id: BLACK_ID, mode, durationMs, curve: FADE_CURVE, z: Z.black },
  );
  await page.waitForTimeout(durationMs);
};

const pagesWithCoverScript = new WeakSet<Page>();

/**
 * The black layer lives in the document, so a full navigation behind it would
 * drop it and show the new page before the reveal. This init script re-creates
 * it, fully opaque, before the next document's first paint while a cut is in
 * progress. Same-origin only: the flag lives in sessionStorage.
 */
const keepCoverAcrossNavigations = async (page: Page): Promise<void> => {
  if (pagesWithCoverScript.has(page)) return;
  pagesWithCoverScript.add(page);
  await page.addInitScript(
    (args) => {
      let isCovered = false;
      try {
        isCovered = sessionStorage.getItem(args.flag) === '1';
      } catch {
        // Opaque origins (about:blank, data:) have no storage and no cut to restore.
        return;
      }
      if (!isCovered) return;
      const cover = document.createElement('div');
      cover.id = args.id;
      cover.style.cssText = `position:fixed;inset:0;background:#000;z-index:${args.z};pointer-events:none;opacity:1`;
      // Init scripts run before <html> exists; attach as soon as it does.
      const attach = (): boolean => {
        if (!document.documentElement) return false;
        document.documentElement.appendChild(cover);
        return true;
      };
      if (attach()) return;
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document, { childList: true });
    },
    { flag: COVER_FLAG, id: BLACK_ID, z: Z.black },
  );
};

const setCoverFlag = async (page: Page, isCovered: boolean): Promise<void> => {
  await page.evaluate(
    (args) => {
      try {
        if (args.isCovered) sessionStorage.setItem(args.flag, '1');
        else sessionStorage.removeItem(args.flag);
      } catch {
        // Opaque origin: nothing persists across its navigations anyway.
      }
    },
    { flag: COVER_FLAG, isCovered },
  );
};

/**
 * Hard scene cut: fade to black, run `setupNextScene` while hidden, fade back.
 * Unlike `fadeTransition`, nothing of the intermediate state leaks through,
 * including a full (same-origin) navigation with `page.goto()`.
 * Show the next caption/card with `noWait: true` inside the callback so its
 * fade-in plays during the reveal instead of behind black.
 *
 *   await cutToScene(page, async () => {
 *     await dismissFocusMode();
 *     await showLogoGridCard(page, content, { noWait: true });
 *   });
 */
export const cutToScene = async (
  page: Page,
  setupNextScene: () => Promise<unknown> | unknown,
  options: { fadeMs?: number; label?: string } = {},
): Promise<void> => {
  // 200ms each way is ~5 frames at 25fps: smooth with the curve above,
  // while longer fades drag the video out.
  const fadeMs = options.fadeMs ?? 200;
  await keepCoverAcrossNavigations(page);
  await loopBoundary(page, 'out', fadeMs);
  await setCoverFlag(page, true);
  const setupStartedAt = Date.now();
  try {
    await setupNextScene();
    logSetup(options.label, 'behind black', setupStartedAt);
    if (options.label) markScene(page, options.label);
    await loopBoundary(page, 'in', fadeMs);
    await setCoverFlag(page, false);
  } catch (error) {
    // Setup can navigate or close the page. Cleanup must not mask its error.
    await setCoverFlag(page, false).catch(() => undefined);
    await hideById(page, BLACK_ID, 0).catch(() => undefined);
    throw error;
  }
};

const sceneListeners = new WeakMap<Page, (label: string) => void>();

/**
 * Registers a callback for labeled `cutToScene` reveals, e.g. to write scene
 * timestamps next to the recording for trimming, review and contact sheets.
 * One listener per page; a later call replaces it.
 */
export const onSceneStart = (page: Page, listener: (label: string) => void): void => {
  sceneListeners.set(page, listener);
};

/** Marks a card or crossfade that changes the scene without a cut through black. */
export const markScene = (page: Page, label: string): void => {
  sceneListeners.get(page)?.(label);
};

/**
 * Dims the screen while `during` changes the app, then lifts the dim. Captions
 * ride above the dim, so a caption bar stays continuous across the change.
 * Keep it away from layout-heavy changes (e.g. before a drag): the dim is
 * partial and reflow shows through. Use `cutToScene` for those.
 */
export const fadeTransition = async (
  page: Page,
  during: () => Promise<unknown> | unknown,
  options: { fadeMs?: number; opacity?: number; label?: string } = {},
): Promise<void> => {
  const fadeMs = options.fadeMs ?? 260;
  const opacity = options.opacity ?? 0.55;
  await page.evaluate(
    (args) => {
      document.getElementById(args.id)?.remove();
      const el = document.createElement('div');
      el.id = args.id;
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        `z-index:${args.z}`,
        'background:#000',
        'opacity:0',
        `transition:opacity ${args.fadeMs}ms ease-out`,
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(el);
      void el.offsetWidth;
      el.style.opacity = String(args.opacity);
    },
    { id: DIM_ID, fadeMs, opacity, z: Z.dim },
  );
  await page.waitForTimeout(fadeMs);
  const setupStartedAt = Date.now();
  try {
    await during();
    logSetup(options.label, 'under dim', setupStartedAt);
    await hideById(page, DIM_ID, fadeMs);
  } catch (error) {
    await hideById(page, DIM_ID, 0).catch(() => undefined);
    throw error;
  }
};

const logSetup = (label: string | undefined, where: string, startedAt: number): void => {
  if (!label) return;
  console.log(`[video] ${label}: setup ${where} ${Date.now() - startedAt}ms`);
};

/**
 * Call behind black (inside `cutToScene`) to make the reveal clean: removes
 * leftover captions at once (a fading one would bleed into the new scene) and
 * jumps finite app animations, like a panel sliding shut, to their end state.
 * Finishing instead of waiting keeps the screen black as briefly as possible.
 */
export const settleScene = async (page: Page): Promise<void> => {
  await page.evaluate(
    (cls) => document.querySelectorAll(`.${cls}`).forEach((el) => el.remove()),
    OVERLAY_CLASS,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const running = document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                a.effect?.getComputedTiming().iterations !== Infinity,
            );
          running.forEach((a) => a.finish());
          return running.length;
        }),
      { intervals: [50] },
    )
    .toBe(0);
};

export type StillHandle = LayerHandle & {
  /** Crossfades to the next image; resolves once it has fully replaced the last. */
  crossfadeTo: (src: string) => Promise<void>;
};

/**
 * Shows a full-screen still (URL or data URI) above the app — e.g. screenshots
 * of states too slow to reach live, like a theme montage. Stills sit under
 * captions, so one caption bar can narrate the whole sequence.
 *
 *   const stills = await showStill(page, frames[0]);
 *   for (const frame of frames.slice(1)) await stills.crossfadeTo(frame);
 */
export const showStill = async (
  page: Page,
  src: string,
  options: { fadeMs?: number } = {},
): Promise<StillHandle> => {
  const fadeMs = options.fadeMs ?? 400;
  const id = nextLayerId('vk-still');
  const ids = { base: `${id}-base`, top: `${id}-top` };
  // Two stacked layers: the top fades in over the base, then the base takes
  // the new image and the top resets invisibly for the next crossfade.
  await page.evaluate(
    async (args) => {
      for (const layerId of [args.ids.base, args.ids.top]) {
        const img = document.createElement('img');
        img.id = layerId;
        img.style.cssText = [
          'position:fixed',
          'inset:0',
          'width:100vw',
          'height:100vh',
          'object-fit:cover',
          `z-index:${args.z}`,
          'pointer-events:none',
          `transition:opacity ${args.fadeMs}ms ease-in-out`,
        ].join(';');
        document.body.appendChild(img);
      }
      const base = document.getElementById(args.ids.base) as HTMLImageElement;
      const top = document.getElementById(args.ids.top) as HTMLImageElement;
      top.style.opacity = '0';
      base.src = args.src;
      await base.decode();
    },
    { ids, src, fadeMs, z: Z.still },
  );
  return {
    crossfadeTo: async (nextSrc) => {
      const isStarted = await page.evaluate(
        async (args) => {
          const top = document.getElementById(args.ids.top) as HTMLImageElement | null;
          if (!top) return false;
          top.src = args.src;
          await top.decode();
          top.style.opacity = '1';
          return true;
        },
        { ids, src: nextSrc },
      );
      if (!isStarted) return;
      // Waiting in Node, not on a page timer, works under a paused page clock.
      await page.waitForTimeout(fadeMs);
      await page.evaluate(
        async (args) => {
          const base = document.getElementById(args.ids.base) as HTMLImageElement | null;
          const top = document.getElementById(args.ids.top) as HTMLImageElement | null;
          if (!base || !top) return;
          base.src = args.src;
          await base.decode();
          top.style.transition = 'none';
          top.style.opacity = '0';
          void top.offsetWidth;
          top.style.transition = `opacity ${args.fadeMs}ms ease-in-out`;
        },
        { ids, src: nextSrc, fadeMs },
      );
    },
    hide: async () => {
      // Between crossfades the top layer is transparent, so fading the base suffices.
      await page.evaluate((topId) => document.getElementById(topId)?.remove(), ids.top);
      await hideById(page, ids.base, fadeMs);
    },
  };
};
