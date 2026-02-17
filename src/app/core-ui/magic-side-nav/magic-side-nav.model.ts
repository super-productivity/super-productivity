import {
  WorkContextCommon,
  WorkContextType,
} from '../../features/work-context/work-context.model';
import {
  MenuTreeKind,
  MenuTreeViewNode,
} from '../../features/menu-tree/store/menu-tree.model';
import { AppFeaturesConfig } from '../../features/config/global-config.model';

export type NavItem =
  | NavSeparatorItem
  | NavWorkContextItem
  | NavRouteItem
  | NavHrefItem
  | NavActionItem
  | NavTreeItem
  | NavMenuItem
  | NavPluginItem;

export interface NavBaseItem {
  id: string;
  label?: string;
  icon?: string;
  svgIcon?: string;
  tourClass?: string;
  featureConfigKey?: keyof AppFeaturesConfig;
}

export interface NavSeparatorItem extends NavBaseItem {
  type: 'separator';
  mtAuto?: true;
}

export interface NavWorkContextItem extends NavBaseItem {
  type: 'workContext';
  label: string;
  icon: string;
  route: string;
  workContext: WorkContextCommon;
  workContextType: WorkContextType;
  defaultIcon: string;
}

export interface NavRouteItem extends NavBaseItem {
  type: 'route';
  label: string;
  icon: string;
  route: string;
}

export interface NavHrefItem extends NavBaseItem {
  type: 'href';
  label: string;
  icon: string;
  href: string;
}

export interface NavActionItem extends NavBaseItem {
  type: 'action';
  label: string;
  icon: string;
  action: () => void;
}

export interface NavContextItem {
  id: string;
  label: string;
  icon: string;
  svgIcon?: string;
  action?: () => void;
}

export interface NavTreeItem extends NavBaseItem {
  type: 'tree';
  label: string;
  icon: string;
  treeKind: MenuTreeKind;
  additionalButtons?: NavAdditionalButton[];
  contextMenuItems?: NavContextItem[];
  action?: () => void; // optional external toggle logic
  tree: MenuTreeViewNode[];
}

export interface NavMenuItem extends NavBaseItem {
  type: 'menu';
  label: string;
  icon: string;
  children: NavItem[];
}

export interface NavPluginItem extends NavBaseItem {
  type: 'plugin';
  label: string;
  icon: string;
  pluginId: string;
  action: () => void;
}

export interface NavAdditionalButton {
  id: string;
  icon: string;
  tooltip?: string;
  action?: () => void;
  hidden?: boolean;
  contextMenu?: NavContextItem[];
}
export interface NavConfig {
  items: NavItem[];
  fullModeByDefault: boolean;
  showLabels: boolean;
  mobileBreakpoint: number;
  resizable: boolean;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  collapseThreshold: number;
  expandThreshold: number;
}
