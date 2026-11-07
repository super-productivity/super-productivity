export type TaskWidgetEdge = 'left' | 'right' | 'top';
export type TaskWidgetResizeSide = 'left' | 'right';

export interface TaskWidgetLayout {
  dock: TaskWidgetEdge | null;
  isOpen: boolean;
  /** macOS keeps a solid window, so there the window is the shape. */
  isSolid: boolean;
  /** The width the user chose. Closed bars and pills do not use it. */
  width: number;
  canResize: boolean;
  isResizing: boolean;
  /** How far the shape has to start from, when the window itself just moved. */
  shift?: Readonly<{ x: number; y: number }>;
}

/** How close a dragged widget is to docking. At a progress of 1, dropping it docks. */
export interface TaskWidgetDockPreview {
  edge: TaskWidgetEdge;
  progress: number;
}

export interface WidgetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetDisplay {
  id: number;
  bounds: WidgetRect;
  workArea: WidgetRect;
}

// The window keeps one size that fits every shape, as wide as the user set the
// widget. Only the shape inside it changes, because CSS can animate that smoothly
// and resizing a window cannot.
export const DEFAULT_WIDTH = 324;
export const MIN_WIDTH = 248;
export const MAX_WIDTH = 520;
export const WINDOW_HEIGHT = 116;

export const FLOAT_HEIGHT = 56;
export const FLOAT_OPEN_HEIGHT = 100;
export const BAR_WIDTH = 52;
export const BAR_HEIGHT = WINDOW_HEIGHT;
export const BAR_IDLE_HEIGHT = 96;
const SIDE_PANEL_INSET = 12;
export const TOP_BAR_WIDTH = 160;
// The pill around its time: the disc, its margins, and the padding after the time.
const TOP_BAR_CHROME_WIDTH = 64;
export const TOP_BAR_IDLE_WIDTH = 98;

const SNAP_DISTANCE = 24;
const PREVIEW_DISTANCE = 96;
const HINT_PADDING = 24;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const clampWidth = (width: number): number =>
  clamp(Math.round(width), MIN_WIDTH, MAX_WIDTH);

export const isPointInRect = (
  point: Readonly<{ x: number; y: number }>,
  rect: WidgetRect,
): boolean =>
  point.x >= rect.x &&
  point.x < rect.x + rect.width &&
  point.y >= rect.y &&
  point.y < rect.y + rect.height;

export const getFloatingBounds = (
  position: Readonly<{ x: number; y: number; width: number }>,
  isOpen: boolean,
): WidgetRect => ({
  x: position.x,
  y: position.y,
  width: position.width,
  height: isOpen ? FLOAT_OPEN_HEIGHT : FLOAT_HEIGHT,
});

/** The dragged end follows the cursor and the other end stays where it is. */
export const getResizedSpan = (
  start: Readonly<{ x: number; width: number }>,
  side: TaskWidgetResizeSide,
  cursorDelta: number,
  workArea: WidgetRect,
): { x: number; width: number } => {
  const isRight = side === 'right';
  const right = start.x + start.width;
  const room = isRight ? workArea.x + workArea.width - start.x : right - workArea.x;
  const requested = start.width + (isRight ? cursorDelta : -cursorDelta);
  // One already hanging past the screen edge must not jump when it is grabbed.
  const max = Math.min(MAX_WIDTH, Math.max(room, start.width));
  const width = clamp(Math.round(requested), MIN_WIDTH, max);

  return { x: isRight ? start.x : right - width, width };
};

type TaskWidgetDockAnchor = Readonly<{
  x: number;
  centerY: number;
  width: number;
  timeWidth?: number;
}>;

/**
 * The pill keeps its left side while it opens to the right and down, so the
 * pause button stays put. It sits far enough from the right edge to have room.
 */
const getTopDockedBounds = (
  workArea: WidgetRect,
  anchor: TaskWidgetDockAnchor,
  isOpen: boolean,
  isIdle: boolean,
): WidgetRect => {
  const runningWidth = anchor.timeWidth
    ? anchor.timeWidth + TOP_BAR_CHROME_WIDTH
    : TOP_BAR_WIDTH;
  const closedWidth = isIdle ? TOP_BAR_IDLE_WIDTH : runningWidth;

  return {
    x: clamp(anchor.x, workArea.x, workArea.x + workArea.width - anchor.width),
    y: workArea.y,
    width: isOpen ? anchor.width : closedWidth,
    height: isOpen ? FLOAT_OPEN_HEIGHT : FLOAT_HEIGHT,
  };
};

/**
 * The bar stays pinned while the shape grows inward, so the pause button does
 * not move under the cursor when the panel opens.
 */
export const getDockedBounds = (
  edge: TaskWidgetEdge,
  workArea: WidgetRect,
  anchor: TaskWidgetDockAnchor,
  isOpen: boolean,
  isIdle: boolean,
): WidgetRect => {
  if (edge === 'top') {
    return getTopDockedBounds(workArea, anchor, isOpen, isIdle);
  }

  const width = isOpen ? anchor.width - SIDE_PANEL_INSET : BAR_WIDTH;
  const halfBar = BAR_HEIGHT / 2;

  return {
    x: edge === 'left' ? workArea.x : workArea.x + workArea.width - width,
    y: clamp(
      Math.round(anchor.centerY - halfBar),
      workArea.y,
      workArea.y + workArea.height - WINDOW_HEIGHT,
    ),
    width,
    // Only the bottom moves, so the disc stays under the cursor when a task starts.
    height: isIdle ? BAR_IDLE_HEIGHT : BAR_HEIGHT,
  };
};

/** The fixed window that holds a shape, whichever way the shape is anchored. */
export const getWindowBounds = (
  shape: WidgetRect,
  edge: TaskWidgetEdge | null,
  width: number,
): WidgetRect => ({
  x: edge === 'right' ? shape.x + shape.width - width : shape.x,
  y: shape.y,
  width,
  height: WINDOW_HEIGHT,
});

// A window pinned between two monitors would hang over the neighbouring one, so
// only the outer edges of the desktop can hold a bar.
const isOuterEdge = (
  edge: TaskWidgetEdge,
  display: WidgetDisplay,
  displays: readonly WidgetDisplay[],
): boolean => {
  const { x, y, width, height } = display.bounds;

  return !displays.some(({ id, bounds: other }) => {
    if (id === display.id) {
      return false;
    }
    if (edge === 'top') {
      return (
        other.y + other.height <= y && other.x < x + width && other.x + other.width > x
      );
    }
    const isBeside = edge === 'left' ? other.x + other.width <= x : other.x >= x + width;
    return isBeside && other.y < y + height && other.y + other.height > y;
  });
};

const getEdgeGaps = (
  rect: WidgetRect,
  workArea: WidgetRect,
): readonly (readonly [TaskWidgetEdge, number])[] => [
  ['left', rect.x - workArea.x],
  ['right', workArea.x + workArea.width - (rect.x + rect.width)],
  ['top', rect.y - workArea.y],
];

export const getDockPreview = (
  rect: WidgetRect,
  display: WidgetDisplay,
  displays: readonly WidgetDisplay[],
): TaskWidgetDockPreview | null => {
  const nearest = getEdgeGaps(rect, display.workArea)
    .filter(
      ([edge, gap]) => gap <= PREVIEW_DISTANCE && isOuterEdge(edge, display, displays),
    )
    .sort((a, b) => a[1] - b[1])[0];

  if (!nearest) {
    return null;
  }
  const [edge, gap] = nearest;
  const progress = clamp(
    (PREVIEW_DISTANCE - gap) / (PREVIEW_DISTANCE - SNAP_DISTANCE),
    0,
    1,
  );
  return { edge, progress };
};

export const getSnapEdge = (
  rect: WidgetRect,
  display: WidgetDisplay,
  displays: readonly WidgetDisplay[],
): TaskWidgetEdge | null => {
  const preview = getDockPreview(rect, display, displays);
  return preview?.progress === 1 ? preview.edge : null;
};

/** The hint is the landing spot plus some room along the edge for its glow. */
export const getDockHintBounds = (bar: WidgetRect, edge: TaskWidgetEdge): WidgetRect =>
  edge === 'top'
    ? {
        ...bar,
        x: bar.x - HINT_PADDING,
        width: bar.width + HINT_PADDING + HINT_PADDING,
      }
    : {
        ...bar,
        y: bar.y - HINT_PADDING,
        height: bar.height + HINT_PADDING + HINT_PADDING,
      };

/** How far a docked window was dragged away from the edge it is pinned to. */
export const getDistanceFromEdge = (
  rect: WidgetRect,
  edge: TaskWidgetEdge,
  workArea: WidgetRect,
): number => {
  const gap = getEdgeGaps(rect, workArea).find(([gapEdge]) => gapEdge === edge);
  return Math.abs(gap?.[1] ?? 0);
};

/** Where the capsule lands when it is dragged off an edge. */
export const getUndockedPosition = (
  rect: WidgetRect,
  edge: TaskWidgetEdge,
  workArea: WidgetRect,
  width: number,
): { x: number; y: number } => ({
  x: clamp(
    edge === 'right' ? rect.x + rect.width - width : rect.x,
    workArea.x,
    workArea.x + workArea.width - width,
  ),
  y: clamp(rect.y, workArea.y, workArea.y + workArea.height - FLOAT_OPEN_HEIGHT),
});
