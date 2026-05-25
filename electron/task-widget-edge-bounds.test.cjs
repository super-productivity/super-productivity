const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getClosestEdge,
  getClosestEdgeInfo,
  getCollapsedEdgeBounds,
  getDockedBounds,
  isPointInsideBounds,
} = require('./task-widget/task-widget-edge-bounds.js');

describe('task widget edge bounds', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const expanded = { x: 1560, y: 120, width: 360, height: 620 };

  it('collapses to a compact right edge pill', () => {
    assert.deepEqual(getCollapsedEdgeBounds(expanded, workArea, 'right', 26), {
      x: 1868,
      y: 417,
      width: 52,
      height: 26,
    });
  });

  it('collapses to a compact left edge pill', () => {
    assert.deepEqual(getCollapsedEdgeBounds(expanded, workArea, 'left', 26), {
      x: 0,
      y: 417,
      width: 52,
      height: 26,
    });
  });

  it('collapses to a compact top edge pill', () => {
    assert.deepEqual(getCollapsedEdgeBounds(expanded, workArea, 'top', 26), {
      x: 1714,
      y: 0,
      width: 52,
      height: 26,
    });
  });

  it('collapses to a compact bottom edge pill', () => {
    assert.deepEqual(getCollapsedEdgeBounds(expanded, workArea, 'bottom', 26), {
      x: 1714,
      y: 1014,
      width: 52,
      height: 26,
    });
  });

  it('only detects pointer entry on the collapsed pill', () => {
    const collapsed = getCollapsedEdgeBounds(expanded, workArea, 'right', 26);

    assert.equal(isPointInsideBounds({ x: 1900, y: 420 }, collapsed), true);
    assert.equal(isPointInsideBounds({ x: 1850, y: 420 }, collapsed), false);
    assert.equal(isPointInsideBounds({ x: 1900, y: 380 }, collapsed), false);
  });

  it('keeps the pill inside a short work area', () => {
    const shortWorkArea = { x: 0, y: 0, width: 1920, height: 300 };
    const tallExpanded = { x: 1560, y: 240, width: 360, height: 620 };

    assert.deepEqual(getCollapsedEdgeBounds(tallExpanded, shortWorkArea, 'right', 26), {
      x: 1868,
      y: 274,
      width: 52,
      height: 26,
    });
  });

  it('detects the closest screen edge from the current position', () => {
    assert.equal(
      getClosestEdge({ x: 20, y: 400, width: 360, height: 620 }, workArea),
      'left',
    );
    assert.equal(
      getClosestEdge({ x: 780, y: 5, width: 360, height: 300 }, workArea),
      'top',
    );
    assert.equal(
      getClosestEdge({ x: 780, y: 730, width: 360, height: 300 }, workArea),
      'bottom',
    );
  });

  it('docks expanded bounds to the selected edge', () => {
    assert.deepEqual(
      getDockedBounds('bottom', { x: 780, y: 730, width: 360, height: 300 }, workArea),
      { x: 780, y: 740, width: 360, height: 300 },
    );
  });

  it('reports the distance to the nearest edge', () => {
    assert.deepEqual(
      getClosestEdgeInfo({ x: 120, y: 300, width: 360, height: 300 }, workArea),
      { edge: 'left', distance: 120 },
    );
  });
});
