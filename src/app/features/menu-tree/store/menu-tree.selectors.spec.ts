import {
  selectMenuTreeState,
  selectMenuTreeProjectTree,
  selectMenuTreeTagTree,
} from './menu-tree.selectors';
import { MenuTreeKind, MenuTreeState, MenuTreeTreeNode } from './menu-tree.model';
import { menuTreeInitialState } from './menu-tree.reducer';

describe('MenuTree Selectors', () => {
  const createProjectNode = (id: string): MenuTreeTreeNode => ({
    k: MenuTreeKind.PROJECT,
    id,
  });

  const createTagNode = (id: string): MenuTreeTreeNode => ({
    k: MenuTreeKind.TAG,
    id,
  });

  const createFolderNode = (
    id: string,
    name: string,
    children: MenuTreeTreeNode[] = [],
  ): MenuTreeTreeNode => ({
    k: MenuTreeKind.FOLDER,
    id,
    name,
    children,
    isExpanded: false,
  });

  describe('selectMenuTreeState', () => {
    it('should return the initial state when empty', () => {
      const state = { menuTree: menuTreeInitialState };

      const result = selectMenuTreeState(state);

      expect(result).toEqual(menuTreeInitialState);
      expect(result.projectTree).toEqual([]);
      expect(result.tagTree).toEqual([]);
    });

    it('should return the full menuTree state', () => {
      const menuTreeState: MenuTreeState = {
        projectTree: [createProjectNode('project-1'), createProjectNode('project-2')],
        tagTree: [createTagNode('tag-1')],
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeState(state);

      expect(result).toBe(menuTreeState);
      expect(result.projectTree.length).toBe(2);
      expect(result.tagTree.length).toBe(1);
    });

    it('should return state with nested folder structure', () => {
      const nestedFolder = createFolderNode('folder-nested', 'Nested', [
        createProjectNode('project-nested'),
      ]);
      const menuTreeState: MenuTreeState = {
        projectTree: [
          createFolderNode('folder-1', 'My Folder', [
            createProjectNode('project-1'),
            nestedFolder,
          ]),
        ],
        tagTree: [],
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeState(state);

      expect(result.projectTree.length).toBe(1);
      expect(result.projectTree[0].k).toBe(MenuTreeKind.FOLDER);
    });
  });

  describe('selectMenuTreeProjectTree', () => {
    it('should return empty array for initial state', () => {
      const state = { menuTree: menuTreeInitialState };

      const result = selectMenuTreeProjectTree(state);

      expect(result).toEqual([]);
    });

    it('should return only the projectTree', () => {
      const projectTree: MenuTreeTreeNode[] = [
        createProjectNode('project-1'),
        createProjectNode('project-2'),
      ];
      const menuTreeState: MenuTreeState = {
        projectTree,
        tagTree: [createTagNode('tag-1')],
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeProjectTree(state);

      expect(result).toBe(projectTree);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('project-1');
      expect(result[1].id).toBe('project-2');
    });

    it('should return projectTree with folders', () => {
      const projectTree: MenuTreeTreeNode[] = [
        createFolderNode('folder-1', 'Work', [
          createProjectNode('project-1'),
          createProjectNode('project-2'),
        ]),
        createProjectNode('project-3'),
      ];
      const menuTreeState: MenuTreeState = {
        projectTree,
        tagTree: [],
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeProjectTree(state);

      expect(result.length).toBe(2);
      expect(result[0].k).toBe(MenuTreeKind.FOLDER);
      expect(result[1].k).toBe(MenuTreeKind.PROJECT);
    });
  });

  describe('selectMenuTreeTagTree', () => {
    it('should return empty array for initial state', () => {
      const state = { menuTree: menuTreeInitialState };

      const result = selectMenuTreeTagTree(state);

      expect(result).toEqual([]);
    });

    it('should return only the tagTree', () => {
      const tagTree: MenuTreeTreeNode[] = [
        createTagNode('tag-1'),
        createTagNode('tag-2'),
        createTagNode('tag-3'),
      ];
      const menuTreeState: MenuTreeState = {
        projectTree: [createProjectNode('project-1')],
        tagTree,
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeTagTree(state);

      expect(result).toBe(tagTree);
      expect(result.length).toBe(3);
      expect(result[0].id).toBe('tag-1');
      expect(result[1].id).toBe('tag-2');
      expect(result[2].id).toBe('tag-3');
    });

    it('should return tagTree with folders', () => {
      const tagTree: MenuTreeTreeNode[] = [
        createFolderNode('folder-tags', 'Priority Tags', [
          createTagNode('tag-urgent'),
          createTagNode('tag-important'),
        ]),
        createTagNode('tag-misc'),
      ];
      const menuTreeState: MenuTreeState = {
        projectTree: [],
        tagTree,
      };
      const state = { menuTree: menuTreeState };

      const result = selectMenuTreeTagTree(state);

      expect(result.length).toBe(2);
      expect(result[0].k).toBe(MenuTreeKind.FOLDER);
      expect(result[1].k).toBe(MenuTreeKind.TAG);
    });
  });
});
