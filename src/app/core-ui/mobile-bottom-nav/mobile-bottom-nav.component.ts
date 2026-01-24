import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import { LayoutService } from '../layout/layout.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { PluginIconComponent } from '../../plugins/ui/plugin-icon/plugin-icon.component';
import { Store } from '@ngrx/store';
import { togglePluginPanel } from '../layout/store/layout.actions';
import {
  selectActivePluginId,
  selectIsShowPluginPanel,
} from '../layout/store/layout.reducer';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { T } from '../../t.const';
import { WorkContextService } from '../../features/work-context/work-context.service';

@Component({
  selector: 'mobile-bottom-nav',
  standalone: true,
  imports: [
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    TranslateModule,
    PluginIconComponent,
  ],
  templateUrl: './mobile-bottom-nav.component.html',
  styleUrls: ['./mobile-bottom-nav.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNavComponent {
  private readonly _router = inject(Router);
  private readonly _layoutService = inject(LayoutService);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _store = inject(Store);
  private readonly _workContextService = inject(WorkContextService);

  readonly T = T;
  readonly TODAY_TAG = TODAY_TAG;
  readonly todayTagId = TODAY_TAG.id;
  readonly todayRoute = `/tag/${TODAY_TAG.id}/tasks`;

  // Services for template access
  readonly layoutService = this._layoutService;

  // Output events
  toggleMobileNavEvent = output<void>();

  // Plugin-related signals
  readonly sidePanelButtons = this._pluginBridge.sidePanelButtons;
  readonly activePluginId = toSignal(this._store.select(selectActivePluginId));
  readonly isShowPluginPanel = toSignal(this._store.select(selectIsShowPluginPanel));
  readonly hasProjectBacklog = toSignal(
    this._workContextService.activeWorkContext$.pipe(map((ac) => ac.isEnableBacklog)),
  );

  // Route-based computed properties
  readonly isRouteWithSidePanel = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => true), // Always true since right-panel is now global
      startWith(true), // Always true since right-panel is now global
    ),
    { initialValue: true },
  );

  // Panel state signals from layout service
  readonly isShowNotes = this._layoutService.isShowNotes;
  readonly isShowIssuePanel = this._layoutService.isShowIssuePanel;

  // Navigation methods
  showAddTaskBar(): void {
    this._layoutService.showAddTaskBar();
  }

  toggleMobileNav(): void {
    this.toggleMobileNavEvent.emit();
  }

  // Panel methods
  onPluginButtonClick(button: {
    pluginId: string;
    onClick?: () => void;
    label?: string;
    icon?: string;
  }): void {
    this._store.dispatch(togglePluginPanel(button.pluginId));

    if (button.onClick) {
      button.onClick();
    }
  }

  toggleIssuePanel(): void {
    this._layoutService.toggleAddTaskPanel();
  }

  toggleNotes(): void {
    this._layoutService.toggleNotes();
  }
}
