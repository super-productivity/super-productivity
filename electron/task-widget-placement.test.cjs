const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const placementPath = path.resolve(__dirname, 'task-widget/task-widget-placement.ts');

const DISPLAY = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

let cursor;
let isWayland;
let isMac;
let platform;
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

class FakeWindow {
  constructor() {
    this.bounds = { x: 0, y: 0, width: 324, height: 116 };
    this.boundsHistory = [];
    this.moves = [];
    this.layouts = [];
    this.previews = [];
    this.ignoring = [];
    this.visible = true;
    this.visibleChecks = 0;
    this.handlers = new Map();
    this.webContents = {
      send: (channel, payload) => {
        if (channel === 'update-layout') {
          this.layouts.push(payload);
        }
        if (channel === 'update-dock-preview') {
          this.previews.push(payload);
        }
      },
    };
  }
  isDestroyed() {
    return false;
  }
  isVisible() {
    this.visibleChecks += 1;
    return this.visible;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(bounds) {
    this.bounds = { ...bounds };
    this.boundsHistory.push({ ...bounds });
    this.emit('move');
  }
  setPosition(x, y) {
    this.bounds = { ...this.bounds, x, y };
    this.moves.push({ x, y });
    this.emit('move');
  }
  setIgnoreMouseEvents(isIgnoring) {
    this.ignoring.push(isIgnoring);
  }
  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }
  emit(eventName) {
    this.handlers.get(eventName)?.();
  }
  // The OS moving the window mid-drag, with the mouse button still down.
  dragBy(position) {
    this.bounds = { ...this.bounds, ...position };
    this.emit('move');
  }
  // What the OS does while the user drags the window.
  drag(position, t) {
    this.dragBy(position);
    if (this.handlers.has('moved')) {
      this.emit('moved');
    } else {
      advance(t, 300);
    }
  }
}

const setup = (t, initialState, isIdle = false) => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        screen: {
          getCursorScreenPoint: () => cursor,
          getDisplayNearestPoint: () => DISPLAY,
          getDisplayMatching: () => DISPLAY,
          getAllDisplays: () => [DISPLAY],
        },
      };
    }
    if (request.endsWith('common.const')) {
      return { IS_MAC: isMac, isWaylandEnv: () => isWayland };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });

  delete require.cache[placementPath];
  // The module decides at load time which platform's drag handling it uses.
  Object.defineProperty(process, 'platform', { ...realPlatform, value: platform });
  let loaded;
  try {
    loaded = require(placementPath);
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
  const { createTaskWidgetPlacement, getTaskWidgetWindowBounds } = loaded;
  const win = new FakeWindow();
  win.bounds = getTaskWidgetWindowBounds(initialState, isWayland, isIdle);
  const saved = [];
  const hint = { updates: [], destroyed: 0, created: 0 };
  const placement = createTaskWidgetPlacement(
    win,
    initialState,
    isIdle,
    (state) => saved.push(state),
    () => {
      hint.created += 1;
      return {
        update: (preview, bounds) => hint.updates.push({ preview, bounds }),
        destroy: () => {
          hint.destroyed += 1;
        },
      };
    },
  );
  t.after(() => placement.destroy());
  return { win, placement, saved, hint };
};

// Node's mock clock jumps in one go, so step it the way real time passes.
const advance = (t, ms) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    t.mock.timers.tick(10);
  }
};

const FLOATING = { x: 500, y: 100, edge: null, centerY: 148, width: 324 };
const DOCKED_RIGHT = { x: 1596, y: 200, edge: 'right', centerY: 248, width: 324 };
const DOCKED_TOP = { x: 700, y: 0, edge: 'top', centerY: 48, width: 324 };
const hoverAt = (x, y) => {
  cursor = { x, y };
};
const OUTSIDE = [5000, 5000];

test.beforeEach(() => {
  cursor = { x: 5000, y: 5000 };
  isWayland = false;
  isMac = false;
  platform = 'win32';
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
});

test('hovering alone never opens the details', (t) => {
  const { placement } = setup(t, FLOATING);

  hoverAt(520, 110);
  advance(t, 6000);

  assert.equal(placement.getLayout().isOpen, false);
});

test('clicking the time opens the details', (t) => {
  const { win, placement } = setup(t, FLOATING);

  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();

  assert.equal(placement.getLayout().isOpen, true);
  assert.equal(win.layouts.at(-1).isOpen, true);
  assert.equal(placement.getShape().height, 100);
});

test('clicking the time again closes them', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);

  placement.toggleDetails();
  placement.toggleDetails();

  assert.equal(placement.getLayout().isOpen, false);
  assert.equal(placement.getShape().height, 56);
});

test('they stay open while the cursor is on the widget', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();

  advance(t, 10000);

  assert.equal(placement.getLayout().isOpen, true);
});

test('leaving closes them after a second, not before', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();

  hoverAt(...OUTSIDE);
  advance(t, 800);
  assert.equal(placement.getLayout().isOpen, true);

  advance(t, 400);
  assert.equal(placement.getLayout().isOpen, false);
  assert.equal(placement.getShape().height, 56);
});

test('coming back in time keeps them open', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();

  hoverAt(...OUTSIDE);
  advance(t, 500);
  hoverAt(520, 110);
  advance(t, 2000);

  assert.equal(placement.getLayout().isOpen, true);
});

test('opening by keyboard with the cursor elsewhere still gives time to act', (t) => {
  const { placement } = setup(t, FLOATING);
  advance(t, 2000);

  placement.toggleDetails();
  advance(t, 500);

  assert.equal(placement.getLayout().isOpen, true);
});

test('opening never touches the window, because only that can stay smooth', (t) => {
  const { win, placement } = setup(t, FLOATING);

  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();
  hoverAt(...OUTSIDE);
  advance(t, 1500);

  assert.equal(win.boundsHistory.length, 0);
});

test('a docked bar does not move when its panel opens', (t) => {
  const { placement } = setup(t, DOCKED_RIGHT);
  const closed = placement.getShape();
  assert.equal(closed.width, 52);

  hoverAt(1900, 240);
  advance(t, 100);
  placement.toggleDetails();

  const open = placement.getShape();
  assert.equal(open.width, 312);
  assert.equal(open.x + open.width, closed.x + closed.width);
  assert.equal(open.x + open.width, 1920);
});

test('there are no details to open when nothing is running', (t) => {
  const { placement } = setup(t, DOCKED_RIGHT, true);

  placement.toggleDetails();

  assert.equal(placement.getLayout().isOpen, false);
});

test('details close by themselves when the task ends', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();

  placement.setIdle(true);

  assert.equal(placement.getLayout().isOpen, false);
});

test('the empty part of the window lets clicks through to what is underneath', (t) => {
  const { win } = setup(t, FLOATING);

  hoverAt(520, 130);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1) ?? false, false, 'the capsule itself takes clicks');

  hoverAt(520, 180);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), true, 'below the capsule is still inside the window');
});

test('a docked bar lets clicks through beside it', (t) => {
  const { win } = setup(t, DOCKED_RIGHT);

  hoverAt(1700, 240);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), true);

  hoverAt(1900, 240);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), false);
});

test('the opened part takes clicks once it is open', (t) => {
  const { win, placement } = setup(t, FLOATING);
  hoverAt(520, 130);
  advance(t, 100);
  placement.toggleDetails();

  hoverAt(520, 180);
  advance(t, 100);

  assert.equal(win.ignoring.at(-1) ?? false, false);
});

test('dropping the capsule at an edge docks it and saves that', (t) => {
  const { win, placement, saved } = setup(t, FLOATING);

  win.drag({ x: 1590 }, t);

  assert.equal(win.layouts.at(-1).dock, 'right');
  const shape = placement.getShape();
  assert.equal(shape.width, 52);
  assert.equal(shape.x + shape.width, 1920);
  assert.equal(win.bounds.x + win.bounds.width, 1920, 'the window is pinned too');
  assert.equal(saved.at(-1).edge, 'right');
});

test('docking tells the shape how far the window jumped, so it can glide', (t) => {
  const { win } = setup(t, FLOATING);

  win.drag({ x: 1590 }, t);

  assert.deepEqual(win.layouts.at(-1).shift, { x: -6, y: 0 });
});

test('docking moves the window and states its exact size', (t) => {
  const { win } = setup(t, FLOATING);

  win.drag({ x: 1590 }, t);

  assert.deepEqual(win.boundsHistory.at(-1), {
    x: 1596,
    y: 100,
    width: 324,
    height: 116,
  });
  assert.equal(win.moves.length, 0, 'setPosition grows the window at 125% scaling');
});

test('the bar lands level with where the capsule was dropped', (t) => {
  const { win } = setup(t, FLOATING);

  win.drag({ x: 1590, y: 300 }, t);

  assert.equal(win.bounds.y, 300);
});

test('dropping the capsule in the middle only saves the new position', (t) => {
  const { win, saved } = setup(t, FLOATING);

  win.drag({ x: 700, y: 300 }, t);

  assert.equal(win.layouts.at(-1).dock, null);
  assert.deepEqual(
    { x: saved.at(-1).x, y: saved.at(-1).y, edge: saved.at(-1).edge },
    { x: 700, y: 300, edge: null },
  );
});

test('dragging a bar along its edge keeps it docked at the new height', (t) => {
  const { win, saved } = setup(t, DOCKED_RIGHT);

  win.drag({ x: win.bounds.x - 10, y: 500 }, t);

  assert.equal(saved.at(-1).edge, 'right');
  assert.equal(win.bounds.x + win.bounds.width, 1920, 'it snaps back onto the edge');
  assert.equal(win.bounds.y, 500);
});

test('dragging a bar away from its edge returns to the floating capsule', (t) => {
  const { win, placement, saved } = setup(t, DOCKED_RIGHT);

  win.drag({ x: 1200, y: 400 }, t);

  assert.equal(saved.at(-1).edge, null);
  assert.equal(win.layouts.at(-1).dock, null);
  assert.deepEqual(placement.getShape(), { x: 1200, y: 400, width: 324, height: 56 });
});

test('undocking leaves the window where it is, so the shape can grow in place', (t) => {
  const { win } = setup(t, DOCKED_RIGHT);

  win.drag({ x: 1200, y: 400 }, t);

  assert.deepEqual(win.layouts.at(-1).shift, { x: 0, y: 0 });
});

test('opening a panel is not mistaken for a drag', (t) => {
  const { win, placement, saved } = setup(t, DOCKED_RIGHT);

  hoverAt(1900, 240);
  advance(t, 100);
  placement.toggleDetails();

  assert.equal(saved.length, 0, 'nothing should be saved or undocked');
  assert.equal(win.layouts.at(-1).dock, 'right');
});

test('a click in the middle of a drag changes nothing', (t) => {
  const { win, placement } = setup(t, FLOATING);

  win.dragBy({ x: 640 });
  placement.toggleDetails();

  assert.equal(placement.getLayout().isOpen, false);
});

test('a hidden widget does not act on the cursor', (t) => {
  const { win, placement } = setup(t, FLOATING);
  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();
  win.visible = false;

  hoverAt(...OUTSIDE);
  advance(t, 2000);

  assert.equal(placement.getLayout().isOpen, true);
});

test('on Wayland the capsule stays open so Done and Open stay reachable', (t) => {
  isWayland = true;
  const { placement } = setup(t, FLOATING);

  assert.equal(placement.getShape().height, 100);
  assert.equal(placement.getLayout().isOpen, true);

  placement.toggleDetails();
  assert.equal(placement.getLayout().isOpen, true, 'nothing could reopen it');
});

test('macOS keeps its solid window, which still has to resize and never ignores clicks', (t) => {
  isMac = true;
  const { win, placement } = setup(t, FLOATING);
  assert.equal(win.bounds.height, 56);

  hoverAt(520, 110);
  advance(t, 100);
  placement.toggleDetails();
  assert.equal(win.bounds.height, 100);
  assert.equal(placement.getLayout().isSolid, true);

  hoverAt(...OUTSIDE);
  advance(t, 1400);
  assert.equal(win.bounds.height, 56);
  assert.deepEqual(win.ignoring, []);
});

test('getting close to an edge shows the hint, and it follows the widget', (t) => {
  const { win, hint } = setup(t, FLOATING);

  win.dragBy({ x: 1530, y: 300 });

  assert.equal(win.previews.at(-1).edge, 'right');
  assert.equal(win.previews.at(-1).progress < 1, true);
  assert.equal(hint.created, 1);
  assert.equal(hint.updates.at(-1).bounds.x, 1920 - 52, 'it sits on the edge');

  win.dragBy({ x: 1530, y: 500 });

  assert.equal(hint.created, 1, 'one hint for the whole drag');
  assert.equal(hint.updates.at(-1).bounds.y > 400, true, 'it moves with the widget');
});

test('the hint lands exactly where the bar will appear', (t) => {
  const { win, placement, hint } = setup(t, FLOATING);

  win.drag({ x: 1590, y: 300 }, t);
  const bar = placement.getShape();

  const { bounds } = hint.updates.at(-1);
  assert.equal(bounds.x, bar.x);
  assert.equal(bounds.y + 24, bar.y);
  assert.equal(bounds.height - 48, bar.height);
});

test('moving back away from the edge removes the hint', (t) => {
  const { win, hint } = setup(t, FLOATING);

  win.dragBy({ x: 1530 });
  win.dragBy({ x: 800 });

  assert.equal(win.previews.at(-1), null);
  assert.equal(hint.destroyed, 1);
});

test('the hint is gone once the drag ends, docked or not', (t) => {
  const { win, hint } = setup(t, FLOATING);

  win.drag({ x: 1530 }, t);
  assert.equal(win.previews.at(-1), null);

  advance(t, 400);
  assert.equal(hint.destroyed, 1);
});

test('the hint stays until the bar has landed on it', (t) => {
  const { win, hint } = setup(t, FLOATING);

  win.drag({ x: 1590 }, t);

  assert.equal(hint.destroyed, 0, 'destroying it mid-morph would cost a frame');
  advance(t, 400);
  assert.equal(hint.destroyed, 1);
});

test('a drag in the middle of the screen never creates a hint window', (t) => {
  const { win, hint } = setup(t, FLOATING);

  win.drag({ x: 800, y: 400 }, t);

  assert.equal(hint.created, 0);
});

test('dragging a bar that is already docked shows no hint', (t) => {
  const { win, hint } = setup(t, DOCKED_RIGHT);

  win.dragBy({ y: 500 });

  assert.equal(hint.created, 0);
});

test('dropping the capsule at the top docks it as a pill', (t) => {
  const { win, placement, saved } = setup(t, FLOATING);

  win.drag({ x: 700, y: 10 }, t);

  assert.equal(saved.at(-1).edge, 'top');
  assert.deepEqual(placement.getShape(), { x: 700, y: 0, width: 160, height: 56 });
  assert.equal(win.bounds.y, 0);
});

test('the top pill opens without moving, and closes again', (t) => {
  const { placement } = setup(t, DOCKED_TOP);

  hoverAt(720, 20);
  advance(t, 100);
  placement.toggleDetails();
  assert.deepEqual(placement.getShape(), { x: 700, y: 0, width: 324, height: 100 });

  hoverAt(...OUTSIDE);
  advance(t, 1200);
  assert.deepEqual(placement.getShape(), { x: 700, y: 0, width: 160, height: 56 });
});

test('the pill and its hint use the measured time width', (t) => {
  const { win, placement, hint } = setup(t, FLOATING);
  placement.setTimeWidth(73);

  win.dragBy({ x: 700, y: 40 });
  assert.equal(hint.updates.at(-1).bounds.width, 137 + 48, 'the hint has padding');

  win.drag({ x: 700, y: 10 }, t);
  assert.equal(placement.getShape().width, 137);
});

test('sliding the pill along the top keeps it docked at the new place', (t) => {
  const { win, placement, saved } = setup(t, DOCKED_TOP);

  win.drag({ x: 300, y: 12 }, t);

  assert.equal(saved.at(-1).edge, 'top');
  assert.equal(placement.getShape().x, 300);
  assert.equal(win.bounds.y, 0);
});

test('dragging the pill down returns to the floating capsule', (t) => {
  const { win, placement, saved } = setup(t, DOCKED_TOP);

  win.drag({ x: 700, y: 300 }, t);

  assert.equal(saved.at(-1).edge, null);
  assert.deepEqual(placement.getShape(), { x: 700, y: 300, width: 324, height: 56 });
});

const resizeBy = (placement, side, delta) => {
  hoverAt(800, 120);
  placement.startResize(side);
  hoverAt(800 + delta, 120);
  placement.resize();
};

test('dragging the right end widens the capsule and leaves the disc where it is', (t) => {
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'right', 80);

  assert.deepEqual(placement.getShape(), { x: 500, y: 100, width: 404, height: 56 });
  assert.equal(win.layouts.at(-1).width, 404);
});

test('dragging the left end widens the capsule and leaves the time where it is', (t) => {
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'left', -80);

  assert.deepEqual(placement.getShape(), { x: 420, y: 100, width: 404, height: 56 });
  assert.equal(win.bounds.x, 420, 'the window follows the left end');
});

test('the width stops at the limits', (t) => {
  const { placement } = setup(t, FLOATING);

  resizeBy(placement, 'right', 900);
  assert.equal(placement.getShape().width, 520);

  hoverAt(0, 120);
  placement.resize();
  assert.equal(placement.getShape().width, 248);
});

test('the window has room for the widest shape only during a resize', (t) => {
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'right', 80);
  assert.equal(win.bounds.width, 520);
  assert.equal(win.layouts.at(-1).isResizing, true);

  placement.endResize();

  assert.deepEqual(win.bounds, { x: 500, y: 100, width: 404, height: 116 });
  assert.equal(win.layouts.at(-1).isResizing, false);
});

test('moving the right end never moves the window, so it stays smooth', (t) => {
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'right', 80);
  hoverAt(900, 120);
  placement.resize();
  hoverAt(920, 120);
  placement.resize();

  assert.equal(win.boundsHistory.length, 1, 'only the first widening of the window');
});

test('letting go saves the width, and only then', (t) => {
  const { placement, saved } = setup(t, FLOATING);

  resizeBy(placement, 'right', 80);
  assert.equal(saved.length, 0);

  placement.endResize();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].width, 404);
  assert.equal(saved[0].x, 500);
});

test('pressing an end without moving changes nothing', (t) => {
  const { win, placement, saved } = setup(t, FLOATING);

  hoverAt(800, 120);
  placement.startResize('right');
  placement.endResize();

  assert.equal(placement.getShape().width, 324);
  assert.equal(win.bounds.width, 324);
  assert.equal(saved.at(-1).width, 324);
});

test('a resize is not mistaken for a drag', (t) => {
  const { win, placement, hint } = setup(t, FLOATING);

  resizeBy(placement, 'left', -80);
  placement.endResize();
  advance(t, 500);

  assert.equal(win.layouts.at(-1).dock, null);
  assert.equal(hint.created, 0);
});

test('the widget keeps taking the mouse when the cursor leaves it during a resize', (t) => {
  const { win, placement } = setup(t, FLOATING);
  hoverAt(800, 120);
  advance(t, 100);

  placement.startResize('right');
  hoverAt(1500, 600);
  advance(t, 500);

  assert.equal(win.ignoring.at(-1) ?? false, false);
});

test('clicks pass through again once a resize ends away from the widget', (t) => {
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'right', -80);
  hoverAt(1500, 600);
  placement.endResize();
  advance(t, 100);

  assert.equal(win.ignoring.at(-1), true);
});

test('open details survive a resize that wanders off the widget', (t) => {
  const { placement } = setup(t, FLOATING);
  hoverAt(800, 120);
  advance(t, 100);
  placement.toggleDetails();

  placement.startResize('right');
  hoverAt(1500, 600);
  advance(t, 3000);

  assert.equal(placement.getLayout().isOpen, true);
});

test('docked shapes cannot be resized', (t) => {
  const { win, placement } = setup(t, DOCKED_RIGHT);

  resizeBy(placement, 'left', -80);
  placement.endResize();

  assert.equal(win.boundsHistory.length, 0);
  assert.equal(placement.getLayout().width, 324);
});

test('a resize cannot start in the middle of a drag', (t) => {
  const { win, placement } = setup(t, FLOATING);

  win.dragBy({ x: 640 });
  placement.startResize('right');

  assert.equal(placement.getLayout().isResizing, false);
});

test('Wayland hides the cursor, so it gets no handles', (t) => {
  isWayland = true;
  const { placement } = setup(t, FLOATING);

  assert.equal(placement.getLayout().canResize, false);
  placement.startResize('right');
  assert.equal(placement.getLayout().isResizing, false);
});

test('macOS resizes its solid window with the width', (t) => {
  isMac = true;
  const { win, placement } = setup(t, FLOATING);

  resizeBy(placement, 'left', -80);

  assert.equal(win.bounds.x, 420);
  assert.equal(win.bounds.width, 404);

  placement.endResize();
  assert.equal(win.bounds.width, 404);
});

test('the chosen width survives docking and undocking', (t) => {
  const { win, placement, saved } = setup(t, FLOATING);
  resizeBy(placement, 'right', 80);
  placement.endResize();

  win.drag({ x: 1510 }, t);
  assert.equal(saved.at(-1).edge, 'right');
  assert.equal(saved.at(-1).width, 404);
  assert.equal(
    win.bounds.x + win.bounds.width,
    1920,
    'the window is pinned at this width',
  );
  assert.equal(placement.getShape().x + placement.getShape().width, 1920);

  win.drag({ x: 1000, y: 400 }, t);
  assert.deepEqual(placement.getShape(), { x: 1000, y: 400, width: 404, height: 56 });
});

test('the panel opens as wide as the chosen width allows', (t) => {
  const { placement } = setup(t, { ...DOCKED_RIGHT, x: 1516, width: 404 });
  hoverAt(1900, 240);
  advance(t, 100);

  placement.toggleDetails();

  assert.equal(placement.getShape().width, 392);
  assert.equal(placement.getShape().x + placement.getShape().width, 1920);
});

test('a wider capsule docks when its real right end reaches the edge', (t) => {
  const { win, placement, saved } = setup(t, { ...FLOATING, width: 500 });

  win.drag({ x: 1410 }, t);

  assert.equal(saved.at(-1).edge, 'right');
  assert.equal(placement.getShape().x, 1920 - 52);
});

test('a bar gets shorter when its task ends, without moving', (t) => {
  const { win, placement } = setup(t, DOCKED_RIGHT);
  const running = placement.getShape();

  placement.setIdle(true);

  assert.equal(running.height, 116);
  assert.deepEqual(placement.getShape(), { ...running, height: 96 });
  assert.equal(win.boundsHistory.length, 0, 'the window stays, the shape morphs');
});

test('the hint matches the shorter bar when nothing is running', (t) => {
  const { win, hint } = setup(t, FLOATING, true);

  win.drag({ x: 1590, y: 300 }, t);

  assert.equal(hint.updates.at(-1).bounds.height - 48, 96);
});

// Outside Windows a drag has no end event, and a held button looks like a still one.
const holdAt = (win, position) => {
  cursor = {
    x: (position.x ?? win.bounds.x) + 150,
    y: (position.y ?? win.bounds.y) + 18,
  };
  win.dragBy(position);
};

test('outside Windows, a pause near an edge mid-drag does not dock', (t) => {
  platform = 'linux';
  const { win, saved } = setup(t, FLOATING);

  holdAt(win, { x: 1590 });
  advance(t, 900);

  assert.equal(saved.length, 0, 'the button may still be held');
  assert.notEqual(win.layouts.at(-1)?.dock, 'right');
});

test('outside Windows, the drag ends once the cursor leaves its spot', (t) => {
  platform = 'linux';
  const { win, saved } = setup(t, FLOATING);

  holdAt(win, { x: 1590 });
  advance(t, 600);
  cursor = { x: 1400, y: 500 };
  advance(t, 400);

  assert.equal(saved.at(-1).edge, 'right');
  assert.equal(win.bounds.x + win.bounds.width, 1920);
});

test('outside Windows, a long pause ends the drag anyway', (t) => {
  platform = 'linux';
  const { saved, win } = setup(t, FLOATING);

  holdAt(win, { x: 1590 });
  advance(t, 2400);

  assert.equal(saved.at(-1).edge, 'right');
});

test('on Linux the cursor check alone lets clicks back in, with no forwarded events', (t) => {
  platform = 'linux';
  const { win } = setup(t, FLOATING);

  hoverAt(520, 180);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), true);

  hoverAt(520, 120);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), false);
});

test('on Wayland the window is only as tall as the widget, so nothing below it is blocked', (t) => {
  isWayland = true;
  const { win, placement } = setup(t, FLOATING);
  assert.equal(win.bounds.height, placement.getShape().height);
  assert.equal(win.bounds.height, 100);

  placement.setIdle(true);
  assert.equal(win.bounds.height, 56);
});

test('the cursor check sleeps while the widget is hidden', (t) => {
  const { win } = setup(t, FLOATING);
  advance(t, 200);

  win.visible = false;
  win.emit('hide');
  const checks = win.visibleChecks;
  advance(t, 2000);
  assert.equal(win.visibleChecks, checks, 'nothing wakes while hidden');

  win.visible = true;
  win.emit('show');
  hoverAt(520, 180);
  advance(t, 100);
  assert.equal(win.ignoring.at(-1), true, 'it works again once shown');
});
