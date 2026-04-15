import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatMenuTrigger } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { LayoutService } from '../../layout/layout.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { TaskViewCustomizerPanelComponent } from '../../../features/task-view-customizer/task-view-customizer-panel/task-view-customizer-panel.component';
import { T } from '../../../t.const';
import { KeyboardConfig } from '../../../features/config/keyboard-config.model';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { Store } from '@ngrx/store';
import {
  selectActivePluginId,
  selectIsShowPluginPanel,
} from '../../layout/store/layout.reducer';
import { toSignal } from '@angular/core/rxjs-interop';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginIconComponent } from '../../../plugins/ui/plugin-icon/plugin-icon.component';
import { togglePluginPanel } from '../../layout/store/layout.actions';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { computed } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';

@Component({
  selector: 'mobile-side-panel-menu',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    TranslateModule,
    PluginIconComponent,
    TaskViewCustomizerPanelComponent,
  ],
  template: `
    <div class="mobile-dropdown-wrapper">
      <button
        (click)="toggleMenu()"
        mat-icon-button
        [matTooltip]="T.MH.SIDE_PANEL_MENU | translate"
      >
        <mat-icon>{{ isShowMobileMenu() ? 'close' : 'view_sidebar' }}</mat-icon>
      </button>

      <div
        class="mobile-dropdown"
        [class.isVisible]="isShowMobileMenu()"
      >
        <!-- Plugin buttons -->
        @for (button of sidePanelButtons(); track button.pluginId) {
          <button
            mat-mini-fab
            color=""
            [matTooltip]="button.label"
            (click)="onPluginButtonClick(button)"
            [class.active]="activePluginId() === button.pluginId && isShowPluginPanel()"
          >
            <plugin-icon
              [pluginId]="button.pluginId"
              [fallbackIcon]="button.icon || 'extension'"
            ></plugin-icon>
          </button>
        }

        <!-- Task View Customizer -->
        <button
          #customizerMenuTrigger="matMenuTrigger"
          mat-mini-fab
          color=""
          [class.isCustomized]="taskViewCustomizerService.isCustomized()"
          [disabled]="!isWorkViewPage()"
          [matMenuTriggerFor]="customizerPanel.menu"
          [matTooltip]="T.GCF.KEYBOARD.TOGGLE_TASK_VIEW_CUSTOMIZER_PANEL | translate"
        >
          <mat-icon>filter_list</mat-icon>
        </button>

        <task-view-customizer-panel #customizerPanel></task-view-customizer-panel>

        <!-- Issue Panel -->
        <button
          mat-mini-fab
          color=""
          class="e2e-toggle-issue-provider-panel"
          [class.active]="isShowIssuePanel()"
          [disabled]="!isRouteWithSidePanel()"
          (click)="toggleIssuePanel()"
          [matTooltip]="T.MH.TOGGLE_SHOW_ISSUE_PANEL | translate"
        >
          <mat-icon>webhook</mat-icon>
        </button>

        <!-- Notes -->
        <button
          mat-mini-fab
          color=""
          class="e2e-toggle-notes-btn"
          [class.active]="isShowNotes()"
          [disabled]="!isRouteWithSidePanel()"
          (click)="toggleNotes()"
          [matTooltip]="T.MH.TOGGLE_SHOW_NOTES | translate"
        >
          <mat-icon>comment</mat-icon>
        </button>
      </div>
    </div>
  `,
  styleUrls: ['./mobile-side-panel-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileSidePanelMenuComponent {
  readonly T = T;
  readonly layoutService = inject(LayoutService);
  readonly taskViewCustomizerService = inject(TaskViewCustomizerService);
  readonly breakpointObserver = inject(BreakpointObserver);

  private _globalConfigService = inject(GlobalConfigService);
  private _pluginBridge = inject(PluginBridgeService);
  private _store = inject(Store);
  private _router = inject(Router);

  // State signals
  readonly isShowMobileMenu = signal(false);

  // Convert observables to signals
  readonly isRouteWithSidePanel = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => true), // Always true since right-panel is now global
      startWith(true), // Always true since right-panel is now global
    ),
    { initialValue: true },
  );

  readonly isWorkViewPage = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => !!event.urlAfterRedirects.match(/tasks$/)),
      startWith(!!this._router.url.match(/tasks$/)),
    ),
    { initialValue: !!this._router.url.match(/tasks$/) },
  );

  readonly kb: KeyboardConfig = this._globalConfigService.cfg()?.keyboard || {};

  // Plugin-related signals
  readonly sidePanelButtons = this._pluginBridge.sidePanelButtons;
  readonly activePluginId = toSignal(this._store.select(selectActivePluginId));
  readonly isShowPluginPanel = toSignal(this._store.select(selectIsShowPluginPanel));

  // Navigation signals
  readonly currentRoute = toSignal(
    this._router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this._router.url),
    ),
    { initialValue: this._router.url },
  );

  readonly isWorkView = computed(() => {
    const url = this.currentRoute();
    return url.includes('/active/') || url.includes('/tag/') || url.includes('/project/');
  });

  // Panel state signals
  readonly isShowNotes = computed(() => this.layoutService.isShowNotes());
  readonly isShowIssuePanel = computed(() => this.layoutService.isShowIssuePanel());
  readonly isShowTaskViewCustomizerPanel = computed(() =>
    this.layoutService.isShowTaskViewCustomizerPanel(),
  );
  readonly customizerMenuTrigger = viewChild('customizerMenuTrigger', {
    read: MatMenuTrigger,
  });

  // Computed signal for active panel
  readonly hasActivePanel = computed(() => {
    return !!(
      this.isShowNotes() ||
      this.isShowIssuePanel() ||
      this.isShowTaskViewCustomizerPanel() ||
      (this.activePluginId() && this.isShowPluginPanel())
    );
  });

  constructor() {
    effect(() => {
      const trigger = this.layoutService.openTaskViewCustomizerTrigger();
      if (trigger > 0 && this.isWorkViewPage()) {
        this.isShowMobileMenu.set(true);
        this.customizerMenuTrigger()?.openMenu();
      }
    });
  }

  toggleMenu(): void {
    this.isShowMobileMenu.update((v) => !v);
  }

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

    // Close mobile menu after action
    this.isShowMobileMenu.set(false);
  }

  toggleIssuePanel(): void {
    this.layoutService.toggleAddTaskPanel();
    this.isShowMobileMenu.set(false);
  }

  toggleNotes(): void {
    this.layoutService.toggleNotes();
    this.isShowMobileMenu.set(false);
  }
}
