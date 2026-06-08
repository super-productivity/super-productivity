import {
  createScopedMidpointGetItemIndex,
  midpointGetItemIndex,
} from './midpoint-sort-patch';

describe('midpoint sort patch', () => {
  // Three stacked items along the vertical axis, each 100px tall, no gap.
  //   A  [  0 .. 100)
  //   B  [100 .. 200)
  //   C  [200 .. 300)
  // The dragged item's position in `_itemPositions` varies per test — that
  // index decides which candidates are "above" and which are "below".
  const dragB = { id: 'B' };
  const dragC = { id: 'C' };
  // Use distinct objects so identity comparisons always have a clear answer.
  const draggedAtTop = { id: 'dragged-at-top' };
  const draggedAtMid = { id: 'dragged-at-mid' };
  const draggedAtBot = { id: 'dragged-at-bot' };

  type Strategy = {
    orientation: 'vertical' | 'horizontal';
    _itemPositions: {
      drag: unknown;
      clientRect: { left: number; right: number; top: number; bottom: number };
    }[];
    _previousSwap: { drag: unknown; delta: number; overlaps: boolean };
    _sortPredicate: () => boolean;
  };

  const rect = (
    top: number,
    bottom: number,
  ): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } => ({ left: 0, right: 200, top, bottom });

  const makeStrategy = (
    draggedAt: 'top' | 'mid' | 'bot',
    overrides: {
      previousSwap?: Partial<{ drag: unknown; delta: number; overlaps: boolean }>;
    } = {},
  ): Strategy => {
    const dragged =
      draggedAt === 'top'
        ? draggedAtTop
        : draggedAt === 'mid'
          ? draggedAtMid
          : draggedAtBot;
    const itemPositions = [
      { drag: dragged, clientRect: rect(0, 100) },
      { drag: dragB, clientRect: rect(100, 200) },
      { drag: dragC, clientRect: rect(200, 300) },
    ];
    if (draggedAt === 'mid') {
      itemPositions[0] = { drag: { id: 'A' }, clientRect: rect(0, 100) };
      itemPositions[1] = { drag: dragged, clientRect: rect(100, 200) };
    } else if (draggedAt === 'bot') {
      itemPositions[0] = { drag: { id: 'A' }, clientRect: rect(0, 100) };
      itemPositions[2] = { drag: dragged, clientRect: rect(200, 300) };
    }
    return {
      orientation: 'vertical',
      _itemPositions: itemPositions,
      _previousSwap: {
        drag: null,
        delta: 0,
        overlaps: false,
        ...overrides.previousSwap,
      },
      _sortPredicate: () => true,
    };
  };

  type StrategyCtx = ThisParameterType<typeof midpointGetItemIndex>;

  const call = (
    strat: Strategy,
    draggedItem: unknown,
    y: number,
    delta?: { x: number; y: number },
  ): number =>
    midpointGetItemIndex.call(strat as unknown as StrategyCtx, draggedItem, 50, y, delta);

  describe('without delta (enter() path)', () => {
    it('returns the index of the item the pointer is inside', () => {
      const s = makeStrategy('top');
      expect(call(s, draggedAtTop, 150)).toBe(1); // inside B
      expect(call(s, draggedAtTop, 250)).toBe(2); // inside C
    });

    it('returns -1 when the pointer is outside every item', () => {
      const s = makeStrategy('top');
      expect(call(s, draggedAtTop, 999)).toBe(-1);
    });

    it('skips the dragged item itself', () => {
      const s = makeStrategy('top');
      expect(call(s, draggedAtTop, 50)).toBe(-1); // inside A, but A IS dragged
    });
  });

  describe('with delta (sort() path) — relative-position midpoint guard', () => {
    describe('candidate sits BELOW the dragged item', () => {
      it('rejects the swap while the cursor is in the candidate top half', () => {
        // Dragged is at top (idx 0). B at idx 1 is below. B's centre = 150.
        // Cursor at y=140 is in B's TOP half — must not swap yet.
        const s = makeStrategy('top');
        expect(call(s, draggedAtTop, 140, { x: 0, y: 1 })).toBe(-1);
      });

      it('accepts the swap once the cursor crosses into the bottom half', () => {
        const s = makeStrategy('top');
        // y=160 is past B's centre — bottom half.
        expect(call(s, draggedAtTop, 160, { x: 0, y: 1 })).toBe(1);
      });

      it('reproduces the regression from the user log: first-sort-after-enter does not bounce the placeholder past the candidate', () => {
        // Right after enter(), placeholder is at idx 0 (above the item at
        // idx 1). The cursor is right at the top edge of that item — clearly
        // *not* in its bottom half. Must not swap.
        const s = makeStrategy('top');
        expect(call(s, draggedAtTop, 100, { x: 0, y: -1 })).toBe(-1);
        expect(call(s, draggedAtTop, 110, { x: 0, y: -1 })).toBe(-1);
        expect(call(s, draggedAtTop, 130, { x: 0, y: -1 })).toBe(-1);
        // Crossing the centre allows it.
        expect(call(s, draggedAtTop, 160, { x: 0, y: -1 })).toBe(1);
      });
    });

    describe('candidate sits ABOVE the dragged item', () => {
      it('rejects the swap while the cursor is in the candidate bottom half', () => {
        // Dragged at bottom (idx 2). A is at idx 0 — above. A's centre = 50.
        // Cursor at y=60 is in A's BOTTOM half — must not swap yet.
        const s = makeStrategy('bot');
        expect(call(s, draggedAtBot, 60, { x: 0, y: -1 })).toBe(-1);
      });

      it('accepts the swap once the cursor crosses into the top half', () => {
        const s = makeStrategy('bot');
        // y=40 is past A's centre going up — top half.
        expect(call(s, draggedAtBot, 40, { x: 0, y: -1 })).toBe(0);
      });
    });

    describe('mixed: dragged in the middle', () => {
      it('routes a candidate above through the top-half rule', () => {
        // Dragged at idx 1. A is at idx 0 — above. Centre = 50.
        const s = makeStrategy('mid');
        expect(call(s, draggedAtMid, 60, { x: 0, y: -1 })).toBe(-1); // in A bottom half
        expect(call(s, draggedAtMid, 40, { x: 0, y: -1 })).toBe(0); // crossed into A top half
      });

      it('routes a candidate below through the bottom-half rule', () => {
        // Dragged at idx 1. C is at idx 2 — below. Centre = 250.
        const s = makeStrategy('mid');
        expect(call(s, draggedAtMid, 240, { x: 0, y: 1 })).toBe(-1);
        expect(call(s, draggedAtMid, 260, { x: 0, y: 1 })).toBe(2);
      });
    });
  });

  describe('honours CDK anti-thrash', () => {
    it('skips an item already overlapping with the same swap direction', () => {
      const s = makeStrategy('top', {
        previousSwap: { drag: dragB, delta: 1, overlaps: true },
      });
      // Pointer past B's centre (150) at y=170 going down — would normally
      // accept B, but we already swapped here heading the same way.
      expect(call(s, draggedAtTop, 170, { x: 0, y: 1 })).toBe(-1);
    });
  });

  describe('horizontal orientation falls back to CDK first-inside (patch is vertical-only)', () => {
    it('swaps as soon as the pointer is inside a sibling, ignoring the midpoint', () => {
      // The midpoint guard is scoped to vertical lists so the app's horizontal
      // lists (boards, issue panel) keep CDK's stock behaviour. The vertical
      // rule would reject a swap while the cursor is in the candidate's near
      // half; here the swap must be accepted as soon as the pointer is inside
      // the rect.
      const dragged = { id: 'dragged-h' };
      const right = { id: 'right' };
      const horizontalStrategy: Strategy = {
        orientation: 'horizontal',
        _itemPositions: [
          { drag: dragged, clientRect: { left: 0, right: 100, top: 0, bottom: 50 } },
          { drag: right, clientRect: { left: 100, right: 200, top: 0, bottom: 50 } },
        ],
        _previousSwap: { drag: null, delta: 0, overlaps: false },
        _sortPredicate: (): boolean => true,
      };
      // x=140 — LEFT half of `right`: the vertical rule would reject, stock accepts.
      expect(
        midpointGetItemIndex.call(
          horizontalStrategy as unknown as StrategyCtx,
          dragged,
          140,
          25,
          { x: 1, y: 0 },
        ),
      ).toBe(1);
      // x=160 — right half: still inside, still swaps.
      expect(
        midpointGetItemIndex.call(
          horizontalStrategy as unknown as StrategyCtx,
          dragged,
          160,
          25,
          { x: 1, y: 0 },
        ),
      ).toBe(1);
      // x=50 — inside the dragged item itself: never swaps with self.
      expect(
        midpointGetItemIndex.call(
          horizontalStrategy as unknown as StrategyCtx,
          dragged,
          50,
          25,
          { x: 1, y: 0 },
        ),
      ).toBe(-1);
    });
  });

  describe('sort predicate gate', () => {
    it('returns -1 when the host sort predicate rejects the index', () => {
      const s = makeStrategy('top');
      s._sortPredicate = (): boolean => false;
      expect(call(s, draggedAtTop, 160, { x: 0, y: 1 })).toBe(-1);
    });
  });

  describe('safety: when the dragged item has not yet been added to the cache', () => {
    it('falls back to first-inside semantics (so enter() lands somewhere sensible)', () => {
      // Simulates enter() before the dragged item is in `_itemPositions`.
      const draggedOutside = { id: 'not-in-cache' };
      const s: Strategy = {
        orientation: 'vertical',
        _itemPositions: [
          { drag: { id: 'A' }, clientRect: rect(0, 100) },
          { drag: dragB, clientRect: rect(100, 200) },
          { drag: dragC, clientRect: rect(200, 300) },
        ],
        _previousSwap: { drag: null, delta: 0, overlaps: false },
        _sortPredicate: (): boolean => true,
      };
      // With currentIndex = -1, midpoint guard is bypassed — even with delta,
      // any pointer-inside-rect returns that item's index.
      expect(call(s, draggedOutside, 140, { x: 0, y: 1 })).toBe(1);
      expect(call(s, draggedOutside, 260, { x: 0, y: -1 })).toBe(2);
    });
  });

  // CDK recreates the sort-strategy instance on every drag start, so the
  // midpoint behaviour lives on the shared prototype and is scoped to task
  // lists by container. These cover that scoping decision in isolation (the
  // prototype wiring lives in applyMidpointSortPatch, which uses module state).
  describe('createScopedMidpointGetItemIndex (per-container scoping)', () => {
    const el = document.createElement('div');
    // Dragged at top (idx 0); candidate B below it (centre 150). Cursor at 140
    // is in B's TOP half → the midpoint rule rejects the swap (returns -1),
    // whereas CDK's stock first-inside would accept it.
    const strat = (): Strategy & { _element: Element } => ({
      _element: el,
      orientation: 'vertical',
      _itemPositions: [
        { drag: draggedAtTop, clientRect: rect(0, 100) },
        { drag: dragB, clientRect: rect(100, 200) },
        { drag: dragC, clientRect: rect(200, 300) },
      ],
      _previousSwap: { drag: null, delta: 0, overlaps: false },
      _sortPredicate: (): boolean => true,
    });
    const STOCK = 1;

    it('applies the midpoint rule when the container opts in', () => {
      const original = jasmine.createSpy('original').and.returnValue(STOCK);
      const fn = createScopedMidpointGetItemIndex(original, () => true);
      const s = strat();
      expect(
        fn.call(s as unknown as StrategyCtx, draggedAtTop, 50, 140, { x: 0, y: 1 }),
      ).toBe(-1); // midpoint rejects; not STOCK
      expect(original).not.toHaveBeenCalled();
    });

    it('delegates to CDK original when the container is not a task list', () => {
      const original = jasmine.createSpy('original').and.returnValue(STOCK);
      const fn = createScopedMidpointGetItemIndex(original, () => false);
      const s = strat();
      expect(
        fn.call(s as unknown as StrategyCtx, draggedAtTop, 50, 140, { x: 0, y: 1 }),
      ).toBe(STOCK);
      expect(original).toHaveBeenCalledOnceWith(draggedAtTop, 50, 140, { x: 0, y: 1 });
      expect(original.calls.mostRecent().object).toBe(s);
    });
  });
});
