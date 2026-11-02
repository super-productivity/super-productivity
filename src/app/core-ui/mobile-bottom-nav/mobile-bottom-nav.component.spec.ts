import { NO_ERRORS_SCHEMA, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { LayoutService } from '../layout/layout.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { PluginIconComponent } from '../../plugins/ui/plugin-icon/plugin-icon.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { togglePluginPanel } from '../layout/store/layout.actions';
import {
  selectActivePluginId,
  selectIsShowPluginPanel,
} from '../layout/store/layout.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { T } from '../../t.const';
import { PluginMenuEntryCfg } from '../../plugins/plugin-api.model';

/**
 * Below 600px this nav's panels menu is the ONLY route to every right-panel
 * toggle — `desktop-panel-buttons` is not rendered at that width at all, and
 * `toggleScheduleDayPanel()` has no keyboard shortcut and no other caller. So a
 * panel this menu forgets is a panel that cannot be opened on a phone, which is
 * exactly what happened to Schedule: it was in neither the menu nor the
 * button's show condition, and stayed unreachable for ~11 months because
 * nothing here asserted the two agree with the feature flags.
 *
 * That is what these pin: every enabled panel is reachable — listed in the
 * menu, or, when it is the only one, shown as the nav button itself.
 */
describe('MobileBottomNavComponent', () => {
  interface SidePanelBtn {
    pluginId: string;
    label: string;
    icon: string;
    onClick?: () => void;
  }

  type LayoutToggle = 'toggleScheduleDayPanel' | 'toggleAddTaskPanel' | 'toggleNotes';
  type LayoutShowSignal = 'isShowScheduleDayPanel' | 'isShowIssuePanel' | 'isShowNotes';

  /** Feature flag → the item it must produce, what it toggles, and its state. */
  const PANEL_ITEMS: ReadonlyArray<
    [keyof AppFeaturesConfig, string, LayoutToggle, LayoutShowSignal]
  > = [
    [
      'isSchedulerEnabled',
      '.e2e-toggle-schedule-day-panel',
      'toggleScheduleDayPanel',
      'isShowScheduleDayPanel',
    ],
    [
      'isIssuesPanelEnabled',
      '.e2e-toggle-issue-provider-panel',
      'toggleAddTaskPanel',
      'isShowIssuePanel',
    ],
    ['isProjectNotesEnabled', '.e2e-toggle-notes-btn', 'toggleNotes', 'isShowNotes'],
  ];

  const ALL_OFF: Partial<AppFeaturesConfig> = {
    isSchedulerEnabled: false,
    isIssuesPanelEnabled: false,
    isProjectNotesEnabled: false,
  };

  let fixture: ComponentFixture<MobileBottomNavComponent>;
  let layout: {
    isShowNotes: WritableSignal<boolean>;
    isShowIssuePanel: WritableSignal<boolean>;
    isShowScheduleDayPanel: WritableSignal<boolean>;
    showAddTaskBar: jasmine.Spy;
    toggleAddTaskPanel: jasmine.Spy;
    toggleNotes: jasmine.Spy;
    toggleScheduleDayPanel: jasmine.Spy;
  };
  let dispatch: jasmine.Spy;
  let activePluginId$: BehaviorSubject<string | null>;
  let isShowPluginPanel$: BehaviorSubject<boolean>;

  const render = async (
    over: Partial<AppFeaturesConfig>,
    sidePanelButtons: SidePanelBtn[] = [],
    menuEntries: PluginMenuEntryCfg[] = [],
  ): Promise<MobileBottomNavComponent> => {
    const appFeatures = signal<AppFeaturesConfig>({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      ...over,
    });

    layout = {
      isShowNotes: signal(false),
      isShowIssuePanel: signal(false),
      isShowScheduleDayPanel: signal(false),
      showAddTaskBar: jasmine.createSpy('showAddTaskBar'),
      toggleAddTaskPanel: jasmine.createSpy('toggleAddTaskPanel'),
      toggleNotes: jasmine.createSpy('toggleNotes'),
      toggleScheduleDayPanel: jasmine.createSpy('toggleScheduleDayPanel'),
    };
    dispatch = jasmine.createSpy('dispatch');
    activePluginId$ = new BehaviorSubject<string | null>(null);
    isShowPluginPanel$ = new BehaviorSubject(false);
    const select = (selector: unknown): unknown =>
      selector === selectActivePluginId
        ? activePluginId$
        : selector === selectIsShowPluginPanel
          ? isShowPluginPanel$
          : of(null);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        NoopAnimationsModule,
        MobileBottomNavComponent,
      ],
      providers: [
        provideRouter([]),
        { provide: LayoutService, useValue: layout },
        {
          provide: PluginBridgeService,
          useValue: {
            sidePanelButtons: signal(sidePanelButtons),
            menuEntries: signal(menuEntries),
          },
        },
        { provide: Store, useValue: { select, dispatch } },
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

  const nav = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const menuTrigger = (): HTMLElement | null =>
    nav().querySelector<HTMLElement>('button[aria-haspopup="menu"]');

  /** Opens the panels menu and returns the item selectors it rendered. */
  const openPanelsMenu = (): string[] => {
    const trigger = menuTrigger();
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
    ['schedule and notes', { isIssuesPanelEnabled: false }],
    ['issues and notes', { isSchedulerEnabled: false }],
  ];

  cases.forEach(([name, over]) => {
    it(`lists every enabled panel — ${name}`, async () => {
      const cmp = await render(over);
      const af = { ...DEFAULT_GLOBAL_CONFIG.appFeatures, ...over };

      const expected = PANEL_ITEMS.filter(([flag]) => af[flag]).map(([, sel]) => sel);
      expect(cmp.sidePanelItemCount()).toBe(expected.length);
      expect(openPanelsMenu()).toEqual(expected);
    });
  });

  it('lists a plugin side panel next to a built-in panel', async () => {
    // Plugin buttons and built-in panels are counted separately; together
    // they must add up to a menu, not a single direct button.
    const cmp = await render({ ...ALL_OFF, isProjectNotesEnabled: true }, [
      { pluginId: 'p1', label: 'Doc Mode', icon: 'description' },
    ]);

    expect(cmp.sidePanelItemCount()).toBe(2);
    expect(openPanelsMenu()).toEqual(['.e2e-toggle-notes-btn', 'plugin-icon']);
  });

  PANEL_ITEMS.forEach(([flag, sel, toggle, isShow]) => {
    it(`shows the only enabled panel as the nav button itself — ${flag}`, async () => {
      await render({ ...ALL_OFF, [flag]: true });

      const btn = nav().querySelector<HTMLElement>(`.nav-button${sel}`);
      expect(menuTrigger()).toBeFalsy();
      expect(btn).toBeTruthy();
      expect(btn?.classList).not.toContain('active');
      expect(btn?.getAttribute('aria-pressed')).toBe('false');

      btn?.click();
      expect(layout[toggle]).toHaveBeenCalledTimes(1);

      layout[isShow].set(true);
      fixture.detectChanges();
      expect(btn?.classList).toContain('active');
      expect(btn?.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('shows a lone plugin side panel as the nav button itself', async () => {
    const onClick = jasmine.createSpy('onClick');
    await render(ALL_OFF, [
      { pluginId: 'p1', label: 'Doc Mode', icon: 'description', onClick },
    ]);

    const btn = nav().querySelector<HTMLElement>('button[aria-label="Doc Mode"]');
    expect(menuTrigger()).toBeFalsy();
    expect(btn?.querySelector('plugin-icon')).toBeTruthy();
    expect(btn?.getAttribute('aria-pressed')).toBe('false');

    btn?.click();
    expect(dispatch).toHaveBeenCalledWith(togglePluginPanel('p1'));
    expect(onClick).toHaveBeenCalledTimes(1);

    // Active only while this plugin's panel is the one shown.
    activePluginId$.next('p1');
    fixture.detectChanges();
    expect(btn?.classList).not.toContain('active');

    isShowPluginPanel$.next(true);
    fixture.detectChanges();
    expect(btn?.classList).toContain('active');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no panels button when nothing at all is enabled', async () => {
    const cmp = await render(ALL_OFF);

    expect(cmp.sidePanelItemCount()).toBe(0);
    expect(menuTrigger()).toBeFalsy();
    PANEL_ITEMS.forEach(([, sel]) => expect(nav().querySelector(sel)).toBeFalsy());
  });

  describe('configurable second slot', () => {
    const slotBtn = (): HTMLElement | null =>
      nav().querySelector<HTMLElement>('.e2e-bottom-nav-slot');
    let navigateByUrl: jasmine.Spy;

    const renderSlot = async (
      over: Partial<AppFeaturesConfig> = {},
      menuEntries: PluginMenuEntryCfg[] = [],
    ): Promise<MobileBottomNavComponent> => {
      const cmp = await render(over, [], menuEntries);
      navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
      return cmp;
    };

    afterEach(() => localStorage.removeItem(LS.BOTTOM_NAV_SLOT));

    it('shows Planner by default and navigates there on tap', async () => {
      await renderSlot();

      expect(slotBtn()?.getAttribute('aria-label')).toBe(T.MH.PLANNER);
      expect(slotBtn()?.classList).toContain('tour-planner');
      slotBtn()?.click();
      expect(navigateByUrl).toHaveBeenCalledOnceWith('/planner');
    });

    it('runs a stored plugin entry on tap', async () => {
      const onClick = jasmine.createSpy('onClick');
      localStorage.setItem(LS.BOTTOM_NAV_SLOT, 'plugin:p1:Doc Mode');
      await renderSlot({}, [
        { pluginId: 'p1', label: 'Doc Mode', icon: 'description', onClick },
      ]);

      expect(slotBtn()?.getAttribute('aria-label')).toBe('Doc Mode');
      expect(slotBtn()?.querySelector('plugin-icon')).toBeTruthy();
      slotBtn()?.click();
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('uses the stored choice', async () => {
      localStorage.setItem(LS.BOTTOM_NAV_SLOT, 'boards');
      await renderSlot();

      expect(slotBtn()?.getAttribute('aria-label')).toBe(T.MH.BOARDS);
      expect(slotBtn()?.classList).not.toContain('tour-planner');
      slotBtn()?.click();
      expect(navigateByUrl).toHaveBeenCalledOnceWith('/boards');
    });

    it('hides the slot when Planner is disabled and nothing else was chosen', async () => {
      await renderSlot({ isPlannerEnabled: false });

      expect(slotBtn()).toBeFalsy();
    });

    it('opens the menu on contextmenu without navigating', async () => {
      await renderSlot();

      slotBtn()?.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
      fixture.detectChanges();
      // The click that ends a long-press must not navigate.
      slotBtn()?.click();

      expect(document.querySelector('.mobile-bottom-nav-slot-menu')).toBeTruthy();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('returns focus to the slot button when the menu closes', async () => {
      const cmp = await renderSlot();

      cmp.openSlotMenu();
      fixture.detectChanges();
      document
        .querySelector<HTMLElement>('.mobile-bottom-nav-slot-menu [role="menuitemradio"]')
        ?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.activeElement).toBe(slotBtn());
    });

    it('stores a picked destination and navigates to it afterwards', async () => {
      const cmp = await renderSlot();

      cmp.openSlotMenu();
      fixture.detectChanges();
      const items = [
        ...document.querySelectorAll<HTMLElement>(
          '.mobile-bottom-nav-slot-menu [role="menuitemradio"]',
        ),
      ];
      expect(items.map((el) => el.getAttribute('aria-checked'))).toEqual([
        'true',
        'false',
        'false',
        'false',
        'false',
      ]);

      items[1].click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(localStorage.getItem(LS.BOTTOM_NAV_SLOT)).toBe('inbox');
      expect(cmp.slot()?.id).toBe('inbox');
      slotBtn()?.click();
      expect(navigateByUrl).toHaveBeenCalledOnceWith(
        `/project/${INBOX_PROJECT.id}/tasks`,
      );
    });
  });
});
