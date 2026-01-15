import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { TreeDndComponent } from '../../../ui/tree-dnd/tree.component';
import { TreeNode } from '../../../ui/tree-dnd/tree.types';
import { NavItemComponent } from '../nav-item/nav-item.component';
import { NavItem, NavTreeItem } from '../magic-side-nav.model';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { T } from '../../../t.const';
import {
  MenuTreeKind,
  MenuTreeViewFolderNode,
  MenuTreeViewNode,
  MenuTreeViewProjectNode,
  MenuTreeViewTagNode,
} from '../../../features/menu-tree/store/menu-tree.model';
import { MenuTreeService } from '../../../features/menu-tree/menu-tree.service';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { DEFAULT_PROJECT_ICON } from '../../../features/project/project.const';
import { expandCollapseAni } from '../../../ui/tree-dnd/tree.animations';

@Component({
  selector: 'nav-list-tree',
  standalone: true,
  imports: [
    CommonModule,
    NgStyle,
    MatIcon,
    MatIconButton,
    MatTooltip,
    MatMenuModule,
    TranslatePipe,
    TreeDndComponent,
    NavItemComponent,
  ],
  templateUrl: './nav-list-tree.component.html',
  styleUrls: ['./nav-list-tree.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandCollapseAni],
})
export class NavListTreeComponent {
  private readonly _navConfigService = inject(MagicNavConfigService);
  private readonly _menuTreeService = inject(MenuTreeService);

  item = input.required<NavTreeItem>();
  showLabels = input<boolean>(true);
  isExpanded = input<boolean>(false);
  activeWorkContextId = input<string | null>(null);

  itemClick = output<NavItem>();

  readonly T = T;
  readonly WorkContextType = WorkContextType;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;
  readonly MenuTreeKind = MenuTreeKind;

  // Access to service methods and data for visibility menu (includes Inbox for unhiding)
  readonly allUnarchivedProjects = this._navConfigService.allUnarchivedProjects;

  // ViewChild for visibility menu trigger to close menu after toggling
  visibilityMenuTrigger = viewChild('visibilityBtn', { read: MatMenuTrigger });

  readonly treeNodes = signal<TreeNode<MenuTreeViewNode>[]>([]);
  readonly treeKind = computed<MenuTreeKind>(() => this.item().treeKind);

  constructor() {
    effect(() => {
      const nodes = this.item().tree;
      this.treeNodes.set(nodes.map((node) => this._toTreeNode(node)));
    });
  }

  onHeaderClick(): void {
    this.itemClick.emit(this.item());
  }

  onChildClick(node: TreeNode<MenuTreeViewNode>): void {
    const data = node.data;
    if (!data) return;

    if (data.k === MenuTreeKind.FOLDER) {
      this._toggleFolder(node.id);
      return;
    }

    if (data.k === MenuTreeKind.PROJECT) {
      this.itemClick.emit(this._toProjectNavItem(data));
      return;
    }

    if (data.k === MenuTreeKind.TAG) {
      this.itemClick.emit(this._toTagNavItem(data));
    }
  }

  onTreeUpdated(updatedNodes: TreeNode<MenuTreeViewNode>[]): void {
    this.treeNodes.set(updatedNodes);
    this._persistCurrentTree();
  }

  toggleProjectVisibility(projectId: string): void {
    this._navConfigService.toggleProjectVisibility(projectId);
    // Close menu to prevent stale positioning after DOM update (#5955)
    this.visibilityMenuTrigger()?.closeMenu();
  }

  onFolderMoreButton(event: MouseEvent, node: TreeNode<MenuTreeViewNode>): void {
    event.preventDefault();
    event.stopPropagation();
    this._openFolderContextMenu(event, node);
  }

  onFolderContextMenu(event: MouseEvent, node: TreeNode<MenuTreeViewNode>): void {
    event.preventDefault();
    event.stopPropagation();
    this._openFolderContextMenu(event, node);
  }

  private _openFolderContextMenu(
    event: MouseEvent,
    node: TreeNode<MenuTreeViewNode>,
  ): void {
    // TODO: Implement folder context menu
    console.log(
      'Folder context menu for:',
      node.data?.k === MenuTreeKind.FOLDER ? node.data.name : 'unknown',
    );
  }

  private _toggleFolder(treeNodeId: string): void {
    const updated = this._mapTreeNodes(this.treeNodes(), (node) => {
      if (node.id === treeNodeId) {
        const isExpanded = !(node.expanded ?? true);
        return {
          ...node,
          expanded: isExpanded,
          data:
            node.data?.k === MenuTreeKind.FOLDER
              ? { ...node.data, isExpanded }
              : node.data,
        };
      }
      return node;
    });
    this.treeNodes.set(updated);
    this._persistCurrentTree();
  }

  private _persistCurrentTree(): void {
    const viewTree = this._treeNodesToViewNodes(this.treeNodes());
    if (this.item().id === 'projects') {
      this._menuTreeService.persistProjectViewTree(viewTree);
    } else if (this.item().id === 'tags') {
      this._menuTreeService.persistTagViewTree(viewTree);
    }
  }

  private _toTreeNode(node: MenuTreeViewNode): TreeNode<MenuTreeViewNode> {
    if (node.k === MenuTreeKind.FOLDER) {
      const children = node.children.map((child) => this._toTreeNode(child));
      // Always expand empty folders
      const shouldExpand = children.length === 0 ? true : node.isExpanded;

      return {
        id: `folder-${node.id}`,
        isFolder: true,
        expanded: shouldExpand,
        data: node,
        children,
      } satisfies TreeNode<MenuTreeViewNode>;
    }
    if (node.k === MenuTreeKind.PROJECT) {
      return {
        id: `project-${node.project.id}`,
        isFolder: false,
        data: node,
      } satisfies TreeNode<MenuTreeViewNode>;
    }
    return {
      id: `tag-${node.tag.id}`,
      isFolder: false,
      data: node,
    } satisfies TreeNode<MenuTreeViewNode>;
  }

  private _treeNodesToViewNodes(nodes: TreeNode<MenuTreeViewNode>[]): MenuTreeViewNode[] {
    return nodes
      .map((node) => {
        const data = node.data;
        if (!data) {
          return null;
        }
        if (data.k === MenuTreeKind.FOLDER) {
          return {
            k: MenuTreeKind.FOLDER,
            id: data.id,
            name: data.name,
            isExpanded: node.expanded ?? data.isExpanded,
            children: this._treeNodesToViewNodes(node.children ?? []),
          } satisfies MenuTreeViewFolderNode;
        }
        if (data.k === MenuTreeKind.PROJECT) {
          return data satisfies MenuTreeViewProjectNode;
        }
        return data satisfies MenuTreeViewTagNode;
      })
      .filter((node): node is MenuTreeViewNode => node !== null);
  }

  private _mapTreeNodes(
    nodes: TreeNode<MenuTreeViewNode>[],
    updater: (node: TreeNode<MenuTreeViewNode>) => TreeNode<MenuTreeViewNode>,
  ): TreeNode<MenuTreeViewNode>[] {
    return nodes.map((node) => {
      const base: TreeNode<MenuTreeViewNode> = {
        ...node,
        children: node.children ? this._mapTreeNodes(node.children, updater) : undefined,
      };
      return updater(base);
    });
  }

  private _toProjectNavItem(node: MenuTreeViewProjectNode): NavItem {
    const project = node.project;
    const icon = project.icon || DEFAULT_PROJECT_ICON;
    return {
      type: 'workContext',
      id: `project-${project.id}`,
      label: project.title,
      icon,
      route: `/project/${project.id}/tasks`,
      workContext: project,
      workContextType: WorkContextType.PROJECT,
      defaultIcon: icon,
    } as NavItem;
  }

  private _toTagNavItem(node: MenuTreeViewTagNode): NavItem {
    const tag = node.tag;
    const icon = tag.icon || 'label';
    return {
      type: 'workContext',
      id: `tag-${tag.id}`,
      label: tag.title,
      icon,
      route: `/tag/${tag.id}/tasks`,
      workContext: tag,
      workContextType: WorkContextType.TAG,
      defaultIcon: icon,
    } as NavItem;
  }
}
