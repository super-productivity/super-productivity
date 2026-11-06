import { DRAG_DELAY_FOR_TOUCH } from '../../app.constants';

/** 1 = to the next page (finger moves left), -1 = to the previous page. */
export type SwipePagerDirection = 1 | -1;

/** Movement before a touch is classified as a horizontal pan or a scroll. */
export const CLAIM_THRESHOLD_PX = 10;
/** Horizontal movement must dominate vertical movement by this factor. */
export const DIRECTION_RATIO = 1.5;
/**
 * A touch held longer than this before moving is a long-press drag
 * (cdkDragStartDelay), not a swipe. Below DRAG_DELAY_FOR_TOUCH so the
 * drag can still take over, as in PanDirective.
 */
export const MAX_CLAIM_DELAY_MS = DRAG_DELAY_FOR_TOUCH - 100;
/** Share of the page width a release must pass to change the page. */
export const COMMIT_DISTANCE_RATIO = 0.25;
/** A fling at least this fast (px/ms) changes the page regardless of distance. */
export const COMMIT_VELOCITY = 0.3;
/** How far the page follows the finger towards an edge with no page. */
export const EDGE_RESISTANCE = 0.25;
/** Only this recent motion counts towards the release velocity. */
export const VELOCITY_WINDOW_MS = 100;

const MIN_SETTLE_MS = 120;
const MAX_SETTLE_MS = 280;
/** Lower bound for the settle speed (px/ms), so slow releases still finish briskly. */
const MIN_SETTLE_SPEED = 1.2;

export type GestureClaim = 'horizontal' | 'other' | null;

/**
 * Classifies a touch once it has moved far enough: `horizontal` starts a pan,
 * `other` (scroll, long-press drag) hands the gesture to the browser or CDK,
 * `null` waits for more movement.
 */
export const classifyGesture = (
  deltaX: number,
  deltaY: number,
  elapsedMs: number,
): GestureClaim => {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < CLAIM_THRESHOLD_PX && absY < CLAIM_THRESHOLD_PX) {
    return null;
  }
  if (elapsedMs > MAX_CLAIM_DELAY_MS) {
    return 'other';
  }
  return absX > absY * DIRECTION_RATIO ? 'horizontal' : 'other';
};

/** Offset the page row follows the finger with, damped towards a missing page. */
export const getPanOffset = (
  deltaX: number,
  hasPrev: boolean,
  hasNext: boolean,
): number => {
  const isTowardsMissingPage = (deltaX > 0 && !hasPrev) || (deltaX < 0 && !hasNext);
  return isTowardsMissingPage ? deltaX * EDGE_RESISTANCE : deltaX;
};

/** Which page a released pan settles on; 0 keeps the current one. */
export const getReleaseDirection = (params: {
  deltaX: number;
  velocityX: number;
  width: number;
  hasPrev: boolean;
  hasNext: boolean;
}): SwipePagerDirection | 0 => {
  const { deltaX, velocityX, width, hasPrev, hasNext } = params;
  if (deltaX === 0 || width <= 0) {
    return 0;
  }
  const direction: SwipePagerDirection = deltaX < 0 ? 1 : -1;
  if ((direction === 1 && !hasNext) || (direction === -1 && !hasPrev)) {
    return 0;
  }
  // A fling back towards the start cancels, however far the page was dragged.
  const isFlingSameWay = Math.sign(velocityX) === Math.sign(deltaX);
  if (Math.abs(velocityX) >= COMMIT_VELOCITY) {
    return isFlingSameWay ? direction : 0;
  }
  return Math.abs(deltaX) >= width * COMMIT_DISTANCE_RATIO ? direction : 0;
};

/** Settle animation length: faster for a fast release, bounded either way. */
export const getSettleDurationMs = (remainingPx: number, velocityX: number): number => {
  const speed = Math.max(Math.abs(velocityX), MIN_SETTLE_SPEED);
  return Math.round(
    Math.min(MAX_SETTLE_MS, Math.max(MIN_SETTLE_MS, Math.abs(remainingPx) / speed)),
  );
};

/** Velocity (px/ms) over the most recent samples, oldest first. */
export const getVelocityX = (samples: readonly { x: number; t: number }[]): number => {
  if (samples.length < 2) {
    return 0;
  }
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
};
