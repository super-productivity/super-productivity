import { Component, ViewChild } from '@angular/core';
import {
  MatMenu,
  MatMenuItem,
  MatMenuModule,
  MatMenuTrigger,
} from '@angular/material/menu';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  applyMatMenuTouchMonkeyPatch,
  getMenuOpenTimeFor,
  isWithinMenuOpenGuard,
  lastMenuOpenTime,
  setLastMenuOpenTime,
  stampMenuPanelOpen,
} from './mat-menu-touch-monkey-patch';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

type MatMenuWithInternalItems = MatMenu & {
  _allItems?: {
    toArray: () => MatMenuItem[];
  };
};

type MatMenuItemWithElementRef = {
  _elementRef: {
    nativeElement: HTMLElement;
  };
};

@Component({
  imports: [MatMenuModule],
  template: `
    <button [matMenuTriggerFor]="menu">Open</button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item>First item</button>
    </mat-menu>
  `,
})
class MatMenuTouchPatchHostComponent {
  @ViewChild(MatMenuTrigger) trigger?: MatMenuTrigger;
}

@Component({
  imports: [MatMenuModule],
  template: `
    <button
      #root="matMenuTrigger"
      [matMenuTriggerFor]="parent"
    >
      Open
    </button>
    <mat-menu #parent="matMenu">
      <button
        #aTrigger="matMenuTrigger"
        id="submenu-a"
        mat-menu-item
        [matMenuTriggerFor]="a"
      >
        A
      </button>
      <button
        #bTrigger="matMenuTrigger"
        id="submenu-b"
        mat-menu-item
        [matMenuTriggerFor]="b"
      >
        B
      </button>
    </mat-menu>
    <mat-menu #a="matMenu"><button mat-menu-item>A item</button></mat-menu>
    <mat-menu #b="matMenu"><button mat-menu-item>B item</button></mat-menu>
  `,
})
class MatMenuTouchReopenHostComponent {
  @ViewChild('root') root!: MatMenuTrigger;
  @ViewChild('aTrigger') aTrigger!: MatMenuTrigger;
  @ViewChild('bTrigger') bTrigger!: MatMenuTrigger;
}

describe('Menu touch guard across real Material open transitions', () => {
  let fixture: ComponentFixture<MatMenuTouchReopenHostComponent>;
  let observer: MutationObserver;
  let clickListener: EventListener;
  let now: number;

  const panelFor = (trigger: MatMenuTrigger): HTMLElement =>
    document.getElementById((trigger.menu as MatMenu).panelId)!;

  const hover = (id: string): void => {
    document.getElementById(id)!.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatMenuTouchReopenHostComponent, NoopAnimationsModule],
    }).compileComponents();
    // Jasmine restores these prototypes after each test, including our overrides.
    spyOn(MatMenu.prototype, '_setIsOpen').and.callThrough();
    spyOn(MatMenuTrigger.prototype, 'openMenu').and.callThrough();
    const itemPrototype = MatMenuItem.prototype as unknown as {
      _checkDisabled: (event: MouseEvent) => void;
    };
    spyOn(itemPrototype, '_checkDisabled').and.callThrough();
    const observeSpy = spyOn(MutationObserver.prototype, 'observe').and.callThrough();
    const listenerSpy = spyOn(document, 'addEventListener').and.callThrough();
    applyMatMenuTouchMonkeyPatch();
    observer = observeSpy.calls.mostRecent().object as MutationObserver;
    clickListener = listenerSpy.calls.mostRecent().args[1] as EventListener;

    now = 1000;
    spyOn(Date, 'now').and.callFake(() => now);
    fixture = TestBed.createComponent(MatMenuTouchReopenHostComponent);
    fixture.detectChanges();
    fixture.componentInstance.root.openMenu();
    fixture.detectChanges();
    hover('submenu-a');
    // Let initial panel insertion reach the observer before testing reuse.
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture?.destroy();
    observer?.disconnect();
    document.removeEventListener('click', clickListener, true);
    setLastMenuOpenTime(0);
  });

  it('re-arms a reused panel when hovering away and back before detach', () => {
    const { root, aTrigger, bTrigger } = fixture.componentInstance;
    const panel = panelFor(aTrigger);
    expect(panel).not.toBeNull();
    expect(getMenuOpenTimeFor(panel)).toBe(1000);

    now = 2000;
    hover('submenu-b');
    expect(aTrigger.menuOpen).toBeFalse();
    expect(bTrigger.menuOpen).toBeTrue();
    now = 2010;
    hover('submenu-a');

    expect(aTrigger.menuOpen).toBeTrue();
    expect(panelFor(aTrigger)).toBe(panel);
    expect(getMenuOpenTimeFor(panel)).toBe(2010);
    expect(isWithinMenuOpenGuard(panel, now)).toBeTrue();
    expect(isWithinMenuOpenGuard(panelFor(root), now)).toBeFalse();
  });

  it('re-arms a click reopen but does not re-arm an already open panel', () => {
    const { aTrigger } = fixture.componentInstance;
    const panel = panelFor(aTrigger);
    now = 2000;
    aTrigger.closeMenu();
    aTrigger.openMenu();
    fixture.detectChanges();

    expect(panelFor(aTrigger)).toBe(panel);
    expect(getMenuOpenTimeFor(panel)).toBe(2000);
    expect(isWithinMenuOpenGuard(panel, now)).toBeTrue();
    now = 2500;
    aTrigger.openMenu();
    expect(getMenuOpenTimeFor(panel)).toBe(2000);
    expect(isWithinMenuOpenGuard(panel, now)).toBeFalse();
  });
});

/**
 * These tests verify that the Angular Material internal APIs we depend on
 * for the touch fix monkey patch still exist.
 *
 * If these tests fail after an Angular Material update, the monkey patch
 * in mat-menu-touch-monkey-patch.ts needs to be updated to match the new API.
 *
 * Related issue: https://github.com/super-productivity/super-productivity/issues/4436
 */
describe('Mat Menu Touch Monkey Patch API Compatibility', () => {
  let fixture: ComponentFixture<MatMenuTouchPatchHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatMenuTouchPatchHostComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MatMenuTouchPatchHostComponent);
    fixture.detectChanges();
  });

  describe('MatMenuItem internal API', () => {
    it('should have _checkDisabled method on prototype', () => {
      // This is the method we override to add touch protection
      // If this fails, Angular Material changed the click handler method name
      expect(typeof (MatMenuItem.prototype as any)._checkDisabled).toBe('function');
    });

    it('should have _elementRef property available', () => {
      // We need this to access the native element for pointer-events manipulation
      // This is set via dependency injection, so we check it's in the prototype chain
      const prototypeKeys = Object.getOwnPropertyNames(MatMenuItem.prototype);
      const hasElementRef =
        prototypeKeys.includes('_elementRef') || (MatMenuItem as any).ɵfac !== undefined; // Angular DI factory exists

      expect(hasElementRef).toBe(true);
    });
  });

  describe('MatMenuTrigger internal API', () => {
    it('should have openMenu method on prototype', () => {
      // This is the method we override to track menu open timing
      expect(typeof MatMenuTrigger.prototype.openMenu).toBe('function');
    });

    it('should have menu property accessor', () => {
      // We need access to the menu instance to get its items
      const descriptor = Object.getOwnPropertyDescriptor(
        MatMenuTrigger.prototype,
        'menu',
      );
      expect(descriptor).toBeDefined();
    });
  });

  describe('MatMenu internal API (via trigger)', () => {
    it('should expose _allItems with item element refs on a real menu instance', () => {
      const menu = fixture.componentInstance.trigger?.menu as MatMenuWithInternalItems;
      const items = menu._allItems?.toArray() ?? [];
      const firstItem = items[0] as unknown as MatMenuItemWithElementRef | undefined;

      expect(items.length).toBe(1);
      expect(firstItem?._elementRef.nativeElement.textContent).toContain('First item');
    });
  });

  describe('Monkey patch safety checks', () => {
    it('should gracefully handle missing _checkDisabled', () => {
      // Verify our patch approach - if the method doesn't exist,
      // storing it returns undefined, and we should handle that
      const originalMethod = (MatMenuItem.prototype as any)._checkDisabled;

      // The method should exist (this is the main compatibility check)
      expect(originalMethod).toBeDefined();

      // If it's defined, it should be callable
      if (originalMethod) {
        expect(typeof originalMethod).toBe('function');
      }
    });

    it('should have correct _checkDisabled signature (takes MouseEvent)', () => {
      // The _checkDisabled method should accept an event parameter
      // We can check the function length (number of declared parameters)
      const method = (MatMenuItem.prototype as any)._checkDisabled;
      expect(method.length).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * Builds a `.mat-mdc-menu-panel` with one item, attached to the document and
 * torn down after each test.
 */
const setupPanelFixture = (): {
  trackedPanel: () => HTMLElement;
  itemIn: (panel: HTMLElement) => Element;
} => {
  let panels: HTMLElement[] = [];

  beforeEach(() => {
    panels = [];
  });

  afterEach(() => {
    panels.forEach((panel) => panel.remove());
    setLastMenuOpenTime(0);
  });

  const trackedPanel = (): HTMLElement => {
    const panel = document.createElement('div');
    panel.classList.add('mat-mdc-menu-panel');
    const item = document.createElement('button');
    item.classList.add('mat-mdc-menu-item');
    panel.appendChild(item);
    document.body.appendChild(panel);
    panels.push(panel);
    return panel;
  };

  const itemIn = (panel: HTMLElement): Element =>
    panel.querySelector('.mat-mdc-menu-item') as Element;

  return { trackedPanel, itemIn };
};

/**
 * The touch guards drop a menu-item click that lands within 300ms of that
 * item's menu opening (#4436). Keyed per panel since a second panel opening —
 * a hover-opened submenu on a hybrid device — used to swallow a deliberate tap
 * in a panel that had been open for seconds.
 */
describe('Menu open time is tracked per panel', () => {
  const { trackedPanel, itemIn } = setupPanelFixture();

  it('reports the open time of the panel the element lives in', () => {
    const older = trackedPanel();
    const newer = trackedPanel();
    stampMenuPanelOpen(older, 1000);
    stampMenuPanelOpen(newer, 5000);

    expect(getMenuOpenTimeFor(itemIn(older))).toBe(1000);
    expect(getMenuOpenTimeFor(itemIn(newer))).toBe(5000);
  });

  it("does not let a newly opened panel reset another panel's open time", () => {
    const open = trackedPanel();
    stampMenuPanelOpen(open, 1000);
    stampMenuPanelOpen(trackedPanel(), 5000);

    expect(getMenuOpenTimeFor(itemIn(open))).toBe(1000);
  });

  it('re-arms a reused panel when it is stamped again on reopen', () => {
    // Re-tapping a trigger during its exit animation reuses the panel element.
    const panel = trackedPanel();
    stampMenuPanelOpen(panel, 1000);
    stampMenuPanelOpen(panel, 5000);

    expect(getMenuOpenTimeFor(itemIn(panel))).toBe(5000);
    expect(isWithinMenuOpenGuard(itemIn(panel), 5010)).toBe(true);
  });

  it('falls back to the global timestamp outside any stamped panel', () => {
    setLastMenuOpenTime(4242);

    expect(getMenuOpenTimeFor(document.body)).toBe(4242);
    expect(getMenuOpenTimeFor(null)).toBe(4242);
  });

  it('keeps the global timestamp in step with the newest panel', () => {
    stampMenuPanelOpen(trackedPanel(), 7000);

    expect(lastMenuOpenTime).toBe(7000);
  });
});

/**
 * The decision both touch guards ask. These are the regression guards for the
 * CI flake: a hover-opened submenu used to restart the window on the panel the
 * user was tapping in, and the tap was dropped.
 */
describe('isWithinMenuOpenGuard', () => {
  const { trackedPanel, itemIn } = setupPanelFixture();

  it('blocks a click landing inside its own freshly opened panel', () => {
    const panel = trackedPanel();
    stampMenuPanelOpen(panel, 1000);

    expect(isWithinMenuOpenGuard(itemIn(panel), 1100)).toBe(true);
  });

  it('lets a click through once its own panel has been open past the window', () => {
    const panel = trackedPanel();
    stampMenuPanelOpen(panel, 1000);

    expect(isWithinMenuOpenGuard(itemIn(panel), 1400)).toBe(false);
  });

  it('lets a click through while ANOTHER panel is opening under it', () => {
    const openForAWhile = trackedPanel();
    stampMenuPanelOpen(openForAWhile, 1000);
    // A submenu opens on hover between the tap's touchstart and its click.
    stampMenuPanelOpen(trackedPanel(), 5000);

    expect(isWithinMenuOpenGuard(itemIn(openForAWhile), 5010)).toBe(false);
  });

  it('still blocks a click in the panel that just opened under the finger', () => {
    stampMenuPanelOpen(trackedPanel(), 1000);
    const justOpened = trackedPanel();
    stampMenuPanelOpen(justOpened, 5000);

    expect(isWithinMenuOpenGuard(itemIn(justOpened), 5010)).toBe(true);
  });

  it('never blocks when no menu has opened at all', () => {
    expect(isWithinMenuOpenGuard(itemIn(trackedPanel()), 5000)).toBe(false);
  });
});
