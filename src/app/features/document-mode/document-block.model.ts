export type DocumentBlockType = 'task' | 'text' | 'heading' | 'divider';

export interface DocumentBlockBase {
  id: string;
  type: DocumentBlockType;
}

export interface TaskBlock extends DocumentBlockBase {
  type: 'task';
  taskId: string;
}

export interface TextBlock extends DocumentBlockBase {
  type: 'text';
  content: string;
}

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingBlock extends DocumentBlockBase {
  type: 'heading';
  content: string;
  level: HeadingLevel;
}

export interface DividerBlock extends DocumentBlockBase {
  type: 'divider';
}

export type DocumentBlock = TaskBlock | TextBlock | HeadingBlock | DividerBlock;

export interface DocumentBlocksDelta {
  changedBlocks: DocumentBlock[];
  removedBlockIds: string[];
  blockOrder: string[];
}

const blocksEqual = (a: DocumentBlock, b: DocumentBlock): boolean => {
  if (a.id !== b.id || a.type !== b.type) return false;
  switch (a.type) {
    case 'task':
      return a.taskId === (b as TaskBlock).taskId;
    case 'text':
      return a.content === (b as TextBlock).content;
    case 'heading':
      return (
        a.content === (b as HeadingBlock).content && a.level === (b as HeadingBlock).level
      );
    case 'divider':
      return true;
  }
};

const orderEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Compute a minimal delta between two block arrays.
 * Returns null if nothing changed.
 */
export const computeBlocksDelta = (
  lastBlocks: DocumentBlock[],
  currentBlocks: DocumentBlock[],
): DocumentBlocksDelta | null => {
  const lastMap = new Map(lastBlocks.map((b) => [b.id, b]));
  const currentIds = new Set(currentBlocks.map((b) => b.id));

  const removedBlockIds = lastBlocks
    .filter((b) => !currentIds.has(b.id))
    .map((b) => b.id);

  const changedBlocks = currentBlocks.filter((block) => {
    const prev = lastMap.get(block.id);
    return !prev || !blocksEqual(prev, block);
  });

  const blockOrder = currentBlocks.map((b) => b.id);
  const lastOrder = lastBlocks.map((b) => b.id);
  const orderChanged = !orderEqual(lastOrder, blockOrder);

  if (changedBlocks.length === 0 && removedBlockIds.length === 0 && !orderChanged) {
    return null;
  }

  return { changedBlocks, removedBlockIds, blockOrder };
};

/**
 * Apply a delta to an existing block array.
 * Used by reducers to reconstruct documentBlocks from a delta operation.
 * Preserves blocks not in blockOrder (e.g. concurrent remote adds).
 */
export const applyDocumentBlocksDelta = (
  existing: DocumentBlock[],
  delta: DocumentBlocksDelta,
): DocumentBlock[] => {
  const blockMap = new Map(existing.map((b) => [b.id, b]));

  for (const block of delta.changedBlocks) {
    blockMap.set(block.id, block);
  }
  for (const id of delta.removedBlockIds) {
    blockMap.delete(id);
  }

  const ordered: DocumentBlock[] = [];
  const seen = new Set<string>();
  for (const id of delta.blockOrder) {
    const block = blockMap.get(id);
    if (block) {
      ordered.push(block);
      seen.add(id);
    }
  }
  // Append blocks not in order (concurrent remote adds)
  for (const [id, block] of blockMap) {
    if (!seen.has(id)) {
      ordered.push(block);
    }
  }
  return ordered;
};
