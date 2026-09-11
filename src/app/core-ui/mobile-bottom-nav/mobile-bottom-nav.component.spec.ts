import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { LayoutService } from '../layout/layout.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { PluginIconComponent } from '../../plugins/ui/plugin-icon/plugin-icon.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';

/**
 * Below 600px this nav's panels menu is the ONLY route to every right-panel
 * toggle — `desktop-panel-buttons` is not rendered at that width at all, and
 * `toggleScheduleDayPanel()` has no keyboard shortcut and no other caller. So a
 * panel this menu forgets is a panel that cannot be opened on a phone, which is
 * exactly what happened to Schedule: it was in neither the menu nor
 * `hasSidePanelMenuItems`, and stayed unreachable for ~11 months because
 * nothing here asserted the two agree with the feature flags.
 *
 * That is what these pin: every enabled panel is listed, and enabling any one
 * of them is enough to show the button that reveals the list.
 */
describe('MobileBottomNavComponent', () => {
  interface SidePanelBtn {
    pluginId: string;
    label: string;
    icon: string;
  }

  /** Feature flag → the menu item it must produce. */
  const PANEL_ITEMS: ReadonlyArray<[keyof AppFeaturesConfig, string]> = [
    ['isScheduleDayPanelEnabled', '.e2e-toggle-schedule-day-panel'],
    ['isIssuesPanelEnabled', '.e2e-toggle-issue-provider-panel'],
    ['isProjectNotesEnabled', '.e2e-toggle-notes-btn'],
  ];

  const ALL_OFF: Partial<AppFeaturesConfig> = {
    isScheduleDayPanelEnabled: false,
    isIssuesPanelEnabled: false,
    isProjectNotesEnabled: false,
  };

  let fixture: ComponentFixture<MobileBottomNavComponent>;

  const render = async (
    over: Partial<AppFeaturesConfig>,
    sidePanelButtons: SidePanelBtn[] = [],
  ): Promise<MobileBottomNavComponent> => {
    const appFeatures = signal<AppFeaturesConfig>({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      ...over,
    });

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        NoopAnimationsModule,
        MobileBottomNavComponent,
      ],
      providers: [
        provideRouter([]),
        {
          provide: LayoutService,
          useValue: {
            isShowNotes: signal(false),
            isShowIssuePanel: signal(false),
            isShowScheduleDayPanel: signal(false),
            showAddTaskBar: () => {},
            toggleAddTaskPanel: () => {},
            toggleNotes: () => {},
            toggleScheduleDayPanel: () => {},
          },
        },
        {
          provide: PluginBridgeService,
          useValue: { sidePanelButtons: signal(sidePanelButtons) },
        },
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        {
          provide: WorkContextService,
          useValue: { activeWorkContext$: of({ isEnableBacklog: false }) },
        },
        { provide: GlobalConfigService, useValue: { appFeatures } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // `plugin-icon` reaches the whole plugin runtime through DI (PluginService
      // -> PluginRunner -> SnackService -> LOCAL_ACTIONS). This spec is about
      // which items the menu lists, not how they are drawn, so the element is
      // left unresolved and asserted on by tag name.
      .overrideComponent(MobileBottomNavComponent, {
        remove: { imports: [PluginIconComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MobileBottomNavComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  /** Opens the panels menu and returns the item selectors it rendered. */
  const openPanelsMenu = (): string[] => {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'button[aria-haspopup="menu"]',
    );
    if (!trigger) {
      return [];
    }
    trigger.click();
    fixture.detectChanges();

    const panel = document.querySelector('.mobile-bottom-nav-panels-menu');
    if (!panel) {
      return [];
    }
    return [...PANEL_ITEMS.map(([, sel]) => sel), 'plugin-icon'].filter(
      (sel) => !!panel.querySelector(sel),
    );
  };

  afterEach(() => {
    // mat-menu renders into an overlay on document.body, which outlives the
    // fixture — without this the next test reads the previous test's menu.
    fixture?.destroy();
    document
      .querySelectorAll('.cdk-overlay-container')
      .forEach((el) => (el.innerHTML = ''));
  });

  const cases: Array<[string, Partial<AppFeaturesConfig>]> = [
    ['all three enabled', {}],
    ['only schedule', { isIssuesPanelEnabled: false, isProjectNotesEnabled: false }],
    ['only issues', { isScheduleDayPanelEnabled: false, isProjectNotesEnabled: false }],
    ['only notes', { isScheduleDayPanelEnabled: false, isIssuesPanelEnabled: false }],
    ['schedule and notes', { isIssuesPanelEnabled: false }],
  ];

  cases.forEach(([name, over]) => {
    it(`lists every enabled panel — ${name}`, async () => {
      const cmp = await render(over);
      const af = { ...DEFAULT_GLOBAL_CONFIG.appFeatures, ...over };

      const expected = PANEL_ITEMS.filter(([flag]) => af[flag]).map(([, sel]) => sel);
      expect(cmp.hasSidePanelMenuItems()).toBe(true);
      expect(openPanelsMenu()).toEqual(expected);
    });
  });

  it('hides the panels button only when nothing at all is enabled', async () => {
    const cmp = await render(ALL_OFF);

    expect(cmp.hasSidePanelMenuItems()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[aria-haspopup="menu"]',
      ),
    ).toBeFalsy();
  });

  it('shows the panels button for a plugin side panel with every built-in off', async () => {
    // The button's condition and the menu's contents are separate lists, so
    // each has to hold on its own: a config that produces items must produce
    // the trigger too.
    const cmp = await render(ALL_OFF, [
      { pluginId: 'p1', label: 'Doc Mode', icon: 'description' },
    ]);

    expect(cmp.hasSidePanelMenuItems()).toBe(true);
    expect(openPanelsMenu()).toEqual(['plugin-icon']);
  });
});
