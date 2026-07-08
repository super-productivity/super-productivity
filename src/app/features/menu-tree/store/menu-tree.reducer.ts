import { createReducer, on } from '@ngrx/store';
import { MenuTreeKind, MenuTreeState, MenuTreeTreeNode } from './menu-tree.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import {
  updateProjectTree,
  updateTagTree,
  deleteFolder,
  updateFolder,
} from './menu-tree.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { addTag, deleteTag, deleteTags } from '../../tag/store/tag.actions';

export const menuTreeFeatureKey = 'menuTree';

export const menuTreeInitialState: MenuTreeState = {
  projectTree: [],
  tagTree: [],
};

const _sanitizeTree = (tree: unknown): MenuTreeTreeNode[] =>
  Array.isArray(tree) ? (tree as MenuTreeTreeNode[]) : [];

const _deleteFolderFromTree = (
  tree: MenuTreeTreeNode[],
  folderId: string,
): MenuTreeTreeNode[] => {
  return tree
    .filter((node) => node.id !== folderId)
    .map((node) => {
      if (node.k === MenuTreeKind.FOLDER) {
        return {
          ...node,
          children: _deleteFolderFromTree(node.children, folderId),
        };
      }
      return node;
    });
};

const _updateFolderInTree = (
  tree: MenuTreeTreeNode[],
  folderId: string,
  name: string,
): MenuTreeTreeNode[] => {
  return tree.map((node) => {
    if (node.id === folderId && node.k === MenuTreeKind.FOLDER) {
      return {
        ...node,
        name,
      };
    }
    if (node.k === MenuTreeKind.FOLDER) {
      return {
        ...node,
        children: _updateFolderInTree(node.children, folderId, name),
      };
    }
    return node;
  });
};

const _deleteItemFromTree = (
  tree: MenuTreeTreeNode[],
  itemId: string,
  itemKind: MenuTreeKind.PROJECT | MenuTreeKind.TAG,
): MenuTreeTreeNode[] => {
  const _walk = (nodes: MenuTreeTreeNode[]): readonly [MenuTreeTreeNode[], boolean] => {
    let hasChanged = false;
    const nextNodes: MenuTreeTreeNode[] = [];

    for (const node of nodes) {
      if (node.k === itemKind && node.id === itemId) {
        hasChanged = true;
        continue;
      }

      if (node.k === MenuTreeKind.FOLDER) {
        const [children, childChanged] = _walk(node.children);
        if (childChanged) {
          hasChanged = true;
          nextNodes.push({
            ...node,
            children,
          });
        } else {
          nextNodes.push(node);
        }
        continue;
      }

      nextNodes.push(node);
    }

    if (!hasChanged) {
      return [nodes, false] as const;
    }
    return [nextNodes, true] as const;
  };

  const [nextTree, hasChanged] = _walk(tree);
  return hasChanged ? nextTree : tree;
};

const _deleteItemsFromTree = (
  tree: MenuTreeTreeNode[],
  itemIds: string[],
  itemKind: MenuTreeKind.PROJECT | MenuTreeKind.TAG,
): MenuTreeTreeNode[] => {
  return itemIds.reduce((acc, id) => _deleteItemFromTree(acc, id, itemKind), tree);
};

const _itemExistsInTree = (
  tree: MenuTreeTreeNode[],
  itemId: string,
  itemKind: MenuTreeKind.PROJECT | MenuTreeKind.TAG,
): boolean => {
  for (const node of tree) {
    if (node.k === itemKind && node.id === itemId) {
      return true;
    }
    if (node.k === MenuTreeKind.FOLDER) {
      if (_itemExistsInTree(node.children, itemId, itemKind)) {
        return true;
      }
    }
  }
  return false;
};

export const menuTreeReducer = createReducer(
  menuTreeInitialState,
  on(loadAllData, (_state, { appDataComplete }) => {
    const stored =
      appDataComplete && typeof appDataComplete === 'object'
        ? ((appDataComplete as Record<string, unknown>).menuTree as
            | MenuTreeState
            | undefined)
        : undefined;
    if (!stored) {
      return menuTreeInitialState;
    }
    return {
      projectTree: _sanitizeTree(stored.projectTree),
      tagTree: _sanitizeTree(stored.tagTree),
    } satisfies MenuTreeState;
  }),
  on(updateProjectTree, (state, { tree }) => ({
    ...state,
    projectTree: tree,
  })),
  on(updateTagTree, (state, { tree }) => ({
    ...state,
    tagTree: tree,
  })),
  on(deleteFolder, (state, { folderId, treeType }) => ({
    ...state,
    projectTree:
      treeType === MenuTreeKind.PROJECT
        ? _deleteFolderFromTree(state.projectTree, folderId)
        : state.projectTree,
    tagTree:
      treeType === MenuTreeKind.TAG
        ? _deleteFolderFromTree(state.tagTree, folderId)
        : state.tagTree,
  })),
  on(updateFolder, (state, { folderId, name, treeType }) => ({
    ...state,
    projectTree:
      treeType === MenuTreeKind.PROJECT
        ? _updateFolderInTree(state.projectTree, folderId, name)
        : state.projectTree,
    tagTree:
      treeType === MenuTreeKind.TAG
        ? _updateFolderInTree(state.tagTree, folderId, name)
        : state.tagTree,
  })),
  on(TaskSharedActions.deleteProject, (state, { projectId }) => ({
    ...state,
    projectTree: _deleteItemFromTree(state.projectTree, projectId, MenuTreeKind.PROJECT),
  })),
  on(deleteTag, (state, { id }) => ({
    ...state,
    tagTree: _deleteItemFromTree(state.tagTree, id, MenuTreeKind.TAG),
  })),
  on(deleteTags, (state, { ids }) => ({
    ...state,
    tagTree: _deleteItemsFromTree(state.tagTree, ids, MenuTreeKind.TAG),
  })),
  on(addTag, (state, { tag }) => {
    // Only add to tree if tag doesn't already exist
    if (_itemExistsInTree(state.tagTree, tag.id, MenuTreeKind.TAG)) {
      return state;
    }
    return {
      ...state,
      tagTree: [
        ...state.tagTree,
        {
          k: MenuTreeKind.TAG as const,
          id: tag.id,
        },
      ],
    };
  }),
);
