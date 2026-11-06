/**
 * A visible pointer for recordings. Headless recordings draw no OS cursor, so
 * clicks would read as state changes with no cause. `installCursor` draws one
 * that follows real Playwright mouse events; `createPointer` glides it between
 * targets instead of teleporting; `installTapRipple` marks taps on touch devices.
 */
import type { Locator, Page } from '@playwright/test';
import { Z } from './dom';

type Point = { x: number; y: number };

export type CursorStyle = 'arrow' | 'ring';

export type CursorOptions = {
  /** 'arrow' draws a pointer with a click ripple; 'ring' a soft halo only. */
  style?: CursorStyle;
  /**
   * Arrow height in CSS px. Defaults to 1/40 of the viewport width (48px at
   * 1080p): an OS-sized cursor gets lost once the video is scaled down.
   */
  size?: number;
};

const HIDDEN_CLASS = 'vk-cursor-hidden';
/** Arrow outline in a 24×24 box; the tip (the hotspot) sits at (4, 2). */
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2v18.5l4.6-4.1 3.1 6.9 2.9-1.3-3-6.7h6.2z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/**
 * Registers the cursor as an init script, so call it before the first
 * navigation. It survives reloads and stays hidden until the mouse first moves.
 */
export const installCursor = async (
  page: Page,
  options: CursorOptions = {},
): Promise<void> => {
  await page.addInitScript(
    (args) => {
      const attach = (): void => {
        if (document.getElementById('vk-cursor')) return;
        const isArrow = args.style === 'arrow';
        const size =
          args.size ?? Math.min(64, Math.max(28, Math.round(window.innerWidth / 40)));
        const cursor = document.createElement('div');
        cursor.id = 'vk-cursor';
        const style = document.createElement('style');
        style.textContent = `
          #vk-cursor {
            position: fixed; top: 0; left: 0; z-index: ${args.z};
            pointer-events: none; will-change: transform;
            transform: translate3d(-9999px, -9999px, 0);
            transition: opacity 150ms ease-out;
          }
          #vk-cursor.ring {
            width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
            background: radial-gradient(rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0) 70%);
          }
          #vk-cursor.arrow {
            width: ${size}px; height: ${size}px;
            margin: ${-size / 12}px 0 0 ${-size / 6}px;
            filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
          }
          #vk-cursor.arrow > svg { transition: transform 90ms ease-out; transform-origin: 17% 8%; }
          #vk-cursor.arrow.pressed > svg { transform: scale(0.86); }
          body.${args.hiddenClass} #vk-cursor { opacity: 0 !important; }
          .vk-click-ripple {
            position: fixed; top: 0; left: 0; z-index: ${args.z};
            width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;
            border: 3px solid rgba(255,255,255,0.9);
            box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
            pointer-events: none; opacity: 0.9;
            transition: transform 420ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 420ms ease-out;
          }
        `;
        document.head.appendChild(style);
        cursor.className = args.style;
        // Trusted: checked-in SVG constant.
        if (isArrow) cursor.innerHTML = args.arrowSvg;
        document.body.appendChild(cursor);
        document.addEventListener(
          'mousemove',
          (e) => {
            cursor.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
          },
          { passive: true },
        );
        if (!isArrow) return;
        document.addEventListener(
          'mousedown',
          (e) => {
            cursor.classList.add('pressed');
            if (document.body.classList.contains(args.hiddenClass)) return;
            const ripple = document.createElement('div');
            ripple.className = 'vk-click-ripple';
            ripple.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0) scale(0.3)`;
            document.body.appendChild(ripple);
            void ripple.offsetWidth;
            ripple.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0) scale(1)`;
            ripple.style.opacity = '0';
            // transitionend, not a timer: a paused page clock freezes timers.
            ripple.addEventListener('transitionend', (end) => {
              if (end.propertyName === 'opacity') ripple.remove();
            });
          },
          { passive: true, capture: true },
        );
        document.addEventListener('mouseup', () => cursor.classList.remove('pressed'), {
          passive: true,
          capture: true,
        });
      };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach, { once: true });
    },
    {
      style: options.style ?? 'arrow',
      size: options.size,
      z: Z.cursor,
      hiddenClass: HIDDEN_CLASS,
      arrowSvg: ARROW_SVG,
    },
  );
};

/**
 * Registers an expanding ring on every touch, for `hasTouch` contexts where no
 * cursor exists. Call before the first navigation.
 */
export const installTapRipple = async (page: Page): Promise<void> => {
  await page.addInitScript((z) => {
    const attach = (): void => {
      if (document.getElementById('vk-tap-ripple-style')) return;
      const style = document.createElement('style');
      style.id = 'vk-tap-ripple-style';
      style.textContent = `
        .vk-tap-ripple {
          position: fixed; top: 0; left: 0; width: 0; height: 0; border-radius: 50%;
          background: radial-gradient(rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.4) 40%, rgba(255,255,255,0) 75%);
          z-index: ${z}; pointer-events: none; opacity: 0.9;
          transform: translate3d(-9999px, -9999px, 0);
          transition: width 520ms ease-out, height 520ms ease-out, opacity 620ms ease-out, transform 520ms ease-out;
        }
      `;
      document.head.appendChild(style);
      const spawn = (clientX: number, clientY: number): void => {
        const ripple = document.createElement('div');
        ripple.className = 'vk-tap-ripple';
        ripple.style.transform = `translate3d(${clientX}px,${clientY}px,0)`;
        document.body.appendChild(ripple);
        void ripple.offsetWidth;
        const finalSize = 220;
        const half = finalSize / 2;
        ripple.style.width = `${finalSize}px`;
        ripple.style.height = `${finalSize}px`;
        ripple.style.marginLeft = `${-half}px`;
        ripple.style.marginTop = `${-half}px`;
        ripple.style.opacity = '0';
        // Opacity outlasts the size transition; removing earlier would pop.
        ripple.addEventListener('transitionend', (end) => {
          if (end.propertyName === 'opacity') ripple.remove();
        });
      };
      // Pointer events alone: every touch also fires one, so listening to
      // touchstart as well drew two ripples per tap.
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (e.pointerType !== 'mouse') spawn(e.clientX, e.clientY);
        },
        { passive: true, capture: true },
      );
    };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  }, Z.cursor);
};

/** Fades the cursor in or out, e.g. while typing, where it would sit in the input. */
export const setCursorVisible = async (page: Page, isVisible: boolean): Promise<void> => {
  await page.evaluate(
    (args) => document.body.classList.toggle(args.cls, !args.isVisible),
    { cls: HIDDEN_CLASS, isVisible },
  );
};

const easeInOutCubic = (t: number): number => {
  if (t < 0.5) return 4 * t * t * t;
  const doubled = 2 * t;
  const shifted = 2 - doubled;
  const halfCubed = Math.pow(shifted, 3) / 2;
  return 1 - halfCubed;
};

/** Point on the path at eased progress `p`, bowed sideways by `arc` × distance. */
const pathPoint = (from: Point, to: Point, p: number, arc: number): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular (-dy, dx) has the path's length, so arc scales with distance.
  const bow = arc * Math.sin(Math.PI * p);
  const along = { x: dx * p, y: dy * p };
  const aside = { x: -dy * bow, y: dx * bow };
  return { x: from.x + along.x + aside.x, y: from.y + along.y + aside.y };
};

/**
 * Moves the mouse along an eased path. Progress comes from elapsed time, not
 * step count: each `mouse.move` round-trip costs real time, so fixed per-step
 * delays stretched glides well past `durationMs`. A slight arc reads as a hand
 * moving a mouse; straight lines read as a robot. `arc: 0` for straight paths.
 */
export const smoothMouseMove = async (
  page: Page,
  from: Point,
  to: Point,
  options: { durationMs?: number; arc?: number } = {},
): Promise<void> => {
  const durationMs = options.durationMs ?? 520;
  const arc = options.arc ?? 0.08;
  const startedAt = Date.now();
  let t = 0;
  while (t < 1) {
    t = Math.min(1, (Date.now() - startedAt) / durationMs);
    const { x, y } = pathPoint(from, to, easeInOutCubic(t), arc);
    await page.mouse.move(x, y);
    // One move per 25fps recording frame; finer steps are never seen.
    if (t < 1) await page.waitForTimeout(40);
  }
};

const centerOf = async (target: Locator): Promise<Point> => {
  const box = await target.boundingBox();
  if (!box) throw new Error(`video-kit: target is not visible: ${target}`);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const center = { x: box.x + halfW, y: box.y + halfH };
  // A camera zoom can pan targets off-screen, where Playwright cannot scroll
  // them back; fail here rather than glide off-frame and time out on click.
  const frame = target.page().viewportSize();
  const isOutside =
    frame &&
    (center.x < 0 || center.y < 0 || center.x > frame.width || center.y > frame.height);
  if (isOutside) {
    throw new Error(
      `video-kit: target is outside the frame at (${Math.round(center.x)}, ` +
        `${Math.round(center.y)}); reset or reframe the camera first: ${target}`,
    );
  }
  return center;
};

export type GlideOptions = {
  /** Whole journey, including the approach leg of `fromLeft`. */
  durationMs?: number;
  /**
   * Arrive from the target's left edge. Use for menu items: a straight glide
   * crosses submenu triggers and pops them open.
   */
  fromLeft?: boolean;
};

export type DragOptions = {
  /** Travel time from source to target. */
  durationMs?: number;
  /** Pause after picking up, so the lift reads before the move. */
  pickupMs?: number;
  /** Pause over the target before releasing. */
  dropMs?: number;
};

export type Pointer = {
  /** Glides to the target's center, showing the cursor if it was hidden. */
  glideTo: (target: Locator, options?: GlideOptions) => Promise<void>;
  /** Drags the source onto the target's center with a visible pickup and drop. */
  drag: (source: Locator, target: Locator, options?: DragOptions) => Promise<void>;
  /**
   * Hides the cursor and parks the mouse in the corner, clearing hover states.
   * The next glide re-enters near its target instead of crossing the screen.
   */
  park: (options?: { isBehindBlack?: boolean }) => Promise<void>;
};

/** Tracks the mouse position so consecutive moves glide from where it is. */
export const createPointer = (page: Page): Pointer => {
  let position: Point | null = null;

  const moveTo = async (
    to: Point,
    move: { durationMs: number; arc?: number },
  ): Promise<void> => {
    if (!position) {
      // Re-enter near the target while hidden; the cursor fades in during the glide.
      position = { x: to.x + 160, y: to.y + 120 };
      await page.mouse.move(position.x, position.y);
    }
    // Also undoes a hide while typing, so the next glide never moves unseen.
    await setCursorVisible(page, true);
    await smoothMouseMove(page, position, to, move);
    position = to;
  };

  const glideTo: Pointer['glideTo'] = async (target, options = {}) => {
    const durationMs = options.durationMs ?? 450;
    const to = await centerOf(target);
    if (!options.fromLeft) {
      await moveTo(to, { durationMs });
      return;
    }
    const box = await target.boundingBox();
    // Most of the time on the approach; the final leg is short and straight
    // so it cannot bow across a neighbouring item.
    await moveTo(
      { x: (box?.x ?? to.x) - 40, y: to.y },
      { durationMs: durationMs * 0.65 },
    );
    await moveTo(to, { durationMs: durationMs * 0.35, arc: 0 });
  };

  return {
    glideTo,
    drag: async (source, target, options = {}) => {
      const from = await centerOf(source);
      const to = await centerOf(target);
      await glideTo(source, { durationMs: 600 });
      await page.waitForTimeout(200);
      await page.mouse.down();
      // Drag libraries wait for a few px of travel before a drag starts.
      const lifted = { x: from.x, y: from.y + 15 };
      await page.mouse.move(lifted.x, lifted.y, { steps: 5 });
      await page.waitForTimeout(options.pickupMs ?? 250);
      // Straight: a bowed path can sweep over other drop zones and reorder them.
      await smoothMouseMove(page, lifted, to, {
        durationMs: options.durationMs ?? 900,
        arc: 0,
      });
      await page.waitForTimeout(options.dropMs ?? 350);
      await page.mouse.up();
      position = to;
    },
    park: async (options = {}) => {
      await setCursorVisible(page, false);
      // Let the fade finish before the jump, unless black already covers it.
      if (!options.isBehindBlack) await page.waitForTimeout(150);
      await page.mouse.move(0, 0);
      position = null;
    },
  };
};
