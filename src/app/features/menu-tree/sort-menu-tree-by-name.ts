import {
  MenuTreeFolderNode,
  MenuTreeKind,
  MenuTreeTreeNode,
} from './store/menu-tree.model';

const compareNames = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Returns a copy of `tree` where every level lists folders first, then items,
 * each by name (A–Z). `items` supplies the item names and is the set of items
 * the tree should hold: items missing from `tree` (projects are never inserted
 * on creation) are added at root first, so they land in sorted position rather
 * than trailing the list. Nodes without a known item keep their relative order
 * at the end of their level; the view skips them anyway.
 */
export const sortMenuTreeByName = (
  tree: MenuTreeTreeNode[],
  itemKind: MenuTreeKind.PROJECT | MenuTreeKind.TAG,
  items: readonly { id: string; title: string }[],
): MenuTreeTreeNode[] => {
  const titleById = new Map(items.map((item) => [item.id, item.title]));

  const presentIds = new Set<string>();
  const collectIds = (nodes: MenuTreeTreeNode[]): void => {
    for (const node of nodes) {
      if (node.k === MenuTreeKind.FOLDER) {
        collectIds(node.children);
      } else if (node.k === itemKind) {
        presentIds.add(node.id);
      }
    }
  };
  collectIds(tree);

  const missingNodes = items
    .filter((item) => !presentIds.has(item.id))
    .map((item) => ({ k: itemKind, id: item.id }) as MenuTreeTreeNode);

  const sortLevel = (nodes: MenuTreeTreeNode[]): MenuTreeTreeNode[] => {
    const folders: MenuTreeFolderNode[] = [];
    const namedItems: { node: MenuTreeTreeNode; title: string }[] = [];
    const unknownItems: MenuTreeTreeNode[] = [];

    for (const node of nodes) {
      if (node.k === MenuTreeKind.FOLDER) {
        folders.push({ ...node, children: sortLevel(node.children) });
        continue;
      }
      const title = node.k === itemKind ? titleById.get(node.id) : undefined;
      if (title === undefined) {
        unknownItems.push(node);
      } else {
        namedItems.push({ node, title });
      }
    }

    folders.sort((a, b) => compareNames(a.name, b.name));
    namedItems.sort((a, b) => compareNames(a.title, b.title));

    return [...folders, ...namedItems.map(({ node }) => node), ...unknownItems];
  };

  return sortLevel([...tree, ...missingNodes]);
};
