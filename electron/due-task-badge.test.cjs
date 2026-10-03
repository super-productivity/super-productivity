const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');

const originalLoad = Module._load;
const overlays = [];
const counts = [];
Module._load = function (request, parent, isMain) {
  if (request === 'electron')
    return {
      app: { setBadgeCount: (count) => counts.push(count) },
      nativeImage: { createFromBitmap: (pixels, options) => ({ pixels, options }) },
    };
  if (request === './main-window')
    return {
      getWin: () => ({ setOverlayIcon: (...args) => overlays.push(args) }),
    };
  return originalLoad.call(this, request, parent, isMain);
};
const { createBadgeBitmap, setDueTaskBadge } = require('./due-task-badge.ts');
Module._load = originalLoad;

test('badge bitmaps fit 32px and cap visible counts at 99+', () => {
  for (const count of [1, 5, 10, 99, 100, 1000]) {
    const bitmap = createBadgeBitmap(count);
    assert.equal(bitmap.length, 32 * 32 * 4);
    assert.equal(bitmap[3], 0, 'outside the circle is transparent');
    assert.ok(
      bitmap.some((pixel) => pixel === 255),
      'glyphs are visible',
    );
  }
  assert.deepEqual(createBadgeBitmap(100), createBadgeBitmap(1000));
  assert.notDeepEqual(createBadgeBitmap(5), createBadgeBitmap(6));
});

test('publishes the count and removes the native badge at zero', () => {
  setDueTaskBadge(5);
  setDueTaskBadge(0);
  if (process.platform === 'win32') {
    assert.equal(overlays[0][1], '5 tasks due today or overdue');
    assert.deepEqual(overlays[0][0].options, { width: 32, height: 32 });
    assert.deepEqual(overlays[1], [null, '']);
  } else {
    assert.deepEqual(counts, [5, 0]);
  }
});
