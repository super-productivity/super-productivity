import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink, RouterModule } from '@angular/router';

import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import {
  WorkContextCommon,
  WorkContextType,
} from '../../../features/work-context/work-context.model';
import { Project } from '../../../features/project/project.model';
import { Tag } from '../../../features/tag/tag.model';
import { DEFAULT_PROJECT_ICON } from '../../../features/project/project.const';
import { AppFeaturesConfig } from '../../../features/config/global-config.model';
import { WorkContextMenuComponent } from '../../work-context-menu/work-context-menu.component';
import { FolderContextMenuComponent } from '../../folder-context-menu/folder-context-menu.component';
import { ContextMenuComponent } from '../../../ui/context-menu/context-menu.component';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { CdkDragPlaceholder } from '@angular/cdk/drag-drop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuItem, MatMenuModule } from '@angular/material/menu';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectAllDoneIds } from '../../../features/tasks/store/task.selectors';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { isSingleEmoji } from '../../../util/extract-first-emoji';
import { MenuTreeKind } from '../../../features/menu-tree/store/menu-tree.model';
import { PluginIconComponent } from '../../../plugins/ui/plugin-icon/plugin-icon.component';

@Component({
  selector: 'nav-item',
  imports: [
    RouterLink,
    RouterModule,
    WorkContextMenuComponent,
    FolderContextMenuComponent,
    ContextMenuComponent,
    CdkDragPlaceholder,
    MatIconButton,
    MatIcon,
    MatMenuItem,
    MatMenuModule,
    TranslatePipe,
    PluginIconComponent,
  ],
  templateUrl: './nav-item.component.html',
  styleUrl: './nav-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'g-multi-btn-wrapper',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.hasTasks]': 'workContextHasTasks()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.isActiveContext]': 'isActiveContext()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.isHidden]': 'isHidden()',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[class.variant-nav]': "variant() === 'nav'",
  },
  standalone: true,
})
export class NavItemComponent {
  readonly T = T;
  private readonly _globalThemeService = inject(GlobalThemeService);
  private readonly _navConfigService = inject(MagicNavConfigService);
  private readonly _translateService = inject(TranslateService);
  private readonly _iconRegistrationEffect = effect(() => {
    const svgUrl = this.svgIcon();
    if (svgUrl && svgUrl.startsWith('assets/')) {
      const iconName = this._generateIconName(svgUrl);
      this._globalThemeService.registerSvgIcon(iconName, svgUrl);
    }
  });
  private readonly _store = inject(Store);
  private static readonly _registeredIcons = new Set<string>();

  mode = input<'work' | 'folder' | 'row'>('work');
  variant = input<'default' | 'nav'>('default');
  container = input<'route' | 'href' | 'action' | 'group' | null>(null);

  navRoute = input<string | any[] | undefined>(undefined);
  navHref = input<string | undefined>(undefined);
  expanded = input<boolean>(false);

  ariaControls = input<string | null>(null);
  // Work context inputs
  workContext = input<WorkContextCommon | null>(null);
  type = input<WorkContextType | null>(null);
  defaultIcon = input<string>(DEFAULT_PROJECT_ICON);

  activeWorkContextId = input<string>('');
  // Folder inputs

  folderId = input<string | null>(null);
  treeKind = input<MenuTreeKind>(MenuTreeKind.PROJECT);
  // Variant styling to integrate into magic-side-nav without deep selectors
  showMoreButton = input<boolean>(true);

  // Presentational row inputs
  label = input<string | undefined>(undefined);
  icon = input<string | undefined>(undefined);
  svgIcon = input<string | undefined>(undefined);
  showLabels = input<boolean>(true);
  // Optional: menu trigger for dropdown
  menuTriggerFor = input<any | null>(null);

  // Tour class for Shepherd.js guide
  tourClass = input<string | null>(null);

  // Feature flag key for disable-feature context menu
  featureConfigKey = input<keyof AppFeaturesConfig | undefined>(undefined);

  // Events
  clicked = output<void>();

  private readonly _allDoneTaskIds = toSignal(this._store.select(selectAllDoneIds), {
    initialValue: [],
  });

  // Memoized computation for better performance
  nrOfOpenTasks = computed<number>(() => {
    const wc = this.workContext();
    if (!wc || wc.taskIds.length === 0) return 0;

    const allDoneTaskIds = this._allDoneTaskIds();
    const undoneTaskCount = wc.taskIds.filter(
      (tid) => !allDoneTaskIds.includes(tid),
    ).length;
    return undoneTaskCount;
  });

  workContextHasTasks = computed<boolean>(() => {
    const wc = this.workContext();
    return !!wc && wc.taskIds.length > 0;
  });

  isActiveContext = computed<boolean>(() => {
    const wc = this.workContext();
    return !!wc && wc.id === this.activeWorkContextId();
  });

  isHidden = computed<boolean>(() => {
    const wc = this.workContext();
    return !!(wc as Project | null)?.isHiddenFromMenu;
  });

  // Emoji detection for work context icons
  isWorkContextEmojiIcon = computed<boolean>(() => {
    const wc = this.workContext();
    if (!wc) return false;
    const icon = wc.icon || this.defaultIcon();
    return isSingleEmoji(icon);
  });

  workContextIconColor = computed<string | null>(() => {
    if (this.mode() !== 'work') {
      return null;
    }
    const wc = this.workContext();
    const wcType = this.type();
    if (!wc || !wcType) {
      return null;
    }
    const defaultIcon = this.defaultIcon();
    if (defaultIcon === 'today' || defaultIcon === 'inbox') {
      return null;
    }
    const themeColor = wc.theme?.primary;
    if (themeColor) {
      return themeColor;
    }

    if (wcType === WorkContextType.TAG) {
      const tag = wc as Tag;
      return tag.color || null;
    }
    return null;
  });

  // Emoji detection for presentational icons
  isPresentationalEmojiIcon = computed<boolean>(() => {
    const iconValue = this.icon();
    return iconValue ? isSingleEmoji(iconValue) : false;
  });

  private _generateIconName(svgUrl: string): string {
    const match = svgUrl.match(/bundled-plugins\/([^\/]+)\/([^\/]+\.svg)$/);
    if (match) {
      const pluginId = match[1];
      const fileName = match[2].replace('.svg', '');
      return `plugin-${pluginId}-${fileName}`;
    }
    return svgUrl.replace(/\//g, '_').replace(/\.svg$/, '');
  }

  namedSvgIcon = computed<string | undefined>(() => {
    const svgUrl = this.svgIcon();
    if (!svgUrl) return undefined;

    // If it starts with 'assets/', generate a name and register it
    if (svgUrl.startsWith('assets/')) {
      return this._generateIconName(svgUrl);
    }

    // Otherwise, assume it's already a registered icon name (e.g., for custom plugins)
    return svgUrl;
  });

  // Extract plugin ID from custom plugin icon name (pattern: plugin-${pluginId}-icon)
  customPluginId = computed<string | null>(() => {
    const svgUrl = this.svgIcon();
    if (!svgUrl) return null;

    const match = svgUrl.match(/^plugin-(.+)-icon$/);
    return match ? match[1] : null;
  });

  disableFeature(): void {
    const key = this.featureConfigKey();
    if (!key) return;
    const labelKey = this.label();
    const translatedLabel = labelKey ? this._translateService.instant(labelKey) : '';
    this._navConfigService.disableFeature(key, translatedLabel);
  }
}
