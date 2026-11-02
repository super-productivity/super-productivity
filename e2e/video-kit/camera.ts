/**
 * Camera moves: eased zoom-and-pan onto a UI element, and back out.
 *
 * Implemented as a CSS transform on the stage element (the app root), so it is
 * paint-only: layout, media queries and app state are untouched, and kit layers
 * (captions, cursor, cards) live outside the stage and stay unzoomed. Playwright
 * measures elements after transforms, so clicks while zoomed still land.
 *
 * Constraints, all from the transform living on the stage only:
 *  - Popups rendered outside the stage (e.g. Angular CDK overlays) are placed
 *    correctly but at 1× size, and do not follow a moving camera. Open menus and
 *    dialogs at rest, and zoom out before opening them if the size gap shows.
 *  - Drag libraries cache drop-zone rects on pickup: never move the camera
 *    during a drag.
 *  - A transformed stage becomes the containing block for its `position: fixed`
 *    children. `reset()` removes the transform entirely once back at 1×.
 */
import type { Locator, Page } from '@playwright/test';
import { OVERLAY_CLASS } from './captions';

/** Screen edges (px) covered by overlays. */
export type Insets = { top: number; right: number; bottom: number; left: number };

export type ZoomOptions = {
  /**
   * Magnification. Defaults to fitting the target into ~70% of the uncovered
   * frame, capped at 2.5× so some context stays around it. Throws when the
   * target is too large for that to magnify visibly.
   */
  scale?: number;
  durationMs?: number;
  /**
   * Screen edges covered by your own overlays. The target is framed in the
   * rest, and the stage may pull away from a covered edge since nothing shows
   * there. Visible lower captions are detected and need no entry here.
   */
  insets?: Partial<Insets>;
};

export type Camera = {
  /**
   * Centers the target (or the box around several) and magnifies it, without
   * panning past the stage edges.
   */
  zoomTo: (target: Locator | Locator[], options?: ZoomOptions) => Promise<void>;
  /** Returns to the unzoomed view. */
  reset: (options?: { durationMs?: number }) => Promise<void>;
};

type View = { scale: number; x: number; y: number };

/** easeInOutCubic: slow start and landing, like a camera operator. */
const CAMERA_CURVE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/**
 * Creates a camera for the element matching `stageSelector`, which should cover
 * the viewport (e.g. `app-root`). One camera per page.
 */
export const createCamera = (page: Page, stageSelector: string): Camera => {
  let view: View = IDENTITY;

  const move = async (next: View, durationMs: number): Promise<void> => {
    await page.evaluate(
      (args) => {
        const stage = document.querySelector<HTMLElement>(args.selector);
        if (!stage) throw new Error(`video-kit camera: no stage "${args.selector}"`);
        // CSS zoom on the stage scales translate lengths too; measure the actual
        // screen shift of 100px once so the pan lands in screen pixels.
        if (!stage.dataset.vkPxRatio) {
          stage.style.transition = 'none';
          const before = stage.getBoundingClientRect().left;
          stage.style.transform = 'translate(100px, 0)';
          const after = stage.getBoundingClientRect().left;
          stage.style.transform = '';
          stage.dataset.vkPxRatio = String((after - before) / 100);
        }
        const ratio = Number(stage.dataset.vkPxRatio);
        const { scale, x, y } = args.next;
        stage.style.transformOrigin = '0 0';
        stage.style.transition = `transform ${args.durationMs}ms ${args.curve}`;
        stage.style.transform = `translate(${x / ratio}px, ${y / ratio}px) scale(${scale})`;
      },
      { selector: stageSelector, next, durationMs, curve: CAMERA_CURVE },
    );
    await page.waitForTimeout(durationMs);
    view = next;
  };

  return {
    zoomTo: async (target, options = {}) => {
      const box = await unionBox(Array.isArray(target) ? target : [target]);
      const measured = await page.evaluate(
        (args) => {
          const stage = document.querySelector(args.selector);
          const rect = stage?.getBoundingClientRect();
          const captionTops = Array.from(
            document.querySelectorAll(`.${args.overlayClass}.lower.visible`),
            (el) => el.getBoundingClientRect().top,
          );
          const captionTop = Math.min(window.innerHeight, ...captionTops);
          return {
            vw: window.innerWidth,
            vh: window.innerHeight,
            stageLeft: rect?.left ?? 0,
            stageTop: rect?.top ?? 0,
            stageWidth: rect?.width ?? window.innerWidth,
            stageHeight: rect?.height ?? window.innerHeight,
            captionHeight: window.innerHeight - captionTop,
          };
        },
        { selector: stageSelector, overlayClass: OVERLAY_CLASS },
      );
      const { captionHeight, ...stageFrame } = measured;
      const explicit = options.insets ?? {};
      const insets: Insets = {
        top: explicit.top ?? 0,
        right: explicit.right ?? 0,
        bottom: Math.max(explicit.bottom ?? 0, captionHeight),
        left: explicit.left ?? 0,
      };
      const frame = { ...stageFrame, insets };
      const scale = options.scale ?? autoScale({ box, view, frame });
      const next = frameTarget({ box, view, scale, frame });
      await move(next, options.durationMs ?? 900);
    },
    reset: async (options = {}) => {
      const durationMs = options.durationMs ?? 700;
      await move(IDENTITY, durationMs);
      await page.evaluate((selector) => {
        const stage = document.querySelector<HTMLElement>(selector);
        if (!stage) return;
        stage.style.transition = '';
        stage.style.transform = '';
      }, stageSelector);
    },
  };
};

type Box = { x: number; y: number; width: number; height: number };

const unionBox = async (targets: Locator[]): Promise<Box> => {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()));
  const visible = boxes.filter((box): box is Box => box !== null);
  if (visible.length < targets.length || visible.length === 0) {
    throw new Error(`video-kit camera: target is not visible: ${targets.join(', ')}`);
  }
  const left = Math.min(...visible.map((b) => b.x));
  const top = Math.min(...visible.map((b) => b.y));
  const right = Math.max(...visible.map((b) => b.x + b.width));
  const bottom = Math.max(...visible.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

type FrameInput = {
  /** Target box on screen, under the current view. */
  box: Box;
  view: View;
  scale: number;
  /** Viewport size and the stage's on-screen rect, under the current view. */
  frame: {
    vw: number;
    vh: number;
    stageLeft: number;
    stageTop: number;
    stageWidth: number;
    stageHeight: number;
    /** Covered screen edges; framing happens in the rest. */
    insets: Insets;
  };
};

const FIT_FILL = 0.7;
const MAX_FIT_SCALE = 2.5;
// Below this a camera move reads as a wobble, not a zoom.
const MIN_FIT_SCALE = 1.15;

/** Scale at which the target fills FIT_FILL of the tighter uncovered axis. */
const fitScale = ({ box, view, frame }: Omit<FrameInput, 'scale'>): number => {
  const width = box.width / view.scale;
  const height = box.height / view.scale;
  const { insets } = frame;
  const fitX = (FIT_FILL * (frame.vw - insets.left - insets.right)) / width;
  const fitY = (FIT_FILL * (frame.vh - insets.top - insets.bottom)) / height;
  return Math.min(fitX, fitY);
};

/** Fitted scale, capped; throws instead of silently barely moving. */
const autoScale = (input: Omit<FrameInput, 'scale'>): number => {
  const fit = fitScale(input);
  if (fit < MIN_FIT_SCALE) {
    throw new Error(
      `video-kit: zoomTo target is too large to magnify (fits at ${fit.toFixed(2)}×). ` +
        'Frame a smaller part of it, or pass { scale } to crop deliberately.',
    );
  }
  return Math.min(MAX_FIT_SCALE, fit);
};

/**
 * Computes the view that puts the target's center at the center of the
 * uncovered frame at `scale`, clamped so the stage keeps covering it (no
 * empty edges; covered edges may show empty stage, since nothing is seen).
 * With transform-origin at the stage's unzoomed top-left S, a stage point P
 * lands on screen at S + t + s·(P − S).
 */
export const frameTarget = ({ box, view, scale, frame }: FrameInput): View => {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const x = axisOffset({
    screenCenter: box.x + halfW,
    stageStart: frame.stageLeft,
    stageSpan: frame.stageWidth,
    visible: { start: frame.insets.left, end: frame.vw - frame.insets.right },
    current: { offset: view.x, scale: view.scale },
    scale,
  });
  const y = axisOffset({
    screenCenter: box.y + halfH,
    stageStart: frame.stageTop,
    stageSpan: frame.stageHeight,
    visible: { start: frame.insets.top, end: frame.vh - frame.insets.bottom },
    current: { offset: view.y, scale: view.scale },
    scale,
  });
  return { scale, x, y };
};

type Axis = {
  /** Target center on screen, under the current view. */
  screenCenter: number;
  /** Stage start and length on screen, under the current view. */
  stageStart: number;
  stageSpan: number;
  /** The uncovered screen range on this axis. */
  visible: { start: number; end: number };
  current: { offset: number; scale: number };
  scale: number;
};

const axisOffset = (a: Axis): number => {
  // Undo the current view: S = start − t, and P − S = (screen − start) / s.
  const origin = a.stageStart - a.current.offset;
  const fromOrigin = (a.screenCenter - a.stageStart) / a.current.scale;
  const span = a.stageSpan / a.current.scale;
  const visibleCenter = (a.visible.start + a.visible.end) / 2;
  const scaledFromOrigin = a.scale * fromOrigin;
  const centered = visibleCenter - origin - scaledFromOrigin;
  // Keep the stage's leading edge at or before the visible start and its
  // trailing edge at or past the visible end. A smaller stage just centers.
  const max = a.visible.start - origin;
  const scaledSpan = a.scale * span;
  const min = a.visible.end - origin - scaledSpan;
  if (min > max) return centered;
  return Math.min(max, Math.max(min, centered));
};
