import { createAction } from '@ngrx/store';
import { MenuTreeKind, MenuTreeTreeNode } from './menu-tree.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

type MenuTreeItemKind = MenuTreeKind.PROJECT | MenuTreeKind.TAG;

export const updateProjectTree = createAction(
  '[MenuTree] Update Project Tree',
  (treeProps: { tree: MenuTreeTreeNode[] }) => ({
    ...treeProps,
    meta: {
      isPersistent: true,
      entityType: 'MENU_TREE',
      entityId: 'projectTree',
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updateTagTree = createAction(
  '[MenuTree] Update Tag Tree',
  (treeProps: { tree: MenuTreeTreeNode[] }) => ({
    ...treeProps,
    meta: {
      isPersistent: true,
      entityType: 'MENU_TREE',
      entityId: 'tagTree',
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteFolder = createAction(
  '[MenuTree] Delete Folder',
  (folderProps: { folderId: string; treeType: MenuTreeItemKind }) => ({
    ...folderProps,
    meta: {
      isPersistent: true,
      entityType: 'MENU_TREE',
      entityId: folderProps.folderId,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const updateFolder = createAction(
  '[MenuTree] Update Folder',
  (folderProps: { folderId: string; name: string; treeType: MenuTreeItemKind }) => ({
    ...folderProps,
    meta: {
      isPersistent: true,
      entityType: 'MENU_TREE',
      entityId: folderProps.folderId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
