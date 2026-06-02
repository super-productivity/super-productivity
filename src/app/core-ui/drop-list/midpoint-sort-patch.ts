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
 * The strategy class is internal to `@angular/cdk/drag-drop`, so we reach the
 * instance via the `CdkDropList`'s `_dropListRef`. We patch *that list's own*
 * strategy instance (an own property shadowing the prototype method), NOT the
 * shared `SingleAxisSortStrategy.prototype`: every vertical CDK list in the app
 * (planner, notes, boards, tree-dnd) shares that prototype, so patching it would
 * silently change their hit-test too. Only the task lists registered via
 * `DropListService` are patched. A CDK API rename leaves CDK's original
 * behaviour in place with a log.
 */
export const applyMidpointSortPatch = (dropList: CdkDropList): void => {
  const strategy = (dropList as unknown as CdkDropListInternals)._dropListRef
    ?._sortStrategy;
  if (!strategy) return;
  const target = strategy as unknown as Record<string, unknown>;
  // Reads through the prototype chain on first patch (catches a CDK rename),
  // then reads this instance's own shadow on re-register — both are functions.
  if (typeof target['_getItemIndexFromPointerPosition'] !== 'function') {
    Log.log('[drop-list] midpoint sort patch skipped — CDK internals changed');
    return;
  }
  target['_getItemIndexFromPointerPosition'] = midpointGetItemIndex;
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
    // Midpoint guard applies during active sort of a VERTICAL list, after the
    // dragged item already has a position in the cache. Scoping it to vertical
    // keeps the patch's behavioural change to the task lists it was built for
    // and leaves the app's horizontal lists (boards, issue panel) on CDK's
    // stock first-inside hit-test — which also sidesteps right-to-left, where
    // `_itemPositions` is sorted left-ascending so a higher index is visually
    // *earlier* and the above/below assumption would invert. During `enter()`
    // (currentIndex === -1) and delta-less sort calls, keep CDK's first-inside
    // semantics so the placeholder lands somewhere sensible on entry instead
    // of falling through to "append at end".
    if (delta && currentIndex !== -1 && !isHorizontal) {
      const centre = (clientRect.top + clientRect.bottom) / 2;
      if (candidateIdx > currentIndex) {
        // Candidate sits visually below the dragged item — swap only once
        // the cursor crosses into its lower half (so the placeholder moves
        // *after* it).
        if (pointerY < centre) return false;
      } else {
        // Candidate sits visually above — swap only once the cursor
        // crosses into its upper half.
        if (pointerY > centre) return false;
      }
    }
    return true;
  });
  return index === -1 || !this._sortPredicate(index, item) ? -1 : index;
}
