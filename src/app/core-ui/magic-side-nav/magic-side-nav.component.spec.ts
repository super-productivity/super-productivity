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
          provide: MagicNavConfigService,
          useValue: navConfigServiceMock,
        },
        {
          provide: LayoutService,
          useValue: {
            isXs,
            focusSideNavTrigger: signal(0),
            toggleSideNavModeTrigger: signal(0),
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

  it('removes the mobile drawer and its focus trap while closed', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.nav-sidenav')).toBeNull();
    expect(fixture.debugElement.query(By.directive(CdkTrapFocus))).toBeNull();
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

    it('still executes plugin actions directly and notifies the service', () => {
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

      expect(action).toHaveBeenCalledTimes(1);
      expect(navConfigServiceMock.onNavItemClick).toHaveBeenCalledOnceWith(item);
    });
  });
});
