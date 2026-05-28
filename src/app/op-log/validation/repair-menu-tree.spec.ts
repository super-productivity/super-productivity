import { repairMenuTree } from './repair-menu-tree';
import {
  MenuTreeKind,
  MenuTreeState,
} from '../../features/menu-tree/store/menu-tree.model';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';

describe('repairMenuTree', () => {
  let logSpy: jasmine.Spy;
  let warnSpy: jasmine.Spy;

  beforeEach(() => {
    logSpy = spyOn(OP_LOG_SYNC_LOGGER, 'log').and.stub();
    warnSpy = spyOn(OP_LOG_SYNC_LOGGER, 'warn').and.stub();
  });

  it('should remove orphaned project references from projectTree', () => {
    const validProjectIds = new Set(['project1', 'project2']);
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: [
        { k: MenuTreeKind.PROJECT, id: 'project1' },
        { k: MenuTreeKind.PROJECT, id: 'orphaned-project' },
        { k: MenuTreeKind.PROJECT, id: 'project2' },
      ],
      tagTree: [],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree.length).toBe(2);
    expect(result.projectTree).toEqual([
      { k: MenuTreeKind.PROJECT, id: 'project1' },
      { k: MenuTreeKind.PROJECT, id: 'project2' },
    ]);
  });

  it('should remove orphaned tag references from tagTree', () => {
    const validProjectIds = new Set<string>();
    const validTagIds = new Set(['tag1', 'tag2']);

    const menuTree: MenuTreeState = {
      projectTree: [],
      tagTree: [
        { k: MenuTreeKind.TAG, id: 'tag1' },
        { k: MenuTreeKind.TAG, id: 'orphaned-tag' },
        { k: MenuTreeKind.TAG, id: 'tag2' },
      ],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.tagTree.length).toBe(2);
    expect(result.tagTree).toEqual([
      { k: MenuTreeKind.TAG, id: 'tag1' },
      { k: MenuTreeKind.TAG, id: 'tag2' },
    ]);
  });

  it('should keep folders even if they end up empty', () => {
    const validProjectIds = new Set(['project1']);
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: [
        {
          k: MenuTreeKind.FOLDER,
          id: 'folder1',
          name: 'Folder 1',
          isExpanded: true,
          children: [
            { k: MenuTreeKind.PROJECT, id: 'project1' },
            { k: MenuTreeKind.PROJECT, id: 'orphaned-project' },
          ],
        },
      ],
      tagTree: [],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree.length).toBe(1);
    expect(result.projectTree[0].k).toBe(MenuTreeKind.FOLDER);
    if (result.projectTree[0].k === MenuTreeKind.FOLDER) {
      expect(result.projectTree[0].id).toBe('folder1');
      expect(result.projectTree[0].children.length).toBe(1);
      expect(result.projectTree[0].children[0]).toEqual({
        k: MenuTreeKind.PROJECT,
        id: 'project1',
      });
    }
  });

  it('should handle nested folders correctly', () => {
    const validProjectIds = new Set(['project1', 'project2']);
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: [
        {
          k: MenuTreeKind.FOLDER,
          id: 'parent-folder',
          name: 'Parent',
          isExpanded: true,
          children: [
            { k: MenuTreeKind.PROJECT, id: 'project1' },
            {
              k: MenuTreeKind.FOLDER,
              id: 'nested-folder',
              name: 'Nested',
              isExpanded: false,
              children: [
                { k: MenuTreeKind.PROJECT, id: 'project2' },
                { k: MenuTreeKind.PROJECT, id: 'orphaned-nested-project' },
              ],
            },
          ],
        },
      ],
      tagTree: [],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree.length).toBe(1);
    if (result.projectTree[0].k === MenuTreeKind.FOLDER) {
      expect(result.projectTree[0].children.length).toBe(2);
      const nestedFolder = result.projectTree[0].children[1];
      if (nestedFolder.k === MenuTreeKind.FOLDER) {
        expect(nestedFolder.children.length).toBe(1);
        expect(nestedFolder.children[0]).toEqual({
          k: MenuTreeKind.PROJECT,
          id: 'project2',
        });
      }
    }
  });

  it('should return empty arrays for invalid tree structures', () => {
    const validProjectIds = new Set(['project1']);
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: null as any,
      tagTree: undefined as any,
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree).toEqual([]);
    expect(result.tagTree).toEqual([]);
  });

  it('should preserve valid folder structure', () => {
    const validProjectIds = new Set(['project1', 'project2']);
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: [
        {
          k: MenuTreeKind.FOLDER,
          id: 'folder1',
          name: 'Work Projects',
          isExpanded: true,
          children: [
            { k: MenuTreeKind.PROJECT, id: 'project1' },
            { k: MenuTreeKind.PROJECT, id: 'project2' },
          ],
        },
      ],
      tagTree: [],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree).toEqual(menuTree.projectTree);
  });

  it('should remove mismatched node kinds', () => {
    const validProjectIds = new Set(['project1']);
    const validTagIds = new Set(['tag1']);

    const menuTree: MenuTreeState = {
      projectTree: [
        { k: MenuTreeKind.PROJECT, id: 'project1' },
        { k: MenuTreeKind.TAG, id: 'tag1' } as any,
      ],
      tagTree: [
        { k: MenuTreeKind.TAG, id: 'tag1' },
        { k: MenuTreeKind.PROJECT, id: 'project1' } as any,
      ],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree).toEqual([{ k: MenuTreeKind.PROJECT, id: 'project1' }]);
    expect(result.tagTree).toEqual([{ k: MenuTreeKind.TAG, id: 'tag1' }]);
  });

  it('should log invalid nodes without raw node values', () => {
    const privateNodeName = 'Private Folder Name';
    const validProjectIds = new Set<string>();
    const validTagIds = new Set<string>();

    const menuTree: MenuTreeState = {
      projectTree: [
        {
          k: 'unexpected',
          id: 'invalid-node-id',
          name: privateNodeName,
        } as any,
      ],
      tagTree: [],
    };

    const result = repairMenuTree(menuTree, validProjectIds, validTagIds);

    expect(result.projectTree).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[repair-menu-tree] Removed invalid node',
      jasmine.objectContaining({
        treeType: 'projectTree',
        nodeKind: 'unknown',
        hasNodeId: true,
      }),
    );

    const serializedLogArgs = JSON.stringify([
      ...logSpy.calls.allArgs(),
      ...warnSpy.calls.allArgs(),
    ]);
    expect(serializedLogArgs).not.toContain(privateNodeName);
    expect(serializedLogArgs).not.toContain('invalid-node-id');
  });
});
