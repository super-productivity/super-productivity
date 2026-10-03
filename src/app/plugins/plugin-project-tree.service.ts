import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import typia from 'typia';
import { ProjectFolderMove, ProjectTreeNode } from '@super-productivity/plugin-api';
import { MenuTreeService } from '../features/menu-tree/menu-tree.service';
import {
  MenuTreeKind,
  MenuTreeTreeNode,
  MenuTreeViewNode,
} from '../features/menu-tree/store/menu-tree.model';
import { selectUnarchivedProjects } from '../features/project/store/project.selectors';
import { INBOX_PROJECT } from '../features/project/project.const';
import { Project } from '../features/project/project.model';

/**
 * Plugin access to the sidebar's project folders, which live in the menu tree
 * rather than on the project entity.
 */
@Injectable({ providedIn: 'root' })
export class PluginProjectTreeService {
  private _store = inject(Store);
  private _menuTreeService = inject(MenuTreeService);

  async getProjectTree(): Promise<ProjectTreeNode[]> {
    const projects = await this._getPlaceableProjects();
    return this._menuTreeService.buildProjectViewTree(projects).map(toPluginNode);
  }

  async moveProjectsToFolders(moves: ProjectFolderMove[]): Promise<void> {
    typia.assert<ProjectFolderMove[]>(moves);

    const projectIds = new Set((await this._getPlaceableProjects()).map((p) => p.id));
    const { folderIds, parentByProjectId } = indexTree(
      this._menuTreeService.projectTree(),
    );

    // Last move per project wins, matching what applying them in order would do.
    const targetByProjectId = new Map<string, string | null>();
    for (const { projectId, folderId } of moves) {
      if (!projectIds.has(projectId)) {
        throw new Error(`[PluginProjectTree] Unknown project id: ${projectId}`);
      }
      if (folderId !== null && !folderIds.has(folderId)) {
        throw new Error(`[PluginProjectTree] Unknown folder id: ${folderId}`);
      }
      targetByProjectId.set(projectId, folderId);
    }

    // Skip projects already in place so they keep their position. A project
    // missing from the stored tree is shown at the root.
    const effectiveMoves = [...targetByProjectId]
      .filter(
        ([projectId, folderId]) =>
          (parentByProjectId.get(projectId) ?? null) !== folderId,
      )
      .map(([projectId, folderId]) => ({ projectId, folderId }));

    this._menuTreeService.moveProjectsToFolders(effectiveMoves);
  }

  private async _getPlaceableProjects(): Promise<Project[]> {
    const projects = await firstValueFrom(this._store.select(selectUnarchivedProjects));
    return projects.filter((p) => p.id !== INBOX_PROJECT.id);
  }
}

const toPluginNode = (node: MenuTreeViewNode): ProjectTreeNode => {
  switch (node.k) {
    case MenuTreeKind.FOLDER:
      return {
        type: 'folder',
        id: node.id,
        name: node.name,
        isExpanded: node.isExpanded,
        children: node.children.map(toPluginNode),
      };
    case MenuTreeKind.PROJECT:
      return { type: 'project', id: node.project.id };
    default:
      throw new Error(`[PluginProjectTree] Unexpected node kind: ${node.k}`);
  }
};

const indexTree = (
  tree: MenuTreeTreeNode[],
): { folderIds: Set<string>; parentByProjectId: Map<string, string | null> } => {
  const folderIds = new Set<string>();
  const parentByProjectId = new Map<string, string | null>();
  const walk = (nodes: MenuTreeTreeNode[], parentId: string | null): void => {
    for (const node of nodes) {
      if (node.k === MenuTreeKind.FOLDER) {
        folderIds.add(node.id);
        walk(node.children, node.id);
      } else if (node.k === MenuTreeKind.PROJECT) {
        parentByProjectId.set(node.id, parentId);
      }
    }
  };
  walk(tree, null);
  return { folderIds, parentByProjectId };
};
