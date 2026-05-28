import {
  MenuTreeKind,
  MenuTreeState,
  MenuTreeTreeNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';

const KNOWN_MENU_TREE_KINDS = new Set<string>(Object.values(MenuTreeKind));

const getNodeKindForLog = (kind: unknown): string =>
  typeof kind === 'string' && KNOWN_MENU_TREE_KINDS.has(kind) ? kind : 'unknown';

const logOrphanedReferenceRemoval = (
  treeType: 'projectTree' | 'tagTree',
  referenceType: 'project' | 'tag',
  referenceId: string,
): void => {
  OP_LOG_SYNC_LOGGER.log('[repair-menu-tree] Removed orphaned reference', {
    treeType,
    referenceType,
    referenceId,
  });
};

const logInvalidNodeRemoval = (
  treeType: 'projectTree' | 'tagTree',
  node: MenuTreeTreeNode,
): void => {
  OP_LOG_SYNC_LOGGER.warn('[repair-menu-tree] Removed invalid node', {
    treeType,
    nodeKind: getNodeKindForLog(node.k),
    hasNodeId: typeof node.id === 'string',
    childCount:
      node.k === MenuTreeKind.FOLDER && Array.isArray(node.children)
        ? node.children.length
        : undefined,
  });
};

/**
 * Repairs menuTree by removing orphaned project/tag references
 * @param menuTree The menuTree state to repair
 * @param validProjectIds Set of valid project IDs
 * @param validTagIds Set of valid tag IDs
 * @returns Repaired menuTree state
 */
export const repairMenuTree = (
  menuTree: MenuTreeState,
  validProjectIds: Set<string>,
  validTagIds: Set<string>,
): MenuTreeState => {
  OP_LOG_SYNC_LOGGER.log('[repair-menu-tree] Repairing orphaned references');

  /**
   * Recursively filters tree nodes, removing orphaned project/tag references
   * and empty folders
   */
  const filterTreeNodes = (
    nodes: MenuTreeTreeNode[],
    treeType: 'projectTree' | 'tagTree',
  ): MenuTreeTreeNode[] => {
    const filtered: MenuTreeTreeNode[] = [];

    for (const node of nodes) {
      if (node.k === MenuTreeKind.FOLDER) {
        const filteredChildren = filterTreeNodes(node.children, treeType);
        filtered.push({
          ...node,
          children: filteredChildren,
        });
      } else if (treeType === 'projectTree' && node.k === MenuTreeKind.PROJECT) {
        // Keep project only if it exists
        if (validProjectIds.has(node.id)) {
          filtered.push(node);
        } else {
          logOrphanedReferenceRemoval(treeType, 'project', node.id);
        }
      } else if (treeType === 'tagTree' && node.k === MenuTreeKind.TAG) {
        // Keep tag only if it exists
        if (validTagIds.has(node.id)) {
          filtered.push(node);
        } else {
          logOrphanedReferenceRemoval(treeType, 'tag', node.id);
        }
      } else {
        // kind mismatch or unknown
        logInvalidNodeRemoval(treeType, node);
      }
    }

    return filtered;
  };

  const repairedProjectTree = Array.isArray(menuTree.projectTree)
    ? filterTreeNodes(menuTree.projectTree, 'projectTree')
    : [];

  const repairedTagTree = Array.isArray(menuTree.tagTree)
    ? filterTreeNodes(menuTree.tagTree, 'tagTree')
    : [];

  return {
    projectTree: repairedProjectTree,
    tagTree: repairedTagTree,
  };
};
