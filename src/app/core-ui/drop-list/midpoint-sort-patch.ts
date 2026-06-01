import { CdkDropList } from '@angular/cdk/drag-drop';
import { Log } from '../../core/log';

interface ClientRectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface ItemPositionLike {
  drag: unknown;
  clientRect: ClientRectLike;
}

interface PreviousSwapLike {
  drag: unknown;
  delta: number;
  overlaps: boolean;
}

interface SortStrategyLike {
  orientation: 'vertical' | 'horizontal';
  _itemPositions: ItemPositionLike[];
  _previousSwap: PreviousSwapLike;
  _sortPredicate: (index: number, item: unknown) => boolean;
}

interface DropListRefLike {
  _sortStrategy?: SortStrategyLike;
}

interface CdkDropListInternals {
  _dropListRef?: DropListRefLike;
}

let isPatched = false;

/**
 * CDK's `SingleAxisSortStrategy` swaps items as soon as the pointer enters
 * any part of a sibling's `clientRect`. For task lists whose item rects span
 * the parent's full element (header + its expanded subtask list), that swap
 * translates the drop preview far past the cursor — landing it well below
 * the target instead of where the user is pointing.
 *
 * Replace the hit-test with a midpoint-crossing rule (the pattern used by
 * dnd-kit / react-beautiful-dnd): a sibling only swaps with the dragged item
 * once the cursor crosses the *half* of that sibling that's on the dragged
 * item's "approach" side.
 *
 *   - Candidate sibling is *below* the dragged item → swap when the cursor
 *     crosses into the sibling's bottom half.
 *   - Candidate sibling is *above* the dragged item → swap when the cursor
 *     crosses into the sibling's top half.
 *
 * The relative position (above/below) is read from `_itemPositions`, which
 * CDK keeps sorted by `clientRect.top`. The dragged item's row in that cache
 * gives a stable reference even after the placeholder has been re-parented
 * across containers.
 *
 * The strategy class is internal to `@angular/cdk/drag-drop`, so we reach it
 * via the first `CdkDropList` we see at runtime. Idempotent; a CDK API
 * change just leaves CDK's original behaviour in place with a log.
 */
export const applyMidpointSortPatch = (dropList: CdkDropList): void => {
  if (isPatched) return;
  const strategy = (dropList as unknown as CdkDropListInternals)._dropListRef
    ?._sortStrategy;
  if (!strategy) return;
  const proto = Object.getPrototypeOf(strategy) as Record<string, unknown>;
  if (typeof proto['_getItemIndexFromPointerPosition'] !== 'function') {
    Log.log('[drop-list] midpoint sort patch skipped — CDK internals changed');
    return;
  }
  proto['_getItemIndexFromPointerPosition'] = midpointGetItemIndex;
  isPatched = true;
};

// Exported for tests. Same signature as CDK's original.
export function midpointGetItemIndex(
  this: SortStrategyLike,
  item: unknown,
  pointerX: number,
  pointerY: number,
  delta?: { x: number; y: number },
): number {
  const isHorizontal = this.orientation === 'horizontal';
  // Where the dragged item currently sits in the sorted position cache.
  // -1 during `enter()` (it hasn't been inserted yet); >= 0 during `sort()`
  // after the first enter.
  const currentIndex = this._itemPositions.findIndex((p) => p.drag === item);
  const index = this._itemPositions.findIndex(({ drag, clientRect }, candidateIdx) => {
    if (drag === item) return false;
    if (delta) {
      const direction = isHorizontal ? delta.x : delta.y;
      // Preserve CDK's anti-thrash: after a swap with this sibling in this
      // direction, don't re-swap until the cursor changes direction or
      // leaves it.
      if (
        drag === this._previousSwap.drag &&
        this._previousSwap.overlaps &&
        direction === this._previousSwap.delta
      ) {
        return false;
      }
    }
    const inside = isHorizontal
      ? pointerX >= Math.floor(clientRect.left) && pointerX < Math.floor(clientRect.right)
      : pointerY >= Math.floor(clientRect.top) &&
        pointerY < Math.floor(clientRect.bottom);
    if (!inside) return false;
    // Midpoint guard applies during active sort, after the dragged item
    // already has a position in the cache. During `enter()` (currentIndex
    // === -1) and during sort calls without delta, keep CDK's first-inside
    // semantics so the placeholder lands somewhere sensible on entry
    // instead of falling through to "append at end".
    if (delta && currentIndex !== -1) {
      const ptr = isHorizontal ? pointerX : pointerY;
      const centre = isHorizontal
        ? (clientRect.left + clientRect.right) / 2
        : (clientRect.top + clientRect.bottom) / 2;
      if (candidateIdx > currentIndex) {
        // Candidate sits visually below the dragged item — swap only once
        // the cursor crosses into its lower half (so the placeholder moves
        // *after* it).
        if (ptr < centre) return false;
      } else {
        // Candidate sits visually above — swap only once the cursor
        // crosses into its upper half.
        if (ptr > centre) return false;
      }
    }
    return true;
  });
  return index === -1 || !this._sortPredicate(index, item) ? -1 : index;
}

// Test-only: reset the singleton flag between specs.
export const _resetMidpointSortPatchForTests = (): void => {
  isPatched = false;
};
