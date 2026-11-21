import { sortMenuTreeByName } from './sort-menu-tree-by-name';
import {
  MenuTreeFolderNode,
  MenuTreeKind,
  MenuTreeTreeNode,
} from './store/menu-tree.model';

describe('sortMenuTreeByName', () => {
  const tag = (id: string): MenuTreeTreeNode => ({ k: MenuTreeKind.TAG, id });
  const folder = (
    id: string,
    name: string,
    children: MenuTreeTreeNode[] = [],
    isExpanded = true,
  ): MenuTreeFolderNode => ({
    k: MenuTreeKind.FOLDER,
    id,
    name,
    isExpanded,
    children,
  });
  const ids = (nodes: MenuTreeTreeNode[]): string[] => nodes.map((node) => node.id);

  it('sorts items by title, ignoring case', () => {
    const items = [
      { id: 't-1', title: 'zebra' },
      { id: 't-2', title: 'Apple' },
      { id: 't-3', title: 'mango' },
    ];

    const result = sortMenuTreeByName(
      [tag('t-1'), tag('t-2'), tag('t-3')],
      MenuTreeKind.TAG,
      items,
    );

    expect(ids(result)).toEqual(['t-2', 't-3', 't-1']);
  });

  it('orders numbers within titles naturally', () => {
    const items = [
      { id: 't-10', title: 'Sprint 10' },
      { id: 't-2', title: 'Sprint 2' },
    ];

    const result = sortMenuTreeByName([tag('t-10'), tag('t-2')], MenuTreeKind.TAG, items);

    expect(ids(result)).toEqual(['t-2', 't-10']);
  });

  it('lists folders first by name, sorts their children, and keeps folder state', () => {
    const items = [
      { id: 't-a', title: 'Alpha' },
      { id: 't-b', title: 'Beta' },
      { id: 't-c', title: 'Charlie' },
    ];
    const tree = [
      tag('t-b'),
      folder('f-work', 'Work', [tag('t-c'), tag('t-a')], false),
      folder('f-home', 'home'),
    ];

    const result = sortMenuTreeByName(tree, MenuTreeKind.TAG, items);

    expect(ids(result)).toEqual(['f-home', 'f-work', 't-b']);
    const work = result[1] as MenuTreeFolderNode;
    expect(ids(work.children)).toEqual(['t-a', 't-c']);
    expect(work.isExpanded).toBeFalse();
    expect(work.name).toBe('Work');
  });

  it('adds items missing from the tree at root in sorted position', () => {
    const items = [
      { id: 'p-1', title: 'Middle' },
      { id: 'p-new', title: 'Aardvark' },
    ];

    const result = sortMenuTreeByName(
      [{ k: MenuTreeKind.PROJECT, id: 'p-1' }],
      MenuTreeKind.PROJECT,
      items,
    );

    expect(ids(result)).toEqual(['p-new', 'p-1']);
    expect(result[0].k).toBe(MenuTreeKind.PROJECT);
  });

  it('does not duplicate items that already sit inside a folder', () => {
    const items = [{ id: 't-1', title: 'Nested' }];

    const result = sortMenuTreeByName(
      [folder('f-1', 'Folder', [tag('t-1')])],
      MenuTreeKind.TAG,
      items,
    );

    expect(ids(result)).toEqual(['f-1']);
    expect(ids((result[0] as MenuTreeFolderNode).children)).toEqual(['t-1']);
  });

  it('keeps nodes without a known item at the end in their original order', () => {
    const items = [{ id: 't-1', title: 'Known' }];

    const result = sortMenuTreeByName(
      [tag('gone-2'), tag('t-1'), tag('gone-1')],
      MenuTreeKind.TAG,
      items,
    );

    expect(ids(result)).toEqual(['t-1', 'gone-2', 'gone-1']);
  });

  it('does not mutate the input tree', () => {
    const items = [
      { id: 't-a', title: 'A' },
      { id: 't-b', title: 'B' },
    ];
    const tree = [folder('f-1', 'Folder', [tag('t-b'), tag('t-a')])];
    const snapshot = JSON.stringify(tree);

    sortMenuTreeByName(tree, MenuTreeKind.TAG, items);

    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});
