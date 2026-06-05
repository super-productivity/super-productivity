import { Injectable, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { Project } from '../project/project.model';
import { Tag } from '../tag/tag.model';
import { TODAY_TAG } from '../tag/tag.const';
import {
  MenuTreeFolderNode,
  MenuTreeKind,
  MenuTreeProjectNode,
  MenuTreeTagNode,
  MenuTreeTreeNode,
  MenuTreeViewFolderNode,
  MenuTreeViewNode,
  MenuTreeViewProjectNode,
  MenuTreeViewTagNode,
} from './store/menu-tree.model';
import {
  selectMenuTreeProjectTree,
  selectMenuTreeTagTree,
} from './store/menu-tree.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTags } from '../tag/store/tag.reducer';
import {
  updateProjectTree,
  updateTagTree,
  deleteFolder,
  updateFolder,
} from './store/menu-tree.actions';

@Injectable({ providedIn: 'root' })
export class MenuTreeService {
  private readonly _store = inject(Store);

  private readonly _projectTree = toSignal(
    this._store.select(selectMenuTreeProjectTree),
    {
      initialValue: [] as MenuTreeTreeNode[],
    },
  );
  private readonly _tagTree = toSignal(this._store.select(selectMenuTreeTagTree), {
    initialValue: [] as MenuTreeTreeNode[],
  });

  private readonly _allProjects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [] as Project[],
  });
  private readonly _allTags = toSignal(this._store.select(selectAllTags), {
    initialValue: [] as Tag[],
  });

  readonly projectTree = computed(() => this._projectTree());
  readonly tagTree = computed(() => this._tagTree());

  readonly projectFolderMap = computed(() => {
    const projects = this._allProjects().filter(
      (p) => !p.isArchived && !p.isHiddenFromMenu,
    );
    return this._buildFolderMap(projects, this.projectTree(), MenuTreeKind.PROJECT);
  });

  readonly tagFolderMap = computed(() => {
    const tags = this._allTags().filter((t) => t.id !== TODAY_TAG.id);
    return this._buildFolderMap(tags, this.tagTree(), MenuTreeKind.TAG);
  });

  private _buildFolderMap<T extends { id: string; title: string }>(
    entities: T[],
    tree: MenuTreeTreeNode[],
    kind: MenuTreeKind,
  ): Map<string, string> {
    const entityMap = new Map<string, T>();
    const titleCounts = new Map<string, number>();

    for (const item of entities) {
      entityMap.set(item.id, item);
      const title = item.title.trim().toLowerCase();
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }

    const folderMap = new Map<string, string>();
    const walk = (nodes: MenuTreeTreeNode[], path: string[] = []): void => {
      for (const node of nodes) {
        if (node.k === kind) {
          if (path.length > 0) {
            const item = entityMap.get(node.id);
            if (item) {
              const titleKey = item.title.trim().toLowerCase();
              if ((titleCounts.get(titleKey) || 0) > 1) {
                folderMap.set(node.id, path.join(' › '));
              }
            }
          }
        } else if (node.k === MenuTreeKind.FOLDER) {
          walk(node.children, [...path, node.name]);
        }
      }
    };
    walk(tree);
    return folderMap;
  }

  readonly projectFolders$ = this._store
    .select(selectMenuTreeProjectTree)
    .pipe(map((tree) => this._collectFolders(tree)));

  hasProjectTree(): boolean {
    return this.projectTree().length > 0;
  }

  hasTagTree(): boolean {
    return this.tagTree().length > 0;
  }

  initializeProjectTree(projects: Project[]): void {
    const tree = projects.map<MenuTreeProjectNode>((project) => ({
      k: MenuTreeKind.PROJECT,
      id: project.id,
      projectId: project.id,
    }));
    this.setProjectTree(tree);
  }

  initializeTagTree(tags: Tag[]): void {
    const tree = tags.map<MenuTreeTagNode>((tag) => ({
      k: MenuTreeKind.TAG,
      id: tag.id,
      tagId: tag.id,
    }));
    this.setTagTree(tree);
  }

  buildProjectViewTree(projects: Project[]): MenuTreeViewNode[] {
    return this._buildViewTree({
      storedTree: this.projectTree(),
      items: projects,
      getId: (project) => project.id,
      createViewNode: (project): MenuTreeViewProjectNode => ({
        k: MenuTreeKind.PROJECT,
        project,
      }),
      itemType: MenuTreeKind.PROJECT,
    });
  }

  buildTagViewTree(tags: Tag[]): MenuTreeViewNode[] {
    return this._buildViewTree({
      storedTree: this.tagTree(),
      items: tags,
      getId: (tag) => tag.id,
      createViewNode: (tag): MenuTreeViewTagNode => ({
        k: MenuTreeKind.TAG,
        tag,
      }),
      itemType: MenuTreeKind.TAG,
    });
  }

  setProjectTree(tree: MenuTreeTreeNode[]): void {
    this._store.dispatch(updateProjectTree({ tree }));
  }

  setTagTree(tree: MenuTreeTreeNode[]): void {
    this._store.dispatch(updateTagTree({ tree }));
  }

  persistProjectViewTree(viewNodes: MenuTreeViewNode[]): void {
    const stored = this._viewToStoredTree(viewNodes, MenuTreeKind.PROJECT);
    this.setProjectTree(stored);
  }

  persistTagViewTree(viewNodes: MenuTreeViewNode[]): void {
    const stored = this._viewToStoredTree(viewNodes, MenuTreeKind.TAG);
    this.setTagTree(stored);
  }

  createProjectFolder(name: string, parentFolderId?: string | null): void {
    this._createFolder({
      name,
      parentFolderId: parentFolderId ?? null,
      treeKind: MenuTreeKind.PROJECT,
    });
  }

  createTagFolder(name: string, parentFolderId?: string | null): void {
    this._createFolder({
      name,
      parentFolderId: parentFolderId ?? null,
      treeKind: MenuTreeKind.TAG,
    });
  }

  deleteFolderFromProject(folderId: string): void {
    this._store.dispatch(deleteFolder({ folderId, treeType: MenuTreeKind.PROJECT }));
  }

  deleteFolderFromTag(folderId: string): void {
    this._store.dispatch(deleteFolder({ folderId, treeType: MenuTreeKind.TAG }));
  }

  updateFolderInProject(folderId: string, name: string): void {
    this._store.dispatch(
      updateFolder({ folderId, name, treeType: MenuTreeKind.PROJECT }),
    );
  }

  updateFolderInTag(folderId: string, name: string): void {
    this._store.dispatch(updateFolder({ folderId, name, treeType: MenuTreeKind.TAG }));
  }

  findFolderInTree(
    folderId: string,
    tree: MenuTreeTreeNode[],
  ): MenuTreeFolderNode | null {
    for (const node of tree) {
      if (node.id === folderId && node.k === MenuTreeKind.FOLDER) {
        return node;
      }
      if (node.k === MenuTreeKind.FOLDER) {
        const found = this.findFolderInTree(folderId, node.children);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  private _buildViewTree<T extends { id: string }>(options: {
    storedTree: MenuTreeTreeNode[];
    items: T[];
    getId: (item: T) => string;
    createViewNode: (item: T) => MenuTreeViewNode;
    itemType: MenuTreeKind;
  }): MenuTreeViewNode[] {
    const { storedTree, items, getId, createViewNode, itemType } = options;
    const itemMap = new Map(items.map((item) => [getId(item), item]));
    const usedIds = new Set<string>();

    const mapNode = (node: MenuTreeTreeNode): MenuTreeViewNode | null => {
      if (node.k === MenuTreeKind.FOLDER) {
        const children = node.children
          .map((child) => mapNode(child))
          .filter((child): child is MenuTreeViewNode => child !== null);
        return {
          k: MenuTreeKind.FOLDER,
          id: node.id,
          name: node.name,
          isExpanded: node.isExpanded ?? true,
          children,
        } satisfies MenuTreeViewFolderNode;
      }

      if (itemType === MenuTreeKind.PROJECT && node.k === MenuTreeKind.PROJECT) {
        const project = itemMap.get(node.id);
        if (!project) {
          return null;
        }
        usedIds.add(node.id);
        return createViewNode(project) as MenuTreeViewProjectNode;
      }

      if (itemType === MenuTreeKind.TAG && node.k === MenuTreeKind.TAG) {
        const tag = itemMap.get(node.id);
        if (!tag) {
          return null;
        }
        usedIds.add(node.id);
        return createViewNode(tag) as MenuTreeViewTagNode;
      }

      return null;
    };

    const viewNodes = storedTree
      .map((node) => mapNode(node))
      .filter((node): node is MenuTreeViewNode => node !== null);

    // Append items missing from stored tree
    items.forEach((item) => {
      const id = getId(item);
      if (!usedIds.has(id)) {
        viewNodes.push(createViewNode(item));
      }
    });

    return viewNodes;
  }

  private _viewToStoredTree(
    nodes: MenuTreeViewNode[],
    itemType: MenuTreeKind,
  ): MenuTreeTreeNode[] {
    const mapNode = (node: MenuTreeViewNode): MenuTreeTreeNode | null => {
      if (node.k === MenuTreeKind.FOLDER) {
        const children = node.children
          .map((child) => mapNode(child))
          .filter((child): child is MenuTreeTreeNode => child !== null);
        return {
          k: MenuTreeKind.FOLDER,
          id: node.id,
          name: node.name,
          isExpanded: node.isExpanded,
          children,
        } satisfies MenuTreeFolderNode;
      }

      if (itemType === MenuTreeKind.PROJECT && node.k === MenuTreeKind.PROJECT) {
        return {
          k: MenuTreeKind.PROJECT,
          id: node.project.id,
        } satisfies MenuTreeProjectNode;
      }

      if (itemType === MenuTreeKind.TAG && node.k === MenuTreeKind.TAG) {
        return {
          k: MenuTreeKind.TAG,
          id: node.tag.id,
        } satisfies MenuTreeTagNode;
      }

      return null;
    };

    return nodes
      .map((node) => mapNode(node))
      .filter((node): node is MenuTreeTreeNode => node !== null);
  }

  private _collectFolders(
    nodes: MenuTreeTreeNode[],
  ): Array<{ id: string; name: string }> {
    const result: Array<{ id: string; name: string }> = [];
    const walk = (list: MenuTreeTreeNode[]): void => {
      list.forEach((node) => {
        if (node.k === MenuTreeKind.FOLDER) {
          result.push({ id: node.id, name: node.name });
          walk(node.children);
        }
      });
    };
    walk(nodes);
    return result;
  }

  private _insertFolderNode(
    tree: MenuTreeTreeNode[],
    folder: MenuTreeFolderNode,
    parentId: string | null,
  ): MenuTreeTreeNode[] {
    const cloned = this._cloneTree(tree);
    if (!parentId) {
      return [...cloned, folder];
    }

    const target = this._findFolder(cloned, parentId);
    if (!target) {
      return [...cloned, folder];
    }

    target.children = [...target.children, folder];
    target.isExpanded = true;
    return cloned;
  }

  private _cloneTree(tree: MenuTreeTreeNode[]): MenuTreeTreeNode[] {
    return tree.map((node) =>
      node.k === MenuTreeKind.FOLDER
        ? {
            k: MenuTreeKind.FOLDER,
            id: node.id,
            name: node.name,
            isExpanded: node.isExpanded,
            children: this._cloneTree(node.children),
          }
        : { ...node },
    );
  }

  private _findFolder(tree: MenuTreeTreeNode[], id: string): MenuTreeFolderNode | null {
    for (const node of tree) {
      if (node.k === MenuTreeKind.FOLDER) {
        if (node.id === id) {
          return node;
        }
        const childMatch = this._findFolder(node.children, id);
        if (childMatch) {
          return childMatch;
        }
      }
    }
    return null;
  }

  private _createFolderId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private _createFolder(options: {
    name: string;
    parentFolderId: string | null;
    treeKind: MenuTreeKind;
  }): void {
    const trimmed = options.name.trim();
    if (!trimmed) {
      return;
    }

    const newFolder: MenuTreeFolderNode = {
      k: MenuTreeKind.FOLDER,
      id: this._createFolderId(),
      name: trimmed,
      isExpanded: true,
      children: [],
    };

    const currentTree =
      options.treeKind === MenuTreeKind.PROJECT ? this.projectTree() : this.tagTree();
    const nextTree = this._insertFolderNode(
      currentTree,
      newFolder,
      options.parentFolderId,
    );

    if (options.treeKind === MenuTreeKind.PROJECT) {
      this.setProjectTree(nextTree);
    } else {
      this.setTagTree(nextTree);
    }
  }
}
