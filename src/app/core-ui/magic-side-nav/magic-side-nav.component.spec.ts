import { TaskMultiDragService } from '../../features/tasks/task-multi-drag.service';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';

import { MagicSideNavComponent } from './magic-side-nav.component';
import { MagicNavConfigService } from './magic-nav-config.service';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ScheduleExternalDragService } from '../../features/schedule/schedule-week/schedule-external-drag.service';
import { NavActionItem, NavConfig, NavPluginItem } from './magic-side-nav.model';

describe('MagicSideNavComponent', () => {
  let fixture: ComponentFixture<MagicSideNavComponent>;
  let isXs: ReturnType<typeof signal<boolean>>;
  let isMobileSideNavOpen: ReturnType<typeof signal<boolean>>;
  let browserMatches: boolean;
  let navConfigServiceMock: {
    navConfig: ReturnType<typeof signal<NavConfig>>;
    areInitialTreesReady: ReturnType<typeof signal<boolean>>;
    isProjectsExpanded: ReturnType<typeof signal<boolean>>;
    isTagsExpanded: ReturnType<typeof signal<boolean>>;
    onNavItemClick: jasmine.Spy;
  };

  const navConfig: NavConfig = {
    items: [],
    fullModeByDefault: true,
    showLabels: true,
    resizable: false,
    minWidth: 190,
    maxWidth: 400,
    defaultWidth: 260,
    collapseThreshold: 150,
    expandThreshold: 180,
  };

  beforeEach(async () => {
    isXs = signal(false);
    isMobileSideNavOpen = signal(false);
    browserMatches = false;
    navConfigServiceMock = {
      navConfig: signal(navConfig),
      areInitialTreesReady: signal(false),
      isProjectsExpanded: signal(false),
      isTagsExpanded: signal(false),
      onNavItemClick: jasmine.createSpy('onNavItemClick'),
    };
    spyOn(window, 'matchMedia').and.callFake(
      () =>
        ({
          matches: browserMatches,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );

    await TestBed.configureTestingModule({
      imports: [MagicSideNavComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: TaskMultiDragService,
          useValue: {
            ids: () => [],
            selectedIds: () => new Set(),
            selectionSize: () => 0,
            start: () => {},
            clear: () => {},
            canDrop: () => false,
          },
        },
        {
          provide: MagicNavConfigService,
          useValue: navConfigServiceMock,
        },
        {
          provide: LayoutService,
          useValue: {
            isXs,
            focusSideNavTrigger: signal(0),
            toggleSideNavModeTrigger: signal(0),
            isMobileSideNavOpen,
          },
        },
        {
          provide: TaskService,
          useValue: {
            focusFirstTaskIfVisible: jasmine.createSpy('focusFirstTaskIfVisible'),
          },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(false) },
        },
        { provide: Router, useValue: { events: EMPTY } },
        { provide: DragDropRegistry, useValue: { pointerUp: EMPTY } },
        {
          provide: ScheduleExternalDragService,
          useValue: {
            activeTask: signal(null),
            activeDragRef: signal(null),
            setActiveTask: jasmine.createSpy('setActiveTask'),
            setCancelNextDrop: jasmine.createSpy('setCancelNextDrop'),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
  });

  it('uses the shared layout breakpoint signal as its mobile source of truth', () => {
    isXs.set(true);
    browserMatches = false;

    fixture = TestBed.createComponent(MagicSideNavComponent);

    expect(fixture.componentInstance.isMobile()).toBe(true);
  });

  it('reports the open mobile drawer to the layout service', () => {
    isXs.set(true);
    browserMatches = true;
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    expect(isMobileSideNavOpen()).toBe(false);

    jasmine.clock().install();
    try {
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      expect(isMobileSideNavOpen()).toBe(true);

      jasmine.clock().tick(300);
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      expect(isMobileSideNavOpen()).toBe(false);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('renders the window drag strip above the desktop nav', () => {
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    const strip = fixture.nativeElement.querySelector(
      '.title-bar-drag-strip',
    ) as HTMLElement | null;

    expect(strip).not.toBeNull();
    expect(strip!.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the window drag strip on mobile, where the nav is a drawer', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.title-bar-drag-strip')).toBeNull();
  });

  it('exposes the open mobile drawer as labelled navigation with a focus trap', () => {
    isXs.set(true);
    browserMatches = true;
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    const drawer = fixture.nativeElement.querySelector(
      '.nav-sidenav',
    ) as HTMLElement | null;

    expect(drawer).not.toBeNull();
    expect(drawer!.tagName).toBe('NAV');
    expect(drawer!.getAttribute('role')).toBeNull();
    expect(drawer!.getAttribute('aria-modal')).toBeNull();
    expect(drawer!.getAttribute('aria-hidden')).toBeNull();
    expect(drawer!.getAttribute('aria-label')).toBeTruthy();
    expect(
      fixture.debugElement.query(By.directive(CdkTrapFocus)).injector.get(CdkTrapFocus)
        .enabled,
    ).toBe(true);
  });

  it('provides an initially focused close button inside the mobile focus trap', async () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const closeButton = fixture.nativeElement.querySelector(
      '.mobile-menu-close',
    ) as HTMLButtonElement | null;

    expect(closeButton).not.toBeNull();
    expect(closeButton!.getAttribute('aria-label')).toBeTruthy();
    expect(closeButton!.hasAttribute('cdkFocusInitial')).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    closeButton!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
  });

  it('keeps the close button below the top safe area without doubling native spacing', () => {
    const wasNativeMobile = document.body.classList.contains('isNativeMobile');
    document.body.classList.remove('isNativeMobile');
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    (fixture.nativeElement as HTMLElement).style.setProperty('--safe-area-top', '24px');
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    try {
      const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
      const closeButton = fixture.nativeElement.querySelector(
        '.mobile-menu-close',
      ) as HTMLButtonElement;

      expect(getComputedStyle(closeButton).marginTop).toBe('24px');

      document.body.classList.add('isNativeMobile');

      expect(getComputedStyle(drawer).top).toBe('24px');
      expect(getComputedStyle(closeButton).marginTop).toBe('0px');
    } finally {
      document.body.classList.toggle('isNativeMobile', wasNativeMobile);
    }
  });

  it('does not render the mobile drawer before it is first opened', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.nav-sidenav')).toBeNull();
    expect(fixture.debugElement.query(By.directive(CdkTrapFocus))).toBeNull();
  });

  // Kept after the first open so reopening skips rebuilding every row (#10820).
  it('keeps the closed mobile drawer unfocusable with its focus trap disabled', async () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();
    fixture.componentInstance.showMobileMenuOverlay.set(false);
    fixture.detectChanges();
    // The hidden state style lands when the (noop) leave animation finishes.
    await fixture.whenStable();

    const closeButton = fixture.nativeElement.querySelector(
      '.mobile-menu-close',
    ) as HTMLButtonElement;
    const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
    expect(drawer.contains(document.activeElement)).toBe(false);
    // content-visibility hides only the rows; the empty landmark must go too.
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    closeButton.focus();

    expect(document.activeElement).not.toBe(closeButton);
    expect(
      fixture.debugElement.query(By.directive(CdkTrapFocus)).injector.get(CdkTrapFocus)
        .enabled,
    ).toBe(false);
  });

  it('restores focus to the opener when the mobile drawer closes', async () => {
    isXs.set(true);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    try {
      opener.focus();
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
      fixture.componentInstance.showMobileMenuOverlay.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).not.toBe(opener);

      fixture.componentInstance.showMobileMenuOverlay.set(false);
      fixture.detectChanges();

      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('keeps focus in the nav when the open mobile drawer becomes the desktop nav', async () => {
    isXs.set(true);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    try {
      opener.focus();
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.componentInstance.showMobileMenuOverlay.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const nav = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
      nav.tabIndex = -1;
      nav.focus();

      isXs.set(false);
      fixture.detectChanges();

      expect(document.activeElement).toBe(nav);
    } finally {
      opener.remove();
    }
  });

  it('shows the desktop nav normally after the mobile drawer was rendered', async () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();
    fixture.componentInstance.showMobileMenuOverlay.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    isXs.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    const nav = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
    expect(nav.style.transform).not.toContain('translateX(100%)');
    expect(nav.style.contentVisibility).not.toBe('hidden');
    expect(nav.style.visibility).not.toBe('hidden');
    expect(nav.getAttribute('aria-hidden')).toBeNull();
  });

  it('times the repeated-tap guard from the drawer render, not the tap', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    // A fake clock cannot make the render slow, so check the ordering instead:
    // the window must not start counting before the drawer is on screen.
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();
    const guardTimers = (): number =>
      setTimeoutSpy.calls.all().filter((call) => call.args[1] === 300).length;

    fixture.componentInstance.toggleMobileNav();
    expect(guardTimers()).toBe(0);

    fixture.detectChanges();
    expect(guardTimers()).toBe(1);
  });

  it('ignores repeated taps while the mobile drawer is opening (#10820)', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    jasmine.clock().install();
    try {
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;

      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(true);
      expect(drawer.style.pointerEvents).toBe('none');

      jasmine.clock().tick(300);
      fixture.detectChanges();
      expect(drawer.style.pointerEvents).toBe('');
      fixture.componentInstance.toggleMobileNav();
      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('still closes the opening mobile drawer on back or Escape', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    jasmine.clock().install();
    try {
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      // The popstate already consumed the drawer's history entry: ignoring it
      // would leave the drawer open and send the next back press to the app.
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
      // A deliberate reopen right after must not be taken for a repeated tap.
      fixture.componentInstance.toggleMobileNav();
      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(true);
      fixture.componentInstance.showMobileMenuOverlay.set(false);
      fixture.detectChanges();

      jasmine.clock().tick(300);
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
      drawer.tabIndex = -1;
      drawer.focus();
      drawer.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('reopens on the next tap after an item click closed the opening drawer', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    fixture.componentInstance.toggleMobileNav();
    fixture.detectChanges();

    fixture.componentInstance.onItemClick({
      id: 'test-action',
      label: 'Test action',
      icon: 'bug_report',
      type: 'action',
      action: () => undefined,
    });
    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);

    fixture.componentInstance.toggleMobileNav();
    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(true);
  });

  it('closes the mobile drawer on Escape', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
    drawer.tabIndex = -1;
    drawer.focus();
    drawer.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
  });

  describe('onItemClick', () => {
    it('dispatches action items to the service without executing them directly', () => {
      fixture = TestBed.createComponent(MagicSideNavComponent);
      const action = jasmine.createSpy('action');
      const item: NavActionItem = {
        id: 'test-action',
        label: 'Test action',
        icon: 'bug_report',
        type: 'action',
        action,
      };

      fixture.componentInstance.onItemClick(item);

      expect(action).not.toHaveBeenCalled();
      expect(navConfigServiceMock.onNavItemClick).toHaveBeenCalledOnceWith(item);
    });

    it('dispatches plugin items to the service without executing them directly', () => {
      fixture = TestBed.createComponent(MagicSideNavComponent);
      const action = jasmine.createSpy('pluginAction');
      const item: NavPluginItem = {
        id: 'test-plugin',
        label: 'Test plugin',
        icon: 'extension',
        type: 'plugin',
        pluginId: 'test-plugin',
        action,
      };

      fixture.componentInstance.onItemClick(item);

      expect(action).not.toHaveBeenCalled();
      expect(navConfigServiceMock.onNavItemClick).toHaveBeenCalledOnceWith(item);
    });
  });
});
