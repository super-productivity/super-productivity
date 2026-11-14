import { BrowserWindow, screen } from 'electron';
import { IS_MAC, isWaylandEnv } from '../common.const';
import { TaskWidgetDockHint } from './task-widget-dock-hint';
import {
  BAR_HEIGHT,
  getDistanceFromEdge,
  getResizedSpan,
  getDockedBounds,
  getDockHintBounds,
  getDockPreview,
  getFloatingBounds,
  getSnapEdge,
  getUndockedPosition,
  getWindowBounds,
  isPointInRect,
  MAX_WIDTH,
  TaskWidgetDockPreview,
  TaskWidgetEdge,
  TaskWidgetLayout,
  TaskWidgetResizeSide,
  WidgetRect,
} from './task-widget-layout';

export interface TaskWidgetPlacementState {
  x: number;
  y: number;
  edge: TaskWidgetEdge | null;
  centerY: number;
  width: number;
}

export interface TaskWidgetPlacement {
  getLayout: () => TaskWidgetLayout;
  getShape: () => WidgetRect;
  setIdle: (isIdle: boolean) => void;
  setTimeWidth: (timeWidth: number) => void;
  toggleDetails: () => void;
  startResize: (side: TaskWidgetResizeSide) => void;
  resize: () => void;
  endResize: () => void;
  destroy: () => void;
}

// The window is a drag region, which hides mouse events from the renderer, so
// the cursor is read here. A check costs a few microseconds. It decides when
// clicks pass through, so it has to notice the cursor quickly.
const POLL_MS = 40;
const CLOSE_DELAY_MS = 1000;
// macOS resizes its window after the content animated, so it must match the CSS.
const CLOSE_ANIMATION_MS = 220;
// Matches the morph in the CSS, so the bar lands on the hint before it goes.
const HINT_LINGER_MS = 340;
const DRAG_SETTLE_MS = 300;
// Outside Windows a held button looks the same as a still one, so a pause this
// long ends the drag even if the cursor never left its spot on the widget.
const DRAG_HOLD_MAX_MS = 2000;
const UNDOCK_DISTANCE = 32;
// Fractional display scaling rounds window positions by a pixel or two.
const MOVE_TOLERANCE = 3;

const IS_WINDOWS = process.platform === 'win32';

// Wayland hides the cursor and window positions from apps.
const isCursorHidden = (): boolean => isWaylandEnv(process.platform, process.env);

const isSameRect = (a: WidgetRect, b: WidgetRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const getTaskWidgetShape = (
  state: TaskWidgetPlacementState,
  isOpen: boolean,
  isIdle: boolean,
  timeWidth?: number,
): WidgetRect => {
  if (!state.edge) {
    return getFloatingBounds(state, isOpen && !isIdle);
  }
  const { workArea } = screen.getDisplayNearestPoint({ x: state.x, y: state.centerY });
  return getDockedBounds(state.edge, workArea, { ...state, timeWidth }, isOpen, isIdle);
};

export const getTaskWidgetWindowBounds = (
  state: TaskWidgetPlacementState,
  isOpen: boolean,
  isIdle: boolean,
  timeWidth?: number,
): WidgetRect => {
  const shape = getTaskWidgetShape(state, isOpen, isIdle, timeWidth);
  if (IS_MAC) {
    return shape;
  }
  const bounds = getWindowBounds(shape, state.edge, state.width);
  // Without the cursor nothing can let clicks through the empty part of the
  // window, so on Wayland the window is only as tall as the widget.
  return isCursorHidden() ? { ...bounds, height: shape.height } : bounds;
};

export const createTaskWidgetPlacement = (
  win: BrowserWindow,
  initialState: TaskWidgetPlacementState,
  isInitiallyIdle: boolean,
  onStateChange: (state: TaskWidgetPlacementState) => void,
  createDockHint: () => TaskWidgetDockHint,
): TaskWidgetPlacement => {
  // Wayland hides the cursor and window positions from apps, so closing on
  // leave and docking cannot work there. Staying open keeps Done and Open reachable.
  const isCursorKnown = !isCursorHidden();

  let state = initialState;
  let isIdle = isInitiallyIdle;
  let isOpen = !isCursorKnown;
  let isHovering = false;
  let hoverChangedAt = 0;
  let isDragging = false;
  let timeWidth: number | undefined;
  let isIgnoringMouse = false;
  let expectedBounds = getTaskWidgetWindowBounds(state, isOpen, isIdle);
  let shrinkTimer: NodeJS.Timeout | null = null;
  let dragSettleTimer: NodeJS.Timeout | null = null;
  let lastDragMoveAt = 0;
  let grabOffset: Readonly<{ x: number; y: number }> | null = null;
  let cursorInterval: NodeJS.Timeout | null = null;
  let dockHint: TaskWidgetDockHint | null = null;
  let hintTimer: NodeJS.Timeout | null = null;
  let lastPreviewKey = '';
  let resizeStart: Readonly<{
    side: TaskWidgetResizeSide;
    cursorX: number;
    x: number;
    width: number;
  }> | null = null;

  const clearShrinkTimer = (): void => {
    if (shrinkTimer) {
      clearTimeout(shrinkTimer);
      shrinkTimer = null;
    }
  };

  const getLayout = (): TaskWidgetLayout => ({
    dock: state.edge,
    isOpen,
    isSolid: IS_MAC,
    width: state.width,
    canResize: isCursorKnown,
    isResizing: !!resizeStart,
  });

  const getShape = (): WidgetRect => getTaskWidgetShape(state, isOpen, isIdle, timeWidth);

  const sendLayout = (shift?: TaskWidgetLayout['shift']): void => {
    win.webContents.send('update-layout', { ...getLayout(), shift });
  };

  // Always states the size: setPosition grows the window by a few pixels on
  // every call at fractional display scales such as 125%.
  const moveWindow = (next: WidgetRect): void => {
    expectedBounds = next;
    win.setBounds(next);
  };

  // While resizing, the window is already as wide as the widget can get, so the
  // width is a plain CSS change and the end being dragged stays smooth.
  const getWindowTarget = (): WidgetRect => {
    const bounds = getTaskWidgetWindowBounds(state, isOpen, isIdle, timeWidth);
    return resizeStart && !IS_MAC ? { ...bounds, width: MAX_WIDTH } : bounds;
  };

  const applyBounds = (): void => {
    const next = getWindowTarget();
    if (!isSameRect(next, expectedBounds)) {
      moveWindow(next);
    }
  };

  const setOpen = (nextIsOpen: boolean): void => {
    if (nextIsOpen === isOpen) {
      return;
    }
    clearShrinkTimer();
    isOpen = nextIsOpen;

    if (isOpen) {
      // Grow first, so the content has room to animate into.
      applyBounds();
      sendLayout();
    } else {
      sendLayout();
      shrinkTimer = setTimeout(applyBounds, CLOSE_ANIMATION_MS);
    }
  };

  // The window is larger than the shape it shows, and the empty part must not
  // swallow clicks meant for whatever is underneath.
  const setIgnoreMouse = (isIgnoring: boolean): void => {
    if (isIgnoring !== isIgnoringMouse && !IS_MAC) {
      isIgnoringMouse = isIgnoring;
      win.setIgnoreMouseEvents(isIgnoring, { forward: true });
    }
  };

  const checkCursor = (): void => {
    if (win.isDestroyed() || !win.isVisible() || isDragging || resizeStart) {
      return;
    }
    const isInside = isPointInRect(screen.getCursorScreenPoint(), getShape());
    setIgnoreMouse(!isInside);

    if (isInside !== isHovering) {
      isHovering = isInside;
      hoverChangedAt = Date.now();
    }
    if (!isHovering && Date.now() - hoverChangedAt >= CLOSE_DELAY_MS) {
      setOpen(false);
    }
  };

  const hasMovedFromExpected = (): boolean => {
    const bounds = win.getBounds();
    return (
      Math.abs(bounds.x - expectedBounds.x) > MOVE_TOLERANCE ||
      Math.abs(bounds.y - expectedBounds.y) > MOVE_TOLERANCE
    );
  };

  const getCapsule = (bounds: WidgetRect): WidgetRect =>
    getFloatingBounds({ ...bounds, width: state.width }, false);

  const sendDockPreview = (preview: TaskWidgetDockPreview | null): void => {
    // A drag moves the window far more often than the picture changes.
    const key = preview ? `${preview.edge}:${preview.progress.toFixed(2)}` : '';
    if (key !== lastPreviewKey) {
      lastPreviewKey = key;
      win.webContents.send('update-dock-preview', preview);
    }
  };

  const clearDockPreview = (): void => {
    sendDockPreview(null);
    dockHint?.destroy();
    dockHint = null;
  };

  // Destroying a window mid-morph costs a frame, and the hint is what the bar
  // lands on anyway, so it can wait until the bar has covered it.
  const retireDockHint = (): void => {
    sendDockPreview(null);
    const hint = dockHint;
    dockHint = null;
    if (hint) {
      hintTimer = setTimeout(() => hint.destroy(), HINT_LINGER_MS);
    }
  };

  const updateDockPreview = (): void => {
    const capsule = getCapsule(win.getBounds());
    const display = screen.getDisplayMatching(capsule);
    const preview = state.edge
      ? null
      : getDockPreview(capsule, display, screen.getAllDisplays());

    if (!preview) {
      clearDockPreview();
      return;
    }

    const halfBar = BAR_HEIGHT / 2;
    const landing = getDockedBounds(
      preview.edge,
      display.workArea,
      { x: capsule.x, centerY: capsule.y + halfBar, width: state.width, timeWidth },
      false,
      isIdle,
    );
    sendDockPreview(preview);
    dockHint = dockHint ?? createDockHint();
    dockHint.update(preview, getDockHintBounds(landing, preview.edge));
  };

  const finishDrag = (): void => {
    if (win.isDestroyed() || !hasMovedFromExpected()) {
      isDragging = false;
      clearDockPreview();
      return;
    }
    isDragging = false;
    retireDockHint();

    const bounds = win.getBounds();
    const halfBar = BAR_HEIGHT / 2;
    const centerY = Math.round(bounds.y + halfBar);

    if (state.edge) {
      const { workArea } = screen.getDisplayMatching(bounds);
      const isStillDocked =
        getDistanceFromEdge(bounds, state.edge, workArea) <= UNDOCK_DISTANCE;
      state = isStillDocked
        ? { ...state, x: bounds.x, y: bounds.y, centerY }
        : {
            ...state,
            ...getUndockedPosition(bounds, state.edge, workArea, state.width),
            edge: null,
            centerY,
          };
    } else {
      const capsule = getCapsule(bounds);
      const display = screen.getDisplayMatching(capsule);
      const edge = getSnapEdge(capsule, display, screen.getAllDisplays());
      state = { ...state, x: bounds.x, y: bounds.y, edge, centerY };
    }

    isOpen = !isCursorKnown;
    isHovering = false;

    // The shape starts where the user dropped it, then morphs into place.
    const next = getTaskWidgetWindowBounds(state, isOpen, isIdle, timeWidth);
    sendLayout({ x: bounds.x - next.x, y: bounds.y - next.y });
    moveWindow(next);
    onStateChange(state);
  };

  const getCursorOffset = (): { x: number; y: number } => {
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    return { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  };

  // While the button is held the window moves with the cursor, so the cursor stays
  // on the same spot of the widget. Docking waits until it leaves that spot, so a
  // pause near an edge mid-drag doesn't dock under a held button.
  const settleDrag = (): void => {
    dragSettleTimer = null;
    const offset = isCursorKnown ? getCursorOffset() : null;
    const mayStillBeHeld =
      !!offset &&
      !!grabOffset &&
      Math.abs(offset.x - grabOffset.x) <= MOVE_TOLERANCE &&
      Math.abs(offset.y - grabOffset.y) <= MOVE_TOLERANCE;
    if (mayStillBeHeld && Date.now() - lastDragMoveAt < DRAG_HOLD_MAX_MS) {
      dragSettleTimer = setTimeout(settleDrag, DRAG_SETTLE_MS);
      return;
    }
    finishDrag();
  };

  const onMove = (): void => {
    if (!hasMovedFromExpected()) {
      return;
    }
    isDragging = true;
    clearShrinkTimer();
    updateDockPreview();

    // Only Windows reports the end of a drag. Elsewhere it counts as finished
    // once the window has stopped moving and the button seems to be up.
    if (!IS_WINDOWS) {
      lastDragMoveAt = Date.now();
      grabOffset = isCursorKnown ? getCursorOffset() : null;
      if (dragSettleTimer) {
        clearTimeout(dragSettleTimer);
      }
      dragSettleTimer = setTimeout(settleDrag, DRAG_SETTLE_MS);
    }
  };

  // The cursor check only runs while the widget can be seen.
  const startCursorCheck = (): void => {
    if (isCursorKnown && !cursorInterval) {
      cursorInterval = setInterval(checkCursor, POLL_MS);
      cursorInterval.unref();
    }
  };

  const stopCursorCheck = (): void => {
    if (cursorInterval) {
      clearInterval(cursorInterval);
      cursorInterval = null;
    }
  };

  win.on('move', onMove);
  if (IS_WINDOWS) {
    win.on('moved', finishDrag);
  }
  win.on('show', startCursorCheck);
  win.on('hide', stopCursorCheck);
  if (win.isVisible()) {
    startCursorCheck();
  }
  applyBounds();

  return {
    getLayout,
    getShape,
    setIdle: (nextIsIdle) => {
      if (nextIsIdle === isIdle) {
        return;
      }
      isIdle = nextIsIdle;
      if (isIdle && isCursorKnown) {
        setOpen(false);
      }
      if (!isDragging) {
        applyBounds();
      }
    },
    toggleDetails: () => {
      if (!isCursorKnown || isIdle || isDragging) {
        return;
      }
      // Counts from the click, so it stays open long enough to reach the buttons.
      hoverChangedAt = Date.now();
      setOpen(!isOpen);
    },
    startResize: (side) => {
      if (!isCursorKnown || state.edge || isDragging || resizeStart) {
        return;
      }
      const cursorX = screen.getCursorScreenPoint().x;
      resizeStart = { side, cursorX, x: state.x, width: state.width };
      applyBounds();
      sendLayout();
    },
    resize: () => {
      if (!resizeStart) {
        return;
      }
      const { workArea } = screen.getDisplayMatching(getShape());
      const cursorDelta = screen.getCursorScreenPoint().x - resizeStart.cursorX;
      const span = getResizedSpan(resizeStart, resizeStart.side, cursorDelta, workArea);
      if (span.x !== state.x || span.width !== state.width) {
        state = { ...state, ...span };
        sendLayout();
        applyBounds();
      }
    },
    endResize: () => {
      if (resizeStart) {
        resizeStart = null;
        sendLayout();
        applyBounds();
        onStateChange(state);
      }
    },
    setTimeWidth: (nextTimeWidth) => {
      timeWidth = nextTimeWidth;
      if (!isDragging) {
        applyBounds();
      }
    },
    destroy: () => {
      clearShrinkTimer();
      dockHint?.destroy();
      if (hintTimer) {
        clearTimeout(hintTimer);
      }
      stopCursorCheck();
      if (dragSettleTimer) {
        clearTimeout(dragSettleTimer);
      }
    },
  };
};
