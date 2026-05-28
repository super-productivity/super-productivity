/**
 * Pure top-level-navigation helpers for the Doc Mode editor.
 *
 * Every function here operates on a `DocLike` — the minimal structural
 * slice of a ProseMirror document node that the drag / move / keyboard
 * logic actually touches. A real ProseMirror `Node` satisfies `DocLike`
 * structurally, so `ui/editor.ts` passes `editor.state.doc` straight in;
 * `doc-nav.spec.ts` passes hand-built plain objects. No TipTap, no DOM,
 * no module-global `editor` — that is what makes this file testable.
 *
 * "Top-level child" everywhere means a direct child of the doc node
 * (a chip group's `taskRef` / `subTaskRef`, or a paragraph / heading /
 * list / divider). Positions are ProseMirror document positions.
 */

/** The slice of a ProseMirror node these helpers read. */
export interface DocNodeLike {
  readonly type: { readonly name: string };
  readonly nodeSize: number;
  readonly attrs?: Record<string, unknown>;
}

/** The slice of a ProseMirror doc node these helpers read. */
export interface DocLike {
  readonly childCount: number;
  child(index: number): DocNodeLike;
  nodeAt(pos: number): DocNodeLike | null;
}

/** Source of a grip drag — a parent chip, a subtask chip, or a plain block. */
export type DragSourceType = 'taskRef' | 'subTaskRef' | 'other';

/** Top-level child index whose start position equals `pos`, or -1. */
export const childIdxAtPos = (doc: DocLike, pos: number): number => {
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += doc.child(i).nodeSize;
  }
  return -1;
};

/**
 * Number of contiguous top-level children that move as one atomic unit
 * starting at `idx`. A parent `taskRef` bundles its trailing `subTaskRef`
 * children — moving the parent out from under its subtasks would orphan
 * them. Every other block is a slice of length 1.
 */
export const sliceLenAt = (doc: DocLike, idx: number): number => {
  if (idx < 0 || idx >= doc.childCount) return 1;
  if (doc.child(idx).type.name !== 'taskRef') return 1;
  let end = idx + 1;
  while (end < doc.childCount && doc.child(end).type.name === 'subTaskRef') end++;
  return end - idx;
};

/**
 * Walk backwards from the top-level child at `subTaskRefPos` to the
 * `taskRef` that owns it; return its taskId, or null for an orphan
 * subtask (no preceding parent).
 *
 * Uses manual index iteration rather than `doc.resolve(pos).index(0)` —
 * the latter's gap-vs-node semantics at top-level boundaries were flagged
 * as mis-resolving for certain positions. Iterating is provably correct.
 */
export const findParentTaskIdBefore = (
  doc: DocLike,
  subTaskRefPos: number,
): string | null => {
  const subIdx = childIdxAtPos(doc, subTaskRefPos);
  if (subIdx < 0) return null;
  for (let i = subIdx - 1; i >= 0; i--) {
    const child = doc.child(i);
    if (child.type.name === 'taskRef') return (child.attrs?.taskId as string) || null;
    if (child.type.name === 'subTaskRef') continue;
    return null;
  }
  return null;
};

/**
 * Position immediately after the parent group at `parentNodePos` — past
 * the parent `taskRef` and any `subTaskRef`s that follow it. Used so Enter
 * at the end of a parent inserts the next sibling after its subtasks, not
 * between parent and first child. Returns `parentNodePos` unchanged if it
 * does not point at a taskRef.
 */
export const positionAfterParentGroup = (doc: DocLike, parentNodePos: number): number => {
  const idx = childIdxAtPos(doc, parentNodePos);
  if (idx < 0 || doc.child(idx).type.name !== 'taskRef') return parentNodePos;
  let end = parentNodePos + doc.child(idx).nodeSize;
  let j = idx + 1;
  while (j < doc.childCount && doc.child(j).type.name === 'subTaskRef') {
    end += doc.child(j).nodeSize;
    j++;
  }
  return end;
};

/**
 * Range of valid insertion-gap indices for a dragging `subTaskRef` so it
 * stays inside its parent's subtask group. Returns null when `draggingPos`
 * is not a subTaskRef or has no owning parent.
 */
export const validInsertRange = (
  doc: DocLike,
  draggingPos: number,
): { min: number; max: number } | null => {
  const dragNode = doc.nodeAt(draggingPos);
  if (!dragNode || dragNode.type.name !== 'subTaskRef') return null;
  const dragIdx = childIdxAtPos(doc, draggingPos);
  if (dragIdx < 0) return null;
  let parentIdx = -1;
  for (let i = dragIdx - 1; i >= 0; i--) {
    const c = doc.child(i);
    if (c.type.name === 'taskRef') {
      parentIdx = i;
      break;
    }
    if (c.type.name !== 'subTaskRef') return null;
  }
  if (parentIdx < 0) return null;
  let end = parentIdx + 1;
  while (end < doc.childCount && doc.child(end).type.name === 'subTaskRef') end++;
  return { min: parentIdx + 1, max: end };
};

/**
 * Target insertion-gap index for a block-menu "Move up" / "Move down".
 * Returns null when the move is a no-op (already at a boundary it must
 * not cross).
 *
 *  - subTaskRef: one step within the parent's group, never crossing the
 *    parent boundary.
 *  - taskRef: the whole parent group jumps past the previous / next group.
 *  - any other block: a plain single-step swap.
 */
export const moveBlockTargetIdx = (
  doc: DocLike,
  idx: number,
  direction: 'up' | 'down',
): number | null => {
  if (idx < 0 || idx >= doc.childCount) return null;
  const src = doc.child(idx);
  const sliceLen = sliceLenAt(doc, idx);

  if (direction === 'up') {
    if (idx === 0) return null;
    if (src.type.name === 'subTaskRef') {
      // Stop at the parent boundary — never escape the group.
      if (doc.child(idx - 1).type.name !== 'subTaskRef') return null;
      return idx - 1;
    }
    // Walk past subtask siblings to the start of the previous group.
    let prev = idx - 1;
    while (prev > 0 && doc.child(prev).type.name === 'subTaskRef') prev--;
    return prev;
  }

  const sliceEnd = idx + sliceLen;
  if (sliceEnd >= doc.childCount) return null;
  if (src.type.name === 'subTaskRef') {
    if (doc.child(sliceEnd).type.name !== 'subTaskRef') return null;
    return sliceEnd + 1;
  }
  // Walk past the next group's parent + its trailing subtasks.
  let groupEnd = sliceEnd + 1;
  while (groupEnd < doc.childCount && doc.child(groupEnd).type.name === 'subTaskRef') {
    groupEnd++;
  }
  return groupEnd;
};

/** A grip drag in progress, as far as drop-target snapping is concerned. */
export interface DragSnapInfo {
  sourceType: DragSourceType;
  /** Doc position of the dragged node (subTaskRef group lookup). */
  nodePos: number;
  /** Top-level index the slice started at. */
  fromIdx: number;
  /** Number of children in the dragged slice. */
  sliceLen: number;
}

/**
 * Snap a raw drop-target index (from pointer-Y hit-testing) to a legal
 * landing gap for the dragging slice:
 *
 *  - subTaskRef: clamped inside its parent's subtask group.
 *  - taskRef: advanced past any foreign `subTaskRef` run, so the group
 *    never lands between someone else's parent and their first subtask.
 *  - other: returned unchanged.
 */
export const snapDropTargetIdx = (
  doc: DocLike,
  rawTargetIdx: number,
  drag: DragSnapInfo,
): number => {
  if (drag.sourceType === 'subTaskRef') {
    const range = validInsertRange(doc, drag.nodePos);
    if (!range) return rawTargetIdx;
    return Math.max(range.min, Math.min(rawTargetIdx, range.max));
  }
  if (drag.sourceType === 'taskRef') {
    let targetIdx = rawTargetIdx;
    while (
      targetIdx < doc.childCount &&
      doc.child(targetIdx).type.name === 'subTaskRef' &&
      !(targetIdx >= drag.fromIdx && targetIdx < drag.fromIdx + drag.sliceLen)
    ) {
      targetIdx++;
    }
    return targetIdx;
  }
  return rawTargetIdx;
};
