import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';

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
import { GlobalConfigService } from '../../features/config/global-config.service';
import { LongPressDirective } from '../../ui/longpress/longpress.directive';
import { performHapticFeedback } from '../../util/haptic-feedback';
import {
  BottomNavSlotOption,
  getAvailableBottomNavSlotOptions,
  isBottomNavSlotActive,
  readStoredBottomNavSlot,
  resolveBottomNavSlot,
  writeStoredBottomNavSlot,
} from './mobile-bottom-nav-slot';

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
    LongPressDirective,
  ],
  templateUrl: './mobile-bottom-nav.component.html',
  styleUrls: ['./mobile-bottom-nav.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNavComponent {
  private readonly _layoutService = inject(LayoutService);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _store = inject(Store);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _router = inject(Router);

  isEntrance = input(false);

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

  // Panel state signals from layout service
  readonly isShowNotes = this._layoutService.isShowNotes;
  readonly isShowIssuePanel = this._layoutService.isShowIssuePanel;
  readonly isShowScheduleDayPanel = this._layoutService.isShowScheduleDayPanel;
  readonly isIssuesPanelEnabled = computed(
    () => this._globalConfigService.appFeatures().isIssuesPanelEnabled,
  );
  readonly isProjectNotesEnabled = computed(
    () => this._globalConfigService.appFeatures().isProjectNotesEnabled,
  );
  readonly isScheduleDayPanelEnabled = computed(
    () => this._globalConfigService.appFeatures().isSchedulerEnabled,
  );

  // Second slot: configurable destination, Planner by default (#7637).
  private readonly _storedSlotId = signal(readStoredBottomNavSlot());
  readonly slotOptions = computed(() =>
    getAvailableBottomNavSlotOptions(
      this._globalConfigService.appFeatures(),
      this._pluginBridge.menuEntries(),
    ),
  );
  readonly slot = computed(() =>
    resolveBottomNavSlot(
      this._storedSlotId(),
      this._globalConfigService.appFeatures(),
      this._pluginBridge.menuEntries(),
    ),
  );
  private readonly _url = toSignal(
    this._router.events.pipe(
      filter((ev): ev is NavigationEnd => ev instanceof NavigationEnd),
      map((ev) => ev.urlAfterRedirects),
    ),
    { initialValue: this._router.url },
  );
  readonly isSlotActive = computed(() => isBottomNavSlotActive(this.slot(), this._url()));
  private readonly _slotMenuTrigger = viewChild('slotMenuTrigger', {
    read: MatMenuTrigger,
  });
  // `read` is required: on a mat-button the bare ref is the MatButton instance.
  private readonly _slotButton = viewChild('slotButton', { read: ElementRef });
  // A long-press must not also navigate when the press ends in a click.
  private _isSlotMenuGesture = false;

  /**
   * Below 600px this menu is the *only* route to every right-panel toggle --
   * `desktop-panel-buttons` is not rendered there at all. So every enabled
   * panel must be listed here and must count towards showing the button:
   * schedule was in neither, and `toggleScheduleDayPanel()` has no other
   * caller and no keyboard shortcut, so the panel was simply unreachable on a
   * phone.
   *
   * With exactly one entry the menu is skipped and that entry is rendered as
   * the nav button itself.
   */
  readonly sidePanelItemCount = computed(
    () =>
      this.sidePanelButtons().length +
      (this.isScheduleDayPanelEnabled() ? 1 : 0) +
      (this.isIssuesPanelEnabled() ? 1 : 0) +
      (this.isProjectNotesEnabled() ? 1 : 0),
  );

  // Navigation methods
  showAddTaskBar(): void {
    this._layoutService.showAddTaskBar();
  }

  toggleMobileNav(): void {
    this.toggleMobileNavEvent.emit();
  }

  onSlotPointerDown(): void {
    this._isSlotMenuGesture = false;
  }

  onSlotLongPress(): void {
    performHapticFeedback('longPress');
    this.openSlotMenu();
  }

  onSlotTouchEnd(ev: TouchEvent): void {
    // Lifting the finger would otherwise synthesize a click on the menu's
    // backdrop, which closes the menu that just opened.
    if (this._isSlotMenuGesture && ev.cancelable) {
      ev.preventDefault();
    }
  }

  openSlotMenu(): void {
    this._isSlotMenuGesture = true;
    this._slotMenuTrigger()?.openMenu();
  }

  onSlotClick(slot: BottomNavSlotOption): void {
    if (this._isSlotMenuGesture) {
      this._isSlotMenuGesture = false;
      return;
    }
    if (slot.kind === 'route') {
      this._router.navigateByUrl(slot.route);
    } else {
      slot.onClick();
    }
  }

  onSlotMenuClosed(): void {
    this._isSlotMenuGesture = false;
    // The trigger is a hidden anchor, so focus goes back to the slot itself.
    this._slotButton()?.nativeElement.focus();
  }

  selectSlot(id: string): void {
    this._storedSlotId.set(id);
    writeStoredBottomNavSlot(id);
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

  toggleScheduleDayPanel(): void {
    this._layoutService.toggleScheduleDayPanel();
  }
}
