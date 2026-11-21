const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const {
  BAR_HEIGHT,
  BAR_IDLE_HEIGHT,
  BAR_WIDTH,
  DEFAULT_WIDTH,
  FLOAT_HEIGHT,
  FLOAT_OPEN_HEIGHT,
  MAX_WIDTH,
  MIN_WIDTH,
  TOP_BAR_IDLE_WIDTH,
  TOP_BAR_WIDTH,
  WINDOW_HEIGHT,
  clampWidth,
  getDistanceFromEdge,
  getDockHintBounds,
  getDockPreview,
  getDockedBounds,
  getFloatingBounds,
  getResizedSpan,
  getSnapEdge,
  getUndockedPosition,
  getWindowBounds,
  isPointInRect,
} = require('./task-widget/task-widget-layout.ts');

const display = (id, x, y = 0, width = 1920, height = 1080) => ({
  id,
  bounds: { x, y, width, height },
  workArea: { x, y, width, height: height - 40 },
});

const floatingAt = (x, y = 100, width = DEFAULT_WIDTH) =>
  getFloatingBounds({ x, y, width }, false);
const AT_300 = { x: 600, centerY: 300, width: DEFAULT_WIDTH };

test('the floating capsule keeps its position and only grows downward when open', () => {
  const position = { x: 50, y: 60, width: 400 };

  assert.deepEqual(getFloatingBounds(position, false), {
    ...position,
    height: FLOAT_HEIGHT,
  });
  assert.deepEqual(getFloatingBounds(position, true), {
    ...position,
    height: FLOAT_OPEN_HEIGHT,
  });
});

test('opening a bar on the right edge keeps the bar itself in the same place', () => {
  const { workArea } = display(1, 0);
  const closed = getDockedBounds('right', workArea, AT_300, false, false);
  const open = getDockedBounds('right', workArea, AT_300, true, false);

  assert.equal(closed.width, BAR_WIDTH);
  assert.equal(open.width, 312);
  assert.equal(closed.x + closed.width, open.x + open.width, 'right edge stays pinned');
  assert.equal(closed.x + closed.width, 1920);
  assert.equal(closed.y, open.y);
});

test('opening a bar on the left edge keeps the bar itself in the same place', () => {
  const { workArea } = display(1, 0);
  const closed = getDockedBounds('left', workArea, AT_300, false, false);
  const open = getDockedBounds('left', workArea, AT_300, true, false);

  assert.equal(closed.x, 0);
  assert.equal(open.x, 0);
  assert.equal(open.width, 312);
});

test('with nothing running a bar drops the time and keeps the disc in place', () => {
  const { workArea } = display(1, 0);
  const running = getDockedBounds('right', workArea, AT_300, false, false);
  const idle = getDockedBounds('right', workArea, AT_300, false, true);

  assert.deepEqual(idle, { ...running, height: BAR_IDLE_HEIGHT });
  assert.equal(running.height, BAR_HEIGHT);
});

test('a bar cannot be pushed outside the work area', () => {
  const { workArea } = display(1, 0);

  assert.equal(
    getDockedBounds('left', workArea, { ...AT_300, centerY: -50 }, false, false).y,
    0,
  );
  assert.equal(
    getDockedBounds('left', workArea, { ...AT_300, centerY: 5000 }, false, false).y,
    workArea.height - WINDOW_HEIGHT,
  );
});

test('dragging the capsule close to an outer edge snaps to that edge', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(8), main, [main]), 'left');
  assert.equal(getSnapEdge(floatingAt(1920 - DEFAULT_WIDTH - 8), main, [main]), 'right');
});

test('dragging past the edge still snaps', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(-40), main, [main]), 'left');
  assert.equal(getSnapEdge(floatingAt(1900), main, [main]), 'right');
});

test('the capsule does not snap in the middle of the screen', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(500), main, [main]), null);
});

test('an edge shared with another monitor never snaps', () => {
  const left = display(1, 0);
  const right = display(2, 1920);
  const displays = [left, right];

  assert.equal(getSnapEdge(floatingAt(1920 - DEFAULT_WIDTH - 4), left, displays), null);
  assert.equal(getSnapEdge(floatingAt(1924), right, displays), null);
  assert.equal(getSnapEdge(floatingAt(4), left, displays), 'left');
  assert.equal(
    getSnapEdge(floatingAt(1920 * 2 - DEFAULT_WIDTH - 4), right, displays),
    'right',
  );
});

test('a monitor stacked above does not block the side edges', () => {
  const main = display(1, 0);
  const above = display(2, 0, -1080);

  assert.equal(getSnapEdge(floatingAt(4), main, [main, above]), 'left');
});

test('distance from an edge is measured from the pinned side of the window', () => {
  const { workArea } = display(1, 0);

  assert.equal(
    getDistanceFromEdge({ x: 20, y: 0, width: 48, height: 88 }, 'left', workArea),
    20,
  );
  assert.equal(
    getDistanceFromEdge({ x: 1860, y: 0, width: 48, height: 88 }, 'right', workArea),
    12,
  );
});

test('dragging off the right edge lands the capsule by the side the bar was on', () => {
  const { workArea } = display(1, 0);
  const position = getUndockedPosition(
    { x: 1400, y: 200, width: 48, height: 88 },
    'right',
    workArea,
    DEFAULT_WIDTH,
  );

  assert.deepEqual(position, { x: 1448 - DEFAULT_WIDTH, y: 200 });
});

test('the undocked capsule stays inside the work area', () => {
  const { workArea } = display(1, 0);

  assert.deepEqual(
    getUndockedPosition(
      { x: -500, y: 5000, width: 48, height: 88 },
      'left',
      workArea,
      DEFAULT_WIDTH,
    ),
    { x: 0, y: workArea.height - FLOAT_OPEN_HEIGHT },
  );
});

test('a point on the far edge of a window counts as outside it', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };

  assert.equal(isPointInRect({ x: 10, y: 10 }, rect), true);
  assert.equal(isPointInRect({ x: 29, y: 29 }, rect), true);
  assert.equal(isPointInRect({ x: 30, y: 15 }, rect), false);
  assert.equal(isPointInRect({ x: 15, y: 30 }, rect), false);
});

test('the top pill touches the screen top and opens without moving its left side', () => {
  const { workArea } = display(1, 0);
  const closed = getDockedBounds('top', workArea, AT_300, false, false);
  const open = getDockedBounds('top', workArea, AT_300, true, false);

  assert.deepEqual(closed, { x: 600, y: 0, width: TOP_BAR_WIDTH, height: FLOAT_HEIGHT });
  assert.deepEqual(open, {
    x: 600,
    y: 0,
    width: DEFAULT_WIDTH,
    height: FLOAT_OPEN_HEIGHT,
  });
});

test('the top pill keeps room to open near the right edge', () => {
  const { workArea } = display(1, 0);
  const closed = getDockedBounds(
    'top',
    workArea,
    { ...AT_300, x: 1900, centerY: 0 },
    false,
    false,
  );

  assert.equal(closed.x, 1920 - DEFAULT_WIDTH);
});

test('the top pill fits the measured width of its time', () => {
  const { workArea } = display(1, 0);
  const pill = getDockedBounds(
    'top',
    workArea,
    { ...AT_300, timeWidth: 61 },
    false,
    false,
  );

  assert.equal(pill.width, 125);
});

test('with nothing running the top pill holds the disc and Open', () => {
  const { workArea } = display(1, 0);
  const closed = getDockedBounds('top', workArea, AT_300, false, true);

  assert.equal(closed.width, TOP_BAR_IDLE_WIDTH);
});

test('every shape fits inside the window at every width', () => {
  const { workArea } = display(1, 0);

  for (const width of [MIN_WIDTH, DEFAULT_WIDTH, MAX_WIDTH]) {
    const anchor = { ...AT_300, width, timeWidth: 100 };
    const shapes = [
      getFloatingBounds({ x: 100, y: 100, width }, true),
      getDockedBounds('right', workArea, anchor, true, false),
      getDockedBounds('left', workArea, anchor, true, false),
      getDockedBounds('top', workArea, anchor, true, false),
      getDockedBounds('top', workArea, anchor, false, false),
    ];

    for (const shape of shapes) {
      assert.equal(shape.width <= width, true);
      assert.equal(shape.height <= WINDOW_HEIGHT, true);
    }
  }
});

test('the window hugs the side a shape is anchored to', () => {
  const { workArea } = display(1, 0);
  const right = getDockedBounds('right', workArea, AT_300, false, false);
  const left = getDockedBounds('left', workArea, AT_300, false, false);

  assert.deepEqual(getWindowBounds(right, 'right', 400), {
    x: 1920 - 400,
    y: right.y,
    width: 400,
    height: WINDOW_HEIGHT,
  });
  assert.equal(getWindowBounds(left, 'left', 400).x, 0);
});

test('the window does not move when a bar opens or goes idle', () => {
  const { workArea } = display(1, 0);
  const windows = [
    getDockedBounds('right', workArea, AT_300, false, false),
    getDockedBounds('right', workArea, AT_300, true, false),
    getDockedBounds('right', workArea, AT_300, false, true),
  ].map((shape) => getWindowBounds(shape, 'right', DEFAULT_WIDTH));

  assert.equal(new Set(windows.map((w) => `${w.x},${w.y}`)).size, 1);
});

test('dragging the capsule to the top snaps there', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(600, 8), main, [main]), 'top');
});

test('a monitor above blocks the top edge but not the sides', () => {
  const main = display(1, 0);
  const above = display(2, 0, -1080);

  assert.equal(getSnapEdge(floatingAt(600, 8), main, [main, above]), null);
});

test('in a corner the closer edge wins', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(10, 2), main, [main]), 'top');
  assert.equal(getSnapEdge(floatingAt(2, 10), main, [main]), 'left');
});

test('the preview grows from nothing to complete as the widget approaches', () => {
  const main = display(1, 0);
  const at = (gap) => getDockPreview(floatingAt(gap), main, [main]);

  assert.equal(at(200), null, 'far away there is nothing to show');
  assert.equal(at(96).progress, 0);
  assert.equal(at(60).progress, 0.5);
  assert.equal(at(24).progress, 1);
  assert.equal(at(-30).progress, 1);
});

test('the preview is complete exactly where dropping would dock', () => {
  const main = display(1, 0);

  for (let gap = -20; gap <= 120; gap += 1) {
    const preview = getDockPreview(floatingAt(gap), main, [main]);
    assert.equal(
      preview?.progress === 1,
      getSnapEdge(floatingAt(gap), main, [main]) !== null,
      `gap ${gap}`,
    );
  }
});

test('a shared edge between monitors shows no preview', () => {
  const left = display(1, 0);
  const right = display(2, 1920);

  assert.equal(
    getDockPreview(floatingAt(1920 - DEFAULT_WIDTH - 40), left, [left, right]),
    null,
  );
});

test('the hint adds room along the edge without leaving the edge', () => {
  const bar = { x: 1872, y: 200, width: 48, height: 88 };
  const top = { x: 600, y: 0, width: 156, height: 52 };

  assert.deepEqual(getDockHintBounds(bar, 'right'), {
    x: 1872,
    y: 176,
    width: 48,
    height: 136,
  });
  assert.deepEqual(getDockHintBounds(top, 'top'), {
    x: 576,
    y: 0,
    width: 204,
    height: 52,
  });
});

test('distance and undocking work from the top edge', () => {
  const { workArea } = display(1, 0);
  const pill = { x: 600, y: 80, width: TOP_BAR_WIDTH, height: FLOAT_HEIGHT };

  assert.equal(getDistanceFromEdge(pill, 'top', workArea), 80);
  assert.deepEqual(getUndockedPosition(pill, 'top', workArea, DEFAULT_WIDTH), {
    x: 600,
    y: 80,
  });
});

test('a saved width is kept inside the limits', () => {
  assert.equal(clampWidth(60), MIN_WIDTH);
  assert.equal(clampWidth(700), MAX_WIDTH);
  assert.equal(clampWidth(300.4), 300);
});

test('dragging the right end moves only the right end', () => {
  const { workArea } = display(1, 0);

  assert.deepEqual(getResizedSpan({ x: 500, width: 324 }, 'right', 40, workArea), {
    x: 500,
    width: 364,
  });
  assert.deepEqual(getResizedSpan({ x: 500, width: 324 }, 'right', -40, workArea), {
    x: 500,
    width: 284,
  });
});

test('dragging the left end moves only the left end', () => {
  const { workArea } = display(1, 0);

  assert.deepEqual(getResizedSpan({ x: 500, width: 324 }, 'left', -40, workArea), {
    x: 460,
    width: 364,
  });
  assert.deepEqual(getResizedSpan({ x: 500, width: 324 }, 'left', 40, workArea), {
    x: 540,
    width: 284,
  });
});

test('the width stops at its limits from either end', () => {
  const { workArea } = display(1, 0);
  const start = { x: 800, width: 324 };

  assert.equal(getResizedSpan(start, 'right', 5000, workArea).width, MAX_WIDTH);
  assert.equal(getResizedSpan(start, 'right', -5000, workArea).width, MIN_WIDTH);
  assert.deepEqual(getResizedSpan(start, 'left', -5000, workArea), {
    x: 1124 - MAX_WIDTH,
    width: MAX_WIDTH,
  });
  assert.deepEqual(getResizedSpan(start, 'left', 5000, workArea), {
    x: 1124 - MIN_WIDTH,
    width: MIN_WIDTH,
  });
});

test('neither end can pass the edge of the screen', () => {
  const { workArea } = display(1, 0);

  assert.equal(
    getResizedSpan({ x: 1570, width: 324 }, 'right', 300, workArea).width,
    1920 - 1570,
  );
  assert.deepEqual(getResizedSpan({ x: 30, width: 324 }, 'left', -300, workArea), {
    x: 0,
    width: 354,
  });
});

test('a capsule already past the screen edge does not jump when grabbed', () => {
  const { workArea } = display(1, 0);

  assert.equal(getResizedSpan({ x: 1700, width: 324 }, 'right', 0, workArea).width, 324);
});

test('the side panel and the open top pill follow the chosen width', () => {
  const { workArea } = display(1, 0);
  const anchor = { ...AT_300, width: 400 };

  assert.equal(getDockedBounds('right', workArea, anchor, true, false).width, 388);
  assert.equal(getDockedBounds('left', workArea, anchor, true, false).width, 388);
  assert.equal(getDockedBounds('top', workArea, anchor, true, false).width, 400);
  assert.equal(getDockedBounds('right', workArea, anchor, false, false).width, BAR_WIDTH);
});

test('the top pill keeps room for the chosen width near the right edge', () => {
  const { workArea } = display(1, 0);
  const pill = getDockedBounds(
    'top',
    workArea,
    { ...AT_300, x: 1900, width: 500 },
    false,
    false,
  );

  assert.equal(pill.x, 1920 - 500);
});

test('a wider capsule snaps by where its right end really is', () => {
  const main = display(1, 0);

  assert.equal(getSnapEdge(floatingAt(1400, 100, 500), main, [main]), 'right');
  assert.equal(getSnapEdge(floatingAt(1400, 100, 300), main, [main]), null);
});

test('a bar dragged off the right edge lands by the chosen width', () => {
  const { workArea } = display(1, 0);
  const position = getUndockedPosition(
    { x: 1000, y: 200, width: 400, height: 100 },
    'right',
    workArea,
    400,
  );

  assert.deepEqual(position, { x: 1000, y: 200 });
});
