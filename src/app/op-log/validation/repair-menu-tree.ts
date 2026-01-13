import {
  MenuTreeKind,
  MenuTreeState,
  MenuTreeTreeNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { PFLog } from '../../core/log';

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
  PFLog.log('Repairing menuTree - removing orphaned references');

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
          PFLog.log(`Removing orphaned project reference ${node.id} from ${treeType}`);
        }
      } else if (treeType === 'tagTree' && node.k === MenuTreeKind.TAG) {
        // Keep tag only if it exists
        if (validTagIds.has(node.id)) {
          filtered.push(node);
        } else {
          PFLog.log(`Removing orphaned tag reference ${node.id} from ${treeType}`);
        }
      } else {
        // kind mismatch or unknown
        PFLog.warn(`Removing invalid node from ${treeType}:`, node);
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
